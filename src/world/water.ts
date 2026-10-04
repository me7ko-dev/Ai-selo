// Вода: езерцето на поляната, реката (скрита, докато Ламята е жива) и локвите в блатото.
import * as THREE from 'three';
import { RIVER_PATH } from '../data/layout';
import { riverWaterHeight, POND_WATER_HEIGHT } from './height';
import { POND } from './plan';

const vert = /* glsl */`
#include <fog_pars_vertex>
attribute float aT;
varying vec3 vWorld; varying float vT; varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz; vT = aT; vUv = uv;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const frag = /* glsl */`
#include <fog_pars_fragment>
uniform float uTime; uniform vec3 uSky; uniform vec3 uTop; uniform vec3 uDeep; uniform vec3 uShallow;
uniform vec3 uLightDir; uniform vec3 uLightColor; uniform float uFlow; uniform float uFront; uniform float uAlpha; uniform float uRefl;
varying vec3 vWorld; varying float vT; varying vec2 vUv;
void main() {
  if (vT > uFront) discard;
  vec2 p = vWorld.xz;
  vec2 flow = vec2(0.0, uTime * uFlow);
  float t = uTime;
  vec2 q = vec2(vUv.x * 8.0, vUv.y * 0.35) - flow * 0.6;
  vec2 pp = mix(p, q, step(0.001, uFlow));
  vec3 n = normalize(vec3(
    sin(pp.x * 0.9 + t * 1.3) * 0.08 + sin(pp.y * 1.7 - t * 1.9 + pp.x * 0.4) * 0.06 + sin((pp.x + pp.y) * 3.1 + t * 2.7) * 0.03,
    1.0,
    cos(pp.y * 1.1 + t * 1.1) * 0.08 + cos(pp.x * 1.9 + t * 1.6 - pp.y * 0.3) * 0.06 + cos((pp.x - pp.y) * 2.7 - t * 2.3) * 0.03));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(v, n), 0.0), 3.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uSky, uTop, clamp(r.y * 1.4, 0.0, 1.0));
  vec3 col = mix(uDeep, uShallow, 0.35 + 0.25 * n.x * 4.0);
  col = mix(col, sky, clamp(fres * uRefl + 0.18 * uRefl, 0.0, 1.0));
  float spec = pow(max(dot(r, uLightDir), 0.0), 120.0);
  col += uLightColor * spec * 1.4;
  // пяна по фронта на прииждащата вода и по краищата
  float foam = smoothstep(uFront - 0.012, uFront, vT) * step(uFront, 0.999);
  foam += smoothstep(0.42, 0.5, abs(vUv.x - 0.5)) * 0.25 * step(0.001, uFlow);
  col = mix(col, vec3(0.92, 0.95, 0.96), clamp(foam, 0.0, 1.0));
  gl_FragColor = vec4(col, uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function waterMaterial(opts: { deep: string; shallow: string; flow?: number; alpha?: number; refl?: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSky: { value: new THREE.Color('#e9f1f4') }, uTop: { value: new THREE.Color('#9cc7e8') },
      uDeep: { value: new THREE.Color(opts.deep) }, uShallow: { value: new THREE.Color(opts.shallow) },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightColor: { value: new THREE.Color('#ffffff') },
      uFlow: { value: opts.flow ?? 0 }, uFront: { value: 1.01 }, uAlpha: { value: opts.alpha ?? 0.88 }, uRefl: { value: opts.refl ?? 1 },
    }]),
    vertexShader: vert, fragmentShader: frag, fog: true, transparent: true, depthWrite: false,
  });
}

function withT(geo: THREE.BufferGeometry, t = 0): THREE.BufferGeometry {
  geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(t), 1));
  return geo;
}

export function buildPond(): THREE.Mesh {
  const geo = withT(new THREE.CircleGeometry(15, 40));
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, waterMaterial({ deep: '#1f4f5c', shallow: '#3f7f86', refl: 1 }));
  m.position.set(POND.x, POND_WATER_HEIGHT, POND.z);
  m.renderOrder = 2; m.name = 'pond';
  return m;
}

/** Лента вода по коритото; aT = параметър по дължината 0..1 (0 = изворът). */
export function buildRiver(): { mesh: THREE.Mesh; length: number } {
  const curve = new THREE.CatmullRomCurve3(RIVER_PATH.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
  const length = curve.getLength();
  const n = Math.ceil(length / 2), across = 6, half = 7.5;
  const pos: number[] = [], uv: number[] = [], ts: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = curve.getPointAt(u), tan = curve.getTangentAt(u);
    const nx = -tan.z, nz = tan.x, y = riverWaterHeight(p.x, p.z);
    for (let j = 0; j <= across; j++) {
      const o = (j / across - 0.5) * 2 * half;
      pos.push(p.x + nx * o, y, p.z + nz * o); uv.push(j / across, u * length); ts.push(u);
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
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = waterMaterial({ deep: '#24586a', shallow: '#4f8f96', flow: 1.6, refl: 0.8 });
  // DoubleSide за всеки случай (посоката на лентата)
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2; mesh.name = 'river'; mesh.visible = false;
  return { mesh, length };
}

export function buildSwampPools(pools: { x: number; z: number; r: number; y: number }[]): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const geoms = pools.map(p => { const g = withT(new THREE.CircleGeometry(p.r, 18)); g.rotateX(-Math.PI / 2); g.translate(p.x, p.y, p.z); return g; });
  parts.push(...geoms);
  const merged = mergeAll(parts);
  const m = new THREE.Mesh(merged, waterMaterial({ deep: '#1f2619', shallow: '#3a4229', refl: 0.28, alpha: 0.95 }));
  m.renderOrder = 2; m.name = 'swamp';
  return m;
}
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
function mergeAll(list: THREE.BufferGeometry[]) { const g = mergeGeometries(list, false)!; g.computeBoundingSphere(); return g; }
