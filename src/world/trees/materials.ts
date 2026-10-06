// Материали за растенията: MeshStandardMaterial (PBR — реагира на новата светлина/небе) + добавки в шейдъра:
//  • вятър — цялото дърво се огъва, клоните се люлеят, листата трептят;
//  • плавна смяна на нивата на детайл (LOD) с „решетка“ (dither) — двете нива се допълват пиксел по пиксел;
//  • разтваряне на дърветата между камерата и героя (както досега fadingTreeMaterial);
//  • листата: „закръглени“ нормали и светлина през листата (когато слънцето е зад тях).
// Същите добавки (без разтварянето) има и дълбочинният материал за сенките.
import * as THREE from 'three';

/** Общи стойности за всички растения — обновява ги Vegetation всеки кадър. */
export interface VegUniforms {
  uCamPos: { value: THREE.Vector3 }; uFocus: { value: THREE.Vector3 }; uFadeOn: { value: number };
  uTime: { value: number }; uWind: { value: number };
  /** „прозорец“ към героя на екрана: xy — героят в NDC, z — дълбочината му (м), w — радиус (NDC по y); 0 — изключен */
  uCut: { value: THREE.Vector4 }; uCutAspect: { value: number };
}

export interface VegMatOpts {
  /** LOD прозорец по разстояние: (появява се от x до y, изчезва от z до w) */
  lod: THREE.Vector4;
  /** радиус на короната и височина (при мащаб 1) — за разтварянето пред камерата и за огъването */
  crownR: number; top: number;
  /** колко се огъва върхът (м при вятър 1) */
  bend: number;
  /** листа: светлина през тях */
  leaf?: boolean;
  /** да се разтваря ли пред камерата */
  camFade?: boolean;
  /** само „прозорецът“ към героя (без цялото дърво) — за храстите */
  cut?: boolean;
}

/** #define-ите на разтварянето според настройките. */
function fadeDefs(o: VegMatOpts): string {
  const fade = o.camFade !== false;
  return (fade ? '#define VEG_CAMFADE\n' : '') + (fade || o.cut ? '#define VEG_CUT\n' : '');
}

// 4×4 Bayer — праг за решетката
const BAYER = `
float vegBayer() {
  ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
  int bi = bp.x + bp.y * 4;
  float b4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b4[bi] + 0.5) / 16.0;
}`;

const VERT_PARS = `
uniform vec3 uCamPos; uniform vec3 uFocus; uniform float uFadeOn;
uniform float uTime; uniform float uWind;
uniform vec4 uLod; uniform float uCrownR; uniform float uTreeTop; uniform float uBend;
attribute vec2 aWind;
varying float vFade; varying vec2 vLodF;
#ifdef VEG_CUT
uniform vec4 uCut; varying vec3 vCutClip; varying float vCutZ;
#endif
`;

