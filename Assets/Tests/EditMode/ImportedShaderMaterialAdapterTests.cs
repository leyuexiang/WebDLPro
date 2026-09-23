using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 验证已导入的管道流动和区域边界材质可以接入三层逻辑属性适配器。
    /// 测试只使用材质资源本身，不把尚未提供的 pipeId、routeId 或 areaId 绑定到场景。
    /// </summary>
    public sealed class ImportedShaderMaterialAdapterTests
    {
        private const string GuanDaoMaterialPath = "Assets/Shaders/Imported/GuanDaoFlow/LYDS_GuanDao02.mat";
        private const string RailMaterialPath = "Assets/Shaders/Imported/RailArea/Rail.mat";

        [Test]
        public void 管道流动材质使用标量流速并保留原始向量流向()
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(GuanDaoMaterialPath);
            Assert.That(material, Is.Not.Null, "未找到已导入的管道流动材质。");

            GameObject visualRoot = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ThreeLayerMaterialPropertyAdapter adapter = null;
            try
            {
                Renderer renderer = visualRoot.GetComponent<Renderer>();
                renderer.sharedMaterial = material;
                Vector4 originalSpeed = material.GetVector("_Speed");
                Vector4 originalSpeed2 = material.GetVector("_Speed2");

                Assert.That(
                    ThreeLayerMaterialPropertyAdapter.TryCreate(
                        renderer,
                        0,
                        out adapter,
                        out string error),
                    Is.True,
                    error);
                Assert.That(adapter.PropertyIds.Color, Is.Not.EqualTo(0));
                Assert.That(adapter.PropertyIds.FlowSpeed, Is.Not.EqualTo(0));
                Assert.That(adapter.OriginalFlowSpeed, Is.EqualTo(material.GetFloat("_FlowSpeed")).Within(0.001f));

                Assert.That(adapter.Apply(ThreeLayerMaterialPropertyValues.ForFlowSpeed(0f)), Is.True);
                MaterialPropertyBlock inspectionBlock = new MaterialPropertyBlock();
                renderer.GetPropertyBlock(inspectionBlock, 0);
                Assert.That(inspectionBlock.GetFloat(adapter.PropertyIds.FlowSpeed), Is.EqualTo(0f).Within(0.001f));
                Assert.That(material.GetVector("_Speed"), Is.EqualTo(originalSpeed));
                Assert.That(material.GetVector("_Speed2"), Is.EqualTo(originalSpeed2));
                Assert.That(renderer.sharedMaterial, Is.SameAs(material));

                Assert.That(adapter.Restore(), Is.True);
                renderer.GetPropertyBlock(inspectionBlock, 0);
                Assert.That(
                    inspectionBlock.GetFloat(adapter.PropertyIds.FlowSpeed),
                    Is.EqualTo(material.GetFloat("_FlowSpeed")).Within(0.001f));
            }
            finally
            {
                adapter?.Release();
                Object.DestroyImmediate(visualRoot);
            }
        }

        [Test]
        public void 区域边界材质默认静态并支持显式方向适配()
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(RailMaterialPath);
            Assert.That(material, Is.Not.Null, "未找到已导入的区域边界材质。");

            GameObject visualRoot = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ThreeLayerMaterialPropertyAdapter adapter = null;
            try
            {
                Renderer renderer = visualRoot.GetComponent<Renderer>();
                renderer.sharedMaterial = material;
                Color originalColor = material.GetColor("_mainColor");
                Vector4 originalDirection = material.GetVector("_direction");

                Assert.That(
                    ThreeLayerMaterialPropertyAdapter.TryCreate(
                        renderer,
                        0,
                        out adapter,
                        out string error),
                    Is.True,
                    error);
                Assert.That(adapter.PropertyIds.Color, Is.Not.EqualTo(0));
                Assert.That(adapter.PropertyIds.FlowDirection, Is.Not.EqualTo(0));
                Assert.That(adapter.PropertyIds.FlowSpeed, Is.Not.EqualTo(0));
                Assert.That(adapter.OriginalFlowSpeed, Is.EqualTo(0f).Within(0.001f));

                Vector4 explicitDirection = new Vector4(0f, 1f, 0f, 0f);
                ThreeLayerMaterialPropertyValues values = new ThreeLayerMaterialPropertyValues
                {
                    HasFlowDirection = true,
                    FlowDirection = explicitDirection,
                    HasFlowSpeed = true,
                    FlowSpeed = 1f
                };
                Assert.That(adapter.Apply(values), Is.True);

                MaterialPropertyBlock inspectionBlock = new MaterialPropertyBlock();
                renderer.GetPropertyBlock(inspectionBlock, 0);
                Assert.That(inspectionBlock.GetVector(adapter.PropertyIds.FlowDirection), Is.EqualTo(explicitDirection));
                Assert.That(inspectionBlock.GetFloat(adapter.PropertyIds.FlowSpeed), Is.EqualTo(1f).Within(0.001f));
                Assert.That(material.GetColor("_mainColor"), Is.EqualTo(originalColor));
                Assert.That(material.GetVector("_direction"), Is.EqualTo(originalDirection));
                Assert.That(renderer.sharedMaterial, Is.SameAs(material));

                Assert.That(adapter.Restore(), Is.True);
                renderer.GetPropertyBlock(inspectionBlock, 0);
                Assert.That(inspectionBlock.GetVector(adapter.PropertyIds.FlowDirection), Is.EqualTo(originalDirection));
                Assert.That(inspectionBlock.GetFloat(adapter.PropertyIds.FlowSpeed), Is.EqualTo(0f).Within(0.001f));
            }
            finally
            {
                adapter?.Release();
                Object.DestroyImmediate(visualRoot);
            }
        }
    }
}
