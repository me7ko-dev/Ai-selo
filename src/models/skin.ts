// Процедурни „кожи“ за чудовищата и животните: люспи, коремни плочи, козина, вълна, пера — цвят + нормали +
// грапавост, смятани пиксел по пиксел (без файлове), безшевни при повторение. В Node (без DOM) връщат null.
import * as THREE from 'three';

export type SkinKind = 'scales' | 'belly' | 'fur' | 'wool' | 'feathers' | 'hide';

export interface SkinMaps { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }

const hasDom = typeof document !== 'undefined';
const cache = new Map<string, SkinMaps | null>();

function hash2(x: number, y: number, s = 0): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
/** Безшевен шум на мрежа с период p (клетки). */
function tnoise(x: number, y: number, p: number, s = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a: number) => ((a % p) + p) % p;
  const a = hash2(w(xi), w(yi), s), b = hash2(w(xi + 1), w(yi), s), c = hash2(w(xi), w(yi + 1), s), d = hash2(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

interface Field { h: Float32Array; tone: Float32Array; rough: Float32Array }

const N = 256;

/** Люспи като керемиди: редове с отместване, долният ред лежи върху горния; всяка люспа е издута и с ребро. */
function scalesField(cols: number, rows: number): Field {
  const h = new Float32Array(N * N), tone = new Float32Array(N * N), rough = new Float32Array(N * N);
  const cw = N / cols, rh = N / rows;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let best = -1, bh = 0, bt = 0.5, br = 0;
    const r0 = Math.floor(y / rh);
    for (let dr = -1; dr <= 1; dr++) {
      const r = r0 + dr;
      const off = (((r % 2) + 2) % 2) * 0.5;
      const c0 = Math.floor(x / cw - off);
      for (let dc = -1; dc <= 1; dc++) {
        const c = c0 + dc;
        // център на люспата; свободният ѝ ръб е надолу (+y)
        const cx = (c + off + 0.5) * cw, cy = (r + 0.35) * rh;
        const dx = (x - cx) / (cw * 0.62), dy = (y - cy) / (rh * 1.05);
        if (dy < -1.1) continue;
        const d = dx * dx + Math.max(0, dy) * Math.max(0, dy) * 1.0 + Math.min(0, dy) * Math.min(0, dy) * 0.35;
        if (d >= 1) continue;
        // по-късният (долен) ред е отгоре
        const order = r * 4 + (dc + 1);
        if (order <= best) continue;
        best = order;
        const bulge = Math.sqrt(1 - d);
        const keel = Math.max(0, 1 - Math.abs(dx) * 5) * 0.18 * Math.max(0, 1 - Math.abs(dy));
        const wr = ((c % cols) + cols) % cols, rr = ((r % rows) + rows) % rows;
        bh = 0.25 + 0.6 * bulge + keel + 0.15 * Math.max(0, dy);
        bt = 0.35 + 0.65 * hash2(wr, rr, 3);
        br = 1 - bulge;
      }
    }
    const i = y * N + x;
    const n = tnoise(x / 16, y / 16, N / 16, 9);
    h[i] = best < 0 ? 0 : bh + (n - 0.5) * 0.06;
    tone[i] = best < 0 ? 0 : bt;
    rough[i] = best < 0 ? 1 : 0.15 + 0.5 * br + 0.2 * n;
  }
  return { h, tone, rough };
}

/** Коремни плочи: широки ленти с жлеб между тях и ситни бръчки. */
function bellyField(rows: number): Field {
  const h = new Float32Array(N * N), tone = new Float32Array(N * N), rough = new Float32Array(N * N);
  const rh = N / rows;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const f = (y % rh) / rh;
    const plate = Math.sin(Math.min(1, f * 1.1) * Math.PI * 0.5) * (1 - Math.pow(Math.max(0, f - 0.85) / 0.15, 2));
    const n = tnoise(x / 8, y / 8, N / 8, 2);
    const i = y * N + x;
    h[i] = 0.2 + 0.7 * plate + (n - 0.5) * 0.08;
    tone[i] = 0.4 + 0.3 * hash2(Math.floor(y / rh), 0, 5) + 0.2 * n;
    rough[i] = 0.35 + 0.4 * (1 - plate) + 0.15 * n;
  }
  return { h, tone, rough };
}

