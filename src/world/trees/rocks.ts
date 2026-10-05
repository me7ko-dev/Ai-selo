// Камъни и скали: форма от шум + няколко „среза“ (плоски стени като на истински камък), текстура от Poly Haven,
// наложена отвсякъде (triplanar — без шевове), мъх отгоре в гората. Паднали дънери с кора и мъх.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, tube, Rand } from './builder';

// ---------------------------------------------------------------- шум
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
function fbm3(x: number, y: number, z: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}

/** Камък с радиус ~1, основа около y = 0 (малко вкопана). detail — гъстота на мрежата. */
export function rockGeometry(seed: number, detail: number, shape: [number, number, number]): THREE.BufferGeometry {
  const rnd = new Rand(seed);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const planes: { n: THREE.Vector3; d: number }[] = [];
  const np = 4 + Math.floor(rnd.next() * 3);
  for (let i = 0; i < np; i++) {
    const n = new THREE.Vector3(rnd.jit(1), rnd.range(-0.2, 1), rnd.jit(1)).normalize();
    planes.push({ n, d: rnd.range(0.62, 0.85) });
  }
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  const o = seed * 0.37;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let r = 1 + (fbm3(v.x * 1.4 + o, v.y * 1.4, v.z * 1.4 - o) - 0.5) * 0.55 + (fbm3(v.x * 4.5 - o, v.y * 4.5 + o, v.z * 4.5, 2) - 0.5) * 0.12;
    v.multiplyScalar(r);
    // срезове: плоски стени с меки ръбове
    for (const pl of planes) {
      const k = v.dot(pl.n) - pl.d;
      if (k > 0) v.addScaledVector(pl.n, -k * 0.85);
    }
    v.set(v.x * shape[0], v.y * shape[1], v.z * shape[2]);
    // основата е заровена: всичко под -0.15 се сплесква
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.25;
    v.y += 0.12;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // оклузия: долу по-тъмно
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const a = THREE.MathUtils.clamp(0.55 + (p.getY(i) + 0.05) * 0.9, 0.55, 1); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = a; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- triplanar шейдър (камъни, дънери)
const TRI_VERT_PARS = 'varying vec3 vTriPos; varying vec3 vTriN;\n';
const TRI_VERT = `
  {
    vec4 tw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
    tw = instanceMatrix * tw;
    #endif
    tw = modelMatrix * tw;
    vTriPos = tw.xyz;
    vec3 tn = objectNormal;
    #ifdef USE_INSTANCING
    tn = mat3(instanceMatrix) * tn;
    #endif
    vTriN = normalize(mat3(modelMatrix) * tn);
  }
`;
const TRI_FRAG_PARS = `
uniform sampler2D uTriMap; uniform sampler2D uTriNor; uniform sampler2D uMossMap;
uniform float uTriScale; uniform float uMoss;
varying vec3 vTriPos; varying vec3 vTriN;
vec3 triBlend(vec3 n) { vec3 b = pow(abs(n), vec3(4.0)); return b / (b.x + b.y + b.z); }
`;
const TRI_MAP = `
  vec3 tN = normalize(vTriN);
  vec3 tB = triBlend(tN);
  vec3 tp = vTriPos * uTriScale;
  vec4 tcx = texture2D(uTriMap, tp.zy), tcy = texture2D(uTriMap, tp.xz), tcz = texture2D(uTriMap, tp.xy);
  vec4 triCol = tcx * tB.x + tcy * tB.y + tcz * tB.z;
  // мъх отгоре (в гората — много, по поляните — малко лишеи)
  float mossAmt = uMoss;
  float lum = dot(triCol.rgb, vec3(0.33));
  float mossK = smoothstep(0.35, 0.8, tN.y + (lum - 0.35) * 0.9) * mossAmt;
  vec4 mossCol = texture2D(uMossMap, vTriPos.xz * 0.45);
  mossCol.rgb *= vec3(0.78, 0.95, 0.62);
  diffuseColor.rgb *= mix(triCol.rgb, mossCol.rgb, mossK);
`;
const TRI_NORMAL = `
  {
    vec3 axs = sign(tN);
    vec3 nx = texture2D(uTriNor, tp.zy).xyz * 2.0 - 1.0;
    vec3 ny = texture2D(uTriNor, tp.xz).xyz * 2.0 - 1.0;
    vec3 nz = texture2D(uTriNor, tp.xy).xyz * 2.0 - 1.0;
    nx.x *= axs.x; ny.x *= axs.y; nz.x *= -axs.z;
    nx = vec3(nx.xy + tN.zy, abs(nx.z) * tN.x);
    ny = vec3(ny.xy + tN.xz, abs(ny.z) * tN.y);
    nz = vec3(nz.xy + tN.xy, abs(nz.z) * tN.z);
    vec3 nW = normalize(nx.zyx * tB.x + ny.xzy * tB.y + nz.xyz * tB.z);
    nW = normalize(mix(nW, tN, mossK * 0.6));
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    roughnessFactor = mix(roughnessFactor, 0.97, mossK);
  }
`;

/** Добавя triplanar текстура + мъх към материал с растителния шейдър (извиква се след barkMaterial). */
export function addTriplanar(mat: THREE.MeshStandardMaterial, o: { map: THREE.Texture; nor: THREE.Texture; moss: THREE.Texture; scale: number; moss01: number }): void {
  const prev = mat.onBeforeCompile;
  const uni = { uTriMap: { value: o.map }, uTriNor: { value: o.nor }, uMossMap: { value: o.moss }, uTriScale: { value: o.scale }, uMoss: { value: o.moss01 } };
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = TRI_VERT_PARS + sh.vertexShader.replace('#include <project_vertex>', TRI_VERT + '#include <project_vertex>');
    sh.fragmentShader = TRI_FRAG_PARS + sh.fragmentShader
      .replace('#include <map_fragment>', TRI_MAP)
      .replace('#include <normal_fragment_maps>', TRI_NORMAL);
  };
  const key = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => key + 'tri';
}

