using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>齿轮箱独立轻量线框：60 度特征边、短边过滤、长度预算。保留原网格和已有线框资产。</summary>
public static class GearboxWireframeOptimizer
{
    private struct Edge
    {
        public int a, b, order;
        public float lengthSquared;
    }

    public static Mesh Build(Mesh source, int maxEdges, float minLength = .003f)
    {
        Mesh candidate = WireframeOverlayBaker.BuildWireframeMesh(source, 60f);
        if (candidate == null) throw new InvalidOperationException("无法生成线框: " + source.name);
        try
        {
            Vector3[] positions = candidate.vertices;
            int[] indices = candidate.GetIndices(0);
            var edges = new List<Edge>(indices.Length / 2);
            for (int i = 0; i < indices.Length; i += 2)
            {
                float length = (positions[indices[i]] - positions[indices[i + 1]]).sqrMagnitude;
                if (length >= minLength * minLength)
                    edges.Add(new Edge { a = indices[i], b = indices[i + 1], order = i, lengthSquared = length });
            }
            if (edges.Count > maxEdges)
            {
                // 长结构边优先保留；相同长度使用原序号保证重烘焙稳定。
                edges.Sort((a, b) => { int length = b.lengthSquared.CompareTo(a.lengthSquared); return length != 0 ? length : a.order.CompareTo(b.order); });
                edges.RemoveRange(maxEdges, edges.Count - maxEdges);
            }
            var remap = new Dictionary<int, int>();
            var vertices = new List<Vector3>();
            var output = new List<int>(edges.Count * 2);
            foreach (Edge edge in edges)
            {
                if (!remap.TryGetValue(edge.a, out int a)) { a = vertices.Count; remap.Add(edge.a, a); vertices.Add(positions[edge.a]); }
                if (!remap.TryGetValue(edge.b, out int b)) { b = vertices.Count; remap.Add(edge.b, b); vertices.Add(positions[edge.b]); }
                output.Add(a); output.Add(b);
            }
            var mesh = new Mesh { name = source.name + " WebGL Wire", indexFormat = vertices.Count > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(vertices);
            mesh.SetIndices(output, MeshTopology.Lines, 0, false);
            mesh.bounds = source.bounds;
            return mesh;
        }
        finally { UnityEngine.Object.DestroyImmediate(candidate); }
    }
}