/** Козина/вълна/пера/кожа: кичури (насочен шум), за вълната — къдрици, за перата — люспи с бодил. */
function hairField(kind: 'fur' | 'wool' | 'feathers' | 'hide'): Field {
  if (kind === 'feathers') {
    const f = scalesField(10, 14);
    for (let i = 0; i < f.rough.length; i++) f.rough[i] = 0.7 + 0.3 * f.rough[i];
    return f;
  }
  const h = new Float32Array(N * N), tone = new Float32Array(N * N), rough = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    let v: number, t: number;
    if (kind === 'wool') {
      // къдрици: клетъчни бучки + ситни нишки
      const a = tnoise(x / 10, y / 10, N / 10, 1), b = tnoise(x / 4, y / 4, N / 4, 2), c = tnoise(x / 2, y / 2, N / 2, 6);
      v = Math.pow(a, 0.8) * 0.6 + b * 0.3 + c * 0.1;
      t = 0.5 + (a - 0.5) * 0.6;
    } else if (kind === 'fur') {
      // кичури по оста y: силно разтеглен шум
      const a = tnoise(x / 2.5, y / 24, N / 2.5, 3), b = tnoise(x / 1.2, y / 10, N / 1.2, 4), c = tnoise(x / 20, y / 20, N / 20, 7);
      v = a * 0.55 + b * 0.3 + c * 0.15;
      t = 0.35 + c * 0.5 + (a - 0.5) * 0.3;
    } else {
      // гола кожа: пори и бръчки
      const a = tnoise(x / 32, y / 32, N / 32, 8), b = tnoise(x / 6, y / 6, N / 6, 9), c = tnoise(x / 2, y / 2, N / 2, 10);
      v = 0.5 + (b - 0.5) * 0.5 + (c - 0.5) * 0.25 - Math.max(0, 0.15 - Math.abs(a - 0.5)) * 2;
      t = 0.4 + a * 0.4;
    }
    h[i] = v; tone[i] = t; rough[i] = kind === 'hide' ? 0.6 + 0.3 * (1 - v) : 0.85 + 0.15 * (1 - v);
  }
  return { h, tone, rough };
}

