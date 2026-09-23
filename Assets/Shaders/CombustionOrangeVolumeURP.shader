Shader "自定义/URP/燃烧橘色体积"
{
    Properties
    {
        _BaseMap("底色贴图", 2D) = "white" {}
        [HDR] _BaseColor("基础颜色", Color) = (1.5, 0.12, 0.005, 1)
        [HDR] _FlowColor("燃烧流动颜色", Color) = (2.2, 0.42, 0.015, 1)
        _FlowSpeed("流动速度", Range(-5, 5)) = 0.95
        _FlowTiling("流动密度", Range(0.05, 8)) = 1.8
        _FlowWidth("流带宽度", Range(0.01, 0.95)) = 0.48
        _FlowIntensity("流动亮度", Range(0, 8)) = 3.2
        _Opacity("整体透明度", Range(0, 1)) = 0.28
    }

    SubShader
    {
        // 橘色燃烧层作为内部可视化覆盖层，即使被外部模型深度遮挡也必须显示；
        // 体积本身仍限制在 Tong 燃烧区内，不改变模型几何结构。
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent-20" }
        Pass
        {
            Name "橘色燃烧体积"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            // 内部燃烧体积需要穿过外壳和小筒显示；小筒自身改为半透明后，火焰粒子仍能保持清晰。
            ZTest Always
            Cull Back

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half4 _FlowColor;
                half _FlowSpeed;
                half _FlowTiling;
                half _FlowWidth;
                half _FlowIntensity;
                half _Opacity;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half fogFactor : TEXCOORD3;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positionInputs = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positionInputs.positionCS;
                output.positionWS = positionInputs.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                output.fogFactor = ComputeFogFactor(positionInputs.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                half4 baseSample = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv);
                half phase = frac(input.uv.y * _FlowTiling - _Time.y * _FlowSpeed);
                half wave = 1.0h - abs(phase * 2.0h - 1.0h);
                half band = smoothstep(1.0h - _FlowWidth, 1.0h, wave);
                half3 color = baseSample.rgb * _BaseColor.rgb + _FlowColor.rgb * band * _FlowIntensity;
                color = MixFog(color, input.fogFactor);
                half alpha = saturate(baseSample.a * _BaseColor.a * _Opacity + band * _Opacity * 0.55h);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
