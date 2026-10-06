// Небето и светлината на света.
//  • Физична атмосфера: таблица 256×128 (посока → излъчване), смятана на видеокартата от atmosphere.ts при всяка промяна
//    (изгрев/залез, синият час, сянката на Земята идват сами). Нощем — тъмносиньо небе от палитрата + луна.
//  • Куполът: таблицата + слънчев диск + луна с фаза + звезди и Млечен път + облачен слой (осветен от слънцето
//    през атмосферата — розови облаци след залез) + светкавици. Рисува се СЛЕД непрозрачните неща (само видимото небе).
//  • Околна светлина: сферични хармоници (LightProbe) от същия модел (небе + земя) — за всички материали;
//    отражения: PMREM от купола (scene.environment) — за PBR материалите.
//  • Мараня/мъгла: цветовете на хоризонта в 8 посоки → gAtmo (виж engine/atmo.ts), височинна утринна мъгла.
//  • Слънцето/луната — две каскади сенки (близо: остри, далеч: по-груби), закотвени към текселите (без трептене).
//  • Експонацията следи осветеността (нощем окото „свиква“ — по-светло, но синкаво).
import * as THREE from 'three';
import { dayOf, minuteOfDay, sunElevation } from '../core/time';
import { ATMOSPHERE_GLSL, MIE_CLEAR, OBS_ALT, scatter, transmittance } from '../engine/atmosphere';
import { A, ATMO, setAtmoColor, setAtmoVec } from '../engine/atmo';
import { fullscreenTriangle, noiseTextures } from '../engine/noise';
import type { Quality } from './World3D';