function lin(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function toTextures(f: Field, dark: string, light: string, strength: number, crevice: number): SkinMaps | null {
  const mk = (srgb: boolean) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const c = cv.getContext('2d'); if (!c) return null;
    return { cv, c, img: c.createImageData(N, N) };
  };
  const col = mk(true), nor = mk(false), rgh = mk(false);
  if (!col || !nor || !rgh) return null;
  const A = lin(dark), B = lin(light);
  const at = (x: number, y: number) => f.h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, o = i * 4;
    const hh = f.h[i];
    // цвят: тон на люспата × засенчване на процепите
    const t = f.tone[i];
    const sh = 1 - crevice * (1 - Math.min(1, hh * 1.4));
    for (let k = 0; k < 3; k++) {
      const v = (A[k] + (B[k] - A[k]) * t) * sh;
      col.img.data[o + k] = Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));
    }
    col.img.data[o + 3] = 255;
    // нормала от наклона (Собел)
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    const nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nor.img.data[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
    nor.img.data[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
    nor.img.data[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
    nor.img.data[o + 3] = 255;
    const r = Math.round(Math.max(0, Math.min(1, f.rough[i])) * 255);
    rgh.img.data[o] = 255; rgh.img.data[o + 1] = r; rgh.img.data[o + 2] = 0; rgh.img.data[o + 3] = 255; // three чете грапавостта от G
  }
  const tex = (m: { cv: HTMLCanvasElement; c: CanvasRenderingContext2D; img: ImageData }, srgb: boolean) => {
    m.c.putImageData(m.img, 0, 0);
    const t = new THREE.CanvasTexture(m.cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: tex(col, true), normalMap: tex(nor, false), roughnessMap: tex(rgh, false) };
}

/**
 * Кожа по вид и два цвята (тъмен в процепите/сенките → светъл по върховете). Кешира се по параметрите.
 * Връща нови Texture обекти за всяко повторение (repeat), които споделят картинката.
 */
export function skinMaps(kind: SkinKind, dark: string, light: string, repeat: [number, number] = [1, 1]): SkinMaps | null {
  const key = `${kind}|${dark}|${light}`;
  let base = cache.get(key);
  if (base === undefined) {
    base = null;
    if (hasDom) {
      try {
        const f = kind === 'scales' ? scalesField(8, 8) : kind === 'belly' ? bellyField(6) : hairField(kind);
        const strength = kind === 'scales' ? 2.2 : kind === 'belly' ? 2.5 : kind === 'wool' ? 3 : kind === 'feathers' ? 1.8 : 1.6;
        const crevice = kind === 'scales' ? 0.75 : kind === 'belly' ? 0.4 : kind === 'wool' ? 0.45 : 0.35;
        base = toTextures(f, dark, light, strength, crevice);
      } catch { base = null; }
    }
    cache.set(key, base);
  }
  if (!base) return null;
  if (repeat[0] === 1 && repeat[1] === 1) return base;
  const rk = key + '|' + repeat.join(',');
  let r = cache.get(rk);
  if (r === undefined) {
    const cl = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(repeat[0], repeat[1]); c.needsUpdate = true; return c; };
    r = { map: cl(base.map), normalMap: cl(base.normalMap), roughnessMap: cl(base.roughnessMap) };
    cache.set(rk, r);
  }
  return r;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export interface SkinMatOpts { repeat?: [number, number]; roughness?: number; normal?: number; side?: THREE.Side; emissive?: string; emissiveIntensity?: number; tint?: string }

/**
 * Споделен PBR материал с процедурна кожа (гладко осветяване). В Node — само цвят.
 * tint умножава цвета (напр. по-тъмна „мъртва“ глава със същата текстура).
 */
export function skinMat(kind: SkinKind, dark: string, light: string, o: SkinMatOpts = {}): THREE.MeshStandardMaterial {
  const rep = o.repeat ?? [1, 1];
  const key = [kind, dark, light, rep.join(','), o.roughness ?? '', o.normal ?? '', o.side ?? 0, o.emissive ?? '', o.emissiveIntensity ?? '', o.tint ?? ''].join('|');
  let m = matCache.get(key);
  if (!m) {
    const maps = skinMaps(kind, dark, light, rep);
    const mid = new THREE.Color(dark).lerp(new THREE.Color(light), 0.5);
    m = new THREE.MeshStandardMaterial({
      color: maps ? (o.tint ?? '#ffffff') : mid,
      map: maps?.map ?? null, normalMap: maps?.normalMap ?? null, roughnessMap: maps?.roughnessMap ?? null,
      roughness: o.roughness ?? 1, metalness: 0, side: o.side ?? THREE.FrontSide,
    });
    if (maps && o.normal !== undefined) m.normalScale.set(o.normal, o.normal);
    if (o.emissive) { m.emissive.set(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
    matCache.set(key, m);
  }
  return m;
}

const plainCache = new Map<string, THREE.MeshStandardMaterial>();
/** Обикновен гладък PBR материал (рога, нокти, зъби, бодли, ципа на крилата). */
export function pmat(color: string, roughness = 0.6, o: { side?: THREE.Side; emissive?: string; emissiveIntensity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${o.side ?? 0}|${o.emissive ?? ''}|${o.emissiveIntensity ?? ''}`;
  let m = plainCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side: o.side ?? THREE.FrontSide });
    if (o.emissive) { m.emissive.set(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
    plainCache.set(key, m);
  }
  return m;
}
