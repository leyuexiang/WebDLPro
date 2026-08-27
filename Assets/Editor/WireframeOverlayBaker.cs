using System.Collections.Generic;
using Stopwatch = System.Diagnostics.Stopwatch;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// 特征边线框烘焙工具。
/// 按相邻面夹角筛选“硬边”，输出仅包含 <see cref="MeshTopology.Lines"/> 的轻量线框网格资产。
/// WebGL2 不支持几何着色器，因此线框必须在编辑器阶段预生成，运行时只做一次线段绘制。
/// </summary>
public static class WireframeOverlayBaker
{
    private const string GeneratedDirectory = "Assets/Art/Generated";
    private const string OutputDirectory = GeneratedDirectory + "/Wireframe";

    // 顶点焊接精度：模型单位为米，1mm 量化足以合并因 UV/法线拆分产生的重复顶点。
    private const float WeldQuantization = 1000f;

    // 三个量化坐标各占 21 位，合计 63 位，最高位始终保留为 0，避免 long 键出现负值。
    // 21 位有符号范围为约 ±1048 米（按 1mm 量化），覆盖当前电厂模型的实际坐标范围；
    // 超出范围时显式报错，禁止静默截断导致不同顶点错误合并。
    private const int PackedCoordinateBits = 21;
    private const int PackedCoordinateMin = -(1 << (PackedCoordinateBits - 1));
    private const int PackedCoordinateMax = (1 << (PackedCoordinateBits - 1)) - 1;
    private const int PackedCoordinateMask = (1 << PackedCoordinateBits) - 1;

    [MenuItem("Tools/Power Plant/Bake Wireframe Overlay (选中对象)")]
    public static void BakeSelection()
    {
        GameObject[] selection = Selection.gameObjects;
        if (selection.Length == 0)
        {
            Debug.LogError("[WireframeOverlayBaker] 请先在层级中选择需要烘焙线框的对象。");
            return;
        }

        EnsureOutputDirectory();
        int bakedCount = 0;
        for (int index = 0; index < selection.Length; index++)
        {
            bakedCount += BakeHierarchy(selection[index]);
        }

        AssetDatabase.SaveAssets();
        Debug.Log($"[WireframeOverlayBaker] 完成：共生成 {bakedCount} 个线框网格。");
    }

    /// <summary>
    /// 打开线框烘焙设置窗口。角度设置独立于已生成资产；只有下一次手动烘焙才会应用新值。
    /// </summary>
    [MenuItem("Tools/Power Plant/线框烘焙设置")]
    private static void OpenBakeSettings()
    {
        WireframeOverlayBakeSettingsWindow.Open();
    }

    /// <summary>
    /// 为对象及其子节点上的每个 MeshFilter 烘焙线框网格，返回成功数量。
    /// </summary>
    private static int BakeHierarchy(GameObject target)
    {
        MeshFilter[] filters = target.GetComponentsInChildren<MeshFilter>(true);
        // 同一个源网格可能被多个实例复用。线框资产以源网格为单位生成，重复处理只会浪费时间并覆盖同一资产。
        HashSet<Mesh> processedMeshes = new HashSet<Mesh>();
        int bakedCount = 0;
        for (int index = 0; index < filters.Length; index++)
        {
            Mesh source = filters[index].sharedMesh;
            if (source == null || !processedMeshes.Add(source))
            {
                continue;
            }

            string assetPath = $"{OutputDirectory}/{BuildAssetFileName(source)}";
            Stopwatch buildStopwatch = Stopwatch.StartNew();
            Mesh wireframe = BuildWireframeMesh(source);
            buildStopwatch.Stop();
            if (wireframe == null)
            {
                continue;
            }

            Stopwatch writeStopwatch = Stopwatch.StartNew();
            // 覆盖已有资产时传入的临时网格会被销毁，日志必须使用返回的存活资产引用。
            Mesh writtenWireframe = WriteMeshAsset(wireframe, assetPath);
            writeStopwatch.Stop();
            bakedCount++;
            Debug.Log(
                $"[WireframeOverlayBaker] {filters[index].name}: 输出 {assetPath}，" +
                $"线段={writtenWireframe.GetIndexCount(0) / 2u}，顶点={writtenWireframe.vertexCount}，" +
                $"构建耗时={buildStopwatch.ElapsedMilliseconds} ms，写入耗时={writeStopwatch.ElapsedMilliseconds} ms");
        }

        return bakedCount;
    }

