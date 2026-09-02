// Made with Amplify Shader Editor
// Available at the Unity Asset Store - http://u3d.as/y3X 
Shader "LYDS/GuanDao"
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


	}

	SubShader
	{
		LOD 0

		
		Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Transparent" "Queue"="Transparent" }
		
		Cull Back
			HLSLINCLUDE
			#pragma target 3.0

			// 围绕纹理中心旋转材质 UV。这里只改变材质采样方向，不修改原始纹理资源。
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

				// 合并自定义 MaskUV 与 Unity 材质面板的 Tiling(XY)、Offset(ZW)，然后沿用原有中心旋转逻辑。
				// 统一入口保证前向、阴影、深度、烘焙和二维通道使用完全一致的 UV 计算。
				float2 TransformPipeUV(float2 uv, float2 maskUV, float4 textureST, float rotationDegrees)
				{
					float2 transformedUV = uv * maskUV * textureST.xy + textureST.zw;
					return RotatePipeUV(transformedUV, rotationDegrees);
				}
				ENDHLSL

		
		Pass
		{
			Name "Forward"
			Tags { "LightMode"="UniversalForward" }
			
			Blend SrcAlpha OneMinusSrcAlpha , One OneMinusSrcAlpha
			ZWrite Off
			ZTest LEqual
			Offset 0 , 0
			ColorMask RGBA
			

			HLSLPROGRAM
			#pragma multi_compile_instancing
			#pragma multi_compile _ LOD_FADE_CROSSFADE
			#pragma multi_compile_fog
			#define ASE_FOG 1
			#define _EMISSION
			#define ASE_SRP_VERSION 999999

			#pragma prefer_hlslcc gles
			#pragma exclude_renderers d3d11_9x

			#pragma multi_compile _ _MAIN_LIGHT_SHADOWS
			#pragma multi_compile _ _MAIN_LIGHT_SHADOWS_CASCADE
			#pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
			#pragma multi_compile _ _ADDITIONAL_LIGHT_SHADOWS
			#pragma multi_compile _ _SHADOWS_SOFT
			#pragma multi_compile _ _MIXED_LIGHTING_SUBTRACTIVE
			
			#pragma multi_compile _ DIRLIGHTMAP_COMBINED
			#pragma multi_compile _ LIGHTMAP_ON

			#pragma vertex vert
			#pragma fragment frag


			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
			#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"
			#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/UnityInstancing.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/ShaderGraphFunctions.hlsl"
			
			

			sampler2D _Texture;
			sampler2D _Texture2;
			CBUFFER_START( UnityPerMaterial )
				float4 _Color;
				float4 _Texture_ST;
				float4 _Texture2_ST;
				float2 _Speed;
			float2 _MaskUV;
			float _ColorS;
			float4 _Color2;
			float2 _Speed2;
				float _FlowSpeed;
			float2 _MaskUV2;
			float _Color2S;
				float _DE2;
				float _UVRotation;
				CBUFFER_END


			struct VertexInput
			{
				float4 vertex : POSITION;
				float3 ase_normal : NORMAL;
				float4 ase_tangent : TANGENT;
				float4 texcoord1 : TEXCOORD1;
				float4 ase_texcoord : TEXCOORD0;
				UNITY_VERTEX_INPUT_INSTANCE_ID
			};

			struct VertexOutput
			{
				float4 clipPos : SV_POSITION;
				float4 lightmapUVOrVertexSH : TEXCOORD0;
				half4 fogFactorAndVertexLight : TEXCOORD1;
				float4 shadowCoord : TEXCOORD2;
				float4 tSpace0 : TEXCOORD3;
				float4 tSpace1 : TEXCOORD4;
				float4 tSpace2 : TEXCOORD5;
				float4 ase_texcoord7 : TEXCOORD7;
				UNITY_VERTEX_INPUT_INSTANCE_ID
				UNITY_VERTEX_OUTPUT_STEREO
			};

			
			VertexOutput vert ( VertexInput v  )
			{
				VertexOutput o = (VertexOutput)0;
				UNITY_SETUP_INSTANCE_ID(v);
				UNITY_TRANSFER_INSTANCE_ID(v, o);
				UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

				o.ase_texcoord7.xy = v.ase_texcoord.xy;
				
				//setting value to unused interpolator channels and avoid initialization warnings
				o.ase_texcoord7.zw = 0;
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					float3 defaultVertexValue = v.vertex.xyz;
				#else
					float3 defaultVertexValue = float3(0, 0, 0);
				#endif
				float3 vertexValue = defaultVertexValue;
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					v.vertex.xyz = vertexValue;
				#else
					v.vertex.xyz += vertexValue;
				#endif
				v.ase_normal = v.ase_normal;

				float3 lwWNormal = TransformObjectToWorldNormal(v.ase_normal);
				float3 lwWorldPos = TransformObjectToWorld(v.vertex.xyz);
				float3 lwWTangent = TransformObjectToWorldDir(v.ase_tangent.xyz);
				float3 lwWBinormal = normalize(cross(lwWNormal, lwWTangent) * v.ase_tangent.w);
				o.tSpace0 = float4(lwWTangent.x, lwWBinormal.x, lwWNormal.x, lwWorldPos.x);
				o.tSpace1 = float4(lwWTangent.y, lwWBinormal.y, lwWNormal.y, lwWorldPos.y);
				o.tSpace2 = float4(lwWTangent.z, lwWBinormal.z, lwWNormal.z, lwWorldPos.z);

				VertexPositionInputs vertexInput = GetVertexPositionInputs(v.vertex.xyz);
				
				OUTPUT_LIGHTMAP_UV( v.texcoord1, unity_LightmapST, o.lightmapUVOrVertexSH.xy );
				OUTPUT_SH(lwWNormal, o.lightmapUVOrVertexSH.xyz );

				half3 vertexLight = VertexLighting(vertexInput.positionWS, lwWNormal);
				#ifdef ASE_FOG
					half fogFactor = ComputeFogFactor( vertexInput.positionCS.z );
				#else
					half fogFactor = 0;
				#endif
				o.fogFactorAndVertexLight = half4(fogFactor, vertexLight);
				o.clipPos = vertexInput.positionCS;

				#ifdef _MAIN_LIGHT_SHADOWS
					o.shadowCoord = GetShadowCoord(vertexInput);
				#endif
				return o;
			}

			half4 frag ( VertexOutput IN  ) : SV_Target
			{
				UNITY_SETUP_INSTANCE_ID(IN);
				UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(IN);

				float3 WorldSpaceNormal = normalize(float3(IN.tSpace0.z,IN.tSpace1.z,IN.tSpace2.z));
				float3 WorldSpaceTangent = float3(IN.tSpace0.x,IN.tSpace1.x,IN.tSpace2.x);
				float3 WorldSpaceBiTangent = float3(IN.tSpace0.y,IN.tSpace1.y,IN.tSpace2.y);
				float3 WorldSpacePosition = float3(IN.tSpace0.w,IN.tSpace1.w,IN.tSpace2.w);
				float3 WorldSpaceViewDirection = _WorldSpaceCameraPos.xyz  - WorldSpacePosition;
	
				#if SHADER_HINT_NICE_QUALITY
					WorldSpaceViewDirection = SafeNormalize( WorldSpaceViewDirection );
				#endif

				float3 temp_cast_0 = (0.2).xxx;
				
					float2 uv06 = TransformPipeUV(IN.ase_texcoord7.xy, _MaskUV, _Texture_ST, _UVRotation);
				float2 panner8 = ( _FlowSpeed * _Time.y * _Speed + uv06);
				float4 tex2DNode1 = tex2D( _Texture, panner8 );
					float2 uv015 = TransformPipeUV(IN.ase_texcoord7.xy, _MaskUV2, _Texture2_ST, _UVRotation);
				float2 panner17 = ( _FlowSpeed * _Time.y * _Speed2 + uv015);
				float4 tex2DNode13 = tex2D( _Texture2, panner17 );
				float3 desaturateInitialColor22 = ( _Color2 * tex2DNode13.r * _Color2S ).rgb;
				float desaturateDot22 = dot( desaturateInitialColor22, float3( 0.299, 0.587, 0.114 ));
				float3 desaturateVar22 = lerp( desaturateInitialColor22, desaturateDot22.xxx, _DE2 );
				
				float smoothstepResult11 = smoothstep( 0.23 , 1.01 , tex2DNode1.r);
				
				float3 Albedo = temp_cast_0;
				float3 Normal = float3(0, 0, 1);
				float3 Emission = ( ( _Color * tex2DNode1 * _ColorS ) + float4( desaturateVar22 , 0.0 ) ).rgb;
				float3 Specular = 0.5;
				float Metallic = 0;
				float Smoothness = 0.5;
				float Occlusion = 1;
				float Alpha = ( tex2DNode13.r + smoothstepResult11 );
				float AlphaClipThreshold = 0.5;
				float3 BakedGI = 0;

				InputData inputData;
				inputData.positionWS = WorldSpacePosition;

				#ifdef _NORMALMAP
					inputData.normalWS = normalize(TransformTangentToWorld(Normal, half3x3(WorldSpaceTangent, WorldSpaceBiTangent, WorldSpaceNormal)));
				#else
					#if !SHADER_HINT_NICE_QUALITY
						inputData.normalWS = WorldSpaceNormal;
					#else
						inputData.normalWS = normalize(WorldSpaceNormal);
					#endif
				#endif

				inputData.viewDirectionWS = WorldSpaceViewDirection;
				inputData.shadowCoord = IN.shadowCoord;

				#ifdef ASE_FOG
					inputData.fogCoord = IN.fogFactorAndVertexLight.x;
				#endif

				inputData.vertexLighting = IN.fogFactorAndVertexLight.yzw;
				inputData.bakedGI = SAMPLE_GI( IN.lightmapUVOrVertexSH.xy, IN.lightmapUVOrVertexSH.xyz, inputData.normalWS );
				#ifdef _ASE_BAKEDGI
					inputData.bakedGI = BakedGI;
				#endif
				half4 color = UniversalFragmentPBR(
					inputData, 
					Albedo, 
					Metallic, 
					Specular, 
					Smoothness, 
					Occlusion, 
					Emission, 
					Alpha);

				#ifdef ASE_FOG
					#ifdef TERRAIN_SPLAT_ADDPASS
						color.rgb = MixFogColor(color.rgb, half3( 0, 0, 0 ), IN.fogFactorAndVertexLight.x );
					#else
						color.rgb = MixFog(color.rgb, IN.fogFactorAndVertexLight.x);
					#endif
				#endif
				
				#if _AlphaClip
					clip(Alpha - AlphaClipThreshold);
				#endif
				
				#ifdef LOD_FADE_CROSSFADE
					LODDitheringTransition( IN.clipPos.xyz, unity_LODFade.x );
				#endif

				return color;
			}

			ENDHLSL
		}

		
		Pass
		{
			
			Name "ShadowCaster"
			Tags { "LightMode"="ShadowCaster" }

			ZWrite On
			ZTest LEqual

			HLSLPROGRAM
			#pragma multi_compile_instancing
			#pragma multi_compile _ LOD_FADE_CROSSFADE
			#pragma multi_compile_fog
			#define ASE_FOG 1
			#define _EMISSION
			#define ASE_SRP_VERSION 999999

			#pragma prefer_hlslcc gles
			#pragma exclude_renderers d3d11_9x

			#pragma vertex ShadowPassVertex
			#pragma fragment ShadowPassFragment


			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/ShaderGraphFunctions.hlsl"
			#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"

			

			struct VertexInput
			{
				float4 vertex : POSITION;
				float3 ase_normal : NORMAL;
				float4 ase_texcoord : TEXCOORD0;
				UNITY_VERTEX_INPUT_INSTANCE_ID
			};

			sampler2D _Texture2;
			sampler2D _Texture;
			CBUFFER_START( UnityPerMaterial )
				float4 _Color;
				float4 _Texture_ST;
				float4 _Texture2_ST;
				float2 _Speed;
			float2 _MaskUV;
			float _ColorS;
			float4 _Color2;
			float2 _Speed2;
				float _FlowSpeed;
			float2 _MaskUV2;
			float _Color2S;
				float _DE2;
				float _UVRotation;
				CBUFFER_END


			struct VertexOutput
			{
				float4 clipPos : SV_POSITION;
				float4 ase_texcoord7 : TEXCOORD7;
				UNITY_VERTEX_INPUT_INSTANCE_ID
			};

			
			float3 _LightDirection;

			VertexOutput ShadowPassVertex( VertexInput v )
			{
				VertexOutput o;
				UNITY_SETUP_INSTANCE_ID(v);
				UNITY_TRANSFER_INSTANCE_ID(v, o);

				o.ase_texcoord7.xy = v.ase_texcoord.xy;
				
				//setting value to unused interpolator channels and avoid initialization warnings
				o.ase_texcoord7.zw = 0;
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					float3 defaultVertexValue = v.vertex.xyz;
				#else
					float3 defaultVertexValue = float3(0, 0, 0);
				#endif
				float3 vertexValue = defaultVertexValue;
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					v.vertex.xyz = vertexValue;
				#else
					v.vertex.xyz += vertexValue;
				#endif

				v.ase_normal = v.ase_normal;

				float3 positionWS = TransformObjectToWorld(v.vertex.xyz);
				float3 normalWS = TransformObjectToWorldDir(v.ase_normal);

				float4 clipPos = TransformWorldToHClip( ApplyShadowBias( positionWS, normalWS, _LightDirection ) );

				#if UNITY_REVERSED_Z
					clipPos.z = min(clipPos.z, clipPos.w * UNITY_NEAR_CLIP_VALUE);
				#else
					clipPos.z = max(clipPos.z, clipPos.w * UNITY_NEAR_CLIP_VALUE);
				#endif
				o.clipPos = clipPos;

				return o;
			}

			half4 ShadowPassFragment(VertexOutput IN  ) : SV_TARGET
			{
				UNITY_SETUP_INSTANCE_ID( IN );

					float2 uv015 = TransformPipeUV(IN.ase_texcoord7.xy, _MaskUV2, _Texture2_ST, _UVRotation);
				float2 panner17 = ( _FlowSpeed * _Time.y * _Speed2 + uv015);
				float4 tex2DNode13 = tex2D( _Texture2, panner17 );
					float2 uv06 = TransformPipeUV(IN.ase_texcoord7.xy, _MaskUV, _Texture_ST, _UVRotation);
				float2 panner8 = ( _FlowSpeed * _Time.y * _Speed + uv06);
				float4 tex2DNode1 = tex2D( _Texture, panner8 );
				float smoothstepResult11 = smoothstep( 0.23 , 1.01 , tex2DNode1.r);
				
				float Alpha = ( tex2DNode13.r + smoothstepResult11 );
				float AlphaClipThreshold = 0.5;

				#if _AlphaClip
					clip(Alpha - AlphaClipThreshold);
				#endif

				#ifdef LOD_FADE_CROSSFADE
					LODDitheringTransition( IN.clipPos.xyz, unity_LODFade.x );
				#endif
				return 0;
			}

			ENDHLSL
		}

		
		Pass
		{
			
			Name "DepthOnly"
			Tags { "LightMode"="DepthOnly" }

			ZWrite On
			ColorMask 0

			HLSLPROGRAM
			#pragma multi_compile_instancing
			#pragma multi_compile _ LOD_FADE_CROSSFADE
			#pragma multi_compile_fog
			#define ASE_FOG 1
			#define _EMISSION
			#define ASE_SRP_VERSION 999999

			#pragma prefer_hlslcc gles
			#pragma exclude_renderers d3d11_9x

			#pragma vertex vert
			#pragma fragment frag


			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/ShaderGraphFunctions.hlsl"
			#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"

			

			sampler2D _Texture2;
			sampler2D _Texture;
			CBUFFER_START( UnityPerMaterial )
				float4 _Color;
				float4 _Texture_ST;
				float4 _Texture2_ST;
				float2 _Speed;
			float2 _MaskUV;
			float _ColorS;
			float4 _Color2;
			float2 _Speed2;
				float _FlowSpeed;
			float2 _MaskUV2;
			float _Color2S;
				float _DE2;
				float _UVRotation;
				CBUFFER_END


			struct VertexInput
			{
				float4 vertex : POSITION;
				float3 ase_normal : NORMAL;
				float4 ase_texcoord : TEXCOORD0;
				UNITY_VERTEX_INPUT_INSTANCE_ID
			};

			struct VertexOutput
			{
				float4 clipPos : SV_POSITION;
				float4 ase_texcoord : TEXCOORD0;
				UNITY_VERTEX_INPUT_INSTANCE_ID
				UNITY_VERTEX_OUTPUT_STEREO
			};

			
			VertexOutput vert( VertexInput v  )
			{
				VertexOutput o = (VertexOutput)0;
				UNITY_SETUP_INSTANCE_ID(v);
				UNITY_TRANSFER_INSTANCE_ID(v, o);
				UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

				o.ase_texcoord.xy = v.ase_texcoord.xy;
				
				//setting value to unused interpolator channels and avoid initialization warnings
				o.ase_texcoord.zw = 0;
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					float3 defaultVertexValue = v.vertex.xyz;
				#else
					float3 defaultVertexValue = float3(0, 0, 0);
				#endif
				float3 vertexValue = defaultVertexValue;
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					v.vertex.xyz = vertexValue;
				#else
					v.vertex.xyz += vertexValue;
				#endif

				v.ase_normal = v.ase_normal;

				o.clipPos = TransformObjectToHClip(v.vertex.xyz);
				return o;
			}

			half4 frag(VertexOutput IN  ) : SV_TARGET
			{
				UNITY_SETUP_INSTANCE_ID(IN);
				UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX( IN );

					float2 uv015 = TransformPipeUV(IN.ase_texcoord.xy, _MaskUV2, _Texture2_ST, _UVRotation);
				float2 panner17 = ( _FlowSpeed * _Time.y * _Speed2 + uv015);
				float4 tex2DNode13 = tex2D( _Texture2, panner17 );
					float2 uv06 = TransformPipeUV(IN.ase_texcoord.xy, _MaskUV, _Texture_ST, _UVRotation);
				float2 panner8 = ( _FlowSpeed * _Time.y * _Speed + uv06);
				float4 tex2DNode1 = tex2D( _Texture, panner8 );
				float smoothstepResult11 = smoothstep( 0.23 , 1.01 , tex2DNode1.r);
				
				float Alpha = ( tex2DNode13.r + smoothstepResult11 );
				float AlphaClipThreshold = 0.5;

				#if _AlphaClip
					clip(Alpha - AlphaClipThreshold);
				#endif

				#ifdef LOD_FADE_CROSSFADE
					LODDitheringTransition( IN.clipPos.xyz, unity_LODFade.x );
				#endif
				return 0;
			}
			ENDHLSL
		}

		
		Pass
		{
			
			Name "Meta"
			Tags { "LightMode"="Meta" }

			Cull Off

			HLSLPROGRAM
			#pragma multi_compile_instancing
			#pragma multi_compile _ LOD_FADE_CROSSFADE
			#pragma multi_compile_fog
			#define ASE_FOG 1
			#define _EMISSION
			#define ASE_SRP_VERSION 999999

			#pragma prefer_hlslcc gles
			#pragma exclude_renderers d3d11_9x

			#pragma vertex vert
			#pragma fragment frag


			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/MetaInput.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/ShaderGraphFunctions.hlsl"
			#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"

			

			sampler2D _Texture;
			sampler2D _Texture2;
			CBUFFER_START( UnityPerMaterial )
				float4 _Color;
				float4 _Texture_ST;
				float4 _Texture2_ST;
				float2 _Speed;
			float2 _MaskUV;
			float _ColorS;
			float4 _Color2;
			float2 _Speed2;
				float _FlowSpeed;
			float2 _MaskUV2;
			float _Color2S;
				float _DE2;
				float _UVRotation;
				CBUFFER_END


			#pragma shader_feature _ _SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A

			struct VertexInput
			{
				float4 vertex : POSITION;
				float3 ase_normal : NORMAL;
				float4 texcoord1 : TEXCOORD1;
				float4 texcoord2 : TEXCOORD2;
				float4 ase_texcoord : TEXCOORD0;
				UNITY_VERTEX_INPUT_INSTANCE_ID
			};

			struct VertexOutput
			{
				float4 clipPos : SV_POSITION;
				float4 ase_texcoord : TEXCOORD0;
				UNITY_VERTEX_INPUT_INSTANCE_ID
				UNITY_VERTEX_OUTPUT_STEREO
			};

			
			VertexOutput vert( VertexInput v  )
			{
				VertexOutput o = (VertexOutput)0;
				UNITY_SETUP_INSTANCE_ID(v);
				UNITY_TRANSFER_INSTANCE_ID(v, o);
				UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

				o.ase_texcoord.xy = v.ase_texcoord.xy;
				
				//setting value to unused interpolator channels and avoid initialization warnings
				o.ase_texcoord.zw = 0;
				
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					float3 defaultVertexValue = v.vertex.xyz;
				#else
					float3 defaultVertexValue = float3(0, 0, 0);
				#endif
				float3 vertexValue = defaultVertexValue;
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					v.vertex.xyz = vertexValue;
				#else
					v.vertex.xyz += vertexValue;
				#endif

				v.ase_normal = v.ase_normal;

				o.clipPos = MetaVertexPosition( v.vertex, v.texcoord1.xy, v.texcoord1.xy, unity_LightmapST, unity_DynamicLightmapST );
				return o;
			}

			half4 frag(VertexOutput IN  ) : SV_TARGET
			{
				UNITY_SETUP_INSTANCE_ID(IN);
				UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX( IN );

				float3 temp_cast_0 = (0.2).xxx;
				
					float2 uv06 = TransformPipeUV(IN.ase_texcoord.xy, _MaskUV, _Texture_ST, _UVRotation);
				float2 panner8 = ( _FlowSpeed * _Time.y * _Speed + uv06);
				float4 tex2DNode1 = tex2D( _Texture, panner8 );
					float2 uv015 = TransformPipeUV(IN.ase_texcoord.xy, _MaskUV2, _Texture2_ST, _UVRotation);
				float2 panner17 = ( _FlowSpeed * _Time.y * _Speed2 + uv015);
				float4 tex2DNode13 = tex2D( _Texture2, panner17 );
				float3 desaturateInitialColor22 = ( _Color2 * tex2DNode13.r * _Color2S ).rgb;
				float desaturateDot22 = dot( desaturateInitialColor22, float3( 0.299, 0.587, 0.114 ));
				float3 desaturateVar22 = lerp( desaturateInitialColor22, desaturateDot22.xxx, _DE2 );
				
				float smoothstepResult11 = smoothstep( 0.23 , 1.01 , tex2DNode1.r);
				
				
				float3 Albedo = temp_cast_0;
				float3 Emission = ( ( _Color * tex2DNode1 * _ColorS ) + float4( desaturateVar22 , 0.0 ) ).rgb;
				float Alpha = ( tex2DNode13.r + smoothstepResult11 );
				float AlphaClipThreshold = 0.5;

				#if _AlphaClip
					clip(Alpha - AlphaClipThreshold);
				#endif

				MetaInput metaInput = (MetaInput)0;
				metaInput.Albedo = Albedo;
				metaInput.Emission = Emission;
				
				return MetaFragment(metaInput);
			}
			ENDHLSL
		}

		
		Pass
		{
			
			Name "Universal2D"
			Tags { "LightMode"="Universal2D" }

			Blend SrcAlpha OneMinusSrcAlpha , One OneMinusSrcAlpha
			ZWrite Off
			ZTest LEqual
			Offset 0 , 0
			ColorMask RGBA

			HLSLPROGRAM
			#pragma multi_compile_instancing
			#pragma multi_compile _ LOD_FADE_CROSSFADE
			#pragma multi_compile_fog
			#define ASE_FOG 1
			#define _EMISSION
			#define ASE_SRP_VERSION 999999

			#pragma enable_d3d11_debug_symbols
			#pragma prefer_hlslcc gles
			#pragma exclude_renderers d3d11_9x

			#pragma vertex vert
			#pragma fragment frag


			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
			#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"
			#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/UnityInstancing.hlsl"
			#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/ShaderGraphFunctions.hlsl"
			
			

			sampler2D _Texture2;
			sampler2D _Texture;
			CBUFFER_START( UnityPerMaterial )
				float4 _Color;
				float4 _Texture_ST;
				float4 _Texture2_ST;
				float2 _Speed;
			float2 _MaskUV;
			float _ColorS;
			float4 _Color2;
			float2 _Speed2;
				float _FlowSpeed;
			float2 _MaskUV2;
			float _Color2S;
				float _DE2;
				float _UVRotation;
				CBUFFER_END


			#pragma shader_feature _ _SMOOTHNESS_TEXTURE_ALBEDO_CHANNEL_A

			struct VertexInput
			{
				float4 vertex : POSITION;
				float3 ase_normal : NORMAL;
				float4 ase_texcoord : TEXCOORD0;
				UNITY_VERTEX_INPUT_INSTANCE_ID
			};

			struct VertexOutput
			{
				float4 clipPos : SV_POSITION;
				float4 ase_texcoord : TEXCOORD0;
			};

			
			VertexOutput vert( VertexInput v  )
			{
				VertexOutput o = (VertexOutput)0;

				o.ase_texcoord.xy = v.ase_texcoord.xy;
				
				//setting value to unused interpolator channels and avoid initialization warnings
				o.ase_texcoord.zw = 0;
				
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					float3 defaultVertexValue = v.vertex.xyz;
				#else
					float3 defaultVertexValue = float3(0, 0, 0);
				#endif
				float3 vertexValue = defaultVertexValue;
				#ifdef ASE_ABSOLUTE_VERTEX_POS
					v.vertex.xyz = vertexValue;
				#else
					v.vertex.xyz += vertexValue;
				#endif

				v.ase_normal = v.ase_normal;

				VertexPositionInputs vertexInput = GetVertexPositionInputs( v.vertex.xyz );
				o.clipPos = vertexInput.positionCS;
				return o;
			}

			half4 frag(VertexOutput IN  ) : SV_TARGET
			{
				float3 temp_cast_0 = (0.2).xxx;
				
					float2 uv015 = TransformPipeUV(IN.ase_texcoord.xy, _MaskUV2, _Texture2_ST, _UVRotation);
				float2 panner17 = ( _FlowSpeed * _Time.y * _Speed2 + uv015);
				float4 tex2DNode13 = tex2D( _Texture2, panner17 );
					float2 uv06 = TransformPipeUV(IN.ase_texcoord.xy, _MaskUV, _Texture_ST, _UVRotation);
				float2 panner8 = ( _FlowSpeed * _Time.y * _Speed + uv06);
				float4 tex2DNode1 = tex2D( _Texture, panner8 );
				float smoothstepResult11 = smoothstep( 0.23 , 1.01 , tex2DNode1.r);
				
				
				float3 Albedo = temp_cast_0;
				float Alpha = ( tex2DNode13.r + smoothstepResult11 );
				float AlphaClipThreshold = 0.5;

				half4 color = half4( Albedo, Alpha );

				#if _AlphaClip
					clip(Alpha - AlphaClipThreshold);
				#endif

				return color;
			}
			ENDHLSL
		}
		
	}
	CustomEditor "UnityEditor.ShaderGraph.PBRMasterGUI"
	Fallback "Hidden/InternalErrorShader"
	
}
/*ASEBEGIN
Version=17500
129.3333;334;1276;518;1147.336;313.5786;1.6;True;True
Node;AmplifyShaderEditor.Vector2Node;10;-1913.285,326.4034;Inherit;False;Property;_MaskUV;MaskUV;7;0;Create;True;0;0;False;0;1,1;1,8.65;0;3;FLOAT2;0;FLOAT;1;FLOAT;2
Node;AmplifyShaderEditor.Vector2Node;14;-2008.286,-39.80526;Inherit;False;Property;_MaskUV2;MaskUV2;8;0;Create;True;0;0;False;0;1,1;1,2;0;3;FLOAT2;0;FLOAT;1;FLOAT;2
Node;AmplifyShaderEditor.Vector2Node;7;-1627.958,405.6846;Inherit;False;Property;_Speed;Speed;5;0;Create;True;0;0;False;0;0,-0.2;0,-0.2;0;3;FLOAT2;0;FLOAT;1;FLOAT;2
Node;AmplifyShaderEditor.TextureCoordinatesNode;6;-1683.473,210.1293;Inherit;False;0;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.TextureCoordinatesNode;15;-1778.474,-156.0793;Inherit;False;0;-1;2;3;2;SAMPLER2D;;False;0;FLOAT2;1,1;False;1;FLOAT2;0,0;False;5;FLOAT2;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.Vector2Node;16;-1722.959,39.4759;Inherit;False;Property;_Speed2;Speed2;6;0;Create;True;0;0;False;0;0,-0.2;0,-0.2;0;3;FLOAT2;0;FLOAT;1;FLOAT;2
Node;AmplifyShaderEditor.PannerNode;8;-1340.022,255.5829;Inherit;False;3;0;FLOAT2;0,0;False;2;FLOAT2;0,-0.2;False;1;FLOAT;1;False;1;FLOAT2;0
Node;AmplifyShaderEditor.PannerNode;17;-1435.023,-110.6258;Inherit;False;3;0;FLOAT2;0,0;False;2;FLOAT2;0,-0.2;False;1;FLOAT;1;False;1;FLOAT2;0
Node;AmplifyShaderEditor.SamplerNode;1;-1078.794,126.8402;Inherit;True;Property;_Texture;Texture;0;0;Create;True;0;0;False;0;-1;9fbef4b79ca3b784ba023cb1331520d5;9fbef4b79ca3b784ba023cb1331520d5;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;6;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;5;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.SamplerNode;13;-1069.752,-98.91904;Inherit;True;Property;_Texture2;Texture2;1;0;Create;True;0;0;False;0;-1;9fbef4b79ca3b784ba023cb1331520d5;61c0b9c0523734e0e91bc6043c72a490;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;6;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;5;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.SmoothstepOpNode;11;-687.7239,200.8807;Inherit;True;3;0;FLOAT;0;False;1;FLOAT;0.23;False;2;FLOAT;1.01;False;1;FLOAT;0
Node;AmplifyShaderEditor.SimpleAddOpNode;12;-62.551,123.7566;Inherit;False;2;2;0;FLOAT;0;False;1;FLOAT;0;False;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode;24;110.6805,-122.7562;Inherit;False;Constant;_Float0;Float 0;12;0;Create;True;0;0;False;0;0.2;0;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.SimpleAddOpNode;18;-167.5194,-135.3256;Inherit;False;2;2;0;COLOR;0,0,0,0;False;1;FLOAT3;0,0,0;False;1;COLOR;0
Node;AmplifyShaderEditor.SamplerNode;9;-585.3348,482.1039;Inherit;True;Property;_TextureMask;TextureMask;4;0;Create;True;0;0;False;0;-1;None;9fbef4b79ca3b784ba023cb1331520d5;True;0;False;white;Auto;False;Object;-1;Auto;Texture2D;6;0;SAMPLER2D;;False;1;FLOAT2;0,0;False;2;FLOAT;0;False;3;FLOAT2;0,0;False;4;FLOAT2;0,0;False;5;FLOAT;1;False;5;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.SimpleMultiplyOpNode;4;-350.161,-335.0941;Inherit;False;3;3;0;COLOR;0,0,0,0;False;1;COLOR;0,0,0,0;False;2;FLOAT;0;False;1;COLOR;0
Node;AmplifyShaderEditor.SimpleMultiplyOpNode;20;-703.9756,-144.0342;Inherit;False;3;3;0;COLOR;0,0,0,0;False;1;FLOAT;0;False;2;FLOAT;0;False;1;COLOR;0
Node;AmplifyShaderEditor.ColorNode;2;-614.1611,-473.094;Inherit;False;Property;_Color;Color;2;0;Create;True;0;0;False;0;1,1,1,0;0,0.7272725,1,0;True;0;5;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.RangedFloatNode;3;-707.8823,-282.0695;Inherit;False;Property;_ColorS;ColorS;3;0;Create;True;0;0;False;0;1;6.38;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode;23;-593.3079,57.55914;Inherit;False;Property;_DE2;DE2;11;0;Create;True;0;0;False;0;0;-5.66;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.RangedFloatNode;21;-989.6217,-398.3285;Inherit;False;Property;_Color2S;Color2S;10;0;Create;True;0;0;False;0;1;1;0;0;0;1;FLOAT;0
Node;AmplifyShaderEditor.ColorNode;19;-1043.616,-286.8571;Inherit;False;Property;_Color2;Color2;9;0;Create;True;0;0;False;0;1,1,1,0;0.308211,0.2823529,1,0;True;0;5;COLOR;0;FLOAT;1;FLOAT;2;FLOAT;3;FLOAT;4
Node;AmplifyShaderEditor.DesaturateOpNode;22;-450.896,-40.6083;Inherit;False;2;0;FLOAT3;0,0,0;False;1;FLOAT;0;False;1;FLOAT3;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode;28;245.5185,-79.43741;Float;False;False;-1;2;UnityEditor.ShaderGraph.PBRMasterGUI;0;1;New Amplify Shader;94348b07e5e8bab40bd6c8a1e3df54cd;True;Meta;0;3;Meta;0;False;False;False;True;0;False;-1;False;False;False;False;False;True;3;RenderPipeline=UniversalPipeline;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;True;2;0;False;False;False;True;2;False;-1;False;False;False;False;False;True;1;LightMode=Meta;False;0;Hidden/InternalErrorShader;0;0;Standard;0;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode;25;245.5185,-79.43741;Float;False;True;-1;2;UnityEditor.ShaderGraph.PBRMasterGUI;0;2;LYDS/GuanDao;94348b07e5e8bab40bd6c8a1e3df54cd;True;Forward;0;0;Forward;12;False;False;False;True;0;False;-1;False;False;False;False;False;True;3;RenderPipeline=UniversalPipeline;RenderType=Transparent=RenderType;Queue=Transparent=Queue=0;True;2;0;True;1;5;False;-1;10;False;-1;1;1;False;-1;10;False;-1;False;False;False;True;True;True;True;True;0;False;-1;True;False;255;False;-1;255;False;-1;255;False;-1;7;False;-1;1;False;-1;1;False;-1;1;False;-1;7;False;-1;1;False;-1;1;False;-1;1;False;-1;True;2;False;-1;True;3;False;-1;True;True;0;False;-1;0;False;-1;True;1;LightMode=UniversalForward;False;0;Hidden/InternalErrorShader;0;0;Standard;12;Workflow;1;Surface;1;  Blend;0;Two Sided;1;Cast Shadows;1;Receive Shadows;1;GPU Instancing;1;LOD CrossFade;1;Built-in Fog;1;Meta Pass;1;Override Baked GI;0;Vertex Position,InvertActionOnDeselection;1;0;5;True;True;True;True;True;False;;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode;26;245.5185,-79.43741;Float;False;False;-1;2;UnityEditor.ShaderGraph.PBRMasterGUI;0;1;New Amplify Shader;94348b07e5e8bab40bd6c8a1e3df54cd;True;ShadowCaster;0;1;ShadowCaster;0;False;False;False;True;0;False;-1;False;False;False;False;False;True;3;RenderPipeline=UniversalPipeline;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;True;2;0;False;False;False;False;False;False;True;1;False;-1;True;3;False;-1;False;True;1;LightMode=ShadowCaster;False;0;Hidden/InternalErrorShader;0;0;Standard;0;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode;27;245.5185,-79.43741;Float;False;False;-1;2;UnityEditor.ShaderGraph.PBRMasterGUI;0;1;New Amplify Shader;94348b07e5e8bab40bd6c8a1e3df54cd;True;DepthOnly;0;2;DepthOnly;0;False;False;False;True;0;False;-1;False;False;False;False;False;True;3;RenderPipeline=UniversalPipeline;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;True;2;0;False;False;False;False;True;False;False;False;False;0;False;-1;False;True;1;False;-1;False;False;True;1;LightMode=DepthOnly;False;0;Hidden/InternalErrorShader;0;0;Standard;0;0
Node;AmplifyShaderEditor.TemplateMultiPassMasterNode;29;245.5185,-79.43741;Float;False;False;-1;2;UnityEditor.ShaderGraph.PBRMasterGUI;0;1;New Amplify Shader;94348b07e5e8bab40bd6c8a1e3df54cd;True;Universal2D;0;4;Universal2D;0;False;False;False;True;0;False;-1;False;False;False;False;False;True;3;RenderPipeline=UniversalPipeline;RenderType=Opaque=RenderType;Queue=Geometry=Queue=0;True;2;0;True;1;5;False;-1;10;False;-1;1;1;False;-1;10;False;-1;False;False;False;True;True;True;True;True;0;False;-1;False;True;2;False;-1;True;3;False;-1;True;True;0;False;-1;0;False;-1;True;1;LightMode=Universal2D;False;0;Hidden/InternalErrorShader;0;0;Standard;0;0
WireConnection;6;0;10;0
WireConnection;15;0;14;0
WireConnection;8;0;6;0
WireConnection;8;2;7;0
WireConnection;17;0;15;0
WireConnection;17;2;16;0
WireConnection;1;1;8;0
WireConnection;13;1;17;0
WireConnection;11;0;1;1
WireConnection;12;0;13;1
WireConnection;12;1;11;0
WireConnection;18;0;4;0
WireConnection;18;1;22;0
WireConnection;9;1;8;0
WireConnection;4;0;2;0
WireConnection;4;1;1;0
WireConnection;4;2;3;0
WireConnection;20;0;19;0
WireConnection;20;1;13;1
WireConnection;20;2;21;0
WireConnection;22;0;20;0
WireConnection;22;1;23;0
WireConnection;25;0;24;0
WireConnection;25;2;18;0
WireConnection;25;6;12;0
ASEEND*/
//CHKSM=FF93B5B1CAD5A55F3A2963BE0CDD3E1118EC8C24