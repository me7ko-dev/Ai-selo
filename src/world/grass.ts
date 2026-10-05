// Тревата: отделни стръкове, строени изцяло на видеокартата (GPU instancing).
// Светът е разделен на клетки 4×4 м; всяка видима клетка рисува една и съща „кръпка“ от 8192 стръка
// (на туфи, в случаен ред), но само първите N от тях — колкото е нужно за разстоянието (близо — гъсто,
// далеч — рядко и с по-малко сегменти). Шейдърът сам маха стръковете по пътищата, коритото и скалите,
// огъва ги от вятъра и около героя, оцветява ги (виж grassShader.ts). Между тях — полски цветя.
import * as THREE from 'three';
import type { GroundTextures } from './groundTex';
import { BASE_N, LINES_N, RIVER_DMAX, type GroundData } from './ground';
import { RIVER_HALF_WIDTH, WORLD_HALF } from '../data/layout';
import { GRASS_VERT_PARS, GRASS_MAIN, FLOWER_MAIN, GRASS_FRAG_PARS, GRASS_RE } from './grassShader';

const CELL = 4;                       // м
const BLADES = 8192;                  // стръка в кръпката (на клетка) — 512 на м² при пълна гъстота
const FLOWERS = 128;                  // цветя в кръпката
const CAP = BLADES / (CELL * CELL);
const FRACS = 19;                     // части от кръпката: 1, 1/√2, 1/2, … (стъпка √2 — малко излишни стръкове)
const fracOf = (f: number) => Math.pow(2, -f / 2);
const NC = (WORLD_HALF * 2) / CELL;   // клетки по страна (150)

interface GrassLevel {
  /** стръка на м² близо до камерата */
  dens: number;
  /** до колко метра е пълна гъстотата */
  near: number;
  /** после — колкото да покрие земята (стръка/м² ≈ cov / (ширина × разстояние)), без излишно застъпване */
  cov: number;
  /** докъде има трева (м) */
  far: number;
  /** [до колко м, сегменти на стрък] */
  segs: [number, number][];
  /** докъде има цветя (м); 0 — без цветя */
  flowers: number;
  /** евтин материал (Lambert, без просветляване) */
  cheap: boolean;
}
const LEVELS: Record<1 | 2 | 3, GrassLevel> = {
  3: { dens: 400, near: 6, cov: 1400, far: 62, segs: [[8, 4], [18, 3], [32, 2], [1e9, 1]], flowers: 32, cheap: false },
  2: { dens: 280, near: 5.5, cov: 1000, far: 46, segs: [[8, 3], [18, 2], [1e9, 1]], flowers: 22, cheap: false },
  1: { dens: 120, near: 5, cov: 550, far: 30, segs: [[8, 2], [1e9, 1]], flowers: 0, cheap: true },
};

// ------------------------------------------------------------------ кръпката (едни и същи стръкове за всяка клетка)
interface Patch { b0: Float32Array; b1: Uint8Array; b2: Uint8Array; n: number }

