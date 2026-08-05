using System;
using System.Collections.Generic;
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
    /// 该测试覆盖构建顺序、目录映射、启动服务、燃气资产迁移和其余业务场景轻量占位边界，
    /// 防止未来场景编辑时意外把旧 SampleScene 或重资源重新带回启动路径。
    /// </summary>
    public sealed class BusinessSceneBootstrapAssetTests
    {
        private const string CatalogAssetPath = "Assets/Configuration/BusinessSceneCatalog.asset";
        private const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";
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
        /// 目录资产必须包含固定九项、唯一场景键和明确路径；八个空场景只支持幂等释放，
        /// 燃气能力严格与当前适配器一致，后续实现业务控制器时必须连同目录能力位一起修改。
        /// </summary>
        [Test]
        public void 正式目录完整映射九个空业务场景()
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
                BusinessSceneCapability expectedCapabilities = SceneIds[index] == "gas-power"
                    ? BusinessSceneCapability.Initialize |
                      BusinessSceneCapability.EnterProcessStep |
                      BusinessSceneCapability.FocusNode |
                      BusinessSceneCapability.SetNodeVisibility |
                      BusinessSceneCapability.ResetScene |
                      BusinessSceneCapability.Release
                    : BusinessSceneCapability.Release;
                Assert.That(entry.DeclaredCapabilities, Is.EqualTo(expectedCapabilities));
                Assert.That(AssetDatabase.LoadAssetAtPath<SceneAsset>(entry.ScenePath), Is.Not.Null);
            }
        }

        /// <summary>
        /// 构建第一项必须是轻量 Bootstrap，后续九项必须与目录次序一致。
        /// 断言只针对正式十个入口，不要求或解释用户保留的旧场景资产。
        /// </summary>
        [Test]
        public void 构建顺序以启动场景和九个业务场景组成()
        {
            EditorBuildSettingsScene[] buildScenes = EditorBuildSettings.scenes;

            Assert.That(buildScenes, Has.Length.EqualTo(ScenePaths.Length + 1));
            Assert.That(buildScenes[0].enabled, Is.True);
            Assert.That(buildScenes[0].path, Is.EqualTo(BootstrapScenePath));
            for (int index = 0; index < ScenePaths.Length; index++)
            {
                Assert.That(buildScenes[index + 1].enabled, Is.True);
                Assert.That(buildScenes[index + 1].path, Is.EqualTo(ScenePaths[index]));
            }
        }

        /// <summary>
        /// 启动场景只挂载常驻基础服务，并将协调器的目录引用固定到正式资产。
        /// 使用 SerializedObject 读取私有序列化字段可验证实际场景接线，而非只验证脚本类型存在。
        /// </summary>
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

                MultiSceneCoordinator coordinator = runtimeRoot.GetComponent<MultiSceneCoordinator>();
                Assert.That(coordinator, Is.Not.Null);
                SerializedProperty catalogProperty = new SerializedObject(coordinator).FindProperty("_sceneCatalog");
                Assert.That(catalogProperty.objectReferenceValue, Is.EqualTo(AssetDatabase.LoadAssetAtPath<BusinessSceneCatalog>(CatalogAssetPath)));
            }
            finally
            {
                EditorSceneManager.CloseScene(bootstrapScene, true);
            }
        }

        /// <summary>
        /// 燃气场景必须保留旧场景 GUID 与现有控制器；其他八个业务文件仅持有一个不带渲染内容的占位根对象。
        /// 占位控制器保留正确 sceneId，却不会实现任何业务能力，从而保障后续编辑人员可逐场景替换真实内容。
        /// </summary>
        [Test]
        public void 燃气场景已迁移且其余八个业务场景保持空内容()
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
        /// 燃气场景只调用其适配器已定义的登记方法，不依据改名后的路径或显示名称推断身份；
        /// 八个占位场景则验证“仅释放”能力既可被目录识别，又不会放行流程和聚焦命令。
        /// </summary>
        [Test]
        public void 九个场景控制器与正式能力登记严格一致()
        {
            RegisterGasPowerAdapterFactory();
            BusinessSceneCatalog catalog = AssetDatabase.LoadAssetAtPath<BusinessSceneCatalog>(CatalogAssetPath);

            for (int index = 0; index < ScenePaths.Length; index++)
            {
                Assert.That(catalog.TryGetBySceneId(SceneIds[index], out BusinessSceneCatalogEntry entry), Is.True);
                Scene businessScene = EditorSceneManager.OpenScene(ScenePaths[index], OpenSceneMode.Additive);
                try
                {
                    bool resolved = BusinessSceneControllerRegistry.TryResolve(
                        businessScene,
                        entry,
                        out IBusinessSceneController controller,
                        out string error);
                    Assert.That(resolved, Is.True, error);
                    Assert.That(controller.SceneId, Is.EqualTo(entry.SceneId));
                    Assert.That(controller.Capabilities, Is.EqualTo(entry.DeclaredCapabilities));

                    if (SceneIds[index] != "gas-power")
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
    }
}
