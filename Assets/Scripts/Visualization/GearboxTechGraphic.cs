using UnityEngine;
using UnityEngine.UI;

/// <summary>无贴图的切角仪表面板与分段锁定环，仅在 UI 几何变化时生成网格。</summary>
[AddComponentMenu("")]
[RequireComponent(typeof(CanvasRenderer))]
public sealed class GearboxTechGraphic : MaskableGraphic
{
    public bool reticle;
    public Color accent = new Color(0.1f, 0.8f, 1f, 1f);

    protected override void OnPopulateMesh(VertexHelper vh)
    {
        vh.Clear();
        Rect r = rectTransform.rect;
        if (reticle)
        {
            float radius = Mathf.Min(r.width, r.height) * 0.44f;
            for (int quadrant = 0; quadrant < 4; quadrant++)
                for (int j = 0; j < 10; j++)
                {
                    float a = (quadrant * 90f + j * 6f) * Mathf.Deg2Rad;
                    float b = (quadrant * 90f + (j + 1) * 6f) * Mathf.Deg2Rad;
                    Segment(vh, r.center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * radius,
                        r.center + new Vector2(Mathf.Cos(b), Mathf.Sin(b)) * radius, 1.3f, accent);
                }
            return;
        }
        float cut = Mathf.Min(12f, r.height * .22f);
        Vector2[] points = {
            new Vector2(r.xMin + cut, r.yMin), new Vector2(r.xMax, r.yMin),
            new Vector2(r.xMax, r.yMax - cut), new Vector2(r.xMax - cut, r.yMax),
            new Vector2(r.xMin, r.yMax), new Vector2(r.xMin, r.yMin + cut)
        };
        vh.AddVert(r.center, color, Vector2.zero);
        for (int i = 0; i < points.Length; i++) vh.AddVert(points[i], color, Vector2.zero);
        for (int i = 0; i < points.Length; i++) vh.AddTriangle(0, i + 1, (i + 1) % points.Length + 1);
        for (int i = 0; i < points.Length; i++)
        {
            Color glow = accent; glow.a *= .12f;
            Segment(vh, points[i], points[(i + 1) % points.Length], 5f, glow);
            Color edge = accent; edge.a *= .55f;
            Segment(vh, points[i], points[(i + 1) % points.Length], 1f, edge);
        }
        Segment(vh, new Vector2(r.xMin + 12, r.yMax), new Vector2(r.xMin + 55, r.yMax), 2.5f, accent);
        Segment(vh, new Vector2(r.xMax - 50, r.yMin), new Vector2(r.xMax - 12, r.yMin), 2.5f, accent);
        for (int i = 0; i < 4; i++)
        {
            Vector2 a = new Vector2(r.xMax - 14 - i * 7, r.yMin + 5);
            Color tick = accent; tick.a *= .35f;
            Segment(vh, a, a + new Vector2(4, 5), 1.5f, tick);
        }
    }

    private static void Segment(VertexHelper vh, Vector2 a, Vector2 b, float width, Color tint)
    {
        Vector2 d = (b - a).normalized;
        Vector2 n = new Vector2(-d.y, d.x) * width * .5f;
        int start = vh.currentVertCount;
        vh.AddVert(a - n, tint, Vector2.zero);
        vh.AddVert(a + n, tint, Vector2.zero);
        vh.AddVert(b + n, tint, Vector2.zero);
        vh.AddVert(b - n, tint, Vector2.zero);
        vh.AddTriangle(start, start + 1, start + 2);
        vh.AddTriangle(start, start + 2, start + 3);
    }
}
