using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 三层区域效果运行时适配器。
    /// 区域 Renderer（渲染器）和材质槽必须由场景装配层按 areaId 显式登记；本类只按影响集合切换
    /// 已登记区域的显示状态，不扫描层级、不读取对象名称、不创建材质副本，也不使用粒子或协程。
    /// </summary>
    public sealed class ThreeLayerAreaEffectRuntime
    {
        private sealed class AreaState
        {
            public readonly string AreaId;
            public readonly ThreeLayerAreaEffectType EffectType;
            public readonly ThreeLayerMaterialPropertyAdapter[] MaterialAdapters;
            public bool IsActive;
            public bool HasAppliedState;
            public bool AppliedActive;

            public AreaState(
                string areaId,
                ThreeLayerAreaEffectType effectType,
                ThreeLayerMaterialPropertyAdapter[] materialAdapters)
            {
                AreaId = areaId;
                EffectType = effectType;
                MaterialAdapters = materialAdapters;
            }
        }

        private readonly ThreeLayerBindingIndex _bindingIndex;
        private readonly Dictionary<string, AreaState> _areasById =
            new Dictionary<string, AreaState>(StringComparer.Ordinal);
        private bool _released;

        public ThreeLayerAreaEffectRuntime(ThreeLayerBindingIndex bindingIndex)
        {
            _bindingIndex = bindingIndex ?? throw new ArgumentNullException(nameof(bindingIndex));
        }

        public int RegisteredAreaCount => _areasById.Count;
        public bool IsReleased => _released;

        /// <summary>
        /// 登记一个区域对应的全部材质槽。材质属性名在适配器创建时解析并缓存，区域登记只校验一次。
        /// 同一 areaId 只能登记一次；一个区域可包含多个 Renderer 材质槽以支持覆盖网格的多材质模型。
        /// </summary>
        public bool TryRegisterArea(
            string areaId,
            IReadOnlyList<ThreeLayerMaterialPropertyAdapter> materialAdapters,
            out string error)
        {
            error = string.Empty;
            if (_released)
            {
                error = "区域效果运行时适配器已经释放。";
                return false;
            }
            if (!_bindingIndex.TryGetArea(areaId, out ThreeLayerAreaBinding binding))
            {
                error = $"未登记的 areaId：{areaId ?? string.Empty}。";
                return false;
            }
            if (!_bindingIndex.TryGetEffectProfile(binding.EffectProfileId, out ThreeLayerEffectProfileBinding profile))
            {
                error = $"区域 {binding.AreaId} 的效果配置未登记：{binding.EffectProfileId}。";
                return false;
            }
            if (_areasById.ContainsKey(binding.AreaId))
            {
                error = $"areaId 已重复登记：{binding.AreaId}。";
                return false;
            }
            if (materialAdapters == null || materialAdapters.Count == 0)
            {
                error = $"区域 {binding.AreaId} 没有登记材质属性块适配器。";
                return false;
            }

            ThreeLayerMaterialPropertyAdapter[] adapters = new ThreeLayerMaterialPropertyAdapter[materialAdapters.Count];
            for (int index = 0; index < materialAdapters.Count; index++)
            {
                ThreeLayerMaterialPropertyAdapter adapter = materialAdapters[index];
                if (adapter == null || adapter.IsReleased ||
                    (adapter.PropertyIds.Color == 0 && adapter.PropertyIds.Opacity == 0))
                {
                    error = $"区域 {binding.AreaId} 的第 {index} 个材质槽不具备可用颜色或透明度属性。";
                    return false;
                }

                adapters[index] = adapter;
            }

            AreaState state = new AreaState(binding.AreaId, profile.EffectType, adapters);
            _areasById.Add(binding.AreaId, state);
            // 区域登记后默认不显示；只有异常影响投影显式包含 areaId 时才进入可见状态。
            ApplyEffectiveState(state);
            return true;
        }

        /// <summary>
        /// 应用当前异常影响产生的区域集合。集合只能包含已完成材质登记的 areaId，避免影响结果被静默丢弃。
        /// 只有区域状态变化时才写材质属性块；重复下发不会重复更新 Renderer。
        /// </summary>
        public BusinessSceneCommandResult ApplyImpact(ISet<string> activeAreaIds)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed(
                    "area-effect-runtime-released",
                    "区域效果运行时适配器已经释放。");
            }
            if (activeAreaIds == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "area-effect-impact-null",
                    "区域影响集合不能为空。若没有受影响区域，应传入空集合。");
            }

            foreach (string areaId in activeAreaIds)
            {
                if (!_areasById.ContainsKey(areaId))
                {
                    return BusinessSceneCommandResult.Failed(
                        "area-effect-not-registered",
                        $"影响结果中的 areaId 尚未完成运行时材质登记：{areaId ?? string.Empty}。");
                }
            }

            foreach (AreaState state in _areasById.Values)
            {
                bool active = activeAreaIds.Contains(state.AreaId);
                if (state.IsActive == active)
                {
                    continue;
                }

                state.IsActive = active;
                ApplyEffectiveState(state);
            }

            return BusinessSceneCommandResult.Completed(
                $"区域影响状态已更新，启用区域数：{activeAreaIds.Count}。");
        }

        /// <summary>查询区域当前是否处于受影响显示状态。</summary>
        public bool IsAreaActive(string areaId)
        {
            return _areasById.TryGetValue(areaId ?? string.Empty, out AreaState state) && state.IsActive;
        }

        /// <summary>
        /// 恢复全部区域材质槽的登记基线并释放适配器引用。释放不销毁共享材质资产，且可重复调用。
        /// </summary>
        public BusinessSceneCommandResult Release()
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Completed("区域效果运行时适配器已释放。");
            }

            foreach (AreaState state in _areasById.Values)
            {
                for (int index = 0; index < state.MaterialAdapters.Length; index++)
                {
                    ThreeLayerMaterialPropertyAdapter adapter = state.MaterialAdapters[index];
                    adapter.Restore();
                    adapter.Release();
                }
            }

            _areasById.Clear();
            _released = true;
            return BusinessSceneCommandResult.Completed("区域效果运行时适配器已恢复基线并释放。");
        }

        private static void ApplyEffectiveState(AreaState state)
        {
            if (state.HasAppliedState && state.AppliedActive == state.IsActive)
            {
                return;
            }

            for (int index = 0; index < state.MaterialAdapters.Length; index++)
            {
                ThreeLayerMaterialPropertyAdapter adapter = state.MaterialAdapters[index];
                ThreeLayerMaterialPropertyValues values = new ThreeLayerMaterialPropertyValues();
                if (adapter.PropertyIds.Color != 0)
                {
                    Color color = adapter.OriginalColor;
                    color.a = state.IsActive ? adapter.OriginalColor.a : 0f;
                    values.HasColor = true;
                    values.Color = color;
                }
                if (adapter.PropertyIds.Opacity != 0)
                {
                    values.HasOpacity = true;
                    values.Opacity = state.IsActive ? adapter.OriginalOpacity : 0f;
                }

                adapter.Apply(values);
            }

            state.HasAppliedState = true;
            state.AppliedActive = state.IsActive;
        }
    }
}
