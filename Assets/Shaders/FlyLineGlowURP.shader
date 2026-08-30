Shader "自定义/URP/飞线信号亮点"
{
    Properties
    {
        [HDR] _GlowColor("信号亮点颜色", Color) = (0.1, 0.75, 2.2, 1)
        _GlowSpeed("亮点移动速度", Range(-10, 10)) = 2.4
        _GlowTiling("亮点宽度控制", Range(0.1, 20)) = 3.8
        _GlowWidth("亮点柔和范围", Range(0.005, 0.5)) = 0.025
        _GlowIntensity("亮点亮度", Range(0, 12)) = 3.5
        _GlowOpacity("亮点透明度", Range(0, 1)) = 0.75
        _GlowPhase("错峰相位", Range(-1, 1)) = 0
        _GlowBase("细线基础发光", Range(0, 2)) = 0.12
    }

    SubShader
    {
        // 加法混合只增加亮度，不写入深度；整条线保持低亮度，只有一个脉冲亮点沿 UV 移动。
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent" }

        Pass
        {
            Name "飞线信号亮点"
            Tags { "LightMode" = "UniversalForward" }
            Blend One One
            ZWrite Off
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _GlowColor;
                half _GlowSpeed;
                half _GlowTiling;
                half _GlowWidth;
                half _GlowIntensity;
                half _GlowOpacity;
                half _GlowPhase;
                half _GlowBase;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformWorldToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                // LineRenderer（线渲染器）在 Stretch（拉伸）模式下提供 0 到 1 的路径坐标，亮点只沿整条线循环一次。
                float pathPosition = saturate(input.uv.x);
                float pointPosition = frac(_Time.y * _GlowSpeed + _GlowPhase);
                float distanceToPoint = abs(pathPosition - pointPosition);
                distanceToPoint = min(distanceToPoint, 1.0 - distanceToPoint);

                // 使用宽度控制值生成一个窄而柔和的单点；不再使用周期条带，因此不会出现多条粗亮带。
                float pointWidth = max(0.008, min(0.12, 0.08 / max(_GlowTiling, 0.1)));
                float signalPoint = exp(-pow(distanceToPoint / pointWidth, 2.0) * 2.2);
                float softSignalPoint = exp(-pow(distanceToPoint / (pointWidth * 2.6), 2.0) * 2.2) * 0.22;
                float intensity = (_GlowBase + (signalPoint + softSignalPoint) * _GlowIntensity) * _GlowOpacity;
                return half4(_GlowColor.rgb * intensity, 1.0);
            }
            ENDHLSL
        }
    }
}
