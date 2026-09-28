using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// 为设备显示运行时屏幕标识牌。标识牌仅在播放时创建，始终朝向屏幕，
/// 不改动目标模型的材质、层级、变换或动画。
/// </summary>
[DisallowMultipleComponent]
public sealed class EquipmentNameplateOverlay : MonoBehaviour
{
    [Serializable]
    public sealed class Entry
    {
        [Tooltip("标识牌显示的名称。")]
        public string label;
        [Tooltip("标识牌所跟随的设备对象。")]
        public Transform target;
        [Tooltip("相对设备屏幕位置的像素偏移。")]
        public Vector2 screenOffset = new Vector2(42f, 36f);
    }

    [SerializeField] private Entry[] _entries = Array.Empty<Entry>();
    [SerializeField] private Camera _targetCamera;
    [SerializeField] private TMP_FontAsset _font;
    [SerializeField] private Color _panelColor = new Color(0.015f, 0.12f, 0.28f, 0.82f);
    [SerializeField] private Color _textColor = new Color(0.55f, 0.9f, 1f, 1f);

    private Canvas _canvas;
    private RectTransform[] _panels = Array.Empty<RectTransform>();

    private void Start()
    {
        _targetCamera ??= Camera.main;
        CreateOverlay();
    }

    private void LateUpdate()
    {
        if (_canvas == null)
        {
            return;
        }

        _targetCamera ??= Camera.main;
        if (_targetCamera == null)
        {
            return;
        }

        for (int index = 0; index < _entries.Length; index++)
        {
            Entry entry = _entries[index];
            RectTransform panel = _panels[index];
            if (entry == null || entry.target == null || panel == null)
            {
                continue;
            }

            Vector3 point = GetAnchorPoint(entry.target);
            Vector3 screenPoint = _targetCamera.WorldToScreenPoint(point);
            bool visible = screenPoint.z > 0f && screenPoint.x >= -80f && screenPoint.x <= Screen.width + 80f &&
                           screenPoint.y >= -50f && screenPoint.y <= Screen.height + 50f;
            panel.gameObject.SetActive(visible);
            if (visible)
            {
                panel.position = screenPoint + (Vector3)entry.screenOffset;
            }
        }
    }

    private void CreateOverlay()
    {
        GameObject root = new GameObject("__EquipmentNameplates", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        root.transform.SetParent(transform, false);
        _canvas = root.GetComponent<Canvas>();
        _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        _canvas.sortingOrder = 50;
        root.GetComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        root.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1920f, 1080f);
        root.GetComponent<GraphicRaycaster>().enabled = false;

        _panels = new RectTransform[_entries.Length];
        for (int index = 0; index < _entries.Length; index++)
        {
            Entry entry = _entries[index];
            if (entry == null)
            {
                continue;
            }

            GameObject panelObject = new GameObject($"Plate_{entry.label}", typeof(RectTransform), typeof(Image));
            panelObject.transform.SetParent(root.transform, false);
            RectTransform panel = panelObject.GetComponent<RectTransform>();
            panel.anchorMin = new Vector2(0.5f, 0.5f);
            panel.anchorMax = new Vector2(0.5f, 0.5f);
            panel.pivot = new Vector2(0f, 0.5f);
            panel.sizeDelta = new Vector2(150f, 34f);
            Image background = panelObject.GetComponent<Image>();
            background.color = _panelColor;

            Outline outline = panelObject.AddComponent<Outline>();
            outline.effectColor = new Color(_textColor.r, _textColor.g, _textColor.b, 0.9f);
            outline.effectDistance = new Vector2(1f, -1f);

            GameObject textObject = new GameObject("Text", typeof(RectTransform), typeof(TextMeshProUGUI));
            textObject.transform.SetParent(panelObject.transform, false);
            RectTransform textRect = textObject.GetComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = new Vector2(10f, 0f);
            textRect.offsetMax = new Vector2(-6f, 0f);

            TextMeshProUGUI text = textObject.GetComponent<TextMeshProUGUI>();
            text.font = _font != null ? _font : TMP_Settings.defaultFontAsset;
            text.text = entry.label;
            text.color = _textColor;
            text.fontSize = 19f;
            text.alignment = TextAlignmentOptions.MidlineLeft;
            text.raycastTarget = false;
            _panels[index] = panel;
        }
    }

    private static Vector3 GetAnchorPoint(Transform target)
    {
        Renderer renderer = target.GetComponentInChildren<Renderer>();
        return renderer == null ? target.position : renderer.bounds.center + Vector3.up * renderer.bounds.extents.y;
    }
}
