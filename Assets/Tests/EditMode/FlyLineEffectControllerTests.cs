using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 飞线特效控制器的编辑模式验证。
    /// 只检查几何重建、端点绑定和显隐切换，不依赖具体渲染结果，避免把视觉判断变成脆弱的截图测试。
    /// </summary>
    public sealed class FlyLineEffectControllerTests
    {
        private const string FlyLinePrefabPath = "Assets/Prefabs/FlyLineEffect.prefab";

        [Test]
        public void 显式起终点会生成保持端点的弧线()
        {
            GameObject root = new GameObject("FlyLineEffectTest");
            try
            {
                FlyLineEffectController controller = root.AddComponent<FlyLineEffectController>();
                controller.ConfigureCurve(Vector3.up, 4f, 5);
                controller.SetEndpoints(new Vector3(0f, 0f, 0f), new Vector3(10f, 0f, 0f));
                controller.RefreshGeometry();

                LineRenderer lineRenderer = root.GetComponent<LineRenderer>();
                Assert.That(lineRenderer, Is.Not.Null);
                Assert.That(lineRenderer.positionCount, Is.EqualTo(5));
                AssertVector3Approximately(lineRenderer.GetPosition(0), new Vector3(0f, 0f, 0f));
                // 二次贝塞尔曲线的中点位于起终点中点与控制点中点之间，因此曲线中点抬升值是 curveHeight 的一半。
                AssertVector3Approximately(lineRenderer.GetPosition(2), new Vector3(5f, 2f, 0f));
                AssertVector3Approximately(lineRenderer.GetPosition(4), new Vector3(10f, 0f, 0f));
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void 飞线预制体资产包含控制器和端点层级()
        {
            GameObject prefabRoot = AssetDatabase.LoadAssetAtPath<GameObject>(FlyLinePrefabPath);
            Assert.That(prefabRoot, Is.Not.Null, "飞线预制体资产未写入预期路径。");

            FlyLineEffectController controller = prefabRoot.GetComponent<FlyLineEffectController>();
            Assert.That(controller, Is.Not.Null, "飞线预制体必须挂载飞线控制器。");
            Assert.That(prefabRoot.GetComponent<LineRenderer>(), Is.Not.Null, "飞线预制体必须预置 LineRenderer（线渲染器）。");

            Transform startPoint = prefabRoot.transform.Find("StartPoint");
            Transform endPoint = prefabRoot.transform.Find("EndPoint");
            Assert.That(startPoint, Is.Not.Null, "飞线预制体缺少 StartPoint 端点。");
            Assert.That(endPoint, Is.Not.Null, "飞线预制体缺少 EndPoint 端点。");
        }

        [Test]
        public void 绑定变换后刷新会跟随端点移动()
        {
            GameObject root = new GameObject("FlyLineEffectFollowTest");
            GameObject startObject = new GameObject("StartPoint");
            GameObject endObject = new GameObject("EndPoint");
            try
            {
                startObject.transform.position = new Vector3(-2f, 1f, 0.5f);
                endObject.transform.position = new Vector3(6f, 3f, -1f);

                FlyLineEffectController controller = root.AddComponent<FlyLineEffectController>();
                controller.ConfigureCurve(Vector3.up, 2f, 4);
                controller.BindEndpoints(startObject.transform, endObject.transform);
                controller.RefreshGeometry();

                LineRenderer lineRenderer = root.GetComponent<LineRenderer>();
                Assert.That(lineRenderer, Is.Not.Null);
                Assert.That(lineRenderer.positionCount, Is.EqualTo(4));
                AssertVector3Approximately(lineRenderer.GetPosition(0), startObject.transform.position);
                AssertVector3Approximately(lineRenderer.GetPosition(3), endObject.transform.position);

                // 端点移动后再次刷新，飞线必须同步到新位置，不能停留在旧缓存上。
                startObject.transform.position = new Vector3(-1f, 2f, 1f);
                endObject.transform.position = new Vector3(8f, 4f, 2f);
                controller.RefreshGeometry();

                AssertVector3Approximately(lineRenderer.GetPosition(0), startObject.transform.position);
                AssertVector3Approximately(lineRenderer.GetPosition(3), endObject.transform.position);
            }
            finally
            {
                Object.DestroyImmediate(startObject);
                Object.DestroyImmediate(endObject);
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void 网络管理器会生成随机点并按指定点对创建独立飞线()
        {
            GameObject root = new GameObject("FlyLineNetworkManagerTest");
            GameObject pointPrefab = new GameObject("PointPrefab");
            try
            {
                pointPrefab.AddComponent<FlyLinePoint>();
                FlyLineEffectController controller = root.AddComponent<FlyLineEffectController>();
                FlyLineNetworkManager manager = root.AddComponent<FlyLineNetworkManager>();
                SerializedObject serializedManager = new SerializedObject(manager);
                serializedManager.FindProperty("_pointPrefab").objectReferenceValue = pointPrefab;
                serializedManager.FindProperty("_pointCount").intValue = 4;
                serializedManager.FindProperty("_distributionSize").vector3Value = new Vector3(4f, 2f, 2f);
                SerializedProperty connections = serializedManager.FindProperty("_connections");
                connections.arraySize = 3;
                for (int index = 0; index < connections.arraySize; index++)
                {
                    SerializedProperty connection = connections.GetArrayElementAtIndex(index);
                    connection.FindPropertyRelative("StartPointIndex").intValue = index;
                    connection.FindPropertyRelative("EndPointIndex").intValue = index + 1;
                }
                serializedManager.ApplyModifiedPropertiesWithoutUndo();

                manager.GenerateRandomPoints();

                Transform generatedPoints = root.transform.Find("GeneratedFlyLinePoints");
                Assert.That(generatedPoints, Is.Not.Null);
                Assert.That(generatedPoints.childCount, Is.EqualTo(4));
                Assert.That(manager.ManagedPointCount, Is.EqualTo(4));
                Assert.That(manager.ConnectionCount, Is.EqualTo(3));
                Assert.That(controller.EndpointGroupCount, Is.EqualTo(3));
                for (int index = 0; index < 3; index++)
                {
                    LineRenderer lineRenderer = controller.GetLineRenderer(index);
                    Assert.That(lineRenderer, Is.Not.Null);
                    Assert.That(lineRenderer.positionCount, Is.EqualTo(32));
                }
            }
            finally
            {
                Object.DestroyImmediate(pointPrefab);
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void 网络管理器在场景重载后可以从生成点容器恢复连接()
        {
            GameObject root = new GameObject("FlyLineNetworkReloadTest");
            try
            {
                FlyLineEffectController controller = root.AddComponent<FlyLineEffectController>();
                FlyLineNetworkManager manager = root.AddComponent<FlyLineNetworkManager>();
                GameObject pointsRootObject = new GameObject("GeneratedFlyLinePoints");
                pointsRootObject.transform.SetParent(root.transform, false);
                GameObject firstPoint = new GameObject("Point_00");
                firstPoint.transform.SetParent(pointsRootObject.transform, false);
                GameObject secondPoint = new GameObject("Point_01");
                secondPoint.transform.SetParent(pointsRootObject.transform, false);
                firstPoint.transform.position = new Vector3(-2f, 0f, 0f);
                secondPoint.transform.position = new Vector3(2f, 0f, 0f);

                SerializedObject serializedManager = new SerializedObject(manager);
                serializedManager.FindProperty("_pointsRoot").objectReferenceValue = pointsRootObject.transform;
                serializedManager.FindProperty("_pointCount").intValue = 2;
                SerializedProperty connections = serializedManager.FindProperty("_connections");
                connections.arraySize = 1;
                connections.GetArrayElementAtIndex(0).FindPropertyRelative("StartPointIndex").intValue = 0;
                connections.GetArrayElementAtIndex(0).FindPropertyRelative("EndPointIndex").intValue = 1;
                serializedManager.ApplyModifiedPropertiesWithoutUndo();

                manager.RebuildConnections();

                Assert.That(manager.ManagedPointCount, Is.EqualTo(2));
                Assert.That(controller.EndpointGroupCount, Is.EqualTo(1));
                LineRenderer lineRenderer = controller.GetLineRenderer(0);
                AssertVector3Approximately(lineRenderer.GetPosition(0), firstPoint.transform.position);
                AssertVector3Approximately(lineRenderer.GetPosition(lineRenderer.positionCount - 1), secondPoint.transform.position);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void 停止和播放只切换显隐不会丢失几何缓存()
        {
            GameObject root = new GameObject("FlyLineEffectToggleTest");
            try
            {
                FlyLineEffectController controller = root.AddComponent<FlyLineEffectController>();
                controller.ConfigureCurve(Vector3.up, 1.5f, 3);
                controller.SetEndpoints(new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 6f));
                controller.RefreshGeometry();

                LineRenderer lineRenderer = root.GetComponent<LineRenderer>();
                Assert.That(lineRenderer, Is.Not.Null);
                Assert.That(lineRenderer.positionCount, Is.EqualTo(3));

                controller.SetEffectEnabled(false);
                Assert.That(lineRenderer.enabled, Is.False);
                Assert.That(lineRenderer.positionCount, Is.EqualTo(3));

                controller.Play();
                Assert.That(lineRenderer.enabled, Is.True);
                Assert.That(lineRenderer.positionCount, Is.EqualTo(3));
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        private static void AssertVector3Approximately(Vector3 actual, Vector3 expected, float tolerance = 0.001f)
        {
            Assert.That(actual.x, Is.EqualTo(expected.x).Within(tolerance));
            Assert.That(actual.y, Is.EqualTo(expected.y).Within(tolerance));
            Assert.That(actual.z, Is.EqualTo(expected.z).Within(tolerance));
        }
    }
}
