Shader "自定义/URP/建筑球形扩散光圈"
{
    Properties
    {
        [HDR] _PulseColor("光圈颜色", Color) = (0, 1.2, 2.4, 1)
        _Opacity("整体透明度", Range(0, 1)) = 0.52
        _RimPower("边缘收敛指数", Range(0.5, 8)) = 2.4
        _RimIntensity("边缘光强度", Range(0, 6)) = 2.2
        _RingWidth("雷达波环带宽度", Range(0.01, 0.25)) = 0.08
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent+20" }

        Pass
        {
            Name "SphericalPulse"
            Tags { "LightMode" = "UniversalForward" }

            // 加法混合生成发光感；关闭深度写入，避免扩张球壳遮挡建筑与场景。
            Blend SrcAlpha One
            ZWrite Off
            // 关闭深度测试后，波面会穿过建筑和场景显示，换观察角度仍能看到完整雷达波；
            // 该效果只绘制发光透明边缘，不写入深度，因此不会改变场景遮挡关系。
            ZTest Always
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _PulseColor;
                half _Opacity;
                half _RimPower;
                half _RimIntensity;
                half _RingWidth;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionOS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half3 viewDirectionWS : TEXCOORD2;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positionInputs = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positionInputs.positionCS;
                output.positionOS = input.positionOS.xyz;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.viewDirectionWS = GetWorldSpaceViewDir(positionInputs.positionWS);
                return output;
            }

            half4 Frag(Varyings input, bool isFrontFace : SV_IsFrontFace) : SV_Target
            {
                // 以模型局部坐标的最低点作为雷达波基准面；球体缩放后下半部分位于地下，直接裁掉。
                clip(input.positionOS.y);

                half3 normalWS = normalize(input.normalWS);
                // 双面绘制时翻转背面法线，使相机位于扩张球内部时仍能看到连续边缘光。
                normalWS *= isFrontFace ? 1.0h : -1.0h;
                half3 viewDirectionWS = normalize(input.viewDirectionWS);
                half fresnel = pow(saturate(1.0h - abs(dot(normalWS, viewDirectionWS))), _RimPower);

                // 只保留球体赤道附近的窄带，赤道位于建筑最低点，因此形成贴地雷达波环。
                float ringCoordinate = abs(input.positionOS.y);
                float ringAA = max(fwidth(ringCoordinate), 0.0015f);
                half ring = 1.0h - smoothstep(_RingWidth, _RingWidth + ringAA, ringCoordinate);
                half intensity = ring * (0.35h + fresnel * _RimIntensity);
                half alpha = saturate(_Opacity * intensity * _PulseColor.a);
                return half4(_PulseColor.rgb * intensity, alpha);
            }
            ENDHLSL
        }
    }
}
