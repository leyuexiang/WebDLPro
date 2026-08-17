using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class PowerPlantPipelineUvBaker
{
    private const string SceneRootName = "场景";
    private const string OutputDirectory = "Assets/Art/Generated/PipelineFlow";

    [MenuItem("Tools/Power Plant/Bake Flow UVs")]
    public static void BakeFlowUvs()
    {
        Transform sceneRoot = GameObject.Find(SceneRootName)?.transform;
        if (sceneRoot == null)
        {
            Debug.LogError("[PowerPlantPipelineUvBaker] 未找到场景根对象。");
            return;
        }

        EnsureOutputDirectory();
        Debug.Log("[PowerPlantPipelineUvBaker] 开始生成管道流动 UV 网格。");
        BakeMesh(sceneRoot, "海水进水口管道", "SeaWaterIntakeFlowUV.asset");
        BakeMesh(sceneRoot, "排水口管道1", "WaterDischargeFlowUV.asset");
        BakeMesh(sceneRoot, "凝结水到锅炉管道2", "CondensateToHrsgFlowUV.asset");
        // 场景中的已验证对象名带有编号后缀，必须与层级中的实际名称一致。
        BakeMesh(sceneRoot, "余热锅炉管道001", "HrsgFlowUV.asset");
        // 两条电线同样使用沿网格路径递增的 UV0：流动带会沿真实线缆延展，
        // 不会受原始 FBX 贴图坐标影响而出现横向流动、断裂或停滞。
        BakeMesh(sceneRoot, "发电机线", "GeneratorCableFlowUV.asset");
        BakeMesh(sceneRoot, "变压器电线", "TransformerCableFlowUV.asset");
        EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
        EditorSceneManager.SaveScene(SceneManager.GetActiveScene());
        AssetDatabase.SaveAssets();
        Debug.Log("[PowerPlantPipelineUvBaker] 已生成并绑定管道与电线的流动 UV 网格。");
    }

    private static void EnsureOutputDirectory()
    {
        const string generatedDirectory = "Assets/Art/Generated";
        if (!AssetDatabase.IsValidFolder(generatedDirectory))
        {
            AssetDatabase.CreateFolder("Assets/Art", "Generated");
        }

        if (!AssetDatabase.IsValidFolder(OutputDirectory))
        {
            AssetDatabase.CreateFolder(generatedDirectory, "PipelineFlow");
        }
    }

    private static void BakeMesh(Transform root, string objectName, string assetName)
    {
        MeshFilter filter = root.Find(objectName)?.GetComponent<MeshFilter>();
        if (filter == null || filter.sharedMesh == null)
        {
            Debug.LogError($"[PowerPlantPipelineUvBaker] 未找到网格：{objectName}");
            return;
        }

        string assetPath = OutputDirectory + "/" + assetName;
        // 已经引用目标流向网格时直接跳过：重复执行菜单只处理尚未烘焙的新对象，
        // 不会重新克隆旧管道网格，也不会因重复烘焙累积修改既有资产名称。
        if (AssetDatabase.GetAssetPath(filter.sharedMesh) == assetPath)
        {
            Debug.Log($"[PowerPlantPipelineUvBaker] 已跳过 {objectName}：流动 UV 网格已绑定。");
            return;
        }

        Mesh source = filter.sharedMesh;
        Vector3[] sourceVertices = source.vertices;
        Mesh baked = UnityEngine.Object.Instantiate(source);
        baked.name = source.name + " Flow UV";
        baked.uv = BuildFlowUvs(sourceVertices, baked);

        Debug.Log($"[PowerPlantPipelineUvBaker] {objectName}: 输出 {assetPath}");
        Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(assetPath);
        if (existing != null)
        {
            EditorUtility.CopySerialized(baked, existing);
            UnityEngine.Object.DestroyImmediate(baked);
            baked = existing;
        }
        else
        {
            AssetDatabase.CreateAsset(baked, assetPath);
            Debug.Log($"[PowerPlantPipelineUvBaker] 已创建 {assetPath}");
        }

        Undo.RecordObject(filter, "Bake Pipeline Flow UV");
        filter.sharedMesh = baked;
        Debug.Log($"[PowerPlantPipelineUvBaker] 已绑定 {objectName}: {AssetDatabase.GetAssetPath(baked)}");
        EditorUtility.SetDirty(filter);
    }

    private struct GraphEdge
    {
        public int Target;
        public float Cost;

        public GraphEdge(int target, float cost)
        {
            Target = target;
            Cost = cost;
        }
    }

    private struct DistanceNode
    {
        public int Vertex;
        public float Distance;

        public DistanceNode(int vertex, float distance)
        {
            Vertex = vertex;
            Distance = distance;
        }
    }

    private static Vector2[] BuildFlowUvs(Vector3[] vertices, Mesh mesh)
    {
        int vertexCount = vertices.Length;
        List<GraphEdge>[] adjacency = new List<GraphEdge>[vertexCount];
        for (int index = 0; index < vertexCount; index++)
        {
            adjacency[index] = new List<GraphEdge>();
        }

        HashSet<ulong> edgeKeys = new HashSet<ulong>();
        for (int subMeshIndex = 0; subMeshIndex < mesh.subMeshCount; subMeshIndex++)
        {
            int[] triangles = mesh.GetTriangles(subMeshIndex);
            for (int index = 0; index < triangles.Length; index += 3)
            {
                AddEdge(adjacency, edgeKeys, vertices, triangles[index], triangles[index + 1]);
                AddEdge(adjacency, edgeKeys, vertices, triangles[index + 1], triangles[index + 2]);
                AddEdge(adjacency, edgeKeys, vertices, triangles[index + 2], triangles[index]);
            }
        }

        Dictionary<Vector3Int, List<int>> verticesByPosition = new Dictionary<Vector3Int, List<int>>();
        for (int index = 0; index < vertexCount; index++)
        {
            Vector3Int key = Vector3Int.RoundToInt(vertices[index] * 1000f);
            if (!verticesByPosition.TryGetValue(key, out List<int> coincidentVertices))
            {
                coincidentVertices = new List<int>();
                verticesByPosition.Add(key, coincidentVertices);
            }

            coincidentVertices.Add(index);
        }

        foreach (List<int> coincidentVertices in verticesByPosition.Values)
        {
            int first = coincidentVertices[0];
            for (int index = 1; index < coincidentVertices.Count; index++)
            {
                AddEdge(adjacency, edgeKeys, vertices, first, coincidentVertices[index]);
            }
        }

        Vector2[] uvs = new Vector2[vertexCount];
        bool[] visited = new bool[vertexCount];
        for (int start = 0; start < vertexCount; start++)
        {
            if (visited[start])
            {
                continue;
            }

            List<int> component = CollectComponent(start, adjacency, visited);
            float[] distances = CalculateDistances(component[0], component, adjacency, vertexCount);
            int source = FindFarthestVertex(component, distances);
            distances = CalculateDistances(source, component, adjacency, vertexCount);

            for (int index = 0; index < component.Count; index++)
            {
                int vertex = component[index];
                uvs[vertex] = new Vector2(distances[vertex], 0.5f);
            }
        }

        return uvs;
    }

    private static void AddEdge(List<GraphEdge>[] adjacency, HashSet<ulong> edgeKeys, Vector3[] vertices, int first, int second)
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

    private static float[] CalculateDistances(int source, List<int> component, List<GraphEdge>[] adjacency, int vertexCount)
    {
        float[] distances = new float[vertexCount];
        for (int index = 0; index < component.Count; index++)
        {
            distances[component[index]] = float.PositiveInfinity;
        }

        distances[source] = 0f;
        List<DistanceNode> queue = new List<DistanceNode> { new DistanceNode(source, 0f) };
        while (TryPopMin(queue, out DistanceNode current))
        {
            if (current.Distance > distances[current.Vertex])
            {
                continue;
            }

            List<GraphEdge> edges = adjacency[current.Vertex];
            for (int index = 0; index < edges.Count; index++)
            {
                GraphEdge edge = edges[index];
                float nextDistance = current.Distance + edge.Cost;
                if (nextDistance >= distances[edge.Target])
                {
                    continue;
                }

                distances[edge.Target] = nextDistance;
                Push(queue, new DistanceNode(edge.Target, nextDistance));
            }
        }

        return distances;
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
}
