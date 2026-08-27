Shader "自定义/URP/特征边线框"
{
    Properties
    {
        _LineColor("线框颜色", Color) = (0.6, 0.92, 1.0, 0.85)
        _DepthOffset("深度偏移", Range(0, 0.01)) = 0.0008
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent+10" }

        Pass
        {
            Name "FeatureEdgeLines"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            // 线框需要显示在本体之上但仍受场景遮挡，因此保留深度测试并做微量前移。
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _LineColor;
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

                // 在裁剪空间沿深度方向前移，避免与本体表面共面产生深度冲突闪烁。
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
                return _LineColor;
            }
            ENDHLSL
        }
    }
}
