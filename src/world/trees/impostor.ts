// Импостори: далечните дървета са плоски картинки, обърнати към камерата. Картинките се „снимат“ при старта
// (след като текстурите се заредят) — всеки вариант от N посоки, в атлас с цвят и атлас с нормали. В шейдъра се
// избират двете най-близки посоки и се смесват; нормалите дават истинска светлина (слънце, небе, сенки, мъгла).
import * as THREE from 'three';
import type { TreeModel } from './species';
import type { VegUniforms } from './materials';

export const IMP_ANGLES = 16;
const FW = 128, FH = 256;

export interface ImpostorAtlas {
  color: THREE.Texture; normal: THREE.Texture;
  /** за всеки вариант: ширина, височина, отместване по y (м при мащаб 1) */
  frames: THREE.Vector4[];
  rows: number;
}

/** Мерките на кадъра на модела. */
export function frameOf(m: TreeModel): THREE.Vector4 {
  const w = m.radius * 2 * 1.06, h = m.height * 1.04 + 0.4;
  return new THREE.Vector4(w, h, -0.2, 0);
}

const normalVert = `
varying vec3 vN; varying vec2 vUv; varying float vAo;
attribute vec3 color;
void main() { vN = normal; vUv = uv; vAo = color.r; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const normalFrag = `
uniform sampler2D map; uniform float useMap;
varying vec3 vN; varying vec2 vUv; varying float vAo;
void main() {
  if (useMap > 0.5 && texture2D(map, vUv).a < 0.5) discard;
  gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0);
}`;

/**
 * Снима атласа. barkMap/leafMap — текстурите на модела (вече заредени). Цветът е без светлина (албедо × оклузия),
 * нормалите — в координатите на модела.
 */
export function bakeImpostors(renderer: THREE.WebGLRenderer, models: { model: TreeModel; bark: THREE.MeshStandardMaterial; leaf: THREE.MeshStandardMaterial | null }[]): ImpostorAtlas {
  const rows = models.length;
  const W = FW * IMP_ANGLES, H = FH * rows;
  const mk = (srgb: boolean) => {
    // mip-овете се заделят при създаването, но се правят веднъж — накрая (не след всеки кадър)
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: 4 });
    if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
    renderer.initRenderTarget(rt);
    rt.texture.generateMipmaps = false;
    return rt;
  };
  const rtC = mk(true), rtN = mk(false);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const frames: THREE.Vector4[] = [];

  const prev = { rt: renderer.getRenderTarget(), auto: renderer.autoClear, cc: renderer.getClearColor(new THREE.Color()), ca: renderer.getClearAlpha(), sh: renderer.shadowMap.enabled, scis: renderer.getScissorTest() };
  renderer.autoClear = false;
  renderer.shadowMap.enabled = false;

  const normalMat = (map: THREE.Texture | null, side: THREE.Side) => new THREE.ShaderMaterial({
    vertexShader: normalVert, fragmentShader: normalFrag, side,
    uniforms: { map: { value: map }, useMap: { value: map ? 1 : 0 } },
  });

  models.forEach(({ model, bark, leaf }, row) => {
    const f = frameOf(model);
    frames.push(f);
    const lod = model.lods[0];
    const cBark = new THREE.MeshBasicMaterial({ map: bark.map, color: bark.color, vertexColors: true });
    const cLeaf = leaf ? new THREE.MeshBasicMaterial({ map: leaf.map, color: leaf.color, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }) : null;
    const nBark = normalMat(null, THREE.FrontSide), nLeaf = leaf ? normalMat(leaf.map, THREE.DoubleSide) : null;
    const mb = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(lod.bark, cBark);
    const ml = lod.leaves && cLeaf ? new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(lod.leaves, cLeaf) : null;
    scene.add(mb); if (ml) scene.add(ml);
    const D = 100;
    cam.left = -f.x / 2; cam.right = f.x / 2; cam.top = f.y / 2; cam.bottom = -f.y / 2; cam.updateProjectionMatrix();
    const yMid = f.z + f.y / 2;
    for (let k = 0; k < IMP_ANGLES; k++) {
      const a = (k / IMP_ANGLES) * Math.PI * 2;
      cam.position.set(Math.sin(a) * D, yMid, Math.cos(a) * D);
      cam.lookAt(0, yMid, 0);
      cam.updateMatrixWorld();
      for (const pass of [0, 1]) {
        const rt = pass ? rtN : rtC;
        renderer.setRenderTarget(rt);
        // y в render target-а е отдолу нагоре
        rt.viewport.set(k * FW, row * FH, FW, FH); rt.scissor.set(k * FW, row * FH, FW, FH); rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        // прозрачният фон е с цвят на листата/кората — без тъмни ръбове при смаляване
        if (pass) renderer.setClearColor(0x80ff80, 0); else renderer.setClearColor(model.leaf ? 0x2c3a1c : 0x4a3e34, 0);
        renderer.clear(true, true, false);
        mb.material = pass ? nBark : cBark;
        if (ml) ml.material = pass ? nLeaf! : cLeaf!;
        renderer.render(scene, cam);
      }
    }
    scene.remove(mb); if (ml) scene.remove(ml);
    cBark.dispose(); cLeaf?.dispose(); nBark.dispose(); nLeaf?.dispose();
  });
  // mip-ове веднъж накрая
  for (const rt of [rtC, rtN]) {
    rt.scissorTest = false; rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H);
    rt.texture.generateMipmaps = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam); // празна сцена → three прави mip-овете
  }
  renderer.setRenderTarget(prev.rt);
  renderer.autoClear = prev.auto; renderer.setClearColor(prev.cc, prev.ca); renderer.shadowMap.enabled = prev.sh; renderer.setScissorTest(prev.scis);
  return { color: rtC.texture, normal: rtN.texture, frames, rows };
}

const IMP_VERT_PARS = `
uniform vec3 uCamPos; uniform float uTime; uniform float uWind; uniform vec4 uLod;
uniform vec4 uFrame; uniform float uRow;
varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying vec2 vRot; varying vec2 vLodF;
`;
const IMP_VERT_MAIN = `
  vec3 ip = instanceMatrix[3].xyz;
  float isc = length(instanceMatrix[0].xyz);
  float rot = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
  vRot = vec2(cos(rot), sin(rot));
  vec4 fr = uFrame;
  vec3 toC = uCamPos - ip;
  vec2 tc = normalize(toC.xz + vec2(1e-4, 0.0));
  float az = atan(tc.x, tc.y) - rot;
  float fi = mod(az / 6.2831853 * ANGLES + ANGLES * 4.0, ANGLES);
  float f0 = floor(fi); vBlend = fi - f0; float f1 = mod(f0 + 1.0, ANGLES);
  vec2 cell = vec2(1.0 / ANGLES, 1.0 / ROWS);
  vec2 lp = vec2(position.x + 0.5, position.y);
  vUvA = (vec2(f0, uRow) + lp) * cell;
  vUvB = (vec2(f1, uRow) + lp) * cell;
  vec3 right = vec3(tc.y, 0.0, -tc.x);
  float d = length(toC);
  vLodF = vec2(smoothstep(uLod.x, uLod.y, d), 1.0 - smoothstep(uLod.z, uLod.w, d));
  float hR = position.y;
  float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  float sw = (sin(uTime * 0.83 + ph) * 0.65 + sin(uTime * 1.71 + ph * 1.37) * 0.35) * uWind * 0.35 * hR * hR * isc;
  vec3 wp = ip + right * (position.x * fr.x * isc) + vec3(0.0, (position.y * fr.y + fr.z) * isc, 0.0);
  wp.xz += vec2(0.83, 0.55) * sw;
  // лицето към камерата, леко наклонено нагоре (за светлината отзад и сенките)
  transformedNormal = normalize((viewMatrix * vec4(tc.x, 0.25, tc.y, 0.0)).xyz);
  vNormal = transformedNormal;
