using System;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 为九个业务场景提供稳定、可重复的 WebGL 构建入口。
/// 开发构建与正式构建显式分离，避免正式包意外携带开发模式；旧命令行入口保留为开发构建兼容别名，
/// 从而不要求既有自动化立即修改，同时禁止通过手动切换 Build Settings 来改变构建性质。
/// </summary>
public static class PowerPlantWebGlBuild
{
    /// <summary>
    /// 随每个成功 Unity 构建写出的版本化协议声明。字段由运行时共享契约生成，
    /// 前端发布脚本只需读取该小文件即可拒绝旧构建，无需解压和扫描大型二进制资源。
    /// </summary>
    [Serializable]
    private sealed class WebGlProtocolCompatibilityMetadata
    {
        public int schemaVersion;
        public string unityReleaseId;
        public string channel;
        public int protocolVersion;
        // 完整命令能力用于发布前静态门禁，不能依赖启动浏览器后才发现旧构建缺少命令。
        public string[] commandCapabilities;
        // 完整事件能力用于发布前确认三维反向选中与清除链路，避免旧包在浏览器握手阶段才失败。
        public string[] eventCapabilities;
        public int sceneChangedSchemaVersion;
        public string[] sceneChangedRequiredFields;
        public string[] switchSceneRequiredFields;
        public int switchSceneRecoverySchemaVersion;
        public string[] switchSceneRecoveryRequiredFields;
        public int setNodeVisualStateSchemaVersion;
        public string[] setNodeVisualStateRequiredFields;
        public int clearNodeVisualStateSchemaVersion;
        public string[] clearNodeVisualStateRequiredFields;
        public int processDetailCommandSchemaVersion;
        public string[] prepareProcessDetailRequiredFields;
        public string[] commitProcessDetailRequiredFields;
        public string[] abortProcessDetailRequiredFields;
        public string[] enterProcessDetailRequiredFields;
        public string[] exitProcessDetailRequiredFields;
        public string[] setProcessDetailPlaybackRequiredFields;
    }

    public const string DevelopmentOutputPath = "Builds/WebGL-Development";
    public const string ProductionOutputPath = "Builds/Releases";
    private const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";
    private const string ReleaseIdArgumentName = "-webglReleaseId";
    // 自定义模板位于 Assets/WebGLTemplates/EmbeddedViewport；PROJECT 前缀是 Unity 对项目模板的固定标记。
    // 正式嵌入壳必须使用该模板，避免默认模板将画布回退为 960×600 并在前端 16:9 容器内产生滚动条。
    private const string EmbeddedViewportWebGlTemplate = "PROJECT:EmbeddedViewport";
    private const string EmbeddedViewportTemplateDirectory = "Assets/WebGLTemplates/EmbeddedViewport";
    // 燃气场景的资源包按需加载，浏览器不应把主播放器数据长期写入本地离线缓存。
    // 关闭该项可避免反复调试不同发布包时，旧包缓存与当前 WebAssembly（网页程序集）共同占用内存和磁盘空间；
    // 它只控制 Unity WebGL 的资源持久化缓存，不改变运行时的内存上限或场景资源包的按需下载机制。
    private const bool EnableWebGlDataCachingForBuild = false;
    // 合作方联调包和正式包都部署在局域网独立服务中，服务地址通常是明文 HTTP；
    // Unity 的 WebGL 播放器如果保持 NotAllowed，会在通过局域网地址下载 SceneBundles 时直接报“Insecure connection not allowed”。
    // 这里只在构建产物中允许 HTTP，构建结束后会恢复编辑器原设置；HTTPS 部署仍然可以正常访问，不会被该选项限制。
    private const InsecureHttpOption InsecureHttpOptionForBuild = InsecureHttpOption.AlwaysAllowed;
    // 主播放器只承载 Bootstrap（启动壳），燃气模型等重资源由场景资源包在 switchScene（场景切换）后按需下载。
    // 因此首启仍只申请 256MB 连续网页程序集内存，避免受限浏览器因预留过大而在实例创建前失败。
    // 但燃煤场景的顶点数据在跨场景加载时会临时超过 768MB：旧上限会在 Unity 仍可清理旧场景资源前拒绝增长，
    // 导致 WebGL 报“内存不足”并中断燃气→燃煤的合法切换。将上限提高到 2GB、单次增长提高到 256MB 后，
    // 只在确有需要时增长，且仍保留明确上界，不会把每个首次打开页面的基线内存提高到 2GB。
    private const int InitialWebGlMemorySizeInMegabytes = 256;
    private const int MaximumWebGlMemorySizeInMegabytes = 2048;
    private const int WebGlGeometricMemoryGrowthCapInMegabytes = 256;

