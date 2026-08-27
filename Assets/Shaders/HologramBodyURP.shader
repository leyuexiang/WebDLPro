Shader "自定义/URP/全息半透明"
{
    Properties
    {
        _BaseColor("本体颜色", Color) = (0.24, 0.68, 1.0, 1)
        _RimColor("边缘光颜色", Color) = (0.55, 0.9, 1.0, 1)
        _Opacity("本体透明度", Range(0, 1)) = 0.16
        _RimPower("边缘光收敛指数", Range(0.5, 8)) = 2.6
        _RimIntensity("边缘光强度", Range(0, 4)) = 1.6
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent" }

        Pass
        {
            Name "HologramBody"
            Tags { "LightMode" = "UniversalForward" }
            // 叠加混合让重叠面自然增亮，形成通透的体积感；关闭深度写入避免自遮挡产生硬边。
            Blend SrcAlpha One
            ZWrite Off
            Cull Back

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _RimColor;
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
                float3 normalWS : TEXCOORD0;
                float3 viewDirWS : TEXCOORD1;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positionInputs = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positionInputs.positionCS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.viewDirWS = GetWorldSpaceViewDir(positionInputs.positionWS);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float3 normalWS = normalize(input.normalWS);
                float3 viewDirWS = normalize(input.viewDirWS);

                // Fresnel 边缘光：正对视线的面近乎透明，掠射面高亮，勾勒出体积轮廓。
                half fresnel = pow(saturate(1.0h - abs(dot(normalWS, viewDirWS))), _RimPower);
                half3 color = _BaseColor.rgb + _RimColor.rgb * (fresnel * _RimIntensity);
                half alpha = saturate(_Opacity + fresnel * _RimIntensity * _RimColor.a);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
