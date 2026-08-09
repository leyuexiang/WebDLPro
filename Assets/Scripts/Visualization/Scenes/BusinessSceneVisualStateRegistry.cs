using System;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 四态颜色必须由具体业务场景显式配置；通用适配层只负责固定枚举到颜色的常数时间映射，
    /// 不根据模型名称、材质名称或当前颜色猜测正常、告警、故障和离线语义。
    /// </summary>
    public readonly struct BusinessSceneVisualStatePalette
    {
        public Color Normal { get; }
        public Color Alarm { get; }
        public Color Fault { get; }
        public Color Offline { get; }

        public BusinessSceneVisualStatePalette(Color normal, Color alarm, Color fault, Color offline)
        {
            Normal = normal;
            Alarm = alarm;
            Fault = fault;
            Offline = offline;
        }

        /// <summary>固定四态由枚举直接分派，不分配临时字典或字符串。</summary>
        public Color Resolve(BusinessSceneNodeVisualState visualState)
        {
            switch (visualState)
            {
                case BusinessSceneNodeVisualState.Alarm:
                    return Alarm;
                case BusinessSceneNodeVisualState.Fault:
                    return Fault;
                case BusinessSceneNodeVisualState.Offline:
                    return Offline;
                default:
                    return Normal;
            }
        }
    }

    /// <summary>
    /// 单个稳定三维节点的显式视觉登记。渲染器和着色属性均由场景负责人提供，
    /// 因此注册表不读取 Unity 层级路径，也不会把二维拓扑节点或对象名称当作三维映射。
    /// </summary>
    public readonly struct BusinessSceneVisualStateBinding
    {
        public string SceneNodeId { get; }
        public Renderer[] Renderers { get; }
        public string ColorPropertyName { get; }
        public BusinessSceneVisualStatePalette Palette { get; }

        public BusinessSceneVisualStateBinding(
            string sceneNodeId,
            Renderer[] renderers,
            string colorPropertyName,
            BusinessSceneVisualStatePalette palette)
        {
            SceneNodeId = sceneNodeId;
            Renderers = renderers;
            ColorPropertyName = colorPropertyName;
            Palette = palette;
        }
    }

    /// <summary>
    /// 为支持四态的业务场景提供可复用视觉更新适配器。
    /// 注册阶段建立稳定标识索引并验证着色属性；更新阶段只遍历目标节点的渲染器，
    /// 全生命周期复用同一个材质属性块，禁止调用 Renderer.material 或创建运行时材质副本。
    /// </summary>
    public sealed class BusinessSceneVisualStateRegistry
    {
        private sealed class RegisteredBinding
        {
            public Renderer[] Renderers { get; }
            public int ColorPropertyId { get; }
            public BusinessSceneVisualStatePalette Palette { get; }

            public RegisteredBinding(Renderer[] renderers, int colorPropertyId, BusinessSceneVisualStatePalette palette)
            {
                Renderers = renderers;
                ColorPropertyId = colorPropertyId;
                Palette = palette;
            }
        }

        private readonly Dictionary<string, RegisteredBinding> _bindings =
            new Dictionary<string, RegisteredBinding>(StringComparer.Ordinal);

        // 渲染器只能归属一个稳定节点，避免两个业务标识交替覆盖同一对象的状态。
        private readonly Dictionary<Renderer, string> _rendererOwners = new Dictionary<Renderer, string>();

        // 材质属性块在注册表创建时只分配一次；每次状态更新先读取现有属性再覆盖目标颜色，
        // 既保留同一渲染器上其他系统写入的属性，也不产生逐次更新的托管对象或材质副本。
        private readonly MaterialPropertyBlock _reusablePropertyBlock = new MaterialPropertyBlock();
        private bool _released;

        public int RegisteredNodeCount => _bindings.Count;

        /// <summary>
        /// 原子登记一个节点：全部渲染器和材质属性验证通过后才写入索引，
        /// 防止半条映射进入运行时后造成部分模型变色、部分模型无响应。
        /// </summary>
        public BusinessSceneCommandResult Register(BusinessSceneVisualStateBinding binding)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed("scene-controller-released", "四态视觉注册表已经释放。");
            }
            if (!SceneActionProtocolValidator.IsValidSceneNodeId(binding.SceneNodeId) ||
                binding.Renderers == null ||
                binding.Renderers.Length == 0 ||
                string.IsNullOrWhiteSpace(binding.ColorPropertyName))
            {
                return BusinessSceneCommandResult.Failed("node-visual-binding-invalid", "四态视觉映射缺少合法三维节点、渲染器或着色属性。");
            }
            if (_bindings.ContainsKey(binding.SceneNodeId))
            {
                return BusinessSceneCommandResult.Failed("node-visual-binding-duplicate", $"三维节点 {binding.SceneNodeId} 重复登记四态视觉映射。");
            }

            int colorPropertyId = Shader.PropertyToID(binding.ColorPropertyName);
            HashSet<Renderer> currentRenderers = new HashSet<Renderer>();
            for (int rendererIndex = 0; rendererIndex < binding.Renderers.Length; rendererIndex++)
            {
                Renderer renderer = binding.Renderers[rendererIndex];
                if (renderer == null || !currentRenderers.Add(renderer))
                {
                    return BusinessSceneCommandResult.Failed("node-visual-renderer-invalid", $"三维节点 {binding.SceneNodeId} 包含空或重复渲染器。");
                }
                if (_rendererOwners.TryGetValue(renderer, out string ownerSceneNodeId))
                {
                    return BusinessSceneCommandResult.Failed(
                        "node-visual-renderer-conflict",
                        $"三维节点 {binding.SceneNodeId} 与 {ownerSceneNodeId} 不能共享同一四态渲染器。");
                }

                // sharedMaterials 只在一次性登记阶段读取；绝不访问会隐式克隆资源的 material 属性。
                Material[] sharedMaterials = renderer.sharedMaterials;
                if (sharedMaterials == null || sharedMaterials.Length == 0)
                {
                    return BusinessSceneCommandResult.Failed("node-visual-material-missing", $"三维节点 {binding.SceneNodeId} 的渲染器没有共享材质。");
                }
                for (int materialIndex = 0; materialIndex < sharedMaterials.Length; materialIndex++)
                {
                    Material sharedMaterial = sharedMaterials[materialIndex];
                    if (sharedMaterial == null || !sharedMaterial.HasProperty(colorPropertyId))
                    {
                        return BusinessSceneCommandResult.Failed(
                            "node-visual-property-missing",
                            $"三维节点 {binding.SceneNodeId} 的共享材质不支持已登记着色属性。");
                    }
                }
            }

            // 上方完整验证结束后再一次性提交索引，确保失败不会留下残缺登记。
            RegisteredBinding registeredBinding = new RegisteredBinding(binding.Renderers, colorPropertyId, binding.Palette);
            _bindings.Add(binding.SceneNodeId, registeredBinding);
            for (int rendererIndex = 0; rendererIndex < binding.Renderers.Length; rendererIndex++)
            {
                _rendererOwners.Add(binding.Renderers[rendererIndex], binding.SceneNodeId);
            }

            return BusinessSceneCommandResult.Completed($"三维节点 {binding.SceneNodeId} 已登记四态视觉映射。");
        }

        /// <summary>
        /// 增量更新单个已登记节点。节点不存在或渲染器已随场景卸载时返回明确错误，
        /// 不扫描全场景、不查询对象名称，也不为状态变化创建材质或新的材质属性块。
        /// </summary>
        public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
        {
            if (_released)
            {
                return BusinessSceneCommandResult.Failed("scene-controller-released", "四态视觉注册表已经释放。");
            }
            if (!SceneActionProtocolValidator.IsValidSceneNodeId(sceneNodeId) ||
                !_bindings.TryGetValue(sceneNodeId, out RegisteredBinding binding))
            {
                return BusinessSceneCommandResult.Failed("invalid-node", $"未知三维节点：{sceneNodeId}");
            }

            // 先确认全部引用仍有效，再执行颜色写入，避免场景卸载竞态导致同一节点只更新一部分渲染器。
            for (int rendererIndex = 0; rendererIndex < binding.Renderers.Length; rendererIndex++)
            {
                if (binding.Renderers[rendererIndex] == null)
                {
                    return BusinessSceneCommandResult.Failed("node-visual-renderer-unavailable", $"三维节点 {sceneNodeId} 的渲染器已经不可用。");
                }
            }

            Color targetColor = binding.Palette.Resolve(visualState);
            for (int rendererIndex = 0; rendererIndex < binding.Renderers.Length; rendererIndex++)
            {
                Renderer renderer = binding.Renderers[rendererIndex];
                _reusablePropertyBlock.Clear();
                renderer.GetPropertyBlock(_reusablePropertyBlock);
                _reusablePropertyBlock.SetColor(binding.ColorPropertyId, targetColor);
                renderer.SetPropertyBlock(_reusablePropertyBlock);
            }

            return BusinessSceneCommandResult.Completed($"三维节点 {sceneNodeId} 已更新为 {visualState} 状态。");
        }

        /// <summary>
        /// 释放时只清理登记引用和可复用属性块，不销毁共享材质，也不清除其他系统写入的渲染属性。
        /// 重复释放保持幂等，适合由当前场景控制器的统一释放流程调用。
        /// </summary>
        public void Release()
        {
            if (_released)
            {
                return;
            }

            _released = true;
            _bindings.Clear();
            _rendererOwners.Clear();
            _reusablePropertyBlock.Clear();
        }
    }
}
