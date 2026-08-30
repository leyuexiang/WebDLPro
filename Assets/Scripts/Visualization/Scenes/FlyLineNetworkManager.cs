using System;
using UnityEngine;

/// <summary>
/// 两个点之间的一条有向飞线连接。
/// 索引对应 FlyLineNetworkManager（飞线网络管理器）生成或管理的点数组顺序。
/// </summary>
[Serializable]
public sealed class FlyLineConnection
{
    [Tooltip("起点在点列表中的索引。")]
    [Min(0)] public int StartPointIndex;
    [Tooltip("终点在点列表中的索引。")]
    [Min(0)] public int EndPointIndex;

    public FlyLineConnection()
    {
    }

    public FlyLineConnection(int startPointIndex, int endPointIndex)
    {
        StartPointIndex = startPointIndex;
        EndPointIndex = endPointIndex;
    }
}

/// <summary>
/// 飞线网络管理器。
/// 管理随机生成的点、点对连接和底层 FlyLineEffectController（飞线特效控制器），
/// 每条连接对应一条独立飞线。正式场景只需要把 PointPrefab（点预制体）替换成设备模型预制体，
/// 连接索引和飞线控制器不需要改变。
/// </summary>
[ExecuteAlways]
[DisallowMultipleComponent]
[RequireComponent(typeof(FlyLineEffectController))]
public sealed class FlyLineNetworkManager : MonoBehaviour
{
    [Header("飞线控制器")]
    [Tooltip("负责实际绘制所有飞线的控制器。留空时自动使用当前物体上的控制器。")]
    [SerializeField] private FlyLineEffectController _lineEffect;

    [Header("点生成")]
    [Tooltip("随机点使用的预制体。正式场景可直接替换为设备模型预制体。")]
    [SerializeField] private GameObject _pointPrefab;
    [Tooltip("管理器生成的点会统一放在该容器下，便于整体替换和清理。")]
    [SerializeField] private Transform _pointsRoot;
    [Tooltip("随机生成的点数量。")]
    [SerializeField, Min(0)] private int _pointCount = 8;
    [Tooltip("随机点分布盒中心，使用管理器本地坐标。")]
    [SerializeField] private Vector3 _distributionCenter = new Vector3(0f, 1.2f, 0f);
    [Tooltip("随机点分布盒尺寸，三个分量分别对应 X、Y、Z 范围。")]
    [SerializeField] private Vector3 _distributionSize = new Vector3(8f, 3f, 5f);
    [Tooltip("相同种子会生成相同点位，方便测试和美术调试。")]
    [SerializeField] private int _randomSeed = 2024;
    [Tooltip("运行时点数量与配置不一致时，是否自动按当前配置重新生成。")]
    [SerializeField] private bool _regenerateOnPlay = true;

    [Header("指定点对")]
    [Tooltip("每个元素代表一条有向连接，例如 0 到 1；不会自动生成全部互连，避免连接数量爆炸。")]
    [SerializeField] private FlyLineConnection[] _connections = new FlyLineConnection[0];

    [Header("编辑器预览")]
    [Tooltip("编辑器中启用组件时是否立即重建已保存点位的飞线。")]
    [SerializeField] private bool _previewInEditor = true;

    private Transform[] _managedPoints = new Transform[0];
    private bool _isRebuilding;

    /// <summary>当前由管理器记录的点数量。</summary>
    public int ManagedPointCount => _managedPoints == null ? 0 : _managedPoints.Length;

    /// <summary>当前配置的连接数量。</summary>
    public int ConnectionCount => _connections == null ? 0 : _connections.Length;

    private void Reset()
    {
        _lineEffect = GetComponent<FlyLineEffectController>();
    }

    private void Awake()
    {
        CacheReferences();
        RefreshManagedPointsFromRoot();
        if (Application.isPlaying && _regenerateOnPlay && _pointPrefab != null && ManagedPointCount != _pointCount)
        {
            GenerateRandomPoints();
        }

        RebuildConnections();
    }

    private void OnEnable()
    {
        CacheReferences();
        RefreshManagedPointsFromRoot();
        if (!Application.isPlaying && _previewInEditor)
        {
            RebuildConnections();
        }
    }

    private void OnDestroy()
    {
        // 编辑器下生成的对象属于场景或预制体，不在组件销毁时主动清理，避免误删用户保存的点模型。
        _managedPoints = new Transform[0];
    }

#if UNITY_EDITOR
    private void OnValidate()
    {
        _pointCount = Mathf.Max(0, _pointCount);
        _distributionSize.x = Mathf.Max(0f, _distributionSize.x);
        _distributionSize.y = Mathf.Max(0f, _distributionSize.y);
        _distributionSize.z = Mathf.Max(0f, _distributionSize.z);
        CacheReferences();
        if (!Application.isPlaying && _previewInEditor && !_isRebuilding)
        {
            RebuildConnections();
        }
    }
#endif

    /// <summary>
    /// 重新生成全部随机点并重建连接。
    /// 该方法只清理管理器专属的 GeneratedFlyLinePoints（生成点容器），不会触碰场景其他对象。
    /// </summary>
    [ContextMenu("生成随机点并重建飞线")]
    public void GenerateRandomPoints()
    {
        CacheReferences();
        if (_pointPrefab == null)
        {
            Debug.LogError("FlyLineNetworkManager 缺少点预制体，无法生成随机点。", this);
            return;
        }

        Transform pointsRoot = EnsurePointsRoot();
        ClearGeneratedPoints(pointsRoot);
        _managedPoints = new Transform[_pointCount];
        System.Random random = new System.Random(_randomSeed);
        Vector3 halfSize = _distributionSize * 0.5f;

        for (int index = 0; index < _pointCount; index++)
        {
            GameObject pointObject = InstantiatePoint(_pointPrefab, pointsRoot);
            pointObject.name = $"FlyLinePoint_{index:00}";
            pointObject.transform.localPosition = _distributionCenter + new Vector3(
                (float)(random.NextDouble() * 2.0 - 1.0) * halfSize.x,
                (float)(random.NextDouble() * 2.0 - 1.0) * halfSize.y,
                (float)(random.NextDouble() * 2.0 - 1.0) * halfSize.z);
            pointObject.transform.localRotation = Quaternion.identity;

            FlyLinePoint point = pointObject.GetComponentInChildren<FlyLinePoint>(true);
            _managedPoints[index] = point != null ? point.ConnectionAnchor : pointObject.transform;
        }

        RebuildConnections();
        MarkOwnerDirty();
    }

