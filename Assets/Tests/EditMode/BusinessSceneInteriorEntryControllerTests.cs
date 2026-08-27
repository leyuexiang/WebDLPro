using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>验证 R-014 厂房入口的显式碰撞绑定、下钻装配、返回恢复和普通节点点击优先级。</summary>
    public sealed class BusinessSceneInteriorEntryControllerTests
    {
        private sealed class TrackingLease : IDisposable
        {
            public int DisposeCount { get; private set; }

            public void Dispose()
            {
                DisposeCount++;
            }
        }

        private sealed class TestDetailLoader : MonoBehaviour, IBusinessSceneDetailLoader
        {
            public int CallCount { get; private set; }
            public TrackingLease LastLease { get; private set; }
            public GameObject LastDetailRoot { get; private set; }

            public IEnumerator LoadAsync(
                BusinessSceneDetailCatalogEntry entry,
                Action<BusinessSceneDetailLoadResult> completed)
            {
                CallCount++;
                yield return null;
                LastLease = new TrackingLease();
                LastDetailRoot = new GameObject("EntryTestDetail");
                completed(BusinessSceneDetailLoadResult.Completed(
                    new BusinessSceneDetailLoadHandle(LastDetailRoot, LastLease)));
            }
        }

        private sealed class TestStateReplayer : MonoBehaviour, IBusinessSceneDetailStateReplayer
        {
            public bool DetailWasInactiveDuringReplay { get; private set; }
            public int ReplayCount { get; private set; }
            public bool FailReplay { get; set; }

            public BusinessSceneCommandResult ReplayLatest(GameObject detailRoot)
            {
                ReplayCount++;
                DetailWasInactiveDuringReplay = detailRoot != null && !detailRoot.activeSelf;
                return FailReplay
                    ? BusinessSceneCommandResult.Failed(
                        "entry-test-replay-failed",
                        "测试状态重放失败。")
                    : BusinessSceneCommandResult.Completed("测试状态重放完成。");
            }
        }

        [Test]
        public void 显式厂房碰撞入口完成下钻并在返回后恢复壳体与交互()
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            Assert.That(shader, Is.Not.Null);
            Material sourceMaterial = new Material(shader) { name = "EntryShellSource" };
            Material transparentMaterial = new Material(shader) { name = "EntryShellTransparent" };
            sourceMaterial.SetColor("_BaseColor", Color.white);
            transparentMaterial.SetColor("_BaseColor", Color.white);

            BusinessSceneDetailCatalog catalog = CreateCompleteDetailCatalog();
            GameObject runtimeRoot = new GameObject("InteriorEntryRuntime");
            GameObject shell = GameObject.CreatePrimitive(PrimitiveType.Cube);
            GameObject unrelated = GameObject.CreatePrimitive(PrimitiveType.Cube);
            GameObject detailMount = new GameObject("DetailMount");
            runtimeRoot.transform.position = new Vector3(2000f, 0f, 0f);
            shell.transform.position = new Vector3(2000f, 0f, 0f);
            unrelated.transform.position = new Vector3(2003f, 0f, 0f);
            detailMount.transform.SetParent(runtimeRoot.transform, false);
            MeshRenderer shellRenderer = shell.GetComponent<MeshRenderer>();
            shellRenderer.sharedMaterials = new[] { sourceMaterial };
            BoxCollider interactionCollider = shell.GetComponent<BoxCollider>();
            TestDetailLoader loader = runtimeRoot.AddComponent<TestDetailLoader>();
            TestStateReplayer replayer = runtimeRoot.AddComponent<TestStateReplayer>();
            BusinessSceneInteriorEntryController entry = runtimeRoot.AddComponent<BusinessSceneInteriorEntryController>();
            try
            {
                entry.ConfigureForEditor(
                    "coal-power",
                    "interior.coal-power.main-factory",
                    catalog,
                    interactionCollider,
                    detailMount.transform,
                    loader,
                    replayer,
                    new Renderer[] { shellRenderer },
                    new[] { new BusinessSceneShellMaterialVariant(sourceMaterial, transparentMaterial) },
                    0.3f,
                    BusinessSceneInteriorShellMode.Translucent,
                    BusinessSceneExteriorShellMode.Opaque);
                BusinessSceneCommandResult initialization = entry.Initialize();
                Assert.That(initialization.Success, Is.True, initialization.Message);

                Physics.SyncTransforms();
                Assert.That(
                    entry.TryConsumePointer(new Ray(new Vector3(2000f, 0f, -5f), Vector3.forward)),
                    Is.True,
                    "只有显式登记的厂房 Collider 才能消费下钻点击。");
                Assert.That(
                    entry.TryConsumePointer(new Ray(new Vector3(2003f, 0f, -5f), Vector3.forward)),
                    Is.False,
                    "未登记碰撞体必须继续交给普通节点选择路径。");
                Assert.That(loader.CallCount, Is.EqualTo(0), "编辑模式射线验证不应隐式启动协程。");

                BusinessSceneCommandResult enterResult = default;
                Run(entry.EnterAsync(result => enterResult = result));
                Assert.That(enterResult.Success, Is.True, enterResult.Message);
                Assert.That(entry.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.DetailVisible));
                Assert.That(loader.CallCount, Is.EqualTo(1));
                Assert.That(replayer.ReplayCount, Is.EqualTo(1));
                Assert.That(replayer.DetailWasInactiveDuringReplay, Is.True);
                Assert.That(loader.LastDetailRoot.activeSelf, Is.True);
                Assert.That(interactionCollider.enabled, Is.False, "内部设备可见后入口碰撞体必须关闭，避免遮挡设备射线。");
                Assert.That(shellRenderer.sharedMaterials[0], Is.SameAs(transparentMaterial));

                BusinessSceneCommandResult returnResult = entry.ReturnToExterior();
                Assert.That(returnResult.Success, Is.True, returnResult.Message);
                Assert.That(entry.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.Exterior));
                Assert.That(interactionCollider.enabled, Is.True);
                Assert.That(shellRenderer.sharedMaterials[0], Is.SameAs(sourceMaterial));
                Assert.That(loader.LastDetailRoot == null, Is.True);
                Assert.That(loader.LastLease.DisposeCount, Is.EqualTo(1));

                Assert.That(entry.Release().Success, Is.True);
                Assert.That(entry.Release().Success, Is.True, "入口释放必须幂等。");
                Assert.That(interactionCollider.enabled, Is.True);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(unrelated);
                UnityEngine.Object.DestroyImmediate(shell);
                UnityEngine.Object.DestroyImmediate(runtimeRoot);
                UnityEngine.Object.DestroyImmediate(catalog);
                UnityEngine.Object.DestroyImmediate(sourceMaterial);
                UnityEngine.Object.DestroyImmediate(transparentMaterial);
            }
        }

        [Test]
        public void 状态重放失败不切换壳体且入口仍可重试()
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            Material sourceMaterial = new Material(shader) { name = "FailureShellSource" };
            Material transparentMaterial = new Material(shader) { name = "FailureShellTransparent" };
            sourceMaterial.SetColor("_BaseColor", Color.white);
            transparentMaterial.SetColor("_BaseColor", Color.white);
            BusinessSceneDetailCatalog catalog = CreateCompleteDetailCatalog();
            GameObject runtimeRoot = new GameObject("InteriorFailureEntryRuntime");
            GameObject shell = GameObject.CreatePrimitive(PrimitiveType.Cube);
            GameObject detailMount = new GameObject("DetailMount");
            detailMount.transform.SetParent(runtimeRoot.transform, false);
            MeshRenderer shellRenderer = shell.GetComponent<MeshRenderer>();
            shellRenderer.sharedMaterials = new[] { sourceMaterial };
            BoxCollider interactionCollider = shell.GetComponent<BoxCollider>();
            TestDetailLoader loader = runtimeRoot.AddComponent<TestDetailLoader>();
            TestStateReplayer replayer = runtimeRoot.AddComponent<TestStateReplayer>();
            replayer.FailReplay = true;
            BusinessSceneInteriorEntryController entry = runtimeRoot.AddComponent<BusinessSceneInteriorEntryController>();
            try
            {
                entry.ConfigureForEditor(
                    "coal-power",
                    "interior.coal-power.failure-test",
                    catalog,
                    interactionCollider,
                    detailMount.transform,
                    loader,
                    replayer,
                    new Renderer[] { shellRenderer },
                    new[] { new BusinessSceneShellMaterialVariant(sourceMaterial, transparentMaterial) },
                    0.3f,
                    BusinessSceneInteriorShellMode.Hidden,
                    BusinessSceneExteriorShellMode.Opaque);
                Assert.That(entry.Initialize().Success, Is.True);

                BusinessSceneCommandResult enterResult = default;
                Run(entry.EnterAsync(result => enterResult = result));
                Assert.That(enterResult.Success, Is.False);
                Assert.That(enterResult.ErrorCode, Is.EqualTo("entry-test-replay-failed"));
                Assert.That(entry.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.Failed));
                Assert.That(shellRenderer.enabled, Is.True);
                Assert.That(shellRenderer.sharedMaterials[0], Is.SameAs(sourceMaterial));
                Assert.That(interactionCollider.enabled, Is.True);
                Assert.That(loader.LastDetailRoot == null, Is.True);
                Assert.That(loader.LastLease.DisposeCount, Is.EqualTo(1));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(shell);
                UnityEngine.Object.DestroyImmediate(runtimeRoot);
                UnityEngine.Object.DestroyImmediate(catalog);
                UnityEngine.Object.DestroyImmediate(sourceMaterial);
                UnityEngine.Object.DestroyImmediate(transparentMaterial);
            }
        }

        [Test]
        public void 发电场景在普通节点选择前优先执行场景内点击消费者()
        {
            string sourcePath = Path.Combine(
                Application.dataPath,
                "Scripts",
                "PowerPlant",
                "PowerPlantProcessController.cs");
            string source = File.ReadAllText(sourcePath);
            int consumeIndex = source.IndexOf("if (TryConsumePriorityPointer(ray))", StringComparison.Ordinal);
            int normalSelectionIndex = source.IndexOf(
                "if (TryResolvePointerSelection(ray, out string sceneNodeId, out GameObject rootObject))",
                StringComparison.Ordinal);

            Assert.That(consumeIndex, Is.GreaterThanOrEqualTo(0));
            Assert.That(normalSelectionIndex, Is.GreaterThan(consumeIndex),
                "厂房内部入口必须在普通节点 Focus 和 objectSelected 之前消费同一次点击。");
            Assert.That(source, Does.Contain("_priorityPointerConsumer.TryConsumePointer(ray)"));
        }

        private static BusinessSceneDetailCatalog CreateCompleteDetailCatalog()
        {
            BusinessSceneDetailCatalog catalog = ScriptableObject.CreateInstance<BusinessSceneDetailCatalog>();
            IReadOnlyList<string> sceneIds = BusinessSceneCatalog.GetRequiredSceneIds();
            BusinessSceneDetailCatalogEntry[] entries = new BusinessSceneDetailCatalogEntry[sceneIds.Count];
            for (int index = 0; index < sceneIds.Count; index++)
            {
                entries[index] = new BusinessSceneDetailCatalogEntry(
                    sceneIds[index],
                    $"detail.{sceneIds[index]}.equipment",
                    BusinessSceneAvailability.Available);
            }

            catalog.SetEntriesForEditor(entries);
            return catalog;
        }

        private static void Run(IEnumerator routine)
        {
            while (routine.MoveNext())
            {
            }
        }
    }
}