// ---------------------------------------------------------------- паднал дънер
/** Дънер по оста x (дължина 4.2, радиус ~0.32 при мащаб 1, както в плана), с чепове и счупен край. */
export function logGeometry(seed: number, detail: 0 | 1): THREE.BufferGeometry {
  const rnd = new Rand(seed);
  const b = new GeoBuilder();
  const L = 4.2, r0 = 0.34;
  const pts = [];
  const n = detail === 0 ? 8 : 3;
  for (let i = 0; i <= n; i++) {
    const f = i / n, x = -L / 2 + L * f;
    pts.push({ p: new THREE.Vector3(x, r0 * 0.85 + Math.sin(f * 2.5 + seed) * 0.03, Math.sin(f * 3.1 + seed) * 0.06), r: r0 * (1 - f * 0.22) * (1 + 0.05 * Math.sin(f * 17)), ao: 0.85 });
  }
  tube(b, pts, detail === 0 ? 12 : 6, 2, 1.1, 0, detail === 0 ? (i, a) => (i === n ? 1 + 0.25 * Math.abs(Math.sin(a * 4 + seed)) : 1) : undefined);
  // торци: срязано дърво (uv в средата на текстурата — по-светло)
  for (const end of [0, n]) {
    const c = pts[end].p, r = pts[end].r, sgn = end ? 1 : -1, seg = detail === 0 ? 12 : 6;
    const nn = new THREE.Vector3(sgn, 0, 0);
    const ci = b.vert(c, nn, 0.5, 0.5, 0.5);
    const first = b.count;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      b.vert(new THREE.Vector3(c.x, c.y + Math.cos(a) * r * 0.97, c.z + Math.sin(a) * r * 0.97), nn, 0.5 + Math.cos(a) * 0.05, 0.5 + Math.sin(a) * 0.05, 0.6);
    }
    for (let j = 0; j < seg; j++) { if (end) b.tri(ci, first + j, first + j + 1); else b.tri(ci, first + j + 1, first + j); }
  }
  // чепове
  if (detail === 0) for (let k = 0; k < 3; k++) {
    const x = rnd.range(-1.6, 1.4), a = rnd.range(-0.6, 3.7);
    const base = new THREE.Vector3(x, r0 * 0.85 + Math.cos(a) * r0 * 0.9, Math.sin(a) * r0 * 0.9);
    const d = new THREE.Vector3(rnd.jit(0.3), Math.cos(a), Math.sin(a)).normalize();
    tube(b, [{ p: base, r: 0.06 }, { p: base.clone().addScaledVector(d, rnd.range(0.25, 0.6)), r: 0.015 }], 4, 1, 0.5);
  }
  return b.build();
}
