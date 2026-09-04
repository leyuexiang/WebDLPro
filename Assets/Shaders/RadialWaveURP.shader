Shader "自定义/URP/径向扩散波纹"
{
    Properties
    {
        [HDR] _InnerColor("内圈颜色", Color) = (2, 1.2, 0.4, 1)
        [HDR] _OuterColor("外圈颜色", Color) = (1, 0.6, 0.2, 1)
        _WaveWidth("波纹宽度", Range(0.01, 0.5)) = 0.15
        _EdgeSoftness("边缘柔和度", Range(0.01, 0.3)) = 0.08
        
        [Header(Texture)]
        _MainTex("纹理贴图", 2D) = "white" {}
        _TextureStrength("纹理强度", Range(0, 1)) = 0.5
        _TextureRotation("纹理旋转速度", Range(-2, 2)) = 0.3
        
        [Header(Procedural Noise)]
        _NoiseScale("噪声密度", Range(1, 20)) = 8
        _NoiseStrength("噪声强度", Range(0, 1)) = 0.4
        _DistortionStrength("扭曲强度", Range(0, 0.3)) = 0.12
        _Alpha("整体透明度", Range(0, 1)) = 1
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "UniversalPipeline"
            "RenderType" = "Transparent"
            "Queue" = "Transparent"
        }

    Pass
    {
        Name "ForwardLit"
        Tags { "LightMode" = "UniversalForward" }

        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off

        HLSLPROGRAM
        #pragma vertex vert
        #pragma fragment frag
        #pragma target 3.0

        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

        CBUFFER_START(UnityPerMaterial)
            half4 _InnerColor;
            half4 _OuterColor;
            half _WaveWidth;
            half _EdgeSoftness;
            float4 _MainTex_ST;
            half _TextureStrength;
            half _TextureRotation;
            half _NoiseScale;
            half _NoiseStrength;
            half _DistortionStrength;
            half _Alpha;
        CBUFFER_END

        TEXTURE2D(_MainTex);
        SAMPLER(sampler_MainTex);

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

        // 简单噪声函数
        float Noise(float2 p)
        {
            return frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
        }

        float SmoothNoise(float2 p)
        {
            float2 i = floor(p);
            float2 f = frac(p);
            f = f * f * (3.0 - 2.0 * f);

            float a = Noise(i);
            float b = Noise(i + float2(1, 0));
            float c = Noise(i + float2(0, 1));
            float d = Noise(i + float2(1, 1));

            return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
        }

        Varyings vert(Attributes input)
        {
            Varyings output;
            output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
            output.uv = input.uv;
            return output;
        }

        half4 frag(Varyings input) : SV_Target
        {
            // 计算到中心距离
            float2 centered = input.uv - 0.5;
            float dist = length(centered);
            
            // 方形外围裁剪：距离超过 0.5 完全透明
            if (dist > 0.5)
            {
                discard;
            }

            // 添加扭曲噪声
            float2 noiseCoord = input.uv * _NoiseScale + _Time.y * 0.3;
            float noise = SmoothNoise(noiseCoord) * 2.0 - 1.0;
            dist += noise * _DistortionStrength;

            // 径向波纹遮罩
            float waveMask = smoothstep(0.5 - _WaveWidth - _EdgeSoftness, 0.5 - _WaveWidth, dist) *
                             (1.0 - smoothstep(0.5, 0.5 + _EdgeSoftness, dist));

            // 添加噪声纹理
            float detailNoise = SmoothNoise(input.uv * _NoiseScale * 2.0 + _Time.y * 0.5);
            waveMask *= lerp(1.0, detailNoise, _NoiseStrength);

            // 径向渐变颜色
            float radialGradient = saturate(dist / 0.5);
            half3 color = lerp(_InnerColor.rgb, _OuterColor.rgb, radialGradient);

            // 自定义纹理叠加（直接采样，不旋转）
            half4 texSample = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv * _MainTex_ST.xy + _MainTex_ST.zw);
            // 白线黑底蜂窝：直接用纹理亮度调制波纹颜色
            float textureBrightness = dot(texSample.rgb, half3(0.299, 0.587, 0.114));
            // 白线区域（brightness接近1）保持或增强颜色，黑底区域（brightness接近0）压暗
            color = lerp(color * 0.4, color * 2.0, textureBrightness * _TextureStrength + (1.0 - _TextureStrength));

            // 边缘增强发光
            float edgeGlow = 1.0 - smoothstep(0.0, _EdgeSoftness * 2.0, abs(dist - (0.5 - _WaveWidth * 0.5)) - _WaveWidth * 0.5);
            color += edgeGlow * _InnerColor.rgb * 0.8;

            half alpha = waveMask * _Alpha;
            return half4(color, alpha);
        }
        ENDHLSL
    }
    }
}
