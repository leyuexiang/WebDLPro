Shader "Custom/URP/Control Circuit Electron Flow"
{
    Properties
    {
        [HDR] _BaseColor("线路底光", Color) = (0.005, 0.09, 0.25, 1)
        [HDR] _FlowColor("电子拖尾颜色", Color) = (0.015, 1.1, 2.8, 1)
        [HDR] _HeadColor("电子亮点颜色", Color) = (1.5, 3, 3.5, 1)
        _Opacity("整体强度", Range(0, 1)) = 0.85
        _FlowSpeed("流速（米/秒，负数反向）", Float) = 3
        _Spacing("脉冲间距（米）", Range(0.5, 12)) = 5
        _TailLength("拖尾长度（米）", Range(0.1, 4)) = 1.3
        _HeadLength("亮点长度（米）", Range(0.02, 0.8)) = 0.16
        _SurfaceOffset("线路外扩", Range(0, 0.1)) = 0.028
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Transparent" "Queue"="Transparent+35" }
        Pass
        {
            Name "ElectronFlow"
            Tags { "LightMode"="UniversalForward" }
            Blend One One
            ZWrite Off
            ZTest LEqual
            Cull Back
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _FlowColor;
                half4 _HeadColor;
                half _Opacity;
                float _FlowSpeed;
                float _Spacing;
                float _TailLength;
                float _HeadLength;
                float _SurfaceOffset;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                // UV1.x is cumulative route length; UV1.y staggers the six circuits.
                float2 route : TEXCOORD1;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 route : TEXCOORD2;
            };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                float3 position = input.positionOS.xyz + input.normalOS * _SurfaceOffset;
                output.positionWS = TransformObjectToWorld(position);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.route = input.route;
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                float spacing = max(_Spacing, 0.01);
                float direction = _FlowSpeed < 0 ? -1 : 1;
                // Distance behind the travelling head, measured along the actual bent cable.
                float behind = frac((_Time.y * abs(_FlowSpeed) - input.route.x * direction) / spacing
                    + input.route.y) * spacing;
                float tailLength = min(_TailLength, spacing * 0.85);
                float aa = max(fwidth(input.route.x), 0.015);
                float tail = pow(saturate(1 - behind / max(tailLength, 0.01)), 1.8);
                float head = 1 - smoothstep(_HeadLength, _HeadLength + aa, behind);
                half facing = saturate(abs(dot(normalize(input.normalWS), GetWorldSpaceNormalizeViewDir(input.positionWS))));
                half rounded = 0.45h + 0.55h * sqrt(facing);
                half3 emission = _BaseColor.rgb + _FlowColor.rgb * tail + _HeadColor.rgb * head;
                return half4(emission * rounded * _Opacity, 0);
            }
            ENDHLSL
        }
    }
}
