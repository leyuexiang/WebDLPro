using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using UnityEngine;
using UnityObject = UnityEngine.Object;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 场景资源作用域的一次释放结果。只记录有限计数，不保留资源对象、异常文本或无限历史，
    /// 因而可用于运行诊断而不会反向延长业务场景资源的生命周期。
    /// </summary>
    public readonly struct BusinessSceneResourceReleaseReport
    {
        public int RegisteredResourceCount { get; }
        public int ReleasedResourceCount { get; }
        public int FailureCount { get; }
        public bool AlreadyReleased { get; }

        public BusinessSceneResourceReleaseReport(
            int registeredResourceCount,
            int releasedResourceCount,
            int failureCount,
            bool alreadyReleased)
        {
            RegisteredResourceCount = registeredResourceCount;
            ReleasedResourceCount = releasedResourceCount;
            FailureCount = failureCount;
            AlreadyReleased = alreadyReleased;
        }
    }

    /// <summary>
    /// 统一管理单个业务场景明确拥有的事件回调、协程、动画、渲染纹理、资源句柄和运行时对象。
    /// 所有资源只在登记与场景释放时处理，没有 Update、层级扫描或全局资源回收，避免把高成本回收放进每帧路径。
    /// </summary>
    public sealed class BusinessSceneResourceScope : IDisposable
    {
        private enum ResourceKind
        {
            ReleaseAction,
            Coroutine,
            Animator,
            LegacyAnimation,
            OwnedRenderTexture,
            TemporaryRenderTexture,
            Disposable,
            OwnedObject
        }

        private readonly struct ResourceEntry
        {
            public ResourceKind Kind { get; }
            public object Resource { get; }
            public MonoBehaviour CoroutineOwner { get; }

            public ResourceEntry(ResourceKind kind, object resource, MonoBehaviour coroutineOwner = null)
            {
                Kind = kind;
                Resource = resource;
                CoroutineOwner = coroutineOwner;
            }
        }

        /// <summary>
        /// 资源去重必须比较对象身份。Unity 对象重载了相等运算，委托也可能按调用列表判等，
        /// 使用引用身份可避免两个不同资源被误判为同一项而漏掉释放。
        /// </summary>
        private sealed class ReferenceIdentityComparer : IEqualityComparer<object>
        {
            public static readonly ReferenceIdentityComparer Instance = new ReferenceIdentityComparer();

            public new bool Equals(object left, object right)
            {
                return ReferenceEquals(left, right);
            }

            public int GetHashCode(object value)
            {
                return RuntimeHelpers.GetHashCode(value);
            }
        }

        private readonly List<ResourceEntry> _entries = new List<ResourceEntry>();
        private readonly HashSet<object> _registeredResources = new HashSet<object>(ReferenceIdentityComparer.Instance);
        private bool _released;

        public bool IsReleased => _released;
        public int RegisteredResourceCount => _entries.Count;

        /// <summary>
        /// 登记事件退订或控制器自有资源清理动作。调用方应传入无参数、可重复安全调用的封口动作。
        /// </summary>
        public bool TrackReleaseAction(Action releaseAction)
        {
            return Register(new ResourceEntry(ResourceKind.ReleaseAction, releaseAction));
        }

        /// <summary>登记由场景启动的协程；释放时只停止精确协程，不停止宿主上的其他业务协程。</summary>
        public bool TrackCoroutine(MonoBehaviour owner, Coroutine coroutine)
        {
            if (owner == null || coroutine == null)
            {
                return false;
            }

            return Register(new ResourceEntry(ResourceKind.Coroutine, coroutine, owner));
        }

        /// <summary>登记场景控制的动画器；释放时停用动画器，防止场景卸载收尾阶段继续求值。</summary>
        public bool TrackAnimator(Animator animator)
        {
            return Register(new ResourceEntry(ResourceKind.Animator, animator));
        }

        /// <summary>登记旧版动画组件；释放时停止播放并停用组件。</summary>
        public bool TrackLegacyAnimation(Animation animation)
        {
            return Register(new ResourceEntry(ResourceKind.LegacyAnimation, animation));
        }

        /// <summary>登记由场景创建且独占的渲染纹理；释放底层缓冲后销毁对象。</summary>
        public bool TrackOwnedRenderTexture(RenderTexture renderTexture)
        {
            return Register(new ResourceEntry(ResourceKind.OwnedRenderTexture, renderTexture));
        }

        /// <summary>登记通过 RenderTexture.GetTemporary 获取的临时纹理；只归还临时池，禁止再次销毁。</summary>
        public bool TrackTemporaryRenderTexture(RenderTexture renderTexture)
        {
            return Register(new ResourceEntry(ResourceKind.TemporaryRenderTexture, renderTexture));
        }

        /// <summary>登记资产包租约、流或其他实现 IDisposable 的场景级资源句柄。</summary>
        public bool TrackDisposable(IDisposable disposable)
        {
            return Register(new ResourceEntry(ResourceKind.Disposable, disposable));
        }

        /// <summary>
        /// 登记运行时创建且由场景独占的材质、网格或纹理等 Unity 对象。
        /// GameObject、Component 和 RenderTexture 必须走各自生命周期入口，避免误销毁场景层级或重复释放显存。
        /// </summary>
        public bool TrackOwnedObject(UnityObject ownedObject)
        {
            if (ownedObject is GameObject || ownedObject is Component || ownedObject is RenderTexture)
            {
                return false;
            }

            return Register(new ResourceEntry(ResourceKind.OwnedObject, ownedObject));
        }

        /// <summary>
        /// 逆序释放全部资源，使后登记的依赖先于其宿主释放。单项失败不会阻断后续清理；
        /// 释放完成后立即清空所有强引用，重复调用只返回幂等结果。
        /// </summary>
        public BusinessSceneResourceReleaseReport ReleaseAll()
        {
            if (_released)
            {
                return new BusinessSceneResourceReleaseReport(0, 0, 0, true);
            }

            _released = true;
            int registeredCount = _entries.Count;
            int releasedCount = 0;
            int failureCount = 0;
            for (int entryIndex = _entries.Count - 1; entryIndex >= 0; entryIndex--)
            {
                if (TryRelease(_entries[entryIndex]))
                {
                    releasedCount++;
                }
                else
                {
                    failureCount++;
                }
            }

            _entries.Clear();
            _registeredResources.Clear();
            return new BusinessSceneResourceReleaseReport(registeredCount, releasedCount, failureCount, false);
        }

        public void Dispose()
        {
            ReleaseAll();
        }

        private bool Register(ResourceEntry entry)
        {
            if (IsMissing(entry.Resource))
            {
                return false;
            }

            // 释放后迟到的资源不能重新打开作用域；立即尝试清理，避免异步回调在场景卸载后形成孤儿资源。
            if (_released)
            {
                TryRelease(entry);
                return false;
            }

            if (!_registeredResources.Add(entry.Resource))
            {
                return false;
            }

            _entries.Add(entry);
            return true;
        }

        private static bool IsMissing(object resource)
        {
            if (resource == null)
            {
                return true;
            }

            return resource is UnityObject unityObject && unityObject == null;
        }

        private static bool TryRelease(ResourceEntry entry)
        {
            try
            {
                switch (entry.Kind)
                {
                    case ResourceKind.ReleaseAction:
                        ((Action)entry.Resource).Invoke();
                        break;
                    case ResourceKind.Coroutine:
                        if (entry.CoroutineOwner != null)
                        {
                            entry.CoroutineOwner.StopCoroutine((Coroutine)entry.Resource);
                        }
                        break;
                    case ResourceKind.Animator:
                        Animator animator = (Animator)entry.Resource;
                        if (animator != null)
                        {
                            animator.enabled = false;
                        }
                        break;
                    case ResourceKind.LegacyAnimation:
                        Animation animation = (Animation)entry.Resource;
                        if (animation != null)
                        {
                            animation.Stop();
                            animation.enabled = false;
                        }
                        break;
                    case ResourceKind.OwnedRenderTexture:
                        ReleaseOwnedRenderTexture((RenderTexture)entry.Resource);
                        break;
                    case ResourceKind.TemporaryRenderTexture:
                        RenderTexture temporaryRenderTexture = (RenderTexture)entry.Resource;
                        if (temporaryRenderTexture != null)
                        {
                            RenderTexture.ReleaseTemporary(temporaryRenderTexture);
                        }
                        break;
                    case ResourceKind.Disposable:
                        ((IDisposable)entry.Resource).Dispose();
                        break;
                    case ResourceKind.OwnedObject:
                        DestroyOwnedObject((UnityObject)entry.Resource);
                        break;
                }

                return true;
            }
            catch (Exception)
            {
                // 资源释放必须尽力完成全部条目；异常细节不长期缓存，调用方通过有限失败计数决定是否上报。
                return false;
            }
        }

        private static void ReleaseOwnedRenderTexture(RenderTexture renderTexture)
        {
            if (renderTexture == null)
            {
                return;
            }

            if (renderTexture.IsCreated())
            {
                renderTexture.Release();
            }
            DestroyOwnedObject(renderTexture);
        }

        private static void DestroyOwnedObject(UnityObject ownedObject)
        {
            if (ownedObject == null)
            {
                return;
            }

            if (Application.isPlaying)
            {
                UnityObject.Destroy(ownedObject);
            }
            else
            {
                UnityObject.DestroyImmediate(ownedObject);
            }
        }
    }
}
