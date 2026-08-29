using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 统一生成九个业务空场景、启动场景、目录资产和构建场景顺序。
/// 映射表来自当前任务中确认的固定九场景，不从模型名称、旧 SampleScene 或文件扫描推断；
/// 生成器只允许首次创建，发现部分既有资产会立即失败，避免覆盖用户后续编辑的业务场景。
/// </summary>
public static class BusinessSceneBootstrapGenerator
{
    private const string CatalogAssetPath = "Assets/Configuration/BusinessSceneCatalog.asset";
    private const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";
    private const string LegacyGasScenePath = "Assets/Scenes/SampleScene.unity";

    /// <summary>
    /// 九项数组既是唯一映射来源，也是构建登记顺序。场景键使用对外稳定 sceneId，
    /// 而文件名使用可读的 PascalCase 业务名，二者的差异必须经由目录资产显式关联。
    /// </summary>
    private static readonly SceneDefinition[] BusinessScenes =
    {
        new SceneDefinition(
            "coal-power",
            "Assets/Scenes/Business/CoalPower.unity",
            // 燃煤场景已交付显式模型绑定，能力清单与燃气场景保持同一套受控接口；路径流仍未确认。
            BusinessSceneCapability.Initialize |
            BusinessSceneCapability.EnterProcessStep |
            BusinessSceneCapability.FocusNode |
            BusinessSceneCapability.ClearSelection |
            BusinessSceneCapability.UpdateNodeVisualState |
            BusinessSceneCapability.ClearNodeVisualState |
            BusinessSceneCapability.SetNodeVisibility |
            BusinessSceneCapability.ResetScene |
            BusinessSceneCapability.Release,
            false),
        new SceneDefinition(
            "gas-power",
            "Assets/Scenes/Business/GasPower.unity",
            BusinessSceneCapability.Initialize |
            BusinessSceneCapability.EnterProcessStep |
            BusinessSceneCapability.FocusNode |
            BusinessSceneCapability.ClearSelection |
            // 燃气场景的四态能力由运行时显式登记三台真实模型后再次校验；
            // 目录提前声明用于让场景解析器核对预期能力，适配器仍会在登记失败时拒绝命令。
            BusinessSceneCapability.UpdateNodeVisualState |
            BusinessSceneCapability.ClearNodeVisualState |
            BusinessSceneCapability.SetNodeVisibility |
            BusinessSceneCapability.ResetScene |
            BusinessSceneCapability.Release,
            false),
        new SceneDefinition("wind-power", "Assets/Scenes/Business/WindPower.unity", BusinessSceneCapability.Release, true),
        new SceneDefinition("solar-power", "Assets/Scenes/Business/SolarPower.unity", BusinessSceneCapability.Release, true),
        new SceneDefinition("substation", "Assets/Scenes/Business/Substation.unity", BusinessSceneCapability.Release, true),
        new SceneDefinition("distribution", "Assets/Scenes/Business/Distribution.unity", BusinessSceneCapability.Release, true),
        new SceneDefinition("consumption", "Assets/Scenes/Business/Consumption.unity", BusinessSceneCapability.Release, true),
        new SceneDefinition("microgrid", "Assets/Scenes/Business/Microgrid.unity", BusinessSceneCapability.Release, true),
        new SceneDefinition("dispatch", "Assets/Scenes/Business/Dispatch.unity", BusinessSceneCapability.Release, true)
    };

    /// <summary>
    /// 供菜单和无界面命令行共用的唯一生成入口。
    /// 首次运行会创建全部资产；后续运行只校验既有资产并重建构建设置，绝不重写场景文件。
    /// </summary>
    [MenuItem("Tools/WebDLPro/场景配置/创建九个业务空场景与映射")]
    public static void CreateOrValidateBusinessSceneBootstrap()
    {
        bool allAssetsExist = AreAllGeneratedAssetsPresent();
        bool anyAssetsExist = AnyGeneratedAssetExists();
        if (anyAssetsExist && !allAssetsExist)
        {
            throw new InvalidOperationException(
                "检测到九场景生成资产不完整。为防止覆盖已有编辑内容，生成器不会继续写入；请先恢复缺失资产后再执行。");
        }

        if (!allAssetsExist)
        {
            EnsureFolder("Assets/Configuration");
            EnsureFolder("Assets/Scenes/Business");

            MigrateLegacyGasScene();
            BusinessSceneCatalog catalog = CreateCatalogAsset();
            CreateBootstrapScene(catalog);
            for (int index = 0; index < BusinessScenes.Length; index++)
            {
                if (BusinessScenes[index].ShouldCreatePlaceholder)
                {
                    CreateBusinessPlaceholderScene(BusinessScenes[index]);
                }
            }
        }

        ConfigureBuildScenes();
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        ValidateGeneratedAssets();
        Debug.Log("九个业务空场景、启动场景、目录映射和构建设置已就绪。");
    }