    /// <summary>
    /// 提取特征边并构建线框网格。
    /// 判定规则：边界边（只被一个三角面使用）始终保留；共享边仅在两侧面法线夹角超过阈值时保留。
    /// </summary>
    private static Mesh BuildWireframeMesh(Mesh source)
    {
        Stopwatch stageStopwatch = Stopwatch.StartNew();
        Vector3[] vertices = source.vertices;
        int[] triangles = source.triangles;
        int triangleCount = triangles.Length / 3;
        long dataReadMilliseconds = stageStopwatch.ElapsedMilliseconds;
        if (triangleCount == 0)
        {
            return null;
        }

        int[] weldedIds = BuildWeldMap(vertices, out int weldedCount);
        Vector3[] weldedPositions = new Vector3[weldedCount];
        for (int index = 0; index < vertices.Length; index++)
        {
            weldedPositions[weldedIds[index]] = vertices[index];
        }
        long weldMilliseconds = stageStopwatch.ElapsedMilliseconds - dataReadMilliseconds;

        Vector3[] faceNormals = new Vector3[triangleCount];
        for (int face = 0; face < triangleCount; face++)
        {
            int offset = face * 3;
            Vector3 normal = Vector3.Cross(
                vertices[triangles[offset + 1]] - vertices[triangles[offset]],
                vertices[triangles[offset + 2]] - vertices[triangles[offset]]);
            faceNormals[face] = normal.sqrMagnitude < 1e-14f ? Vector3.zero : normal.normalized;
        }
        long normalMilliseconds = stageStopwatch.ElapsedMilliseconds - dataReadMilliseconds - weldMilliseconds;

        float cosThreshold = Mathf.Cos(WireframeOverlayBakeSettings.FeatureAngleDegrees * Mathf.Deg2Rad);

        // 特征边表使用定长开放寻址：边写入和查询均为均摊 O(n)，且全部数据位于连续数组。
        // 相比 Dictionary<long,int> + HashSet<long> 的两套节点容器，可显著减少百万边模型的分配、扩容和随机内存访问。
        List<long> keptEdges = CollectFeatureEdges(weldedIds, triangles, triangleCount, faceNormals, cosThreshold);
        long edgeMilliseconds = stageStopwatch.ElapsedMilliseconds - dataReadMilliseconds - weldMilliseconds - normalMilliseconds;

        if (keptEdges.Count == 0)
        {
            Debug.LogWarning($"[WireframeOverlayBaker] {source.name}: 未提取到特征边，已跳过。");
            return null;
        }

        Mesh wireframe = CreateLineMesh(source, weldedPositions, keptEdges);
        long lineMeshMilliseconds = stageStopwatch.ElapsedMilliseconds - dataReadMilliseconds - weldMilliseconds - normalMilliseconds - edgeMilliseconds;
        stageStopwatch.Stop();

        // 分阶段日志只在编辑器烘焙时输出一次，便于验证实际瓶颈；运行时不会执行该工具，也不会产生额外开销。
        Debug.Log(
            $"[WireframeOverlayBaker] {source.name}: 顶点={vertices.Length}，三角面={triangleCount}，" +
            $"焊接={weldMilliseconds} ms，法线={normalMilliseconds} ms，边筛选={edgeMilliseconds} ms，" +
            $"线网格={lineMeshMilliseconds} ms，阈值={WireframeOverlayBakeSettings.FeatureAngleDegrees:0.##}°");

        return wireframe;
    }

