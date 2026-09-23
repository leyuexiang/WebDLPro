Shader "自定义/URP/控制阀气体体积"
{
    Properties
    {
        [HDR] _GasColor("气体颜色", Color) = (0.05, 0.65, 1.6, 1)
        _Opacity("气体透明度", Range(0, 1)) = 0.34
        _FlowSpeed("内部流速", Range(-5, 5)) = 1.2
        _FlowScale("流动纹理密度", Range(0.5, 12)) = 4
        _EdgeGlow("边缘辉光", Range(0, 4)) = 1.35
        _FillAmount("填充度", Range(0, 1)) = 1
        _FillLength("轴向长度", Float) = 0.76
        _FillBottom("轴向底部", Float) = -0.38
    }

    SubShader
    {
        // 气体先于透明外壳绘制，但仍接受场景深度测试，避免透过不透明阀芯和其它模型显示。
        Tags
        {
            "RenderPipeline" = "UniversalPipeline"
            "RenderType" = "Transparent"
            "Queue" = "Transparent-10"
        }

        Pass
        {
            Name "气体体积"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _GasColor;
                half _Opacity;
                half _FlowSpeed;
                half _FlowScale;
                half _EdgeGlow;
                half _FillAmount;
                half _FillLength;
                half _FillBottom;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float3 positionOS : TEXCOORD2;
                half fogFactor : TEXCOORD3;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positionInputs = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positionInputs.positionCS;
                output.positionWS = positionInputs.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.positionOS = input.positionOS.xyz;
                output.fogFactor = ComputeFogFactor(positionInputs.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                // 气体网格沿本地 Z 轴从底部向顶部生成；直接丢弃液面以上片元，
                // 使任意填充度都保留按阀体内壁生成的完整截面，而不是缩放压扁整个网格。
                half fillHeight = _FillBottom + saturate(_FillAmount) * max(_FillLength, 0.001h);
                clip(fillHeight - input.positionOS.z);

                half3 viewDirectionWS = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                half fresnel = pow(1.0h - saturate(abs(dot(normalize(input.normalWS), viewDirectionWS))), 2.0h);

                // 两组不同频率的正弦波形成向上流动的柔和密度变化，无需噪声纹理采样，适合网页端运行。
                half primaryWave = 0.5h + 0.5h * sin(
                    (input.positionOS.z * _FlowScale - _Time.y * _FlowSpeed) * 6.28318h
                    + input.positionOS.x * 3.5h);
                half secondaryWave = 0.5h + 0.5h * sin(
                    (input.positionOS.z * (_FlowScale * 0.47h) - _Time.y * (_FlowSpeed * 0.63h)) * 6.28318h
                    - input.positionOS.y * 5.0h);
                half density = 0.42h + primaryWave * 0.18h + secondaryWave * 0.16h;

                // 低填充度时同步降低整体密度，使气体刚进入腔体时不会突然出现一整块高亮体积。
                half fillVisibility = lerp(0.35h, 1.0h, saturate(_FillAmount));
                half alpha = saturate(_Opacity * fillVisibility * (density + fresnel * 0.7h));
                half3 color = _GasColor.rgb * (density + fresnel * _EdgeGlow);
                color = MixFog(color, input.fogFactor);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
