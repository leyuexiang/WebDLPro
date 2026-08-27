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
    /// 该测试覆盖构建顺序、目录映射、启动服务、燃气资产迁移、燃煤模型绑定和其余业务场景轻量占位边界，
    /// 防止未来场景编辑时意外把旧 SampleScene 或重资源重新带回启动路径。
    /// </summary>
    public sealed class BusinessSceneBootstrapAssetTests
    {
        private const string CatalogAssetPath = "Assets/Configuration/BusinessSceneCatalog.asset";
        private const string OverviewCatalogAssetPath = "Assets/Configuration/OverviewSceneCatalog.asset";
        private const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";
        private const string OverviewScenePath = "Assets/Scenes/Overview/Overview.unity";
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
                for (int index = 0; index < SceneIds.Length; index++)
                {
                    OverviewBuildingPlaceholder building = Array.Find(
                        buildings,
                        candidate => candidate != null && candidate.TargetSceneId == SceneIds[index]);
                    Assert.That(building, Is.Not.Null, $"总览缺少目标场景映射：{SceneIds[index]}");
                    Assert.That(building.OverviewBuildingId, Is.EqualTo($"overview-building.{SceneIds[index]}"));
                    Assert.That(building.name, Is.EqualTo($"OverviewBuilding_{ToPascalCase(SceneIds[index])}"));
                }
                Assert.That(roots[0].GetComponent<OverviewSceneController>(), Is.Not.Null);
                Assert.That(roots[0].GetComponentsInChildren<Renderer>(true), Has.Length.EqualTo(10));
            }
            finally
            {
                EditorSceneManager.CloseScene(overviewScene, true);
            }
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

                SerializedProperty bindings = new SerializedObject(controller).FindProperty("_visualStateBindings");
                Assert.That(bindings, Is.Not.Null, "燃气控制器缺少已序列化的四态视觉绑定字段。 ");
                Assert.That(bindings.arraySize, Is.EqualTo(3), "燃气场景必须显式绑定燃气轮机、余热锅炉和蒸汽轮机三个真实模型。 ");

                int baseColorPropertyId = Shader.PropertyToID("_BaseColor");
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
                        rendererCount += renderers.Length;
                        for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                        {
                            Renderer renderer = renderers[rendererIndex];
                            if (renderer == null)
                            {
                                validationErrors.Add($"节点 {sceneNodeId} 的目标 {target.name} 包含空渲染器。");
                                continue;
                            }
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
                                else if (!material.HasProperty(baseColorPropertyId))
                                {
                                    validationErrors.Add($"节点 {sceneNodeId} 的材质 {material.name} 不支持 _BaseColor。 ");
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
