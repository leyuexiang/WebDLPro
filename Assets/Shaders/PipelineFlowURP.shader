Shader "自定义/URP/管道流动"
{
    Properties
    {
        // 以下三项与 URP 标准金属材质命名一致，可直接复用原管道的底色、法线和金属度贴图。
        _BaseMap("原始底色贴图", 2D) = "white" {}
        _BaseColor("基础颜色", Color) = (1, 1, 1, 1)
        [Toggle(_NORMALMAP)] _NormalMapEnabled("使用原始法线贴图", Float) = 0
        _BumpMap("原始法线贴图", 2D) = "bump" {}
        _BumpScale("法线强度", Range(0, 2)) = 1
        [Toggle(_METALLICSPECGLOSSMAP)] _MetallicGlossMapEnabled("使用金属度光滑度贴图", Float) = 0
        _MetallicGlossMap("金属度光滑度贴图", 2D) = "white" {}
        _Metallic("金属度", Range(0, 1)) = 0.75
        _Smoothness("光滑度", Range(0, 1)) = 0.45
        // 控制整条管道的最终透明度；1 为完全不透明，0 为完全透明。
        _Opacity("整体透明度", Range(0, 1)) = 1

        // 灰度流动纹理仅影响自发光遮罩，不会覆盖原始管壁贴图；未配置时仍使用程序化条带显示流向。
        _FlowTex("流动扰动纹理", 2D) = "white" {}
        [HDR] _FlowColor("流动颜色", Color) = (0, 0.85, 1, 1)
        _FlowTiling("轴向平铺", Range(0.1, 30)) = 5
        _FlowSpeed("流动速度", Range(-10, 10)) = 0.8
        _FlowWidth("条带宽度", Range(0.01, 0.95)) = 0.2
        _FlowContrast("纹理对比度", Range(0.1, 4)) = 1.25
        _FlowIntensity("流动亮度", Range(0, 8)) = 1.2
        _FlowAxis("流动轴 (0=U, 1=V)", Range(0, 1)) = 1
        _Spiral("环绕偏移", Range(-3, 3)) = 0.12
    }

    SubShader
    {
        // 透明物体必须进入透明渲染队列，并关闭深度写入；否则半透明管道会遮挡其后的物体。
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent" }

        Pass
        {
            Name "前向渲染"
            Tags { "LightMode" = "UniversalForward" }
            // 使用常规透明混合，让材质面板中的整体透明度直接作用于最终画面。
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma shader_feature_local_fragment _NORMALMAP
            #pragma shader_feature_local_fragment _METALLICSPECGLOSSMAP
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _SHADOWS_SOFT
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                // 统一材质常量缓冲区，保持与 SRP 批处理器兼容，避免同类管道产生额外批次。
                float4 _BaseMap_ST;
                float4 _FlowTex_ST;
                half4 _BaseColor;
                half4 _FlowColor;
                half _BumpScale;
                half _Metallic;
                half _Smoothness;
                half _Opacity;
                half _FlowTiling;
                half _FlowSpeed;
                half _FlowWidth;
                half _FlowContrast;
                half _FlowIntensity;
                half _FlowAxis;
                half _Spiral;
            CBUFFER_END

            TEXTURE2D(_BaseMap);          SAMPLER(sampler_BaseMap);
            TEXTURE2D(_BumpMap);          SAMPLER(sampler_BumpMap);
            TEXTURE2D(_MetallicGlossMap); SAMPLER(sampler_MetallicGlossMap);
            TEXTURE2D(_FlowTex);          SAMPLER(sampler_FlowTex);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float4 tangentOS : TANGENT;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half3 tangentWS : TEXCOORD2;
                half3 bitangentWS : TEXCOORD3;
                float2 baseUV : TEXCOORD4;
                float2 flowUV : TEXCOORD5;
                half fogFactor : TEXCOORD6;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positionInputs = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normalInputs = GetVertexNormalInputs(input.normalOS, input.tangentOS);

                // 同时保留原贴图与流动纹理的独立平铺参数，避免为流动效果破坏原管壁贴图比例。
                output.positionCS = positionInputs.positionCS;
                output.positionWS = positionInputs.positionWS;
                output.normalWS = normalInputs.normalWS;
                output.tangentWS = normalInputs.tangentWS;
                output.bitangentWS = normalInputs.bitangentWS;
                output.baseUV = TRANSFORM_TEX(input.uv, _BaseMap);
                output.flowUV = TRANSFORM_TEX(input.uv, _FlowTex);
                output.fogFactor = ComputeFogFactor(positionInputs.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                // 原始底色始终参与 PBR 光照，流动层只写入 emission，不会遮住喷漆、锈蚀与编号细节。
                half4 baseSample = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.baseUV);
                SurfaceData surfaceData;
                surfaceData.albedo = baseSample.rgb * _BaseColor.rgb;
                // 叠乘贴图、基础颜色和材质透明度，保留原贴图透明通道并支持独立调节。
                surfaceData.alpha = saturate(baseSample.a * _BaseColor.a * _Opacity);
                surfaceData.specular = 0.0h;
                surfaceData.occlusion = 1.0h;
                surfaceData.clearCoatMask = 0.0h;
                surfaceData.clearCoatSmoothness = 0.0h;

                #if defined(_NORMALMAP)
                    // 仅在材质启用法线贴图时采样，普通管道不会承担这一次纹理采样开销。
                    surfaceData.normalTS = UnpackNormalScale(SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, input.baseUV), _BumpScale);
                #else
                    surfaceData.normalTS = half3(0.0h, 0.0h, 1.0h);
                #endif

                #if defined(_METALLICSPECGLOSSMAP)
                    // 按标准约定读取红色通道为金属度、透明度通道为光滑度。
                    half4 metallicGloss = SAMPLE_TEXTURE2D(_MetallicGlossMap, sampler_MetallicGlossMap, input.baseUV);
                    surfaceData.metallic = metallicGloss.r * _Metallic;
                    surfaceData.smoothness = metallicGloss.a * _Smoothness;
                #else
                    surfaceData.metallic = _Metallic;
                    surfaceData.smoothness = _Smoothness;
                #endif

                // 插值选择 U 或 V 为管长方向；速度正负分别代表正向与反向，避免运行时脚本修改网格。
                half flowAxis = lerp(input.flowUV.x, input.flowUV.y, _FlowAxis);
                half sideAxis = lerp(input.flowUV.y, input.flowUV.x, _FlowAxis);
                half phase = frac(flowAxis * _FlowTiling - _Time.y * _FlowSpeed + sideAxis * _Spiral);
                half triangleWave = 1.0h - abs(phase * 2.0h - 1.0h);
                half proceduralBand = smoothstep(1.0h - _FlowWidth, 1.0h, triangleWave);
                half textureNoise = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, float2(phase, sideAxis)).r;
                half flowMask = proceduralBand * pow(saturate(textureNoise), _FlowContrast);
                surfaceData.emission = _FlowColor.rgb * flowMask * _FlowIntensity;

                // 调用 URP 内置 PBR 光照，完整保留主光、附加光、阴影、反射探针与雾效。
                InputData inputData;
                inputData.positionWS = input.positionWS;
                inputData.positionCS = input.positionCS;
                inputData.viewDirectionWS = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                // 同一切线矩阵既用于法线贴图转换，也写入输入数据，确保调试显示路径读取到完整数据。
                half3x3 tangentToWorld = half3x3(input.tangentWS, input.bitangentWS, input.normalWS);
                inputData.tangentToWorld = tangentToWorld;
                inputData.normalWS = NormalizeNormalPerPixel(TransformTangentToWorld(surfaceData.normalTS, tangentToWorld));
                inputData.shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                inputData.fogCoord = input.fogFactor;
                inputData.vertexLighting = half3(0.0h, 0.0h, 0.0h);
                inputData.bakedGI = SampleSH(inputData.normalWS);
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS);
                inputData.shadowMask = half4(1.0h, 1.0h, 1.0h, 1.0h);

                return UniversalFragmentPBR(inputData, surfaceData);
            }
            ENDHLSL
        }

        // 透明物体不复用不透明阴影和深度通道，避免出现“看起来透明、但仍完全遮挡或投射实心阴影”的问题。
    }
}
