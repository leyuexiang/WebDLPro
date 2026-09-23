using UnityEngine;
using UnityEngine.Rendering;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 三层视觉系统使用的逻辑材质属性。逻辑层只依赖这些稳定语义，
    /// 不直接把管道业务、区域业务或状态业务绑定到某一款着色器的具体属性名。
    /// </summary>
    public enum ThreeLayerMaterialLogicalProperty
    {
        Color,
        Opacity,
        PulseFrequency,
        PulseIntensity,
        EmissionIntensity,
        FlowSpeed,
        FlowDirection,
        Transition
    }

    /// <summary>
    /// 一次材质属性块更新的值集合。HasXxx 为 false 时，该属性保持当前值，
    /// 从而允许状态、流动和区域系统只修改各自负责的字段，不互相覆盖。
    /// </summary>
    public struct ThreeLayerMaterialPropertyValues
    {
        public bool HasColor;
        public Color Color;
        public bool HasOpacity;
        public float Opacity;
        public bool HasPulseFrequency;
        public float PulseFrequency;
        public bool HasPulseIntensity;
        public float PulseIntensity;
        public bool HasEmissionIntensity;
        public float EmissionIntensity;
        public bool HasFlowSpeed;
        public float FlowSpeed;
        public bool HasFlowDirection;
        public Vector4 FlowDirection;
        public bool HasTransition;
        public float Transition;

        /// <summary>只构造颜色更新，避免调用方为无关属性填充伪值。</summary>
        public static ThreeLayerMaterialPropertyValues ForColor(Color color)
        {
            return new ThreeLayerMaterialPropertyValues
            {
                HasColor = true,
                Color = color
            };
        }

        /// <summary>只构造透明度更新，适用于区域效果显示和隐藏。</summary>
        public static ThreeLayerMaterialPropertyValues ForOpacity(float opacity)
        {
            return new ThreeLayerMaterialPropertyValues
            {
                HasOpacity = true,
                Opacity = opacity
            };
        }

        /// <summary>只构造流速更新，适用于异常停流与恢复原始流速。</summary>
        public static ThreeLayerMaterialPropertyValues ForFlowSpeed(float flowSpeed)
        {
            return new ThreeLayerMaterialPropertyValues
            {
                HasFlowSpeed = true,
                FlowSpeed = flowSpeed
            };
        }
    }

    /// <summary>
    /// 单个 Renderer 材质槽的逻辑属性映射结果。
    /// 属性名候选只在初始化时解析并缓存为整数标识，运行时热路径不再查询 Shader、材质或字符串。
    /// </summary>
    public readonly struct ThreeLayerMaterialPropertyIds
    {
        public int Color { get; }
        public int Opacity { get; }
        public int PulseFrequency { get; }
        public int PulseIntensity { get; }
        public int EmissionIntensity { get; }
        public int FlowSpeed { get; }
        public int FlowDirection { get; }
        public int Transition { get; }

        public ThreeLayerMaterialPropertyIds(
            int color,
            int opacity,
            int pulseFrequency,
            int pulseIntensity,
            int emissionIntensity,
            int flowSpeed,
            int flowDirection,
            int transition)
        {
            Color = color;
            Opacity = opacity;
            PulseFrequency = pulseFrequency;
            PulseIntensity = pulseIntensity;
            EmissionIntensity = emissionIntensity;
            FlowSpeed = flowSpeed;
            FlowDirection = flowDirection;
            Transition = transition;
        }

        public bool HasAnyProperty =>
            Color != 0 ||
            Opacity != 0 ||
            PulseFrequency != 0 ||
            PulseIntensity != 0 ||
            EmissionIntensity != 0 ||
            FlowSpeed != 0 ||
            FlowDirection != 0 ||
            Transition != 0;
    }

    /// <summary>
    /// 三层材质属性块适配器。
    /// 它只修改 Renderer 当前材质槽的 MaterialPropertyBlock（材质属性块），不切换材质、
    /// 不修改渲染队列或混合模式，也不创建运行时材质副本；释放时仅清理自身缓存。
    /// </summary>
    public sealed class ThreeLayerMaterialPropertyAdapter
    {
        // 候选名属于契约适配层：不同导入材质可以使用不同命名，但上层只看到统一逻辑属性。
        private static readonly string[] ColorPropertyNames = { "_BaseColor", "_Color", "_BASE_COLOR", "_mainColor" };
        private static readonly string[] OpacityPropertyNames = { "_Opacity", "_Alpha" };
        private static readonly string[] PulseFrequencyPropertyNames = { "_PulseFrequency", "_BlinkFrequency", "_FlashFrequency" };
        private static readonly string[] PulseIntensityPropertyNames = { "_PulseIntensity", "_BlinkIntensity", "_FlashIntensity" };
        private static readonly string[] EmissionIntensityPropertyNames = { "_EmissionIntensity", "_FlowIntensity", "_EmissionPower" };
        private static readonly string[] FlowSpeedPropertyNames = { "_FlowSpeed" };
        private static readonly string[] FlowDirectionPropertyNames = { "_FlowDirectionOS", "_FlowDirection", "_Direction", "_direction" };
        private static readonly string[] TransitionPropertyNames = { "_Transition", "_TransitionValue", "_StateTransition" };

        private readonly Renderer _renderer;
        private readonly int _materialIndex;
        private readonly ThreeLayerMaterialPropertyIds _propertyIds;
        private readonly MaterialPropertyBlock _propertyBlock = new MaterialPropertyBlock();
        private readonly bool _hasColorBaseline;
        private readonly Color _colorBaseline;
        private readonly bool _hasOpacityBaseline;
        private readonly float _opacityBaseline;
        private readonly bool _hasPulseFrequencyBaseline;
        private readonly float _pulseFrequencyBaseline;
        private readonly bool _hasPulseIntensityBaseline;
        private readonly float _pulseIntensityBaseline;
        private readonly bool _hasEmissionIntensityBaseline;
        private readonly float _emissionIntensityBaseline;
        private readonly bool _hasFlowSpeedBaseline;
        private readonly float _flowSpeedBaseline;
        private readonly bool _hasFlowDirectionBaseline;
        private readonly Vector4 _flowDirectionBaseline;
        private readonly bool _hasTransitionBaseline;
        private readonly float _transitionBaseline;
        private bool _released;

        private ThreeLayerMaterialPropertyAdapter(
            Renderer renderer,
            int materialIndex,
            ThreeLayerMaterialPropertyIds propertyIds,
            MaterialPropertyBlock sourcePropertyBlock,
            Material material)
        {
            _renderer = renderer;
            _materialIndex = materialIndex;
            _propertyIds = propertyIds;
            _released = false;

            _hasColorBaseline = propertyIds.Color != 0;
            _colorBaseline = _hasColorBaseline
                ? ReadColor(sourcePropertyBlock, material, propertyIds.Color)
                : default;
            _hasOpacityBaseline = propertyIds.Opacity != 0;
            _opacityBaseline = _hasOpacityBaseline
                ? ReadFloat(sourcePropertyBlock, material, propertyIds.Opacity)
                : default;
            _hasPulseFrequencyBaseline = propertyIds.PulseFrequency != 0;
            _pulseFrequencyBaseline = _hasPulseFrequencyBaseline
                ? ReadFloat(sourcePropertyBlock, material, propertyIds.PulseFrequency)
                : default;
            _hasPulseIntensityBaseline = propertyIds.PulseIntensity != 0;
            _pulseIntensityBaseline = _hasPulseIntensityBaseline
                ? ReadFloat(sourcePropertyBlock, material, propertyIds.PulseIntensity)
                : default;
            _hasEmissionIntensityBaseline = propertyIds.EmissionIntensity != 0;
            _emissionIntensityBaseline = _hasEmissionIntensityBaseline
                ? ReadFloat(sourcePropertyBlock, material, propertyIds.EmissionIntensity)
                : default;
            _hasFlowSpeedBaseline = propertyIds.FlowSpeed != 0;
            _flowSpeedBaseline = _hasFlowSpeedBaseline
                ? ReadFloat(sourcePropertyBlock, material, propertyIds.FlowSpeed)
                : default;
            _hasFlowDirectionBaseline = propertyIds.FlowDirection != 0;
            _flowDirectionBaseline = _hasFlowDirectionBaseline
                ? ReadVector(sourcePropertyBlock, material, propertyIds.FlowDirection)
                : default;
            _hasTransitionBaseline = propertyIds.Transition != 0;
            _transitionBaseline = _hasTransitionBaseline
                ? ReadFloat(sourcePropertyBlock, material, propertyIds.Transition)
                : default;
        }

        public Renderer Renderer => _renderer;
        public int MaterialIndex => _materialIndex;
        public ThreeLayerMaterialPropertyIds PropertyIds => _propertyIds;
        public bool IsReleased => _released;

        /// <summary>
        /// 材质槽登记时缓存的原始流速。管道运行时只读该基线计算停流和倍率恢复值，
        /// 不直接读取共享材质，避免运行过程中把材质查询和业务状态耦合起来。
        /// </summary>
        public float OriginalFlowSpeed => _flowSpeedBaseline;

        /// <summary>
        /// 材质槽登记时缓存的原始颜色。区域效果优先通过颜色 Alpha（透明通道）隐藏不具备独立透明度属性的围栏材质。
        /// </summary>
        public Color OriginalColor => _colorBaseline;

        /// <summary>材质槽登记时缓存的原始透明度，区域效果隐藏时通过材质属性块恢复显示基线。</summary>
        public float OriginalOpacity => _opacityBaseline;

        /// <summary>
        /// 解析任意已登记材质提供的三层逻辑属性。壳体透明适配器通过透明材质变体本身解析颜色或透明度，
        /// 不能沿用原不透明材质的属性标识，也不能根据 Shader 名称猜测属性。
        /// </summary>
        public static bool TryResolvePropertyIds(
            Material material,
            out ThreeLayerMaterialPropertyIds propertyIds,
            out string error)
        {
            propertyIds = default;
            error = string.Empty;
            if (material == null || material.shader == null)
            {
                error = "材质属性解析缺少有效材质或 Shader。";
                return false;
            }

            propertyIds = ResolvePropertyIds(material);
            if (!propertyIds.HasAnyProperty)
            {
                error = $"材质 {material.name} 未提供三层逻辑属性。";
                return false;
            }

            return true;
        }

        /// <summary>
        /// 为指定材质槽建立适配器。所有材质和属性验证只发生一次，失败不会产生半初始化对象。
        /// </summary>
        public static bool TryCreate(
            Renderer renderer,
            int materialIndex,
            out ThreeLayerMaterialPropertyAdapter adapter,
            out string error)
        {
            adapter = null;
            error = string.Empty;
            if (renderer == null || materialIndex < 0)
            {
                error = "材质属性块适配器缺少合法渲染器或材质槽。";
                return false;
            }

            Material[] sharedMaterials = renderer.sharedMaterials;
            if (sharedMaterials == null || materialIndex >= sharedMaterials.Length || sharedMaterials[materialIndex] == null)
            {
                error = "材质属性块适配器找不到目标材质槽。";
                return false;
            }

            Material material = sharedMaterials[materialIndex];
            if (!TryResolvePropertyIds(material, out ThreeLayerMaterialPropertyIds propertyIds, out error))
            {
                return false;
            }

            MaterialPropertyBlock sourcePropertyBlock = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(sourcePropertyBlock, materialIndex);
            adapter = new ThreeLayerMaterialPropertyAdapter(
                renderer,
                materialIndex,
                propertyIds,
                sourcePropertyBlock,
                material);
            return true;
        }

        /// <summary>
        /// 按值集合增量写入当前属性块；未声明的逻辑属性保持原值，避免多系统互相覆盖。
        /// </summary>
        public bool Apply(ThreeLayerMaterialPropertyValues values)
        {
            if (_released || _renderer == null)
            {
                return false;
            }

            _renderer.GetPropertyBlock(_propertyBlock, _materialIndex);
            if (values.HasColor && _propertyIds.Color != 0)
            {
                _propertyBlock.SetColor(_propertyIds.Color, values.Color);
            }
            if (values.HasOpacity && _propertyIds.Opacity != 0)
            {
                _propertyBlock.SetFloat(_propertyIds.Opacity, values.Opacity);
            }
            if (values.HasPulseFrequency && _propertyIds.PulseFrequency != 0)
            {
                _propertyBlock.SetFloat(_propertyIds.PulseFrequency, values.PulseFrequency);
            }
            if (values.HasPulseIntensity && _propertyIds.PulseIntensity != 0)
            {
                _propertyBlock.SetFloat(_propertyIds.PulseIntensity, values.PulseIntensity);
            }
            if (values.HasEmissionIntensity && _propertyIds.EmissionIntensity != 0)
            {
                _propertyBlock.SetFloat(_propertyIds.EmissionIntensity, values.EmissionIntensity);
            }
            if (values.HasFlowSpeed && _propertyIds.FlowSpeed != 0)
            {
                _propertyBlock.SetFloat(_propertyIds.FlowSpeed, values.FlowSpeed);
            }
            if (values.HasFlowDirection && _propertyIds.FlowDirection != 0)
            {
                _propertyBlock.SetVector(_propertyIds.FlowDirection, values.FlowDirection);
            }
            if (values.HasTransition && _propertyIds.Transition != 0)
            {
                _propertyBlock.SetFloat(_propertyIds.Transition, values.Transition);
            }

            _renderer.SetPropertyBlock(_propertyBlock, _materialIndex);
            return true;
        }

        /// <summary>
        /// 恢复登记时的逻辑属性基线，同时保留其它系统写入的非契约属性。
        /// </summary>
        public bool Restore()
        {
            if (_released || _renderer == null)
            {
                return false;
            }

            _renderer.GetPropertyBlock(_propertyBlock, _materialIndex);
            if (_hasColorBaseline)
            {
                _propertyBlock.SetColor(_propertyIds.Color, _colorBaseline);
            }
            if (_hasOpacityBaseline)
            {
                _propertyBlock.SetFloat(_propertyIds.Opacity, _opacityBaseline);
            }
            if (_hasPulseFrequencyBaseline)
            {
                _propertyBlock.SetFloat(_propertyIds.PulseFrequency, _pulseFrequencyBaseline);
            }
            if (_hasPulseIntensityBaseline)
            {
                _propertyBlock.SetFloat(_propertyIds.PulseIntensity, _pulseIntensityBaseline);
            }
            if (_hasEmissionIntensityBaseline)
            {
                _propertyBlock.SetFloat(_propertyIds.EmissionIntensity, _emissionIntensityBaseline);
            }
            if (_hasFlowSpeedBaseline)
            {
                _propertyBlock.SetFloat(_propertyIds.FlowSpeed, _flowSpeedBaseline);
            }
            if (_hasFlowDirectionBaseline)
            {
                _propertyBlock.SetVector(_propertyIds.FlowDirection, _flowDirectionBaseline);
            }
            if (_hasTransitionBaseline)
            {
                _propertyBlock.SetFloat(_propertyIds.Transition, _transitionBaseline);
            }

            _renderer.SetPropertyBlock(_propertyBlock, _materialIndex);
            return true;
        }

        /// <summary>释放适配器自身缓存；不触碰共享材质与 Renderer 的当前属性块。</summary>
        public void Release()
        {
            if (_released)
            {
                return;
            }

            _released = true;
            _propertyBlock.Clear();
        }

        private static ThreeLayerMaterialPropertyIds ResolvePropertyIds(Material material)
        {
            return new ThreeLayerMaterialPropertyIds(
                ResolvePropertyId(material, ColorPropertyNames, ShaderPropertyType.Color),
                ResolvePropertyId(material, OpacityPropertyNames, ShaderPropertyType.Float),
                ResolvePropertyId(material, PulseFrequencyPropertyNames, ShaderPropertyType.Float),
                ResolvePropertyId(material, PulseIntensityPropertyNames, ShaderPropertyType.Float),
                ResolvePropertyId(material, EmissionIntensityPropertyNames, ShaderPropertyType.Float),
                ResolvePropertyId(material, FlowSpeedPropertyNames, ShaderPropertyType.Float),
                ResolvePropertyId(material, FlowDirectionPropertyNames, ShaderPropertyType.Vector),
                ResolvePropertyId(material, TransitionPropertyNames, ShaderPropertyType.Float));
        }

        private static int ResolvePropertyId(Material material, string[] propertyNames, ShaderPropertyType expectedType)
        {
            Shader shader = material.shader;
            for (int nameIndex = 0; nameIndex < propertyNames.Length; nameIndex++)
            {
                string propertyName = propertyNames[nameIndex];
                for (int propertyIndex = 0; propertyIndex < shader.GetPropertyCount(); propertyIndex++)
                {
                    if (!string.Equals(shader.GetPropertyName(propertyIndex), propertyName, System.StringComparison.Ordinal) ||
                        !IsCompatiblePropertyType(shader.GetPropertyType(propertyIndex), expectedType))
                    {
                        continue;
                    }

                    return Shader.PropertyToID(propertyName);
                }
            }

            return 0;
        }

        /// <summary>只接受与逻辑属性匹配的 Shader 类型，避免把 Vector 速度误当成 Float 流速。</summary>
        private static bool IsCompatiblePropertyType(ShaderPropertyType actualType, ShaderPropertyType expectedType)
        {
            if (expectedType == ShaderPropertyType.Float)
            {
                return actualType == ShaderPropertyType.Float || actualType == ShaderPropertyType.Range;
            }

            return actualType == expectedType;
        }

        private static Color ReadColor(MaterialPropertyBlock propertyBlock, Material material, int propertyId)
        {
            return propertyBlock.HasColor(propertyId) ? propertyBlock.GetColor(propertyId) : material.GetColor(propertyId);
        }

        private static float ReadFloat(MaterialPropertyBlock propertyBlock, Material material, int propertyId)
        {
            return propertyBlock.HasFloat(propertyId) ? propertyBlock.GetFloat(propertyId) : material.GetFloat(propertyId);
        }

        private static Vector4 ReadVector(MaterialPropertyBlock propertyBlock, Material material, int propertyId)
        {
            return propertyBlock.HasVector(propertyId) ? propertyBlock.GetVector(propertyId) : material.GetVector(propertyId);
        }
    }
}
