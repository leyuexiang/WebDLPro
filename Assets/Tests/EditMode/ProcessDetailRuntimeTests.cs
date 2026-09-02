using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;
using Object = UnityEngine.Object;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 验证跨场景第三层关键环节的目录、协议、独占资源生命周期和包装资产。
    /// 测试只使用稳定标识与显式序列化引用，不以运行时对象名称推断业务映射。
    /// </summary>
    public sealed class ProcessDetailRuntimeTests
    {
        private const string CatalogPath = "Assets/Configuration/ProcessDetailCatalog.asset";
        private const string GasPrefabPath = "Assets/ProcessDetails/GasPower/GasTurbine/GasTurbineProcessDetail.prefab";
        private const string CoalPrefabPath = "Assets/ProcessDetails/CoalPower/Boiler/CoalBoilerProcessDetail.prefab";

        private sealed class TrackingLease : IDisposable
        {
            public int DisposeCount { get; private set; }

            public void Dispose()
            {
                DisposeCount++;
            }
        }

        /// <summary>每次加载跨过一个等待点，用于稳定复现加载中退出和迟到回调。</summary>
        private sealed class QueuedLoader : IProcessDetailResourceLoader
        {
            private readonly Queue<Func<ProcessDetailLoadResult>> _results =
                new Queue<Func<ProcessDetailLoadResult>>();

            public int CallCount { get; private set; }

            public void Enqueue(Func<ProcessDetailLoadResult> resultFactory)
            {
                _results.Enqueue(resultFactory);
            }

            public IEnumerator LoadAsync(
                ProcessDetailCatalogEntry entry,
                Action<ProcessDetailLoadResult> completed)
            {
                CallCount++;
                yield return null;
                completed(_results.Dequeue().Invoke());
            }
        }

        [Test]
        public void 关键环节目录允许零到多项并支持跨场景登记()
        {
            ProcessDetailCatalog catalog = ScriptableObject.CreateInstance<ProcessDetailCatalog>();
            try
            {
                catalog.SetEntriesForEditor(Array.Empty<ProcessDetailCatalogEntry>());
                Assert.That(catalog.ValidateForRuntime(), Is.Empty, "空场景目录必须合法，不能强制创建伪资源。");

                ProcessDetailCatalogEntry gasTurbine = CreateEntry();
                catalog.SetEntriesForEditor(new[] { gasTurbine });
                Assert.That(catalog.ValidateForRuntime(), Is.Empty);
                Assert.That(catalog.TryGet("gas-power", gasTurbine.ProcessDetailId, out ProcessDetailCatalogEntry resolved), Is.True);
                Assert.That(resolved, Is.SameAs(gasTurbine));
                Assert.That(catalog.TryGet("coal-power", gasTurbine.ProcessDetailId, out _), Is.False);

                ProcessDetailCatalogEntry duplicateStep = new ProcessDetailCatalogEntry(
                    "gas-power",
                    "gas-power-generation",
                    "gas-turbine",
                    "process-detail.gas-power.gas-turbine-copy",
                    "process-detail-resource.gas-power.gas-turbine-copy",
                    "camera-pose.gas-power.gas-turbine-copy",
                    "gas-turbine",
                    BusinessSceneAvailability.Available);
                catalog.SetEntriesForEditor(new[] { gasTurbine, duplicateStep });
                Assert.That(
                    catalog.ValidateForRuntime(),
                    Has.Some.Matches<BusinessSceneCatalogValidationIssue>(issue =>
                        issue.Code == "process-detail-catalog.scene-step-duplicate"));
            }
            finally
            {
                Object.DestroyImmediate(catalog);
            }
        }

        [Test]
        public void 通用目录支持跨场景多设备与多动态目标并拒绝重复动态目标()
        {
            ProcessDetailCatalog catalog = ScriptableObject.CreateInstance<ProcessDetailCatalog>();
            try
            {
                ProcessDetailCatalogEntry gasEntry = new ProcessDetailCatalogEntry(
                    "gas-power",
                    "gas-power-generation",
                    "gas-turbine",
                    "process-detail.gas-power.gas-turbine",
                    "process-detail-resource.gas-power.gas-turbine",
                    "camera-pose.gas-power.gas-turbine",
                    new[] { "gas-turbine", "gas-generator" },
                    new[] { "gas-turbine-rotation", "gas-turbine-particles" },
                    BusinessSceneAvailability.Available);
                ProcessDetailCatalogEntry coalEntry = new ProcessDetailCatalogEntry(
                    "coal-power",
                    "coal-power-generation",
                    "boiler",
                    "process-detail.coal-power.boiler",
                    "process-detail-resource.coal-power.boiler",
                    "camera-pose.coal-power.boiler",
                    new[] { "coal-boiler", "coal-fan" },
                    new[] { "coal-boiler-animation" },
                    BusinessSceneAvailability.Available);

                catalog.SetEntriesForEditor(new[] { gasEntry, coalEntry });
                Assert.That(catalog.ValidateForRuntime(), Is.Empty);
                Assert.That(catalog.TryGet("gas-power", gasEntry.ProcessDetailId, out _), Is.True);
                Assert.That(catalog.TryGet("coal-power", coalEntry.ProcessDetailId, out _), Is.True);
                Assert.That(catalog.ContainsStateNode("gas-power", "gas-generator"), Is.True);
                Assert.That(catalog.ContainsStateNode("coal-power", "coal-fan"), Is.True);

                ProcessDetailCatalogEntry duplicateDynamicTarget = new ProcessDetailCatalogEntry(
                    "coal-power",
                    "coal-power-generation",
                    "steam-turbine",
                    "process-detail.coal-power.steam-turbine",
                    "process-detail-resource.coal-power.steam-turbine",
                    "camera-pose.coal-power.steam-turbine",
                    new[] { "coal-steam-turbine" },
                    new[] { "gas-turbine-rotation" },
                    BusinessSceneAvailability.Available);
                catalog.SetEntriesForEditor(new[] { gasEntry, coalEntry, duplicateDynamicTarget });
                Assert.That(
                    catalog.ValidateForRuntime(),
                    Has.Some.Matches<BusinessSceneCatalogValidationIssue>(issue =>
                        issue.Code == "process-detail-catalog.dynamic-target-id"));
            }
            finally
            {
                Object.DestroyImmediate(catalog);
            }
        }

        [Test]
        public void 第二版协议只通过白名单暴露独立关键环节命令()
        {
            Assert.That(WebGlProtocolContract.ProtocolVersion, Is.EqualTo(2));
            Assert.That(WebGlProtocolContract.ProcessDetailCommandSchemaVersion, Is.EqualTo(2));
            Assert.That(WebGlProtocolContract.CreateCommandCapabilities(), Does.Contain("prepareProcessDetail"));
            Assert.That(WebGlProtocolContract.CreateCommandCapabilities(), Does.Contain("commitProcessDetail"));
            Assert.That(WebGlProtocolContract.CreateCommandCapabilities(), Does.Contain("abortProcessDetail"));
            Assert.That(WebGlProtocolContract.CreateCommandCapabilities(), Does.Contain("enterProcessDetail"));
            Assert.That(WebGlProtocolContract.CreateCommandCapabilities(), Does.Contain("exitProcessDetail"));
            Assert.That(WebGlProtocolContract.CreateCommandCapabilities(), Does.Contain("setProcessDetailPlayback"));
            Assert.That(
                WebGlProtocolContract.CreatePrepareProcessDetailRequiredFields(),
                Is.EqualTo(new[] { "sceneId", "processId", "stepId", "processDetailId", "transitionId" }));
            Assert.That(
                WebGlProtocolContract.CreateCommitProcessDetailRequiredFields(),
                Is.EqualTo(new[] { "sceneId", "processDetailId", "transitionId" }));
            Assert.That(
                WebGlProtocolContract.CreateAbortProcessDetailRequiredFields(),
                Is.EqualTo(new[] { "sceneId", "processDetailId", "transitionId" }));
            Assert.That(
                WebGlProtocolContract.CreateEnterProcessDetailRequiredFields(),
                Is.EqualTo(new[] { "sceneId", "processId", "stepId", "processDetailId", "transitionId" }));
            Assert.That(
                WebGlProtocolContract.CreateExitProcessDetailRequiredFields(),
                Is.EqualTo(new[] { "sceneId", "processDetailId", "transitionId" }));
            Assert.That(
                WebGlProtocolContract.CreateSetProcessDetailPlaybackRequiredFields(),
                Is.EqualTo(new[] { "sceneId", "processDetailId", "playing" }));
            Assert.That(
                SceneActionProtocolValidator.IsValidProcessDetailPlayback(
                    "gas-power",
                    "process-detail.gas-power.gas-turbine"),
                Is.True);
            Assert.That(
                SceneActionProtocolValidator.IsValidProcessDetail(
                    "gas-power",
                    "gas-power-generation",
                    "gas-turbine",
                    "process-detail.gas-power.gas-turbine",
                    "transition.process-detail.valid"),
                Is.True,
                "第二版进入命令必须接受完整事务标识。");
            Assert.That(
                SceneActionProtocolValidator.IsValidProcessDetailExit(
                    "gas-power",
                    "process-detail.gas-power.gas-turbine",
                    string.Empty),
                Is.False,
                "缺少事务标识的退出命令不得进入第三层资源释放路径。");
        }

        [Test]
        public void 资源先隐藏提交且加载中退出会清理迟到实例和句柄()
        {
            ProcessDetailResourceRuntime runtime = new ProcessDetailResourceRuntime("gas-power");
            QueuedLoader loader = new QueuedLoader();
            GameObject mount = new GameObject("ProcessDetailMountTest");
            TrackingLease lease = new TrackingLease();
            GameObject lateRoot = null;
            try
            {
                loader.Enqueue(() => ProcessDetailLoadResult.Completed(
                    new ProcessDetailLoadHandle(
                        lateRoot = new GameObject("LateProcessDetailRoot"),
                        lease)));

                BusinessSceneCommandResult result = default;
                IEnumerator loading = runtime.LoadAsync(CreateEntry(), loader, mount.transform, value => result = value);
                Assert.That(loading.MoveNext(), Is.True, "加载器必须先跨过一个异步等待点。");
                Assert.That(runtime.State, Is.EqualTo(ProcessDetailResourceRuntimeState.Loading));

                Assert.That(runtime.ReleaseCurrent().Success, Is.True);
                while (loading.MoveNext())
                {
                }

                Assert.That(result.Success, Is.False);
                Assert.That(result.ErrorCode, Is.EqualTo("process-detail-load-superseded"));
                Assert.That(lateRoot == null, Is.True, "迟到实例必须立即销毁。");
                Assert.That(lease.DisposeCount, Is.EqualTo(1), "迟到资源租约必须且只能释放一次。");
                Assert.That(runtime.Root, Is.Null);
                Assert.That(runtime.State, Is.EqualTo(ProcessDetailResourceRuntimeState.Idle));
            }
            finally
            {
                runtime.Dispose();
                Object.DestroyImmediate(mount);
            }
        }

        [Test]
        public void 连续五十轮进入返回不存在重复实例或资源句柄()
        {
            ProcessDetailResourceRuntime runtime = new ProcessDetailResourceRuntime("gas-power");
            QueuedLoader loader = new QueuedLoader();
            GameObject mount = new GameObject("ProcessDetailMountFiftyCycles");
            List<TrackingLease> leases = new List<TrackingLease>(50);
            try
            {
                for (int cycle = 0; cycle < 50; cycle++)
                {
                    TrackingLease lease = new TrackingLease();
                    leases.Add(lease);
                    loader.Enqueue(() => ProcessDetailLoadResult.Completed(
                        new ProcessDetailLoadHandle(new GameObject($"ProcessDetailRoot-{cycle}"), lease)));

                    BusinessSceneCommandResult loadResult = default;
                    Run(runtime.LoadAsync(CreateEntry(), loader, mount.transform, value => loadResult = value));
                    Assert.That(loadResult.Success, Is.True, $"第 {cycle + 1} 轮加载失败：{loadResult.Message}");
                    Assert.That(runtime.Root, Is.Not.Null);
                    Assert.That(runtime.Root.activeSelf, Is.False, "资源必须保持隐藏，激活权只属于上层原子事务。");
                    Assert.That(mount.transform.childCount, Is.EqualTo(1), "任意时刻最多只能存在一个第三层实例。");

                    Assert.That(runtime.ReleaseCurrent().Success, Is.True);
                    Assert.That(runtime.Root, Is.Null);
                    Assert.That(mount.transform.childCount, Is.EqualTo(0));
                    Assert.That(lease.DisposeCount, Is.EqualTo(1));
                }

                Assert.That(loader.CallCount, Is.EqualTo(50));
                Assert.That(leases, Has.All.Matches<TrackingLease>(lease => lease.DisposeCount == 1));
            }
            finally
            {
                runtime.Dispose();
                Object.DestroyImmediate(mount);
            }
        }

        [Test]
        public void 正式包装使用显式相机位并排除透明壳气流和粒子渲染器()
        {
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GasPrefabPath);
            Assert.That(catalog, Is.Not.Null);
            Assert.That(prefab, Is.Not.Null);
            Assert.That(catalog.ValidateForRuntime(), Is.Empty);
            Assert.That(catalog.Entries.Count, Is.EqualTo(2), "当前应登记燃气轮机正式项和燃煤锅炉燃烧占位项。");

            Assert.That(
                catalog.TryGet("gas-power", "process-detail.gas-power.gas-turbine", out ProcessDetailCatalogEntry entry),
                Is.True);
            AssertEntryIdentifiers(entry);
            ProcessDetailDeviceBinding binding = prefab.GetComponent<ProcessDetailDeviceBinding>();
            ProcessDetailStateVisualAdapter visualAdapter = prefab.GetComponent<ProcessDetailStateVisualAdapter>();
            Assert.That(binding, Is.Not.Null);
            Assert.That(visualAdapter, Is.Not.Null);
            Assert.That(binding.ValidateBinding(entry).Success, Is.True);
            Assert.That(binding.DisplayAnchor, Is.Not.Null);
            Assert.That(binding.CameraPose, Is.Not.Null);
            Assert.That(binding.DisplayAnchor.localPosition.x, Is.EqualTo(10000f).Within(0.001f));
            Assert.That(binding.DisplayAnchor.localPosition.y, Is.EqualTo(0f).Within(0.001f));
            Assert.That(binding.DisplayAnchor.localPosition.z, Is.EqualTo(0f).Within(0.001f));
            Vector3 cameraLocalPosition = binding.CameraPose.localPosition;
            Assert.That(cameraLocalPosition.x, Is.EqualTo(9989.13805f).Within(0.001f));
            Assert.That(cameraLocalPosition.y, Is.EqualTo(2.483585f).Within(0.0001f));
            Assert.That(cameraLocalPosition.z, Is.EqualTo(-1.561808f).Within(0.0001f));
            Assert.That(Vector3.Distance(binding.CameraPose.localPosition, binding.DisplayAnchor.localPosition), Is.LessThan(20f));
            Assert.That(binding.CameraPose.localEulerAngles.x, Is.EqualTo(8.457968f).Within(0.001f));
            Assert.That(binding.CameraPose.localEulerAngles.y, Is.EqualTo(86.63072f).Within(0.001f));

            SerializedProperty rendererProperty = new SerializedObject(visualAdapter).FindProperty("_renderers");
            Assert.That(rendererProperty, Is.Not.Null);
            Assert.That(rendererProperty.arraySize, Is.GreaterThan(0));
            HashSet<Renderer> visualRenderers = new HashSet<Renderer>();
            for (int index = 0; index < rendererProperty.arraySize; index++)
            {
                Renderer renderer = rendererProperty.GetArrayElementAtIndex(index).objectReferenceValue as Renderer;
                Assert.That(renderer, Is.TypeOf<MeshRenderer>());
                Assert.That(renderer.GetComponent<ParticleSystem>(), Is.Null, $"粒子渲染器不得进入故障材质集合：{renderer?.name}");
                visualRenderers.Add(renderer);
            }

            MonoBehaviour animationController = FindBehaviour(prefab, "WaiKeHeBingAnimationController");
            MonoBehaviour volumeController = FindBehaviour(prefab, "WaiKeHeBingGasVolumeController");
            AssertSerializedRenderersExcluded(animationController, "_rightShellRenderers", visualRenderers);
            AssertSerializedRendererExcluded(volumeController, "_blueVolumeRenderer", visualRenderers);
            AssertSerializedRendererExcluded(volumeController, "_redVolumeRenderer", visualRenderers);
        }

        [Test]
        public void 燃煤锅炉占位包装使用远端相机且不登记播放目标()
        {
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(CoalPrefabPath);
            Assert.That(catalog, Is.Not.Null);
            Assert.That(prefab, Is.Not.Null);
            Assert.That(
                catalog.TryGet("coal-power", "process-detail.coal-power.boiler", out ProcessDetailCatalogEntry entry),
                Is.True);

            ProcessDetailDeviceBinding binding = prefab.GetComponent<ProcessDetailDeviceBinding>();
            Assert.That(binding, Is.Not.Null);
            Assert.That(binding.ValidateBinding(entry).Success, Is.True);
            Assert.That(entry.ProcessId, Is.EqualTo("coal-power-generation"));
            Assert.That(entry.StepId, Is.EqualTo("boiler"));
            Assert.That(entry.StateNodeId, Is.EqualTo("node.coal-boiler"));
            Assert.That(entry.DynamicTargetIds, Is.Empty, "占位模型尚未接入播放/停止目标。");
            Assert.That(binding.DynamicTargetIds, Is.Empty);
            Assert.That(binding.DisplayAnchor.localPosition.x, Is.EqualTo(10000f).Within(0.001f));
            Assert.That(
                Vector3.Distance(binding.CameraPose.localPosition, binding.DisplayAnchor.localPosition),
                Is.InRange(20f, 500f));

            MonoBehaviour valveController = FindBehaviour(prefab, "ControlValveEffectController");
            SerializedObject serializedValve = new SerializedObject(valveController);
            Assert.That(serializedValve.FindProperty("_playOnEnable")?.boolValue, Is.False);
            Assert.That(serializedValve.FindProperty("_loopDemo")?.boolValue, Is.False);
        }

        [Test]
        public void 设备四态不再改变动态播放且独立命令可幂等停止恢复()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GasPrefabPath);
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            Assert.That(
                catalog.TryGet("gas-power", "process-detail.gas-power.gas-turbine", out ProcessDetailCatalogEntry gasEntry),
                Is.True);
            GameObject instance = Object.Instantiate(prefab);
            instance.SetActive(false);
            try
            {
                ProcessDetailDeviceBinding binding = instance.GetComponent<ProcessDetailDeviceBinding>();
                Assert.That(binding.ValidateBinding(gasEntry).Success, Is.True);

                // 故障只改变材质视觉；包装首次激活时仍保持预制体默认播放许可。
                Assert.That(binding.PrepareForActivation(true, BusinessSceneNodeVisualState.Fault).Success, Is.True);
                AssertPlaybackAllowed(instance, true);

                Assert.That(binding.SetPlayback(false).Success, Is.True);
                AssertPlaybackAllowed(instance, false);
                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Normal).Success, Is.True);
                Assert.That(binding.ClearVisualState().Success, Is.True);
                AssertPlaybackAllowed(instance, false);

                Assert.That(binding.SetPlayback(true).Success, Is.True);
                Assert.That(binding.SetPlayback(true).Success, Is.True);
                AssertPlaybackAllowed(instance, true);
                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Fault).Success, Is.True);
                AssertPlaybackAllowed(instance, true);
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        [Test]
        public void 燃气场景装配独立协调器且不再保留旧燃机步骤()
        {
            const string gasPowerScenePath = "Assets/Scenes/Business/GasPower.unity";
            Scene scene = EditorSceneManager.OpenScene(gasPowerScenePath, OpenSceneMode.Additive);
            try
            {
                MonoBehaviour processController = null;
                MonoBehaviour detailCoordinator = null;
                GameObject[] roots = scene.GetRootGameObjects();
                for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
                {
                    MonoBehaviour[] behaviours = roots[rootIndex].GetComponentsInChildren<MonoBehaviour>(true);
                    for (int behaviourIndex = 0; behaviourIndex < behaviours.Length; behaviourIndex++)
                    {
                        MonoBehaviour behaviour = behaviours[behaviourIndex];
                        if (behaviour == null)
                        {
                            continue;
                        }
                        if (behaviour.GetType().Name == "PowerPlantProcessController")
                        {
                            processController = behaviour;
                        }
                        else if (behaviour.GetType().Name == "ProcessDetailCoordinator")
                        {
                            detailCoordinator = behaviour;
                        }
                    }
                }

                Assert.That(processController, Is.Not.Null);
                Assert.That(detailCoordinator, Is.Not.Null, "业务场景必须装配通用第三层协调器。");
                SerializedProperty stepBindings = new SerializedObject(processController).FindProperty("_processStepBindings");
                Assert.That(stepBindings, Is.Not.Null);
                for (int index = 0; index < stepBindings.arraySize; index++)
                {
                    string stepId = stepBindings.GetArrayElementAtIndex(index)
                        .FindPropertyRelative("_stepId")?.stringValue;
                    Assert.That(stepId, Is.Not.EqualTo("gas-turbine"), "旧燃气轮机流程步骤不得重新进入正式场景。");
                }

                SerializedObject serializedCoordinator = new SerializedObject(detailCoordinator);
                Assert.That(
                    serializedCoordinator.FindProperty("_catalog")?.objectReferenceValue,
                    Is.EqualTo(AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath)));
                Transform detailMount = serializedCoordinator.FindProperty("_detailMount")?.objectReferenceValue as Transform;
                Transform businessSceneRoot = serializedCoordinator.FindProperty("_businessSceneRoot")?.objectReferenceValue as Transform;
                Assert.That(detailMount, Is.Not.Null);
                Assert.That(businessSceneRoot, Is.Not.Null);
                Assert.That(detailMount.IsChildOf(businessSceneRoot), Is.False, "第三层挂载点不得位于二层业务根节点内。");
                Assert.That(
                    serializedCoordinator.FindProperty("_secondLayerInteractionController")?.objectReferenceValue,
                    Is.AssignableTo<IBusinessSceneInteractionGate>(),
                    "第三层协调器必须通过交互门阻断点击，不能停用整个二层控制器。");
            }
            finally
            {
                EditorSceneManager.CloseScene(scene, true);
            }
        }

        private static ProcessDetailCatalogEntry CreateEntry()
        {
            return new ProcessDetailCatalogEntry(
                "gas-power",
                "gas-power-generation",
                "gas-turbine",
                "process-detail.gas-power.gas-turbine",
                "process-detail-resource.gas-power.gas-turbine",
                "camera-pose.gas-power.gas-turbine",
                "gas-turbine",
                BusinessSceneAvailability.Available);
        }

        private static void AssertEntryIdentifiers(ProcessDetailCatalogEntry entry)
        {
            Assert.That(entry.SceneId, Is.EqualTo("gas-power"));
            Assert.That(entry.ProcessId, Is.EqualTo("gas-power-generation"));
            Assert.That(entry.StepId, Is.EqualTo("gas-turbine"));
            Assert.That(entry.ProcessDetailId, Is.EqualTo("process-detail.gas-power.gas-turbine"));
            Assert.That(entry.ResourceId, Is.EqualTo("process-detail-resource.gas-power.gas-turbine"));
            Assert.That(entry.CameraPoseId, Is.EqualTo("camera-pose.gas-power.gas-turbine"));
            Assert.That(entry.StateNodeId, Is.EqualTo("gas-turbine"));
        }

        private static void AssertPlaybackAllowed(GameObject root, bool expected)
        {
            string[] controllerNames =
            {
                "WaiKeHeBingAnimationController",
                "WaiKeHeBingGasFlowEffectController",
                "WaiKeHeBingGasVolumeController"
            };
            for (int index = 0; index < controllerNames.Length; index++)
            {
                MonoBehaviour controller = FindBehaviour(root, controllerNames[index]);
                FieldInfo field = controller.GetType().GetField("_playbackAllowed", BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(field, Is.Not.Null, $"{controllerNames[index]} 缺少受控播放许可字段。");
                Assert.That(field.GetValue(controller), Is.EqualTo(expected), $"{controllerNames[index]} 播放许可错误。");
            }
        }

        private static MonoBehaviour FindBehaviour(GameObject root, string typeName)
        {
            MonoBehaviour[] behaviours = root.GetComponentsInChildren<MonoBehaviour>(true);
            for (int index = 0; index < behaviours.Length; index++)
            {
                MonoBehaviour behaviour = behaviours[index];
                if (behaviour != null && behaviour.GetType().Name == typeName)
                {
                    return behaviour;
                }
            }

            Assert.Fail($"包装预制体缺少组件：{typeName}");
            return null;
        }

        private static void AssertSerializedRenderersExcluded(
            MonoBehaviour target,
            string propertyName,
            ISet<Renderer> visualRenderers)
        {
            Assert.That(target, Is.Not.Null);
            SerializedProperty property = new SerializedObject(target).FindProperty(propertyName);
            Assert.That(property, Is.Not.Null);
            for (int index = 0; index < property.arraySize; index++)
            {
                Renderer renderer = property.GetArrayElementAtIndex(index).objectReferenceValue as Renderer;
                Assert.That(renderer, Is.Not.Null);
                Assert.That(visualRenderers.Contains(renderer), Is.False, $"排除渲染器被错误加入四态集合：{renderer.name}");
            }
        }

        private static void AssertSerializedRendererExcluded(
            MonoBehaviour target,
            string propertyName,
            ISet<Renderer> visualRenderers)
        {
            Assert.That(target, Is.Not.Null);
            Renderer renderer = new SerializedObject(target).FindProperty(propertyName)?.objectReferenceValue as Renderer;
            Assert.That(renderer, Is.Not.Null);
            Assert.That(visualRenderers.Contains(renderer), Is.False, $"气流渲染器被错误加入四态集合：{renderer.name}");
        }

        private static void Run(IEnumerator routine)
        {
            while (routine.MoveNext())
            {
            }
        }
    }
}
