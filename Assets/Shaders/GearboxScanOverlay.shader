Shader "WebDLPro/Gearbox Scan Overlay"
{
    Properties
    {
        _Color("Scan Color", Color) = (0.08, 0.8, 1, 1)
        _Intensity("Intensity", Range(0, 2)) = 0.35
        _ScanScale("Scan Scale", Float) = 3
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+10" "RenderType"="Transparent" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            ZTest LEqual
            Cull Back
            Offset -1, -1
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD0; float3 normalWS : TEXCOORD1; };
            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                half _Intensity;
                float _ScanScale;
            CBUFFER_END
            Varyings Vert(Attributes input)
            {
                Varyings o;
                o.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.normalWS = TransformObjectToWorldNormal(input.normalOS);
                return o;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                half rim = pow(1 - saturate(dot(normalize(input.normalWS), GetWorldSpaceNormalizeViewDir(input.positionWS))), 2.5);
                float band = frac(input.positionWS.y * _ScanScale - _Time.y * .32);
                half scan = smoothstep(.90, .96, band) * (1 - smoothstep(.975, 1, band));
                half fine = pow(saturate(sin(input.positionWS.y * _ScanScale * 70)), 12) * .08;
                return half4(_Color.rgb, saturate((rim * .65 + scan * .7 + fine) * _Intensity) * _Color.a);
            }
            ENDHLSL
        }
    }
}
