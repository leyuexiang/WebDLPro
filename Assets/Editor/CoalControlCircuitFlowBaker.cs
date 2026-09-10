using System;
using System.Collections.Generic;
using System.Linq;
using Unity.Collections;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Bakes route distance into UV1 of an overlay copy of the coal control wires.
/// The imported mesh has six disjoint cables, each with constant-U cross sections.
/// No importer Read/Write flag, original mesh, UV0 or material is modified.
/// </summary>
public static class CoalControlCircuitFlowBaker
{
    public const string OutputPath = "Assets/Art/Generated/ControlCircuit/ControlCircuitFlowMesh.asset";

    public static Mesh Bake(Mesh source, Vector3 cabinetPositionOS)
    {
        if (source == null || source.subMeshCount != 1 || !source.HasVertexAttribute(UnityEngine.Rendering.VertexAttribute.TexCoord0))
            throw new ArgumentException("Expected the inspected control-wire mesh with one submesh and UV0.");

        Vector3[] vertices;
        Vector3[] normals;
        Vector2[] uv;
        int[] indices;
        using (var data = Mesh.AcquireReadOnlyMeshData(source))
        {
            var meshData = data[0];
            using (var positions = new NativeArray<Vector3>(meshData.vertexCount, Allocator.Temp))
            using (var normalData = new NativeArray<Vector3>(meshData.vertexCount, Allocator.Temp))
            using (var uvData = new NativeArray<Vector2>(meshData.vertexCount, Allocator.Temp))
            using (var indexData = new NativeArray<int>(meshData.GetSubMesh(0).indexCount, Allocator.Temp))
            {
                meshData.GetVertices(positions);
                meshData.GetNormals(normalData);
                meshData.GetUVs(0, uvData);
                meshData.GetIndices(indexData, 0);
                vertices = positions.ToArray();
                normals = normalData.ToArray();
                uv = uvData.ToArray();
                indices = indexData.ToArray();
            }
        }

        int[] parent = Enumerable.Range(0, vertices.Length).ToArray();
        for (int i = 0; i < indices.Length; i += 3)
        {
            Join(parent, indices[i], indices[i + 1]);
            Join(parent, indices[i], indices[i + 2]);
        }
        // Weld only coincident seam vertices; neighbouring cables must stay independent.
        var coincident = new Dictionary<Vector3Int, int>();
        for (int i = 0; i < vertices.Length; i++)
        {
            var key = Vector3Int.RoundToInt(vertices[i] * 10000f);
            if (coincident.TryGetValue(key, out int existing)) Join(parent, i, existing);
            else coincident.Add(key, i);
        }

        var circuits = Enumerable.Range(0, vertices.Length).GroupBy(i => Find(parent, i)).ToArray();
        if (circuits.Length != 6) throw new InvalidOperationException("Control wire topology changed; expected six independent routes.");
        var routes = new Vector2[vertices.Length];
        for (int circuit = 0; circuit < circuits.Length; circuit++)
        {
            var sections = circuits[circuit].GroupBy(i => Mathf.RoundToInt(uv[i].x * 1000f))
                .OrderBy(group => group.Key).Select(group => group.ToArray()).ToArray();
            if (sections.Length < 4 || sections.Length > 5)
                throw new InvalidOperationException("Control wire cross sections changed; inspect UV0 before rebaking.");
            var centres = new Vector3[sections.Length];
            for (int section = 0; section < sections.Length; section++)
            {
                var bounds = new Bounds(vertices[sections[section][0]], Vector3.zero);
                foreach (int vertex in sections[section]) bounds.Encapsulate(vertices[vertex]);
                centres[section] = bounds.center;
            }
            if ((centres[0] - cabinetPositionOS).sqrMagnitude > (centres[centres.Length - 1] - cabinetPositionOS).sqrMagnitude)
            {
                Array.Reverse(centres);
                Array.Reverse(sections);
            }
            float distance = 0f;
            for (int section = 0; section < sections.Length; section++)
            {
                if (section > 0) distance += Vector3.Distance(centres[section], centres[section - 1]);
                foreach (int vertex in sections[section]) routes[vertex] = new Vector2(distance, circuit / (float)circuits.Length);
            }
            Debug.Log($"Control circuit {circuit + 1}: {distance:F2} units, {sections.Length - 1} segments, cabinet start={centres[0]}");
        }

        var baked = new Mesh { name = "Control Circuit Route Distance", indexFormat = source.indexFormat };
        baked.vertices = vertices;
        baked.normals = normals;
        baked.uv = uv;
        baked.uv2 = routes;
        baked.triangles = indices;
        baked.bounds = source.bounds;
        if (!AssetDatabase.IsValidFolder("Assets/Art/Generated/ControlCircuit"))
            AssetDatabase.CreateFolder("Assets/Art/Generated", "ControlCircuit");
        Mesh saved = AssetDatabase.LoadAssetAtPath<Mesh>(OutputPath);
        if (saved != null)
        {
            EditorUtility.CopySerialized(baked, saved);
            UnityEngine.Object.DestroyImmediate(baked);
            EditorUtility.SetDirty(saved);
        }
        else
        {
            AssetDatabase.CreateAsset(baked, OutputPath);
            saved = baked;
        }
        return saved;
    }

    private static int Find(int[] parent, int vertex)
    {
        while (parent[vertex] != vertex)
        {
            parent[vertex] = parent[parent[vertex]];
            vertex = parent[vertex];
        }
        return vertex;
    }

    private static void Join(int[] parent, int a, int b) => parent[Find(parent, a)] = Find(parent, b);
}
