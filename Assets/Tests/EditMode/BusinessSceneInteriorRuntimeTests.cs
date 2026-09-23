using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>验证 R-013 的最新状态镜像、隐藏加载、壳体提交、失败恢复和快速返回串行化。</summary>
    public sealed class BusinessSceneInteriorRuntimeTests
    {
        private sealed class TrackingLease : IDisposable
        {
            public int DisposeCount { get; private set; }

            public void Dispose()
            {
                DisposeCount++;
            }
        }

        private sealed class TestDetailStateTarget : MonoBehaviour, IBusinessSceneDetailStateTarget
        {
            public readonly Dictionary<string, BusinessSceneNodeVisualState> States =
                new Dictionary<string, BusinessSceneNodeVisualState>(StringComparer.Ordinal);
            public readonly HashSet<string> ClearedNodes = new HashSet<string>(StringComparer.Ordinal);

            public BusinessSceneCommandResult UpdateNodeVisualState(
                string sceneNodeId,
                BusinessSceneNodeVisualState visualState)
            {
                States[sceneNodeId] = visualState;
                ClearedNodes.Remove(sceneNodeId);
                return BusinessSceneCommandResult.Completed("测试设备状态已设置。");
            }

            public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId)
            {
                States.Remove(sceneNodeId);
                ClearedNodes.Add(sceneNodeId);
                return BusinessSceneCommandResult.Completed("测试设备状态已清除。");
            }
        }

        private sealed class MirrorStateReplayer : IBusinessSceneDetailStateReplayer
        {
            private readonly BusinessSceneDetailStateSnapshotMirror _mirror;

            public long LastReplayedSequence { get; private set; }
            public TestDetailStateTarget LastTarget { get; private set; }

            public MirrorStateReplayer(BusinessSceneDetailStateSnapshotMirror mirror)
            {
                _mirror = mirror;
            }

            public BusinessSceneCommandResult ReplayLatest(GameObject detailRoot)
            {
                LastTarget = detailRoot.GetComponent<TestDetailStateTarget>();
                LastReplayedSequence = _mirror.SnapshotSequence;
                return _mirror.ReplayLatest(LastTarget);
            }
        }

        private sealed class FailingStateReplayer : IBusinessSceneDetailStateReplayer
        {
            public BusinessSceneCommandResult ReplayLatest(GameObject detailRoot)
            {
                return BusinessSceneCommandResult.Failed(
                    "detail-state-binding-invalid",
                    "测试设备状态绑定失败。");
            }
        }

        /// <summary>每次加载先等待一帧，再创建并返回独占设备实例。</summary>
        private sealed class QueuedDetailLoader : IBusinessSceneDetailLoader
        {
            private readonly Queue<Func<BusinessSceneDetailLoadResult>> _results =
                new Queue<Func<BusinessSceneDetailLoadResult>>();

            public int CallCount { get; private set; }

            public void Enqueue(Func<BusinessSceneDetailLoadResult> resultFactory)
            {
                _results.Enqueue(resultFactory);
            }

            public IEnumerator LoadAsync(
                BusinessSceneDetailCatalogEntry entry,
                Action<BusinessSceneDetailLoadResult> completed)
            {
                CallCount++;
                yield return null;
                completed(_results.Dequeue().Invoke());
            }
        }

        private sealed class ShellFixture : IDisposable
        {
            public GameObject Root { get; }
            public MeshRenderer Renderer { get; }
            public Material SourceMaterial { get; }
            public Material TransparentMaterial { get; }
            public BusinessSceneShellVisualRuntime Runtime { get; }

            public ShellFixture()
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                Assert.That(shader, Is.Not.Null);
                SourceMaterial = new Material(shader) { name = "InteriorTestShellSource" };
                TransparentMaterial = new Material(shader) { name = "InteriorTestShellTransparent" };
                SourceMaterial.SetColor("_BaseColor", Color.white);
                TransparentMaterial.SetColor("_BaseColor", Color.white);
                Root = new GameObject("InteriorTestShell");
                Renderer = Root.AddComponent<MeshRenderer>();
                Renderer.sharedMaterials = new[] { SourceMaterial };

                Assert.That(
                    BusinessSceneShellVisualRuntime.TryCreate(
                        "shell.coal-power.interior-test",
                        new Renderer[] { Renderer },
                        new[] { new BusinessSceneShellMaterialVariant(SourceMaterial, TransparentMaterial) },
                        0.3f,
                        out BusinessSceneShellVisualRuntime runtime,
                        out string error),
                    Is.True,
                    error);
                Runtime = runtime;
            }

            public void Dispose()
            {
                Runtime?.Release();
                UnityEngine.Object.DestroyImmediate(Root);
                UnityEngine.Object.DestroyImmediate(SourceMaterial);
                UnityEngine.Object.DestroyImmediate(TransparentMaterial);
            }
        }

        [Test]
        public void 状态镜像原子替换完整快照并在重放时清除缺失节点()
        {
            Assert.That(
                BusinessSceneDetailStateSnapshotMirror.TryCreate(
                    new[] { "node.device-a", "node.device-b" },
                    out BusinessSceneDetailStateSnapshotMirror mirror,
                    out string error),
                Is.True,
                error);
            GameObject targetObject = new GameObject("DetailStateTarget");
            try
            {
                TestDetailStateTarget target = targetObject.AddComponent<TestDetailStateTarget>();
                Assert.That(
                    mirror.ApplySnapshot(
                        1,
                        new[]
                        {
                            BusinessSceneDetailNodeStateUpdate.Set(
                                "node.device-a",
                                BusinessSceneNodeVisualState.Alarm)
                        }).Success,
                    Is.True);
                Assert.That(mirror.ReplayLatest(target).Success, Is.True);
                Assert.That(target.States["node.device-a"], Is.EqualTo(BusinessSceneNodeVisualState.Alarm));
                Assert.That(target.ClearedNodes.Contains("node.device-b"), Is.True);

                Assert.That(
                    mirror.ApplySnapshot(
                        1,
                        new[]
                        {
                            BusinessSceneDetailNodeStateUpdate.Set(
                                "node.device-a",
                                BusinessSceneNodeVisualState.Fault)
                        }).Success,
                    Is.True,
                    "相同序号必须幂等忽略。");
                Assert.That(mirror.ReplayLatest(target).Success, Is.True);
                Assert.That(target.States["node.device-a"], Is.EqualTo(BusinessSceneNodeVisualState.Alarm));

                Assert.That(
                    mirror.ApplySnapshot(
                        2,
                        new[]
                        {
                            BusinessSceneDetailNodeStateUpdate.Set(
                                "node.device-b",
                                BusinessSceneNodeVisualState.Offline)
                        }).Success,
                    Is.True);
                Assert.That(mirror.ReplayLatest(target).Success, Is.True);
                Assert.That(target.ClearedNodes.Contains("node.device-a"), Is.True);
                Assert.That(target.States["node.device-b"], Is.EqualTo(BusinessSceneNodeVisualState.Offline));
                Assert.That(mirror.SnapshotSequence, Is.EqualTo(2));

                mirror.Release();
                Assert.That(mirror.ReplayLatest(target).Success, Is.False);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(targetObject);
            }
        }

        [Test]
        public void 加载期间新快照在首次显示前重放且返回重入不丢同序号状态()
        {
            using (ShellFixture shell = new ShellFixture())
            {
                Assert.That(
                    BusinessSceneDetailStateSnapshotMirror.TryCreate(
                        new[] { "node.device-a" },
                        out BusinessSceneDetailStateSnapshotMirror mirror,
                        out string mirrorError),
                    Is.True,
                    mirrorError);
                mirror.ApplySnapshot(
                    1,
                    new[]
                    {
                        BusinessSceneDetailNodeStateUpdate.Set(
                            "node.device-a",
                            BusinessSceneNodeVisualState.Alarm)
                    });

                BusinessSceneDetailRuntime detailRuntime = new BusinessSceneDetailRuntime("coal-power");
                BusinessSceneInteriorRuntime interior = new BusinessSceneInteriorRuntime(
                    detailRuntime,
                    shell.Runtime,
                    BusinessSceneInteriorShellMode.Translucent,
                    BusinessSceneExteriorShellMode.Opaque);
                QueuedDetailLoader loader = new QueuedDetailLoader();
                MirrorStateReplayer replayer = new MirrorStateReplayer(mirror);
                TrackingLease firstLease = new TrackingLease();
                TrackingLease secondLease = new TrackingLease();
                GameObject mount = new GameObject("InteriorDetailMount");
                GameObject firstDetail = null;
                GameObject secondDetail = null;
                try
                {
                    loader.Enqueue(() => CreateDetailResult(
                        "FirstInteriorDetail",
                        firstLease,
                        out firstDetail));
                    BusinessSceneCommandResult firstEnterResult = default;
                    IEnumerator firstEnter = interior.EnterAsync(
                        CreateCoalDetailEntry(),
                        loader,
                        mount.transform,
                        replayer,
                        result => firstEnterResult = result);
                    Assert.That(firstEnter.MoveNext(), Is.True, "设备加载应先跨过异步等待点。");
                    Assert.That(shell.Runtime.Mode, Is.EqualTo(BusinessSceneShellVisualMode.Baseline));
                    Assert.That(shell.Renderer.sharedMaterials[0], Is.SameAs(shell.SourceMaterial));

                    mirror.ApplySnapshot(
                        2,
                        new[]
                        {
                            BusinessSceneDetailNodeStateUpdate.Set(
                                "node.device-a",
                                BusinessSceneNodeVisualState.Fault)
                        });
                    while (firstEnter.MoveNext())
                    {
                    }

                    Assert.That(firstEnterResult.Success, Is.True, firstEnterResult.Message);
                    Assert.That(interior.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.DetailVisible));
                    Assert.That(replayer.LastReplayedSequence, Is.EqualTo(2));
                    Assert.That(replayer.LastTarget.States["node.device-a"], Is.EqualTo(BusinessSceneNodeVisualState.Fault));
                    Assert.That(firstDetail.activeSelf, Is.True, "设备只有完成最新状态重放后才能激活。");
                    Assert.That(shell.Runtime.Mode, Is.EqualTo(BusinessSceneShellVisualMode.Translucent));
                    Assert.That(shell.Renderer.sharedMaterials[0], Is.SameAs(shell.TransparentMaterial));

                    BusinessSceneCommandResult duplicateResult = default;
                    Run(interior.EnterAsync(
                        CreateCoalDetailEntry(),
                        loader,
                        mount.transform,
                        replayer,
                        result => duplicateResult = result));
                    Assert.That(duplicateResult.Success, Is.True);
                    Assert.That(loader.CallCount, Is.EqualTo(1));

                    Assert.That(interior.ReturnToExterior().Success, Is.True);
                    Assert.That(interior.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.Exterior));
                    Assert.That(firstDetail == null, Is.True);
                    Assert.That(firstLease.DisposeCount, Is.EqualTo(1));
                    Assert.That(shell.Runtime.Mode, Is.EqualTo(BusinessSceneShellVisualMode.Opaque));
                    Assert.That(shell.Renderer.sharedMaterials[0], Is.SameAs(shell.SourceMaterial));

                    loader.Enqueue(() => CreateDetailResult(
                        "SecondInteriorDetail",
                        secondLease,
                        out secondDetail));
                    BusinessSceneCommandResult secondEnterResult = default;
                    Run(interior.EnterAsync(
                        CreateCoalDetailEntry(),
                        loader,
                        mount.transform,
                        replayer,
                        result => secondEnterResult = result));
                    Assert.That(secondEnterResult.Success, Is.True, secondEnterResult.Message);
                    Assert.That(loader.CallCount, Is.EqualTo(2));
                    Assert.That(replayer.LastReplayedSequence, Is.EqualTo(2));
                    Assert.That(replayer.LastTarget.States["node.device-a"], Is.EqualTo(BusinessSceneNodeVisualState.Fault));
                    Assert.That(secondDetail.activeSelf, Is.True);

                    interior.Dispose();
                    Assert.That(secondDetail == null, Is.True);
                    Assert.That(secondLease.DisposeCount, Is.EqualTo(1));
                }
                finally
                {
                    interior.Dispose();
                    mirror.Release();
                    UnityEngine.Object.DestroyImmediate(mount);
                }
            }
        }

        [Test]
        public void 状态重放失败保留壳体且加载中返回阻止并发重入()
        {
            using (ShellFixture shell = new ShellFixture())
            {
                BusinessSceneDetailRuntime detailRuntime = new BusinessSceneDetailRuntime("coal-power");
                BusinessSceneInteriorRuntime interior = new BusinessSceneInteriorRuntime(
                    detailRuntime,
                    shell.Runtime,
                    BusinessSceneInteriorShellMode.Hidden,
                    BusinessSceneExteriorShellMode.Opaque);
                QueuedDetailLoader loader = new QueuedDetailLoader();
                TrackingLease failedLease = new TrackingLease();
                TrackingLease lateLease = new TrackingLease();
                TrackingLease retryLease = new TrackingLease();
                GameObject mount = new GameObject("InteriorFailureMount");
                GameObject failedDetail = null;
                GameObject lateDetail = null;
                GameObject retryDetail = null;
                try
                {
                    loader.Enqueue(() => CreateDetailResult(
                        "FailedReplayDetail",
                        failedLease,
                        out failedDetail));
                    BusinessSceneCommandResult failedResult = default;
                    Run(interior.EnterAsync(
                        CreateCoalDetailEntry(),
                        loader,
                        mount.transform,
                        new FailingStateReplayer(),
                        result => failedResult = result));
                    Assert.That(failedResult.Success, Is.False);
                    Assert.That(failedResult.ErrorCode, Is.EqualTo("detail-state-binding-invalid"));
                    Assert.That(interior.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.Failed));
                    Assert.That(failedDetail == null, Is.True);
                    Assert.That(failedLease.DisposeCount, Is.EqualTo(1));
                    Assert.That(shell.Runtime.Mode, Is.EqualTo(BusinessSceneShellVisualMode.Baseline));
                    Assert.That(shell.Renderer.enabled, Is.True);

                    Assert.That(
                        BusinessSceneDetailStateSnapshotMirror.TryCreate(
                            new[] { "node.device-a" },
                            out BusinessSceneDetailStateSnapshotMirror mirror,
                            out string mirrorError),
                        Is.True,
                        mirrorError);
                    MirrorStateReplayer replayer = new MirrorStateReplayer(mirror);
                    loader.Enqueue(() => CreateDetailResult(
                        "LateDetail",
                        lateLease,
                        out lateDetail));
                    BusinessSceneCommandResult lateEnterResult = default;
                    IEnumerator loading = interior.EnterAsync(
                        CreateCoalDetailEntry(),
                        loader,
                        mount.transform,
                        replayer,
                        result => lateEnterResult = result);
                    Assert.That(loading.MoveNext(), Is.True);
                    Assert.That(interior.ReturnToExterior().Success, Is.True);
                    Assert.That(interior.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.Returning));

                    BusinessSceneCommandResult blockedResult = default;
                    Run(interior.EnterAsync(
                        CreateCoalDetailEntry(),
                        loader,
                        mount.transform,
                        replayer,
                        result => blockedResult = result));
                    Assert.That(blockedResult.Success, Is.False);
                    Assert.That(blockedResult.ErrorCode, Is.EqualTo("scene-interior-return-in-progress"));
                    Assert.That(loader.CallCount, Is.EqualTo(2), "返回清理完成前不得启动第三次底层加载。");

                    while (loading.MoveNext())
                    {
                    }
                    Assert.That(lateEnterResult.Success, Is.False);
                    Assert.That(lateDetail == null, Is.True);
                    Assert.That(lateLease.DisposeCount, Is.EqualTo(1));
                    Assert.That(interior.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.Exterior));

                    loader.Enqueue(() => CreateDetailResult(
                        "RetryDetail",
                        retryLease,
                        out retryDetail));
                    BusinessSceneCommandResult retryResult = default;
                    Run(interior.EnterAsync(
                        CreateCoalDetailEntry(),
                        loader,
                        mount.transform,
                        replayer,
                        result => retryResult = result));
                    Assert.That(retryResult.Success, Is.True, retryResult.Message);
                    Assert.That(loader.CallCount, Is.EqualTo(3));
                    Assert.That(interior.State, Is.EqualTo(BusinessSceneInteriorRuntimeState.DetailVisible));
                    Assert.That(retryDetail.activeSelf, Is.True);
                    Assert.That(shell.Runtime.Mode, Is.EqualTo(BusinessSceneShellVisualMode.Hidden));

                    mirror.Release();
                }
                finally
                {
                    interior.Dispose();
                    Assert.That(retryDetail == null, Is.True);
                    Assert.That(retryLease.DisposeCount, Is.EqualTo(1));
                    UnityEngine.Object.DestroyImmediate(mount);
                }
            }
        }

        private static BusinessSceneDetailLoadResult CreateDetailResult(
            string name,
            TrackingLease lease,
            out GameObject detailRoot)
        {
            detailRoot = new GameObject(name);
            detailRoot.AddComponent<TestDetailStateTarget>();
            return BusinessSceneDetailLoadResult.Completed(
                new BusinessSceneDetailLoadHandle(detailRoot, lease));
        }

        private static BusinessSceneDetailCatalogEntry CreateCoalDetailEntry()
        {
            return new BusinessSceneDetailCatalogEntry(
                "coal-power",
                "detail.coal-power.equipment",
                BusinessSceneAvailability.Available);
        }

        private static void Run(IEnumerator routine)
        {
            while (routine.MoveNext())
            {
            }
        }
    }
}
