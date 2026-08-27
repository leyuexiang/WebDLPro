using System;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 验证区域覆盖和静态边界运行时只消费显式 areaId 与材质属性块。
    /// 测试不创建粒子、不扫描场景层级，也不把测试对象写入正式 Overview 场景。
    /// </summary>
    public sealed class ThreeLayerAreaEffectRuntimeTests
    {
        private const string RailMaterialPath = "Assets/Shaders/Imported/RailArea/Rail.mat";

        [Test]
        public void Rail区域边界按影响集合显示隐藏并恢复共享材质基线()
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(RailMaterialPath);
            Assert.That(material, Is.Not.Null, "未找到已导入的 Rail 区域边界材质。");

            ThreeLayerBindingCatalog catalog = ScriptableObject.CreateInstance<ThreeLayerBindingCatalog>();
            GameObject visualRoot = GameObject.CreatePrimitive(PrimitiveType.Quad);
            ThreeLayerMaterialPropertyAdapter adapter = null;
            ThreeLayerAreaEffectRuntime areaRuntime = null;
            try
            {
                catalog.SetEntriesForEditor(
                    Array.Empty<ThreeLayerNodeBinding>(),
                    Array.Empty<ThreeLayerPipeBinding>(),
                    new[] { new ThreeLayerAreaBinding("area.synthetic.boundary", "coal-power", "effect.synthetic.boundary") },
                    new[] { new ThreeLayerEffectProfileBinding("effect.synthetic.boundary", ThreeLayerAreaEffectType.Boundary) },
                    Array.Empty<ThreeLayerPipeImpactRule>(),
                    Array.Empty<ThreeLayerAreaImpactRule>());
                Assert.That(ThreeLayerBindingIndex.TryCreate(catalog, out ThreeLayerBindingIndex index, out _), Is.True);

                Renderer renderer = visualRoot.GetComponent<Renderer>();
                renderer.sharedMaterial = material;
                Color originalColor = material.GetColor("_mainColor");
                Vector4 originalDirection = material.GetVector("_direction");

                Assert.That(
                    ThreeLayerMaterialPropertyAdapter.TryCreate(renderer, 0, out adapter, out string adapterError),
                    Is.True,
                    adapterError);
                areaRuntime = new ThreeLayerAreaEffectRuntime(index);
                Assert.That(
                    areaRuntime.TryRegisterArea("area.synthetic.boundary", new[] { adapter }, out string registrationError),
                    Is.True,
                    registrationError);
                Assert.That(areaRuntime.IsAreaActive("area.synthetic.boundary"), Is.False);

                MaterialPropertyBlock propertyBlock = new MaterialPropertyBlock();
                renderer.GetPropertyBlock(propertyBlock, 0);
                Assert.That(propertyBlock.GetColor(adapter.PropertyIds.Color).a, Is.EqualTo(0f).Within(0.001f));

                Assert.That(areaRuntime.ApplyImpact(new System.Collections.Generic.HashSet<string> { "area.synthetic.boundary" }).Success, Is.True);
                Assert.That(areaRuntime.IsAreaActive("area.synthetic.boundary"), Is.True);
                renderer.GetPropertyBlock(propertyBlock, 0);
                Assert.That(propertyBlock.GetColor(adapter.PropertyIds.Color), Is.EqualTo(originalColor));

                Assert.That(areaRuntime.ApplyImpact(new System.Collections.Generic.HashSet<string> { "area.synthetic.boundary" }).Success, Is.True);
                renderer.GetPropertyBlock(propertyBlock, 0);
                Assert.That(propertyBlock.GetColor(adapter.PropertyIds.Color), Is.EqualTo(originalColor));

                Assert.That(areaRuntime.ApplyImpact(new System.Collections.Generic.HashSet<string>()).Success, Is.True);
                Assert.That(areaRuntime.IsAreaActive("area.synthetic.boundary"), Is.False);
                renderer.GetPropertyBlock(propertyBlock, 0);
                Assert.That(propertyBlock.GetColor(adapter.PropertyIds.Color).a, Is.EqualTo(0f).Within(0.001f));
                Assert.That(material.GetColor("_mainColor"), Is.EqualTo(originalColor));
                Assert.That(material.GetVector("_direction"), Is.EqualTo(originalDirection));
                Assert.That(renderer.sharedMaterial, Is.SameAs(material));

                Assert.That(areaRuntime.Release().Success, Is.True);
                Assert.That(areaRuntime.Release().Success, Is.True);
                renderer.GetPropertyBlock(propertyBlock, 0);
                Assert.That(propertyBlock.GetColor(adapter.PropertyIds.Color), Is.EqualTo(originalColor));
            }
            finally
            {
                if (areaRuntime != null && !areaRuntime.IsReleased)
                {
                    areaRuntime.Release();
                }
                else
                {
                    adapter?.Release();
                }

                UnityEngine.Object.DestroyImmediate(visualRoot);
                UnityEngine.Object.DestroyImmediate(catalog);
            }
        }
    }
}
