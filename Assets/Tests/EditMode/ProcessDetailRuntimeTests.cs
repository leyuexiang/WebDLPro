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
        private const string CoalPrefabPath = "Assets/ProcessDetails/CoalPower/SteamTurbine/CoalSteamTurbineProcessDetail.prefab";
        private const string SolarPrefabPath = "Assets/ProcessDetails/SolarPower/Inverter/SolarInverterProcessDetail.prefab";

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

        /// <summary>
        /// 为协调器并发测试提供最小运行时依赖。加载、相机快照和交互门集中在同一测试组件中，
        /// 避免测试通过场景搜索或真实资源包引入额外时序；所有加载仍显式跨越一帧，便于交错推进两个事务。
        /// </summary>
        private sealed class CoordinatorTestHost : MonoBehaviour, IProcessDetailResourceLoader,
            IBusinessSceneCameraSnapshotController, IBusinessSceneInteractionGate
        {
            private readonly Queue<Func<ProcessDetailLoadResult>> _results =
                new Queue<Func<ProcessDetailLoadResult>>();

            public int LoadCallCount { get; private set; }
            public bool InteractionsBlocked { get; private set; }

            public void Enqueue(Func<ProcessDetailLoadResult> resultFactory)
            {
                _results.Enqueue(resultFactory);
            }

            public IEnumerator LoadAsync(
                ProcessDetailCatalogEntry entry,
                Action<ProcessDetailLoadResult> completed)
            {
                LoadCallCount++;
                yield return null;
                completed(_results.Dequeue().Invoke());
            }

            public BusinessSceneCameraPoseSnapshot CaptureCurrentPose()
            {
                return new BusinessSceneCameraPoseSnapshot(
                    transform.position,
                    transform.rotation,
                    60f,
                    5f,
                    false);
            }

            public void MoveToSnapshot(BusinessSceneCameraPoseSnapshot snapshot)
            {
                transform.SetPositionAndRotation(snapshot.Position, snapshot.Rotation);
            }

            public void MoveToPose(Transform targetPose)
            {
                if (targetPose != null)
                {
                    transform.SetPositionAndRotation(targetPose.position, targetPose.rotation);
                }
            }

            public void ResetToInitialTransform()
            {
            }

            public void SetInteractionsBlocked(bool blocked)
            {
                InteractionsBlocked = blocked;
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
                    "steam-turbine",
                    "process-detail.coal-power.steam-turbine",
                    "process-detail-resource.coal-power.steam-turbine",
                    "camera-pose.coal-power.steam-turbine",
                    new[] { "coal-steam-turbine", "coal-generator" },
                    new[] { "coal-steam-turbine-animation" },
                    BusinessSceneAvailability.Available);

                catalog.SetEntriesForEditor(new[] { gasEntry, coalEntry });
                Assert.That(catalog.ValidateForRuntime(), Is.Empty);
                Assert.That(catalog.TryGet("gas-power", gasEntry.ProcessDetailId, out _), Is.True);
                Assert.That(catalog.TryGet("coal-power", coalEntry.ProcessDetailId, out _), Is.True);
                Assert.That(catalog.ContainsStateNode("gas-power", "gas-generator"), Is.True);
                Assert.That(catalog.ContainsStateNode("coal-power", "coal-generator"), Is.True);

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
        public void 新准备事务必须等待旧加载安全收尾且两个资源租约只释放一次()
        {
            GameObject runtimeRoot = new GameObject("ProcessDetailSingleFlightRuntime");
            GameObject businessRoot = new GameObject("ProcessDetailSingleFlightBusinessRoot");
            GameObject detailMount = new GameObject("ProcessDetailSingleFlightMount");
            ProcessDetailCatalog catalog = ScriptableObject.CreateInstance<ProcessDetailCatalog>();
            TrackingLease firstLease = new TrackingLease();
            TrackingLease secondLease = new TrackingLease();
            GameObject firstLateRoot = null;
            GameObject secondLateRoot = null;
            try
            {
                ProcessDetailCatalogEntry entry = CreateEntry();
                catalog.SetEntriesForEditor(new[] { entry });
                CoordinatorTestHost host = runtimeRoot.AddComponent<CoordinatorTestHost>();
                ProcessDetailCoordinator coordinator = runtimeRoot.AddComponent<ProcessDetailCoordinator>();
                coordinator.ConfigureForEditor(
                    "gas-power",
                    catalog,
                    host,
                    detailMount.transform,
                    businessRoot.transform,
                    host,
                    host);
                Assert.That(coordinator.Initialize().Success, Is.True);

                host.Enqueue(() => ProcessDetailLoadResult.Completed(
                    new ProcessDetailLoadHandle(
                        firstLateRoot = new GameObject("FirstLateProcessDetailRoot"),
                        firstLease)));
                host.Enqueue(() => ProcessDetailLoadResult.Completed(
                    new ProcessDetailLoadHandle(
                        secondLateRoot = new GameObject("SecondLateProcessDetailRoot"),
                        secondLease)));

                BusinessSceneCommandResult firstResult = default;
                IEnumerator firstPrepare = coordinator.PrepareAsync(
                    "gas-power",
                    "gas-power-generation",
                    "gas-turbine",
                    entry.ProcessDetailId,
                    "transition.process-detail.single-flight.first",
                    result => firstResult = result);
                Assert.That(firstPrepare.MoveNext(), Is.True, "首个准备事务必须进入加载等待点。");
                Assert.That(host.LoadCallCount, Is.EqualTo(1));

                BusinessSceneCommandResult secondResult = default;
                IEnumerator secondPrepare = coordinator.PrepareAsync(
                    "gas-power",
                    "gas-power-generation",
                    "gas-turbine",
                    entry.ProcessDetailId,
                    "transition.process-detail.single-flight.second",
                    result => secondResult = result);
                Assert.That(secondPrepare.MoveNext(), Is.True, "新事务应等待旧事务安全退出，而不是同步启动第二个加载。");
                Assert.That(
                    host.LoadCallCount,
                    Is.EqualTo(1),
                    "任意时刻最多只能存在一个关键环节资源加载任务。");

                Run(firstPrepare);
                Assert.That(firstResult.Success, Is.False);
                Assert.That(firstResult.ErrorCode, Is.EqualTo("process-detail-prepare-superseded"));
                Assert.That(firstLateRoot == null, Is.True, "被取代事务的迟到实例必须销毁。");
                Assert.That(firstLease.DisposeCount, Is.EqualTo(1));

                Assert.That(secondPrepare.MoveNext(), Is.True, "旧事务结束后最新事务必须获得唯一加载权。");
                Assert.That(host.LoadCallCount, Is.EqualTo(2));
                Assert.That(
                    coordinator.AbortPrepared(
                        "gas-power",
                        entry.ProcessDetailId,
                        "transition.process-detail.single-flight.second").Success,
                    Is.True);
                Run(secondPrepare);

                Assert.That(secondResult.Success, Is.False);
                Assert.That(secondResult.ErrorCode, Is.EqualTo("process-detail-prepare-superseded"));
                Assert.That(secondLateRoot == null, Is.True, "取消后的迟到实例必须销毁。");
                Assert.That(secondLease.DisposeCount, Is.EqualTo(1));
                Assert.That(coordinator.HasPreparedProcessDetail, Is.False);
                Assert.That(coordinator.IsActive, Is.False);
            }
            finally
            {
                Object.DestroyImmediate(runtimeRoot);
                Object.DestroyImmediate(businessRoot);
                Object.DestroyImmediate(detailMount);
                Object.DestroyImmediate(catalog);
                if (firstLateRoot != null)
                {
                    Object.DestroyImmediate(firstLateRoot);
                }
                if (secondLateRoot != null)
                {
                    Object.DestroyImmediate(secondLateRoot);
                }
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
            Assert.That(
                catalog.Entries.Count,
                Is.EqualTo(17),
                "当前应登记燃气轮机、燃煤汽轮机、风机、齿轮箱、偏航系统、光伏逆变器、三个站类的九项保护关键环节以及开关站的母线保护和线路保护。");

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
            Assert.That(binding.CameraPose.parent, Is.EqualTo(prefab.transform));
            Assert.That(IsFinite(binding.CameraPose.localPosition), Is.True);
            Assert.That(IsFinite(binding.CameraPose.localEulerAngles), Is.True);

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

            // 当前燃机包装已由单一主控制器统一管理壳体动画和红蓝流体体积，
            // 测试直接验证生产控制器的显式引用，避免继续依赖已拆分移除的旧适配组件。
            MonoBehaviour masterController = FindBehaviour(prefab, "WaiKeHeBingMasterController");
            AssertSerializedRenderersExcluded(masterController, "_rightShellRenderers", visualRenderers);
            AssertSerializedRendererExcluded(masterController, "_blueVolumeRenderer", visualRenderers);
            AssertSerializedRendererExcluded(masterController, "_redVolumeRenderer", visualRenderers);
        }

        [Test]
        public void 燃煤汽轮机包装使用RanMeiManager并登记组合动态目标()
        {
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(CoalPrefabPath);
            Assert.That(catalog, Is.Not.Null);
            Assert.That(prefab, Is.Not.Null);
            Assert.That(
                catalog.TryGet("coal-power", "process-detail.coal-power.steam-turbine", out ProcessDetailCatalogEntry entry),
                Is.True);

            ProcessDetailDeviceBinding binding = prefab.GetComponent<ProcessDetailDeviceBinding>();
            Assert.That(binding, Is.Not.Null);
            Assert.That(binding.ValidateBinding(entry).Success, Is.True);
            Assert.That(entry.ProcessId, Is.EqualTo("coal-power-generation"));
            Assert.That(entry.StepId, Is.EqualTo("steam-turbine"));
            Assert.That(entry.StateNodeId, Is.EqualTo("node.coal-steam-turbine"));
            Assert.That(entry.DynamicTargetIds, Is.EqualTo(new[] { "node.coal-steam-turbine" }));
            Assert.That(binding.DynamicTargetIds, Is.EqualTo(new[] { "node.coal-steam-turbine" }));
            Assert.That(binding.DisplayAnchor.localPosition.x, Is.EqualTo(10000f).Within(0.001f));
            Assert.That(binding.CameraPose.parent, Is.EqualTo(prefab.transform));
            Assert.That(IsFinite(binding.CameraPose.localPosition), Is.True);
            Assert.That(IsFinite(binding.CameraPose.localEulerAngles), Is.True);

            ProcessDetailStateVisualAdapter visualAdapter = prefab.GetComponent<ProcessDetailStateVisualAdapter>();
            Assert.That(visualAdapter, Is.Not.Null);
            SerializedObject serializedVisualAdapter = new SerializedObject(visualAdapter);
            // 燃煤包装的状态反馈由蒸汽、阀门、轴能量和控制线路动态适配器统一表达，
            // 不再对整机网格叠加通用四态材质，避免透明外壳与流体效果被重复染色。
            Assert.That(serializedVisualAdapter.FindProperty("_enableStateVisuals")?.boolValue, Is.False);
            Assert.That(serializedVisualAdapter.FindProperty("_enableFaultVisual")?.boolValue, Is.False);

            MonoBehaviour dynamicAdapter = FindBehaviour(prefab, "CoalSteamTurbineProcessDetailDynamicAdapter");
            SerializedObject serializedAdapter = new SerializedObject(dynamicAdapter);
            Assert.That(serializedAdapter.FindProperty("_effectControllers")?.arraySize, Is.GreaterThan(0));
            Assert.That(serializedAdapter.FindProperty("_shaftRotationControllers")?.arraySize, Is.GreaterThan(0));

            Transform nestedModel = prefab.transform.Find("DisplayAnchor/RanMeiManager");
            Assert.That(nestedModel, Is.Not.Null);
            GameObject nestedSource = PrefabUtility.GetCorrespondingObjectFromSource(nestedModel.gameObject);
            // RanMeiManager 当前作为“燃煤燃气轮机关键环节”组合预制体中的命名实例交付，
            // 组合预制体是正式资源边界，测试同时保留层级名称校验以防错误模型被替换。
            Assert.That(nestedModel.name, Is.EqualTo("RanMeiManager"));
            Assert.That(
                AssetDatabase.GetAssetPath(nestedSource),
                Is.EqualTo("Assets/Prefabs/燃煤燃气轮机关键环节.prefab"));

            MonoBehaviour effectsController = FindBehaviour(prefab, "CoalPowerSteamEffectsController");
            SerializedObject serializedEffects = new SerializedObject(effectsController);
            Assert.That(serializedEffects.FindProperty("_allEffectsEnabled")?.boolValue, Is.True);

            MonoBehaviour shaftController = FindBehaviour(prefab, "CoalPowerShaftRotationController");
            SerializedObject serializedShaft = new SerializedObject(shaftController);
            Assert.That(serializedShaft.FindProperty("_playOnEnable")?.boolValue, Is.True);
        }

        [Test]
        public void 三个站类的保护关键环节使用显式模型绑定和四态包装()
        {
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            Assert.That(catalog, Is.Not.Null);

            string[] sceneIds = { "step-up-substation", "step-down-substation", "converter-station" };
            string[] technologies = { "step-up", "step-down", "converter" };
            string[] steps = { "transformer-protection", "busbar-protection", "line-protection" };
            string[] sourcePaths =
            {
                "Assets/Art/变电站关键环节/变压保护.fbx",
                "Assets/Art/变电站关键环节/母线保护.fbx",
                "Assets/Art/变电站关键环节/线路保护.fbx"
            };
            int[] expectedRendererCounts = { 23, 18, 16 };

            for (int sceneIndex = 0; sceneIndex < sceneIds.Length; sceneIndex++)
            {
                for (int stepIndex = 0; stepIndex < steps.Length; stepIndex++)
                {
                    string sceneId = sceneIds[sceneIndex];
                    string stepId = steps[stepIndex];
                    string detailId = $"process-detail.{sceneId}.{stepId}";
                    Assert.That(catalog.TryGet(sceneId, detailId, out ProcessDetailCatalogEntry entry), Is.True, detailId);

                    GameObject prefab = entry.EditorPrefab;
                    Assert.That(prefab, Is.Not.Null, detailId);
                    ProcessDetailDeviceBinding binding = prefab.GetComponent<ProcessDetailDeviceBinding>();
                    ProcessDetailStateVisualAdapter visualAdapter = prefab.GetComponent<ProcessDetailStateVisualAdapter>();
                    MonoBehaviour dynamicAdapter =
                        FindBehaviour(prefab, "SubstationProtectionProcessDetailDynamicAdapter");
                    Assert.That(binding, Is.Not.Null, detailId);
                    Assert.That(visualAdapter, Is.Not.Null, detailId);
                    Assert.That(dynamicAdapter, Is.Not.Null, detailId);
                    Assert.That(binding.ValidateBinding(entry).Success, Is.True, detailId);
                    Assert.That(binding.DisplayAnchor.localPosition.x, Is.EqualTo(10000f).Within(0.001f), detailId);
                    Assert.That(Vector3.Distance(binding.DisplayAnchor.position, binding.CameraPose.position), Is.GreaterThan(0.01f), detailId);
                    Assert.That(Vector3.Distance(binding.DisplayAnchor.position, binding.CameraPose.position), Is.LessThanOrEqualTo(500f), detailId);
                    Assert.That(entry.StateNodeId, Is.EqualTo(stepIndex == 0
                        ? $"node.{technologies[sceneIndex]}-transformer"
                        : stepIndex == 1
                            ? $"unit.{technologies[sceneIndex]}-protection.control"
                            : $"node.{technologies[sceneIndex]}-breaker"));

                    SerializedProperty renderers = new SerializedObject(visualAdapter).FindProperty("_renderers");
                    Assert.That(renderers, Is.Not.Null);
                    Assert.That(renderers.arraySize, Is.EqualTo(expectedRendererCounts[stepIndex]), detailId);
                    for (int rendererIndex = 0; rendererIndex < renderers.arraySize; rendererIndex++)
                    {
                        Renderer renderer = renderers.GetArrayElementAtIndex(rendererIndex).objectReferenceValue as Renderer;
                        Assert.That(renderer, Is.Not.Null, $"{detailId} 的状态视觉渲染器[{rendererIndex}]不得为空。");
                        Assert.That(renderer, Is.TypeOf<MeshRenderer>(), $"{detailId} 的状态视觉渲染器[{rendererIndex}]必须是 MeshRenderer。");
                    }
                    Transform nestedModel = binding.DisplayAnchor.GetChild(0);
                    AssertNestedModelAssetPath(nestedModel, sourcePaths[stepIndex], detailId);
                }
            }
        }

        [Test]
        public void 开关站的母线保护和线路保护使用显式模型绑定和四态包装()
        {
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            Assert.That(catalog, Is.Not.Null);

            string[] stepIds = { "busbar-protection", "line-protection" };
            string[] expectedStateNodeIds = { "unit.switching-protection.control", "node.switching-breaker" };
            string[] sourcePaths =
            {
                "Assets/Art/变电站关键环节/母线保护.fbx",
                "Assets/Art/变电站关键环节/线路保护.fbx"
            };
            int[] expectedRendererCounts = { 18, 16 };

            for (int index = 0; index < stepIds.Length; index++)
            {
                string detailId = $"process-detail.switching-station.{stepIds[index]}";
                Assert.That(catalog.TryGet("switching-station", detailId, out ProcessDetailCatalogEntry entry), Is.True, detailId);
                Assert.That(entry.StateNodeId, Is.EqualTo(expectedStateNodeIds[index]), detailId);
                GameObject prefab = entry.EditorPrefab;
                Assert.That(prefab, Is.Not.Null, detailId);
                ProcessDetailDeviceBinding binding = prefab.GetComponent<ProcessDetailDeviceBinding>();
                ProcessDetailStateVisualAdapter visualAdapter = prefab.GetComponent<ProcessDetailStateVisualAdapter>();
                Assert.That(binding, Is.Not.Null, detailId);
                Assert.That(visualAdapter, Is.Not.Null, detailId);
                Assert.That(FindBehaviour(prefab, "SubstationProtectionProcessDetailDynamicAdapter"), Is.Not.Null, detailId);
                Assert.That(binding.ValidateBinding(entry).Success, Is.True, detailId);
                Assert.That(binding.DisplayAnchor.localPosition.x, Is.EqualTo(10000f).Within(0.001f), detailId);
                Assert.That(Vector3.Distance(binding.DisplayAnchor.position, binding.CameraPose.position), Is.GreaterThan(0.01f), detailId);
                Assert.That(Vector3.Distance(binding.DisplayAnchor.position, binding.CameraPose.position), Is.LessThanOrEqualTo(500f), detailId);

                SerializedProperty renderers = new SerializedObject(visualAdapter).FindProperty("_renderers");
                Assert.That(renderers, Is.Not.Null, detailId);
                Assert.That(renderers.arraySize, Is.EqualTo(expectedRendererCounts[index]), detailId);
                for (int rendererIndex = 0; rendererIndex < renderers.arraySize; rendererIndex++)
                {
                    Renderer renderer = renderers.GetArrayElementAtIndex(rendererIndex).objectReferenceValue as Renderer;
                    Assert.That(renderer, Is.Not.Null, $"{detailId} 的状态视觉渲染器[{rendererIndex}]不得为空。");
                    Assert.That(renderer, Is.TypeOf<MeshRenderer>(), $"{detailId} 的状态视觉渲染器[{rendererIndex}]必须是 MeshRenderer。");
                }
                Transform nestedModel = binding.DisplayAnchor.GetChild(0);
                AssertNestedModelAssetPath(nestedModel, sourcePaths[index], detailId);
            }
        }
        [Test]
        public void 燃煤设备状态驱动全部受控特效且故障进入惯性停机()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(CoalPrefabPath);
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            Assert.That(
                catalog.TryGet("coal-power", "process-detail.coal-power.steam-turbine", out ProcessDetailCatalogEntry coalEntry),
                Is.True);
            GameObject instance = Object.Instantiate(prefab);
            instance.SetActive(false);
            try
            {
                ProcessDetailDeviceBinding binding = instance.GetComponent<ProcessDetailDeviceBinding>();
                Assert.That(binding.ValidateBinding(coalEntry).Success, Is.True);

                Assert.That(binding.PrepareForActivation(true, BusinessSceneNodeVisualState.Fault).Success, Is.True);
                AssertCombinedCoalFaultCoasting(instance);
                instance.SetActive(true);
                AssertCombinedCoalFaultCoasting(instance);
                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Alarm).Success, Is.True);
                AssertCombinedCoalPlaybackAllowed(instance, true);
                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Offline).Success, Is.True);
                AssertCombinedCoalPlaybackAllowed(instance, true);
                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Normal).Success, Is.True);
                AssertCombinedCoalPlaybackAllowed(instance, true);
                Assert.That(binding.ClearVisualState().Success, Is.True);
                AssertCombinedCoalPlaybackAllowed(instance, true);
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        /// <summary>
        /// 验证 9.28 版模型故障只把反向逆变器、电线.001 和汇流箱按闪烁强度变红，
        /// 其它逆变器与线路保持基础颜色，七条线路流光在故障期间保持播放、退出时停播、恢复后还原。
        /// </summary>
        [Test]
        public void 光伏逆变器包装故障时指定设备闪烁变红且线路流光保持播放()
        {
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(SolarPrefabPath);
            Assert.That(prefab, Is.Not.Null);
            Assert.That(
                catalog.TryGet("solar-power", "process-detail.solar-power.inverter", out ProcessDetailCatalogEntry entry),
                Is.True);

            GameObject instance = Object.Instantiate(prefab);
            instance.SetActive(false);
            try
            {
                ProcessDetailDeviceBinding binding = instance.GetComponent<ProcessDetailDeviceBinding>();
                Assert.That(binding, Is.Not.Null);
                Assert.That(binding.ValidateBinding(entry).Success, Is.True);

                Transform modelRoot = instance.transform.Find("DisplayAnchor/逆变器关键环节9.28");
                Assert.That(modelRoot, Is.Not.Null, "第三层必须加载 9.28 版逆变器关键环节模型。");
                Renderer[] faultEquipment =
                {
                    modelRoot.Find("逆变器（反向）").GetComponent<Renderer>(),
                    modelRoot.Find("电线.001").GetComponent<Renderer>(),
                    modelRoot.Find("汇流箱").GetComponent<Renderer>()
                };
                Renderer[] otherLines =
                {
                    modelRoot.Find("电线").GetComponent<Renderer>(),
                    modelRoot.Find("电线.002").GetComponent<Renderer>(),
                    modelRoot.Find("电线.003").GetComponent<Renderer>(),
                    modelRoot.Find("电线.004").GetComponent<Renderer>(),
                    modelRoot.Find("电线.005").GetComponent<Renderer>(),
                    modelRoot.Find("控制线").GetComponent<Renderer>()
                };
                Renderer[] unaffectedInverters =
                {
                    modelRoot.Find("逆变器.001").GetComponent<Renderer>(),
                    modelRoot.Find("逆变器.002").GetComponent<Renderer>()
                };
                // 故障适配器与流光组件位于 Assembly-CSharp，测试程序集只引用 Runtime 程序集，
                // 因此按类型名查找并通过反射读取公开只读属性（与 SolarInverterProcessDetailFlowTests 同款惯例）。
                Component faultAdapter = instance.GetComponent("SolarInverterFaultVisualAdapter");
                Assert.That(faultAdapter, Is.Not.Null, "预制体根必须装配逆变器故障视觉适配器。");
                PropertyInfo faultColorProperty = faultAdapter.GetType().GetProperty("FaultColor");
                Assert.That(faultColorProperty, Is.Not.Null, "故障适配器必须公开只读故障色。");
                Color faultColor = (Color)faultColorProperty.GetValue(faultAdapter);
                PropertyInfo blinkStrengthProperty = faultAdapter.GetType().GetProperty("CurrentBlinkStrength");
                Assert.That(blinkStrengthProperty, Is.Not.Null, "故障适配器必须公开当前闪烁强度。");
                Color[][] equipmentBaselines = new Color[faultEquipment.Length][];
                for (int index = 0; index < faultEquipment.Length; index++)
                {
                    equipmentBaselines[index] = CaptureBaselineColors(faultEquipment[index]);
                }

                MaterialPropertyBlock propertyBlock = new MaterialPropertyBlock();
                Assert.That(binding.PrepareForActivation(true, BusinessSceneNodeVisualState.Fault).Success, Is.True);

                // 故障设备：每个底色材质槽都必须等于 故障色×当前闪烁强度，并保留基础透明度。
                float strength = (float)blinkStrengthProperty.GetValue(faultAdapter);
                Assert.That(strength, Is.InRange(0.35f, 1f), "闪烁强度必须位于设计的呼吸区间。");
                for (int index = 0; index < faultEquipment.Length; index++)
                {
                    AssertBlinkColor(faultEquipment[index], faultColor, strength, equipmentBaselines[index], propertyBlock);
                }
                for (int index = 0; index < unaffectedInverters.Length; index++)
                {
                    AssertNoColorOverride(unaffectedInverters[index], propertyBlock, "单点故障不得把其它逆变器染红");
                }
                for (int index = 0; index < otherLines.Length; index++)
                {
                    AssertNoColorOverride(otherLines[index], propertyBlock, "单点故障不得把其它线路染红");
                }
                // 用户需求：故障只驱动设备红色闪烁，其它线路的流光不受故障影响。
                AssertFlowPlayback(modelRoot, true, "故障期间");

                // 退出关键环节必须停掉全部流光。
                binding.StopForRelease();
                AssertFlowPlayback(modelRoot, false, "退出停播");

                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Alarm).Success, Is.True);
                for (int index = 0; index < faultEquipment.Length; index++)
                {
                    AssertRestoredColors(faultEquipment[index], equipmentBaselines[index], propertyBlock);
                }
                AssertFlowPlayback(modelRoot, true, "恢复播放");
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        /// <summary>捕获渲染器全部底色材质槽的基础颜色，供故障闪烁与恢复断言复用。</summary>
        private static Color[] CaptureBaselineColors(Renderer renderer)
        {
            Material[] materials = renderer.sharedMaterials;
            Color[] baselines = new Color[materials.Length];
            for (int index = 0; index < materials.Length; index++)
            {
                int propertyId = FindColorPropertyId(materials[index]);
                baselines[index] = materials[index].GetColor(propertyId);
            }
            return baselines;
        }

        /// <summary>逐材质槽核对故障闪烁颜色：等于 故障色×闪烁强度，透明度保持基础值。</summary>
        private static void AssertBlinkColor(
            Renderer renderer, Color faultColor, float strength, Color[] baselines, MaterialPropertyBlock propertyBlock)
        {
            Material[] materials = renderer.sharedMaterials;
            for (int index = 0; index < materials.Length; index++)
            {
                int propertyId = FindColorPropertyId(materials[index]);
                propertyBlock.Clear();
                renderer.GetPropertyBlock(propertyBlock, index);
                Assert.That(propertyBlock.HasColor(propertyId), Is.True,
                    $"{renderer.name} 材质槽 {index} 故障时必须写入闪烁颜色。");
                Color blinkColor = propertyBlock.GetColor(propertyId);
                Assert.That(blinkColor.r, Is.EqualTo(faultColor.r * strength).Within(0.001f),
                    $"{renderer.name} 材质槽 {index} 红色分量必须跟随闪烁强度。");
                Assert.That(blinkColor.g, Is.EqualTo(faultColor.g * strength).Within(0.001f),
                    $"{renderer.name} 材质槽 {index} 绿色分量必须跟随闪烁强度。");
                Assert.That(blinkColor.b, Is.EqualTo(faultColor.b * strength).Within(0.001f),
                    $"{renderer.name} 材质槽 {index} 蓝色分量必须跟随闪烁强度。");
                Assert.That(blinkColor.a, Is.EqualTo(baselines[index].a).Within(0.001f),
                    $"{renderer.name} 材质槽 {index} 闪烁不得改变基础透明度。");
            }
        }

        /// <summary>核对未参与故障的渲染器没有任何底色属性块覆盖。</summary>
        private static void AssertNoColorOverride(Renderer renderer, MaterialPropertyBlock propertyBlock, string message)
        {
            int baseColorPropertyId = Shader.PropertyToID("_BaseColor");
            int alternateBaseColorPropertyId = Shader.PropertyToID("_BASE_COLOR");
            Material[] materials = renderer.sharedMaterials;
            for (int index = 0; index < materials.Length; index++)
            {
                Material material = materials[index];
                if (material == null ||
                    (!material.HasProperty(baseColorPropertyId) && !material.HasProperty(alternateBaseColorPropertyId)))
                {
                    continue;
                }
                int propertyId = FindColorPropertyId(material);
                propertyBlock.Clear();
                renderer.GetPropertyBlock(propertyBlock, index);
                Assert.That(propertyBlock.HasColor(propertyId), Is.False,
                    $"{message}：{renderer.name} 材质槽 {index} 不应被故障染色。");
            }
        }

        /// <summary>核对恢复非故障状态后每个底色材质槽都回到基础颜色。</summary>
        private static void AssertRestoredColors(Renderer renderer, Color[] baselines, MaterialPropertyBlock propertyBlock)
        {
            Material[] materials = renderer.sharedMaterials;
            for (int index = 0; index < materials.Length; index++)
            {
                int propertyId = FindColorPropertyId(materials[index]);
                propertyBlock.Clear();
                renderer.GetPropertyBlock(propertyBlock, index);
                Color restoredColor = propertyBlock.GetColor(propertyId);
                Assert.That(restoredColor.r, Is.EqualTo(baselines[index].r).Within(0.0001f),
                    $"{renderer.name} 材质槽 {index} 恢复后红色分量必须回到基础颜色。");
                Assert.That(restoredColor.g, Is.EqualTo(baselines[index].g).Within(0.0001f),
                    $"{renderer.name} 材质槽 {index} 恢复后绿色分量必须回到基础颜色。");
                Assert.That(restoredColor.b, Is.EqualTo(baselines[index].b).Within(0.0001f),
                    $"{renderer.name} 材质槽 {index} 恢复后蓝色分量必须回到基础颜色。");
                Assert.That(restoredColor.a, Is.EqualTo(baselines[index].a).Within(0.0001f),
                    $"{renderer.name} 材质槽 {index} 恢复后透明度必须回到基础值。");
            }
        }

        /// <summary>核对模型根下全部线路流光组件的播放许可。</summary>
        private static void AssertFlowPlayback(Transform modelRoot, bool expected, string label)
        {
            foreach (Transform wire in modelRoot)
            {
                Component effect = wire.GetComponent("ControlCircuitElectronFlowEffect");
                if (effect == null)
                {
                    continue;
                }
                PropertyInfo playbackProperty = effect.GetType().GetProperty("IsPlaybackEnabled");
                Assert.That(playbackProperty, Is.Not.Null, "流光效果必须公开只读播放状态。");
                Assert.That(playbackProperty.GetValue(effect), Is.EqualTo(expected),
                    $"{wire.name} 在{label}的播放许可不正确。");
            }
        }

        /// <summary>识别光伏 FBX 实际导入的 URP 或物理材质底色属性。</summary>
        private static int FindColorPropertyId(Material material)
        {
            int baseColorPropertyId = Shader.PropertyToID("_BaseColor");
            if (material != null && material.HasProperty(baseColorPropertyId))
            {
                return baseColorPropertyId;
            }

            int alternateColorPropertyId = Shader.PropertyToID("_BASE_COLOR");
            Assert.That(material != null && material.HasProperty(alternateColorPropertyId), Is.True,
                $"材质 {material?.name ?? "<null>"} 不支持故障底色属性。");
            return alternateColorPropertyId;
        }

        [Test]
        public void 设备状态驱动动态播放且历史命令不能覆盖状态()
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

                // 故障状态必须在实例首次显示前停止全部动态效果。
                Assert.That(binding.PrepareForActivation(true, BusinessSceneNodeVisualState.Fault).Success, Is.True);
                AssertPlaybackAllowed(instance, false);

                Assert.That(binding.SetPlayback(true).Success, Is.True);
                AssertPlaybackAllowed(instance, false);
                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Normal).Success, Is.True);
                AssertPlaybackAllowed(instance, true);
                Assert.That(binding.ClearVisualState().Success, Is.True);
                AssertPlaybackAllowed(instance, true);

                Assert.That(binding.SetPlayback(false).Success, Is.True);
                AssertPlaybackAllowed(instance, true);
                Assert.That(binding.SetPlayback(false).Success, Is.True);
                AssertPlaybackAllowed(instance, true);
                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Fault).Success, Is.True);
                AssertPlaybackAllowed(instance, false);
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        [Test]
        public void 四个站类场景装配协调器加载器挂载点且十一项均可进入退出()
        {
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>(CatalogPath);
            Assert.That(catalog, Is.Not.Null);

            string[] sceneIds = { "step-up-substation", "step-down-substation", "converter-station", "switching-station" };
            string[] scenePaths =
            {
                "Assets/Scenes/Business/StepUpSubstation.unity",
                "Assets/Scenes/Business/StepDownSubstation.unity",
                "Assets/Scenes/Business/ConverterStation.unity",
                "Assets/Scenes/Business/SwitchingStation.unity"
            };
            string[] processIds =
            {
                "step-up-substation-operation",
                "step-down-substation-operation",
                "converter-station-operation",
                "switching-station-operation"
            };
            string[][] stepIdsByScene =
            {
                new[] { "transformer-protection", "busbar-protection", "line-protection" },
                new[] { "transformer-protection", "busbar-protection", "line-protection" },
                new[] { "transformer-protection", "busbar-protection", "line-protection" },
                new[] { "busbar-protection", "line-protection" }
            };

            for (int sceneIndex = 0; sceneIndex < sceneIds.Length; sceneIndex++)
            {
                Scene scene = SceneManager.GetSceneByPath(scenePaths[sceneIndex]);
                bool openedForTest = !scene.IsValid() || !scene.isLoaded;
                if (openedForTest)
                {
                    scene = EditorSceneManager.OpenScene(scenePaths[sceneIndex], OpenSceneMode.Additive);
                }

                try
                {
                    GameObject runtimeRoot = null;
                    GameObject[] roots = scene.GetRootGameObjects();
                    for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
                    {
                        if (roots[rootIndex].name == "PowerPlantRuntime")
                        {
                            runtimeRoot = roots[rootIndex];
                            break;
                        }
                    }
                    Assert.That(runtimeRoot, Is.Not.Null, scenePaths[sceneIndex]);
                    ProcessDetailCoordinator coordinator = runtimeRoot.GetComponent<ProcessDetailCoordinator>();
                    ProcessDetailAssetBundleLoader loader = runtimeRoot.GetComponent<ProcessDetailAssetBundleLoader>();
                    Assert.That(coordinator, Is.Not.Null, scenePaths[sceneIndex]);
                    Assert.That(loader, Is.Not.Null, scenePaths[sceneIndex]);

                    SerializedObject serializedCoordinator = new SerializedObject(coordinator);
                    Assert.That(
                        serializedCoordinator.FindProperty("_catalog")?.objectReferenceValue,
                        Is.EqualTo(catalog),
                        scenePaths[sceneIndex]);
                    Assert.That(
                        serializedCoordinator.FindProperty("_resourceLoaderBehaviour")?.objectReferenceValue,
                        Is.EqualTo(loader),
                        scenePaths[sceneIndex]);

                    Transform detailMount = serializedCoordinator.FindProperty("_detailMount")?.objectReferenceValue as Transform;
                    Transform businessSceneRoot = serializedCoordinator.FindProperty("_businessSceneRoot")?.objectReferenceValue as Transform;
                    Assert.That(detailMount, Is.Not.Null, scenePaths[sceneIndex]);
                    Assert.That(businessSceneRoot, Is.Not.Null, scenePaths[sceneIndex]);
                    Assert.That(detailMount.IsChildOf(businessSceneRoot), Is.False,
                        $"第三层挂载点不能位于二层根节点内：{scenePaths[sceneIndex]}");

                    MonoBehaviour cameraController =
                        serializedCoordinator.FindProperty("_cameraControllerBehaviour")?.objectReferenceValue as MonoBehaviour;
                    Assert.That(cameraController, Is.Not.Null, scenePaths[sceneIndex]);
                    Assert.That(cameraController.GetComponent<Camera>(), Is.Not.Null, scenePaths[sceneIndex]);
                    FieldInfo cameraField = cameraController.GetType().GetField(
                        "_camera",
                        BindingFlags.Instance | BindingFlags.NonPublic);
                    Assert.That(cameraField, Is.Not.Null, "自由相机缺少可编辑模式验证所需的内部相机字段。 ");
                    // EditMode 测试不会触发 MonoBehaviour.Awake；补齐私有缓存后执行与运行时相同的相机快照路径。
                    cameraField.SetValue(cameraController, cameraController.GetComponent<Camera>());

                    Assert.That(coordinator.Initialize().Success, Is.True, scenePaths[sceneIndex]);
                    string[] stepIds = stepIdsByScene[sceneIndex];
                    for (int stepIndex = 0; stepIndex < stepIds.Length; stepIndex++)
                    {
                        string processDetailId = $"process-detail.{sceneIds[sceneIndex]}.{stepIds[stepIndex]}";
                        Assert.That(
                            catalog.TryGet(sceneIds[sceneIndex], processDetailId, out ProcessDetailCatalogEntry entry),
                            Is.True,
                            processDetailId);

                        string transitionId = $"transition.edit-mode.{sceneIds[sceneIndex]}.{stepIds[stepIndex]}";
                        BusinessSceneCommandResult enterResult = default;
                        Run(coordinator.EnterAsync(
                            sceneIds[sceneIndex],
                            processIds[sceneIndex],
                            stepIds[stepIndex],
                            processDetailId,
                            transitionId,
                            result => enterResult = result));
                        Assert.That(enterResult.Success, Is.True,
                            $"第三层进入失败：{processDetailId}，{enterResult.ErrorCode}，{enterResult.Message}");
                        Assert.That(coordinator.IsActive, Is.True, processDetailId);
                        Assert.That(coordinator.ActiveProcessDetailId, Is.EqualTo(entry.ProcessDetailId), processDetailId);

                        BusinessSceneCommandResult exitResult = coordinator.Exit(
                            sceneIds[sceneIndex], processDetailId, transitionId);
                        Assert.That(exitResult.Success, Is.True,
                            $"第三层退出失败：{processDetailId}，{exitResult.ErrorCode}，{exitResult.Message}");
                        Assert.That(coordinator.IsActive, Is.False, processDetailId);
                    }
                }
                finally
                {
                    if (openedForTest && scene.IsValid() && scene.isLoaded)
                    {
                        EditorSceneManager.CloseScene(scene, true);
                    }
                }
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

        private static bool IsFinite(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x) &&
                   !float.IsNaN(value.y) && !float.IsInfinity(value.y) &&
                   !float.IsNaN(value.z) && !float.IsInfinity(value.z);
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
                "node.gas-turbine",
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
            Assert.That(entry.StateNodeId, Is.EqualTo("node.gas-turbine"));
        }

        private static void AssertPlaybackAllowed(GameObject root, bool expected)
        {
            string[] controllerNames =
            {
                "WaiKeHeBingMasterController"
            };
            for (int index = 0; index < controllerNames.Length; index++)
            {
                MonoBehaviour controller = FindBehaviour(root, controllerNames[index]);
                FieldInfo field = controller.GetType().GetField("_isPlaying", BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(field, Is.Not.Null, $"{controllerNames[index]} 缺少动态播放状态字段。");
                Assert.That(field.GetValue(controller), Is.EqualTo(expected), $"{controllerNames[index]} 播放许可错误。");
            }
        }

        private static void AssertCombinedCoalPlaybackAllowed(GameObject root, bool expected)
        {
            MonoBehaviour effectsController = FindBehaviour(root, "CoalPowerSteamEffectsController");
            FieldInfo effectsField = effectsController.GetType().GetField(
                "_allEffectsEnabled",
                BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(effectsField, Is.Not.Null, "CoalPowerSteamEffectsController 缺少动态播放状态字段。");
            Assert.That(effectsField.GetValue(effectsController), Is.EqualTo(expected), "燃煤组合特效播放许可错误。");

            MonoBehaviour shaftController = FindBehaviour(root, "CoalPowerShaftRotationController");
            FieldInfo field = shaftController.GetType().GetField(
                "_animationEnabled",
                BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(field, Is.Not.Null, "CoalPowerShaftRotationController 缺少动态播放状态字段。");
            Assert.That(field.GetValue(shaftController), Is.EqualTo(expected), "燃煤轴旋转播放许可错误。");
            Assert.That(shaftController.enabled, Is.EqualTo(expected), "燃煤轴旋转组件启用状态错误。");
        }

        /// <summary>
        /// 故障状态立即关闭组合特效，但轴按产品约定进入延迟减速阶段；此时旋转许可暂时保留，
        /// 并由控制器内部的惯性标志阻止 OnEnable 将故障准备状态重置为普通播放。
        /// </summary>
        private static void AssertCombinedCoalFaultCoasting(GameObject root)
        {
            MonoBehaviour effectsController = FindBehaviour(root, "CoalPowerSteamEffectsController");
            FieldInfo effectsField = effectsController.GetType().GetField(
                "_allEffectsEnabled",
                BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(effectsField, Is.Not.Null, "CoalPowerSteamEffectsController 缺少动态播放状态字段。");
            Assert.That(effectsField.GetValue(effectsController), Is.EqualTo(false), "燃煤故障时组合特效必须立即停止。");

            MonoBehaviour shaftController = FindBehaviour(root, "CoalPowerShaftRotationController");
            FieldInfo animationField = shaftController.GetType().GetField(
                "_animationEnabled",
                BindingFlags.Instance | BindingFlags.NonPublic);
            FieldInfo coastingField = shaftController.GetType().GetField(
                "_coasting",
                BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(animationField, Is.Not.Null, "CoalPowerShaftRotationController 缺少动态播放状态字段。");
            Assert.That(coastingField, Is.Not.Null, "CoalPowerShaftRotationController 缺少惯性停机状态字段。");
            Assert.That(animationField.GetValue(shaftController), Is.EqualTo(true), "燃煤轴故障惯性阶段必须保留旋转许可。");
            Assert.That(coastingField.GetValue(shaftController), Is.EqualTo(true), "燃煤轴故障时必须进入惯性停机阶段。");
            Assert.That(shaftController.enabled, Is.True, "燃煤轴故障惯性阶段必须保持组件启用。");
        }

        /// <summary>
        /// 变电保护模型允许为了制作包装而解包根预制体，因此不能依赖根对象仍保留 Prefab 来源关系；
        /// 通过实际渲染网格的共享 Mesh 反查 FBX，既验证生产模型来源，也兼容解包后的显式组件绑定。
        /// </summary>
        private static void AssertNestedModelAssetPath(
            Transform nestedModel,
            string expectedAssetPath,
            string context)
        {
            Assert.That(nestedModel, Is.Not.Null, context);
            MeshFilter[] meshFilters = nestedModel.GetComponentsInChildren<MeshFilter>(true);
            Assert.That(meshFilters, Is.Not.Empty, $"{context} 必须包含来自正式 FBX 的网格。");

            HashSet<string> meshAssetPaths = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < meshFilters.Length; index++)
            {
                Mesh sharedMesh = meshFilters[index].sharedMesh;
                if (sharedMesh != null)
                {
                    meshAssetPaths.Add(AssetDatabase.GetAssetPath(sharedMesh));
                }
            }

            Assert.That(meshAssetPaths, Does.Contain(expectedAssetPath), context);
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
