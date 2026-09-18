Shader "自定义/URP/自发光线框"
{
    Properties
    {
        [HDR] _LineColor("发光线框颜色", Color) = (0.08, 0.7, 1.0, 1.0)
        _EmissionIntensity("自发光强度", Range(0, 8)) = 2.5
        _DepthOffset("深度偏移", Range(0, 0.01)) = 0.0015
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent+10" }

        Pass
        {
            Name "EmissiveWireframe"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha One
            ZWrite Off
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _LineColor;
                half _EmissionIntensity;
                float _DepthOffset;
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
                float4 positionCS = TransformObjectToHClip(input.positionOS.xyz);

                #if UNITY_REVERSED_Z
                    positionCS.z += _DepthOffset * positionCS.w;
                #else
                    positionCS.z -= _DepthOffset * positionCS.w;
                #endif

                output.positionCS = positionCS;
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                // 使用加法混合输出高亮颜色，确保线框表现为自发光而非普通透明线。
                return half4(_LineColor.rgb * _EmissionIntensity, _LineColor.a);
            }
            ENDHLSL
        }
    }
}