function sstep(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
const lerp = THREE.MathUtils.lerp;

/** Слънчева осветеност извън атмосферата (единици на сцената). */
const SUN_E = 3.7;
/** Небето спрямо слънцето: единичното разсейване + грубото многократно дават около половината от истинската яркост. */
const SKY_GAIN = 1.6;
/** Луната — много по-силна от истинската (играе се и нощем), синкава. */
const MOON_E = 0.42;
const MOON_COLOR = new THREE.Color('#b9c8f0');
/** Колко от лунната светлина отива в разсейването на небето (иначе нощното небе става „дневно синьо“). */
const MOON_SKY = 0.1;
/** Нощното небе (въздушно сияние + звезди) — тъмносиньо от палитрата, в единици на сцената. */
const NIGHT_TOP = new THREE.Color(0.0011, 0.0022, 0.0085);
const NIGHT_HOR = new THREE.Color(0.0034, 0.0068, 0.019);
/** Отразеност на земята (трева/пръст) — за отразената светлина отдолу. */
const GROUND_ALBEDO = new THREE.Color(0.14, 0.16, 0.09);

const LUT_W = 256, LUT_H = 128;

/** gloom 0..1 — зловещо притъмняване (Караконджул): облаците са по-тъмни и лилаво-сиви. */
export interface SkyWeather {
  cloud: number; dark: number; fogNear: number; fogFar: number; flash: number; gloom?: number;
  /** плътност на мараната (на метър) */
  haze?: number;
  /** сила на утринната (височинна) мъгла 0..1 */
  mist?: number;
}

// ───────────────────────────── шейдъри ─────────────────────────────

const lutVert = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const lutFrag = /* glsl */`
${ATMOSPHERE_GLSL}
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform float uSunE; uniform float uMoonE;
uniform vec3 uOvercast; uniform float uOvercastMix; uniform vec3 uNightTop; uniform vec3 uNightHor; uniform float uNight;
varying vec2 vUv;
void main() {
	float az = ( vUv.x - 0.5 ) * 6.2831853;
	float s = ( vUv.y - 0.5 ) * 2.0;
	float el = sign( s ) * s * s * 1.5707963;
	vec3 V = vec3( cos( el ) * cos( az ), sin( el ), cos( el ) * sin( az ) );
	vec3 L = vec3( 0.0 );
	if ( uSunE > 0.0 ) L += aScatter( V, uSunDir ) * uSunE;
	if ( uMoonE > 0.0 ) L += aScatter( V, uMoonDir ) * uMoonE;
	float up = max( V.y, 0.0 );
	L = mix( L, uOvercast * ( 1.0 + 2.0 * up ) / 3.0 + L * 0.12, uOvercastMix );
	L += mix( uNightHor, uNightTop, sqrt( up ) ) * uNight;
	gl_FragColor = vec4( L, 1.0 );
}`;

const domeVert = /* glsl */`
varying vec3 vDir;
void main() {
	vDir = position;
	vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
	gl_Position = p.xyww;
}`;

const domeFrag = /* glsl */`
${ATMOSPHERE_GLSL}
uniform sampler2D tLUT; uniform sampler2D tNoise;
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uSunDisk; uniform vec3 uMoonDisk; uniform float uMoonPhase;
uniform float uStars; uniform float uTime; uniform float uPix;
uniform float uCover; uniform float uCloudDark; uniform vec2 uWind; uniform vec3 uCloudAmb; uniform float uSunE; uniform vec3 uMoonLight;
uniform vec3 uCloudTint; uniform vec3 uOvercast; uniform float uOvercastMix;
uniform float uFlash; uniform vec3 uFogColor; uniform float uFogMix; uniform vec3 uGround;
varying vec3 vDir;

float h31( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
vec2 lutUV( vec3 d ) {
	float el = asin( clamp( d.y, -1.0, 1.0 ) );
	return vec2( atan( d.z, d.x ) * 0.15915494 + 0.5, 0.5 + 0.5 * sign( el ) * sqrt( abs( el ) / 1.5707963 ) );
}
vec3 skyLUT( vec3 d ) { return texture2D( tLUT, lutUV( d ) ).rgb; }

// плътност на облаците в точка (км)
float cloudDens( vec2 p ) {
	vec2 q = p * 0.055 + uWind;
	vec4 n = texture2D( tNoise, q );
	float base = n.r * 0.62 + n.g * 0.38;
	float c = base - ( 0.73 - 0.4 * uCover );
	#ifndef ENV
	float det = texture2D( tNoise, q * 4.3 + uWind * 2.1 ).b;
	c -= ( det - 0.5 ) * 0.22 * ( 1.0 - clamp( c * 3.0, 0.0, 1.0 ) );
	#endif
	return clamp( c * ( 3.5 + uCloudDark * 4.0 ), 0.0, 1.0 );
}

#ifndef ENV
float starLayer( vec3 d, float scale, float density ) {
	vec3 p = d * scale;
	vec3 cell = floor( p );
	float h = h31( cell );
	if ( h > density ) return 0.0;
	vec3 sp = cell + 0.25 + 0.5 * vec3( h31( cell + 1.7 ), h31( cell + 3.1 ), h31( cell + 5.9 ) );
	vec3 sd = normalize( sp );
	float a = length( d - sd );
	float r = uPix * 0.75;
	float mag = pow( h31( cell + 9.2 ) , 7.0 ) * 6.0 + 0.12;
	float tw = 0.75 + 0.25 * sin( uTime * ( 1.5 + h * 9.0 ) + h * 60.0 );
	return mag * tw * exp( - a * a / ( r * r ) );
}
#endif

void main() {
	vec3 d = normalize( vDir );
	vec3 col = skyLUT( d );
	float up = d.y;
	#ifdef ENV
	// земята отдолу (за отраженията и околната светлина)
	col = mix( col, uGround, smoothstep( 0.0, -0.08, up ) );
	#else
	// звезди и Млечен път (зад всичко останало)
	if ( uStars > 0.01 && up > -0.05 ) {
		float st = starLayer( d, 140.0, 0.09 ) + starLayer( d, 260.0, 0.05 ) * 0.5;
		vec3 mwN = normalize( vec3( 0.35, 0.42, 0.84 ) );
		float band = exp( - pow( dot( d, mwN ) / 0.2, 2.0 ) );
		vec4 nn = texture2D( tNoise, vec2( atan( d.z, d.x ) * 0.6, d.y * 1.4 ) );
		float mw = band * ( 0.35 + 0.65 * nn.a ) * ( 1.0 - 0.55 * smoothstep( 0.45, 0.7, nn.r ) * band );
		vec3 stars = vec3( 0.9, 0.93, 1.0 ) * st * 0.035 + vec3( 0.75, 0.78, 0.95 ) * mw * 0.0035;
		col += stars * uStars * smoothstep( -0.02, 0.18, up );
	}
	// луна: диск с фаза и тъмни „морета“, сияние около нея
	{
		float md = dot( d, uMoonDir );
		if ( md > 0.99 ) {
			float R = 0.0105;
			vec3 e1 = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) );
			vec3 e2 = cross( e1, uMoonDir );
			vec2 uv = vec2( dot( d, e1 ), dot( d, e2 ) ) / R;
			float r = length( uv );
			float disk = 1.0 - smoothstep( 1.0 - uPix / R * 1.2, 1.0, r );
			vec3 nrm = vec3( uv, sqrt( max( 0.0, 1.0 - r * r ) ) );
			vec3 ldir = vec3( sin( uMoonPhase ), 0.15, cos( uMoonPhase ) );
			float lit = smoothstep( -0.04, 0.12, dot( nrm, normalize( ldir ) ) );
			vec4 mn = texture2D( tNoise, uv * 0.18 + 0.3 );
			float maria = 0.72 + 0.28 * smoothstep( 0.35, 0.65, mn.r ) - 0.12 * smoothstep( 0.5, 0.8, mn.g );
			col = mix( col, uMoonDisk * ( maria * lit + 0.012 ), disk );
			col += uMoonDisk * 0.0016 * exp( - ( 1.0 - md ) * 900.0 );
		}
	}
	// слънчев диск (с потъмняване към ръба)
	{
		float sd = dot( d, uSunDir );
		if ( sd > 0.9995 && up > -0.02 ) {
			float a = sqrt( max( 0.0, 2.0 * ( 1.0 - sd ) ) ) / 0.0055;
			float disk = 1.0 - smoothstep( 1.0 - uPix / 0.0055, 1.0, a );
			float limb = 1.0 - 0.55 * ( 1.0 - sqrt( max( 0.0, 1.0 - a * a ) ) );
			col += uSunDisk * disk * limb;
		}
	}
	#endif
	// облаци: слой на 1.6 км над наблюдателя (по извивката на Земята)
	if ( up > 0.0 && uCover > 0.02 ) {
		vec3 O = vec3( 0.0, A_RE + ${OBS_ALT.toFixed(1)}, 0.0 );
		float t = aSphere( O, d, A_RE + ${OBS_ALT.toFixed(1)} + 1600.0 ).y;
		vec3 P = O + d * t;
		vec2 xz = P.xz * 0.001;
		float den = cloudDens( xz );
		if ( den > 0.002 ) {
			// светлината: слънцето (през атмосферата до облака — розово след залез) и луната
			vec3 Ls = normalize( uSunDir );
			float toL = cloudDens( xz + Ls.xz / max( Ls.y, 0.12 ) * 0.35 );
			float self = exp( - toL * 2.2 ) * ( 1.0 - exp( - den * 3.0 ) * 0.4 );
			float mu = dot( d, Ls );
			float ph = mix( aPhaseM( mu, 0.6 ), aPhaseM( mu, -0.15 ), 0.45 ) * 12.566;
			vec3 sunAt = uSunE > 0.0 ? aSunTrans( P, Ls ) * uSunE : vec3( 0.0 );
			vec3 lit = sunAt * ( self * ph * 0.42 + 0.06 ) * ( 1.0 - uCloudDark * 0.85 );
			float muM = dot( d, uMoonDir );
			lit += uMoonLight * ( self * mix( aPhaseM( muM, 0.6 ), 0.08, 0.5 ) * 2.0 + 0.02 ) * ( 1.0 - uCloudDark * 0.7 );
			vec3 amb = uCloudAmb * ( 1.0 - den * 0.6 );
			vec3 cc = ( lit + amb ) * uCloudTint;
			// гъсто покритие → равномерна сива пелена с леки форми
			cc = mix( cc, uOvercast * ( 0.75 + 0.5 * ( 1.0 - den ) ) * uCloudTint, uOvercastMix * 0.6 );
			cc += vec3( 0.75, 0.8, 1.0 ) * uFlash * 2.5 * den;
			float alpha = ( 1.0 - exp( - den * 5.0 ) ) * smoothstep( 0.0, 0.07, up );
			// въздушна перспектива: далечните облаци се губят в небето
			float ap = 1.0 - exp( - t / 42000.0 );
			cc = mix( cc, col, ap * 0.9 );
			col = mix( col, cc, alpha );
		}
	}
	col += vec3( 0.75, 0.8, 1.0 ) * uFlash * 0.25;
	// гъста мъгла: и небето се губи в нея
	col = mix( col, uFogColor, uFogMix * ( 1.0 - smoothstep( 0.0, 0.6, up ) * 0.35 ) );
	gl_FragColor = vec4( col, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

// ───────────────────────────── помощни ─────────────────────────────

/** Фибоначи посоки по цялата сфера (за сондата). */
function fibDirs(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), a = i * ga;
    out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return out;
}
const PROBE_DIRS = fibDirs(64);
const HAZE_DIRS = Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2 - Math.PI; return new THREE.Vector3(Math.cos(a) * 0.9994, 0.035, Math.sin(a) * 0.9994); });
const ZENITH_DIR = new THREE.Vector3(0, 1, 0);

// ───────────────────────────── системата ─────────────────────────────

export class SkySystem {
  readonly dome: THREE.Mesh;
  /** главната светлина (слънце денем, луна нощем) — близката каскада */
  readonly sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  /** далечната каскада (интензитет 0 — дава само сянката) */
  readonly sunFar = new THREE.DirectionalLight('#ffffff', 0);
  /** запазена за съвместимост; светва само при светкавица */
  readonly hemi = new THREE.HemisphereLight('#cfe3f0', '#5e7a45', 0);
  /** околната светлина от небето (сферични хармоници) */
  readonly probe = new THREE.LightProbe();
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, 1, 0);
  /** посоката на светлината, която хвърля сенки (слънце денем, луна нощем) */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  /** цвят на небето на хоризонта / горе (линейни, единици на сцената) — за водата и др. */
  readonly horizon = new THREE.Color();
  readonly top = new THREE.Color();
  readonly fog: THREE.Fog;
  readonly u: Record<string, THREE.IUniform>;
  shadowExtent = 18;
  night = 0;      // 0 ден … 1 нощ
  twilight = 0;
  weather: SkyWeather = { cloud: 0.3, dark: 0, fogNear: 70, fogFar: 560, flash: 0 };
  /** добавка към плътността на мъглата (блатото, гората) */
  localFog = 0;
  /** 0..1 — колко сме под короните на гората (по-малко небе → по-слаба околна светлина) */
  canopy = 0;
  /** препоръчана експонация (Engine я плъзга плавно) */
  exposure = 1;
  /** 0..1 — нощен вид (обезцветяване, синкаво) за пост-обработката */
  nightLook = 0;
  /** осветеността (за водата): цвят × сила на главната светлина */
  readonly lightColor = new THREE.Color();
  /** PMREM на небето — scene.environment */
  envTexture: THREE.Texture | null = null;

  private renderer: THREE.WebGLRenderer;
  private lutRT: THREE.WebGLRenderTarget;
  private lutScene = new THREE.Scene();
  private lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lutU: Record<string, THREE.IUniform>;
  private envScene = new THREE.Scene();
  private envMat: THREE.ShaderMaterial;
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private pmremRT: THREE.WebGLRenderTarget | null = null;
  private envSize = 128;
  private envSig = new Float32Array(8).fill(-99);
  private envAge = 99;
  private quality: Quality = 'high';
  private shadowsOn = true;
  private farExtent = 100;
  private farFocus = new THREE.Vector3(1e9, 0, 0);
  private farDir = new THREE.Vector3();
  private farFrame = -99;
  private frame = 0;
  private cpuAge = 99;
  private cpuSig = new Float32Array(8).fill(-99);
  private shTarget = new THREE.SphericalHarmonics3();
  private shReady = false;
  private shadowDir = new THREE.Vector3(0, 1, 0);
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private skyE = 0;      // осветеност на хоризонтална повърхност от небето
  private directE = 0;   // от слънцето/луната
  private moonPhase = 0;
  private sunCloudVis = 1;
  private clearE = 0;
  private wind = new THREE.Vector2(0.37, 0.61);
  readonly haze = Array.from({ length: 8 }, () => new THREE.Color());
  readonly zenith = new THREE.Color();

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const noise = noiseTextures(renderer);
    // таблицата на небето
    this.lutRT = new THREE.WebGLRenderTarget(LUT_W, LUT_H, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.lutU = {
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uSunE: { value: SUN_E }, uMoonE: { value: 0 },
      uMie: { value: MIE_CLEAR }, uMieG: { value: 0.8 },
      uOvercast: { value: new THREE.Color() }, uOvercastMix: { value: 0 },
      uNightTop: { value: NIGHT_TOP.clone() }, uNightHor: { value: NIGHT_HOR.clone() }, uNight: { value: 0 },
    };
    const lutMesh = new THREE.Mesh(fullscreenTriangle(), new THREE.ShaderMaterial({ uniforms: this.lutU, vertexShader: lutVert, fragmentShader: lutFrag, depthTest: false, depthWrite: false }));
    lutMesh.frustumCulled = false;
    this.lutScene.add(lutMesh);

    // куполът
    this.u = {
      tLUT: { value: this.lutRT.texture }, tNoise: { value: noise.cloud },
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uSunDisk: { value: new THREE.Color() }, uMoonDisk: { value: new THREE.Color() }, uMoonPhase: { value: 0 },
      uStars: { value: 0 }, uTime: { value: 0 }, uPix: { value: 0.001 },
      uCover: { value: 0.3 }, uCloudDark: { value: 0 }, uWind: { value: this.wind }, uCloudAmb: { value: new THREE.Color() }, uSunE: { value: SUN_E }, uMoonLight: { value: new THREE.Color() },
      uCloudTint: { value: new THREE.Color(1, 1, 1) }, uOvercast: { value: this.lutU.uOvercast.value }, uOvercastMix: this.lutU.uOvercastMix,
      uFlash: { value: 0 }, uFogColor: { value: new THREE.Color() }, uFogMix: { value: 0 }, uGround: { value: new THREE.Color() },
      uMie: this.lutU.uMie, uMieG: this.lutU.uMieG,
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: domeVert, fragmentShader: domeFrag, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    // след всички непрозрачни (рисува само там, където няма нищо) и преди прозрачните
    this.dome.frustumCulled = false; this.dome.renderOrder = 900; this.dome.name = 'sky';
    scene.add(this.dome);

    // небето за отраженията (без диск, звезди и луна; със земя отдолу)
    this.envMat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: domeVert, fragmentShader: domeFrag, side: THREE.BackSide, depthWrite: false, depthTest: false, defines: { ENV: '' } });
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.envMat);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(this.envSize, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false });
    this.cubeCam = new THREE.CubeCamera(0.5, 2000, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.fog = new THREE.Fog('#c9dbe6', 70, 560);
    scene.fog = this.fog;

    // сенки: две каскади
    for (const l of [this.sun, this.sunFar]) {
      l.castShadow = true;
      l.shadow.mapSize.set(2048, 2048);
      l.shadow.camera.near = 1; l.shadow.camera.far = 700;
      l.shadow.bias = -0.0002;
    }
    this.sun.shadow.normalBias = 0.03;
    this.sunFar.shadow.normalBias = 0.12;
    this.sun.name = 'sun'; this.sunFar.name = 'sunFarCascade';
    // редът е важен: близката каскада е светлина №0 (виж atmo.ts)
    scene.add(this.sun, this.sun.target, this.sunFar, this.sunFar.target, this.hemi, this.probe);
    this.setQuality('high');
  }

  /** Качество: сенки (каскади), размер на отраженията. */
  setQuality(q: Quality): void {
    this.quality = q;
    const near = this.sun.shadow, far = this.sunFar.shadow;
    near.map?.dispose(); near.map = null; far.map?.dispose(); far.map = null;
    if (q === 'high') {
      this.sun.castShadow = this.shadowsOn; this.sunFar.castShadow = this.shadowsOn;
      // далечната каскада е мека (±110 м) — 1024 стига и пести запълване на GTX 1650
      near.mapSize.set(2048, 2048); far.mapSize.set(1024, 1024);
      this.shadowExtent = 20; this.farExtent = 110;
      near.normalBias = 0.03; far.normalBias = 0.14;
      this.envSize = 128;
    } else if (q === 'medium') {
      this.sun.castShadow = this.shadowsOn; this.sunFar.castShadow = false;
      near.mapSize.set(2048, 2048);
      this.shadowExtent = 50; this.farExtent = 50;
      near.normalBias = 0.07;
      this.envSize = 64;
    } else {
      this.sun.castShadow = false; this.sunFar.castShadow = false;
      this.shadowExtent = 40; this.farExtent = 40;
      this.envSize = 32;
    }
    this.setShadowExtent(this.shadowExtent);
    const fc = this.sunFar.shadow.camera;
    fc.left = -this.farExtent; fc.right = this.farExtent; fc.top = this.farExtent; fc.bottom = -this.farExtent; fc.updateProjectionMatrix();
    setAtmoVec(A.SHADOW, 0.14, this.sunFar.castShadow ? 1 : 0, 0, 0);
    if (this.cubeRT.width !== this.envSize) {
      this.cubeRT.dispose();
      this.cubeRT = new THREE.WebGLCubeRenderTarget(this.envSize, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false });
      this.cubeCam = new THREE.CubeCamera(0.5, 2000, this.cubeRT);
      this.pmremRT?.dispose(); this.pmremRT = null;
    }
    this.envAge = 99;
  }

  /** Сенките вкл./изкл. (настройката „Сенки“). */
  setShadows(on: boolean): void { this.shadowsOn = on; this.setQuality(this.quality); }

  setShadowExtent(e: number): void {
    this.shadowExtent = e;
    const c = this.sun.shadow.camera;
    c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.updateProjectionMatrix();
  }

  /** Осветеността (rgb) на повърхност с нормала n от околната светлина (сондата). */
  irradiance(n: THREE.Vector3, out: THREE.Color): THREE.Color {
    const v = this.probe.sh.getIrradianceAt(n, this.irrV);
    return out.setRGB(v.x, v.y, v.z).multiplyScalar(this.probe.intensity);
  }
  private irrV = new THREE.Vector3();

  /** Излъчването на небето в посока V (CPU, същото като таблицата) — без облаците. */
  private skyRadiance(V: THREE.Vector3, sunE: number, moonE: number, mie: number, ocMix: number, oc: THREE.Color, night: number, out: THREE.Color): THREE.Color {
    out.setRGB(0, 0, 0);
    if (sunE > 0) out.add(scatter(V, this.sunDir, mie, 0.8, this.tmpC2, 10).multiplyScalar(sunE));
    if (moonE > 0) out.add(scatter(V, this.moonDir, mie, 0.8, this.tmpC2, 10).multiplyScalar(moonE));
    const up = Math.max(V.y, 0);
    if (ocMix > 0) {
      const f = (1 + 2 * up) / 3;
      out.setRGB(lerp(out.r, oc.r * f + out.r * 0.12, ocMix), lerp(out.g, oc.g * f + out.g * 0.12, ocMix), lerp(out.b, oc.b * f + out.b * 0.12, ocMix));
    }
    const s = Math.sqrt(up);
    out.r += lerp(NIGHT_HOR.r, NIGHT_TOP.r, s) * night;
    out.g += lerp(NIGHT_HOR.g, NIGHT_TOP.g, s) * night;
    out.b += lerp(NIGHT_HOR.b, NIGHT_TOP.b, s) * night;
    return out;
  }

  update(totalMinutes: number, camera: THREE.Camera, focus: THREE.Vector3, timeSec: number, dt = 1 / 60): void {
    this.frame++;
    const e = sunElevation(totalMinutes);
    const h = minuteOfDay(totalMinutes) / 60;
    // посока на слънцето: изгрев на изток (+x), залез на запад (-x), по пладне на юг (+z), високо
    const dayT = Math.min(1, Math.max(0, (h - 6) / 14));
    const az = Math.PI * dayT;
    this.sunDir.set(Math.cos(az) * 0.95, e, 0.38 + 0.2 * Math.sin(az)).normalize();
    const nh = h >= 20 ? h - 20 : h < 6 ? h + 4 : -1;
    const moonT = nh >= 0 ? nh / 10 : (h < 13 ? 1 : 0);
    const mAz = Math.PI * moonT;
    const mEl = nh >= 0 ? Math.sin(moonT * Math.PI) * 0.8 : -0.3;
    this.moonDir.set(Math.cos(mAz) * 0.9, mEl, -0.45).normalize();
    // фазата на луната: 12-дневен цикъл между пълнолуние и широк сърп (никога съвсем тъмно)
    const day = dayOf(totalMinutes) + h / 24;
    this.moonPhase = Math.PI * 0.62 * (0.5 - 0.5 * Math.cos((day / 12) * Math.PI * 2));

    const dayW = sstep(0.04, 0.4, e);
    const nightW = sstep(-0.02, -0.26, e);
    const twW = Math.max(0, 1 - dayW - nightW);
    this.night = nightW; this.twilight = twW;
    const w = this.weather;
    const gl = w.gloom ?? 0;
    const cover = Math.min(1, w.cloud), dk = w.dark;

    // вятърът мести облаците
    this.wind.x += dt * 0.0016 * (1 + dk * 2); this.wind.y += dt * 0.0007 * (1 + dk * 2);

    // ── светлината ──
    const mie = MIE_CLEAR * (1 + dk * 2.5 + Math.min(1, (w.haze ?? 0.001) * 400) * 1.5);
    const T = transmittance(this.sunDir, mie, this.tmpC);
    const sunVis = sstep(-0.06, 0.0, this.sunDir.y);
    // облаците закриват слънцето (рядко — на петна; гъсто — почти изцяло)
    // мъглата/мараната разсейва прекия лъч (в гъста мъгла сенките почти изчезват)
    const hzNow = (w.haze ?? 0.001) * (1 + this.localFog * 1.5);
    this.sunCloudVis = (1 - sstep(0.5, 0.98, cover) * 0.92) * (1 - gl * 0.75) * (1 - dk * 0.35) * Math.exp(-hzNow * 55);
    const sunR = SUN_E * T.r * this.sunCloudVis, sunG = SUN_E * T.g * this.sunCloudVis, sunB = SUN_E * T.b * this.sunCloudVis;
    const moonUp = sstep(-0.05, 0.12, this.moonDir.y);
    const moonLight = MOON_E * moonUp * (0.75 + 0.25 * Math.cos(this.moonPhase)) * (1 - sstep(0.6, 1.0, cover) * 0.6) * (1 - dk * 0.5);
    const useMoon = this.sunDir.y < -0.02;
    const L = useMoon ? this.moonDir : this.sunDir;
    // посоката за сенките се сменя на малки стъпки (иначе сенките „пълзят“ и трептят)
    const want = this.tmpV.copy(L);
    if (want.y < 0.12) want.y = 0.12;
    want.normalize();
    if (want.angleTo(this.shadowDir) > 0.0035) this.shadowDir.copy(want);
    this.lightDir.copy(this.shadowDir);
    if (!useMoon) {
      const m = Math.max(sunR, sunG, sunB, 1e-6);
      this.sun.color.setRGB(sunR / m, sunG / m, sunB / m);
      // утрото е по-хладно от залеза (по-чист въздух): ниското слънце сутрин — по-малко оранжево
      const morn = (h < 12 ? 1 : 0) * (1 - sstep(0.1, 0.45, this.sunDir.y));
      if (morn > 0) {
        const c = this.sun.color, l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
        c.lerp(this.tmpC2.setRGB(l * 0.98, l, l * 1.04), 0.35 * morn);
        c.multiplyScalar(1 / Math.max(c.r, c.g, c.b, 1e-6));
      }
      this.sun.intensity = m * sunVis;
    } else {
      this.sun.color.copy(MOON_COLOR);
      this.sun.intensity = moonLight * sstep(-0.02, -0.12, e);
    }
    this.lightColor.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    // за експонацията: средно между хоризонтална и обърната към светлината повърхност (иначе при залез всичко прегаря)
    this.directE = this.sun.intensity * (Math.max(0.05, this.lightDir.y) + 1) * 0.5;

    // ── таблицата на небето ──
    const sunE = this.sunDir.y > -0.25 ? SUN_E * SKY_GAIN : 0;
    const moonE = MOON_E * MOON_SKY * moonUp;
    const ocMix = Math.min(1, sstep(0.35, 1.0, cover) * 0.95 + gl * 0.9);
    this.lutU.uSunE.value = sunE;
    this.lutU.uMoonE.value = moonE;
    this.lutU.uMie.value = mie;
    this.lutU.uMieG.value = lerp(0.8, 0.65, dk);
    // нощното синьо идва още в „синия час“ (слънцето под хоризонта)
    const blue = Math.max(nightW, sstep(-0.005, -0.14, this.sunDir.y));
    this.lutU.uNight.value = blue * (1 - dk * 0.5);
    // облачна пелена: светлината на ясното небе, разсеяна от облаците (CIE облачно небе), по-тъмна при дъжд/буря
    const oc = this.lutU.uOvercast.value as THREE.Color;
    const ocLum = Math.max(this.clearE, 0.0004) * (1 - dk * 0.78) * (1 - gl * 0.6) * 9 / (7 * Math.PI);
    oc.setRGB(0.93, 0.97, 1.06).multiplyScalar(ocLum);
    if (gl > 0) oc.lerp(this.tmpC2.setRGB(0.5, 0.44, 0.6).multiplyScalar(ocLum), gl);
    this.lutU.uOvercastMix.value = ocMix;
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.lutRT);
    this.renderer.render(this.lutScene, this.lutCam);
    this.renderer.setRenderTarget(prevRT);

    // ── CPU: сонда, мараня, експонация (не всеки кадър) ──
    this.cpuAge += dt;
    const sig = [this.sunDir.x, this.sunDir.y, this.moonDir.y, cover, dk, gl, nightW, mie * 1e5];
    let changed = false;
    for (let i = 0; i < 8; i++) if (Math.abs(sig[i] - this.cpuSig[i]) > 0.004) changed = true;
    if (!this.shReady || (changed && this.cpuAge > 0.25) || this.cpuAge > 2) {
      this.cpuAge = 0;
      for (let i = 0; i < 8; i++) this.cpuSig[i] = sig[i];
      this.updateCpu(sunE, moonE, mie, ocMix, oc, blue * (1 - dk * 0.5), cover);
    }
    // плавно към целта
    const kk = this.shReady ? 1 - Math.exp(-dt * 3) : 1;
    const sh = this.probe.sh.coefficients, tg = this.shTarget.coefficients;
    for (let i = 0; i < 9; i++) sh[i].lerp(tg[i], kk);
    this.shReady = true;
    const canopy = 1 - this.canopy * 0.5;
    this.probe.intensity = canopy;
    this.scene.environmentIntensity = canopy * (1 - this.canopy * 0.2);

    // ── куполът ──
    const u = this.u;
    (u.uSunDisk.value as THREE.Color).setRGB(T.r, T.g, T.b).multiplyScalar(SUN_E * 26 * sunVis * (1 - sstep(0.75, 1.0, cover) * 0.97) * (1 - gl));
    (u.uMoonDisk.value as THREE.Color).setRGB(0.957, 0.925, 0.816).multiplyScalar(0.55 * moonUp * (1 - dk * 0.6));
    u.uMoonPhase.value = this.moonPhase;
    u.uStars.value = nightW * (1 - Math.min(1, cover * 1.1)) * (1 - dk) + nightW * 0.05;
    u.uTime.value = timeSec;
    const cam = camera as THREE.PerspectiveCamera;
    u.uPix.value = ((cam.fov ?? 60) * Math.PI / 180) / Math.max(1, this.renderer.domElement.height);
    u.uCover.value = Math.max(cover, gl * 0.97);
    u.uCloudDark.value = Math.min(1, dk * 0.9 + gl * 0.6);
    u.uSunE.value = (sunE / SKY_GAIN) * this.sunCloudVis / Math.max(0.08, 1 - sstep(0.5, 0.98, cover) * 0.92);
    (u.uMoonLight.value as THREE.Color).copy(MOON_COLOR).multiplyScalar(moonLight * MOON_SKY * 1.5);
    // облаците отдолу: осветени от небето (по-тъмни от него нощем)
    (u.uCloudAmb.value as THREE.Color).copy(this.zenith).multiplyScalar(lerp(2.2, 0.9, nightW)).add(this.tmpC2.copy(this.haze[0]).multiplyScalar(0.3));
    (u.uCloudTint.value as THREE.Color).setRGB(1, 1, 1).lerp(this.tmpC2.setRGB(0.62, 0.55, 0.72), gl);
    u.uFlash.value = w.flash;
    // гъстата мъгла поглъща и небето
    const fogC = u.uFogColor.value as THREE.Color;
    fogC.setRGB(0, 0, 0); for (const c of this.haze) fogC.add(c); fogC.multiplyScalar(1 / 8);
    const hz = (w.haze ?? 0.001) * (1 + this.localFog * 2.5);
    u.uFogMix.value = sstep(0.004, 0.03, hz) * 0.97;
    (u.uGround.value as THREE.Color).copy(GROUND_ALBEDO).multiplyScalar((this.directE * 0.75 + this.skyE) / Math.PI);

    // ── мъгла: gAtmo ──
    this.fog.color.copy(fogC);
    const lf = this.localFog;
    this.fog.near = w.fogNear * (1 - lf * 0.9);
    this.fog.far = w.fogFar * (1 - lf * 0.75);
    setAtmoVec(A.LIGHT, this.lightDir.x, this.lightDir.y, this.lightDir.z, 1);
    const ins = this.tmpC2.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.02 * (1 - dk * 0.6));
    setAtmoVec(A.INSCATTER, ins.r, ins.g, ins.b, 1);
    // утринна мъгла в низините + местна (гора, блато)
    const mist = (w.mist ?? 0) * 0.008 + lf * 0.01;
    setAtmoVec(A.FOG, hz, mist, 7 + lf * 5, -1);
    // при чист въздух синьото се разсейва повече (Рейли) → далечните склонове посиняват; в мъгла/дъжд — сиво
    const grey = sstep(0.0012, 0.006, hz);
    setAtmoVec(A.HAZE_TINT, lerp(0.66, 1, grey), lerp(0.9, 1, grey), lerp(1.35, 1, grey), 0);
    // мъглата в низините: светлината от цялото небе (отгоре и встрани) + малко пряко слънце, бяла (албедо ~0.85)
    const mc = this.irradiance(this.tmpV.set(0, 1, 0), this.tmpC2).multiplyScalar(0.5);
    mc.add(this.irradiance(this.tmpV.set(0.7, 0, 0.7), this.tmpC).multiplyScalar(0.5));
    mc.add(this.tmpC.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.35));
    mc.multiplyScalar(0.85 / Math.PI);
    setAtmoVec(A.MIST, mc.r, mc.g, mc.b, 0);
    for (let k = 0; k < 8; k++) setAtmoColor(A.HAZE0 + k, this.haze[k], 0);
    setAtmoVec(A.ZENITH, this.zenith.r, this.zenith.g, this.zenith.b, nightW);
    // време и „околната светлина е от сондата“ (мокротата/дъждът се пишат от World3D)
    ATMO[A.MISC * 4 + 2] = timeSec % 1000; ATMO[A.MISC * 4 + 3] = 1;

    // ── експонация ──
    const Ek = this.directE + this.skyE;
    const ex = Math.pow(3.4 / Math.max(Ek, 1e-4), 0.5);
    // при буря/Караконджул окото не „свиква“ напълно — да е мрачно
    const maxEx = lerp(3.4, 1.9, Math.max(gl, dk * 0.7));
    this.exposure = Math.min(maxEx, Math.max(0.6, ex));
    this.nightLook = sstep(0.35, 0.03, Ek) * 0.5;

    // ── отраженията (PMREM) — рядко ──
    this.envAge += dt;
    const es = [this.sunDir.x, this.sunDir.y, this.moonDir.y, cover, dk, gl, nightW, hz * 40];
    let envChanged = false;
    for (let i = 0; i < 8; i++) if (Math.abs(es[i] - this.envSig[i]) > 0.01) envChanged = true;
    if (!this.envTexture || (envChanged && this.envAge > 0.5) || this.envAge > 6) {
      this.envAge = 0;
      for (let i = 0; i < 8; i++) this.envSig[i] = es[i];
      this.updateEnv();
    }

    // ── куполът и сенките следват камерата/героя ──
    this.dome.position.copy(camera.position);
    this.placeCascade(this.sun, focus, this.shadowExtent, 260);
    if (this.sunFar.castShadow) {
      // далечната каскада се прерисува рядко: при преместване (> 8 м), смяна на посоката или веднъж в секунда (~90 кадъра) — всяко прерисуване е засичане от десетки ms на GTX 1650
      // (в гората е най-скъпото нещо — хиляди дървета)
      this.sunFar.shadow.autoUpdate = false;
      const moved = this.farFocus.distanceToSquared(focus) > 64 || !this.farDir.equals(this.lightDir);
      if (moved || this.frame - this.farFrame >= 90) {
        this.placeCascade(this.sunFar, focus, this.farExtent, 320);
        this.sunFar.shadow.needsUpdate = true;
        this.farFocus.copy(focus); this.farDir.copy(this.lightDir); this.farFrame = this.frame;
      }
    }
  }

  /** Слага каскадата около точката с отместване, закотвено към текселите в пространството на светлината. */
  private placeCascade(l: THREE.DirectionalLight, focus: THREE.Vector3, ext: number, dist: number): void {
    const z = this.lightDir;
    const x = this.tmpV.set(0, 1, 0).cross(z);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    const texel = (ext * 2) / l.shadow.mapSize.x;
    const fx = Math.round(focus.dot(x) / texel) * texel;
    const fy = Math.round(focus.dot(y) / texel) * texel;
    const fz = focus.dot(z);
    const c = new THREE.Vector3().addScaledVector(x, fx).addScaledVector(y, fy).addScaledVector(z, fz);
    l.target.position.copy(c);
    l.position.copy(c).addScaledVector(z, dist);
    l.target.updateMatrixWorld();
    l.updateMatrixWorld();
  }

  /** Сондата (сферични хармоници), цветовете на мараната, осветеността — на процесора. */
  private updateCpu(sunE: number, moonE: number, mie: number, ocMix: number, oc: THREE.Color, night: number, cover: number): void {
    const c = new THREE.Color();
    // осветеност на ясното небе (за облачната пелена) — груба оценка от няколко посоки
    let clear = 0;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const v = this.tmpV.set(Math.cos(a) * 0.7, 0.714, Math.sin(a) * 0.7);
      this.skyRadiance(v, sunE, moonE, mie, 0, oc, 0, c);
      clear += (c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
    }
    this.clearE = clear / 6 * Math.PI + this.directClear(sunE);
    // небето в посоките на сондата
    const sh = this.shTarget; sh.zero();
    const sky: THREE.Color[] = [];
    let skyE = 0;
    for (const d of PROBE_DIRS) {
      const col = new THREE.Color();
      if (d.y > -0.02) this.skyRadiance(d, sunE, moonE, mie, ocMix, oc, night, col);
      else col.setRGB(0, 0, 0);
      // облаците: по-светло и по-бяло при частична облачност
      if (d.y > 0 && cover > 0.3 && ocMix < 1) col.lerp(this.tmpC2.copy(oc).multiplyScalar((1 + 2 * d.y) / 3 * 1.1), (cover - 0.3) * 0.35 * (1 - ocMix));
      sky.push(col);
      if (d.y > 0) skyE += (col.r * 0.2126 + col.g * 0.7152 + col.b * 0.0722) * d.y;
    }
    // ∫ L cosθ dω ≈ сума · (4π/N)
    this.skyE = skyE * (4 * Math.PI / PROBE_DIRS.length);
    // земята отдолу: отразена светлина
    const gE = (this.directE * 0.7 + this.skyE);
    const ground = this.tmpC2.copy(GROUND_ALBEDO).multiplyScalar(gE / Math.PI);
    for (let i = 0; i < PROBE_DIRS.length; i++) {
      const d = PROBE_DIRS[i];
      if (d.y <= -0.02) sky[i].copy(ground);
      THREE.SphericalHarmonics3.getBasisAt(d, this.basisArr);
      for (let k = 0; k < 9; k++) sh.coefficients[k].addScaledVector(this.tmpV.set(sky[i].r, sky[i].g, sky[i].b), this.basisArr[k] * (4 * Math.PI / PROBE_DIRS.length));
    }
    // мараната: хоризонтът в 8 посоки + небето нагоре
    for (let k = 0; k < 8; k++) {
      this.skyRadiance(HAZE_DIRS[k], sunE, moonE, mie, ocMix, oc, night, this.haze[k]);
      // мараната е осветена и отгоре — малко по-светла и по-сива от самия хоризонт при облаци
      if (cover > 0.3) this.haze[k].lerp(this.tmpC.copy(oc).multiplyScalar(0.5), (cover - 0.3) * 0.25 * (1 - ocMix));
    }
    this.skyRadiance(ZENITH_DIR, sunE, moonE, mie, ocMix, oc, night, this.zenith);
    // цветът на небето (за водата и др.)
    this.horizon.copy(this.haze[0]).add(this.haze[4]).multiplyScalar(0.5);
    this.top.copy(this.zenith);
  }
  private basisArr: number[] = new Array(9).fill(0);
  private directClear(sunE: number): number {
    if (sunE <= 0) return 0;
    const T = transmittance(this.sunDir, MIE_CLEAR, this.tmpC2);
    return SUN_E * (T.r * 0.2126 + T.g * 0.7152 + T.b * 0.0722) * Math.max(0, this.sunDir.y);
  }

  /** Отраженията: куполът (без диска, със земя) → куб → PMREM. */
  private updateEnv(): void {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    this.cubeCam.update(r, this.envScene);
    if (!this.pmremRT) this.pmremRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    else this.pmrem.fromCubemap(this.cubeRT.texture, this.pmremRT);
    r.setRenderTarget(prevTarget);
    if (this.envTexture !== this.pmremRT.texture) {
      this.envTexture = this.pmremRT.texture;
      this.scene.environment = this.envTexture;
    }
  }
}