function makePatch(n: number, seed: number, clumpStep: number, flowers: boolean): Patch {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  // туфи: центрове по разместена решетка (затворена в кръг — кръпката се повтаря без шев)
  const g = Math.max(1, Math.round(1 / clumpStep));
  const clumps: { x: number; z: number; r: number; h: number; hue: number }[] = [];
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
    clumps.push({ x: (i + 0.15 + rnd() * 0.7) / g, z: (j + 0.15 + rnd() * 0.7) / g, r: (0.35 + rnd() * 0.5) / g, h: rnd(), hue: rnd() });
  }
  const b0 = new Float32Array(n * 4), b1 = new Uint8Array(n * 4), b2 = new Uint8Array(n * 4);
  const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let k = 0; k < n; k++) {
    let x: number, z: number, lean = rnd(), leanA = rnd(), h = rnd(), hue = rnd();
    if (!flowers && rnd() < 0.8) {
      const c = clumps[Math.floor(rnd() * clumps.length)];
      const a = rnd() * Math.PI * 2, rr = c.r * Math.sqrt(rnd());
      x = c.x + Math.cos(a) * rr; z = c.z + Math.sin(a) * rr;
      // стръковете в туфата се разтварят навън; туфата има своя височина и оттенък
      leanA = a / (Math.PI * 2) + (rnd() - 0.5) * 0.15; leanA -= Math.floor(leanA);
      lean = 0.25 + (rr / c.r) * 0.55 + rnd() * 0.2;
      h = Math.min(1, Math.max(0, c.h * 0.6 + rnd() * 0.4 + (1 - rr / c.r) * 0.15));
      hue = Math.min(1, Math.max(0, c.hue * 0.75 + rnd() * 0.25));
    } else { x = rnd(); z = rnd(); }
    x -= Math.floor(x); z -= Math.floor(z);
    // ред на изтъняване: случаен (всяко начало на списъка е равномерно разпръснато)
    b0[k * 4] = x; b0[k * 4 + 1] = z; b0[k * 4 + 2] = 0;
    // листът гледа приблизително по посоката, в която се навежда
    const face = flowers ? rnd() : leanA + (rnd() - 0.5) * 0.25;
    b0[k * 4 + 3] = face - Math.floor(face);
    b1[k * 4] = u8(flowers ? rnd() : leanA); b1[k * 4 + 1] = u8(flowers ? rnd() : lean); b1[k * 4 + 2] = u8(flowers ? rnd() : h); b1[k * 4 + 3] = u8(rnd());
    b2[k * 4] = u8(hue); b2[k * 4 + 1] = u8(rnd()); b2[k * 4 + 2] = u8(rnd()); b2[k * 4 + 3] = u8(rnd());
  }
  // разбъркваме и номерираме: първите N са равномерна извадка
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const o0 = new Float32Array(n * 4), o1 = new Uint8Array(n * 4), o2 = new Uint8Array(n * 4);
  order.forEach((src, dst) => {
    for (let c = 0; c < 4; c++) { o0[dst * 4 + c] = b0[src * 4 + c]; o1[dst * 4 + c] = b1[src * 4 + c]; o2[dst * 4 + c] = b2[src * 4 + c]; }
    o0[dst * 4 + 2] = (dst + 0.5) / n;
  });
  return { b0: o0, b1: o1, b2: o2, n };
}

const u16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v * 65535)));

/** Геометрията на кръпката: segs сегмента на стрък (2·segs+1 върха). Атрибутите на стръка са повторени във всеки връх. */
function bladeGeometry(p: Patch, segs: number): { attrs: Record<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>; index: THREE.BufferAttribute; perBlade: number } {
  const vpb = segs * 2 + 1, ipb = (segs * 2 - 1) * 3;
  // малки типове (видеокартата чете по-малко): позиция Int8, данните на стръка Uint16/Uint8
  const pos = new Int8Array(p.n * vpb * 4), b0 = new Uint16Array(p.n * vpb * 4), b1 = new Uint8Array(p.n * vpb * 4), b2 = new Uint8Array(p.n * vpb * 4);
  const idx = new Uint32Array(p.n * ipb);
  for (let k = 0; k < p.n; k++) {
    const v0 = k * vpb;
    for (let v = 0; v < vpb; v++) {
      const s = Math.floor(v / 2), tip = v === vpb - 1;
      const q = (v0 + v) * 4;
      pos[q] = tip ? 0 : (v % 2 ? 127 : -127); pos[q + 1] = Math.round((tip ? 1 : s / segs) * 127); pos[q + 2] = 0;
      for (let c = 0; c < 4; c++) { b0[(v0 + v) * 4 + c] = u16(p.b0[k * 4 + c]); b1[(v0 + v) * 4 + c] = p.b1[k * 4 + c]; b2[(v0 + v) * 4 + c] = p.b2[k * 4 + c]; }
    }
    let ii = k * ipb;
    for (let s = 0; s < segs - 1; s++) {
      const a = v0 + s * 2, b = a + 1, c = a + 2, d = a + 3;
      idx[ii++] = a; idx[ii++] = b; idx[ii++] = c; idx[ii++] = b; idx[ii++] = d; idx[ii++] = c;
    }
    const a = v0 + (segs - 1) * 2;
    idx[ii++] = a; idx[ii++] = a + 1; idx[ii++] = v0 + vpb - 1;
  }
  return {
    attrs: {
      position: new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(pos, 4), 3, 0, true),
      aB0: new THREE.BufferAttribute(b0, 4, true),
      aB1: new THREE.BufferAttribute(b1, 4, true),
      aB2: new THREE.BufferAttribute(b2, 4, true),
    },
    index: new THREE.BufferAttribute(idx, 1), perBlade: ipb,
  };
}