    /// <summary>
    /// 收集特征边。每条边只保留第一次出现的三角面；第二次出现时立即按夹角结算。
    /// 非流形边的第三次及后续出现不再参与判定，保持原始字典算法的视觉语义。
    /// </summary>
    private static List<long> CollectFeatureEdges(
        int[] weldedIds,
        int[] triangles,
        int triangleCount,
        Vector3[] faceNormals,
        float cosThreshold)
    {
        FeatureEdgeMap edgeMap = new FeatureEdgeMap(triangleCount * 3);
        for (int face = 0; face < triangleCount; face++)
        {
            int offset = face * 3;
            edgeMap.Accumulate(weldedIds[triangles[offset]], weldedIds[triangles[offset + 1]], face, faceNormals, cosThreshold);
            edgeMap.Accumulate(weldedIds[triangles[offset + 1]], weldedIds[triangles[offset + 2]], face, faceNormals, cosThreshold);
            edgeMap.Accumulate(weldedIds[triangles[offset + 2]], weldedIds[triangles[offset]], face, faceNormals, cosThreshold);
        }

        return edgeMap.CollectKeptEdges();
    }

    /// <summary>
    /// 特征边的开放寻址表。
    /// 键数组使用 0 作为空槽标记；有效边键不会为 0，因为退化边已在写入前过滤。
    /// </summary>
    private sealed class FeatureEdgeMap
    {
        private readonly long[] _keys;
        private readonly int[] _firstFaces;
        private readonly int _mask;
        private readonly List<long> _keptEdges;

        public FeatureEdgeMap(int expectedEdgeCount)
        {
            int capacity = CreateHashCapacity(expectedEdgeCount);

            _keys = new long[capacity];
            _firstFaces = new int[capacity];
            _mask = capacity - 1;
            _keptEdges = new List<long>(Mathf.Max(4, expectedEdgeCount / 8));
        }

        public void Accumulate(
            int idA,
            int idB,
            int face,
            Vector3[] faceNormals,
            float cosThreshold)
        {
            if (idA == idB)
            {
                return;
            }

            long key = idA < idB
                ? ((long)idA << 32) | (uint)idB
                : ((long)idB << 32) | (uint)idA;
            int slot = FindSlot(key);
            if (_keys[slot] == 0)
            {
                _keys[slot] = key;
                _firstFaces[slot] = face;
                return;
            }

            // -1 表示该边已经结算过第二个相邻面；后续非流形面不再重复计算。
            int firstFace = _firstFaces[slot];
            if (firstFace < 0)
            {
                return;
            }

            if (Vector3.Dot(faceNormals[firstFace], faceNormals[face]) < cosThreshold)
            {
                _keptEdges.Add(key);
            }

            _firstFaces[slot] = -1;
        }

        public List<long> CollectKeptEdges()
        {
            // 仍只有一个相邻面的边属于开放边界，必须在表扫描阶段补入结果。
            for (int slot = 0; slot < _keys.Length; slot++)
            {
                if (_keys[slot] != 0 && _firstFaces[slot] >= 0)
                {
                    _keptEdges.Add(_keys[slot]);
                }
            }

            return _keptEdges;
        }

        private int FindSlot(long key)
        {
            int slot = HashLong(key) & _mask;
            while (_keys[slot] != 0 && _keys[slot] != key)
            {
                slot = (slot + 1) & _mask;
            }

            return slot;
        }
    }

    /// <summary>
    /// 为开放寻址表计算不低于期望元素两倍的 2 次幂容量，保持负载因子不超过 0.5。
    /// </summary>
    private static int CreateHashCapacity(int expectedCount)
    {
        int requiredCapacity = Mathf.Max(4, expectedCount > int.MaxValue / 2 ? int.MaxValue : expectedCount * 2);
        int capacity = 4;
        while (capacity < requiredCapacity && capacity <= int.MaxValue / 2)
        {
            capacity <<= 1;
        }

        return capacity;
    }

