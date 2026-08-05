using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 为九个业务场景提供稳定、可重复的 WebGL 构建入口。
/// 开发构建与正式构建显式分离，避免正式包意外携带开发模式；旧命令行入口保留为开发构建兼容别名，
/// 从而不要求既有自动化立即修改，同时禁止通过手动切换 Build Settings 来改变构建性质。
/// </summary>
public static class PowerPlantWebGlBuild
{
    public const string DevelopmentOutputPath = "Builds/WebGL-Development";
    public const string ProductionOutputPath = "Builds/Releases";
    private const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";
    private const string ReleaseIdArgumentName = "-webglReleaseId";
    // 自定义模板位于 Assets/WebGLTemplates/EmbeddedViewport；PROJECT 前缀是 Unity 对项目模板的固定标记。
    // 正式嵌入壳必须使用该模板，避免默认模板将画布回退为 960×600 并在前端 16:9 容器内产生滚动条。
    private const string EmbeddedViewportWebGlTemplate = "PROJECT:EmbeddedViewport";
    private const string EmbeddedViewportTemplateDirectory = "Assets/WebGLTemplates/EmbeddedViewport";

    /// <summary>
    /// 兼容既有“高亮流程”命令行入口：该入口语义固定为开发构建，
    /// 便于保留调试符号和开发诊断；正式发布必须改用 BuildProductionWebGl。
    /// </summary>
    [MenuItem("Tools/Power Plant/WebGL/Build Highlight Flow WebGL")]
    public static void BuildHighlightFlowWebGl()
    {
        BuildDevelopmentWebGl();
    }

    /// <summary>构建开发 WebGL 包：仅此入口显式启用开发模式，用于本地排错与测试。</summary>
    [MenuItem("Tools/Power Plant/WebGL/Build Development WebGL")]
    public static void BuildDevelopmentWebGl()
    {
        BuildWebGl(DevelopmentOutputPath, true, ResolveReleaseId());
    }

    /// <summary>构建正式 WebGL 包：不附加开发模式，作为发布流水线的唯一正式入口。</summary>
    [MenuItem("Tools/Power Plant/WebGL/Build Production WebGL")]
    public static void BuildProductionWebGl()
    {
        string releaseId = ResolveReleaseId();
        string releaseDirectory = Path.Combine(ProductionOutputPath, releaseId);
        string finalUnityDirectory = Path.Combine(releaseDirectory, "unity");
        if (Directory.Exists(releaseDirectory))
        {
            // 正式目录不可覆盖，旧版本才可作为确定回滚目标；构建失败的暂存目录同样保留供排查，
            // 由发布人员显式确认后处理，脚本不会递归删除任何既有输出。
            throw new BuildFailedException($"正式发布目录已存在：{releaseId}。请使用新的发布标识，或先人工核验已有目录。");
        }

        string stagingDirectory = Path.Combine(
            ProductionOutputPath,
            ".staging",
            $"{releaseId}-{Guid.NewGuid():N}",
            "unity");
        BuildWebGl(stagingDirectory, false, releaseId);
        Directory.CreateDirectory(ProductionOutputPath);
        Directory.Move(Path.GetDirectoryName(stagingDirectory), releaseDirectory);

        Console.WriteLine($"WebGL 正式发布目录已固化：{Path.GetFullPath(finalUnityDirectory)}。");
    }

    /// <summary>
    /// 统一生成 WebGL 包。构建参数由调用入口明确传入，不读取编辑器当前“开发构建”勾选状态，
    /// 保证同一命令在不同编辑器机器上得到一致结果，并防止生产包默认带有调试开关。
    /// </summary>
    private static void BuildWebGl(string outputPath, bool isDevelopmentBuild, string releaseId)
    {
        ValidateBuildSettings();
        ValidateEmbeddedViewportTemplate();

        string absoluteOutputPath = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(absoluteOutputPath);
        // 先生成资产包和文本清单，再让播放器在裁剪阶段读取该清单，保留只存在于业务场景包中的控制器类型。
        // 若此步骤失败，正式构建仍停留在暂存目录，不会覆盖任何已发布版本。
        PowerPlantSceneBundleBuild.BuildSceneBundles(outputPath, releaseId);
        string assetBundleManifestPath = PowerPlantSceneBundleBuild.GetAssetBundleManifestPath(outputPath);
        if (!File.Exists(assetBundleManifestPath))
        {
            throw new BuildFailedException("场景资源构建未生成播放器所需的资产包清单。");
        }

        BuildPlayerOptions options = new BuildPlayerOptions
        {
            // 主播放器只打入轻量 Bootstrap。九个业务场景由紧随其后的资产包构建写入同级 SceneBundles，
            // 这样首屏不再把九个场景资源收敛进单一 WebGL 数据文件。
            scenes = new[] { BootstrapScenePath },
            locationPathName = outputPath,
            target = BuildTarget.WebGL,
            assetBundleManifestPath = assetBundleManifestPath,
            // 严格模式同时适用于开发包和正式包；只有开发入口才附加 Development。
            options = isDevelopmentBuild ? BuildOptions.Development | BuildOptions.StrictMode : BuildOptions.StrictMode
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result != BuildResult.Succeeded)
        {
            throw new BuildFailedException(
                $"WebGL 构建失败：{report.summary.result}，共 {report.summary.totalErrors} 个错误、{report.summary.totalWarnings} 个警告。详情见 Editor.log。");
        }

        Console.WriteLine(
            $"WebGL{(isDevelopmentBuild ? "开发" : "正式")}构建成功：{absoluteOutputPath}；大小 {report.summary.totalSize / (1024f * 1024f):F1} MB；耗时 {report.summary.totalTime}；发布标识 {releaseId}。");
    }