/** Цвете: стъбло (2 сегмента) + главичка (розетка от 12 върха около средата). */
function flowerGeometry(p: Patch): { attrs: Record<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>; index: THREE.BufferAttribute; perBlade: number } {
  const RIM = 12, vpb = 5 + 1 + RIM, ipb = 3 * 3 + RIM * 3;
  const pos = new Int8Array(p.n * vpb * 4), b0 = new Uint16Array(p.n * vpb * 4), b1 = new Uint8Array(p.n * vpb * 4), b2 = new Uint8Array(p.n * vpb * 4);
  const idx = new Uint32Array(p.n * ipb);
  const local: number[] = [];
  for (let v = 0; v < 5; v++) local.push(v === 4 ? 0 : (v % 2 ? 1 : -1), v === 4 ? 1 : Math.floor(v / 2) / 2, 0);
  local.push(0, 0, 1);
  for (let r = 0; r < RIM; r++) { const a = (r / RIM) * Math.PI * 2, rr = r % 2 ? 0.5 : 1; local.push(Math.cos(a) * rr, Math.sin(a) * rr, 1); }
  for (let k = 0; k < p.n; k++) {
    const v0 = k * vpb;
    for (let v = 0; v < vpb; v++) {
      for (let c = 0; c < 3; c++) pos[(v0 + v) * 4 + c] = Math.round(local[v * 3 + c] * 127);
      for (let c = 0; c < 4; c++) { b0[(v0 + v) * 4 + c] = u16(p.b0[k * 4 + c]); b1[(v0 + v) * 4 + c] = p.b1[k * 4 + c]; b2[(v0 + v) * 4 + c] = p.b2[k * 4 + c]; }
    }
    let ii = k * ipb;
    idx.set([v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4], ii); ii += 9;
    for (let r = 0; r < RIM; r++) { idx[ii++] = v0 + 5; idx[ii++] = v0 + 6 + r; idx[ii++] = v0 + 6 + ((r + 1) % RIM); }
  }
  return {
    attrs: { position: new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(pos, 4), 3, 0, true), aB0: new THREE.BufferAttribute(b0, 4, true), aB1: new THREE.BufferAttribute(b1, 4, true), aB2: new THREE.BufferAttribute(b2, 4, true) },
    index: new THREE.BufferAttribute(idx, 1), perBlade: ipb,
  };
}

/** Отместванията на клетките около камерата, подредени по разстояние (от близките към далечните). */
function ringOrder(r: number): Int16Array {
  const list: [number, number, number][] = [];
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const dx = Math.max(0, Math.abs(i + 0.5) - 0.5), dz = Math.max(0, Math.abs(j + 0.5) - 0.5);
    if (Math.hypot(dx, dz) <= r) list.push([i, j, Math.hypot(i + 0.5, j + 0.5)]);
  }
  list.sort((a, b) => a[2] - b[2]);
  const out = new Int16Array(list.length * 2);
  list.forEach(([i, j], k) => { out[k * 2] = i; out[k * 2 + 1] = j; });
  return out;
}