    /// <summary>
    /// 正式目录资产保存 sceneId、unitySceneKey 与场景路径的一对一关系。
    /// 空场景已具备可加载文件，因此登记为 Available；八个占位场景只声明幂等 Release，
    /// 燃气场景能力严格复用已核对的适配器声明，其他业务能力只能由后续控制器任务补充。
    /// </summary>
    private static BusinessSceneCatalog CreateCatalogAsset()
    {
        BusinessSceneCatalog catalog = ScriptableObject.CreateInstance<BusinessSceneCatalog>();
        List<BusinessSceneCatalogEntry> entries = new List<BusinessSceneCatalogEntry>(BusinessScenes.Length);
        for (int index = 0; index < BusinessScenes.Length; index++)
        {
            SceneDefinition definition = BusinessScenes[index];
            entries.Add(new BusinessSceneCatalogEntry(
                definition.SceneId,
                definition.UnitySceneKey,
                definition.ScenePath,
                BusinessSceneAvailability.Available,
                definition.DeclaredCapabilities));
        }

        catalog.SetEntriesForEditor(entries);
        AssetDatabase.CreateAsset(catalog, CatalogAssetPath);
        return catalog;
    }

    /// <summary>
    /// 启动场景只放置跨场景常驻服务，不放业务模型、相机、灯光或业务控制器。
    /// 协调器序列化引用目录资产，因此运行时不会按文件名猜测场景，而是始终从正式映射查找。
    /// </summary>
    private static void CreateBootstrapScene(BusinessSceneCatalog catalog)
    {
        Scene bootstrapScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        GameObject runtimeRoot = new GameObject("BootstrapRuntime");
        runtimeRoot.AddComponent<LoadingOverlayController>();
        // 资产包加载器只在发布 WebGL 中下载九个业务场景；编辑器仍按正式目录直接加载，
        // 因此启动场景保持轻量且不会把业务重资源放入首屏玩家数据。
        runtimeRoot.AddComponent<SceneBundleRuntimeLoader>();
        MultiSceneCoordinator coordinator = runtimeRoot.AddComponent<MultiSceneCoordinator>();
        coordinator.SetSceneCatalogForEditor(catalog);
        runtimeRoot.AddComponent<UnityIframeBridgeManager>();
        EditorSceneManager.SaveScene(bootstrapScene, BootstrapScenePath, false);
    }

    /// <summary>
    /// 每个业务场景仅创建一个显式占位根对象。占位控制器会在切换时结构化报告内容尚未交付，
    /// 这样后续人员可直接在对应场景补充模型与正式控制器，而不会因空场景产生静默成功。
    /// </summary>
    private static void CreateBusinessPlaceholderScene(SceneDefinition definition)
    {
        Scene businessScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        GameObject runtimeRoot = new GameObject("BusinessSceneRuntime");
        UnavailableBusinessSceneController placeholder = runtimeRoot.AddComponent<UnavailableBusinessSceneController>();
        placeholder.ConfigureForGeneratedScene(definition.SceneId);
        EditorSceneManager.SaveScene(businessScene, definition.ScenePath, false);
    }

    /// <summary>
    /// 用户已确认旧 SampleScene 就是燃气发电的真实场景，因此只移动资产路径并保留原 GUID、YAML 和全部未提交内容。
    /// 迁移失败时立即抛错；不会复制、重建或修改旧燃气场景内部对象，避免破坏用户正在调整的模型与材质。
    /// </summary>
    private static void MigrateLegacyGasScene()
    {
        SceneDefinition gasPower = BusinessScenes[1];
        if (File.Exists(ToAbsolutePath(gasPower.ScenePath)))
        {
            return;
        }
        if (!File.Exists(ToAbsolutePath(LegacyGasScenePath)))
        {
            throw new InvalidOperationException("未找到用户确认的燃气旧场景 SampleScene，不能创建或猜测替代燃气场景。");
        }

        string moveError = AssetDatabase.MoveAsset(LegacyGasScenePath, gasPower.ScenePath);
        if (!string.IsNullOrEmpty(moveError))
        {
            throw new InvalidOperationException($"燃气场景改名失败：{moveError}");
        }
    }

    /// <summary>
    /// 构建索引零固定为 Bootstrap，其后九项与目录数组同序，确保运行时首次场景是轻量启动壳。
    /// 旧 SampleScene 资产不会被删除；它不再进入正式构建，避免未映射的旧燃气内容误作为业务场景发布。
    /// </summary>
    private static void ConfigureBuildScenes()
    {
        List<EditorBuildSettingsScene> buildScenes = new List<EditorBuildSettingsScene>(BusinessScenes.Length + 1)
        {
            new EditorBuildSettingsScene(BootstrapScenePath, true)
        };
        for (int index = 0; index < BusinessScenes.Length; index++)
        {
            buildScenes.Add(new EditorBuildSettingsScene(BusinessScenes[index].ScenePath, true));
        }

        EditorBuildSettings.scenes = buildScenes.ToArray();
    }