/** Вятър + LOD + разтваряне. Работи върху `transformed` (локално), за да важи и за сенките. */
const VERT_MAIN = `
  vFade = 0.0; vLodF = vec2(1.0);
  #ifdef VEG_CUT
  vCutZ = uCut.z - 0.4;
  #endif
  #ifdef USE_INSTANCING
  {
    vec3 ip = instanceMatrix[3].xyz;
    float isc = length(instanceMatrix[0].xyz);
    float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
    float hR = clamp(transformed.y / uTreeTop, 0.0, 1.3);
    float gust = 0.6 + 0.4 * sin(uTime * 0.31 + ip.x * 0.011 + ip.z * 0.013);
    float sw = (sin(uTime * 0.83 + ph) * 0.65 + sin(uTime * 1.71 + ph * 1.37) * 0.35) * gust * uWind;
    vec2 wdir = vec2(0.83, 0.55);
    vec3 wOff = vec3(0.0);
    wOff.xz += wdir * (sw * uBend * hR * hR * isc);
    float bob = sin(uTime * 2.1 + ph + transformed.x * 0.7 + transformed.z * 0.6) * aWind.x * uWind * 0.07 * isc;
    wOff.y += bob; wOff.xz += wdir * bob * 0.5;
    float fl = sin(uTime * 6.3 + ph + dot(transformed, vec3(3.1, 2.3, 2.7))) * aWind.y * uWind * 0.035;
    mat3 im3 = mat3(instanceMatrix);
    transformed += (transpose(im3) * wOff) / (isc * isc) + normal * fl;
    float d = distance(uCamPos, ip);
    vLodF = vec2(smoothstep(uLod.x, uLod.y, d), 1.0 - smoothstep(uLod.z, uLod.w, d));
    #ifdef VEG_CUT
    {
      // героят е в самата корона (млад смърч с клони до земята) → и клоните зад него в кръга се разтварят
      float R = uCrownR * isc;
      float heroIn = 1.0 - smoothstep(R * 1.2, R * 1.6, distance(uFocus.xz, ip.xz));
      vCutZ = mix(uCut.z - 0.4, uCut.z + R * 1.6, heroIn);
    }
    #endif
    #ifdef VEG_CAMFADE
    {
      float R = uCrownR * isc;
      vec2 c = uCamPos.xz, h = uFocus.xz, t = ip.xz;
      vec2 ab = h - c; float l2 = max(dot(ab, ab), 1e-4);
      float u = clamp(dot(t - c, ab) / l2, 0.0, 1.0);
      float dLine = length(c + ab * u - t);
      // между камерата и героя (без самия герой — дърво до него не изчезва; около героя е „прозорецът“ VEG_CUT)
      float fLine = (1.0 - smoothstep(R * 0.6, R * 1.2, dLine)) * (1.0 - smoothstep(0.75, 0.95, u));
      // съвсем до камерата (камерата в короната) — изчезва напълно, без „мрежа“
      float fNear = 1.0 - smoothstep(R + 1.0, R + 3.5, length(t - c));
      // само ако камерата е под върха (отгоре — нищо не се крие)
      float below = 1.0 - smoothstep(ip.y + uTreeTop * isc - 2.0, ip.y + uTreeTop * isc + 1.0, uCamPos.y);
      vFade = max(fLine, fNear) * below * uFadeOn;
    }
    #endif
  }
  #endif
`;

const FRAG_PARS = `varying float vFade; varying vec2 vLodF;
#ifdef VEG_CUT
uniform vec4 uCut; uniform float uCutAspect; uniform float uFadeOn; varying vec3 vCutClip; varying float vCutZ;
#endif
${BAYER}\n`;
const FRAG_DISCARD = `
  {
    float bth = vegBayer();
    if (vFade > bth) discard;
    if (vLodF.x <= 1.0 - bth || vLodF.y <= bth) discard;
    #ifdef VEG_CUT
    {
      // „прозорец“ към героя: всичко пред него (по-близо до камерата) в кръга около него на екрана се разтваря —
      // героят и враговете до него винаги се виждат, каквото и да е между тях и камерата (стволи, клони, листа)
      vec2 nd = vCutClip.xy / vCutClip.z - uCut.xy;
      nd.x *= uCutAspect;
      float rr = length(nd) / max(uCut.w, 1e-4);
      float on = step(1e-4, uCut.w) * uFadeOn;
      float cut = (1.0 - smoothstep(0.6, 1.0, rr)) * (1.0 - smoothstep(vCutZ - 1.0, vCutZ, vCutClip.z));
      // клонки, опрели в самата камера (< ~2 м) — също
      cut = max(cut, 1.0 - smoothstep(1.0, 2.4, vCutClip.z));
      if (cut * on > bth) discard;
    }
    #endif
  }
`;

function uniformsFor(u: VegUniforms, o: VegMatOpts): Record<string, { value: unknown }> {
  return { ...u, uLod: { value: o.lod }, uCrownR: { value: o.crownR }, uTreeTop: { value: o.top }, uBend: { value: o.bend } };
}