    /// <summary>
    /// 对 long 键执行整数混合，供顶点焊接表和边表共用；不创建临时对象。
    /// </summary>
    private static int HashLong(long key)
    {
        unchecked
        {
            ulong value = (ulong)key;
            value ^= value >> 33;
            value *= 0xff51afd7ed558ccdUL;
            value ^= value >> 33;
            value *= 0xc4ceb9fe1a85ec53UL;
            value ^= value >> 33;
            return (int)value;
        }
    }

    /// <summary>
    /// 用保留下来的边构建线段网格。顶点仅包含实际被引用的位置，避免携带原模型的冗余顶点数据。
    /// </summary>
    private static Mesh CreateLineMesh(Mesh source, Vector3[] weldedPositions, List<long> keptEdges)
    {
        // 焊接顶点编号是从 0 开始的连续整数，使用定长数组比 Dictionary<int,int> 更快且无节点分配。
        int[] lineVertexIndexByWeldId = new int[weldedPositions.Length];
        for (int index = 0; index < lineVertexIndexByWeldId.Length; index++)
        {
            lineVertexIndexByWeldId[index] = -1;
        }
        List<Vector3> lineVertices = new List<Vector3>(keptEdges.Count);
        List<int> lineIndices = new List<int>(keptEdges.Count * 2);

        foreach (long key in keptEdges)
        {
            int idA = (int)(key >> 32);
            int idB = (int)(key & 0xFFFFFFFF);
            lineIndices.Add(ResolveLineVertex(lineVertexIndexByWeldId, lineVertices, weldedPositions, idA));
            lineIndices.Add(ResolveLineVertex(lineVertexIndexByWeldId, lineVertices, weldedPositions, idB));
        }

        Mesh wireframe = new Mesh
        {
            name = source.name + " Wire",
            // 线框顶点数可能超过 65535，必须使用 32 位索引。
            indexFormat = IndexFormat.UInt32
        };
        wireframe.SetVertices(lineVertices);
        wireframe.SetIndices(lineIndices, MeshTopology.Lines, 0, true);
        wireframe.bounds = source.bounds;
        return wireframe;
    }

    private static int ResolveLineVertex(
        int[] lineVertexIndexByWeldId,
        List<Vector3> lineVertices,
        Vector3[] weldedPositions,
        int weldId)
    {
        int lineVertexIndex = lineVertexIndexByWeldId[weldId];
        if (lineVertexIndex >= 0)
        {
            return lineVertexIndex;
        }

        lineVertexIndex = lineVertices.Count;
        lineVertexIndexByWeldId[weldId] = lineVertexIndex;
        lineVertices.Add(weldedPositions[weldId]);
        return lineVertexIndex;
    }

    /// <summary>
    /// 按量化坐标合并顶点，使同一几何边不会因 UV 或法线拆分被误判为多条独立边。
    /// </summary>
    private static int[] BuildWeldMap(Vector3[] vertices, out int weldedCount)
    {
        // Vector3Int 在 Unity 2022.3 中实现了 IEquatable<Vector3Int>，并不存在“必然装箱”的默认哈希路径。
        // 这里进一步改用连续数组开放寻址：坐标键从 12 字节降为 8 字节，值数组使用 -1 表示空槽，
        // 即使合法坐标打包后为 0 也不会与空槽混淆；整个焊接过程不再创建 Dictionary 节点。
        int capacity = CreateHashCapacity(vertices.Length);
        long[] keys = new long[capacity];
        int[] valueBySlot = new int[capacity];
        for (int slot = 0; slot < valueBySlot.Length; slot++)
        {
            valueBySlot[slot] = -1;
        }

        int mask = capacity - 1;
        int[] weldedIds = new int[vertices.Length];
        int uniqueCount = 0;

        for (int index = 0; index < vertices.Length; index++)
        {
            Vector3 position = vertices[index];
            Vector3Int quantized = new Vector3Int(
                Mathf.RoundToInt(position.x * WeldQuantization),
                Mathf.RoundToInt(position.y * WeldQuantization),
                Mathf.RoundToInt(position.z * WeldQuantization));
            long packedPosition = PackQuantizedPosition(quantized);

            int slot = HashLong(packedPosition) & mask;
            while (valueBySlot[slot] >= 0 && keys[slot] != packedPosition)
            {
                slot = (slot + 1) & mask;
            }

            int weldId = valueBySlot[slot];
            if (weldId < 0)
            {
                weldId = uniqueCount++;
                keys[slot] = packedPosition;
                valueBySlot[slot] = weldId;
            }

            weldedIds[index] = weldId;
        }

        weldedCount = uniqueCount;
        return weldedIds;
    }

