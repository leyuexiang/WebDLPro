// 基于 GuanDao.shader 创建的独立副本。
// 在保留双纹理流动效果的基础上，将可调半透明底色直接合成到同一前向渲染通道，避免额外绘制通道。
Shader "LYDS/GuanDaoWithBase"
{
    Properties
    {
        _Texture("Texture", 2D) = "white" {}
        _Texture2("Texture2", 2D) = "white" {}
        _Color("Color", Color) = (1,1,1,0)
        _ColorS("ColorS", Float) = 1
        _Speed("Speed", Vector) = (0,-0.2,0,0)
        _Speed2("Speed2", Vector) = (0,-0.2,0,0)
        _FlowSpeed("Flow Speed", Float) = 1
        _MaskUV("MaskUV", Vector) = (1,1,0,0)
        _MaskUV2("MaskUV2", Vector) = (1,1,0,0)
        _Color2("Color2", Color) = (1,1,1,0)
        _Color2S("Color2S", Float) = 1
        _DE2("DE2", Float) = 0
        _UVRotation("纹理旋转角度", Range(-180, 180)) = 0

        // 底色的 RGB 控制颜色，Alpha 会与“底色透明度”相乘，便于统一淡入淡出。
        _BaseColor("底色", Color) = (0.05,0.15,0.2,1)
        _BaseOpacity("底色透明度", Range(0, 1)) = 0.25
    }

    SubShader
    {
        LOD 0
        Tags
        {
            "RenderPipeline"="UniversalPipeline"
            "RenderType"="Transparent"
            "Queue"="Transparent"
        }

        Cull Back

        Pass
        {
            Name "Forward"
            Tags { "LightMode"="UniversalForward" }

            Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
            ZWrite Off
            ZTest LEqual
            ColorMask RGBA

            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_fog
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile _ _SHADOWS_SOFT
            #pragma multi_compile _ _MIXED_LIGHTING_SUBTRACTIVE
            #pragma multi_compile _ DIRLIGHTMAP_COMBINED
            #pragma multi_compile _ LIGHTMAP_ON
            #pragma prefer_hlslcc gles
            #pragma exclude_renderers d3d11_9x

            #define _EMISSION

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/UnityInstancing.hlsl"

            sampler2D _Texture;
            sampler2D _Texture2;

            CBUFFER_START(UnityPerMaterial)
                float4 _Color;
                float4 _Color2;
                float4 _BaseColor;
                // Unity 自动写入纹理面板中的 Tiling(XY) 与 Offset(ZW)，必须放入材质常量缓冲区以兼容 SRP Batcher。
                float4 _Texture_ST;
                float4 _Texture2_ST;
                float2 _Speed;
                float2 _Speed2;
                float2 _MaskUV;
                float2 _MaskUV2;
                float _ColorS;
                float _Color2S;
                float _FlowSpeed;
                float _DE2;
                float _UVRotation;
                float _BaseOpacity;
            CBUFFER_END

            struct VertexInput
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 tangent : TANGENT;
                float4 texcoord : TEXCOORD0;
                float4 lightmapUV : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct VertexOutput
            {
                float4 clipPos : SV_POSITION;
                float4 lightmapUVOrVertexSH : TEXCOORD0;
                half4 fogFactorAndVertexLight : TEXCOORD1;
                float4 shadowCoord : TEXCOORD2;
                float4 tangentToWorld0 : TEXCOORD3;
                float4 tangentToWorld1 : TEXCOORD4;
                float4 tangentToWorld2 : TEXCOORD5;
                float2 uv : TEXCOORD6;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            // 围绕纹理中心旋转 UV，只改变采样方向，不修改模型和纹理资源。
            float2 RotatePipeUV(float2 uv, float rotationDegrees)
            {
                float angle = rotationDegrees * 0.01745329252;
                float sineValue;
                float cosineValue;
                sincos(angle, sineValue, cosineValue);

                float2 centeredUV = uv - 0.5;
                return float2(
                    centeredUV.x * cosineValue - centeredUV.y * sineValue,
                    centeredUV.x * sineValue + centeredUV.y * cosineValue) + 0.5;
            }

            VertexOutput vert(VertexInput input)
            {
                VertexOutput output = (VertexOutput)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);

                float3 normalWS = TransformObjectToWorldNormal(input.normal);
                float3 positionWS = TransformObjectToWorld(input.vertex.xyz);
                float3 tangentWS = TransformObjectToWorldDir(input.tangent.xyz);
                float3 bitangentWS = normalize(cross(normalWS, tangentWS) * input.tangent.w);

                output.tangentToWorld0 = float4(tangentWS.x, bitangentWS.x, normalWS.x, positionWS.x);
                output.tangentToWorld1 = float4(tangentWS.y, bitangentWS.y, normalWS.y, positionWS.y);
                output.tangentToWorld2 = float4(tangentWS.z, bitangentWS.z, normalWS.z, positionWS.z);
                output.uv = input.texcoord.xy;

                VertexPositionInputs vertexInput = GetVertexPositionInputs(input.vertex.xyz);
                output.clipPos = vertexInput.positionCS;

                OUTPUT_LIGHTMAP_UV(input.lightmapUV, unity_LightmapST, output.lightmapUVOrVertexSH.xy);
                OUTPUT_SH(normalWS, output.lightmapUVOrVertexSH.xyz);

                half3 vertexLight = VertexLighting(vertexInput.positionWS, normalWS);
                half fogFactor = ComputeFogFactor(vertexInput.positionCS.z);
                output.fogFactorAndVertexLight = half4(fogFactor, vertexLight);

                #ifdef _MAIN_LIGHT_SHADOWS
                    output.shadowCoord = GetShadowCoord(vertexInput);
                #endif

                return output;
            }

            half4 frag(VertexOutput input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);

                float3 normalWS = normalize(float3(
                    input.tangentToWorld0.z,
                    input.tangentToWorld1.z,
                    input.tangentToWorld2.z));
                float3 positionWS = float3(
                    input.tangentToWorld0.w,
                    input.tangentToWorld1.w,
                    input.tangentToWorld2.w);
                float3 viewDirectionWS = SafeNormalize(_WorldSpaceCameraPos.xyz - positionWS);

                // 先叠加 MaskUV 与纹理自身的 Tiling，再应用 Offset，确保材质面板中的平铺和偏移实际生效。
                float2 firstUV = input.uv * _MaskUV * _Texture_ST.xy + _Texture_ST.zw;
                float2 secondUV = input.uv * _MaskUV2 * _Texture2_ST.xy + _Texture2_ST.zw;
                firstUV = RotatePipeUV(firstUV, _UVRotation);
                secondUV = RotatePipeUV(secondUV, _UVRotation);
                float2 firstPanner = _FlowSpeed * _Time.y * _Speed + firstUV;
                float2 secondPanner = _FlowSpeed * _Time.y * _Speed2 + secondUV;

                float4 firstSample = tex2D(_Texture, firstPanner);
                float4 secondSample = tex2D(_Texture2, secondPanner);

                float3 secondFlowColor = (_Color2 * secondSample.r * _Color2S).rgb;
                float secondLuminance = dot(secondFlowColor, float3(0.299, 0.587, 0.114));
                secondFlowColor = lerp(secondFlowColor, secondLuminance.xxx, _DE2);

                float firstMask = smoothstep(0.23, 1.01, firstSample.r);
                half flowAlpha = saturate(secondSample.r + firstMask);
                float3 emission = ((_Color * firstSample * _ColorS) + float4(secondFlowColor, 0.0)).rgb;

                InputData inputData = (InputData)0;
                inputData.positionWS = positionWS;
                inputData.normalWS = normalWS;
                inputData.viewDirectionWS = viewDirectionWS;
                inputData.shadowCoord = input.shadowCoord;
                inputData.fogCoord = input.fogFactorAndVertexLight.x;
                inputData.vertexLighting = input.fogFactorAndVertexLight.yzw;
                inputData.bakedGI = SAMPLE_GI(
                    input.lightmapUVOrVertexSH.xy,
                    input.lightmapUVOrVertexSH.xyz,
                    inputData.normalWS);

                half4 color = UniversalFragmentPBR(
                    inputData,
                    half3(0.2, 0.2, 0.2),
                    0.0,
                    half3(0.5, 0.5, 0.5),
                    0.5,
                    1.0,
                    emission,
                    flowAlpha);

                // 按“底色在下、流动效果在上”的顺序做标准 Alpha 合成。
                // 先算最终覆盖率，再转回非预乘颜色，确保透明边缘不会异常变暗或增亮。
                half baseAlpha = saturate(_BaseColor.a * _BaseOpacity);
                half baseVisibleAlpha = baseAlpha * (1.0h - flowAlpha);
                half finalAlpha = flowAlpha + baseVisibleAlpha;
                half safeFinalAlpha = max(finalAlpha, 0.0001h);
                color.rgb = (
                    color.rgb * flowAlpha +
                    _BaseColor.rgb * baseVisibleAlpha) / safeFinalAlpha;
                color.a = finalAlpha;

                color.rgb = MixFog(color.rgb, input.fogFactorAndVertexLight.x);

                #ifdef LOD_FADE_CROSSFADE
                    LODDitheringTransition(input.clipPos.xyz, unity_LODFade.x);
                #endif

                return color;
            }
            ENDHLSL
        }
    }

    Fallback "Hidden/InternalErrorShader"
}
