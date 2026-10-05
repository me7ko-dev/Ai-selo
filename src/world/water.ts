// Вода: езерцето на поляната, реката (скрита, докато Ламята е жива) и локвите в блатото.
// Реалистичен вид: вълнички от шумова текстура (два слоя; по реката — с течението), отражение на небето (PMREM),
// Френел, цвят и прозрачност според дълбочината (бреговете се виждат и меко изчезват), отблясъци от слънцето/луната,
// тъмни брегове/гора в отражението близо до хоризонта, пяна по реката, кръгчета от дъжда.
import * as THREE from 'three';
import { RIVER_PATH } from '../data/layout';
import { riverWaterHeight, POND_WATER_HEIGHT, terrainHeight } from './height';
import { POND } from './plan';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const vert = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute float aT;
attribute float aDepth;
varying vec3 vWorld; varying float vT; varying vec2 vUv; varying float vDepth;
void main() {
	vec4 wp = modelMatrix * vec4( position, 1.0 );
	vWorld = wp.xyz; vT = aT; vUv = uv; vDepth = aDepth;
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}`;

const frag = /* glsl */`
#include <common>
#include <cube_uv_reflection_fragment>
#include <fog_pars_fragment>
uniform sampler2D envMap; uniform float uHasEnv; uniform float uEnvI;
uniform sampler2D tNormal;
uniform float uTime; uniform vec3 uLightDir; uniform vec3 uLightColor; uniform vec3 uAmb;
uniform vec3 uSkyHor; uniform vec3 uSkyTop; uniform vec3 uBank; uniform float uBankH;
uniform vec3 uBody; uniform float uAbsorb; uniform float uRefl; uniform float uRough; uniform float uWave;
uniform float uFlow; uniform float uFront; uniform float uRain; uniform float uFoam; uniform float uFlash;
varying vec3 vWorld; varying float vT; varying vec2 vUv; varying float vDepth;

vec2 nrm( vec2 uv ) { return texture2D( tNormal, uv ).xy * 2.0 - 1.0; }
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
// кръгчета от капките: клетки 0.6 м, всяка със свое време
vec2 ripples( vec2 p, float t ) {
	vec2 acc = vec2( 0.0 );
	for ( int k = 0; k < 2; k ++ ) {
		vec2 q = p / 0.6 + float( k ) * 0.37;
		vec2 c = floor( q ), f = fract( q ) - 0.5;
		float h = h21( c + float( k ) * 7.1 );
		vec2 o = vec2( h21( c + 3.3 ), h21( c + 5.9 ) ) - 0.5;
		vec2 d = f - o * 0.6;
		float r = length( d );
		float ph = fract( t * ( 0.9 + h * 0.6 ) + h );
		float ring = r - ph * 0.45;
		float w = exp( - ring * ring * 900.0 ) * ( 1.0 - ph ) * step( h, 0.85 );
		acc += d / max( r, 1e-3 ) * w * sin( ring * 90.0 );
	}
	return acc;
}

