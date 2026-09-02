using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 验证首次创建的真实资产，而非仅验证内存夹具。
    /// 该测试覆盖构建顺序、目录映射、启动服务、燃气资产迁移、燃煤模型绑定和其余业务场景轻量占位边界，
    /// 防止未来场景编辑时意外把旧 SampleScene 或重资源重新带回启动路径。
    /// </summary>
    public sealed class BusinessSceneBootstrapAssetTests
    {
        private const string CatalogAssetPath = "Assets/Configuration/BusinessSceneCatalog.asset";
        private const string OverviewCatalogAssetPath = "Assets/Configuration/OverviewSceneCatalog.asset";
        private const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";

        // 总览场景路径用于校验构建顺序、总览目录映射及九个建筑占位是否正确接线。
        private const string OverviewScenePath = "Assets/Scenes/Overview/Overview.unity";

        // 合并外壳预制体与演示场景路径用于同时验证源预制体和场景实例的粒子排气配置。
        private const string WaiKeHeBingPrefabPath = "Assets/Art/C4D项目/WaiKeHeBing_AnimationDemo.prefab";
        private const string ShowTestScenePath = "Assets/Scenes/ShowTest/ShowTest.unity";
        private const string ExistingGasSceneGuid = "99c9720ab356a0642a771bea13969a05";

        private static readonly string[] SceneIds =
        {
            "coal-power", "gas-power", "wind-power", "solar-power", "substation",
            "distribution", "consumption", "microgrid", "dispatch"
        };

        private static readonly string[] ScenePaths =
        {
            "Assets/Scenes/Business/CoalPower.unity",
            "Assets/Scenes/Business/GasPower.unity",
            "Assets/Scenes/Business/WindPower.unity",
            "Assets/Scenes/Business/SolarPower.unity",
            "Assets/Scenes/Business/Substation.unity",
            "Assets/Scenes/Business/Distribution.unity",
            "Assets/Scenes/Business/Consumption.unity",
            "Assets/Scenes/Business/Microgrid.unity",
            "Assets/Scenes/Business/Dispatch.unity"
        };

        /// <summary>
        /// 目录资产必须包含固定九项、唯一场景键和明确路径；七个空场景只支持幂等释放，
        /// 燃气和燃煤能力严格与当前适配器一致，后续新增场景能力时必须连同目录能力位一起修改。
        /// </summary>
        [Test]
        public void 正式目录完整映射九个业务场景()
        {
            BusinessSceneCatalog catalog = AssetDatabase.LoadAssetAtPath<BusinessSceneCatalog>(CatalogAssetPath);

            Assert.That(catalog, Is.Not.Null);
            Assert.That(catalog.ValidateForRuntime(), Is.Empty);
            Assert.That(catalog.Entries, Has.Count.EqualTo(SceneIds.Length));
            for (int index = 0; index < SceneIds.Length; index++)
            {
                Assert.That(catalog.TryGetBySceneId(SceneIds[index], out BusinessSceneCatalogEntry entry), Is.True);
                Assert.That(entry.UnitySceneKey, Is.EqualTo(SceneIds[index]));
                Assert.That(entry.ScenePath, Is.EqualTo(ScenePaths[index]));
                bool isConfiguredPowerPlant = SceneIds[index] == "gas-power" || SceneIds[index] == "coal-power";
                BusinessSceneCapability expectedCapabilities = isConfiguredPowerPlant
                    ? BusinessSceneCapability.Initialize |
                       BusinessSceneCapability.EnterProcessStep |
                       BusinessSceneCapability.FocusNode |
                       BusinessSceneCapability.ClearSelection |
                       BusinessSceneCapability.UpdateNodeVisualState |
                       BusinessSceneCapability.ClearNodeVisualState |
                       BusinessSceneCapability.MoveCameraToPose |
                       BusinessSceneCapability.SetNodeVisibility |
                      BusinessSceneCapability.ResetScene |
                      BusinessSceneCapability.Release
                    : BusinessSceneCapability.Release;
                Assert.That(entry.DeclaredCapabilities, Is.EqualTo(expectedCapabilities));
                Assert.That(AssetDatabase.LoadAssetAtPath<SceneAsset>(entry.ScenePath), Is.Not.Null);
            }
        }

        /// <summary>
        /// 构建第一项必须是轻量 Bootstrap，第二项是独立 Overview，后续九项必须与业务目录次序一致。
        /// Overview 不计入固定九项业务目录，但必须进入编辑器构建场景清单。
        /// </summary>
        [Test]
        public void 构建顺序区分启动总览和九个业务场景()
        {
            EditorBuildSettingsScene[] buildScenes = EditorBuildSettings.scenes;

            Assert.That(buildScenes, Has.Length.EqualTo(ScenePaths.Length + 2));
            Assert.That(buildScenes[0].enabled, Is.True);
            Assert.That(buildScenes[0].path, Is.EqualTo(BootstrapScenePath));
            Assert.That(buildScenes[1].enabled, Is.True);
            Assert.That(buildScenes[1].path, Is.EqualTo(OverviewScenePath));
            for (int index = 0; index < ScenePaths.Length; index++)
            {
                Assert.That(buildScenes[index + 2].enabled, Is.True);
                Assert.That(buildScenes[index + 2].path, Is.EqualTo(ScenePaths[index]));
            }
        }

        private static string ToPascalCase(string sceneId)
        {
            string[] words = sceneId.Split('-');
            System.Text.StringBuilder builder = new System.Text.StringBuilder(sceneId.Length);
            for (int wordIndex = 0; wordIndex < words.Length; wordIndex++)
            {
                if (string.IsNullOrEmpty(words[wordIndex]))
                {
                    continue;
                }

                builder.Append(char.ToUpperInvariant(words[wordIndex][0]));
                if (words[wordIndex].Length > 1)
                {
                    builder.Append(words[wordIndex], 1, words[wordIndex].Length - 1);
                }
            }

            return builder.ToString();
        }

        /// <summary>旧测试名保留为兼容入口，实际断言由新的分层构建顺序测试覆盖。</summary>
        [Test]
        public void 构建顺序以启动场景和九个业务场景组成()
        {
            构建顺序区分启动总览和九个业务场景();
        }

        [Test]
        public void 独立总览目录和九个内置建筑占位已接线()
        {
            OverviewSceneCatalog catalog = AssetDatabase.LoadAssetAtPath<OverviewSceneCatalog>(OverviewCatalogAssetPath);
            Assert.That(catalog, Is.Not.Null);
            Assert.That(catalog.ValidateForRuntime(), Is.Empty);
            Assert.That(catalog.Entry.SceneId, Is.EqualTo(OverviewSceneCatalog.OverviewSceneId));
            Assert.That(catalog.Entry.ScenePath, Is.EqualTo(OverviewScenePath));

            Scene overviewScene = EditorSceneManager.OpenScene(OverviewScenePath, OpenSceneMode.Additive);
            try
            {
                GameObject[] roots = overviewScene.GetRootGameObjects();
                OverviewBuildingPlaceholder[] buildings = roots[0].GetComponentsInChildren<OverviewBuildingPlaceholder>(true);
                Assert.That(buildings, Has.Length.EqualTo(9));
                Dictionary<string, string> replacedModelNames = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    { "coal-power", "燃煤" },
                    { "gas-power", "燃气发电站" },
                    { "wind-power", "风力发电站" },
                    { "solar-power", "光伏发电站" },
                    { "substation", "升压站" },
                    { "distribution", "配电站" }
                };
                for (int index = 0; index < SceneIds.Length; index++)
                {
                    OverviewBuildingPlaceholder building = Array.Find(
                        buildings,
                        candidate => candidate != null && candidate.TargetSceneId == SceneIds[index]);
                    Assert.That(building, Is.Not.Null, $"总览缺少目标场景映射：{SceneIds[index]}");
                    Assert.That(building.OverviewBuildingId, Is.EqualTo($"overview-building.{SceneIds[index]}"));
                    Assert.That(building.name, Is.EqualTo($"OverviewBuilding_{ToPascalCase(SceneIds[index])}"));

                    if (!replacedModelNames.TryGetValue(SceneIds[index], out string expectedModelName))
                    {
                        continue;
                    }

                    // 六个已交付沙盘模型保留稳定代理节点，但渲染和点击必须切换到其真实子模型。
                    Assert.That(building.TargetRenderer, Is.Not.Null);
                    Assert.That(building.TargetRenderer.gameObject.name, Is.EqualTo(expectedModelName));
                    Assert.That(building.TargetRenderer.transform.IsChildOf(building.transform), Is.True);
                    Assert.That(building.InteractionCollider, Is.Not.Null);
                    Assert.That(building.InteractionCollider.gameObject, Is.SameAs(building.TargetRenderer.gameObject));
                    MeshRenderer placeholderRenderer = building.GetComponent<MeshRenderer>();
                    Assert.That(
                        placeholderRenderer == null || !placeholderRenderer.enabled,
                        Is.True,
                        "旧占位方块渲染器必须已移除或停用。 ");
                    BoxCollider placeholderCollider = building.GetComponent<BoxCollider>();
                    Assert.That(
                        placeholderCollider == null || !placeholderCollider.enabled,
                        Is.True,
                        "旧占位方块碰撞体必须已移除或停用。 ");
                }
                OverviewSceneController overviewController = roots[0].GetComponent<OverviewSceneController>();
                Assert.That(overviewController, Is.Not.Null);
                // 总览初始化会在场景加载事务内立即使用该序列化相机，不能依赖运行时按名称查找。
                // 直接读取序列化属性可在 WebGL 构建前阻断“场景中有相机但控制器未绑定”的配置回归。
                SerializedProperty interactionCameraProperty =
                    new SerializedObject(overviewController).FindProperty("_interactionCamera");
                Assert.That(interactionCameraProperty, Is.Not.Null);
                Assert.That(interactionCameraProperty.objectReferenceValue, Is.TypeOf<Camera>());
                Assert.That(
                    ((Camera)interactionCameraProperty.objectReferenceValue).gameObject.scene,
                    Is.EqualTo(overviewScene),
                    "总览交互相机必须显式绑定到当前总览场景，不能引用外部场景对象。");
                // 只统计启用渲染器：地面一个、六个真实模型、三个尚未替换的占位模型，共十个。
                // 已替换代理的旧渲染器允许直接移除或停用，不再用组件总数约束合法清理方式。
                Renderer[] overviewRenderers = roots[0].GetComponentsInChildren<Renderer>(true);
                int enabledRendererCount = 0;
                for (int rendererIndex = 0; rendererIndex < overviewRenderers.Length; rendererIndex++)
                {
                    if (overviewRenderers[rendererIndex].enabled)
                    {
                        enabledRendererCount++;
                    }
                }
                Assert.That(enabledRendererCount, Is.EqualTo(10));
            }
            finally
            {
                EditorSceneManager.CloseScene(overviewScene, true);
            }
        }

        /// <summary>
        /// 总览场景切换会在初始化首帧读取交互相机；该专项资产测试独立于模型渲染器断言，
        /// 确保即使沙盘模型正在调整，也能稳定阻止空相机引用被构建为 WebGL 发布包。
        /// </summary>
        [Test]
        public void 总览控制器显式绑定当前场景交互相机()
        {
            Scene overviewScene = EditorSceneManager.OpenScene(OverviewScenePath, OpenSceneMode.Additive);
            try
            {
                GameObject[] roots = overviewScene.GetRootGameObjects();
                OverviewSceneController overviewController = null;
                for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
                {
                    overviewController = roots[rootIndex].GetComponent<OverviewSceneController>();
                    if (overviewController != null)
                    {
                        break;
                    }
                }

                Assert.That(overviewController, Is.Not.Null, "总览场景必须存在唯一运行时控制器。");
                SerializedProperty interactionCameraProperty =
                    new SerializedObject(overviewController).FindProperty("_interactionCamera");
                Assert.That(interactionCameraProperty, Is.Not.Null);
                Assert.That(interactionCameraProperty.objectReferenceValue, Is.TypeOf<Camera>());
                Assert.That(
                    ((Camera)interactionCameraProperty.objectReferenceValue).gameObject.scene,
                    Is.EqualTo(overviewScene),
                    "总览交互相机必须序列化绑定到当前场景，不能在运行时按名称补查。");
            }
            finally
            {
                EditorSceneManager.CloseScene(overviewScene, true);
            }
        }
        /// <summary>
        /// 六个真实沙盘模型必须至少存在一条从交互相机指向真实模型表面的有效选择射线。
        /// 其中升压站使用静态网格碰撞体，避免其跨越大片空白区域的包围盒抢先遮挡光伏电站。
        /// </summary>
        [Test]
        public void 六个真实沙盘模型均可解析到显式目标场景且互不遮挡()
        {
            Scene overviewScene = EditorSceneManager.OpenScene(OverviewScenePath, OpenSceneMode.Additive);
            try
            {
                GameObject runtimeRoot = Array.Find(
                    overviewScene.GetRootGameObjects(),
                    root => root.GetComponent<OverviewSceneController>() != null);
                Assert.That(runtimeRoot, Is.Not.Null, "总览场景缺少运行时根节点。 ");

                OverviewSceneController controller = runtimeRoot.GetComponent<OverviewSceneController>();
                SerializedProperty interactionCameraProperty =
                    new SerializedObject(controller).FindProperty("_interactionCamera");
                Camera interactionCamera = interactionCameraProperty.objectReferenceValue as Camera;
                Assert.That(interactionCamera, Is.Not.Null, "总览场景缺少已绑定交互相机。 ");

                BusinessSceneCommandResult initializationResult = default;
                System.Collections.IEnumerator initialization = controller.InitializeAsync(
                    new BusinessSceneInitializationContext(
                        OverviewSceneCatalog.OverviewSceneId,
                        OverviewSceneCatalog.OverviewSceneId,
                        "transition.overview-real-model-pick-test",
                        false),
                    result => initializationResult = result);
                while (initialization.MoveNext())
                {
                }
                Assert.That(initializationResult.Success, Is.True, initializationResult.Message);
                Physics.SyncTransforms();

                string[] realModelSceneIds =
                {
                    "coal-power", "gas-power", "wind-power", "solar-power", "substation", "distribution"
                };
                OverviewBuildingPlaceholder[] buildings =
                    runtimeRoot.GetComponentsInChildren<OverviewBuildingPlaceholder>(true);
                for (int sceneIndex = 0; sceneIndex < realModelSceneIds.Length; sceneIndex++)
                {
                    string expectedSceneId = realModelSceneIds[sceneIndex];
                    OverviewBuildingPlaceholder building = Array.Find(
                        buildings,
                        candidate => candidate != null && candidate.TargetSceneId == expectedSceneId);
                    Assert.That(building, Is.Not.Null, $"缺少真实沙盘模型：{expectedSceneId}。 ");
                    Assert.That(
                        TryResolveRealModelSurface(
                            controller,
                            interactionCamera,
                            building,
                            out string resolvedBuildingId,
                            out string resolvedSceneId),
                        Is.True,
                        $"真实沙盘模型无法通过自身表面射线解析：{expectedSceneId}。 ");
                    Assert.That(resolvedBuildingId, Is.EqualTo($"overview-building.{expectedSceneId}"));
                    Assert.That(resolvedSceneId, Is.EqualTo(expectedSceneId));
                }

                OverviewBuildingPlaceholder substation = Array.Find(
                    buildings,
                    candidate => candidate != null && candidate.TargetSceneId == "substation");
                Assert.That(substation.InteractionCollider, Is.TypeOf<MeshCollider>(),
                    "升压站必须使用真实网格命中，不能让跨空白区域的大包围盒遮挡光伏电站。 ");
                Assert.That(substation.TargetRenderer.GetComponent<BoxCollider>().enabled, Is.False,
                    "升压站旧盒形碰撞体必须停用。 ");
                Assert.That(controller.ReleaseScene().Success, Is.True);
            }
            finally
            {
                EditorSceneManager.CloseScene(overviewScene, true);
            }
        }

        /// <summary>
        /// 优先验证已登记碰撞体中心；网格中心可能位于建筑群空隙，因此网格碰撞体按有限三角面采样。
        /// 此方法只在编辑模式资产门禁中运行，不进入运行时点击热路径。
        /// </summary>
        private static bool TryResolveRealModelSurface(
            OverviewSceneController controller,
            Camera interactionCamera,
            OverviewBuildingPlaceholder building,
            out string overviewBuildingId,
            out string targetSceneId)
        {
            Vector3 cameraPosition = interactionCamera.transform.position;
            Vector3 colliderCenter = building.InteractionCollider.bounds.center;
            if (controller.TryResolveBuilding(
                    new Ray(cameraPosition, (colliderCenter - cameraPosition).normalized),
                    out overviewBuildingId,
                    out targetSceneId,
                    out _) &&
                targetSceneId == building.TargetSceneId)
            {
                return true;
            }

            MeshFilter meshFilter = building.TargetRenderer.GetComponent<MeshFilter>();
            Mesh mesh = meshFilter != null ? meshFilter.sharedMesh : null;
            if (mesh == null)
            {
                overviewBuildingId = string.Empty;
                targetSceneId = string.Empty;
                return false;
            }

            Vector3[] vertices = mesh.vertices;
            int[] triangles = mesh.triangles;
            int triangleCount = triangles.Length / 3;
            // 大型升压站只做最多 512 次均匀采样，资产测试耗时与网格面数解耦。
            int stride = Mathf.Max(1, triangleCount / 512);
            for (int triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += stride)
            {
                int triangleOffset = triangleIndex * 3;
                Vector3 localCenter = (
                    vertices[triangles[triangleOffset]] +
                    vertices[triangles[triangleOffset + 1]] +
                    vertices[triangles[triangleOffset + 2]]) / 3f;
                Vector3 worldCenter = meshFilter.transform.TransformPoint(localCenter);
                if (controller.TryResolveBuilding(
                        new Ray(cameraPosition, (worldCenter - cameraPosition).normalized),
                        out overviewBuildingId,
                        out targetSceneId,
                        out _) &&
                    targetSceneId == building.TargetSceneId)
                {
                    return true;
                }
            }

            overviewBuildingId = string.Empty;
            targetSceneId = string.Empty;
            return false;
        }


        [Test]
        public void 启动场景持有常驻服务和正式目录引用()
        {
            Scene bootstrapScene = EditorSceneManager.OpenScene(BootstrapScenePath, OpenSceneMode.Additive);
            try
            {
                GameObject[] roots = bootstrapScene.GetRootGameObjects();
                Assert.That(roots, Has.Length.EqualTo(1));
                GameObject runtimeRoot = roots[0];
                Assert.That(runtimeRoot.name, Is.EqualTo("BootstrapRuntime"));
                Assert.That(runtimeRoot.GetComponent<LoadingOverlayController>(), Is.Not.Null);
                Assert.That(HasComponentNamed(runtimeRoot, "UnityIframeBridgeManager"), Is.True);
                Assert.That(runtimeRoot.GetComponent<BootstrapOverviewAutoEnterTest>(), Is.Not.Null,
                    "Bootstrap 必须保留仅编辑器执行的自动进入总览联调脚本。 ");

                MultiSceneCoordinator coordinator = runtimeRoot.GetComponent<MultiSceneCoordinator>();
                Assert.That(coordinator, Is.Not.Null);
                SerializedObject coordinatorObject = new SerializedObject(coordinator);
                SerializedProperty catalogProperty = coordinatorObject.FindProperty("_sceneCatalog");
                SerializedProperty overviewCatalogProperty = coordinatorObject.FindProperty("_overviewSceneCatalog");
                Assert.That(catalogProperty.objectReferenceValue, Is.EqualTo(AssetDatabase.LoadAssetAtPath<BusinessSceneCatalog>(CatalogAssetPath)));
                Assert.That(overviewCatalogProperty.objectReferenceValue, Is.EqualTo(AssetDatabase.LoadAssetAtPath<OverviewSceneCatalog>(OverviewCatalogAssetPath)));
            }
            finally
            {
                EditorSceneManager.CloseScene(bootstrapScene, true);
            }
        }

        /// <summary>
        /// 燃气场景必须保留旧场景 GUID，燃煤场景必须保留已导入模型和属性面板控制器；
        /// 其余七个业务文件仅持有一个不带渲染内容的占位根对象。
        /// 占位控制器保留正确 sceneId，却不会实现任何业务能力，从而保障后续编辑人员可逐场景替换真实内容。
        /// </summary>
        [Test]
        public void 燃气和燃煤场景保留真实内容且其余业务场景保持空内容()
        {
            for (int index = 0; index < ScenePaths.Length; index++)
            {
                Scene businessScene = EditorSceneManager.OpenScene(ScenePaths[index], OpenSceneMode.Additive);
                try
                {
                    GameObject[] roots = businessScene.GetRootGameObjects();
                    if (SceneIds[index] == "gas-power")
                    {
                        Assert.That(AssetDatabase.AssetPathToGUID(ScenePaths[index]), Is.EqualTo(ExistingGasSceneGuid));
                        Assert.That(roots, Is.Not.Empty, ScenePaths[index]);
                        Assert.That(ContainsComponentNamed(roots, "PowerPlantProcessController"), Is.True, ScenePaths[index]);
                        continue;
                    }

                    if (SceneIds[index] == "coal-power")
                    {
                        Assert.That(roots, Is.Not.Empty, ScenePaths[index]);
                        Assert.That(ContainsComponentNamed(roots, "PowerPlantProcessController"), Is.True, ScenePaths[index]);
                        Assert.That(ContainsRenderer(roots), Is.True, ScenePaths[index]);
                        Assert.That(ContainsCamera(roots), Is.True, ScenePaths[index]);
                        continue;
                    }

                    Assert.That(roots, Has.Length.EqualTo(1), ScenePaths[index]);
                    Assert.That(roots[0].name, Is.EqualTo("BusinessSceneRuntime"), ScenePaths[index]);
                    UnavailableBusinessSceneController controller = roots[0].GetComponent<UnavailableBusinessSceneController>();
                    Assert.That(controller, Is.Not.Null, ScenePaths[index]);
                    Assert.That(controller.SceneId, Is.EqualTo(SceneIds[index]), ScenePaths[index]);
                    Assert.That(controller.Capabilities, Is.EqualTo(BusinessSceneCapability.Release), ScenePaths[index]);
                    Assert.That(roots[0].GetComponentsInChildren<Renderer>(true), Is.Empty, ScenePaths[index]);
                    Assert.That(roots[0].GetComponentsInChildren<Camera>(true), Is.Empty, ScenePaths[index]);
                    Assert.That(roots[0].GetComponentsInChildren<Light>(true), Is.Empty, ScenePaths[index]);
                }
                finally
                {
                    EditorSceneManager.CloseScene(businessScene, true);
                }
            }
        }

        /// <summary>
        /// 九个真实场景都必须能通过统一注册表解析，且控制器能力与正式目录完全一致。
        /// 燃气和燃煤场景只调用各自适配器已定义的登记方法，不依据改名后的路径或显示名称推断身份；
        /// 其余七个占位场景则验证“仅释放”能力既可被目录识别，又不会放行流程和聚焦命令。
        /// </summary>
        [Test]
        public void 九个场景控制器与正式能力登记严格一致()
        {
            RegisterGasPowerAdapterFactory();
            RegisterCoalPowerAdapterFactory();
            BusinessSceneCatalog catalog = AssetDatabase.LoadAssetAtPath<BusinessSceneCatalog>(CatalogAssetPath);

            for (int index = 0; index < ScenePaths.Length; index++)
            {
                Assert.That(catalog.TryGetBySceneId(SceneIds[index], out BusinessSceneCatalogEntry entry), Is.True);
                Scene businessScene = EditorSceneManager.OpenScene(ScenePaths[index], OpenSceneMode.Additive);
                try
                {
                    if (SceneIds[index] == "gas-power" || SceneIds[index] == "coal-power")
                    {
                        // 编辑器资产测试仅加载场景，不会像播放器那样自动执行 MonoBehaviour.Awake。
                        // 两个发电场景的节点索引和四态登记正是在该生命周期前段建立；这里精确补齐
                        // 这两个与能力声明相关的初始化步骤，使后续目录能力比对验证真实运行时状态。
                        InitializePowerPlantControllerForEditModeInspection(businessScene.GetRootGameObjects());
                    }

                    bool resolved = BusinessSceneControllerRegistry.TryResolve(
                        businessScene,
                        entry,
                        out IBusinessSceneController controller,
                        out string error);
                    Assert.That(resolved, Is.True, error);
                    Assert.That(controller.SceneId, Is.EqualTo(entry.SceneId));
                    Assert.That(controller.Capabilities, Is.EqualTo(entry.DeclaredCapabilities));

                    if (SceneIds[index] != "gas-power" && SceneIds[index] != "coal-power")
                    {
                        BusinessSceneCommandResult focusResult = controller.FocusNode("node.unavailable", true);
                        Assert.That(focusResult.Success, Is.False);
                        Assert.That(focusResult.ErrorCode, Is.EqualTo("capability-unsupported"));
                        Assert.That(controller.ReleaseScene().Success, Is.True);
                        Assert.That(controller.ReleaseScene().Success, Is.True);
                    }
                }
                finally
                {
                    EditorSceneManager.CloseScene(businessScene, true);
                }
            }
        }

        /// <summary>
        /// 燃气业务场景属于第二层，启动时必须保留场景资产中的原始材质。
        /// 历史总览上下文半透明只能由后续明确的兼容命令触发，不能在场景唤醒阶段自动执行。
        /// </summary>
        [Test]
        public void 燃气第二层启动不应用历史总览半透明上下文()
        {
            Scene gasPowerScene = EditorSceneManager.OpenScene(ScenePaths[1], OpenSceneMode.Additive);
            try
            {
                MonoBehaviour controller = FindComponentByTypeName(
                    gasPowerScene.GetRootGameObjects(),
                    "PowerPlantProcessController");
                Assert.That(controller, Is.Not.Null, "燃气场景缺少 PowerPlantProcessController。 ");

                SerializedObject serializedController = new SerializedObject(controller);
                SerializedProperty applyInitialOverviewContext = serializedController.FindProperty(
                    "_applyInitialOverviewContext");
                Assert.That(applyInitialOverviewContext, Is.Not.Null,
                    "控制器缺少第二层启动视觉的显式配置字段。 ");
                Assert.That(applyInitialOverviewContext.boolValue, Is.False,
                    "燃气第二层启动时不能自动将非核心模型切换为历史总览半透明。 ");
            }
            finally
            {
                EditorSceneManager.CloseScene(gasPowerScene, true);
            }
        }

        [Test]
        public void 取消三维选择时必须恢复聚焦上下文半透明材质()
        {
            string sourcePath = Path.Combine(
                Application.dataPath,
                "Scripts",
                "PowerPlant",
                "PowerPlantProcessController.cs");
            string source = File.ReadAllText(sourcePath);
            int clearSelectionIndex = source.IndexOf("public bool TryClearSelection", StringComparison.Ordinal);
            int clearInteractionIndex = source.IndexOf(
                "private void ClearInteractionSelectionFromScenePointer",
                StringComparison.Ordinal);
            Assert.That(clearSelectionIndex, Is.GreaterThanOrEqualTo(0));
            Assert.That(clearInteractionIndex, Is.GreaterThan(clearSelectionIndex));

            string clearSelectionBody = source.Substring(
                clearSelectionIndex,
                clearInteractionIndex - clearSelectionIndex);
            Assert.That(clearSelectionBody, Does.Contain("RestoreAllContextFades();"),
                "拓扑取消选择必须恢复聚焦产生的上下文半透明材质。");

            int nextMethodIndex = source.IndexOf(
                "public bool TryConsumePriorityPointer",
                clearInteractionIndex,
                StringComparison.Ordinal);
            Assert.That(nextMethodIndex, Is.GreaterThan(clearInteractionIndex));
            string clearInteractionBody = source.Substring(
                clearInteractionIndex,
                nextMethodIndex - clearInteractionIndex);
            Assert.That(clearInteractionBody, Does.Contain("RestoreAllContextFades();"),
                "三维空白点击取消选择必须恢复聚焦产生的上下文半透明材质。");
        }

        /// <summary>
        /// 燃气真实模型的四态视觉能力必须在资产层满足运行时登记的全部前置条件。
        /// 此测试故意不引用默认程序集中的燃气控制器类型，而是通过序列化字段读取其已保存的绑定，
        /// 逐项复现运行时的渲染器收集、材质槽校验和跨节点归属校验。这样模型或材质被编辑后，
        /// 测试会给出具体节点、对象、渲染器和材质，而不是只让适配器表现为“能力缺失”。
        /// </summary>
        [Test]
        public void 燃气真实模型四态视觉登记前置条件完整()
        {
            Scene gasPowerScene = EditorSceneManager.OpenScene(ScenePaths[1], OpenSceneMode.Additive);
            try
            {
                MonoBehaviour controller = FindComponentByTypeName(
                    gasPowerScene.GetRootGameObjects(),
                    "PowerPlantProcessController");
                Assert.That(controller, Is.Not.Null, "燃气场景缺少 PowerPlantProcessController，无法读取四态绑定。 ");

                SerializedObject serializedController = new SerializedObject(controller);
                SerializedProperty bindings = serializedController.FindProperty("_visualStateBindings");
                Assert.That(bindings, Is.Not.Null, "燃气控制器缺少已序列化的四态视觉绑定字段。 ");
                Assert.That(bindings.arraySize, Is.EqualTo(3), "燃气场景必须显式绑定燃气轮机、余热锅炉和蒸汽轮机三个真实模型。 ");

                SerializedProperty colorPropertyNames = serializedController.FindProperty("_visualStateColorPropertyNames");
                Assert.That(colorPropertyNames, Is.Not.Null);
                Assert.That(colorPropertyNames.arraySize, Is.GreaterThan(0), "燃气四态视觉必须登记至少一个材质颜色属性候选。 ");
                List<int> colorPropertyIds = new List<int>(colorPropertyNames.arraySize);
                List<string> colorPropertyNameValues = new List<string>(colorPropertyNames.arraySize);
                for (int propertyIndex = 0; propertyIndex < colorPropertyNames.arraySize; propertyIndex++)
                {
                    string propertyName = colorPropertyNames.GetArrayElementAtIndex(propertyIndex).stringValue;
                    if (!string.IsNullOrWhiteSpace(propertyName))
                    {
                        colorPropertyNameValues.Add(propertyName);
                        colorPropertyIds.Add(Shader.PropertyToID(propertyName));
                    }
                }
                Assert.That(colorPropertyIds, Is.Not.Empty);

                Dictionary<Renderer, string> rendererOwners = new Dictionary<Renderer, string>();
                List<string> validationErrors = new List<string>();
                for (int bindingIndex = 0; bindingIndex < bindings.arraySize; bindingIndex++)
                {
                    SerializedProperty binding = bindings.GetArrayElementAtIndex(bindingIndex);
                    string sceneNodeId = binding.FindPropertyRelative("_sceneNodeId").stringValue;
                    SerializedProperty targets = binding.FindPropertyRelative("_targets");
                    if (string.IsNullOrWhiteSpace(sceneNodeId) || targets == null || targets.arraySize == 0)
                    {
                        validationErrors.Add($"绑定[{bindingIndex}]缺少节点标识或目标对象。");
                        continue;
                    }

                    int rendererCount = 0;
                    for (int targetIndex = 0; targetIndex < targets.arraySize; targetIndex++)
                    {
                        GameObject target = targets.GetArrayElementAtIndex(targetIndex).objectReferenceValue as GameObject;
                        if (target == null)
                        {
                            validationErrors.Add($"节点 {sceneNodeId} 的目标[{targetIndex}]为空。");
                            continue;
                        }

                        Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
                        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                        {
                            Renderer renderer = renderers[rendererIndex];
                            if (renderer == null)
                            {
                                validationErrors.Add($"节点 {sceneNodeId} 的目标 {target.name} 包含空渲染器。");
                                continue;
                            }

                            /*
                             * 与 PowerPlantProcessController 的运行时登记边界保持一致：设备根对象中的
                             * TMP（文本网格专业版）标签使用字形图集材质，不具备设备四态材质所需的颜色属性。
                             * 标签既不参与设备状态替换，也不能导致真实模型的视觉能力登记整体失效；
                             * 因此仅跳过明确挂载 TMP_Text 的渲染器，其余渲染器仍继续执行完整校验。
                             * 编辑器测试程序集不直接引用文字组件程序集，故以 Unity 通用的字符串查找方式
                             * 识别组件类型名，避免测试专用程序集扩大编译依赖边界。
                             */
                            if (renderer.GetComponent("TMP_Text") != null)
                            {
                                continue;
                            }

                            // 只统计会被运行时注册表实际接管的设备网格，防止文本标签掩盖空设备绑定。
                            rendererCount += 1;
                            if (rendererOwners.TryGetValue(renderer, out string ownerNodeId))
                            {
                                validationErrors.Add($"节点 {sceneNodeId} 与 {ownerNodeId} 共享渲染器 {renderer.name}。");
                                continue;
                            }

                            rendererOwners.Add(renderer, sceneNodeId);
                            Material[] materials = renderer.sharedMaterials;
                            if (materials == null || materials.Length == 0)
                            {
                                validationErrors.Add($"节点 {sceneNodeId} 的渲染器 {renderer.name} 没有共享材质。");
                                continue;
                            }

                            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
                            {
                                Material material = materials[materialIndex];
                                if (material == null)
                                {
                                    validationErrors.Add($"节点 {sceneNodeId} 的渲染器 {renderer.name} 在材质槽 {materialIndex} 为空。");
                                }
                                else
                                {
                                    bool supportsRegisteredColor = false;
                                    for (int propertyIndex = 0; propertyIndex < colorPropertyIds.Count; propertyIndex++)
                                    {
                                        if (material.HasProperty(colorPropertyIds[propertyIndex]))
                                        {
                                            supportsRegisteredColor = true;
                                            break;
                                        }
                                    }
                                    if (!supportsRegisteredColor)
                                    {
                                        validationErrors.Add(
                                            $"节点 {sceneNodeId} 的材质 {material.name} 不支持已登记颜色属性：{string.Join(", ", colorPropertyNameValues)}。 ");
                                    }
                                }
                            }
                        }
                    }

                    if (rendererCount == 0)
                    {
                        validationErrors.Add($"节点 {sceneNodeId} 的所有目标均未收集到渲染器。");
                    }
                }

                Assert.That(validationErrors, Is.Empty, string.Join("\n", validationErrors));
            }
            finally
            {
                EditorSceneManager.CloseScene(gasPowerScene, true);
            }
        }

        /// <summary>
        /// 红色体积叠加粒子必须只由生命周期速度的本地负 Z 分量驱动火箭式尾焰方向。
        /// 主模块起始速度会沿发射形状正向施加初速度；一旦保留正值，就会压过较小的负 Z 速度，
        /// 导致尾气向设备内部倒灌。该测试同时检查预制体源和 ShowTest 场景实例，防止只修其中一处。
        /// </summary>
        [Test]
        public void 合并外壳红色粒子叠加层仅沿负Z排气()
        {
            GameObject prefabRoot = AssetDatabase.LoadAssetAtPath<GameObject>(WaiKeHeBingPrefabPath);
            Assert.That(prefabRoot, Is.Not.Null, "缺少合并外壳预制体，无法校验红色粒子叠加层。");
            AssertRedParticleOverlayExhaustsThroughNegativeLocalZ(prefabRoot, "预制体源");

            Scene showTestScene = EditorSceneManager.OpenScene(ShowTestScenePath, OpenSceneMode.Additive);
            try
            {
                GameObject sceneRoot = FindRootGameObjectByName(showTestScene.GetRootGameObjects(), "WaiKeHeBing_AnimationDemo");
                Assert.That(sceneRoot, Is.Not.Null, "ShowTest 场景缺少合并外壳实例，无法确认场景覆盖是否同步。");
                AssertRedParticleOverlayExhaustsThroughNegativeLocalZ(sceneRoot, "ShowTest 场景实例");
            }
            finally
            {
                EditorSceneManager.CloseScene(showTestScene, true);
            }
        }

        /// <summary>
        /// 测试程序集只依赖新运行时程序集，不能直接建立对旧桥接或燃气程序集的编译引用。
        /// 因此以已实例化组件的精确类型名核验场景保留内容，既不放宽实际资产检查，也不污染程序集边界。
        /// </summary>
        private static bool ContainsComponentNamed(GameObject[] roots, string expectedTypeName)
        {
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                if (HasComponentNamed(roots[rootIndex], expectedTypeName))
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// 在指定场景的根对象范围内定位唯一的已加载组件，不使用全局对象查询。
        /// 测试程序集通过类型名称维持与默认程序集的单向依赖，避免为诊断测试引入反向程序集引用。
        /// </summary>
        private static MonoBehaviour FindComponentByTypeName(GameObject[] roots, string expectedTypeName)
        {
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                MonoBehaviour[] components = roots[rootIndex].GetComponentsInChildren<MonoBehaviour>(true);
                for (int componentIndex = 0; componentIndex < components.Length; componentIndex++)
                {
                    MonoBehaviour component = components[componentIndex];
                    if (component != null && component.GetType().Name == expectedTypeName)
                    {
                        return component;
                    }
                }
            }

            return null;
        }

        /// <summary>
        /// 在指定根节点下读取体积控制器序列化引用，直接校验运行时真实使用的红色叠加粒子。
        /// 校验不按对象名重新查找粒子系统，避免测试通过但控制器仍引用旧对象或错误层。
        /// </summary>
        private static void AssertRedParticleOverlayExhaustsThroughNegativeLocalZ(GameObject root, string context)
        {
            MonoBehaviour controller = FindComponentByTypeName(new[] { root }, "WaiKeHeBingGasVolumeController");
            Assert.That(controller, Is.Not.Null, $"{context} 缺少 WaiKeHeBingGasVolumeController。");

            SerializedProperty overlayProperty = new SerializedObject(controller).FindProperty("_redParticleOverlay");
            Assert.That(overlayProperty, Is.Not.Null, $"{context} 控制器缺少 _redParticleOverlay 序列化字段。");
            ParticleSystem redParticleOverlay = overlayProperty.objectReferenceValue as ParticleSystem;
            Assert.That(redParticleOverlay, Is.Not.Null, $"{context} 未绑定红色粒子叠加层。");

            ParticleSystem.MainModule main = redParticleOverlay.main;
            ParticleSystem.MinMaxCurve startSpeed = main.startSpeed;
            Assert.That(GetMaxCurveValue(startSpeed), Is.EqualTo(0f).Within(0.001f), $"{context} 的主模块起始速度必须为 0，不能沿形状正向发射。");
            Assert.That(GetMaxCurveValue(main.startSize), Is.LessThanOrEqualTo(0.2f), $"{context} 的喷口粒子尺寸必须足够小，形成火焰团而不是团状雾。");
            Assert.That(GetMinCurveValue(main.startLifetime), Is.GreaterThanOrEqualTo(0.6f), $"{context} 的生命周期必须支撑可见火焰尾迹。");

            ParticleSystem.VelocityOverLifetimeModule velocity = redParticleOverlay.velocityOverLifetime;
            Assert.That(velocity.enabled, Is.True, $"{context} 必须启用生命周期速度模块。");
            Assert.That(GetMinCurveValue(velocity.z), Is.LessThanOrEqualTo(-12f), $"{context} 的 Z 速度下限必须形成高速发动机尾焰动势。");
            Assert.That(GetMaxCurveValue(velocity.z), Is.LessThanOrEqualTo(-8f), $"{context} 的 Z 速度上限仍必须指向本地负 Z。");
            Assert.That(Mathf.Abs(GetMaxCurveValue(velocity.x)), Is.LessThanOrEqualTo(0.8f), $"{context} 的 X 方向扩散只能辅助锥形尾焰展开，不能主导排气方向。");
            Assert.That(Mathf.Abs(GetMaxCurveValue(velocity.y)), Is.LessThanOrEqualTo(0.8f), $"{context} 的 Y 方向扩散只能辅助锥形尾焰展开，不能主导排气方向。");

            ParticleSystemRenderer overlayRenderer = redParticleOverlay.GetComponent<ParticleSystemRenderer>();
            Assert.That(overlayRenderer, Is.Not.Null, $"{context} 缺少粒子渲染器。");
            Assert.That(overlayRenderer.sharedMaterial, Is.Not.Null, $"{context} 必须绑定火焰材质。");
            Assert.That(overlayRenderer.sharedMaterial.name, Is.EqualTo("Flames_B_mtl"), $"{context} 应使用火焰纹理材质而不是纯色流光材质。");
            Assert.That(overlayRenderer.renderMode, Is.EqualTo(ParticleSystemRenderMode.Billboard), $"{context} 应使用 billboard（公告板）而不是速度拉伸，避免变成长条光带。");
            Assert.That(overlayRenderer.velocityScale, Is.EqualTo(0f).Within(0.001f), $"{context} 的速度拉伸比例必须关闭。");
        }

        /// <summary>
        /// 读取 MinMaxCurve（最小最大曲线）的有效上界；覆盖常量和双常量两种项目当前使用的序列化模式。
        /// 非常量曲线不是本测试的目标，返回 curveMultiplier 作为保守近似，避免未来改为曲线时测试直接误读为 0。
        /// </summary>
        private static float GetMaxCurveValue(ParticleSystem.MinMaxCurve curve)
        {
            return curve.mode switch
            {
                ParticleSystemCurveMode.TwoConstants => curve.constantMax,
                ParticleSystemCurveMode.Constant => curve.constant,
                _ => curve.curveMultiplier
            };
        }

        /// <summary>
        /// 读取 MinMaxCurve（最小最大曲线）的有效下界；与上界辅助函数配对，统一处理粒子速度范围断言。
        /// </summary>
        private static float GetMinCurveValue(ParticleSystem.MinMaxCurve curve)
        {
            return curve.mode == ParticleSystemCurveMode.TwoConstants ? curve.constantMin : GetMaxCurveValue(curve);
        }

        /// <summary>只在已打开场景根对象中按精确名称查找实例，避免全局对象查询混入其他测试场景。</summary>
        private static GameObject FindRootGameObjectByName(GameObject[] roots, string expectedName)
        {
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                if (roots[rootIndex].name == expectedName)
                {
                    return roots[rootIndex];
                }
            }

            return null;
        }

        /// <summary>
        /// 以真实唤醒顺序执行发电场景控制器的两段私有初始化，供编辑器资产测试获得与播放器一致的能力状态。
        /// 不调用完整 Awake，是为了避免测试为仅验证高亮效果而修改场景对象；节点缓存和四态登记
        /// 均是无帧循环、无异步依赖的确定性前置步骤，执行后由场景关闭流程一并销毁临时状态。
        /// </summary>
        private static void InitializePowerPlantControllerForEditModeInspection(GameObject[] roots)
        {
            MonoBehaviour controller = FindComponentByTypeName(roots, "PowerPlantProcessController");
            Assert.That(controller, Is.Not.Null, "发电场景缺少 PowerPlantProcessController，无法初始化四态能力。 ");

            Type controllerType = controller.GetType();
            InvokePrivateInstanceMethod(controllerType, controller, "CacheSceneBindings");
            InvokePrivateInstanceMethod(controllerType, controller, "InitializeVisualStateRegistry");
        }

        /// <summary>
        /// 仅用于跨程序集的编辑器资产检验，显式要求零参数私有实例方法存在并可调用。
        /// 方法缺失、签名变化或内部执行异常都会在测试中立即暴露，避免反射失败被吞没后
        /// 再被误诊为场景目录或材质映射错误。
        /// </summary>
        private static void InvokePrivateInstanceMethod(Type targetType, object instance, string methodName)
        {
            MethodInfo method = targetType.GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(method, Is.Not.Null, $"发电场景控制器缺少编辑器验证所需的私有初始化方法：{methodName}。 ");
            method.Invoke(instance, null);
        }

        /// <summary>仅遍历单个场景根对象的既有组件层级；不使用全局查找，避免其他测试加载的场景产生误判。</summary>
        private static bool HasComponentNamed(GameObject root, string expectedTypeName)
        {
            MonoBehaviour[] components = root.GetComponentsInChildren<MonoBehaviour>(true);
            for (int componentIndex = 0; componentIndex < components.Length; componentIndex++)
            {
                MonoBehaviour component = components[componentIndex];
                if (component != null && component.GetType().Name == expectedTypeName)
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>在真实燃煤场景的全部根对象中确认至少存在一个渲染器，不依赖 Unity 根对象顺序。</summary>
        private static bool ContainsRenderer(GameObject[] roots)
        {
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                if (roots[rootIndex].GetComponentsInChildren<Renderer>(true).Length > 0)
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>在真实燃煤场景的全部根对象中确认至少存在一个相机，不依赖 Unity 根对象顺序。</summary>
        private static bool ContainsCamera(GameObject[] roots)
        {
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                if (roots[rootIndex].GetComponentsInChildren<Camera>(true).Length > 0)
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// 燃气适配器位于既有默认程序集，测试程序集不建立静态编译引用，避免反向污染运行时程序集边界。
        /// 这里精确寻找并调用其私有登记入口，模拟播放器在场景加载前执行的 RuntimeInitializeOnLoadMethod 行为。
        /// </summary>
        private static void RegisterGasPowerAdapterFactory()
        {
            Type adapterType = null;
            Assembly[] assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (int assemblyIndex = 0; assemblyIndex < assemblies.Length && adapterType == null; assemblyIndex++)
            {
                adapterType = assemblies[assemblyIndex].GetType("GasPowerBusinessSceneControllerAdapter", false);
            }

            Assert.That(adapterType, Is.Not.Null, "未加载燃气业务场景适配器类型。");
            MethodInfo registerFactory = adapterType.GetMethod("RegisterFactory", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(registerFactory, Is.Not.Null, "燃气业务场景适配器缺少工厂登记入口。");
            registerFactory.Invoke(null, null);
        }

        /// <summary>
        /// 编辑器测试不会自动执行 RuntimeInitializeOnLoadMethod，因此显式触发燃煤适配器工厂登记。
        /// 工厂仍只接收场景中已序列化的控制器，不按文件名或模型名称推断绑定。
        /// </summary>
        private static void RegisterCoalPowerAdapterFactory()
        {
            Type adapterType = null;
            Assembly[] assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (int assemblyIndex = 0; assemblyIndex < assemblies.Length && adapterType == null; assemblyIndex++)
            {
                adapterType = assemblies[assemblyIndex].GetType("CoalPowerBusinessSceneControllerAdapter", false);
            }

            Assert.That(adapterType, Is.Not.Null, "未加载燃煤业务场景适配器类型。 ");
            MethodInfo registerFactory = adapterType.GetMethod("RegisterFactory", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(registerFactory, Is.Not.Null, "燃煤业务场景适配器缺少工厂登记入口。 ");
            registerFactory.Invoke(null, null);
        }
    }
}