    /// <summary>
    /// 生成前先全量检查，避免“已创建前半部分又覆盖后半部分”的不可恢复状态。
    /// 文件检测只判断本生成器的明确目标路径，不扫描或解释任何用户资源。
    /// </summary>
    private static bool AnyGeneratedAssetExists()
    {
        if (File.Exists(ToAbsolutePath(BootstrapScenePath)) || File.Exists(ToAbsolutePath(CatalogAssetPath)))
        {
            return true;
        }
        for (int index = 0; index < BusinessScenes.Length; index++)
        {
            if (File.Exists(ToAbsolutePath(BusinessScenes[index].ScenePath)))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>只有启动场景、目录资产和九个业务场景全部存在时，才允许走无覆盖校验分支。</summary>
    private static bool AreAllGeneratedAssetsPresent()
    {
        if (!File.Exists(ToAbsolutePath(BootstrapScenePath)) || !File.Exists(ToAbsolutePath(CatalogAssetPath)))
        {
            return false;
        }
        for (int index = 0; index < BusinessScenes.Length; index++)
        {
            if (!File.Exists(ToAbsolutePath(BusinessScenes[index].ScenePath)))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// 生成完成后复用目录的运行时校验，并额外断言启动场景与所有业务文件确实可被编辑器发现。
    /// 失败会阻止构建设置继续作为有效结果，避免仅写入半份映射。
    /// </summary>
    private static void ValidateGeneratedAssets()
    {
        BusinessSceneCatalog catalog = AssetDatabase.LoadAssetAtPath<BusinessSceneCatalog>(CatalogAssetPath);
        if (catalog == null)
        {
            throw new InvalidOperationException("未能加载正式九场景目录资产。");
        }
        IReadOnlyList<BusinessSceneCatalogValidationIssue> issues = catalog.ValidateForRuntime();
        if (issues.Count > 0)
        {
            throw new InvalidOperationException($"正式九场景目录校验失败：{issues[0].Code}，{issues[0].Message}");
        }
        if (AssetDatabase.LoadAssetAtPath<SceneAsset>(BootstrapScenePath) == null)
        {
            throw new InvalidOperationException("未能加载 Bootstrap 启动场景。");
        }
        for (int index = 0; index < BusinessScenes.Length; index++)
        {
            SceneDefinition definition = BusinessScenes[index];
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(definition.ScenePath) == null ||
                !catalog.TryGetBySceneId(definition.SceneId, out BusinessSceneCatalogEntry entry) ||
                !string.Equals(entry.UnitySceneKey, definition.UnitySceneKey, StringComparison.Ordinal) ||
                !string.Equals(entry.ScenePath, definition.ScenePath, StringComparison.Ordinal) ||
                entry.DeclaredCapabilities != definition.DeclaredCapabilities)
            {
                throw new InvalidOperationException($"场景 {definition.SceneId} 的正式映射不完整或不一致。");
            }
        }
    }

    /// <summary>按资产路径逐段创建目录，避免依赖操作系统路径分隔符或命令行目录副作用。</summary>
    private static void EnsureFolder(string assetPath)
    {
        if (AssetDatabase.IsValidFolder(assetPath))
        {
            return;
        }

        string parentPath = Path.GetDirectoryName(assetPath)?.Replace('\\', '/');
        string folderName = Path.GetFileName(assetPath);
        if (string.IsNullOrWhiteSpace(parentPath) || string.IsNullOrWhiteSpace(folderName) || !AssetDatabase.IsValidFolder(parentPath))
        {
            throw new InvalidOperationException($"无法创建资产目录：{assetPath}。");
        }
        AssetDatabase.CreateFolder(parentPath, folderName);
    }

    /// <summary>把 Unity 资产路径转换为项目绝对路径，文件存在性检查不会受当前工作目录影响。</summary>
    private static string ToAbsolutePath(string assetPath)
    {
        return Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), assetPath));
    }

    /// <summary>固定映射单元避免并行数组错位；场景键明示等于当前确认的稳定 sceneId。</summary>
    private sealed class SceneDefinition
    {
        public string SceneId { get; }
        public string UnitySceneKey { get; }
        public string ScenePath { get; }
        public BusinessSceneCapability DeclaredCapabilities { get; }
        public bool ShouldCreatePlaceholder { get; }

        public SceneDefinition(
            string sceneId,
            string scenePath,
            BusinessSceneCapability declaredCapabilities,
            bool shouldCreatePlaceholder)
        {
            SceneId = sceneId;
            UnitySceneKey = sceneId;
            ScenePath = scenePath;
            DeclaredCapabilities = declaredCapabilities;
            ShouldCreatePlaceholder = shouldCreatePlaceholder;
        }
    }
}
