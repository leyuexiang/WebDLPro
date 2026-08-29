Shader "自定义/URP/管内体积蒸汽"
{
    Properties
    {
        // 体积颜色与整体密度。蒸汽不依赖表面光照，使用自发光保持雾气明亮。
        [HDR] _SteamColor("蒸汽颜色", Color) = (0.82, 0.95, 1.0, 1)
        _Opacity("蒸汽密度", Range(0, 2)) = 0.32
        _Density("烟雾浓度", Range(0, 6)) = 1.25
        // 体积步进距离覆盖管径，数值越大越容易看到烟雾的层次变化。
        _RayLength("体积采样长度", Range(0.1, 12)) = 4.2
        _StepCount("体积采样步数", Range(4, 32)) = 16
        _FlowSpeed("蒸汽流速", Range(-4, 4)) = 0.75
        _NoiseScale("三维烟雾尺度", Range(0.1, 8)) = 0.82
        _Distortion("烟雾扰动", Range(0, 3)) = 1.25
        _Emission("蒸汽亮度", Range(0, 4)) = 0.35
        _FlowDirectionOS("局部流动方向", Vector) = (0, 1, 0, 0)
    }

    SubShader
    {
        // 体积层放在透明队列，并关闭深度写入；网格背面作为烟雾的视线出口。
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent+1" }

        Pass
        {
            Name "管内体积蒸汽光线步进"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            // 只绘制背向相机的表面，从管道远侧向近侧累计内部烟雾。
            Cull Front

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _SteamColor;
                half _Opacity;
                half _Density;
                half _RayLength;
                half _StepCount;
                half _FlowSpeed;
                half _NoiseScale;
                half _Distortion;
                half _Emission;
                float4 _FlowDirectionOS;
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
                float3 viewDirOS : TEXCOORD1;
            };

            // 三维哈希用于程序化体积噪声，不需要额外的三维纹理资产和纹理内存。
            float Hash31(float3 value)
            {
                value = frac(value * 0.1031);
                value += dot(value, value.yzx + 33.33);
                return frac((value.x + value.y) * value.z);
            }

            // 三维平滑值噪声：相邻采样点连续过渡，避免体积烟雾出现硬色块。
            float Noise3D(float3 value)
            {
                float3 cell = floor(value);
                float3 fraction = frac(value);
                fraction = fraction * fraction * (3.0 - 2.0 * fraction);

                float n000 = Hash31(cell + float3(0, 0, 0));
                float n100 = Hash31(cell + float3(1, 0, 0));
                float n010 = Hash31(cell + float3(0, 1, 0));
                float n110 = Hash31(cell + float3(1, 1, 0));
                float n001 = Hash31(cell + float3(0, 0, 1));
                float n101 = Hash31(cell + float3(1, 0, 1));
                float n011 = Hash31(cell + float3(0, 1, 1));
                float n111 = Hash31(cell + float3(1, 1, 1));

                float x00 = lerp(n000, n100, fraction.x);
                float x10 = lerp(n010, n110, fraction.x);
                float x01 = lerp(n001, n101, fraction.x);
                float x11 = lerp(n011, n111, fraction.x);
                float y0 = lerp(x00, x10, fraction.y);
                float y1 = lerp(x01, x11, fraction.y);
                return lerp(y0, y1, fraction.z);
            }

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positionInputs = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positionInputs.positionCS;
                output.positionOS = input.positionOS.xyz;
                // 在顶点阶段转换视线方向，片元阶段只做归一化和步进，减少重复矩阵计算。
                output.viewDirOS = TransformWorldToObjectDir(GetWorldSpaceViewDir(positionInputs.positionWS));
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float3 rayDirectionOS = normalize(input.viewDirOS);
                float3 flowDirectionOS = normalize(_FlowDirectionOS.xyz);
                float stepCount = max(4.0, _StepCount);
                float stepLength = _RayLength / stepCount;
                float time = _Time.y * _FlowSpeed;
                float transmittance = 1.0;
                float3 accumulatedColor = 0.0;

                // 固定上限保证网页图形库（WebGL）着色器可编译；材质步数决定实际采样数量。
                [loop]
                for (int stepIndex = 0; stepIndex < 32; stepIndex++)
                {
                    if (stepIndex >= stepCount)
                    {
                        break;
                    }

                    float distance = (stepIndex + 0.5) * stepLength;
                    float3 samplePositionOS = input.positionOS + rayDirectionOS * distance;
                    float3 flowOffset = flowDirectionOS * time;
                    // 使用时间变化的横向扰动，让烟团在前进时产生可见的摆动和变形，避免只像整体平移。
                    float3 lateralDistortion = float3(
                        sin(samplePositionOS.y * 1.7 + time * 1.3),
                        sin(samplePositionOS.z * 1.35 - time * 1.1),
                        cos(samplePositionOS.x * 1.45 + time * 0.9)) * (_Distortion * 0.18);
                    float3 distortedPositionOS = samplePositionOS + lateralDistortion;
                    // 两个不同频率的三维噪声分别使用正反流向，增强烟团边缘变化和连续流动感。
                    float coarseNoise = Noise3D(distortedPositionOS * _NoiseScale + flowOffset);
                    float detailNoise = Noise3D(distortedPositionOS * (_NoiseScale * 2.17) - flowOffset * 0.63);
                    float noise = saturate(coarseNoise * 0.7 + detailNoise * 0.3);
                    float density = smoothstep(0.28, 0.86, noise);
                    density *= _Density * _Opacity * 0.42;

                    // Beer-Lambert（比尔-朗伯）近似：烟雾越厚，透射光越少，层叠处自然更浓。
                    float opticalDepth = density * stepLength;
                    float sampleAlpha = 1.0 - exp(-opticalDepth);
                    accumulatedColor += transmittance * sampleAlpha * _SteamColor.rgb * (1.0 + _Emission);
                    transmittance *= 1.0 - sampleAlpha;

                    if (transmittance < 0.015)
                    {
                        break;
                    }
                }

                half alpha = saturate(1.0 - transmittance);
                return half4(accumulatedColor, alpha);
            }
            ENDHLSL
        }
    }
}
