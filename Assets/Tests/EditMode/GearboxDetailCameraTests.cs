using System;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;
using Object = UnityEngine.Object;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 锁定用户参考图中 ShowTest 主相机的机位。
    /// 第三层模型仅通过 DisplayAnchor 平移，因此比较锚点坐标中的位置，
    /// 不把测试场景世界坐标直接写入远端展示资源，也不改变现有视场角与交互。
    /// </summary>
    public sealed class GearboxReferenceCameraPoseTests
    {
        [Test]
        public void InitialPoseMatchesApprovedShowTestCameraRelativeToDisplayAnchor()
        {
            const string prefabPath = "Assets/ProcessDetails/WindPower/Gearbox/GearboxProcessDetail.prefab";
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            Assert.That(prefab, Is.Not.Null);
            Transform anchor = prefab.transform.Find("DisplayAnchor");
            Transform pose = prefab.transform.Find("CameraPose");
            Assert.That(anchor, Is.Not.Null);
            Assert.That(pose, Is.Not.Null);

            // 数值来自用户确认截图所对应的编辑器运行相机，不由包围盒自动推算。
            // 远端 X 坐标约为 10000；0.002 容差覆盖单精度平移的量化误差。
            Vector3 referencePosition = new Vector3(-18.651340f, 93.470950f, 4.927796f);
            Quaternion referenceRotation = Quaternion.Euler(9.967289f, 112.434900f, 0f);
            Assert.That(Vector3.Distance(anchor.InverseTransformPoint(pose.position), referencePosition),
                Is.LessThan(0.002f), "初始机位必须保留参考图相机相对模型的位置。");
            Assert.That(Quaternion.Angle(Quaternion.Inverse(anchor.rotation) * pose.rotation, referenceRotation),
                Is.LessThan(0.01f), "初始朝向必须与参考图一致，不能恢复成旧的正面机位。");
            Assert.That(pose.localScale, Is.EqualTo(Vector3.one));
        }
    }

    [TestFixture("Assets/ProcessDetails/WindPower/Gearbox/GearboxProcessDetail.prefab")]
    [TestFixture("Assets/ProcessDetails/WindPower/WindTurbine/WindTurbineProcessDetail.prefab")]
    public sealed class GearboxDetailCameraTests
    {
        private readonly string _prefabPath;
        public GearboxDetailCameraTests(string prefabPath) { _prefabPath = prefabPath; }

        private GameObject _cameraObject;
        private Component _controller;
        private Type _controllerType;
        private Component _orbit;
        private Vector3 _center;

        [SetUp]
        public void SetUp()
        {
            _controllerType = Type.GetType("PowerPlantFreeCameraController, Assembly-CSharp", true);
            Type orbitType = Type.GetType("GearboxOrbitCamera, Assembly-CSharp", true);
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(_prefabPath);
            Assert.That(prefab, Is.Not.Null);
            _orbit = prefab.GetComponentInChildren(orbitType, true);
            Assert.That(((Behaviour)_orbit).enabled, Is.False, "业务相机应独占镜头，不启用旧环绕脚本。");
            _center = (Vector3)orbitType.GetProperty("OrbitCenter").GetValue(_orbit);
            _cameraObject = new GameObject("Gearbox Camera Test", typeof(Camera));
            _controller = _cameraObject.AddComponent(_controllerType);
            Invoke("Awake");
            Set("_focusDuration", 0f);
            ((IBusinessSceneCameraPoseController)_controller).MoveToPose(prefab.transform.Find("CameraPose"));
            Assert.That(Get("_detailOrbit"), Is.EqualTo(_orbit));
        }

        [TearDown]
        public void TearDown() { Object.DestroyImmediate(_cameraObject); }

        [Test]
        public void RightDragOrbitsAuthoredCoreWithoutChangingRadiusOrComposition()
        {
            Transform camera = _cameraObject.transform;
            float distance = Vector3.Distance(camera.position, _center);
            Vector3 localCoreDirection = camera.InverseTransformDirection((_center - camera.position).normalized);
            Vector3 before = camera.position;
            Invoke("OrbitAroundDetailCore", new Vector2(120f, 30f));
            Assert.That(Vector3.Distance(before, camera.position), Is.GreaterThan(0.1f));
            Assert.That(Vector3.Distance(camera.position, _center), Is.EqualTo(distance).Within(0.002f));
            Assert.That(Vector3.Distance(camera.InverseTransformDirection((_center - camera.position).normalized),
                localCoreDirection), Is.LessThan(0.001f));
            Assert.That(Mathf.Abs(Vector3.SignedAngle(Vector3.ProjectOnPlane(before - _center, Vector3.up),
                Vector3.ProjectOnPlane(camera.position - _center, Vector3.up), Vector3.up)), Is.EqualTo(9f).Within(0.1f));
        }

        [TestCase(1f / 30f)]
        [TestCase(1f / 120f)]
        public void OneWheelNotchIsSmallSmoothAndFrameRateIndependent(float deltaTime)
        {
            Transform camera = _cameraObject.transform;
            float distance = Vector3.Distance(camera.position, _center);
            Quaternion rotation = camera.rotation;
            Invoke("QueueDetailZoom", 120f);
            float target = (float)Get("_detailZoomTargetDistance");
            Assert.That(target / distance, Is.EqualTo(Mathf.Exp(-0.035f)).Within(0.0001f));
            Assert.That(Vector3.Distance(camera.position, _center), Is.EqualTo(distance));
            Invoke("UpdateDetailZoom", deltaTime);
            Assert.That(Vector3.Distance(camera.position, _center), Is.InRange(target, distance));
            for (int i = 0; i < 240; i++) Invoke("UpdateDetailZoom", deltaTime);
            Assert.That(Vector3.Distance(camera.position, _center), Is.EqualTo(target).Within(0.002f));
            Assert.That(Quaternion.Angle(rotation, camera.rotation), Is.LessThan(0.001f));
        }

        [TestCase(100000f, "MinimumDistance")]
        [TestCase(-100000f, "MaximumDistance")]
        public void ZoomCannotCrossConfiguredDistanceLimits(float scroll, string limitProperty)
        {
            float expectedLimit = (float)_orbit.GetType().GetProperty(limitProperty).GetValue(_orbit);
            _cameraObject.transform.position = _center + Vector3.forward * 20f;
            for (int i = 0; i < 200; i++) Invoke("QueueDetailZoom", scroll);
            Assert.That((float)Get("_detailZoomTargetDistance"), Is.EqualTo(expectedLimit).Within(0.001f));
        }

        [Test]
        public void BrowserWheelBurstIsCappedAtTwoNotches()
        {
            float distance = Vector3.Distance(_cameraObject.transform.position, _center);
            Invoke("QueueDetailZoom", 100000f);
            Assert.That((float)Get("_detailZoomTargetDistance") / distance,
                Is.EqualTo(Mathf.Exp(-0.07f)).Within(0.0001f));
        }

        [Test]
        public void DetailResetAndPartFocusKeepOrbitButCancelResidualZoom()
        {
            Invoke("QueueDetailZoom", 120f);
            Invoke("FocusBounds", new Bounds(_center, Vector3.one));
            Assert.That(Get("_detailOrbit"), Is.EqualTo(_orbit));
            Assert.That(Get("_isDetailZooming"), Is.False);
            Invoke("QueueDetailZoom", 120f);
            Invoke("MoveToPose", _center + Vector3.forward * 20f, Quaternion.identity);
            Assert.That(Get("_detailOrbit"), Is.EqualTo(_orbit));
            Assert.That(Get("_isDetailZooming"), Is.False);
        }

        [Test]
        public void ReturningToBusinessClearsDetailModeAndRestoresOriginalScroll()
        {
            Invoke("QueueDetailZoom", 120f);
            ((IBusinessSceneCameraSnapshotController)_controller).MoveToSnapshot(
                new BusinessSceneCameraPoseSnapshot(Vector3.zero, Quaternion.identity, 60f, 5f, false));
            Assert.That(Get("_detailOrbit"), Is.Null);
            Assert.That(Get("_isDetailZooming"), Is.False);
            Invoke("MoveAlongCameraCenter", 120f, 1f);
            Assert.That(_cameraObject.transform.position.z, Is.EqualTo(6f).Within(0.001f));
        }

        [Test]
        public void OtherNamedPoseDoesNotRetainGearboxControls()
        {
            var pose = new GameObject("Other Camera Pose");
            try
            {
                ((IBusinessSceneCameraPoseController)_controller).MoveToPose(pose.transform);
                Assert.That(Get("_detailOrbit"), Is.Null);
            }
            finally { Object.DestroyImmediate(pose); }
        }

        [Test]
        public void DetailCameraResetRestoresAuthoredPoseAndKeepsOrbit()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(_prefabPath);
            Transform pose = prefab.transform.Find("CameraPose");
            Invoke("OrbitAroundDetailCore", new Vector2(200f, 60f));
            Invoke("QueueDetailZoom", 120f);
            ((IBusinessSceneCameraPoseController)_controller).MoveToPose(pose);
            Assert.That(Vector3.Distance(_cameraObject.transform.position, pose.position), Is.LessThan(0.001f));
            Assert.That(Quaternion.Angle(_cameraObject.transform.rotation, pose.rotation), Is.LessThan(0.01f));
            Assert.That(Get("_detailOrbit"), Is.EqualTo(_orbit));
            Assert.That(Get("_isDetailZooming"), Is.False);
        }

        private object Get(string name) => _controllerType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_controller);
        private void Set(string name, object value) => _controllerType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_controller, value);
        private void Invoke(string name, params object[] arguments)
        {
            Type[] types = Array.ConvertAll(arguments, argument => argument.GetType());
            _controllerType.GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public,
                null, types, null).Invoke(_controller, arguments);
        }
    }
}
