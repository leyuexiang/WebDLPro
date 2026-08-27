using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>验证 R-011 的显式设备细节目录、独立加载句柄和壳体常驻释放边界。</summary>
    public sealed class BusinessSceneDetailRuntimeTests
    {
        private sealed class TrackingLease : IDisposable
        {
            public int DisposeCount { get; private set; }

            public void Dispose()
            {
                DisposeCount++;
            }
        }

        /// <summary>每次加载延迟一帧后返回队列中的结果，便于验证释放与迟到回调竞态。</summary>
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

        [Test]
        public void 设备细节目录要求九场景显式唯一且全部可用()
        {
            BusinessSceneDetailCatalog catalog = ScriptableObject.CreateInstance<BusinessSceneDetailCatalog>();
            try
            {
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
                Assert.That(catalog.ValidateForRuntime(), Is.Empty);
                Assert.That(catalog.TryGetBySceneId("coal-power", out BusinessSceneDetailCatalogEntry coalEntry), Is.True);
                Assert.That(coalEntry.DetailResourceId, Is.EqualTo("detail.coal-power.equipment"));

                entries[entries.Length - 1] = new BusinessSceneDetailCatalogEntry(
                    "dispatch",
                    "detail.coal-power.equipment",
                    BusinessSceneAvailability.Available);
                catalog.SetEntriesForEditor(entries);
                Assert.That(
                    catalog.ValidateForRuntime(),
                    Has.Some.Matches<BusinessSceneCatalogValidationIssue>(issue =>
                        issue.Code == "scene-detail-catalog.resource-id"));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(catalog);
            }
        }

        [Test]
        public void 设备细节独立加载释放且厂区壳体始终保留()
        {
            GameObject shell = new GameObject("PersistentFactoryShell");
            GameObject detailMount = new GameObject("DetailMount");
            BusinessSceneDetailRuntime runtime = new BusinessSceneDetailRuntime("coal-power");
            QueuedDetailLoader loader = new QueuedDetailLoader();
            TrackingLease firstLease = new TrackingLease();
            TrackingLease secondLease = new TrackingLease();
            GameObject firstDetail = null;
            GameObject secondDetail = null;
            try
            {
                BusinessSceneDetailCatalogEntry entry = CreateCoalDetailEntry();
                loader.Enqueue(() => BusinessSceneDetailLoadResult.Completed(
                    new BusinessSceneDetailLoadHandle(
                        firstDetail = new GameObject("CoalEquipmentDetailFirst"),
                        firstLease)));

                BusinessSceneCommandResult firstResult = default;
                Run(runtime.LoadAsync(entry, loader, detailMount.transform, result => firstResult = result));

                Assert.That(firstResult.Success, Is.True, firstResult.Message);
                Assert.That(runtime.State, Is.EqualTo(BusinessSceneDetailRuntimeState.Loaded));
                Assert.That(runtime.DetailRoot, Is.SameAs(firstDetail));
                Assert.That(firstDetail.transform.parent, Is.SameAs(detailMount.transform));
                Assert.That(shell, Is.Not.Null, "设备细节加载不能替换或销毁厂区壳体。");

                BusinessSceneCommandResult duplicateResult = default;
                Run(runtime.LoadAsync(entry, loader, detailMount.transform, result => duplicateResult = result));
                Assert.That(duplicateResult.Success, Is.True);
                Assert.That(loader.CallCount, Is.EqualTo(1), "重复点击已加载细节时不得再次启动加载器。");

                Assert.That(runtime.ReleaseDetails().Success, Is.True);
                Assert.That(firstDetail == null, Is.True);
                Assert.That(firstLease.DisposeCount, Is.EqualTo(1));
                Assert.That(shell, Is.Not.Null, "返回厂房只释放设备细节，壳体必须继续常驻。");
                Assert.That(runtime.ReleaseDetails().Success, Is.True, "重复返回必须幂等。");
                Assert.That(firstLease.DisposeCount, Is.EqualTo(1));

                loader.Enqueue(() => BusinessSceneDetailLoadResult.Completed(
                    new BusinessSceneDetailLoadHandle(
                        secondDetail = new GameObject("CoalEquipmentDetailSecond"),
                        secondLease)));
                BusinessSceneCommandResult secondResult = default;
                Run(runtime.LoadAsync(entry, loader, detailMount.transform, result => secondResult = result));
                Assert.That(secondResult.Success, Is.True, secondResult.Message);
                Assert.That(loader.CallCount, Is.EqualTo(2));

                runtime.Dispose();
                Assert.That(runtime.State, Is.EqualTo(BusinessSceneDetailRuntimeState.Released));
                Assert.That(secondDetail == null, Is.True);
                Assert.That(secondLease.DisposeCount, Is.EqualTo(1));
                Assert.That(shell, Is.Not.Null, "业务细节运行时完整释放也不拥有厂区壳体。");
            }
            finally
            {
                runtime.Dispose();
                UnityEngine.Object.DestroyImmediate(detailMount);
                UnityEngine.Object.DestroyImmediate(shell);
            }
        }

        [Test]
        public void 加载失败和释放竞态均保留壳体并清理迟到句柄()
        {
            GameObject shell = new GameObject("PersistentFactoryShell");
            GameObject detailMount = new GameObject("DetailMount");
            BusinessSceneDetailRuntime runtime = new BusinessSceneDetailRuntime("coal-power");
            QueuedDetailLoader loader = new QueuedDetailLoader();
            TrackingLease lateLease = new TrackingLease();
            GameObject lateDetail = null;
            try
            {
                BusinessSceneDetailCatalogEntry entry = CreateCoalDetailEntry();
                loader.Enqueue(() => BusinessSceneDetailLoadResult.Failed(
                    "detail-bundle-missing",
                    "测试资源包不存在。"));
                BusinessSceneCommandResult failedResult = default;
                Run(runtime.LoadAsync(entry, loader, detailMount.transform, result => failedResult = result));

                Assert.That(failedResult.Success, Is.False);
                Assert.That(failedResult.ErrorCode, Is.EqualTo("detail-bundle-missing"));
                Assert.That(runtime.State, Is.EqualTo(BusinessSceneDetailRuntimeState.Failed));
                Assert.That(shell, Is.Not.Null, "设备资源加载失败不能影响厂区壳体。");

                Assert.That(runtime.ReleaseDetails().Success, Is.True);
                loader.Enqueue(() => BusinessSceneDetailLoadResult.Completed(
                    new BusinessSceneDetailLoadHandle(
                        lateDetail = new GameObject("LateCoalEquipmentDetail"),
                        lateLease)));
                BusinessSceneCommandResult lateResult = default;
                IEnumerator loading = runtime.LoadAsync(entry, loader, detailMount.transform, result => lateResult = result);
                Assert.That(loading.MoveNext(), Is.True, "加载器应先跨过一个异步等待点。");

                Assert.That(runtime.ReleaseDetails().Success, Is.True);
                while (loading.MoveNext())
                {
                }

                Assert.That(lateResult.Success, Is.False);
                Assert.That(lateResult.ErrorCode, Is.EqualTo("scene-detail-load-superseded"));
                Assert.That(lateDetail == null, Is.True, "释放后到达的细节实例必须立即销毁。");
                Assert.That(lateLease.DisposeCount, Is.EqualTo(1), "迟到资源包租约必须立即释放。");
                Assert.That(runtime.State, Is.EqualTo(BusinessSceneDetailRuntimeState.Idle));
                Assert.That(shell, Is.Not.Null);
            }
            finally
            {
                runtime.Dispose();
                UnityEngine.Object.DestroyImmediate(detailMount);
                UnityEngine.Object.DestroyImmediate(shell);
            }
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
