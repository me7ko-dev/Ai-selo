// Общи („глобални“) стойности за ВСИЧКИ шейдъри: мъгла с въздушна перспектива, височинна мъгла, мокрота от дъжда,
// каскадни сенки. three.js няма глобални униформи, затова:
//  • един споделен Float32Array (gAtmo) — UniformsUtils.clone() копира Color/Vector, но НЕ копира типизирани масиви,
//    така че всеки материал сочи към същия масив и промяната му стига до всички шейдъри без пипане по материалите;
//  • кръпки на ShaderChunk (fog_*, lights_fragment_begin, lights_*_fragment, lights_fragment_maps) — важат за
//    вградените материали и за onBeforeCompile/ShaderMaterial, които ползват #include <fog_…>.
// installAtmo() се вика веднъж от Engine, ПРЕДИ да се създадат материали.
//
// За другите части на играта:
//  • atmoState.wetness (0..1) — колко е мокро (дъжд); в шейдър: `gAtmo[3].x` (декларацията идва от #include <common>).
//  • ATMO_GLSL — ако собствен шейдър не включва <common>, сложи го в началото, за да има gAtmo.
import * as THREE from 'three';

export const ATMO_SLOTS = 16;
/** Споделеният масив (16 × vec4). Индексите са в A. */
export const ATMO = new Float32Array(ATMO_SLOTS * 4);
const atmoUniform = { value: ATMO };

/** Номера на vec4 слотовете в gAtmo. */
export const A = {
  /** xyz — посока към светлината (слънце / луна); w — 1 = новата мъгла е включена */
  LIGHT: 0,
  /** rgb — светлина, разсеяна около слънцето/луната (Mie); w — сила */
  INSCATTER: 1,
  /** x — плътност на мараната (на метър); y — височинна мъгла (на метър, при основата); z — височина на спадане (м); w — основа (м) */
  FOG: 2,
  /** x — мокрота 0..1; y — дъжд 0..1; z — време (s); w — 1 = околната светлина е от сондата (без IBL дифузно) */
  MISC: 3,
  /** 8 цвята на хоризонта по азимут (през 45°), rgb */
  HAZE0: 4,
  /** rgb — небето нагоре; w — нощ 0..1 */
  ZENITH: 12,
  /** x — ширина на прехода между каскадите (дял от картата); y — 1 = каскадни сенки */
  SHADOW: 13,
  /** rgb — относително погасяване по канали (синьото се разсейва повече → далечното синкаво) */
  HAZE_TINT: 14,
  /** rgb — цвят на височинната (утринна) мъгла: осветена от цялото небе, по-бледа от мараната */
  MIST: 15,
} as const;

export const ATMO_GLSL = /* glsl */`
#ifndef ATMO_DECLARED
#define ATMO_DECLARED
uniform vec4 gAtmo[ ${ATMO_SLOTS} ];
#endif
`;

/** Стойности, които четат и другите системи (трева, земя, сгради…). */
export const atmoState = {
  /** 0 = сухо … 1 = подгизнало (расте при дъжд, съхне бавно). В шейдъра: gAtmo[3].x */
  wetness: 0,
  /** сила на дъжда 0..1 */
  rain: 0,
};

export function setAtmoVec(slot: number, x: number, y: number, z: number, w: number): void {
  const o = slot * 4; ATMO[o] = x; ATMO[o + 1] = y; ATMO[o + 2] = z; ATMO[o + 3] = w;
}
export function setAtmoColor(slot: number, c: { r: number; g: number; b: number }, w = ATMO[slot * 4 + 3]): void {
  setAtmoVec(slot, c.r, c.g, c.b, w);
}

// ───────────────────────────── кръпките ─────────────────────────────

const fogParsVertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorld;
#endif
`;

const fogVertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// световната позиция без обратна матрица: viewMatrix е въртене + отместване
	vFogWorld = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;

const fogParsFragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	${ATMO_GLSL}
	// цветът на мараната в посоката на погледа: хоризонтът (8 посоки), небето нагоре и сиянието около слънцето
	vec3 atmoHaze( vec3 dir ) {
		float a = ( atan( dir.z, dir.x ) * 0.15915494 + 1.0 ) * 8.0;
		float fa = fract( a );
		int i0 = int( mod( floor( a ), 8.0 ) );
		int i1 = int( mod( floor( a ) + 1.0, 8.0 ) );
		vec3 h = mix( gAtmo[ 4 + i0 ].rgb, gAtmo[ 4 + i1 ].rgb, fa );
		h = mix( h, gAtmo[ 12 ].rgb, smoothstep( 0.04, 0.7, dir.y ) * 0.55 );
		float mu = max( dot( dir, gAtmo[ 0 ].xyz ), 0.0 );
		h += gAtmo[ 1 ].rgb * gAtmo[ 1 ].w * ( pow( mu, 6.0 ) * 0.5 + pow( mu, 40.0 ) * 1.5 );
		return h;
	}
	// средна плътност на височинната мъгла по отсечка (експоненциален спад над основата)
	float atmoHeightAvg( float ya, float yb, float H ) {
		float a = max( ya, 0.0 ), b = max( yb, 0.0 );
		float d = b - a;
		float ea = exp( - a / H ), eb = exp( - b / H );
		return abs( d ) > 0.05 ? H * ( ea - eb ) / d : ea;
	}
	// tau: rgb — мараната (по канали), a — височинната мъгла
	vec4 atmoFogTau( vec3 rel, float dist ) {
		float base = gAtmo[ 2 ].w;
		float mist = gAtmo[ 2 ].y * dist * atmoHeightAvg( cameraPosition.y - base, cameraPosition.y + rel.y - base, max( gAtmo[ 2 ].z, 0.5 ) );
		vec3 tint = gAtmo[ 14 ].x > 0.0 ? gAtmo[ 14 ].rgb : vec3( 1.0 );
		return vec4( dist * gAtmo[ 2 ].x * tint, mist );
	}
#endif
`;

const fogFragment = /* glsl */`
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 fogCol = fogColor;
	vec3 fogF = vec3( fogFactor );
	if ( gAtmo[ 0 ].w > 0.5 ) {
		vec3 fogRel = vFogWorld - cameraPosition;
		float fogDist = length( fogRel );
		vec3 fogDir = fogRel / max( fogDist, 1e-4 );
		vec4 fogTau = atmoFogTau( fogRel, fogDist );
		fogF = 1.0 - exp( - ( fogTau.rgb + fogTau.a ) );
		float hazeT = dot( fogTau.rgb, vec3( 0.333 ) );
		fogCol = mix( atmoHaze( fogDir ), gAtmo[ 15 ].rgb, fogTau.a / max( hazeT + fogTau.a, 1e-5 ) );
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogF );
#endif
`;

// Каскадни сенки: светлина 0 = близката карта (свети), светлина 1 = далечната карта (интензитет 0, само сянката ѝ).
// Плавен преход между каскадите и плавно изчезване на сянката към края на далечната карта (без рязка граница).
const cascadeFns = /* glsl */`
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	float atmoShadowEdge( vec4 sc, float m ) {
		vec3 p = sc.xyz / sc.w;
		vec2 e = min( p.xy, 1.0 - p.xy );
		return smoothstep( 0.0, m, min( e.x, e.y ) ) * step( p.z, 1.0 );
	}
	float atmoSunShadow() {
		float m = gAtmo[ 13 ].x > 0.0 ? gAtmo[ 13 ].x : 0.1;
		float w0 = atmoShadowEdge( vDirectionalShadowCoord[ 0 ], m );
		float s0 = 1.0;
		if ( w0 > 0.0 ) {
			DirectionalLightShadow d0 = directionalLightShadows[ 0 ];
			s0 = getShadow( directionalShadowMap[ 0 ], d0.shadowMapSize, d0.shadowIntensity, d0.shadowBias, d0.shadowRadius, vDirectionalShadowCoord[ 0 ] );
		}
		#if NUM_DIR_LIGHT_SHADOWS >= 2
			float s1 = 1.0;
			float w1 = 0.0;
			if ( w0 < 1.0 && gAtmo[ 13 ].y > 0.5 ) {
				w1 = atmoShadowEdge( vDirectionalShadowCoord[ 1 ], 0.12 );
				if ( w1 > 0.0 ) {
					DirectionalLightShadow d1 = directionalLightShadows[ 1 ];
					s1 = getShadow( directionalShadowMap[ 1 ], d1.shadowMapSize, d1.shadowIntensity, d1.shadowBias, d1.shadowRadius, vDirectionalShadowCoord[ 1 ] );
				}
			}
			return mix( mix( 1.0, s1, w1 ), s0, w0 );
		#else
			return mix( 1.0, s0, w0 );
		#endif
	}
#endif
`;

