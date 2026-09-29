using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 校验光伏逆变器关键环节六条电线和控制线均绑定独立流光叠加网格，且不替换原线路材质。
    /// </summary>
    public sealed class SolarInverterProcessDetailFlowTests
    {
        private const string PrefabPath =
            "Assets/ProcessDetails/SolarPower/Inverter/SolarInverterProcessDetail.prefab";
        private const string ModelRootPath = "DisplayAnchor/逆变器关键环节9.28";
        /// <summary>回归断言必须与线路流光生成器绑定的 FlyLine 主材质保持一致。</summary>
        private const string FlowMaterialPath = "Assets/Shaders/PipelineFlow_Gas.mat";

        private static readonly string[] FlowLineNames =
        {
            "电线",
            "电线.001",
            "电线.002",
            "电线.003",
            "电线.004",
            "电线.005",
            "控制线"
        };

        [Test]
        public void EveryPowerAndControlLineHasConfiguredFlowOverlayWithoutReplacingItsSourceMeshOrMaterials()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            Assert.That(prefab, Is.Not.Null, "必须读取正式光伏逆变器关键环节预制体。");

            Material expectedFlowMaterial = AssetDatabase.LoadAssetAtPath<Material>(FlowMaterialPath);
            Assert.That(expectedFlowMaterial, Is.Not.Null, "必须复用项目现有电路流光材质。");

            Transform modelRoot = prefab.transform.Find(ModelRootPath);
            Assert.That(modelRoot, Is.Not.Null, "预制体必须保留已登记的逆变器模型层级。");

            for (int index = 0; index < FlowLineNames.Length; index++)
            {
                Transform wire = modelRoot.Find(FlowLineNames[index]);
                Assert.That(wire, Is.Not.Null, $"缺少线路对象：{FlowLineNames[index]}。");

                MeshFilter sourceFilter = wire.GetComponent<MeshFilter>();
                Renderer sourceRenderer = wire.GetComponent<Renderer>();
                MonoBehaviour effect = FindFlowEffect(wire);
                Assert.That(sourceFilter, Is.Not.Null, $"线路 {FlowLineNames[index]} 缺少原始网格。");
                Assert.That(sourceRenderer, Is.Not.Null, $"线路 {FlowLineNames[index]} 缺少原始渲染器。");
                Assert.That(effect, Is.Not.Null, $"线路 {FlowLineNames[index]} 缺少流光效果组件。");

                SerializedObject serializedEffect = new SerializedObject(effect);
                Assert.That(
                    serializedEffect.FindProperty("_circuitMeshFilter").objectReferenceValue,
                    Is.SameAs(sourceFilter),
                    $"线路 {FlowLineNames[index]} 的流光必须跟随自身源网格。");
                Assert.That(
                    serializedEffect.FindProperty("_circuitRenderer").objectReferenceValue,
                    Is.SameAs(sourceRenderer),
                    $"线路 {FlowLineNames[index]} 的流光必须跟随自身可见状态。");
                Assert.That(
                    serializedEffect.FindProperty("_flowMaterial").objectReferenceValue,
                    Is.SameAs(expectedFlowMaterial),
                    $"线路 {FlowLineNames[index]} 必须复用共享流光材质。");

                Mesh flowMesh = serializedEffect.FindProperty("_flowMesh").objectReferenceValue as Mesh;
                Assert.That(flowMesh, Is.Not.Null, $"线路 {FlowLineNames[index]} 必须绑定烘焙后的流光网格。");
                Assert.That(flowMesh, Is.Not.SameAs(sourceFilter.sharedMesh), "流光网格不得替换原始线路网格。");
                Assert.That(
                    System.Array.IndexOf(sourceRenderer.sharedMaterials, expectedFlowMaterial),
                    Is.EqualTo(-1),
                    "流光材质必须通过叠加渲染器使用，不得替换线路原有材质槽。");
                Vector2[] routeUvs = flowMesh.uv2;
                Assert.That(routeUvs.Length, Is.EqualTo(flowMesh.vertexCount));
                float maximumRouteDistance = 0f;
                for (int uvIndex = 0; uvIndex < routeUvs.Length; uvIndex++)
                {
                    maximumRouteDistance = Mathf.Max(maximumRouteDistance, routeUvs[uvIndex].x);
                }
                Assert.That(
                    routeUvs.Length > 0 && maximumRouteDistance > 0f,
                    Is.True,
                    $"线路 {FlowLineNames[index]} 的 UV1 必须包含递增的路径距离。");
            }
        }

        [Test]
        public void DynamicAdapterControlsOverlayEffectsWhenSourceMaterialsHaveNoFlowSpeedProperty()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            Assert.That(prefab, Is.Not.Null, "必须读取正式光伏逆变器关键环节预制体。");

            GameObject instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            Assert.That(instance, Is.Not.Null, "必须在隔离实例上验证适配器，不能改变正式预制体状态。");
            try
            {
                MonoBehaviour[] rootComponents = instance.GetComponents<MonoBehaviour>();
                WebDLPro.Unity.SceneRuntime.IProcessDetailDynamicTarget dynamicTarget = null;
                for (int componentIndex = 0; componentIndex < rootComponents.Length; componentIndex++)
                {
                    MonoBehaviour component = rootComponents[componentIndex];
                    if (component != null && component.GetType().Name == "SolarInverterProcessDetailDynamicAdapter")
                    {
                        dynamicTarget = component as WebDLPro.Unity.SceneRuntime.IProcessDetailDynamicTarget;
                        break;
                    }
                }
                Assert.That(dynamicTarget, Is.Not.Null, "预制体根节点必须装配逆变器动态适配器。");

                Transform modelRoot = instance.transform.Find(ModelRootPath);
                Assert.That(modelRoot, Is.Not.Null, "运行时实例必须保留已登记的逆变器模型层级。");
                int flowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");
                for (int index = 0; index < FlowLineNames.Length; index++)
                {
                    Transform wire = modelRoot.Find(FlowLineNames[index]);
                    Assert.That(wire, Is.Not.Null, $"缺少线路对象：{FlowLineNames[index]}。");

                    Renderer sourceRenderer = wire.GetComponent<Renderer>();
                    Assert.That(sourceRenderer, Is.Not.Null, $"线路 {FlowLineNames[index]} 缺少原始渲染器。");
                    Material[] sourceMaterials = sourceRenderer.sharedMaterials;
                    for (int materialIndex = 0; materialIndex < sourceMaterials.Length; materialIndex++)
                    {
                        Material sourceMaterial = sourceMaterials[materialIndex];
                        Assert.That(
                            sourceMaterial == null || !sourceMaterial.HasProperty(flowSpeedPropertyId),
                            Is.True,
                            $"线路 {FlowLineNames[index]} 的源材质必须保持无流光速度属性，以确保测试独立叠加效果路径。");
                    }
                }

                // 正式线路材质不含 _FlowSpeed；暂停必须由每条线上的叠加流光组件接收。
                dynamicTarget.SetPlayback(false, false);
                AssertFlowPlaybackState(modelRoot, false, "暂停");

                // 故障许可即使请求播放也必须保持停流；清除故障后则应能恢复七条流光。
                dynamicTarget.SetPlayback(true, true);
                AssertFlowPlaybackState(modelRoot, false, "故障停止");
                dynamicTarget.SetPlayback(true, false);
                AssertFlowPlaybackState(modelRoot, true, "恢复播放");
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        /// <summary>逐条核实七个叠加流光组件收到同一播放许可，覆盖暂停、故障停流及恢复播放。</summary>
        private static void AssertFlowPlaybackState(Transform modelRoot, bool expected, string stateLabel)
        {
            for (int index = 0; index < FlowLineNames.Length; index++)
            {
                Transform wire = modelRoot.Find(FlowLineNames[index]);
                MonoBehaviour effect = FindFlowEffect(wire);
                Assert.That(effect, Is.Not.Null, $"线路 {FlowLineNames[index]} 缺少流光效果组件。");

                System.Reflection.PropertyInfo playbackProperty = effect.GetType().GetProperty("IsPlaybackEnabled");
                Assert.That(playbackProperty, Is.Not.Null, "流光效果必须公开只读播放状态供控制器测试验证。");
                Assert.That(
                    playbackProperty.GetValue(effect),
                    Is.EqualTo(expected),
                    $"线路 {FlowLineNames[index]} 在{stateLabel}状态下播放许可不一致。");
            }
        }

        /// <summary>
        /// 按组件类型名查找位于预定义程序集中的效果组件，避免测试程序集反向引用 Assembly-CSharp。
        /// </summary>
        private static MonoBehaviour FindFlowEffect(Transform wire)
        {
            MonoBehaviour[] components = wire.GetComponents<MonoBehaviour>();
            for (int index = 0; index < components.Length; index++)
            {
                MonoBehaviour component = components[index];
                if (component != null && component.GetType().Name == "ControlCircuitElectronFlowEffect")
                {
                    return component;
                }
            }

            return null;
        }
    }
}