    /// <summary>
    /// 将三个有符号量化坐标无碰撞地压入一个 long 键。
    /// 该键只用于字典索引，不需要在后续流程中解码，因此无需额外分配坐标对象。
    /// </summary>
    private static long PackQuantizedPosition(Vector3Int quantized)
    {
        if (quantized.x < PackedCoordinateMin || quantized.x > PackedCoordinateMax ||
            quantized.y < PackedCoordinateMin || quantized.y > PackedCoordinateMax ||
            quantized.z < PackedCoordinateMin || quantized.z > PackedCoordinateMax)
        {
            throw new System.InvalidOperationException(
                $"线框顶点量化坐标超出 long 打包范围：({quantized.x}, {quantized.y}, {quantized.z})。" +
                "请降低 WeldQuantization 或先缩放模型，避免不同顶点发生键冲突。");
        }

        unchecked
        {
            return ((long)(quantized.x & PackedCoordinateMask) << (PackedCoordinateBits * 2)) |
                   ((long)(quantized.y & PackedCoordinateMask) << PackedCoordinateBits) |
                   (uint)(quantized.z & PackedCoordinateMask);
        }
    }

    /// <summary>
    /// 覆盖写入已存在的资产而不是删除重建，保证已引用该网格的场景与预制体不会丢失引用。
    /// </summary>
    private static Mesh WriteMeshAsset(Mesh wireframe, string assetPath)
    {
        Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(assetPath);
        if (existing != null)
        {
            EditorUtility.CopySerialized(wireframe, existing);
            Object.DestroyImmediate(wireframe);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        AssetDatabase.CreateAsset(wireframe, assetPath);
        return wireframe;
    }

    private static void EnsureOutputDirectory()
    {
        if (!AssetDatabase.IsValidFolder(GeneratedDirectory))
        {
            AssetDatabase.CreateFolder("Assets/Art", "Generated");
        }

        if (!AssetDatabase.IsValidFolder(OutputDirectory))
        {
            AssetDatabase.CreateFolder(GeneratedDirectory, "Wireframe");
        }
    }

    /// <summary>
    /// 输出文件名带上源模型文件前缀。不同 FBX 内部网格常常同名（例如燃气与燃煤的“低中高压汽轮机”），
    /// 只用网格名会让后烘焙的结果覆盖前一个。
    /// </summary>
    private static string BuildAssetFileName(Mesh source)
    {
        string sourceAssetPath = AssetDatabase.GetAssetPath(source);
        string modelPrefix = string.IsNullOrEmpty(sourceAssetPath)
            ? string.Empty
            : System.IO.Path.GetFileNameWithoutExtension(sourceAssetPath) + "_";

        return SanitizeFileName(modelPrefix + source.name) + "_Wire.asset";
    }

    private static string SanitizeFileName(string fileName)
    {
        char[] invalidCharacters = System.IO.Path.GetInvalidFileNameChars();
        string sanitized = fileName;
        for (int index = 0; index < invalidCharacters.Length; index++)
        {
            sanitized = sanitized.Replace(invalidCharacters[index], '_');
        }

        return sanitized;
    }
}

/// <summary>
/// 烘焙参数。夹角阈值决定线框密度：值越大保留的边越少，画面越干净。
/// </summary>
public static class WireframeOverlayBakeSettings
{
    private const float DefaultFeatureAngleDegrees = 35f;
    private const float MinimumFeatureAngleDegrees = 1f;
    private const float MaximumFeatureAngleDegrees = 89f;
    private const string FeatureAnglePreferenceKey = "WebDLPro.WireframeOverlay.FeatureAngleDegrees";