void main() {
	if ( vT > uFront ) discard;
	float t = uTime;
	vec3 Vw = cameraPosition - vWorld;
	float dist = length( Vw );
	vec3 V = Vw / dist;
	// вълнички: по реката — по течението (uv.y е по дължината в метри)
	vec2 n2;
	if ( uFlow > 0.0 ) {
		vec2 q = vec2( vUv.x * 14.0, vUv.y );
		n2 = nrm( vec2( q.x * 0.11, q.y * 0.07 - t * uFlow * 0.07 ) ) * 0.9
		   + nrm( vec2( q.x * 0.27 + 0.3, q.y * 0.19 - t * uFlow * 0.19 ) ) * 0.6
		   + nrm( vec2( q.x * 0.6, q.y * 0.45 - t * uFlow * 0.45 ) ) * 0.3;
	} else {
		vec2 p = vWorld.xz;
		n2 = nrm( p * 0.06 + t * vec2( 0.011, 0.007 ) ) * 0.8
		   + nrm( p * 0.17 - t * vec2( 0.009, 0.016 ) ) * 0.55
		   + nrm( p * 0.43 + t * vec2( -0.02, 0.012 ) ) * 0.25;
	}
	// далеч — по-гладко (иначе трепти)
	n2 *= uWave * ( 1.0 - smoothstep( 25.0, 140.0, dist ) * 0.7 );
	if ( uRain > 0.01 ) n2 += ripples( vWorld.xz, t ) * uRain * 0.9;
	vec3 N = normalize( vec3( n2.x, 1.0, n2.y ) );
	float NoV = max( dot( N, V ), 0.02 );
	float F = 0.02 + 0.98 * pow( 1.0 - NoV, 5.0 );
	F *= uRefl;
	// отражение: небето (PMREM), отдолу към хоризонта — тъмните брегове/гората
	vec3 R = reflect( -V, N );
	R.y = abs( R.y );
	float rough = clamp( uRough + uRain * 0.12, 0.02, 1.0 );
	vec3 sky = mix( uSkyHor, uSkyTop, clamp( R.y * 1.4, 0.0, 1.0 ) );
	#ifdef ENVMAP_TYPE_CUBE_UV
	if ( uHasEnv > 0.5 ) sky = textureCubeUV( envMap, R, rough ).rgb * uEnvI;
	#endif
	vec3 refl = mix( uBank, sky, smoothstep( uBankH * 0.35, uBankH, R.y ) );
	// отблясък от слънцето/луната
	vec3 H = normalize( uLightDir + V );
	float shin = mix( 900.0, 60.0, rough );
	float spec = pow( max( dot( N, H ), 0.0 ), shin ) * ( shin + 8.0 ) / 25.0;
	refl += uLightColor * spec * step( 0.0, uLightDir.y );
	// тялото на водата: светлина, разсеяна вътре (по-синьо-зелено), и дъното, което се вижда близо до брега
	float depth = max( vDepth, 0.0 );
	float path = depth / max( NoV, 0.25 );
	float a = 1.0 - exp( - path * uAbsorb );
	vec3 body = uBody * ( uAmb + uLightColor * max( uLightDir.y, 0.0 ) ) * ( 0.5 + 0.5 * a );
	// пяна: фронтът на прииждащата вода, плитчините на реката
	float foam = smoothstep( uFront - 0.012, uFront, vT ) * step( uFront, 0.999 );
	if ( uFoam > 0.0 ) {
		float fn = texture2D( tNormal, vec2( vUv.x * 1.6, vUv.y * 0.12 - t * uFlow * 0.12 ) ).z;
		foam += smoothstep( 0.55, 0.25, depth + fn * 0.35 ) * uFoam;
		foam += smoothstep( 0.42, 0.5, abs( vUv.x - 0.5 ) ) * 0.35 * uFoam * fn;
	}
	foam = clamp( foam, 0.0, 1.0 ) * smoothstep( 0.0, 0.06, depth );
	vec3 foamCol = ( uAmb + uLightColor * max( uLightDir.y, 0.1 ) ) * 0.25;
	// смесване: отражението е „отгоре“, под него — тялото на водата над дъното (виж blending)
	float outA = 1.0 - ( 1.0 - a ) * ( 1.0 - F );
	vec3 col = ( refl * F + body * a * ( 1.0 - F ) ) / max( outA, 1e-3 );
	col = mix( col, foamCol, foam );
	outA = max( outA, foam );
	// меко изчезване на самия бряг
	outA *= smoothstep( 0.0, 0.05, depth );
	col += vec3( 0.75, 0.8, 1.0 ) * uFlash * F;
	gl_FragColor = vec4( col, outA );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`;

export interface WaterLook {
  /** цвят на светлината, разсеяна във водата (албедо, малко) */
  body: string;
  /** колко бързо „потъмнява“ с дълбочината (1/м) */
  absorb: number;
  refl?: number; rough?: number; wave?: number; flow?: number; foam?: number;
  /** до каква височина (y на отразения лъч) се виждат бреговете/дърветата в отражението */
  bankH?: number;
}

export function waterMaterial(o: WaterLook, normalTex: THREE.Texture | null): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightColor: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.3, 0.35, 0.4) },
    uSkyHor: { value: new THREE.Color(0.3, 0.35, 0.4) }, uSkyTop: { value: new THREE.Color(0.1, 0.2, 0.4) }, uBank: { value: new THREE.Color(0.02, 0.03, 0.02) }, uBankH: { value: o.bankH ?? 0.15 },
    uBody: { value: new THREE.Color(o.body) }, uAbsorb: { value: o.absorb }, uRefl: { value: o.refl ?? 1 }, uRough: { value: o.rough ?? 0.06 }, uWave: { value: o.wave ?? 0.35 },
    uFlow: { value: o.flow ?? 0 }, uFront: { value: 1.01 }, uRain: { value: 0 }, uFoam: { value: o.foam ?? 0 }, uFlash: { value: 0 },
    uHasEnv: { value: 0 }, uEnvI: { value: 1 },
  }]);
  // текстурите — след merge (иначе се клонират)
  uniforms.tNormal = { value: normalTex };
  uniforms.envMap = { value: null };
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag, fog: true, transparent: true, depthWrite: false,
  });
}

/** Обща подкана към водните материали всеки кадър (от World3D). */
export interface WaterFrame {
  time: number; lightDir: THREE.Vector3; lightColor: THREE.Color; amb: THREE.Color; skyHor: THREE.Color; skyTop: THREE.Color; bank: THREE.Color;
  env: THREE.Texture | null; envI: number; rain: number; flash: number;
}

export function updateWater(mat: THREE.ShaderMaterial, f: WaterFrame): void {
  const u = mat.uniforms;
  u.uTime.value = f.time;
  u.uLightDir.value.copy(f.lightDir);
  u.uLightColor.value.copy(f.lightColor);
  u.uAmb.value.copy(f.amb);
  u.uSkyHor.value.copy(f.skyHor); u.uSkyTop.value.copy(f.skyTop); u.uBank.value.copy(f.bank);
  u.uRain.value = f.rain; u.uFlash.value = f.flash; u.uEnvI.value = f.envI;
  if (u.envMap.value !== f.env) {
    u.envMap.value = f.env;
    u.uHasEnv.value = f.env ? 1 : 0;
    const h = (f.env?.image as { height?: number } | undefined)?.height;
    if (f.env && h) {
      const maxMip = Math.log2(h) - 2;
      mat.defines = {
        ENVMAP_TYPE_CUBE_UV: '', CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)), CUBEUV_TEXEL_HEIGHT: 1 / h, CUBEUV_MAX_MIP: maxMip.toFixed(1),
      };
    } else mat.defines = {};
    mat.needsUpdate = true;
  }
}

/** Кръгла мрежа с пръстени (за дълбочината по върховете). */
function disc(r: number, rings: number, seg: number, cx: number, cz: number, y: number, depthAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], dep: number[] = [], ts: number[] = [], idx: number[] = [];
  pos.push(cx, y, cz); uv.push(0.5, 0.5); dep.push(depthAt(cx, cz)); ts.push(0);
  for (let i = 1; i <= rings; i++) {
    const rr = r * Math.pow(i / rings, 0.8);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      pos.push(x, y, z); uv.push(0.5 + Math.cos(a) * rr / (2 * r), 0.5 + Math.sin(a) * rr / (2 * r)); dep.push(depthAt(x, z)); ts.push(0);
    }
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 1; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = 1 + (i - 1) * seg + j, b = 1 + (i - 1) * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function buildPond(normalTex: THREE.Texture | null = null): THREE.Mesh {
  const geo = disc(16, 22, 72, POND.x, POND.z, POND_WATER_HEIGHT, (x, z) => POND_WATER_HEIGHT - terrainHeight(x, z));
  // планинско езерце: бистро, зеленикаво-тъмно в дълбокото; гората наоколо се отразява
  const m = new THREE.Mesh(geo, waterMaterial({ body: '#0b2a2c', absorb: 0.9, refl: 1, rough: 0.04, wave: 0.28, bankH: 0.26 }, normalTex));
  m.renderOrder = 2; m.name = 'pond';
  return m;
}

/** Лента вода по коритото; aT = параметър по дължината 0..1 (0 = изворът). */
export function buildRiver(normalTex: THREE.Texture | null = null): { mesh: THREE.Mesh; length: number } {
  const curve = new THREE.CatmullRomCurve3(RIVER_PATH.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
  const length = curve.getLength();
  const n = Math.ceil(length / 1.5), across = 12, half = 7.5;
  const pos: number[] = [], uv: number[] = [], ts: number[] = [], dep: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = curve.getPointAt(u), tan = curve.getTangentAt(u);
    const nx = -tan.z, nz = tan.x, y = riverWaterHeight(p.x, p.z);
    for (let j = 0; j <= across; j++) {
      const o = (j / across - 0.5) * 2 * half;
      const x = p.x + nx * o, z = p.z + nz * o;
      pos.push(x, y, z); uv.push(j / across, u * length); ts.push(u); dep.push(y - terrainHeight(x, z));
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < across; j++) {
    const a = i * (across + 1) + j, b = a + 1, c = a + across + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = waterMaterial({ body: '#123236', absorb: 1.5, flow: 1.6, refl: 0.95, rough: 0.07, wave: 0.55, foam: 1, bankH: 0.12 }, normalTex);
  // DoubleSide за всеки случай (посоката на лентата)
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2; mesh.name = 'river'; mesh.visible = false;
  return { mesh, length };
}

export function buildSwampPools(pools: { x: number; z: number; r: number; y: number }[], normalTex: THREE.Texture | null = null): THREE.Mesh {
  const geoms = pools.map(p => disc(p.r, 6, 28, p.x, p.z, p.y, (x, z) => p.y - terrainHeight(x, z)));
  const merged = mergeGeometries(geoms, false)!;
  merged.computeBoundingSphere();
  // блатна вода: мътна, кафеникаво-зелена, почти не се вижда дъното, матова
  const m = new THREE.Mesh(merged, waterMaterial({ body: '#1d2410', absorb: 5, refl: 0.55, rough: 0.22, wave: 0.12, bankH: 0.2 }, normalTex));
  m.renderOrder = 2; m.name = 'swamp';
  return m;
}
