using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 一个由场景属性面板显式登记的三维节点渲染器命中目标。
    /// 节点标识和根对象都来自业务场景配置；运行时不读取模型名称、层级路径或二维节点进行推断。
    /// </summary>
    public readonly struct SceneNodeRendererPickTarget
    {
        public string SceneNodeId { get; }
        public GameObject RootObject { get; }
        public Renderer Renderer { get; }

        public SceneNodeRendererPickTarget(string sceneNodeId, GameObject rootObject, Renderer renderer)
        {
            SceneNodeId = sceneNodeId;
            RootObject = rootObject;
            Renderer = renderer;
        }
    }

    /// <summary>
    /// 为未配置碰撞体的已登记模型提供渲染器包围盒后备命中。
    /// 该工具无状态、无分配地扫描初始化阶段缓存的小集合；调用方仍应优先使用物理射线，
    /// 并把前方未映射碰撞体距离作为上限，避免选中被地面、建筑或其他模型遮挡的目标。
    /// </summary>
    public static class SceneNodeRendererPicker
    {
        /// <summary>
        /// 返回射线最先命中的可见配置目标。
        /// maximumDistance（最大距离）用于保留物理遮挡语义；等于或位于遮挡物之后的包围盒不会被接受。
        /// </summary>
        public static bool TryPick(
            Ray ray,
            IReadOnlyList<SceneNodeRendererPickTarget> targets,
            float maximumDistance,
            out string sceneNodeId,
            out GameObject rootObject,
            out float hitDistance)
        {
            sceneNodeId = null;
            rootObject = null;
            hitDistance = float.PositiveInfinity;
            if (targets == null || targets.Count == 0 || maximumDistance < 0f)
            {
                return false;
            }

            for (int targetIndex = 0; targetIndex < targets.Count; targetIndex++)
            {
                SceneNodeRendererPickTarget target = targets[targetIndex];
                Renderer renderer = target.Renderer;
                if (string.IsNullOrWhiteSpace(target.SceneNodeId) || target.RootObject == null || renderer == null ||
                    !target.RootObject.activeInHierarchy || !renderer.enabled || !renderer.gameObject.activeInHierarchy)
                {
                    continue;
                }

                if (!renderer.bounds.IntersectRay(ray, out float candidateDistance) ||
                    candidateDistance < 0f || candidateDistance >= maximumDistance || candidateDistance >= hitDistance)
                {
                    continue;
                }

                sceneNodeId = target.SceneNodeId;
                rootObject = target.RootObject;
                hitDistance = candidateDistance;
            }

            return rootObject != null;
        }
    }
}
