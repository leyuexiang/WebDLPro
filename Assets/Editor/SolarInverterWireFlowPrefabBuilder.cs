using System;
using System.Collections.Generic;
using System.IO;
using Unity.Collections;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// 为光伏逆变器关键环节的六条电线和一条控制线生成独立路径 UV，并写入共用流光效果配置。
/// 原线路网格与材质保持不变；流光只通过运行时叠加渲染器显示。
/// </summary>
public static class SolarInverterWireFlowPrefabBuilder
{
    private const string PrefabPath =
        "Assets/ProcessDetails/SolarPower/Inverter/SolarInverterProcessDetail.prefab";
    private const string ModelRootPath = "DisplayAnchor/逆变器关键环节9.28";
    private const string FlowMeshFolder = "Assets/Art/Generated/SolarInverterWireFlow";
    private const string FlowMaterialPath = "Assets/Shaders/PipelineFlow_Gas.mat";
    private const string GlowMaterialPath = "Assets/Shaders/FlyLineGlow.mat";

    // 参考图中标注箭头的主色：电力线为亮蓝，控制线为黄绿色。
    private static readonly Color PowerWireColor = new Color32(16, 174, 255, 255);
    private static readonly Color ControlLineColor = new Color32(145, 211, 0, 255);
    // 流光网格按局部坐标端点烘焙；正值沿烘焙距离增加方向，负值反向。
    // 0/3/4：逆变器 -> 光伏板；1/2/5：汇流箱 -> 逆变器；控制线：设备 -> SCADA。
    private static readonly float[] FlowSpeeds = { -3f, 3f, 3f, -3f, -3f, 3f, -3f };

    private static readonly string[] FlowLineNames =
    {
        "电线",
        "电线.001",
        "电线.002",
        "电线.003",
        "电线.004",
        "电线.005",
        "控制线"
    };

    private static readonly string[] FlowMeshNames =
    {
        "SolarInverterWire00FlowUV",
        "SolarInverterWire01FlowUV",
        "SolarInverterWire02FlowUV",
        "SolarInverterWire03FlowUV",
        "SolarInverterWire04FlowUV",
        "SolarInverterWire05FlowUV",
        "SolarInverterControlLineFlowUV"
    };

