using System.Collections;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 验证总览建筑状态入口只操作呈现器接口，并保证初始化缺少呈现组件时明确失败。
    /// 测试不创建高亮插件组件，避免编辑器测试把播放期渲染资源误带入场景。
    /// </summary>
    public sealed class OverviewBuildingVisualStatePresenterTests
    {
        private sealed class TestPresenter : MonoBehaviour, IOverviewBuildingVisualStatePresenter
        {
            public int ApplyCount { get; private set; }
            public int ClearCount { get; private set; }
            public int ReleaseCount { get; private set; }
            public BusinessSceneNodeVisualState LastState { get; private set; }

            public void ApplyVisualState(BusinessSceneNodeVisualState visualState)
            {
                ApplyCount++;
                LastState = visualState;
            }

            public void ClearVisualState()
            {
                ClearCount++;
                LastState = BusinessSceneNodeVisualState.Normal;
            }

            public void ReleaseVisualState()
            {
                ReleaseCount++;
            }
        }

        private sealed class TestCameraPoseController : MonoBehaviour, IBusinessSceneCameraPoseController
        {
            public int ResetCount { get; private set; }

            public void MoveToPose(Transform targetPose)
            {
            }

            public void ResetToInitialTransform()
            {
                ResetCount++;
            }
        }

        /// <summary>未知目标场景必须在初始化边界被拒绝，不能等到点击后再按名称猜测或交给协调器兜底。</summary>
        [Test]
        public void 总览初始化拒绝未知目标场景()
        {
            GameObject runtimeRoot = new GameObject("OverviewUnknownTargetTestRoot");
            GameObject cameraObject = new GameObject("OverviewUnknownTargetTestCamera");
            GameObject building = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                building.transform.SetParent(runtimeRoot.transform, false);
                TestPresenter presenter = building.AddComponent<TestPresenter>();
                OverviewBuildingPlaceholder placeholder = building.AddComponent<OverviewBuildingPlaceholder>();
                placeholder.ConfigureForEditor(
                    "overview-building.invalid",
                    "unknown-scene",
                    building.GetComponent<Renderer>(),
                    building.GetComponent<Collider>(),
                    presenter);
                OverviewSceneController controller = runtimeRoot.AddComponent<OverviewSceneController>();
                controller.ConfigureForEditor(cameraObject.AddComponent<Camera>());

                BusinessSceneCommandResult initializationResult = default;
                IEnumerator initialization = controller.InitializeAsync(
                    new BusinessSceneInitializationContext("overview", "overview", "transition.invalid", false),
                    result => initializationResult = result);
                while (initialization.MoveNext())
                {
                }

                Assert.That(initializationResult.Success, Is.False);
                Assert.That(initializationResult.ErrorCode, Is.EqualTo("overview-building-binding-invalid"));
            }
            finally
            {
                Object.DestroyImmediate(building);
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(runtimeRoot);
            }
        }

        /// <summary>两个建筑不能指向同一业务场景，防止模型替换或复制对象后形成歧义下钻入口。</summary>
        [Test]
        public void 总览初始化拒绝重复目标场景()
        {
            GameObject runtimeRoot = new GameObject("OverviewDuplicateTargetTestRoot");
            GameObject cameraObject = new GameObject("OverviewDuplicateTargetTestCamera");
            GameObject firstBuilding = GameObject.CreatePrimitive(PrimitiveType.Cube);
            GameObject secondBuilding = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                firstBuilding.transform.SetParent(runtimeRoot.transform, false);
                secondBuilding.transform.SetParent(runtimeRoot.transform, false);
                OverviewBuildingPlaceholder first = firstBuilding.AddComponent<OverviewBuildingPlaceholder>();
                TestPresenter firstPresenter = firstBuilding.AddComponent<TestPresenter>();
                first.ConfigureForEditor(
                    "overview-building.first",
                    "coal-power",
                    firstBuilding.GetComponent<Renderer>(),
                    firstBuilding.GetComponent<Collider>(),
                    firstPresenter);
                OverviewBuildingPlaceholder second = secondBuilding.AddComponent<OverviewBuildingPlaceholder>();
                TestPresenter secondPresenter = secondBuilding.AddComponent<TestPresenter>();
                second.ConfigureForEditor(
                    "overview-building.second",
                    "coal-power",
                    secondBuilding.GetComponent<Renderer>(),
                    secondBuilding.GetComponent<Collider>(),
                    secondPresenter);
                OverviewSceneController controller = runtimeRoot.AddComponent<OverviewSceneController>();
                controller.ConfigureForEditor(cameraObject.AddComponent<Camera>());

                BusinessSceneCommandResult initializationResult = default;
                IEnumerator initialization = controller.InitializeAsync(
                    new BusinessSceneInitializationContext("overview", "overview", "transition.duplicate", false),
                    result => initializationResult = result);
                while (initialization.MoveNext())
                {
                }

                Assert.That(initializationResult.Success, Is.False);
                Assert.That(initializationResult.ErrorCode, Is.EqualTo("overview-building-target-scene-duplicate"));
            }
            finally
            {
                Object.DestroyImmediate(secondBuilding);
                Object.DestroyImmediate(firstBuilding);
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(runtimeRoot);
            }
        }

        [Test]
        public void 总览建筑按配置聚合多个故障来源且最后一个清除后才恢复()
        {
            GameObject runtimeRoot = new GameObject("OverviewConfiguredFaultSourcesRoot");
            GameObject cameraObject = new GameObject("OverviewConfiguredFaultSourcesCamera");
            GameObject building = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                building.transform.SetParent(runtimeRoot.transform, false);
                TestPresenter presenter = building.AddComponent<TestPresenter>();
                OverviewBuildingPlaceholder placeholder = building.AddComponent<OverviewBuildingPlaceholder>();
                placeholder.ConfigureForEditor(
                    "overview-building.configured-fault",
                    "coal-power",
                    building.GetComponent<Renderer>(),
                    building.GetComponent<Collider>(),
                    presenter);
                placeholder.ConfigureFaultSourceNodeIdsForEditor(new[]
                {
                    "asset.test.primary",
                    "asset.test.backup"
                });

                OverviewSceneController controller = runtimeRoot.AddComponent<OverviewSceneController>();
                controller.ConfigureForEditor(cameraObject.AddComponent<Camera>());
                BusinessSceneCommandResult initializationResult = default;
                IEnumerator initialization = controller.InitializeAsync(
                    new BusinessSceneInitializationContext("overview", "overview", "transition.configured-fault", false),
                    result => initializationResult = result);
                while (initialization.MoveNext())
                {
                }

                Assert.That(initializationResult.Success, Is.True, initializationResult.Message);
                Assert.That(
                    controller.ApplyFaultSourceVisualState("asset.test.primary", BusinessSceneNodeVisualState.Fault).Success,
                    Is.True);
                Assert.That(
                    controller.ApplyFaultSourceVisualState("asset.test.backup", BusinessSceneNodeVisualState.Fault).Success,
                    Is.True);
                Assert.That(presenter.ApplyCount, Is.EqualTo(1), "同一建筑的第二个故障来源不得重复创建视觉效果。");

                Assert.That(controller.ClearFaultSourceVisualState("asset.test.primary").Success, Is.True);
                Assert.That(presenter.ClearCount, Is.Zero, "仍有活动故障来源时不得提前清除建筑效果。");
                Assert.That(controller.ClearFaultSourceVisualState("asset.unbound").Success, Is.True);
                Assert.That(presenter.ClearCount, Is.Zero, "未绑定节点必须安全忽略。 ");

                Assert.That(controller.ClearFaultSourceVisualState("asset.test.backup").Success, Is.True);
                Assert.That(presenter.ClearCount, Is.EqualTo(1));
                Assert.That(
                    controller.ApplyFaultSourceVisualState("asset.test.primary", BusinessSceneNodeVisualState.Alarm).ErrorCode,
                    Is.EqualTo("overview-fault-source-state-unsupported"));
            }
            finally
            {
                Object.DestroyImmediate(building);
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(runtimeRoot);
            }
        }

        [Test]
        public void 总览初始化拒绝跨建筑重复故障来源节点()
        {
            GameObject runtimeRoot = new GameObject("OverviewDuplicateFaultSourceRoot");
            GameObject cameraObject = new GameObject("OverviewDuplicateFaultSourceCamera");
            GameObject firstBuilding = GameObject.CreatePrimitive(PrimitiveType.Cube);
            GameObject secondBuilding = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                firstBuilding.transform.SetParent(runtimeRoot.transform, false);
                secondBuilding.transform.SetParent(runtimeRoot.transform, false);
                OverviewBuildingPlaceholder first = firstBuilding.AddComponent<OverviewBuildingPlaceholder>();
                first.ConfigureForEditor(
                    "overview-building.first-fault-source",
                    "coal-power",
                    firstBuilding.GetComponent<Renderer>(),
                    firstBuilding.GetComponent<Collider>(),
                    firstBuilding.AddComponent<TestPresenter>());
                first.ConfigureFaultSourceNodeIdsForEditor(new[] { "asset.test.duplicate" });
                OverviewBuildingPlaceholder second = secondBuilding.AddComponent<OverviewBuildingPlaceholder>();
                second.ConfigureForEditor(
                    "overview-building.second-fault-source",
                    "gas-power",
                    secondBuilding.GetComponent<Renderer>(),
                    secondBuilding.GetComponent<Collider>(),
                    secondBuilding.AddComponent<TestPresenter>());
                second.ConfigureFaultSourceNodeIdsForEditor(new[] { "asset.test.duplicate" });

                OverviewSceneController controller = runtimeRoot.AddComponent<OverviewSceneController>();
                controller.ConfigureForEditor(cameraObject.AddComponent<Camera>());
                BusinessSceneCommandResult initializationResult = default;
                IEnumerator initialization = controller.InitializeAsync(
                    new BusinessSceneInitializationContext("overview", "overview", "transition.duplicate-fault-source", false),
                    result => initializationResult = result);
                while (initialization.MoveNext())
                {
                }

                Assert.That(initializationResult.Success, Is.False);
                Assert.That(initializationResult.ErrorCode, Is.EqualTo("overview-building-fault-source-duplicate"));
            }
            finally
            {
                Object.DestroyImmediate(secondBuilding);
                Object.DestroyImmediate(firstBuilding);
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(runtimeRoot);
            }
        }

        [Test]
        public void 总览建筑状态入口按稳定标识调用呈现器并拒绝未知建筑()
        {
            GameObject runtimeRoot = new GameObject("OverviewVisualStateTestRoot");
            GameObject building = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                building.transform.SetParent(runtimeRoot.transform, false);
                TestPresenter presenter = building.AddComponent<TestPresenter>();
                OverviewBuildingPlaceholder placeholder = building.AddComponent<OverviewBuildingPlaceholder>();
                placeholder.ConfigureForEditor(
                    "overview-building.visual-test",
                    "coal-power",
                    building.GetComponent<Renderer>(),
                    building.GetComponent<Collider>(),
                    presenter);
                OverviewSceneController controller = runtimeRoot.AddComponent<OverviewSceneController>();
                GameObject cameraObject = new GameObject("OverviewVisualStateTestCamera");
                try
                {
                    controller.ConfigureForEditor(cameraObject.AddComponent<Camera>());
                    BusinessSceneCommandResult initializationResult = default;
                    IEnumerator initialization = controller.InitializeAsync(
                        new BusinessSceneInitializationContext("overview", "overview", "transition.visual-test", false),
                        result => initializationResult = result);
                    while (initialization.MoveNext())
                    {
                    }

                    Assert.That(initializationResult.Success, Is.True, initializationResult.Message);
                    Assert.That(
                        controller.ApplyBuildingVisualState(
                            "overview-building.visual-test",
                            BusinessSceneNodeVisualState.Fault).Success,
                        Is.True);
                    Assert.That(presenter.ApplyCount, Is.EqualTo(1));
                    Assert.That(presenter.LastState, Is.EqualTo(BusinessSceneNodeVisualState.Fault));
                    Assert.That(controller.ClearBuildingVisualState("overview-building.visual-test").Success, Is.True);
                    Assert.That(presenter.ClearCount, Is.EqualTo(1));
                    Assert.That(
                        controller.ApplyBuildingVisualState(
                            "overview-building.missing",
                            BusinessSceneNodeVisualState.Alarm).ErrorCode,
                        Is.EqualTo("overview-building-unknown"));
                    Assert.That(controller.ReleaseScene().Success, Is.True);
                    Assert.That(presenter.ReleaseCount, Is.EqualTo(1));
                }
                finally
                {
                    Object.DestroyImmediate(cameraObject);
                }
            }
            finally
            {
                Object.DestroyImmediate(building);
                Object.DestroyImmediate(runtimeRoot);
            }
        }

        /// <summary>
        /// 总览相机复位只清除建筑选择，当前故障呈现由状态快照继续维护，不能被复位按钮误清除。
        /// </summary>
        [Test]
        public void 总览相机复位清除建筑选择但保留故障状态()
        {
            GameObject runtimeRoot = new GameObject("OverviewCameraResetTestRoot");
            GameObject cameraObject = new GameObject("OverviewCameraResetTestCamera");
            GameObject building = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                building.transform.SetParent(runtimeRoot.transform, false);
                TestPresenter presenter = building.AddComponent<TestPresenter>();
                OverviewBuildingPlaceholder placeholder = building.AddComponent<OverviewBuildingPlaceholder>();
                placeholder.ConfigureForEditor(
                    "overview-building.camera-reset",
                    "coal-power",
                    building.GetComponent<Renderer>(),
                    building.GetComponent<Collider>(),
                    presenter);

                Camera camera = cameraObject.AddComponent<Camera>();
                TestCameraPoseController cameraPoseController = cameraObject.AddComponent<TestCameraPoseController>();
                OverviewSceneController controller = runtimeRoot.AddComponent<OverviewSceneController>();
                controller.ConfigureForEditor(camera);

                BusinessSceneCommandResult initializationResult = default;
                IEnumerator initialization = controller.InitializeAsync(
                    new BusinessSceneInitializationContext("overview", "overview", "transition.camera-reset", false),
                    result => initializationResult = result);
                while (initialization.MoveNext())
                {
                }

                Assert.That(initializationResult.Success, Is.True, initializationResult.Message);
                Assert.That(
                    controller.ApplyBuildingVisualState(
                        "overview-building.camera-reset",
                        BusinessSceneNodeVisualState.Fault).Success,
                    Is.True);

                FieldInfo activeBuildingField = typeof(OverviewSceneController).GetField(
                    "_activeBuildingId",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(activeBuildingField, Is.Not.Null);
                activeBuildingField.SetValue(controller, "overview-building.camera-reset");

                BusinessSceneCommandResult resetResult = controller.ResetCamera();
                Assert.That(resetResult.Success, Is.True, resetResult.Message);
                Assert.That(cameraPoseController.ResetCount, Is.EqualTo(1));
                Assert.That(controller.ActiveBuildingId, Is.Empty);
                Assert.That(presenter.ApplyCount, Is.EqualTo(1), "复位不得重新写入或清除故障呈现。");
                Assert.That(presenter.ClearCount, Is.EqualTo(0), "复位不得把故障建筑恢复为正常态。");
                Assert.That(presenter.LastState, Is.EqualTo(BusinessSceneNodeVisualState.Fault));
            }
            finally
            {
                Object.DestroyImmediate(building);
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(runtimeRoot);
            }
        }

        /// <summary>
        /// 单座厂房的编辑器配置必须完整保存多个球形脉冲模型引用，不能退化为只保留首个目标。
        /// </summary>
        [Test]
        public void 总览建筑故障球形效果支持配置多个模型目标()
        {
            GameObject presenterObject = new GameObject("OverviewMultiPulsePresenter");
            GameObject firstTarget = GameObject.CreatePrimitive(PrimitiveType.Cube);
            GameObject secondTarget = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                System.Type presenterType = System.Type.GetType("OverviewBuildingVisualStatePresenter, Assembly-CSharp");
                Assert.That(presenterType, Is.Not.Null, "必须能从默认运行时程序集解析总览建筑呈现器。");

                Component presenter = presenterObject.AddComponent(presenterType);
                MethodInfo configureMethod = presenterType.GetMethod(
                    "ConfigureFaultResponseForEditor",
                    BindingFlags.Instance | BindingFlags.Public);
                FieldInfo targetsField = presenterType.GetField(
                    "_sphericalPulseTargets",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(configureMethod, Is.Not.Null);
                Assert.That(targetsField, Is.Not.Null);

                configureMethod.Invoke(
                    presenter,
                    new object[]
                    {
                        new Renderer[0],
                        null,
                        new[] { firstTarget, secondTarget }
                    });

                GameObject[] configuredTargets = (GameObject[])targetsField.GetValue(presenter);
                Assert.That(configuredTargets, Has.Length.EqualTo(2));
                Assert.That(configuredTargets[0], Is.SameAs(firstTarget));
                Assert.That(configuredTargets[1], Is.SameAs(secondTarget));
            }
            finally
            {
                Object.DestroyImmediate(presenterObject);
                Object.DestroyImmediate(firstTarget);
                Object.DestroyImmediate(secondTarget);
            }
        }

        /// <summary>
        /// 故障停流必须只替换显式绑定渲染器的材质槽；其它使用同一共享材质的电线保持原引用与原速度。
        /// </summary>
        [Test]
        public void 总览建筑故障停流只影响绑定电线的材质实例()
        {
            GameObject presenterObject = new GameObject("OverviewFlowIsolationPresenter");
            GameObject boundWire = GameObject.CreatePrimitive(PrimitiveType.Cube);
            GameObject unboundWire = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Material sharedFlowMaterial = null;
            try
            {
                Shader flowShader = UnityEditor.AssetDatabase.LoadAssetAtPath<Shader>(
                    "Assets/Shaders/Imported/GuanDaoFlow/GuanDaoWithBase.shader");
                Assert.That(flowShader, Is.Not.Null);
                sharedFlowMaterial = new Material(flowShader);
                sharedFlowMaterial.SetFloat("_FlowSpeed", 1f);
                Renderer boundRenderer = boundWire.GetComponent<Renderer>();
                Renderer unboundRenderer = unboundWire.GetComponent<Renderer>();
                boundRenderer.sharedMaterial = sharedFlowMaterial;
                unboundRenderer.sharedMaterial = sharedFlowMaterial;

                System.Type presenterType = System.Type.GetType("OverviewBuildingVisualStatePresenter, Assembly-CSharp");
                Assert.That(presenterType, Is.Not.Null);
                Component presenter = presenterObject.AddComponent(presenterType);
                MethodInfo configureMethod = presenterType.GetMethod(
                    "ConfigureFaultResponseForEditor",
                    BindingFlags.Instance | BindingFlags.Public);
                MethodInfo setFlowStoppedMethod = presenterType.GetMethod(
                    "SetFlowStopped",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                MethodInfo releaseFlowInstancesMethod = presenterType.GetMethod(
                    "ReleaseFlowMaterialInstances",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(configureMethod, Is.Not.Null);
                Assert.That(setFlowStoppedMethod, Is.Not.Null);
                Assert.That(releaseFlowInstancesMethod, Is.Not.Null);

                configureMethod.Invoke(
                    presenter,
                    new object[] { new[] { boundRenderer }, null, new GameObject[0] });
                setFlowStoppedMethod.Invoke(presenter, new object[] { true });

                Assert.That(boundRenderer.sharedMaterial, Is.Not.SameAs(sharedFlowMaterial));
                Assert.That(boundRenderer.sharedMaterial.GetFloat("_FlowSpeed"), Is.Zero);
                Assert.That(unboundRenderer.sharedMaterial, Is.SameAs(sharedFlowMaterial));
                Assert.That(unboundRenderer.sharedMaterial.GetFloat("_FlowSpeed"), Is.EqualTo(1f));
                Assert.That(sharedFlowMaterial.GetFloat("_FlowSpeed"), Is.EqualTo(1f));

                setFlowStoppedMethod.Invoke(presenter, new object[] { false });
                Assert.That(boundRenderer.sharedMaterial.GetFloat("_FlowSpeed"), Is.EqualTo(1f));
                releaseFlowInstancesMethod.Invoke(presenter, null);
                Assert.That(boundRenderer.sharedMaterial, Is.SameAs(sharedFlowMaterial));
            }
            finally
            {
                Object.DestroyImmediate(presenterObject);
                Object.DestroyImmediate(boundWire);
                Object.DestroyImmediate(unboundWire);
                if (sharedFlowMaterial != null)
                {
                    Object.DestroyImmediate(sharedFlowMaterial);
                }
            }
        }
    }
}
