// Височината на терена — чиста функция (без three.js), за да я ползват и светът, и героят, и симулацията.
// Светът строи терена от нея; героят и враговете стъпват по нея. Подписът heightAt(x, z) не се сменя.
import { PLACES, RIVER_PATH, RIVER_HALF_WIDTH, VILLAGE_CENTER, WORLD_HALF, type Vec2 } from '../data/layout';

function hash(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(t: number) { return t * t * (3 - 2 * t); }
function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz; // 0..1
}
export function fbm(x: number, z: number, oct = 4): number {
  let s = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += valueNoise(x * f + i * 17.3, z * f - i * 9.1) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm; // 0..1
}

function gauss(x: number, z: number, c: Vec2, sigma: number): number {
  const dx = x - c.x, dz = z - c.z;
  return Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma));
}
function smoothstep(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

/** Разстояние от точка до коритото на реката (до средата му) и параметър по дължината (0 = извора). */
export function riverInfo(x: number, z: number): { dist: number; t: number } {
  let best = Infinity, bt = 0, acc = 0;
  const total = riverLength();
  for (let i = 0; i < RIVER_PATH.length - 1; i++) {
    const a = RIVER_PATH[i], b = RIVER_PATH[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz, len = Math.sqrt(len2);
    let u = ((x - a.x) * abx + (z - a.z) * abz) / len2; u = Math.max(0, Math.min(1, u));
    const px = a.x + abx * u - x, pz = a.z + abz * u - z, d = Math.sqrt(px * px + pz * pz);
    if (d < best) { best = d; bt = (acc + len * u) / total; }
    acc += len;
  }
  return { dist: best, t: bt };
}
let _riverLen = 0;
function riverLength() {
  if (_riverLen) return _riverLen;
  for (let i = 0; i < RIVER_PATH.length - 1; i++) { const a = RIVER_PATH[i], b = RIVER_PATH[i + 1]; _riverLen += Math.hypot(b.x - a.x, b.z - a.z); }
  return _riverLen;
}

const PEAK = PLACES.lamia_peak.pos, PLATEAU = PLACES.lamia_plateau.pos, FORT = PLACES.fortress.pos, POND = PLACES.pond.pos;
export const VILLAGE_GROUND = 2;
export const PLATEAU_HEIGHT = 30;
export const FORTRESS_HEIGHT = 15;

/** Терен без реката (за да знаем колко дълбоко да е коритото). */
function baseHeight(x: number, z: number): number {
  // меки хълмове
  let h = (fbm(x * 0.0075, z * 0.0075) - 0.5) * 16 + (fbm(x * 0.03, z * 0.03, 2) - 0.5) * 2.2 + 3;
  // Ламин връх + платото пред бърлогата
  h += 58 * gauss(x, z, PEAK, 42) + 26 * gauss(x, z, PLATEAU, 40);
  const dPl = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  h = h + (PLATEAU_HEIGHT - h) * (1 - smoothstep(18, 32, dPl));
  // хълмът на крепостта (плосък отгоре)
  h += 13 * gauss(x, z, FORT, 34);
  const dF = Math.hypot(x - FORT.x, z - FORT.z);
  h = h + (FORTRESS_HEIGHT - h) * (1 - smoothstep(16, 26, dF));
  // планини по края, за да е затворен светът
  const edge = Math.max(Math.abs(x), Math.abs(z));
  if (edge > WORLD_HALF - 60) h += Math.pow(edge - (WORLD_HALF - 60), 2) * 0.03 + (fbm(x * 0.02, z * 0.02) - 0.3) * 6 * smoothstep(WORLD_HALF - 60, WORLD_HALF, edge);
  // селото е на равно
  const dV = Math.hypot(x - VILLAGE_CENTER.x, z - VILLAGE_CENTER.z);
  h = h + (VILLAGE_GROUND - h) * (1 - smoothstep(62, 92, dV));
  return h;
}

/** Височината на терена в точка (x, z). */
export function heightAt(x: number, z: number): number {
  let h = baseHeight(x, z);
  // коритото на реката: канал, дълбок ~3 м, с меки брегове
  const r = riverInfo(x, z);
  if (r.dist < RIVER_HALF_WIDTH + 6) {
    const k = 1 - smoothstep(RIVER_HALF_WIDTH * 0.5, RIVER_HALF_WIDTH + 6, r.dist);
    h -= 3.2 * k;
  }
  // езерцето на поляната
  const dP = Math.hypot(x - POND.x, z - POND.z);
  if (dP < 18) h -= 2.6 * (1 - smoothstep(6, 18, dP));
  return h;
}

/** Височина на водата в коритото (когато реката тръгне) — малко под бреговете. */
export function riverWaterHeight(x: number, z: number): number {
  return heightAt(x, z) + 0.9;
}
export const POND_WATER_HEIGHT = (() => baseHeight(POND.x, POND.z) - 1.2)();

/** Нормала на терена (за наклон, за подравняване на камъни и т.н.). */
export function normalAt(x: number, z: number): [number, number, number] {
  const e = 0.5;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -dx, ny = 2 * e, nz = -dz, l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}
