using System;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 光伏逆变器第三层动态适配器。统一控制六条电线和控制线的流光播放状态；
/// 故障红色只由 SolarInverterFaultVisualAdapter 处理。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class SolarInverterProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    [SerializeField] private Renderer[] _wireRenderers = Array.Empty<Renderer>();
    [SerializeField, ColorUsage(true, true)] private Color _faultColor = Color.red;

    private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");

    private readonly System.Collections.Generic.List<ControlCircuitElectronFlowEffect> _flowEffects =
        new System.Collections.Generic.List<ControlCircuitElectronFlowEffect>();

    private MaterialPropertyBlock _propertyBlock;
    private Material[][] _materialsByRenderer;
    private float[][] _baselineSpeeds;
    private bool[][] _hasFlowSpeed;
    private bool _initialized;

    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        if (!EnsureInitialized())
        {
            return;
        }

        bool shouldPlay = playing && !faultStop;
        for (int effectIndex = 0; effectIndex < _flowEffects.Count; effectIndex++)
        {
            _flowEffects[effectIndex].SetPlayback(shouldPlay);
        }

        for (int rendererIndex = 0; rendererIndex < _wireRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _wireRenderers[rendererIndex];
            Material[] materials = _materialsByRenderer[rendererIndex];
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                if (materials[materialIndex] == null || !_hasFlowSpeed[rendererIndex][materialIndex])
                {
                    continue;
                }

                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                _propertyBlock.SetFloat(
                    FlowSpeedPropertyId,
                    shouldPlay ? _baselineSpeeds[rendererIndex][materialIndex] : 0f);
                renderer.SetPropertyBlock(_propertyBlock, materialIndex);
            }
        }
    }

    protected override void OnReleased()
    {
        RestoreBaseline();
        _baselineSpeeds = null;
        _materialsByRenderer = null;
        _hasFlowSpeed = null;
        _propertyBlock?.Clear();
        _initialized = false;
    }

    private bool EnsureInitialized()
    {
        if (_initialized)
        {
            return true;
        }
        if (_wireRenderers == null || _wireRenderers.Length == 0)
        {
            Debug.LogError($"[{nameof(SolarInverterProcessDetailDynamicAdapter)}] 未绑定电线渲染器。", this);
            return false;
        }

        _propertyBlock = new MaterialPropertyBlock();
        _flowEffects.Clear();
        bool[] hasFlowEffectByRenderer = new bool[_wireRenderers.Length];
        for (int index = 0; index < _wireRenderers.Length; index++)
        {
            if (_wireRenderers[index] == null) continue;
            ControlCircuitElectronFlowEffect effect = _wireRenderers[index].GetComponent<ControlCircuitElectronFlowEffect>();
            if (effect != null)
            {
                hasFlowEffectByRenderer[index] = true;
                if (!_flowEffects.Contains(effect)) _flowEffects.Add(effect);
            }
        }
        _baselineSpeeds = new float[_wireRenderers.Length][];
        _materialsByRenderer = new Material[_wireRenderers.Length][];
        _hasFlowSpeed = new bool[_wireRenderers.Length][];
        for (int rendererIndex = 0; rendererIndex < _wireRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _wireRenderers[rendererIndex];
            if (renderer == null)
            {
                Debug.LogError($"[{nameof(SolarInverterProcessDetailDynamicAdapter)}] 电线渲染器包含空引用。", this);
                return false;
            }

            Material[] materials = renderer.sharedMaterials;
            _materialsByRenderer[rendererIndex] = materials;
            _baselineSpeeds[rendererIndex] = new float[materials.Length];
            _hasFlowSpeed[rendererIndex] = new bool[materials.Length];
            bool hasEffectSlot = false;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                if (material == null)
                {
                    continue;
                }

                if (material.HasProperty(FlowSpeedPropertyId))
                {
                    hasEffectSlot = true;
                    _hasFlowSpeed[rendererIndex][materialIndex] = true;
                    _propertyBlock.Clear();
                    renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                    _baselineSpeeds[rendererIndex][materialIndex] = _propertyBlock.HasFloat(FlowSpeedPropertyId)
                        ? _propertyBlock.GetFloat(FlowSpeedPropertyId)
                        : material.GetFloat(FlowSpeedPropertyId);
                }

            }

            // 叠加流光组件通过自身的 LineRenderer 材质控制动画，原线路材质不需要暴露 _FlowSpeed。
            if (!hasEffectSlot && !hasFlowEffectByRenderer[rendererIndex])
            {
                Debug.LogError($"[{nameof(SolarInverterProcessDetailDynamicAdapter)}] {renderer.name} 没有可用于流光控制的组件或材质属性。", renderer);
                return false;
            }
        }

        _initialized = true;
        return true;
    }

    private void RestoreBaseline()
    {
        if (!_initialized || _wireRenderers == null)
        {
            return;
        }

        for (int rendererIndex = 0; rendererIndex < _wireRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _wireRenderers[rendererIndex];
            if (renderer == null)
            {
                continue;
            }

            Material[] materials = _materialsByRenderer[rendererIndex];
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                if (materials[materialIndex] == null || !_hasFlowSpeed[rendererIndex][materialIndex])
                {
                    continue;
                }

                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                _propertyBlock.SetFloat(FlowSpeedPropertyId, _baselineSpeeds[rendererIndex][materialIndex]);
                renderer.SetPropertyBlock(_propertyBlock, materialIndex);
            }
        }
    }

#if UNITY_EDITOR
    public void ConfigureForEditor(Renderer[] wireRenderers, Color faultColor)
    {
        _wireRenderers = wireRenderers ?? Array.Empty<Renderer>();
        _faultColor = faultColor;
        _baselineSpeeds = null;
        _materialsByRenderer = null;
        _hasFlowSpeed = null;
        _initialized = false;
        ResetPlaybackStateForEditor();
    }
#endif
}
