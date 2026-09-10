Shader "WebDLPro/Hologram Floor Surface"
{
    Properties
    {
        _BaseColor("Blue tint / opacity", Color) = (0.025, 0.1, 0.32, 0.62)
        [HDR] _LineColor("Grid and border glow", Color) = (0.1, 0.6, 1.4, 1)
        _GridSpacing("Grid spacing", Float) = 4
        _GridStrength("Grid strength", Range(0,1)) = 0.12
        _BorderWidth("Border width", Float) = 0.065
        _Bounds("Local XY centre and half extents", Vector) = (0,0,38.27,19.48)
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Transparent" "Queue"="Transparent" }
        Pass
        {
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            CBUFFER_START(UnityPerMaterial)
            half4 _BaseColor, _LineColor;
            float _GridSpacing, _GridStrength, _BorderWidth;
            float4 _Bounds;
            CBUFFER_END
            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 localXY : TEXCOORD0; };
            Varyings Vert(Attributes v)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.localXY = v.positionOS.xy;
                return o;
            }
            half4 Frag(Varyings i) : SV_Target
            {
                float2 xy = i.localXY - _Bounds.xy;
                float2 cell = xy / max(_GridSpacing, 0.01);
                float2 dist = abs(frac(cell - 0.5) - 0.5) / max(fwidth(cell), 0.0001);
                float grid = 1 - saturate(min(dist.x, dist.y));
                float edgeDist = min(_Bounds.z - abs(xy.x), _Bounds.w - abs(xy.y));
                float aa = max(fwidth(edgeDist), 0.001);
                float edge = 1 - smoothstep(_BorderWidth, _BorderWidth + aa, edgeDist);
                float lines = max(edge, grid * _GridStrength);
                return half4(_BaseColor.rgb + _LineColor.rgb * lines, saturate(_BaseColor.a + edge * 0.3));
            }
            ENDHLSL
        }
    }
}
