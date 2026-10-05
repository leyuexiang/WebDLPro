using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// 为广告牌维护一条指向目标物体的世界空间指示线。
/// 线的两端每帧以世界坐标写入 LineRenderer，广告牌朝向相机旋转时线保持原位，
/// 不会像普通子物体那样随牌面一起摆动。广告牌侧起点落在牌面底边中点而非正中心，
/// 目标侧终点落在目标模型的世界包围盒中心而非模型枢轴。
/// </summary>
[ExecuteAlways]
[DisallowMultipleComponent]
[AddComponentMenu("Visualization/Billboard Target Leader Line")]
public sealed class BillboardTargetLeaderLine : MonoBehaviour
{
    [Header("对象引用")]
    [Tooltip("指示线渲染组件。留空时会在初始化时从自身及子物体查找。")]
    [SerializeField] private LineRenderer _lineRenderer;

    [Tooltip("指示线指向的目标物体。未指定时指示线自动隐藏。")]
    [SerializeField] private Transform _target;

    [Tooltip("用于计算牌面底边世界高度的牌面网格渲染器。起点会落在牌面底边；留空时回退到广告牌根位置。")]
    [SerializeField] private MeshRenderer _boardRenderer;

    [Header("端点偏移")]
    [Tooltip("以世界坐标叠加到牌面底边起点的偏移；偏移量固定于世界空间，不随牌面旋转。")]
    [SerializeField] private Vector3 _startWorldOffset = Vector3.zero;

    [Tooltip("以世界坐标叠加到目标模型包围盒中心的终点偏移。")]
    [SerializeField] private Vector3 _endWorldOffset = Vector3.zero;

    // 缓存自身 Transform，避免逐帧通过组件属性访问场景对象。
    private Transform _selfTransform;

    // 目标模型渲染器缓存：模型多为静态，仅在指派目标时收集一次，逐帧只读取包围盒。
    private Renderer[] _targetRenderers;

    /// <summary>
    /// 缓存自身 Transform 并解析指示线引用。解析后强制世界坐标模式并立即同步一次端点，
    /// 使编辑状态下指派目标即可直接看到指向效果。
    /// </summary>
    private void OnEnable()
    {
        _selfTransform = transform;
        ResolveLineRenderer();
        ResolveTargetRenderers();
        RefreshLine();
    }

    /// <summary>
    /// 在相机与广告牌朝向逻辑更新后再刷新端点，保证同一帧内位置数据一致。
    /// 端点按世界坐标写入，因此广告牌旋转只改变牌面自身朝向，不会带动指示线。
    /// </summary>
    private void LateUpdate()
    {
        RefreshLine();
    }

    /// <summary>
    /// 检视器中指派目标或调整偏移时立即同步，保证编辑状态下也能看到最终端点。
    /// </summary>
    private void OnValidate()
    {
        _selfTransform = transform;
        ResolveLineRenderer();
        ResolveTargetRenderers();
        RefreshLine();
    }

    /// <summary>
    /// 供运行时生成广告牌或切换指向目标的业务逻辑调用。
    /// </summary>
    /// <param name="target">指示线指向的目标；传入空值会隐藏指示线。</param>
    public void SetTarget(Transform target)
    {
        _target = target;
        ResolveTargetRenderers();
        RefreshLine();
    }

    /// <summary>
    /// 未显式指定渲染组件时，从自身及子物体中解析一次指示线引用。
    /// </summary>
    private void ResolveLineRenderer()
    {
        if (_lineRenderer == null)
        {
            _lineRenderer = GetComponentInChildren<LineRenderer>(true);
        }

        if (_lineRenderer != null)
        {
            // 端点写入依赖世界坐标模式；一旦被误改为本地坐标，线会随牌面旋转。
            _lineRenderer.useWorldSpace = true;
            if (_lineRenderer.positionCount != 2)
            {
                _lineRenderer.positionCount = 2;
            }
        }
    }

    /// <summary>
    /// 按目标是否有效控制指示线显隐，并以世界坐标重写两端端点。
    /// </summary>
    private void RefreshLine()
    {
        if (_lineRenderer == null)
        {
            return;
        }

        bool hasTarget = _target != null;
        if (_lineRenderer.enabled != hasTarget)
        {
            _lineRenderer.enabled = hasTarget;
        }

        if (!hasTarget)
        {
            return;
        }

        _lineRenderer.SetPosition(0, ResolveStartPosition() + _startWorldOffset);
        _lineRenderer.SetPosition(1, ResolveEndPosition() + _endWorldOffset);
    }

    /// <summary>
    /// 收集用于计算模型中心的渲染器。广告牌作为标签常挂在设备模型子树下，
    /// 牌面、文字和指示线本身不属于模型本体，必须排除，否则包围中心会被悬空的牌面拉偏。
    /// </summary>
    private void ResolveTargetRenderers()
    {
        if (_target == null)
        {
            _targetRenderers = null;
            return;
        }

        Renderer[] renderers = _target.GetComponentsInChildren<Renderer>(true);
        List<Renderer> modelRenderers = new List<Renderer>(renderers.Length);
        for (int i = 0; i < renderers.Length; i++)
        {
            if (renderers[i] != null && renderers[i].GetComponentInParent<HorizontalCameraBillboard>() == null)
            {
                modelRenderers.Add(renderers[i]);
            }
        }

        _targetRenderers = modelRenderers.ToArray();
    }

    /// <summary>
    /// 计算目标侧终点：落在目标模型全部渲染器世界包围盒的中心，而不是模型枢轴
    /// （模型枢轴常位于底座或边缘）。目标没有渲染器时回退到枢轴位置。
    /// 包围盒每帧从缓存渲染器重新读取，模型动画导致的中心移动仍能跟随。
    /// </summary>
    private Vector3 ResolveEndPosition()
    {
        bool hasBounds = false;
        Bounds modelBounds = new Bounds();
        if (_targetRenderers != null)
        {
            for (int i = 0; i < _targetRenderers.Length; i++)
            {
                Renderer renderer = _targetRenderers[i];
                if (renderer == null)
                {
                    continue;
                }

                if (!hasBounds)
                {
                    modelBounds = renderer.bounds;
                    hasBounds = true;
                }
                else
                {
                    modelBounds.Encapsulate(renderer.bounds);
                }
            }
        }

        return hasBounds ? modelBounds.center : _target.position;
    }

    /// <summary>
    /// 计算广告牌侧起点：默认落在牌面底边中点，而不是牌面正中心。
    /// 牌面竖直中线经过根节点，因此 XZ 取根节点位置；Y 取牌面网格世界包围盒最低点，
    /// 这样牌面绕竖直轴朝向相机旋转时底边中点保持不动，线也不会随牌面摆动。
    /// </summary>
    private Vector3 ResolveStartPosition()
    {
        Vector3 start = _selfTransform.position;
        if (_boardRenderer != null)
        {
            start.y = _boardRenderer.bounds.min.y;
        }

        return start;
    }
}