interface Bucket { mesh: THREE.Mesh; geo: THREE.InstancedBufferGeometry; arr: Float32Array; attr: THREE.InstancedBufferAttribute; n: number }

export class GrassField {
  readonly group = new THREE.Group();
  readonly uniforms: Record<string, THREE.IUniform> & { uTime: THREE.IUniform<number>; uWind: THREE.IUniform<number> };
  private level: GrassLevel | null = null;
  private patch = makePatch(BLADES, 9127, 0.11, false);
  private fpatch = makePatch(FLOWERS, 4431, 1, true);
  private geos = new Map<string, ReturnType<typeof bladeGeometry>>();
  private buckets = new Map<string, Bucket>();
  private mats = new Map<string, THREE.Material>();
  /** най-голямата гъстота в клетката (маската без пътищата и коритото, с околните пиксели), цветята, височината */
  private cellMax = new Float32Array(NC * NC);
  private cellFlower = new Float32Array(NC * NC);
  /** средна височина и половината от разликата в клетката */
  private cellH = new Float32Array(NC * NC * 2);
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private maxCells = 1600;
  private order: Int16Array = new Int16Array(0);

  constructor(gt: GroundTextures, heightTex: THREE.DataTexture, ground: GroundData, heights: Float32Array, n1: number) {
    this.group.name = 'grass';
    this.uniforms = {
      uTime: { value: 0 }, uWind: { value: 0.6 }, uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
      uHero: { value: new THREE.Vector4(0, -1000, 0, 1.1) },
      uDens: { value: new THREE.Vector4(260, 6, 62, CAP) }, uCov: { value: 900 },
      uBlade: { value: new THREE.Vector3(0.52, 0.018, 1 / 8) },
      uWet: { value: 0 }, uWetF: { value: 0 },
      uDryCol: { value: new THREE.Color('#a39462') },
      uTransTint: { value: new THREE.Color(0.95, 1.05, 0.45) },
      uCell: { value: CELL }, uFlower: { value: new THREE.Vector2(14, 34) },
      tHeight: { value: heightTex }, tGrass: { value: gt.grassParams }, tMacro: { value: gt.macro }, tLines: { value: gt.lines }, tNoise: { value: gt.noise },
    } as GrassField['uniforms'];
    // клетките: колко трева (и цветя) има най-много — маската по 1,17 м × свободното от пътища/корито по 0,59 м
    const N = BASE_N, LN = LINES_N, gp = ground.grassParams, lines = ground.lines;
    const free = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let f = 0;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
        const k = ((j * 2 + dj) * LN + i * 2 + di) * 4;
        const dirt = lines[k + 3] / 255, riv = (lines[k + 1] / 255) * RIVER_DMAX;
        f = Math.max(f, (1 - Math.min(1, Math.max(0, (dirt - 0.22) / 0.38))) * Math.min(1, Math.max(0, (riv - (RIVER_HALF_WIDTH - 0.6)) / 2)));
      }
      free[j * N + i] = f * gp[(j * N + i) * 4] / 255;
    }
    const per = N / NC;
    for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
      let m = 0, f = 0;
      const i0 = Math.max(0, Math.floor(ci * per) - 1), i1 = Math.min(N - 1, Math.ceil((ci + 1) * per));
      const j0 = Math.max(0, Math.floor(cj * per) - 1), j1 = Math.min(N - 1, Math.ceil((cj + 1) * per));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = free[j * N + i];
        m = Math.max(m, v); f = Math.max(f, Math.min(v, gp[(j * N + i) * 4 + 3] / 255));
      }
      this.cellMax[cj * NC + ci] = m; this.cellFlower[cj * NC + ci] = f;
      let lo = Infinity, hi = -Infinity;
      const s = CELL / 2; // стъпката на мрежата е 2 м
      for (let j = cj * s; j <= cj * s + s; j++) for (let i = ci * s; i <= ci * s + s; i++) {
        const v = heights[Math.min(n1 - 1, j) * n1 + Math.min(n1 - 1, i)]; lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      this.cellH[(cj * NC + ci) * 2] = (lo + hi) / 2; this.cellH[(cj * NC + ci) * 2 + 1] = (hi - lo) / 2;
    }
  }

  private material(kind: 'grass' | 'flower', cheap: boolean): THREE.Material {
    const key = kind + (cheap ? '-c' : '');
    const hit = this.mats.get(key);
    if (hit) return hit;
    const u = this.uniforms;
    const mat = cheap
      ? new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: kind === 'grass' ? 0.62 : 0.7, metalness: 0 });
    mat.name = key;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = GRASS_VERT_PARS + sh.vertexShader
        .replace('#include <beginnormal_vertex>', (kind === 'grass' ? GRASS_MAIN : FLOWER_MAIN) + '\n  vec3 objectNormal = gNormal;')
        .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
      let fs = GRASS_FRAG_PARS + sh.fragmentShader
        .replace('#include <color_fragment>', 'diffuseColor.rgb *= vGCol;')
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;');
      if (!cheap) {
        fs = fs.replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + GRASS_RE)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.28, uWetF);');
      }
      sh.fragmentShader = fs;
    };
    mat.customProgramCacheKey = () => key;
    this.mats.set(key, mat);
    return mat;
  }

  private geometry(kind: 'grass' | 'flower', segs: number) {
    const key = kind + segs;
    let g = this.geos.get(key);
    if (!g) { g = kind === 'grass' ? bladeGeometry(this.patch, segs) : flowerGeometry(this.fpatch); this.geos.set(key, g); }
    return g;
  }

  /** Едно рисуване: стръкове със segs сегмента, първите FRAC(f) от кръпката, за всички клетки в списъка. */
  private bucket(kind: 'grass' | 'flower', segs: number, f: number): Bucket {
    const key = `${kind}${segs}/${f}`;
    let b = this.buckets.get(key);
    if (b) return b;
    const src = this.geometry(kind, segs);
    const geo = new THREE.InstancedBufferGeometry();
    for (const [name, a] of Object.entries(src.attrs)) geo.setAttribute(name, a);
    geo.setIndex(src.index);
    const total = kind === 'grass' ? BLADES : FLOWERS;
    geo.setDrawRange(0, Math.max(1, Math.ceil(total * fracOf(f))) * src.perBlade);
    const arr = new Float32Array(this.maxCells * 4);
    const attr = new THREE.InstancedBufferAttribute(arr, 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTile', attr);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mesh = new THREE.Mesh(geo, this.material(kind, this.level?.cheap ?? false));
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    // тревата се рисува преди терена: пръстта под гъстите стръкове не се смята напразно
    mesh.renderOrder = kind === 'grass' ? -2 : -1;
    mesh.name = 'grass_' + key;
    this.group.add(mesh);
    b = { mesh, geo, arr, attr, n: 0 };
    this.buckets.set(key, b);
    return b;
  }

  /** 0 — без трева; 1 — ниско (телефон); 2 — средно; 3 — високо. */
  setDensity(level: 0 | 1 | 2 | 3): void {
    for (const b of this.buckets.values()) { this.group.remove(b.mesh); b.geo.dispose(); }
    this.buckets.clear();
    this.level = level === 0 ? null : LEVELS[level];
    if (!this.level) return;
    const L = this.level;
    (this.uniforms.uDens.value as THREE.Vector4).set(L.dens, L.near, L.far, CAP);
    this.uniforms.uCov.value = L.cov;
    this.order = ringOrder(Math.ceil(L.far / CELL) + 1);
    (this.uniforms.uFlower.value as THREE.Vector2).set(14, L.flowers);
  }
  /** Колко далеч стига тревата (за терена — оттам нататък земята е с цвета на тревата). */
  get range(): number { return this.level?.far ?? 0; }

  /** Всеки кадър: позицията на героя, времето и камерата (кои клетки се виждат и колко гъсти). */
  update(focus: THREE.Vector3, time: number, camera?: THREE.Camera, wet = 0): void {
    const u = this.uniforms;
    u.uTime.value = time;
    (u.uHero.value as THREE.Vector4).set(focus.x, focus.y, focus.z, 1.1);
    u.uWet.value = wet; u.uWetF.value = wet;
    const L = this.level;
    if (!L || !camera) return;
    // посоката на вятъра се върти бавно
    const wa = 0.65 + Math.sin(time * 0.013) * 0.5;
    (u.uWindDir.value as THREE.Vector2).set(Math.cos(wa), Math.sin(wa));
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (const b of this.buckets.values()) b.n = 0;
    const cx = camera.position.x, cz = camera.position.z, far = L.far, near = L.near, g = (this.uniforms.uBlade.value as THREE.Vector3).z;
    const ccx = Math.floor((cx + WORLD_HALF) / CELL), ccz = Math.floor((cz + WORLD_HALF) / CELL);
    // от близките клетки към далечните: предните стръкове закриват задните и те не се оцветяват напразно
    const ord = this.order;
    for (let o = 0; o < ord.length; o += 2) {
      const ci = ccx + ord[o], cj = ccz + ord[o + 1];
      if (ci < 0 || cj < 0 || ci >= NC || cj >= NC) continue;
      const c = cj * NC + ci, m = this.cellMax[c];
      if (m <= 0.01) continue;
      const x0 = -WORLD_HALF + ci * CELL, z0 = -WORLD_HALF + cj * CELL;
      const dx = Math.max(x0 - cx, 0, cx - x0 - CELL), dz = Math.max(z0 - cz, 0, cz - z0 - CELL);
      const dn2 = dx * dx + dz * dz;
      if (dn2 > far * far) continue;
      const dn = Math.sqrt(dn2);
      const hm = this.cellH[c * 2], hh = this.cellH[c * 2 + 1];
      this.sphere.center.set(x0 + CELL / 2, hm + 0.5, z0 + CELL / 2);
      this.sphere.radius = CELL * 0.71 + hh + 0.8 + dn * 0.03;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      // колко от кръпката трябва тук: гъстотата на най-близката точка × най-голямата маска
      const want = Math.max(L.dens * Math.min(1, Math.pow(near / Math.max(dn, 0.01), 4)), L.cov / ((1 + dn * g) * Math.max(dn, 0.5)));
      const q = (want * m) / CAP;
      const f = Math.min(FRACS - 1, Math.max(0, Math.floor(-2 * Math.log2(Math.max(q, 1e-6)))));
      let segs = L.segs[L.segs.length - 1][1];
      for (const [d, s] of L.segs) if (dn < d) { segs = s; break; }
      const h = Math.imul(ci, 73856093) ^ Math.imul(cj, 19349663);
      const tz = ((h >>> 7) & 7) + 8 * Math.min(63, Math.ceil(hh * 4));
      this.push(this.bucket('grass', segs, f), x0, z0, tz, hm);
      if (L.flowers > 0 && dn < L.flowers && this.cellFlower[c] > 0.01) this.push(this.bucket('flower', 0, 0), x0, z0, tz, hm);
    }
    for (const b of this.buckets.values()) {
      b.geo.instanceCount = b.n;
      b.mesh.visible = b.n > 0;
      if (b.n > 0) { b.attr.clearUpdateRanges(); b.attr.addUpdateRange(0, b.n * 4); b.attr.needsUpdate = true; }
    }
  }

  private push(b: Bucket, x0: number, z0: number, tz: number, hm: number): void {
    if (b.n >= this.maxCells) return;
    const o = b.n * 4;
    b.arr[o] = x0; b.arr[o + 1] = z0; b.arr[o + 2] = tz; b.arr[o + 3] = hm;
    b.n++;
  }
}
