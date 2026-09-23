using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>厂房壳体整体视觉模式。Baseline 表示恢复登记时的材质、属性块和启用状态。</summary>
    public enum BusinessSceneShellVisualMode
    {
        Baseline,
        Opaque,
        Translucent,
        Hidden,
        Released
    }

    /// <summary>
    /// 原始壳体材质到共享透明材质变体的显式映射。透明变体必须预先配置正确的混合、深度写入、
    /// 渲染队列、贴图和表面参数；运行时不会复制材质，也不会猜测 Shader 转换规则。
    /// </summary>
    [Serializable]
    public sealed class BusinessSceneShellMaterialVariant
    {
        [SerializeField] private Material _sourceMaterial;
        [SerializeField] private Material _transparentMaterial;

        public Material SourceMaterial => _sourceMaterial;
        public Material TransparentMaterial => _transparentMaterial;

        public BusinessSceneShellMaterialVariant(Material sourceMaterial, Material transparentMaterial)
        {
            _sourceMaterial = sourceMaterial;
            _transparentMaterial = transparentMaterial;
        }
    }

    /// <summary>
    /// 单个厂房壳体的整体视觉运行时。初始化时原子校验全部 Renderer 和材质槽，
    /// 运行时只复用已配置的共享材质与缓存属性块，不扫描层级、不创建材质副本，也不拥有内部设备资源。
    /// </summary>
    public sealed class BusinessSceneShellVisualRuntime
    {
        private sealed class RendererState
        {
            public Renderer Renderer;
            public bool OriginalEnabled;
            public Material[] OriginalMaterials;
            public Material[] TransparentMaterials;
            public MaterialPropertyBlock[] OriginalPropertyBlocks;
            public MaterialPropertyBlock[] WorkingPropertyBlocks;
            public ThreeLayerMaterialPropertyIds[] TransparentPropertyIds;
        }

        private readonly string _shellId;
        private readonly RendererState[] _rendererStates;
        private readonly float _translucentOpacity;
        private BusinessSceneShellVisualMode _mode;

        private BusinessSceneShellVisualRuntime(
            string shellId,
            RendererState[] rendererStates,
            float translucentOpacity)
        {
            _shellId = shellId;
            _rendererStates = rendererStates;
            _translucentOpacity = translucentOpacity;
            _mode = BusinessSceneShellVisualMode.Baseline;
        }

        public string ShellId => _shellId;
        public BusinessSceneShellVisualMode Mode => _mode;
        public float TranslucentOpacity => _translucentOpacity;

        /// <summary>
        /// 创建整体壳体运行时。任意 Renderer 重复、空材质槽缺少对应透明变体或透明材质不支持颜色/透明度时，
        /// 整体创建失败且不修改任何 Renderer，禁止出现只有部分墙体透明的中间状态。
        /// </summary>
        public static bool TryCreate(
            string shellId,
            IReadOnlyList<Renderer> renderers,
            IReadOnlyList<BusinessSceneShellMaterialVariant> materialVariants,
            float translucentOpacity,
            out BusinessSceneShellVisualRuntime runtime,
            out string error)
        {
            runtime = null;
            error = string.Empty;
            if (!SceneSwitchProtocolValidator.IsBoundedIdentifier(shellId))
            {
                error = "厂房壳体缺少合法稳定标识。";
                return false;
            }
            if (renderers == null || renderers.Count == 0)
            {
                error = "厂房壳体未显式登记 Renderer。";
                return false;
            }
            if (materialVariants == null || materialVariants.Count == 0)
            {
                error = "厂房壳体未配置共享透明材质变体。";
                return false;
            }
            if (float.IsNaN(translucentOpacity) || float.IsInfinity(translucentOpacity) ||
                translucentOpacity <= 0f || translucentOpacity >= 1f)
            {
                error = "厂房壳体透明度必须位于 0 到 1 之间。";
                return false;
            }

            Dictionary<int, Material> transparentBySourceId = new Dictionary<int, Material>();
            Dictionary<int, ThreeLayerMaterialPropertyIds> propertyIdsByTransparentId =
                new Dictionary<int, ThreeLayerMaterialPropertyIds>();
            for (int mappingIndex = 0; mappingIndex < materialVariants.Count; mappingIndex++)
            {
                BusinessSceneShellMaterialVariant mapping = materialVariants[mappingIndex];
                if (mapping == null || mapping.SourceMaterial == null || mapping.TransparentMaterial == null)
                {
                    error = "厂房壳体透明材质映射存在空值。";
                    return false;
                }

                int sourceId = mapping.SourceMaterial.GetInstanceID();
                if (transparentBySourceId.ContainsKey(sourceId))
                {
                    error = $"原始材质 {mapping.SourceMaterial.name} 重复登记透明变体。";
                    return false;
                }

                int transparentId = mapping.TransparentMaterial.GetInstanceID();
                if (!propertyIdsByTransparentId.TryGetValue(transparentId, out ThreeLayerMaterialPropertyIds propertyIds))
                {
                    if (!ThreeLayerMaterialPropertyAdapter.TryResolvePropertyIds(
                            mapping.TransparentMaterial,
                            out propertyIds,
                            out string propertyError) ||
                        propertyIds.Opacity == 0 && propertyIds.Color == 0)
                    {
                        error = string.IsNullOrWhiteSpace(propertyError)
                            ? $"透明材质 {mapping.TransparentMaterial.name} 不支持颜色或透明度属性。"
                            : propertyError;
                        return false;
                    }

                    propertyIdsByTransparentId.Add(transparentId, propertyIds);
                }

                transparentBySourceId.Add(sourceId, mapping.TransparentMaterial);
            }

            HashSet<Renderer> uniqueRenderers = new HashSet<Renderer>();
            RendererState[] states = new RendererState[renderers.Count];
            for (int rendererIndex = 0; rendererIndex < renderers.Count; rendererIndex++)
            {
                Renderer renderer = renderers[rendererIndex];
                if (renderer == null || !uniqueRenderers.Add(renderer))
                {
                    error = "厂房壳体存在空值或重复 Renderer。";
                    return false;
                }

                Material[] originalMaterials = renderer.sharedMaterials;
                if (originalMaterials == null || originalMaterials.Length == 0)
                {
                    error = $"厂房壳体 Renderer {renderer.name} 没有材质槽。";
                    return false;
                }

                Material[] transparentMaterials = new Material[originalMaterials.Length];
                ThreeLayerMaterialPropertyIds[] transparentPropertyIds =
                    new ThreeLayerMaterialPropertyIds[originalMaterials.Length];
                for (int materialIndex = 0; materialIndex < originalMaterials.Length; materialIndex++)
                {
                    Material sourceMaterial = originalMaterials[materialIndex];
                    if (sourceMaterial == null)
                    {
                        transparentMaterials[materialIndex] = null;
                        continue;
                    }

                    if (!transparentBySourceId.TryGetValue(sourceMaterial.GetInstanceID(), out Material transparentMaterial))
                    {
                        error = $"Renderer {renderer.name} 的材质槽 {materialIndex} 未配置透明变体。";
                        return false;
                    }

                    transparentMaterials[materialIndex] = transparentMaterial;
                    transparentPropertyIds[materialIndex] =
                        propertyIdsByTransparentId[transparentMaterial.GetInstanceID()];
                }

                MaterialPropertyBlock[] originalPropertyBlocks =
                    new MaterialPropertyBlock[originalMaterials.Length];
                MaterialPropertyBlock[] workingPropertyBlocks =
                    new MaterialPropertyBlock[originalMaterials.Length];
                for (int materialIndex = 0; materialIndex < originalMaterials.Length; materialIndex++)
                {
                    MaterialPropertyBlock originalPropertyBlock = new MaterialPropertyBlock();
                    renderer.GetPropertyBlock(originalPropertyBlock, materialIndex);
                    originalPropertyBlocks[materialIndex] = originalPropertyBlock.isEmpty
                        ? null
                        : originalPropertyBlock;
                    workingPropertyBlocks[materialIndex] = new MaterialPropertyBlock();
                }

                states[rendererIndex] = new RendererState
                {
                    Renderer = renderer,
                    OriginalEnabled = renderer.enabled,
                    OriginalMaterials = originalMaterials,
                    TransparentMaterials = transparentMaterials,
                    OriginalPropertyBlocks = originalPropertyBlocks,
                    WorkingPropertyBlocks = workingPropertyBlocks,
                    TransparentPropertyIds = transparentPropertyIds
                };
            }

            runtime = new BusinessSceneShellVisualRuntime(shellId, states, translucentOpacity);
            return true;
        }

        /// <summary>显示完整不透明壳体：恢复登记材质和属性块，并启用全部已登记 Renderer。</summary>
        public BusinessSceneCommandResult ShowOpaque()
        {
            if (!TryUse(out BusinessSceneCommandResult failure))
            {
                return failure;
            }
            if (_mode == BusinessSceneShellVisualMode.Opaque)
            {
                return BusinessSceneCommandResult.Completed("厂房壳体已经处于整体不透明状态。");
            }

            RestoreOriginalVisuals(enableAll: true);
            _mode = BusinessSceneShellVisualMode.Opaque;
            return BusinessSceneCommandResult.Completed("厂房壳体已整体显示为不透明状态。");
        }

        /// <summary>
        /// 使用显式共享透明变体显示全部壳体材质槽。透明度通过材质属性块逐槽写入，
        /// 其它实例属性保持当前值，重复调用不重新分配数组或材质。
        /// </summary>
        public BusinessSceneCommandResult ShowTranslucent()
        {
            if (!TryUse(out BusinessSceneCommandResult failure))
            {
                return failure;
            }
            if (_mode == BusinessSceneShellVisualMode.Translucent)
            {
                return BusinessSceneCommandResult.Completed("厂房壳体已经处于整体半透明状态。");
            }

            for (int rendererIndex = 0; rendererIndex < _rendererStates.Length; rendererIndex++)
            {
                RendererState state = _rendererStates[rendererIndex];
                if (state.Renderer == null)
                {
                    continue;
                }

                state.Renderer.sharedMaterials = state.TransparentMaterials;
                state.Renderer.enabled = true;
                for (int materialIndex = 0; materialIndex < state.TransparentMaterials.Length; materialIndex++)
                {
                    Material transparentMaterial = state.TransparentMaterials[materialIndex];
                    if (transparentMaterial == null)
                    {
                        continue;
                    }

                    MaterialPropertyBlock propertyBlock = state.WorkingPropertyBlocks[materialIndex];
                    state.Renderer.GetPropertyBlock(propertyBlock, materialIndex);
                    ThreeLayerMaterialPropertyIds propertyIds = state.TransparentPropertyIds[materialIndex];
                    if (propertyIds.Opacity != 0)
                    {
                        propertyBlock.SetFloat(propertyIds.Opacity, _translucentOpacity);
                    }
                    else
                    {
                        Color color = propertyBlock.HasColor(propertyIds.Color)
                            ? propertyBlock.GetColor(propertyIds.Color)
                            : transparentMaterial.GetColor(propertyIds.Color);
                        color.a = _translucentOpacity;
                        propertyBlock.SetColor(propertyIds.Color, color);
                    }

                    state.Renderer.SetPropertyBlock(propertyBlock, materialIndex);
                }
            }

            _mode = BusinessSceneShellVisualMode.Translucent;
            return BusinessSceneCommandResult.Completed("厂房壳体已整体显示为半透明状态。");
        }

        /// <summary>
        /// 只关闭显式登记的壳体 Renderer；不停用根节点、不释放材质，也不影响同层级内部设备和业务脚本。
        /// </summary>
        public BusinessSceneCommandResult Hide()
        {
            if (!TryUse(out BusinessSceneCommandResult failure))
            {
                return failure;
            }
            if (_mode == BusinessSceneShellVisualMode.Hidden)
            {
                return BusinessSceneCommandResult.Completed("厂房壳体已经隐藏。");
            }

            for (int rendererIndex = 0; rendererIndex < _rendererStates.Length; rendererIndex++)
            {
                Renderer renderer = _rendererStates[rendererIndex].Renderer;
                if (renderer != null)
                {
                    renderer.enabled = false;
                }
            }

            _mode = BusinessSceneShellVisualMode.Hidden;
            return BusinessSceneCommandResult.Completed("厂房壳体已隐藏，内部设备资源保持不变。");
        }

        /// <summary>精确恢复登记时的共享材质、完整属性块和每个 Renderer 的初始启用状态。</summary>
        public BusinessSceneCommandResult RestoreBaseline()
        {
            if (!TryUse(out BusinessSceneCommandResult failure))
            {
                return failure;
            }
            if (_mode == BusinessSceneShellVisualMode.Baseline)
            {
                return BusinessSceneCommandResult.Completed("厂房壳体已经处于登记基线。");
            }

            RestoreOriginalVisuals(enableAll: false);
            _mode = BusinessSceneShellVisualMode.Baseline;
            return BusinessSceneCommandResult.Completed("厂房壳体已恢复登记基线。");
        }

        /// <summary>释放前先恢复基线；本运行时不拥有共享材质资产，因此只清空缓存并保持幂等。</summary>
        public BusinessSceneCommandResult Release()
        {
            if (_mode == BusinessSceneShellVisualMode.Released)
            {
                return BusinessSceneCommandResult.Completed("厂房壳体视觉运行时已经释放。");
            }

            RestoreOriginalVisuals(enableAll: false);
            for (int rendererIndex = 0; rendererIndex < _rendererStates.Length; rendererIndex++)
            {
                RendererState state = _rendererStates[rendererIndex];
                for (int materialIndex = 0; materialIndex < state.WorkingPropertyBlocks.Length; materialIndex++)
                {
                    state.WorkingPropertyBlocks[materialIndex].Clear();
                }
            }

            _mode = BusinessSceneShellVisualMode.Released;
            return BusinessSceneCommandResult.Completed("厂房壳体视觉运行时已恢复基线并释放缓存。");
        }

        private bool TryUse(out BusinessSceneCommandResult failure)
        {
            if (_mode == BusinessSceneShellVisualMode.Released)
            {
                failure = BusinessSceneCommandResult.Failed(
                    "scene-shell-visual-released",
                    "厂房壳体视觉运行时已经释放。");
                return false;
            }

            failure = default;
            return true;
        }

        private void RestoreOriginalVisuals(bool enableAll)
        {
            for (int rendererIndex = 0; rendererIndex < _rendererStates.Length; rendererIndex++)
            {
                RendererState state = _rendererStates[rendererIndex];
                if (state.Renderer == null)
                {
                    continue;
                }

                state.Renderer.sharedMaterials = state.OriginalMaterials;
                for (int materialIndex = 0; materialIndex < state.OriginalPropertyBlocks.Length; materialIndex++)
                {
                    state.Renderer.SetPropertyBlock(state.OriginalPropertyBlocks[materialIndex], materialIndex);
                }

                state.Renderer.enabled = enableAll || state.OriginalEnabled;
            }
        }
    }
}
