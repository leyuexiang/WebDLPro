using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// 线框半透明特效控制器。
/// 开启时把目标的本体材质整体替换为全息半透明材质，并额外绘制一份预烘焙的特征边线框；
/// 关闭时恢复原始材质并隐藏线框，不改动模型资产。
/// 线框网格由 Tools/Power Plant/Bake Wireframe Overlay 预先生成，运行时不做任何拓扑计算。
/// </summary>
[DisallowMultipleComponent]
public sealed class WireframeHologramEffect : MonoBehaviour
{
    private const string WireframeChildName = "__WireframeOverlay";

    [Header("材质")]
    [Tooltip("本体使用的全息半透明材质。留空则只显示线框。")]
    [SerializeField] private Material hologramMaterial;
    [Tooltip("线框使用的材质，需搭配线段拓扑网格。")]
    [SerializeField] private Material wireframeMaterial;

    [Header("线框网格")]
    [Tooltip("与本组件所在网格对应的预烘焙线框网格。为空时自动跳过线框绘制。")]
    [SerializeField] private Mesh wireframeMesh;

    [Header("初始状态")]
    [Tooltip("勾选后在 Start 时立即进入特效状态。")]
    [SerializeField] private bool activeOnStart;

    // 缓存原始材质数组，关闭特效时逐个还原，避免重复分配。
    private readonly List<Renderer> _bodyRenderers = new List<Renderer>();
    private readonly List<Material[]> _originalMaterials = new List<Material[]>();
    private readonly List<Material[]> _hologramMaterials = new List<Material[]>();

    private GameObject _wireframeObject;
    private bool _isActive;
    private bool _isInitialized;

    /// <summary>
    /// 当前是否处于线框半透明状态。
    /// </summary>
    public bool IsActive => _isActive;

    private void Start()
    {
        Initialize();
        if (activeOnStart)
        {
            SetActive(true);
        }
    }

    private void OnDestroy()
    {
        // 运行时克隆的材质数组必须显式销毁，否则会随场景切换泄漏。
        for (int rendererIndex = 0; rendererIndex < _hologramMaterials.Count; rendererIndex++)
        {
            Material[] materials = _hologramMaterials[rendererIndex];
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                if (materials[materialIndex] != null)
                {
                    Destroy(materials[materialIndex]);
                }
            }
        }
    }

    /// <summary>
    /// 切换特效开关。重复设置同一状态不会产生任何渲染改动。
    /// </summary>
    public void SetActive(bool isActive)
    {
        Initialize();
        if (_isActive == isActive)
        {
            return;
        }

        _isActive = isActive;
        for (int rendererIndex = 0; rendererIndex < _bodyRenderers.Count; rendererIndex++)
        {
            Renderer renderer = _bodyRenderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            renderer.sharedMaterials = isActive && hologramMaterial != null
                ? _hologramMaterials[rendererIndex]
                : _originalMaterials[rendererIndex];
        }

        if (_wireframeObject != null)
        {
            _wireframeObject.SetActive(isActive);
        }
    }

    /// <summary>
    /// 缓存本体渲染器与全息材质数组，并按需创建线框子对象。只执行一次。
    /// </summary>
    private void Initialize()
    {
        if (_isInitialized)
        {
            return;
        }

        _isInitialized = true;

        Renderer[] renderers = GetComponentsInChildren<Renderer>(true);
        for (int index = 0; index < renderers.Length; index++)
        {
            Renderer renderer = renderers[index];
            Material[] originals = renderer.sharedMaterials;
            _bodyRenderers.Add(renderer);
            _originalMaterials.Add(originals);

            // 全息材质按槽位数量铺满，保证多材质模型的每个子网格都被替换。
            Material[] hologramSlots = new Material[originals.Length];
            for (int slot = 0; slot < hologramSlots.Length; slot++)
            {
                hologramSlots[slot] = hologramMaterial;
            }

            _hologramMaterials.Add(hologramSlots);
        }

        CreateWireframeObject();
    }

    /// <summary>
    /// 用独立子对象绘制线框，使其与本体共享变换但可单独控制显隐和材质。
    /// </summary>
    private void CreateWireframeObject()
    {
        if (wireframeMesh == null || wireframeMaterial == null)
        {
            return;
        }

        MeshFilter sourceFilter = GetComponentInChildren<MeshFilter>(true);
        Transform parent = sourceFilter != null ? sourceFilter.transform : transform;

        _wireframeObject = new GameObject(WireframeChildName);
        _wireframeObject.transform.SetParent(parent, false);

        MeshFilter filter = _wireframeObject.AddComponent<MeshFilter>();
        filter.sharedMesh = wireframeMesh;

        MeshRenderer renderer = _wireframeObject.AddComponent<MeshRenderer>();
        renderer.sharedMaterial = wireframeMaterial;
        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
        renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;

        _wireframeObject.SetActive(false);
    }
}
