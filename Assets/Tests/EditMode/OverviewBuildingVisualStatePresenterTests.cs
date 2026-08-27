using System.Collections;
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
    }
}
