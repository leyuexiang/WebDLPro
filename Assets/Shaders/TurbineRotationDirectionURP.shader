Shader "自定义/URP/汽轮机旋转方向"
{
    Properties
    {
        [HDR] _BaseColor("方向提示颜色", Color) = (0, 2.2, 6, 1)
        _Opacity("方向提示透明度", Range(0, 1)) = 0.92
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent+50" }

        Pass
        {
            Name "TurbineRotationDirection"
            Tags { "LightMode" = "UniversalForward" }
            Blend One One
            ZWrite Off
            ZTest Always
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half _Opacity;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                return half4(_BaseColor.rgb * _Opacity, 1.0h);
            }
            ENDHLSL
        }
    }
}