    /// <summary>
    /// 使用指定的点对重建网络。
    /// 例如传入 (0,1)、(1,2)、(2,3) 就会生成一条有向链路，而不是全部互连。
    /// </summary>
    public void SetConnectionPairs(Vector2Int[] pairs)
    {
        if (pairs == null)
        {
            _connections = new FlyLineConnection[0];
        }
        else
        {
            _connections = new FlyLineConnection[pairs.Length];
            for (int index = 0; index < pairs.Length; index++)
            {
                _connections[index] = new FlyLineConnection(pairs[index].x, pairs[index].y);
            }
        }

        RebuildConnections();
        MarkOwnerDirty();
    }

    /// <summary>
    /// 重新读取当前点列表并把所有有效点对绑定到飞线控制器。
    /// 无效索引会保留对应飞线组但不生成几何，不会影响其他有效连接。
    /// </summary>
    [ContextMenu("重建指定点对飞线")]
    public void RebuildConnections()
    {
        if (_isRebuilding)
        {
            return;
        }

        CacheReferences();
        RefreshManagedPointsFromRoot();
        if (_lineEffect == null)
        {
            return;
        }

        _isRebuilding = true;
        try
        {
            int connectionCount = Mathf.Max(1, ConnectionCount);
            _lineEffect.SetEndpointGroupCount(connectionCount);
            for (int connectionIndex = 0; connectionIndex < ConnectionCount; connectionIndex++)
            {
                FlyLineConnection connection = _connections[connectionIndex];
                Transform start = GetManagedPoint(connection.StartPointIndex);
                Transform end = GetManagedPoint(connection.EndPointIndex);
                _lineEffect.BindEndpointGroup(connectionIndex, start, end, false);
            }

            if (ConnectionCount == 0)
            {
                _lineEffect.BindEndpointGroup(0, null, null, false);
            }

            _lineEffect.SetEffectEnabled(true);
            _lineEffect.RefreshGeometry();
        }
        finally
        {
            _isRebuilding = false;
        }
    }

    private void CacheReferences()
    {
        if (_lineEffect == null)
        {
            _lineEffect = GetComponent<FlyLineEffectController>();
        }
    }

    private Transform EnsurePointsRoot()
    {
        if (_pointsRoot != null)
        {
            return _pointsRoot;
        }

        Transform existingRoot = transform.Find("GeneratedFlyLinePoints");
        if (existingRoot != null)
        {
            _pointsRoot = existingRoot;
            return _pointsRoot;
        }

        GameObject rootObject = new GameObject("GeneratedFlyLinePoints");
        _pointsRoot = rootObject.transform;
        _pointsRoot.SetParent(transform, false);
        return _pointsRoot;
    }

    private void RefreshManagedPointsFromRoot()
    {
        if (_pointsRoot == null)
        {
            Transform existingRoot = transform.Find("GeneratedFlyLinePoints");
            if (existingRoot == null)
            {
                _managedPoints = new Transform[0];
                return;
            }

            _pointsRoot = existingRoot;
        }

        int childCount = _pointsRoot.childCount;
        if (_managedPoints == null || _managedPoints.Length != childCount)
        {
            _managedPoints = new Transform[childCount];
        }

        for (int index = 0; index < childCount; index++)
        {
            Transform pointTransform = _pointsRoot.GetChild(index);
            FlyLinePoint point = pointTransform.GetComponentInChildren<FlyLinePoint>(true);
            _managedPoints[index] = point != null ? point.ConnectionAnchor : pointTransform;
        }
    }

    private void ClearGeneratedPoints(Transform pointsRoot)
    {
        for (int childIndex = pointsRoot.childCount - 1; childIndex >= 0; childIndex--)
        {
            GameObject child = pointsRoot.GetChild(childIndex).gameObject;
#if UNITY_EDITOR
            if (!Application.isPlaying)
            {
                DestroyImmediate(child);
                continue;
            }
#endif
            Destroy(child);
        }
    }

    private static GameObject InstantiatePoint(GameObject prefab, Transform parent)
    {
#if UNITY_EDITOR
        if (!Application.isPlaying && UnityEditor.PrefabUtility.IsPartOfPrefabAsset(prefab))
        {
            GameObject prefabInstance = UnityEditor.PrefabUtility.InstantiatePrefab(prefab, parent) as GameObject;
            if (prefabInstance != null)
            {
                return prefabInstance;
            }
        }
#endif

        return Instantiate(prefab, parent);
    }

    private Transform GetManagedPoint(int index)
    {
        if (_managedPoints == null || index < 0 || index >= _managedPoints.Length)
        {
            return null;
        }

        Transform point = _managedPoints[index];
        return point != null ? point : null;
    }

    private void MarkOwnerDirty()
    {
#if UNITY_EDITOR
        if (!Application.isPlaying)
        {
            UnityEditor.EditorUtility.SetDirty(this);
            if (_pointsRoot != null)
            {
                UnityEditor.EditorUtility.SetDirty(_pointsRoot);
            }
        }
#endif
    }
}
