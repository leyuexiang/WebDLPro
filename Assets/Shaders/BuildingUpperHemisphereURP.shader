Shader "自定义/URP/建筑上半球光圈"
{
    Properties
    {
        [HDR] _UpperHemisphereColor("上半球颜色", Color) = (0, 0.85, 2.2, 1)
        _Opacity("整体透明度", Range(0, 1)) = 0.12
        _RimPower("边缘收敛指数", Range(0.5, 8)) = 2.6
        _RimIntensity("边缘光强度", Range(0, 6)) = 1.6
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent+15" }

        Pass
        {
            Name "UpperHemispherePulse"
            Tags { "LightMode" = "UniversalForward" }

            // 上半球是原始球形光圈的视觉补充。双面绘制并关闭深度测试，保证从任意视角都能看到轮廓。
            Blend SrcAlpha One
            ZWrite Off
            ZTest Always
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _UpperHemisphereColor;
                half _Opacity;
                half _RimPower;
                half _RimIntensity;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionOS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half3 viewDirectionWS : TEXCOORD2;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positionInputs = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positionInputs.positionCS;
                output.positionOS = input.positionOS.xyz;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.viewDirectionWS = GetWorldSpaceViewDir(positionInputs.positionWS);
                return output;
            }

            half4 Frag(Varyings input, bool isFrontFace : SV_IsFrontFace) : SV_Target
            {
                // 球体中心位于建筑最低点，只保留 y >= 0 的上半球。
                clip(input.positionOS.y);

                half3 normalWS = normalize(input.normalWS);
                normalWS *= isFrontFace ? 1.0h : -1.0h;
                half3 viewDirectionWS = normalize(input.viewDirectionWS);
                half fresnel = pow(saturate(1.0h - abs(dot(normalWS, viewDirectionWS))), _RimPower);
                half intensity = saturate(0.22h + fresnel * _RimIntensity);
                half alpha = saturate(_Opacity * intensity * _UpperHemisphereColor.a);
                return half4(_UpperHemisphereColor.rgb * (0.35h + intensity), alpha);
            }
            ENDHLSL
        }
    }
}