    /// <summary>
    /// 构建设置保留九个场景的编辑器登记，供目录校验与资产包构建使用；
    /// 但主播放器不直接使用该列表，只允许 Bootstrap 进入首屏数据。顺序错误会阻止发布。
    /// </summary>
    private static void ValidateBuildSettings()
    {
        EditorBuildSettingsScene[] buildScenes = EditorBuildSettings.scenes;
        if (buildScenes == null || buildScenes.Length != BusinessSceneCatalog.GetRequiredSceneIds().Count + 1 ||
            !buildScenes[0].enabled || !string.Equals(buildScenes[0].path, BootstrapScenePath, StringComparison.Ordinal))
        {
            throw new BuildFailedException("构建设置必须以 Bootstrap 为索引零，并登记完整九个业务场景。");
        }

        int enabledBusinessSceneCount = buildScenes.Count(scene =>
            scene.enabled &&
            !string.Equals(scene.path, BootstrapScenePath, StringComparison.Ordinal));
        if (enabledBusinessSceneCount != BusinessSceneCatalog.GetRequiredSceneIds().Count)
        {
            throw new BuildFailedException("构建设置中的业务场景数量不完整，不能构建资源包。");
        }
    }

    /// <summary>
    /// 确认构建使用项目内的嵌入式网页模板。
    /// 模板与 Vue（渐进式网页框架）三维容器共同定义“由父 iframe（内嵌框架）决定真实尺寸”的边界；
    /// 此处只验证，不在构建时静默改写用户选择，配置漂移应以明确失败阻止错误发布。
    /// </summary>
    private static void ValidateEmbeddedViewportTemplate()
    {
        if (!Directory.Exists(EmbeddedViewportTemplateDirectory) ||
            !File.Exists(Path.Combine(EmbeddedViewportTemplateDirectory, "index.html")))
        {
            throw new BuildFailedException("嵌入式 WebGL 模板目录不完整，不能构建会产生固定画布的默认网页入口。");
        }

        if (!string.Equals(PlayerSettings.WebGL.template, EmbeddedViewportWebGlTemplate, StringComparison.Ordinal))
        {
            throw new BuildFailedException(
                $"WebGL 模板必须为 {EmbeddedViewportWebGlTemplate}，当前值为 {PlayerSettings.WebGL.template}。" +
                "请在项目设置中恢复嵌入式模板后重新构建。");
        }
    }

    /// <summary>
    /// 发布标识优先来自命令行 -webglReleaseId；未指定时使用项目版本。
    /// 它仅允许安全文件名字符，既可作为目录名，又可作为目录和内容摘要中的回滚标识。
    /// </summary>
    private static string ResolveReleaseId()
    {
        string[] arguments = Environment.GetCommandLineArgs();
        for (int index = 0; index < arguments.Length - 1; index++)
        {
            if (string.Equals(arguments[index], ReleaseIdArgumentName, StringComparison.Ordinal))
            {
                return ValidateReleaseId(arguments[index + 1]);
            }
        }
        return ValidateReleaseId(PlayerSettings.bundleVersion);
    }

    private static string ValidateReleaseId(string releaseId)
    {
        if (string.IsNullOrWhiteSpace(releaseId) || releaseId.Length > 64)
        {
            throw new BuildFailedException("发布标识不能为空且长度不能超过 64。");
        }
        for (int index = 0; index < releaseId.Length; index++)
        {
            char character = releaseId[index];
            if (!char.IsLetterOrDigit(character) && character != '.' && character != '_' && character != '-')
            {
                throw new BuildFailedException("发布标识只能包含字母、数字、点、下划线和连字符。");
            }
        }
        return releaseId;
    }
}
