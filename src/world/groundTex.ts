// Общите текстури на земята (за терена и за тревата): маските от ground.ts, височините на мрежата и шум.
import * as THREE from 'three';
import { BASE_N, LINES_N, type GroundData } from './ground';

export interface GroundTextures {
  region: THREE.DataTexture;
  grassParams: THREE.DataTexture;
  macro: THREE.DataTexture;
  lines: THREE.DataTexture;
  noise: THREE.DataTexture;
}

function dataTex(data: Uint8Array, n: number, srgb = false, mips = true): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Плавен шум, който се повтаря без шев (стойности по решетка с период p). */
function periodicNoise(n: number, period: number, oct: number, seed: number): Float32Array {
  const out = new Float32Array(n * n);
  const hash = (x: number, y: number, p: number) => {
    x = ((x % p) + p) % p; y = ((y % p) + p) % p;
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  let norm = 0;
  for (let o = 0, amp = 1, p = period; o < oct; o++, amp *= 0.5, p *= 2) {
    norm += amp;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const fx = (i / n) * p, fy = (j / n) * p, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = hash(ix, iy, p), b = hash(ix + 1, iy, p), c = hash(ix, iy + 1, p), d = hash(ix + 1, iy + 1, p);
      out[j * n + i] += ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) * amp;
    }
  }
  for (let k = 0; k < out.length; k++) out[k] /= norm;
  return out;
}

let _noise: THREE.DataTexture | null = null;
/** 256² шум без шев: R — едър, G — друг едър, B — по-ситен, A — бял шум. */
export function noiseTexture(): THREE.DataTexture {
  if (_noise) return _noise;
  const n = 256;
  const r = periodicNoise(n, 4, 4, 1), g = periodicNoise(n, 4, 4, 7), b = periodicNoise(n, 16, 3, 13);
  const data = new Uint8Array(n * n * 4);
  // разтягаме контраста (fbm е събран около 0.5)
  const st = (v: number) => Math.round(Math.min(1, Math.max(0, (v - 0.5) * 1.9 + 0.5)) * 255);
  let s = 12345;
  for (let k = 0; k < n * n; k++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[k * 4] = st(r[k]); data[k * 4 + 1] = st(g[k]); data[k * 4 + 2] = st(b[k]); data[k * 4 + 3] = s >>> 24;
  }
  const t = dataTex(data, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return (_noise = t);
}

export function groundTextures(g: GroundData, maxAniso = 8): GroundTextures {
  const lines = dataTex(g.lines, LINES_N);
  lines.anisotropy = Math.min(8, maxAniso);
  return {
    region: dataTex(g.region, BASE_N),
    grassParams: dataTex(g.grassParams, BASE_N, false, false),
    macro: dataTex(g.macro, BASE_N, true),
    lines,
    noise: noiseTexture(),
  };
}

/** Височините на мрежата на терена (стъпка step) + нормалата: RGBA float (h, nx, nz, 0) — тревата стъпва точно по триъгълниците. */
export function heightTexture(H: Float32Array, n1: number): THREE.DataTexture {
  const data = new Float32Array(n1 * n1 * 4);
  const h = (i: number, j: number) => H[Math.min(n1 - 1, Math.max(0, j)) * n1 + Math.min(n1 - 1, Math.max(0, i))];
  for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
    const k = (j * n1 + i) * 4;
    const nx = h(i - 1, j) - h(i + 1, j), nz = h(i, j - 1) - h(i, j + 1), ny = 4, l = Math.hypot(nx, ny, nz);
    data[k] = h(i, j); data[k + 1] = nx / l; data[k + 2] = nz / l; data[k + 3] = 1;
  }
  const t = new THREE.DataTexture(data, n1, n1, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
