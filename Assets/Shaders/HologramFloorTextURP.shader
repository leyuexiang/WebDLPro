Shader "WebDLPro/Hologram Floor Text"
{
    Properties
    {
        _MainTex("字体图集", 2D) = "white" {}
        _Color("发光颜色", Color) = (0.2, 0.8, 1, 1)
        _Intensity("发光强度", Range(0, 8)) = 3
        _Softness("边缘柔和度", Range(0.001, 0.2)) = 0.04
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+30" "RenderType"="Transparent" }
        Pass
        {
            Name "FloorTextEmission"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha One
            ZWrite Off
            ZTest LEqual
            Cull Off
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                half4 _Color;
                half _Intensity;
                half _Softness;
            CBUFFER_END
            struct Attributes { float4 positionOS:POSITION; float2 uv:TEXCOORD0; half4 color:COLOR; };
            struct Varyings { float4 positionCS:SV_POSITION; float2 uv:TEXCOORD0; half4 color:COLOR; };
            Varyings Vert(Attributes input) { Varyings o; o.positionCS=TransformObjectToHClip(input.positionOS.xyz); o.uv=TRANSFORM_TEX(input.uv,_MainTex); o.color=input.color; return o; }
            half4 Frag(Varyings input):SV_Target
            {
                half glyph=SAMPLE_TEXTURE2D(_MainTex,sampler_MainTex,input.uv).a;
                half alpha=saturate(glyph*input.color.a);
                return half4(_Color.rgb*_Intensity*input.color.rgb, alpha);
            }
            ENDHLSL
        }
    }
}
