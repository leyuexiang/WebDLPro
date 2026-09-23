using System;
using UnityEngine;
using UnityEngine.Scripting;
using WebDLPro.Unity.SceneRuntime;

/// <summary>
/// 光伏逆变器第三层动态适配器。仅控制显式绑定电线材质槽的流动速度：
/// 故障时停流，正常、告警、离线及清除状态时恢复进入环节前的速度。
/// </summary>
[Preserve]
[DisallowMultipleComponent]
public sealed class SolarInverterProcessDetailDynamicAdapter : ProcessDetailDynamicTargetBase
{
    [SerializeField] private Renderer[] _wireRenderers = Array.Empty<Renderer>();

    private static readonly int FlowSpeedPropertyId = Shader.PropertyToID("_FlowSpeed");

    private MaterialPropertyBlock _propertyBlock;
    private float[][] _baselineSpeeds;
    private bool _initialized;

    protected override void ApplyPlayback(bool playing, bool faultStop)
    {
        if (!EnsureInitialized())
        {
            return;
        }

        for (int rendererIndex = 0; rendererIndex < _wireRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _wireRenderers[rendererIndex];
            Material[] materials = renderer.sharedMaterials;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                if (materials[materialIndex] == null || !materials[materialIndex].HasProperty(FlowSpeedPropertyId))
                {
                    continue;
                }

                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                _propertyBlock.SetFloat(
                    FlowSpeedPropertyId,
                    faultStop ? 0f : _baselineSpeeds[rendererIndex][materialIndex]);
                renderer.SetPropertyBlock(_propertyBlock, materialIndex);
            }
        }
    }

    protected override void OnReleased()
    {
        RestoreBaseline();
        _baselineSpeeds = null;
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
        _baselineSpeeds = new float[_wireRenderers.Length][];
        for (int rendererIndex = 0; rendererIndex < _wireRenderers.Length; rendererIndex++)
        {
            Renderer renderer = _wireRenderers[rendererIndex];
            if (renderer == null)
            {
                Debug.LogError($"[{nameof(SolarInverterProcessDetailDynamicAdapter)}] 电线渲染器包含空引用。", this);
                return false;
            }

            Material[] materials = renderer.sharedMaterials;
            _baselineSpeeds[rendererIndex] = new float[materials.Length];
            bool hasFlowSlot = false;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                if (material == null || !material.HasProperty(FlowSpeedPropertyId))
                {
                    continue;
                }

                hasFlowSlot = true;
                _propertyBlock.Clear();
                renderer.GetPropertyBlock(_propertyBlock, materialIndex);
                _baselineSpeeds[rendererIndex][materialIndex] = _propertyBlock.HasFloat(FlowSpeedPropertyId)
                    ? _propertyBlock.GetFloat(FlowSpeedPropertyId)
                    : material.GetFloat(FlowSpeedPropertyId);
            }

            if (!hasFlowSlot)
            {
                Debug.LogError($"[{nameof(SolarInverterProcessDetailDynamicAdapter)}] {renderer.name} 没有 _FlowSpeed 材质槽。", renderer);
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

            Material[] materials = renderer.sharedMaterials;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                if (materials[materialIndex] == null || !materials[materialIndex].HasProperty(FlowSpeedPropertyId))
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
    public void ConfigureForEditor(Renderer[] wireRenderers)
    {
        _wireRenderers = wireRenderers ?? Array.Empty<Renderer>();
        _baselineSpeeds = null;
        _initialized = false;
        ResetPlaybackStateForEditor();
    }
#endif
}
