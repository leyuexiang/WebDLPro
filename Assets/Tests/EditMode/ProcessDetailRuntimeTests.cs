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
            Assert.That(catalog.Entries.Count, Is.EqualTo(14), "当前应登记燃气轮机、燃煤汽轮机、光伏逆变器、三个站类的九项保护关键环节以及开关站的母线保护和线路保护。");

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

            MonoBehaviour animationController = FindBehaviour(prefab, "WaiKeHeBingAnimationController");
            MonoBehaviour volumeController = FindBehaviour(prefab, "WaiKeHeBingGasVolumeController");
            AssertSerializedRenderersExcluded(animationController, "_rightShellRenderers", visualRenderers);
            AssertSerializedRendererExcluded(volumeController, "_blueVolumeRenderer", visualRenderers);
            AssertSerializedRendererExcluded(volumeController, "_redVolumeRenderer", visualRenderers);
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
            Assert.That(serializedVisualAdapter.FindProperty("_enableStateVisuals")?.boolValue, Is.True);
            Assert.That(serializedVisualAdapter.FindProperty("_enableFaultVisual")?.boolValue, Is.False);

            MonoBehaviour dynamicAdapter = FindBehaviour(prefab, "CoalSteamTurbineProcessDetailDynamicAdapter");
            SerializedObject serializedAdapter = new SerializedObject(dynamicAdapter);
            Assert.That(serializedAdapter.FindProperty("_effectControllers")?.arraySize, Is.GreaterThan(0));
            Assert.That(serializedAdapter.FindProperty("_shaftRotationControllers")?.arraySize, Is.GreaterThan(0));

            Transform nestedModel = prefab.transform.Find("DisplayAnchor/RanMeiManager");
            Assert.That(nestedModel, Is.Not.Null);
            GameObject nestedSource = PrefabUtility.GetCorrespondingObjectFromSource(nestedModel.gameObject);
            Assert.That(AssetDatabase.GetAssetPath(nestedSource), Is.EqualTo("Assets/Prefabs/RanMeiManager.prefab"));

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
                    Object source = PrefabUtility.GetCorrespondingObjectFromSource(nestedModel.gameObject);
                    Assert.That(AssetDatabase.GetAssetPath(source), Is.EqualTo(sourcePaths[stepIndex]), detailId);
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
            int[] expectedRendererCounts = { 18, 15 };

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
                Object source = PrefabUtility.GetCorrespondingObjectFromSource(nestedModel.gameObject);
                Assert.That(AssetDatabase.GetAssetPath(source), Is.EqualTo(sourcePaths[index]), detailId);
            }
        }
        [Test]
        public void 燃煤设备状态驱动全部受控特效且只有故障停播()
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
                AssertCombinedCoalPlaybackAllowed(instance, false);
                instance.SetActive(true);
                AssertCombinedCoalPlaybackAllowed(instance, false);
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

        [Test]
        public void 光伏逆变器包装仅在故障时停流并将材质002变红()
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

                Renderer[] wires =
                {
                    instance.transform.Find("DisplayAnchor/逆变器关键环节/电线1").GetComponent<Renderer>(),
                    instance.transform.Find("DisplayAnchor/逆变器关键环节/电线2").GetComponent<Renderer>(),
                    instance.transform.Find("DisplayAnchor/逆变器关键环节/电线3").GetComponent<Renderer>()
                };
                Renderer[] inverters =
                {
                    instance.transform.Find("DisplayAnchor/逆变器关键环节/逆变器").GetComponent<Renderer>(),
                    instance.transform.Find("DisplayAnchor/逆变器关键环节/逆变器.001").GetComponent<Renderer>(),
                    instance.transform.Find("DisplayAnchor/逆变器关键环节/逆变器.002").GetComponent<Renderer>()
                };
                int flowSpeedId = Shader.PropertyToID("_FlowSpeed");
                int baseColorId = Shader.PropertyToID("_BaseColor");
                MaterialPropertyBlock propertyBlock = new MaterialPropertyBlock();
                Color[] baselineColors = new Color[inverters.Length];
                for (int index = 0; index < inverters.Length; index++)
                {
                    baselineColors[index] = inverters[index].sharedMaterials[1].GetColor(baseColorId);
                }

                Assert.That(binding.PrepareForActivation(true, BusinessSceneNodeVisualState.Fault).Success, Is.True);
                for (int index = 0; index < wires.Length; index++)
                {
                    propertyBlock.Clear();
                    wires[index].GetPropertyBlock(propertyBlock, 0);
                    Assert.That(propertyBlock.GetFloat(flowSpeedId), Is.Zero, $"电线{index + 1}故障时必须停流。");
                }
                for (int index = 0; index < inverters.Length; index++)
                {
                    propertyBlock.Clear();
                    inverters[index].GetPropertyBlock(propertyBlock, 1);
                    Color faultColor = propertyBlock.GetColor(baseColorId);
                    Assert.That(faultColor.r, Is.GreaterThan(0.9f));
                    Assert.That(faultColor.g, Is.LessThan(0.1f));
                    Assert.That(faultColor.b, Is.LessThan(0.1f));
                }

                Assert.That(binding.ApplyVisualState(BusinessSceneNodeVisualState.Alarm).Success, Is.True);
                for (int index = 0; index < wires.Length; index++)
                {
                    propertyBlock.Clear();
                    wires[index].GetPropertyBlock(propertyBlock, 0);
                    Assert.That(propertyBlock.GetFloat(flowSpeedId), Is.EqualTo(1f).Within(0.0001f));
                }
                for (int index = 0; index < inverters.Length; index++)
                {
                    propertyBlock.Clear();
                    inverters[index].GetPropertyBlock(propertyBlock, 1);
                    Color restoredColor = propertyBlock.GetColor(baseColorId);
                    Assert.That(restoredColor.r, Is.EqualTo(baselineColors[index].r).Within(0.0001f));
                    Assert.That(restoredColor.g, Is.EqualTo(baselineColors[index].g).Within(0.0001f));
                    Assert.That(restoredColor.b, Is.EqualTo(baselineColors[index].b).Within(0.0001f));
                    Assert.That(restoredColor.a, Is.EqualTo(baselineColors[index].a).Within(0.0001f));
                }
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
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