    /// <summary>
    /// 特征边夹角阈值，单位为度。
    /// 数值越大，保留的线段越少；默认 35 度，适合曲面较多的工业模型。
    /// 可由编辑器扩展或测试代码在烘焙前写入，限制在 1～89 度避免退化。
    /// </summary>
    public static float FeatureAngleDegrees
    {
        // 使用 EditorPrefs（编辑器偏好设置）保留用户上次选定的阈值；读取时再次夹紧，
        // 即使偏好设置被外部手动修改，也不会向烘焙算法传入退化角度。
        get => Mathf.Clamp(
            EditorPrefs.GetFloat(FeatureAnglePreferenceKey, DefaultFeatureAngleDegrees),
            MinimumFeatureAngleDegrees,
            MaximumFeatureAngleDegrees);
        set => EditorPrefs.SetFloat(
            FeatureAnglePreferenceKey,
            Mathf.Clamp(value, MinimumFeatureAngleDegrees, MaximumFeatureAngleDegrees));
    }

    /// <summary>
    /// 恢复推荐的工业模型特征边阈值。只修改下次烘焙参数，不会重写任何已生成资产。
    /// </summary>
    public static void ResetFeatureAngleDegrees()
    {
        FeatureAngleDegrees = DefaultFeatureAngleDegrees;
    }
}

/// <summary>
/// 线框烘焙参数的轻量编辑器窗口。
/// 该窗口只保存角度偏好，不创建、修改或重新导入线框网格，避免用户调参时触发耗时操作。
/// </summary>
internal sealed class WireframeOverlayBakeSettingsWindow : EditorWindow
{
    private const float WindowWidth = 390f;
    private const float WindowHeight = 150f;

    /// <summary>
    /// 创建或聚焦唯一设置窗口，避免重复打开多个窗口导致用户误以为存在多份配置。
    /// </summary>
    public static void Open()
    {
        WireframeOverlayBakeSettingsWindow window = GetWindow<WireframeOverlayBakeSettingsWindow>(true, "线框烘焙设置");
        window.minSize = new Vector2(WindowWidth, WindowHeight);
        window.maxSize = new Vector2(WindowWidth, WindowHeight);
        window.Show();
    }

    private void OnGUI()
    {
        EditorGUILayout.LabelField("特征边筛选", EditorStyles.boldLabel);
        EditorGUILayout.HelpBox(
            "夹角越大，曲面上的线段越少。默认 35°，适合曲面密集的工业模型。\n" +
            "修改仅在下次执行线框烘焙时生效，当前已生成资产不会被覆盖。",
            MessageType.Info);

        EditorGUI.BeginChangeCheck();
        float featureAngleDegrees = EditorGUILayout.Slider(
            new GUIContent("特征边夹角（度）", "相邻三角面法线夹角达到此值时保留边线。"),
            WireframeOverlayBakeSettings.FeatureAngleDegrees,
            1f,
            89f);
        if (EditorGUI.EndChangeCheck())
        {
            // 属性内部会再次限制范围并写入持久化偏好，窗口不保留第二份状态。
            WireframeOverlayBakeSettings.FeatureAngleDegrees = featureAngleDegrees;
        }

        using (new EditorGUILayout.HorizontalScope())
        {
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("恢复默认值（35°）", GUILayout.Width(140f)))
            {
                WireframeOverlayBakeSettings.ResetFeatureAngleDegrees();
                Repaint();
            }
        }
    }
}