`;

/** Материалът на импосторите на един вариант (ред в атласа): PBR, с мъгла; без сенки (далеч са). */
export function impostorMaterial(u: VegUniforms, atlas: ImpostorAtlas, lod: THREE.Vector4, row: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
  const uni = { uCamPos: u.uCamPos, uTime: u.uTime, uWind: u.uWind, uLod: { value: lod }, uFrame: { value: atlas.frames[row] }, uRow: { value: row }, uAtlasC: { value: atlas.color }, uAtlasN: { value: atlas.normal } };
  const defs = `#define ANGLES ${IMP_ANGLES}.0\n#define ROWS ${atlas.rows}.0\n`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = defs + IMP_VERT_PARS + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + IMP_VERT_MAIN)
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(wp, 1.0);\ngl_Position = projectionMatrix * mvPosition;\nif (vLodF.x <= 0.0 || vLodF.y <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(wp, 1.0);');
    sh.fragmentShader = `uniform sampler2D uAtlasC; uniform sampler2D uAtlasN;
varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying vec2 vRot; varying vec2 vLodF;
float vegBayer() {
  ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
  int bi = bp.x + bp.y * 4;
  float b4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (b4[bi] + 0.5) / 16.0;
}
` + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  { float bth = vegBayer(); if (vLodF.x <= 1.0 - bth || vLodF.y <= bth) discard; }`)
      .replace('#include <map_fragment>', `
  vec4 icA = texture2D(uAtlasC, vUvA), icB = texture2D(uAtlasC, vUvB);
  vec4 ic = mix(icA, icB, vBlend);
  diffuseColor *= ic;`)
      .replace('#include <normal_fragment_maps>', `
  {
    vec3 nA = texture2D(uAtlasN, vUvA).xyz * 2.0 - 1.0, nB = texture2D(uAtlasN, vUvB).xyz * 2.0 - 1.0;
    vec3 nm = normalize(mix(nA, nB, vBlend) + vec3(0.0, 1e-4, 0.0));
    vec3 nw = vec3(vRot.x * nm.x + vRot.y * nm.z, nm.y, -vRot.y * nm.x + vRot.x * nm.z);
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }`);
  };
  mat.customProgramCacheKey = () => 'vegImpostor' + atlas.rows;
  return mat;
}

/** Геометрия: квадрат с основа в (0,0), x ∈ [-0.5, 0.5], y ∈ [0, 1]. */
export function impostorGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  g.translate(0, 0.5, 0);
  return g;
}
