using TMPro;
using UnityEngine;

/// <summary>
/// 根据三维文字的实际单行排版宽度，自动调整广告牌网格的横向缩放。
/// 文字本身保持原字号，只有牌面网格横向扩展，避免长名称换行或超出边框。
/// </summary>
[ExecuteAlways]
[DisallowMultipleComponent]
[AddComponentMenu("Visualization/Adaptive Billboard Width")]
public sealed class AdaptiveBillboardWidth : MonoBehaviour
{
    private const float MinimumValidWidth = 0.0001f;

    [Header("对象引用")]
    [Tooltip("仅进行横向缩放的广告牌网格节点。该节点必须与文字分离，避免缩放文字。")]
    [SerializeField] private Transform _meshTransform;

    [Tooltip("用于计算实际单行排版宽度的三维文字组件。")]
    [SerializeField] private TextMeshPro _text;

    [Header("三字基准")]
    [Tooltip("三字广告牌在网格缩放为 1 时的实际宽度。")]
    [SerializeField, Min(MinimumValidWidth)] private float _baseMeshWidth = 4f;

    [Tooltip("三字基准下文字左右两侧各自保留的边距。当前字体格式测得为 0.495。")]
    [SerializeField, Min(0f)] private float _horizontalMargin = 0.495f;

    // 防止修改文字矩形尺寸时再次触发文字变化事件，造成递归刷新。
    private bool _isRefreshing;

    /// <summary>
    /// 订阅文字变化事件，并在场景加载或组件启用时立即同步一次宽度。
    /// 事件驱动方式不需要 Update 轮询，适合 WebGL 中存在多个广告牌的场景。
    /// </summary>
    private void OnEnable()
    {
        TMPro_EventManager.TEXT_CHANGED_EVENT.Add(HandleTextChanged);
        RefreshWidth();
    }

    /// <summary>
    /// 组件停用或销毁时解除静态事件订阅，避免残留引用。
    /// </summary>
    private void OnDisable()
    {
        TMPro_EventManager.TEXT_CHANGED_EVENT.Remove(HandleTextChanged);
    }

    /// <summary>
    /// 检视器参数变化时同步结果，保证编辑状态下也能直接看到最终牌面宽度。
    /// </summary>
    private void OnValidate()
    {
        RefreshWidth();
    }

    /// <summary>
    /// 按当前字体、字号、字间距和富文本格式测量单行文字宽度，更新网格横向缩放。
    /// 目标宽度不会小于三字基准宽度，因此两字名称仍使用默认牌面，不会变窄。
    /// </summary>
    public void RefreshWidth()
    {
        if (_isRefreshing || _meshTransform == null || _text == null || _baseMeshWidth < MinimumValidWidth)
        {
            return;
        }

        _isRefreshing = true;

        try
        {
            // 广告牌名称必须保持单行；使用无限测量宽度取得不受当前文本框限制的真实排版长度。
            _text.enableWordWrapping = false;
            Vector2 preferredSize = _text.GetPreferredValues(
                _text.text,
                float.PositiveInfinity,
                float.PositiveInfinity);

            float textScaleX = Mathf.Abs(_text.rectTransform.localScale.x);
            if (textScaleX < MinimumValidWidth)
            {
                return;
            }

            float preferredTextWidth = preferredSize.x * textScaleX;
            float targetMeshWidth = Mathf.Max(
                _baseMeshWidth,
                preferredTextWidth + _horizontalMargin * 2f);
            float widthScale = targetMeshWidth / _baseMeshWidth;

            // 只修改网格节点 X 轴，保留牌面厚度、高度以及根节点的场景缩放。
            Vector3 meshScale = _meshTransform.localScale;
            if (!Mathf.Approximately(meshScale.x, widthScale))
            {
                meshScale.x = widthScale;
                _meshTransform.localScale = meshScale;
            }

            // 同步文字矩形宽度，使居中、对齐和后续排版测量都以实际牌面宽度为准。
            float targetTextRectWidth = targetMeshWidth / textScaleX;
            if (!Mathf.Approximately(_text.rectTransform.rect.width, targetTextRectWidth))
            {
                _text.rectTransform.SetSizeWithCurrentAnchors(RectTransform.Axis.Horizontal, targetTextRectWidth);
            }
        }
        finally
        {
            _isRefreshing = false;
        }
    }

    /// <summary>
    /// 仅响应当前广告牌自身的文字变化，其他广告牌更新不会触发重复计算。
    /// </summary>
    /// <param name="changedObject">文字系统报告发生变化的对象。</param>
    private void HandleTextChanged(Object changedObject)
    {
        if (changedObject == _text)
        {
            RefreshWidth();
        }
    }
}