    /// <summary>重新烘焙并写入现有预制体，不触碰业务场景或关键环节目录。</summary>
    [MenuItem("Tools/WebDLPro/关键环节/更新光伏逆变器线路流光")]
    public static void UpdateExistingPrefab()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            throw new InvalidOperationException("请退出播放模式后再更新逆变器电线流光预制体。");
        }

        GameObject prefabContents = PrefabUtility.LoadPrefabContents(PrefabPath);
        try
        {
            Transform modelRoot = prefabContents.transform.Find(ModelRootPath);
            if (modelRoot == null)
            {
                throw new InvalidOperationException($"预制体缺少模型层级：{ModelRootPath}。");
            }

            Renderer[] flowLines = ResolveFlowLineRenderers(modelRoot);
            ConfigureWireFlowEffects(flowLines);

            GameObject savedPrefab = PrefabUtility.SaveAsPrefabAsset(prefabContents, PrefabPath);
            if (savedPrefab == null)
            {
                throw new InvalidOperationException("光伏逆变器流光预制体保存失败。");
            }
        }
        finally
        {
            PrefabUtility.UnloadPrefabContents(prefabContents);
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log($"[SolarInverterWireFlow] 已为六条电线和控制线配置流光效果：{PrefabPath}");
    }

    /// <summary>
    /// 在正式预制体生成流程中调用，使后续重建预制体时仍保留相同的流光配置。
    /// </summary>
    public static void ConfigureWireFlowEffects(IReadOnlyList<Renderer> flowLineRenderers)
    {
        if (flowLineRenderers == null || flowLineRenderers.Count != FlowLineNames.Length)
        {
            throw new ArgumentException("光伏逆变器流光必须显式绑定六条电线和一条控制线。", nameof(flowLineRenderers));
        }

        Material flowMaterial = AssetDatabase.LoadAssetAtPath<Material>(FlowMaterialPath);
        Material glowMaterial = AssetDatabase.LoadAssetAtPath<Material>(GlowMaterialPath);
        if (flowMaterial == null || glowMaterial == null || flowMaterial.shader == null || glowMaterial.shader == null)
        {
            throw new InvalidOperationException($"飞线参考材质不可用：{FlowMaterialPath} / {GlowMaterialPath}。");
        }

        EnsureFlowMeshFolder();
        for (int index = 0; index < FlowLineNames.Length; index++)
        {
            Renderer sourceRenderer = flowLineRenderers[index];
            MeshFilter sourceFilter = sourceRenderer != null ? sourceRenderer.GetComponent<MeshFilter>() : null;
            Mesh sourceMesh = sourceFilter != null ? sourceFilter.sharedMesh : null;
            MeshRenderer meshRenderer = sourceRenderer as MeshRenderer;
            if (sourceMesh == null || meshRenderer == null)
            {
                throw new InvalidOperationException($"线路 {FlowLineNames[index]} 必须包含 MeshFilter 与 MeshRenderer。");
            }

            string flowMeshPath = $"{FlowMeshFolder}/{FlowMeshNames[index]}.asset";
            Mesh flowMesh = BakeAndSaveFlowMesh(sourceMesh, flowMeshPath, index / (float)FlowLineNames.Length);

            ControlCircuitElectronFlowEffect effect =
                sourceRenderer.GetComponent<ControlCircuitElectronFlowEffect>();
            if (effect == null)
            {
                effect = sourceRenderer.gameObject.AddComponent<ControlCircuitElectronFlowEffect>();
            }

            effect.Configure(sourceFilter, meshRenderer, flowMesh, flowMaterial, glowMaterial);
            Color lineColor = index == FlowLineNames.Length - 1 ? ControlLineColor : PowerWireColor;
            Color baseColor = lineColor * 0.18f;
            Color headColor = Color.Lerp(lineColor, Color.white, 0.35f);
            effect.ConfigureAppearanceForEditor(baseColor, lineColor, headColor, FlowSpeeds[index]);
            EditorUtility.SetDirty(effect);
        }
    }

    private static Renderer[] ResolveFlowLineRenderers(Transform modelRoot)
    {
        Renderer[] renderers = new Renderer[FlowLineNames.Length];
        for (int index = 0; index < FlowLineNames.Length; index++)
        {
            Transform wire = modelRoot.Find(FlowLineNames[index]);
            Renderer renderer = wire != null ? wire.GetComponent<Renderer>() : null;
            if (renderer == null)
            {
                throw new InvalidOperationException($"逆变器预制体缺少显式线路 Renderer：{FlowLineNames[index]}。");
            }

            renderers[index] = renderer;
        }

        return renderers;
    }

    private static Mesh BakeAndSaveFlowMesh(Mesh source, string assetPath, float phaseOffset)
    {
        Mesh baked = CreateFlowMesh(source, phaseOffset);
        // Unity 会将主对象名与资产文件名比较；统一名称可避免导入时产生误报。
        baked.name = Path.GetFileNameWithoutExtension(assetPath);
        Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(assetPath);
        if (existing != null)
        {
            EditorUtility.CopySerialized(baked, existing);
            UnityEngine.Object.DestroyImmediate(baked);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        AssetDatabase.CreateAsset(baked, assetPath);
        return baked;
    }

    /// <summary>
    /// 复制源网格并在 UV1.x 写入沿三角网格路径累计的距离，UV1.y 则错开各线路的脉冲相位。
    /// </summary>
    private static Mesh CreateFlowMesh(Mesh source, float phaseOffset)
    {
        Vector3[] vertices;
        List<int[]> subMeshIndices = new List<int[]>();
        using (Mesh.MeshDataArray readOnlyData = Mesh.AcquireReadOnlyMeshData(source))
        {
            Mesh.MeshData meshData = readOnlyData[0];
            if (meshData.vertexCount == 0 || meshData.subMeshCount == 0)
            {
                throw new InvalidOperationException($"线路网格没有可烘焙的顶点或子网格：{source.name}。");
            }

            using (NativeArray<Vector3> positions = new NativeArray<Vector3>(meshData.vertexCount, Allocator.Temp))
            {
                meshData.GetVertices(positions);
                vertices = positions.ToArray();
            }

            for (int subMeshIndex = 0; subMeshIndex < meshData.subMeshCount; subMeshIndex++)
            {
                SubMeshDescriptor descriptor = meshData.GetSubMesh(subMeshIndex);
                if (descriptor.topology != MeshTopology.Triangles || descriptor.indexCount < 3)
                {
                    throw new InvalidOperationException($"线路网格子网格必须由三角形构成：{source.name}。");
                }

                using (NativeArray<int> indices = new NativeArray<int>(descriptor.indexCount, Allocator.Temp))
                {
                    meshData.GetIndices(indices, subMeshIndex);
                    subMeshIndices.Add(indices.ToArray());
                }
            }
        }

        List<GraphEdge>[] adjacency = BuildAdjacency(vertices, subMeshIndices);
        Vector2[] routeCoordinates = BuildRouteCoordinates(vertices, adjacency, phaseOffset);
        Mesh baked = UnityEngine.Object.Instantiate(source);
        baked.name = $"{source.name} Solar Inverter Flow UV";
        baked.uv2 = routeCoordinates;
        baked.UploadMeshData(false);
        return baked;
    }

    private static List<GraphEdge>[] BuildAdjacency(Vector3[] vertices, List<int[]> subMeshIndices)
    {
        List<GraphEdge>[] adjacency = new List<GraphEdge>[vertices.Length];
        for (int index = 0; index < vertices.Length; index++)
        {
            adjacency[index] = new List<GraphEdge>(6);
        }

        HashSet<ulong> edgeKeys = new HashSet<ulong>();
        for (int subMeshIndex = 0; subMeshIndex < subMeshIndices.Count; subMeshIndex++)
        {
            int[] indices = subMeshIndices[subMeshIndex];
            if (indices.Length % 3 != 0)
            {
                throw new InvalidOperationException("线路网格包含不完整的三角形索引。");
            }

            for (int index = 0; index < indices.Length; index += 3)
            {
                AddEdge(adjacency, edgeKeys, vertices, indices[index], indices[index + 1]);
                AddEdge(adjacency, edgeKeys, vertices, indices[index + 1], indices[index + 2]);
                AddEdge(adjacency, edgeKeys, vertices, indices[index + 2], indices[index]);
            }
        }

        Dictionary<Vector3Int, int> firstVertexByPosition = new Dictionary<Vector3Int, int>();
        for (int index = 0; index < vertices.Length; index++)
        {
            Vector3Int key = Vector3Int.RoundToInt(vertices[index] * 10000f);
            if (firstVertexByPosition.TryGetValue(key, out int coincidentVertex))
            {
                AddEdge(adjacency, edgeKeys, vertices, index, coincidentVertex);
            }
            else
            {
                firstVertexByPosition.Add(key, index);
            }
        }

        return adjacency;
    }

    private static Vector2[] BuildRouteCoordinates(
        Vector3[] vertices,
        List<GraphEdge>[] adjacency,
        float phaseOffset)
    {
        Vector2[] coordinates = new Vector2[vertices.Length];
        bool[] visited = new bool[vertices.Length];
        // 连通分量依次复用距离数组和最小堆，避免每条线路为三次搜索重复分配整网格大小的缓存。
        float[] distances = new float[vertices.Length];
        List<DistanceNode> heap = new List<DistanceNode>(64);
        for (int start = 0; start < vertices.Length; start++)
        {
            if (visited[start])
            {
                continue;
            }

            List<int> component = CollectComponent(start, adjacency, visited);
            CalculateDistances(start, component, adjacency, distances, heap);
            int firstEnd = FindFarthestVertex(component, distances);
            CalculateDistances(firstEnd, component, adjacency, distances, heap);
            int secondEnd = FindFarthestVertex(component, distances);

            // 按局部坐标排序端点，使同一模型重烘焙时路线方向稳定且便于排查。
            int routeStart = ComparePosition(vertices[firstEnd], vertices[secondEnd]) <= 0
                ? firstEnd
                : secondEnd;
            CalculateDistances(routeStart, component, adjacency, distances, heap);
            float routePhase = Mathf.Repeat(phaseOffset, 1f);
            for (int index = 0; index < component.Count; index++)
            {
                int vertex = component[index];
                coordinates[vertex] = new Vector2(distances[vertex], routePhase);
            }
        }

        return coordinates;
    }

    private static int ComparePosition(Vector3 left, Vector3 right)
    {
        int comparison = left.x.CompareTo(right.x);
        if (comparison != 0) return comparison;
        comparison = left.y.CompareTo(right.y);
        return comparison != 0 ? comparison : left.z.CompareTo(right.z);
    }

    private static List<int> CollectComponent(int start, List<GraphEdge>[] adjacency, bool[] visited)
    {
        List<int> component = new List<int>();
        List<int> pending = new List<int> { start };
        visited[start] = true;
        while (pending.Count > 0)
        {
            int last = pending.Count - 1;
            int vertex = pending[last];
            pending.RemoveAt(last);
            component.Add(vertex);

            List<GraphEdge> edges = adjacency[vertex];
            for (int index = 0; index < edges.Count; index++)
            {
                int next = edges[index].Target;
                if (visited[next])
                {
                    continue;
                }

                visited[next] = true;
                pending.Add(next);
            }
        }

        return component;
    }

    private static void CalculateDistances(
        int source,
        List<int> component,
        List<GraphEdge>[] adjacency,
        float[] distances,
        List<DistanceNode> heap)
    {
        for (int index = 0; index < component.Count; index++)
        {
            distances[component[index]] = float.PositiveInfinity;
        }

        distances[source] = 0f;
        heap.Clear();
        heap.Add(new DistanceNode(source, 0f));
        while (TryPopMin(heap, out DistanceNode current))
        {
            if (current.Distance > distances[current.Vertex])
            {
                continue;
            }

            List<GraphEdge> edges = adjacency[current.Vertex];
            for (int index = 0; index < edges.Count; index++)
            {
                GraphEdge edge = edges[index];
                float candidate = current.Distance + edge.Cost;
                if (candidate >= distances[edge.Target])
                {
                    continue;
                }

                distances[edge.Target] = candidate;
                Push(heap, new DistanceNode(edge.Target, candidate));
            }
        }
    }

    private static int FindFarthestVertex(List<int> component, float[] distances)
    {
        int farthest = component[0];
        float farthestDistance = distances[farthest];
        for (int index = 1; index < component.Count; index++)
        {
            int vertex = component[index];
            if (distances[vertex] > farthestDistance)
            {
                farthest = vertex;
                farthestDistance = distances[vertex];
            }
        }

        return farthest;
    }

    private static void AddEdge(
        List<GraphEdge>[] adjacency,
        HashSet<ulong> edgeKeys,
        Vector3[] vertices,
        int first,
        int second)
    {
        if (first == second)
        {
            return;
        }

        uint lower = (uint)Mathf.Min(first, second);
        uint higher = (uint)Mathf.Max(first, second);
        ulong key = ((ulong)lower << 32) | higher;
        if (!edgeKeys.Add(key))
        {
            return;
        }

        float cost = Vector3.Distance(vertices[first], vertices[second]);
        adjacency[first].Add(new GraphEdge(second, cost));
        adjacency[second].Add(new GraphEdge(first, cost));
    }

    private static void Push(List<DistanceNode> heap, DistanceNode value)
    {
        heap.Add(value);
        int index = heap.Count - 1;
        while (index > 0)
        {
            int parent = (index - 1) / 2;
            if (heap[parent].Distance <= value.Distance)
            {
                break;
            }

            heap[index] = heap[parent];
            index = parent;
        }

        heap[index] = value;
    }

    private static bool TryPopMin(List<DistanceNode> heap, out DistanceNode value)
    {
        if (heap.Count == 0)
        {
            value = default;
            return false;
        }

        value = heap[0];
        DistanceNode tail = heap[heap.Count - 1];
        heap.RemoveAt(heap.Count - 1);
        if (heap.Count == 0)
        {
            return true;
        }

        int index = 0;
        while (true)
        {
            int left = index * 2 + 1;
            if (left >= heap.Count)
            {
                break;
            }

            int right = left + 1;
            int child = right < heap.Count && heap[right].Distance < heap[left].Distance ? right : left;
            if (heap[child].Distance >= tail.Distance)
            {
                break;
            }

            heap[index] = heap[child];
            index = child;
        }

        heap[index] = tail;
        return true;
    }

    private static void EnsureFlowMeshFolder()
    {
        const string generatedFolder = "Assets/Art/Generated";
        if (!AssetDatabase.IsValidFolder(generatedFolder))
        {
            AssetDatabase.CreateFolder("Assets/Art", "Generated");
        }

        if (!AssetDatabase.IsValidFolder(FlowMeshFolder))
        {
            AssetDatabase.CreateFolder(generatedFolder, "SolarInverterWireFlow");
        }
    }

    private struct GraphEdge
    {
        public readonly int Target;
        public readonly float Cost;

        public GraphEdge(int target, float cost)
        {
            Target = target;
            Cost = cost;
        }
    }

    private struct DistanceNode
    {
        public readonly int Vertex;
        public readonly float Distance;

        public DistanceNode(int vertex, float distance)
        {
            Vertex = vertex;
            Distance = distance;
        }
    }
}