const dirLoopOld = /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap\[ i \][^;]*;/;
const dirLoopNew = `#if ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= ( directLight.visible && receiveShadow ) ? atmoSunShadow() : 1.0;
		#elif ( UNROLLED_LOOP_INDEX >= 2 )
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif`;

const pointLoopOld = /(getPointLightInfo\( pointLight, geometryPosition, directLight \);[\s\S]*?)(RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);)/;
const pointLoopNew = '$1if ( directLight.visible ) { $2 }';

// Мокрота: по-тъмно (порестите повърхности попиват вода) и по-гладко (лъщи) — най-вече отгоре.
const wetCode = (standard: boolean) => /* glsl */`
	{
		float atmoWet = gAtmo[ 3 ].x;
		if ( atmoWet > 0.001 ) {
			vec3 atmoWn = inverseTransformDirection( normal, viewMatrix );
			float atmoW = atmoWet * mix( 0.3, 1.0, smoothstep( 0.1, 0.8, atmoWn.y ) );
			diffuseColor.rgb *= mix( 1.0, 0.6, atmoW );
			${standard ? 'roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.3 + 0.04, atmoW * 0.85 );' : ''}
		}
	}
`;

let installed = false;

/** Слага кръпките и споделените униформи. Безопасно е да се вика повече от веднъж. */
export function installAtmo(): void {
  if (installed) return;
  installed = true;
  const SC = THREE.ShaderChunk as unknown as Record<string, string>;
  SC.common = SC.common + '\n' + ATMO_GLSL;
  SC.fog_pars_vertex = fogParsVertex;
  SC.fog_vertex = fogVertex;
  SC.fog_pars_fragment = fogParsFragment;
  SC.fog_fragment = fogFragment;
  SC.shadowmap_pars_fragment = SC.shadowmap_pars_fragment + '\n' + cascadeFns;
  if (dirLoopOld.test(SC.lights_fragment_begin)) SC.lights_fragment_begin = SC.lights_fragment_begin.replace(dirLoopOld, dirLoopNew);
  else console.warn('atmo: lights_fragment_begin не е като очакваното — каскадите са изключени');
  // точковите светлини (огнището, подсветката на героя, огъня на сбора) имат обхват: извън него (почти всички
  // пиксели на тревата, терена и гората) не смятаме BRDF-а напразно — разклонението е еднакво за съседните пиксели
  SC.lights_fragment_begin = SC.lights_fragment_begin.replace(pointLoopOld, pointLoopNew);
  // околната (дифузна) светлина идва от сондата за всички материали; envMap дава само отраженията
  SC.lights_fragment_maps = SC.lights_fragment_maps.replace(
    'iblIrradiance += getIBLIrradiance( geometryNormal );',
    'if ( gAtmo[ 3 ].w < 0.5 ) iblIrradiance += getIBLIrradiance( geometryNormal );');
  SC.lights_lambert_fragment = wetCode(false) + SC.lights_lambert_fragment;
  SC.lights_phong_fragment = wetCode(false) + SC.lights_phong_fragment;
  SC.lights_toon_fragment = wetCode(false) + SC.lights_toon_fragment;
  SC.lights_physical_fragment = wetCode(true) + SC.lights_physical_fragment;
  // униформата във всички вградени шейдъри и в библиотеките, които ShaderMaterial-ите сливат
  const libs = THREE.ShaderLib as unknown as Record<string, { uniforms: Record<string, THREE.IUniform> }>;
  for (const k of Object.keys(libs)) libs[k].uniforms.gAtmo = atmoUniform;
  const UL = THREE.UniformsLib as unknown as Record<string, Record<string, THREE.IUniform>>;
  UL.fog.gAtmo = atmoUniform;
  UL.lights.gAtmo = atmoUniform;
  UL.common.gAtmo = atmoUniform;
}

/** За собствен ShaderMaterial: добави към uniforms (след UniformsUtils.merge). */
export function atmoUniforms(): { gAtmo: THREE.IUniform } { return { gAtmo: atmoUniform }; }