    /// <summary>
    /// 兼容既有“高亮流程”命令行入口：该入口语义固定为开发构建，
    /// 便于保留调试符号和开发诊断；正式发布必须改用 BuildProductionWebGl。
    /// </summary>
    [MenuItem("Tools/WebDLPro/WebGL/构建高亮流程开发包")]
    public static void BuildHighlightFlowWebGl()
    {
        BuildDevelopmentWebGl();
    }

    /// <summary>构建开发 WebGL 包：仅此入口显式启用开发模式，用于本地排错与测试。</summary>
    [MenuItem("Tools/WebDLPro/WebGL/构建开发包")]
    public static void BuildDevelopmentWebGl()
    {
        BuildWebGl(DevelopmentOutputPath, true, ResolveReleaseId());
    }

    /// <summary>构建正式 WebGL 包：不附加开发模式，作为发布流水线的唯一正式入口。</summary>
    [MenuItem("Tools/WebDLPro/WebGL/构建正式包")]
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

        // Application.version（应用版本）由 PlayerSettings.bundleVersion（播放器设置版本）生成。
        // 因此构建期间必须把当前发布标识嵌入主播放器，运行时才能拒绝与自身不属于同一发布事务的 SceneBundles（场景资源包）目录。
        // 数据缓存设置也在构建期间显式固定，确保每个发布包的缓存行为可预测；
        // finally 无条件恢复编辑器原设置，既避免污染用户项目版本，也保证构建失败不会遗留隐藏的项目配置修改。
        string originalBundleVersion = PlayerSettings.bundleVersion;
        bool bundleVersionChanged = !string.Equals(originalBundleVersion, releaseId, StringComparison.Ordinal);
        bool originalWebGlDataCaching = PlayerSettings.WebGL.dataCaching;
        bool webGlDataCachingChanged = originalWebGlDataCaching != EnableWebGlDataCachingForBuild;
        int originalWebGlInitialMemorySize = PlayerSettings.WebGL.initialMemorySize;
        bool webGlInitialMemorySizeChanged = originalWebGlInitialMemorySize != InitialWebGlMemorySizeInMegabytes;
        int originalWebGlMaximumMemorySize = PlayerSettings.WebGL.maximumMemorySize;
        bool webGlMaximumMemorySizeChanged = originalWebGlMaximumMemorySize != MaximumWebGlMemorySizeInMegabytes;
        int originalWebGlGeometricMemoryGrowthCap = PlayerSettings.WebGL.memoryGeometricGrowthCap;
        bool webGlGeometricMemoryGrowthCapChanged =
            originalWebGlGeometricMemoryGrowthCap != WebGlGeometricMemoryGrowthCapInMegabytes;
        InsecureHttpOption originalInsecureHttpOption = PlayerSettings.insecureHttpOption;
        bool insecureHttpOptionChanged = originalInsecureHttpOption != InsecureHttpOptionForBuild;
        try
        {
            if (bundleVersionChanged)
            {
                PlayerSettings.bundleVersion = releaseId;
            }
            if (webGlDataCachingChanged)
            {
                // 在 BuildPipeline.BuildPlayer（构建管线）调用前写入关闭状态，使输出的网页包不会启用旧资源持久化缓存。
                // 此处不删除浏览器中已经存在的缓存；用户可通过浏览器清理站点数据回收此前发布包占用的空间。
                PlayerSettings.WebGL.dataCaching = EnableWebGlDataCachingForBuild;
            }
            if (webGlInitialMemorySizeChanged)
            {
                // 即使编辑器本地配置被临时改动，构建产物仍固定使用经过内置浏览器实测调整后的启动内存基线。
                // 几何增长模式继续由项目配置维持，避免在构建代码中引入与编辑器枚举版本绑定的重复定义。
                PlayerSettings.WebGL.initialMemorySize = InitialWebGlMemorySizeInMegabytes;
            }
            if (webGlMaximumMemorySizeChanged)
            {
                // 上限只约束自动增长的最高值，不会使播放器在启动时立即申请 768MB。
                PlayerSettings.WebGL.maximumMemorySize = MaximumWebGlMemorySizeInMegabytes;
            }
            if (webGlGeometricMemoryGrowthCapChanged)
            {
                // 几何增长单次最多增加 64MB，限制突发扩容对嵌入浏览器和外层页面的内存冲击。
                PlayerSettings.WebGL.memoryGeometricGrowthCap = WebGlGeometricMemoryGrowthCapInMegabytes;
            }
            if (insecureHttpOptionChanged)
            {
                // 该设置会被 Unity 编译进 WebGL 运行时，必须在 BuildPipeline.BuildPlayer 之前写入；
                // 仅修改发布服务的响应头或浏览器地址无法解除 Unity 自身对 UnityWebRequest 明文 HTTP 的拒绝。
                PlayerSettings.insecureHttpOption = InsecureHttpOptionForBuild;
            }

            string absoluteOutputPath = Path.GetFullPath(outputPath);
            Directory.CreateDirectory(absoluteOutputPath);
            // 先生成资产包和文本清单，再让播放器在裁剪阶段读取该清单，保留只存在于业务场景包中的控制器类型。
            // 若此步骤失败，正式构建仍停留在暂存目录，不会覆盖任何已发布版本。
            PowerPlantSceneBundleBuild.BuildSceneBundles(outputPath, releaseId);
            PowerPlantProcessDetailBundleBuild.BuildProcessDetailBundles(outputPath, releaseId);
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

            WriteProtocolCompatibilityMetadata(absoluteOutputPath, releaseId);

            Console.WriteLine(
                $"WebGL{(isDevelopmentBuild ? "开发" : "正式")}构建成功：{absoluteOutputPath}；大小 {report.summary.totalSize / (1024f * 1024f):F1} MB；耗时 {report.summary.totalTime}；发布标识 {releaseId}。");
        }
        finally
        {
            if (bundleVersionChanged)
            {
                PlayerSettings.bundleVersion = originalBundleVersion;
            }
            if (webGlDataCachingChanged)
            {
                // 构建专属设置在成功、失败和异常退出路径均恢复，避免影响用户下一次在编辑器中的手工测试配置。
                PlayerSettings.WebGL.dataCaching = originalWebGlDataCaching;
            }
            if (webGlInitialMemorySizeChanged)
            {
                // 与离线缓存相同，构建后恢复编辑器会话的临时值；版本库中的项目基线仍固定为 256MB。
                PlayerSettings.WebGL.initialMemorySize = originalWebGlInitialMemorySize;
            }
            if (webGlMaximumMemorySizeChanged)
            {
                // 还原调用前的编辑器会话配置，避免构建脚本在异常退出后改变用户未提交的本地设置。
                PlayerSettings.WebGL.maximumMemorySize = originalWebGlMaximumMemorySize;
            }
            if (webGlGeometricMemoryGrowthCapChanged)
            {
                // 还原单次增长封顶；持久化项目基线由 ProjectSettings.asset（项目设置文件）统一保存。
                PlayerSettings.WebGL.memoryGeometricGrowthCap = originalWebGlGeometricMemoryGrowthCap;
            }
            if (insecureHttpOptionChanged)
            {
                // 构建专属的 HTTP 访问策略只属于输出产物；无论成功、失败还是异常退出路径，都恢复编辑器会话原值。
                PlayerSettings.insecureHttpOption = originalInsecureHttpOption;
            }
        }
    }

    /// <summary>
    /// 元数据仅在播放器成功后生成，并与发布标识绑定；正式目录移动会把它与对应 Unity 文件原子固化。
    /// UTF-8 无字节顺序标记便于网页构建脚本跨平台读取，也避免本地默认编码改变 JSON 内容。
    /// </summary>
    private static void WriteProtocolCompatibilityMetadata(string absoluteOutputPath, string releaseId)
    {
        WebGlProtocolCompatibilityMetadata metadata = new WebGlProtocolCompatibilityMetadata
        {
            schemaVersion = WebGlProtocolContract.MetadataSchemaVersion,
            unityReleaseId = releaseId,
            channel = WebGlProtocolContract.Channel,
            protocolVersion = WebGlProtocolContract.ProtocolVersion,
            commandCapabilities = WebGlProtocolContract.CreateCommandCapabilities(),
            eventCapabilities = WebGlProtocolContract.CreateEventCapabilities(),
            sceneChangedSchemaVersion = WebGlProtocolContract.SceneChangedSchemaVersion,
            sceneChangedRequiredFields = WebGlProtocolContract.CreateSceneChangedRequiredFields(),
            switchSceneRequiredFields = WebGlProtocolContract.CreateSwitchSceneRequiredFields(),
            switchSceneRecoverySchemaVersion = WebGlProtocolContract.SwitchSceneRecoverySchemaVersion,
            switchSceneRecoveryRequiredFields = WebGlProtocolContract.CreateSwitchSceneRecoveryRequiredFields(),
            setNodeVisualStateSchemaVersion = WebGlProtocolContract.SetNodeVisualStateSchemaVersion,
            setNodeVisualStateRequiredFields = WebGlProtocolContract.CreateSetNodeVisualStateRequiredFields(),
            clearNodeVisualStateSchemaVersion = WebGlProtocolContract.ClearNodeVisualStateSchemaVersion,
            clearNodeVisualStateRequiredFields = WebGlProtocolContract.CreateClearNodeVisualStateRequiredFields(),
            processDetailCommandSchemaVersion = WebGlProtocolContract.ProcessDetailCommandSchemaVersion,
            prepareProcessDetailRequiredFields = WebGlProtocolContract.CreatePrepareProcessDetailRequiredFields(),
            commitProcessDetailRequiredFields = WebGlProtocolContract.CreateCommitProcessDetailRequiredFields(),
            abortProcessDetailRequiredFields = WebGlProtocolContract.CreateAbortProcessDetailRequiredFields(),
            enterProcessDetailRequiredFields = WebGlProtocolContract.CreateEnterProcessDetailRequiredFields(),
            exitProcessDetailRequiredFields = WebGlProtocolContract.CreateExitProcessDetailRequiredFields(),
            setProcessDetailPlaybackRequiredFields = WebGlProtocolContract.CreateSetProcessDetailPlaybackRequiredFields()
        };
        string metadataPath = Path.Combine(absoluteOutputPath, WebGlProtocolContract.MetadataFileName);
        File.WriteAllText(metadataPath, JsonUtility.ToJson(metadata, true), new UTF8Encoding(false));
    }

    /// <summary>
    /// 构建设置登记 Bootstrap、独立 Overview 和九个业务场景；业务目录校验仍只读取九个业务场景。
    /// 主播放器仍只嵌入 Bootstrap，Overview 与业务场景统一通过场景资源包按需加载。
    /// </summary>
    private static void ValidateBuildSettings()
    {
        EditorBuildSettingsScene[] buildScenes = EditorBuildSettings.scenes;
        int expectedBuildSceneCount = BusinessSceneCatalog.GetRequiredSceneIds().Count + 2;
        if (buildScenes == null || buildScenes.Length != expectedBuildSceneCount ||
            !buildScenes[0].enabled || !string.Equals(buildScenes[0].path, BootstrapScenePath, StringComparison.Ordinal) ||
            !buildScenes[1].enabled || !string.Equals(buildScenes[1].path, OverviewSceneCatalog.OverviewScenePath, StringComparison.Ordinal))
        {
            throw new BuildFailedException("构建设置必须依次登记 Bootstrap、Overview 和完整九个业务场景。");
        }

        int enabledNonBootstrapSceneCount = buildScenes.Count(scene =>
            scene.enabled &&
            !string.Equals(scene.path, BootstrapScenePath, StringComparison.Ordinal));
        if (enabledNonBootstrapSceneCount != expectedBuildSceneCount - 1)
        {
            throw new BuildFailedException("构建设置中的 Overview 或业务场景数量不完整，不能构建资源包。");
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