function inject(sh: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, { value: unknown }>, defs: string, leaf: boolean, depth: boolean): void {
  Object.assign(sh.uniforms, uniforms);
  // invariant: предварителният проход (само дълбочина) и основният дават точно една и съща дълбочина
  sh.vertexShader = 'invariant gl_Position;\n' + defs + VERT_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN)
    .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef VEG_CUT\nvCutClip = gl_Position.xyw;\n#endif');
  let fs = defs + FRAG_PARS + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_DISCARD);
  if (!depth && leaf) {
    // нормалите на листата са „закръглени“ навън от короната — не ги обръщаме за задната страна
    fs = fs.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    // светлина през листата: когато гледаме към слънцето през тях
    fs = fs.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replaceAll(
      'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
      `RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
       reflectedLight.directDiffuse += material.diffuseColor * directLight.color * (pow(saturate(dot(-geometryViewDir, directLight.direction)), 3.0) * 0.55 + 0.1);`));
  }
  sh.fragmentShader = fs;
}

/** Кора (ствол, клони). */
export function barkMaterial(u: VegUniforms, o: VegMatOpts, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, ...params });
  const uni = uniformsFor(u, o);
  const defs = fadeDefs(o);
  mat.onBeforeCompile = (sh) => inject(sh, uni, defs, false, false);
  mat.customProgramCacheKey = () => 'vegBark' + defs;
  (mat.userData as { veg: unknown }).veg = uni;
  return mat;
}

/**
 * Листа / иглички: alpha-test карти, двустранни. prepass — има отделен проход само за дълбочина (prepassMaterial),
 * затова тук не пишем дълбочина: всеки пиксел на короната се осветява веднъж, а не по веднъж за всеки слой листа.
 */
export function leafMaterial(u: VegUniforms, o: VegMatOpts, params: THREE.MeshStandardMaterialParameters, prepass = false): THREE.MeshStandardMaterial {
  // с предварителен проход прагът трябва да е същият (0.5) и без alpha-to-coverage — иначе по ръбовете остават дупки
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, alphaTest: prepass ? 0.5 : 0.42, alphaToCoverage: !prepass, roughness: 0.82, metalness: 0, depthWrite: !prepass, ...params });
  const uni = uniformsFor(u, o);
  const defs = fadeDefs(o);
  mat.onBeforeCompile = (sh) => inject(sh, uni, defs, true, false);
  mat.customProgramCacheKey = () => 'vegLeaf' + defs;
  (mat.userData as { veg: unknown }).veg = uni;
  return mat;
}

/**
 * Дълбочинен материал за сенките със същия вятър и LOD (map/alphaTest ги слага three от основния материал).
 * solid — без alpha-test (картите хвърлят плътна сянка): за средното ниво — много по-евтино, а в гъстата гора
 * сянката на короната е почти плътна така или иначе.
 */
export function depthMaterial(u: VegUniforms, o: VegMatOpts, solid = false): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const uni = uniformsFor(u, o);
  mat.onBeforeCompile = (sh) => {
    inject(sh, uni, '', false, true);
    if (solid) sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '').replace('#include <map_fragment>', '').replace('#include <alphamap_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'vegDepth' + (solid ? 's' : '');
  return mat;
}

/** Предварителен проход за листата: само дълбочина (без цвят), със същия вятър, LOD и разтваряне като основния. */
export function prepassMaterial(u: VegUniforms, o: VegMatOpts, leaf: THREE.MeshStandardMaterial): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ map: leaf.map, alphaMap: leaf.alphaMap, alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false });
  const uni = uniformsFor(u, o);
  const defs = fadeDefs(o);
  mat.onBeforeCompile = (sh) => inject(sh, uni, defs, false, true);
  mat.customProgramCacheKey = () => 'vegPre' + defs;
  return mat;
}

/** Обикновен материал за дребните неща (камъни, папрат, гъби…) — само вятър/разтваряне не им трябва; LOD по разстояние. */
export function lodOnlyMaterial(u: VegUniforms, o: VegMatOpts, params: THREE.MeshStandardMaterialParameters, leaf = false): THREE.MeshStandardMaterial {
  return leaf ? leafMaterial(u, { ...o, camFade: false, cut: false }, params) : barkMaterial(u, { ...o, camFade: false, cut: false }, params);
}
