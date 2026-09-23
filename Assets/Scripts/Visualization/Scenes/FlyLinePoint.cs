using UnityEngine;

/// <summary>
/// 可选的飞线点锚点组件。
/// 正式场景把点预制体替换为设备模型后，如果模型的连接位置不是根节点，
/// 可在模型任意子物体上放置该组件并指定 ConnectionAnchor（连接锚点）。
/// 未指定时直接使用组件所在物体的 Transform（变换）。
/// </summary>
[DisallowMultipleComponent]
public sealed class FlyLinePoint : MonoBehaviour
{
    [Tooltip("飞线实际连接的 Transform（变换）。留空时使用当前物体的 Transform。")]
    [SerializeField] private Transform _connectionAnchor;

    /// <summary>返回飞线应连接到的世界坐标锚点。</summary>
    public Transform ConnectionAnchor => _connectionAnchor != null ? _connectionAnchor : transform;

#if UNITY_EDITOR
    private void OnValidate()
    {
        // 空锚点表示使用当前物体根节点，避免替换为普通模型预制体后无法连线。
        if (_connectionAnchor == null)
        {
            _connectionAnchor = transform;
        }
    }
#endif
}
