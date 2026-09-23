using NUnit.Framework;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>验证 R-012 厂房壳体的多材质整体透明、隐藏、基线恢复和共享材质复用。</summary>
    public sealed class BusinessSceneShellVisualRuntimeTests
    {
        [Test]
        public void 多材质壳体整体透明隐藏和恢复均保持完整基线()
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            Assert.That(shader, Is.Not.Null);

            Material sourceWall = new Material(shader) { name = "SourceWall" };
            Material sourceRoof = new Material(shader) { name = "SourceRoof" };
            Material transparentWall = new Material(shader) { name = "TransparentWallShared" };
            Material transparentRoof = new Material(shader) { name = "TransparentRoofShared" };
            sourceWall.SetColor("_BaseColor", new Color(0.8f, 0.2f, 0.1f, 1f));
            sourceRoof.SetColor("_BaseColor", new Color(0.1f, 0.7f, 0.3f, 1f));
            transparentWall.SetColor("_BaseColor", new Color(0.8f, 0.2f, 0.1f, 1f));
            transparentRoof.SetColor("_BaseColor", new Color(0.1f, 0.7f, 0.3f, 1f));

            GameObject shellRoot = new GameObject("FactoryShellRoot");
            GameObject mainShell = new GameObject("MainShellRenderer");
            GameObject auxiliaryShell = new GameObject("AuxiliaryShellRenderer");
            GameObject internalDevice = new GameObject("InternalDevice");
            mainShell.transform.SetParent(shellRoot.transform, false);
            auxiliaryShell.transform.SetParent(shellRoot.transform, false);
            internalDevice.transform.SetParent(shellRoot.transform, false);
            MeshRenderer mainRenderer = mainShell.AddComponent<MeshRenderer>();
            MeshRenderer auxiliaryRenderer = auxiliaryShell.AddComponent<MeshRenderer>();
            MeshRenderer internalRenderer = internalDevice.AddComponent<MeshRenderer>();
            mainRenderer.sharedMaterials = new[] { sourceWall, sourceRoof };
            auxiliaryRenderer.sharedMaterials = new[] { sourceWall };
            internalRenderer.sharedMaterials = new[] { sourceRoof };
            auxiliaryRenderer.enabled = false;

            int baseColorId = Shader.PropertyToID("_BaseColor");
            int preservedValueId = Shader.PropertyToID("_ShellTestPreservedValue");
            MaterialPropertyBlock originalFirstSlot = new MaterialPropertyBlock();
            originalFirstSlot.SetColor(baseColorId, new Color(0.25f, 0.5f, 0.75f, 0.9f));
            originalFirstSlot.SetFloat(preservedValueId, 3.5f);
            mainRenderer.SetPropertyBlock(originalFirstSlot, 0);
            mainRenderer.SetPropertyBlock(null, 1);

            BusinessSceneShellVisualRuntime runtime = null;
            try
            {
                BusinessSceneShellMaterialVariant[] variants =
                {
                    new BusinessSceneShellMaterialVariant(sourceWall, transparentWall),
                    new BusinessSceneShellMaterialVariant(sourceRoof, transparentRoof)
                };
                Assert.That(
                    BusinessSceneShellVisualRuntime.TryCreate(
                        "shell.coal-power.main-factory",
                        new Renderer[] { mainRenderer, auxiliaryRenderer },
                        variants,
                        0.28f,
                        out runtime,
                        out string error),
                    Is.True,
                    error);

                Assert.That(runtime.ShowTranslucent().Success, Is.True);
                Assert.That(runtime.Mode, Is.EqualTo(BusinessSceneShellVisualMode.Translucent));
                Material[] translucentMaterials = mainRenderer.sharedMaterials;
                Assert.That(translucentMaterials[0], Is.SameAs(transparentWall));
                Assert.That(translucentMaterials[1], Is.SameAs(transparentRoof));
                Assert.That(auxiliaryRenderer.sharedMaterials[0], Is.SameAs(transparentWall));
                Assert.That(auxiliaryRenderer.enabled, Is.True, "整体半透明应显示所有已登记壳体 Renderer。");

                MaterialPropertyBlock inspectionBlock = new MaterialPropertyBlock();
                mainRenderer.GetPropertyBlock(inspectionBlock, 0);
                Color translucentColor = inspectionBlock.GetColor(baseColorId);
                Assert.That(translucentColor.r, Is.EqualTo(0.25f).Within(0.001f));
                Assert.That(translucentColor.g, Is.EqualTo(0.5f).Within(0.001f));
                Assert.That(translucentColor.b, Is.EqualTo(0.75f).Within(0.001f));
                Assert.That(translucentColor.a, Is.EqualTo(0.28f).Within(0.001f));
                Assert.That(inspectionBlock.GetFloat(preservedValueId), Is.EqualTo(3.5f));
                mainRenderer.GetPropertyBlock(inspectionBlock, 1);
                Assert.That(inspectionBlock.GetColor(baseColorId).a, Is.EqualTo(0.28f).Within(0.001f));

                Assert.That(runtime.ShowTranslucent().Success, Is.True);
                Assert.That(mainRenderer.sharedMaterials[0], Is.SameAs(transparentWall), "重复切换必须继续复用同一共享透明材质。");

                Assert.That(runtime.Hide().Success, Is.True);
                Assert.That(mainRenderer.enabled, Is.False);
                Assert.That(auxiliaryRenderer.enabled, Is.False);
                Assert.That(internalRenderer.enabled, Is.True, "隐藏壳体不能停用同层级内部设备。");
                Assert.That(internalDevice, Is.Not.Null);

                Assert.That(runtime.ShowOpaque().Success, Is.True);
                Material[] opaqueMaterials = mainRenderer.sharedMaterials;
                Assert.That(opaqueMaterials[0], Is.SameAs(sourceWall));
                Assert.That(opaqueMaterials[1], Is.SameAs(sourceRoof));
                Assert.That(mainRenderer.enabled, Is.True);
                Assert.That(auxiliaryRenderer.enabled, Is.True);
                mainRenderer.GetPropertyBlock(inspectionBlock, 0);
                Color restoredColor = inspectionBlock.GetColor(baseColorId);
                Assert.That(restoredColor.r, Is.EqualTo(0.25f).Within(0.001f));
                Assert.That(restoredColor.g, Is.EqualTo(0.5f).Within(0.001f));
                Assert.That(restoredColor.b, Is.EqualTo(0.75f).Within(0.001f));
                Assert.That(restoredColor.a, Is.EqualTo(0.9f).Within(0.001f));
                Assert.That(inspectionBlock.GetFloat(preservedValueId), Is.EqualTo(3.5f));
                mainRenderer.GetPropertyBlock(inspectionBlock, 1);
                Assert.That(inspectionBlock.isEmpty, Is.True, "原本为空的材质槽属性块必须被完整清除。");

                Assert.That(runtime.RestoreBaseline().Success, Is.True);
                Assert.That(mainRenderer.enabled, Is.True);
                Assert.That(auxiliaryRenderer.enabled, Is.False, "整体恢复必须还原每个 Renderer 的登记启用状态。");

                Assert.That(runtime.Release().Success, Is.True);
                Assert.That(runtime.Release().Success, Is.True, "释放必须幂等。");
                Assert.That(runtime.Mode, Is.EqualTo(BusinessSceneShellVisualMode.Released));
                Assert.That(runtime.ShowTranslucent().Success, Is.False);
                Assert.That(mainRenderer.sharedMaterials[0], Is.SameAs(sourceWall));
                Assert.That(auxiliaryRenderer.enabled, Is.False);
            }
            finally
            {
                runtime?.Release();
                Object.DestroyImmediate(shellRoot);
                Object.DestroyImmediate(sourceWall);
                Object.DestroyImmediate(sourceRoof);
                Object.DestroyImmediate(transparentWall);
                Object.DestroyImmediate(transparentRoof);
            }
        }

        [Test]
        public void 壳体任一材质槽缺少透明变体时整体拒绝且不修改渲染器()
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            Assert.That(shader, Is.Not.Null);

            Material sourceWall = new Material(shader) { name = "SourceWall" };
            Material sourceRoof = new Material(shader) { name = "SourceRoof" };
            Material transparentWall = new Material(shader) { name = "TransparentWallShared" };
            GameObject shell = new GameObject("InvalidFactoryShell");
            MeshRenderer renderer = shell.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = new[] { sourceWall, sourceRoof };
            try
            {
                Assert.That(
                    BusinessSceneShellVisualRuntime.TryCreate(
                        "shell.gas-power.main-factory",
                        new Renderer[] { renderer },
                        new[] { new BusinessSceneShellMaterialVariant(sourceWall, transparentWall) },
                        0.3f,
                        out BusinessSceneShellVisualRuntime runtime,
                        out string error),
                    Is.False);
                Assert.That(runtime, Is.Null);
                Assert.That(error, Does.Contain("材质槽 1"));
                Assert.That(renderer.sharedMaterials[0], Is.SameAs(sourceWall));
                Assert.That(renderer.sharedMaterials[1], Is.SameAs(sourceRoof));
                Assert.That(renderer.enabled, Is.True);
            }
            finally
            {
                Object.DestroyImmediate(shell);
                Object.DestroyImmediate(sourceWall);
                Object.DestroyImmediate(sourceRoof);
                Object.DestroyImmediate(transparentWall);
            }
        }
    }
}
