Shader "自定义/URP/建筑半球能量罩"
{
    Properties
    {
        [HDR] _ShieldColor("护罩颜色", Color) = (0, 0.9, 2.6, 1)
        // 保留旧纹理属性以兼容已有材质序列化数据；实际蜂窝线由着色器程序化生成。
        [HideInInspector] _HexPattern("六边形纹理（兼容保留）", 2D) = "black" {}
        _HexTiling("蜂窝平铺次数", Range(0.5, 24)) = 8
        _HexLineWidth("蜂窝线宽", Range(0.005, 0.08)) = 0.025
        _HexStrength("蜂窝线强度", Range(0, 2)) = 1
        _Opacity("整体透明度", Range(0, 1)) = 0.34
        _RimPower("边缘收敛指数", Range(0.5, 8)) = 2.1
        _RimIntensity("边缘光强度", Range(0, 6)) = 1.8
        _ScanSpeed("扫描速度", Range(0, 4)) = 0.35
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent+10" }

        Pass
        {
            Name "EnergyDome"
            Tags { "LightMode" = "UniversalForward" }

            // 加法混合强化能量发光；裁掉下半球后不写深度，确保只形成半球穹顶而不遮挡建筑。
            Blend SrcAlpha One
            ZWrite Off
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _ShieldColor;
                half _Opacity;
                half _RimPower;
                half _RimIntensity;
                half _HexTiling;
                half _HexLineWidth;
                half _HexStrength;
                half _ScanSpeed;
            CBUFFER_END

            TEXTURE2D(_HexPattern);
            SAMPLER(sampler_HexPattern);

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
                // Unity 内置球体的物体空间 y 小于零即位于下半球，直接裁掉以形成贴地的半球护罩。
                clip(input.positionOS.y);

                half3 normalWS = normalize(input.normalWS);
                normalWS *= isFrontFace ? 1.0h : -1.0h;
                half3 viewDirectionWS = normalize(input.viewDirectionWS);
                half fresnel = pow(saturate(1.0h - abs(dot(normalWS, viewDirectionWS))), _RimPower);

                float3 directionOS = normalize(input.positionOS);
                float longitude = atan2(directionOS.z, directionOS.x) * 0.159154943f + 0.5f;
                float latitude = acos(saturate(directionOS.y)) * 0.636619772f;
                float2 hexCoordinate = float2(longitude, latitude) * max((float)_HexTiling, 0.5f);
                const float2 hexPeriod = float2(1.0f, 1.7320508f);
                float2 hexOffset = 0.5f * hexPeriod;
                float2 cellA = frac(hexCoordinate / hexPeriod) * hexPeriod - hexOffset;
                float2 cellB = frac((hexCoordinate - hexOffset) / hexPeriod) * hexPeriod - hexOffset;
                float2 cell = dot(cellA, cellA) < dot(cellB, cellB) ? cellA : cellB;
                float2 cellAbs = abs(cell);
                // 计算规则六边形单元的有符号距离，只在六边形边界附近绘制发光线。
                float hexDistance = max(
                    cellAbs.x - 0.5f,
                    cellAbs.y + cellAbs.x * 1.7320508f - 0.8660254f);
                float lineAA = max(fwidth(hexDistance), 0.0005f);
                // 使用屏幕空间抗锯齿，避免远距离观察时蜂窝线闪烁或断裂。
                half hexLine = (1.0h - smoothstep(_HexLineWidth, _HexLineWidth + lineAA, abs(hexDistance))) * _HexStrength;

                // 自下而上的窄扫描带让护罩保持轻微动态感；蜂窝线由着色器程序化生成，不依赖外部图片纹理。
                float scanPosition = frac(_Time.y * _ScanSpeed);
                half scan = 1.0h - smoothstep(0.025h, 0.09h, abs(latitude - scanPosition));
                half energy = saturate(0.08h + fresnel * _RimIntensity + hexLine * 1.2h + scan * 0.5h);
                half alpha = saturate(_Opacity * (0.12h + fresnel * 0.7h + hexLine * 1.35h + scan * 0.3h) * _ShieldColor.a);
                return half4(_ShieldColor.rgb * energy, alpha);
            }
            ENDHLSL
        }
    }
}
