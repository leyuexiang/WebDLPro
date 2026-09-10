Shader "Custom/URP/Coal Shaft Energy"
{
    Properties
    {
        [HDR] _BaseColor("Energy Colour", Color) = (2.4, 0.2, 0.12, 1)
        _Opacity("Opacity", Range(0, 1)) = 0.4
        [Toggle] _SoftEdges("Soft Line Edges", Float) = 1
        [Toggle] _SurfaceMode("Rotor Surface Overlay", Float) = 0
        _AnimationTime("Animation Time", Float) = 0
        [Toggle] _AxialGradient("Axial Surface Gradient", Float) = 0
        [HDR] _CentreColor("Centre Colour", Color) = (4, 0.9, 0.65, 1)
        _AxialHalfLength("Axial Half Length", Float) = 1
        _AxialCentre("Axial Centre", Float) = 0
        _EndBrightness("End Brightness", Range(0, 1)) = 0.34
        _CentreWidth("Centre Width", Range(0.1, 1)) = 0.65
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Transparent" "Queue"="Transparent+40" }
        Pass
        {
            Name "ShaftEnergy"
            Tags { "LightMode"="UniversalForward" }
            Blend One One
            ZWrite Off
            ZTest LEqual
            Cull Off
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half _Opacity;
                half _SoftEdges;
                half _SurfaceMode;
                float _AnimationTime;
                half _AxialGradient;
                half4 _CentreColor;
                float _AxialHalfLength;
                float _AxialCentre;
                half _EndBrightness;
                half _CentreWidth;
            CBUFFER_END
            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                float axial : TEXCOORD3;
            };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                float3 position = input.positionOS.xyz + input.normalOS * (0.004 * _SurfaceMode);
                output.positionWS = TransformObjectToWorld(position);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.uv = input.uv;
                output.axial = input.positionOS.x;
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                half intensity = 1;
                if (_SurfaceMode > 0.5h)
                {
                    half facing = abs(dot(normalize(input.normalWS), GetWorldSpaceNormalizeViewDir(input.positionWS)));
                    half rim = pow(1 - facing, 2.5h);
                    half band = pow(saturate(0.5h + 0.5h * sin(input.axial * 10 - _AnimationTime * 4)), 10);
                    intensity = 0.12h + rim * 0.65h + band * 0.24h;
                }
                else if (_SoftEdges > 0.5h)
                {
                    half crossSection = saturate(1 - abs(input.uv.y * 2 - 1));
                    intensity = pow(crossSection, 1.6h);
                }
                half3 colour = _BaseColor.rgb;
                if (_SurfaceMode > 0.5h && _AxialGradient > 0.5h)
                {
                    float distanceFromCentre = abs(input.axial - _AxialCentre) / max(_AxialHalfLength, 0.001);
                    half centreWeight = 1 - smoothstep(0, max(_CentreWidth, 0.1h), distanceFromCentre);
                    colour = lerp(_BaseColor.rgb * _EndBrightness, _CentreColor.rgb, centreWeight);
                }
                return half4(colour * _Opacity * intensity, 0);
            }
            ENDHLSL
        }
    }
}
