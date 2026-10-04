// Мъгла над неизследваното: 64×64 клетки за целия свят (1 = видяно). Без three.js.
import { WORLD_HALF } from '../data/layout';

export const FOG_N = 64;
export const FOG_CELL = (WORLD_HALF * 2) / FOG_N;

export class FogGrid {
  grid = new Uint8Array(FOG_N * FOG_N);

  /** Отваря кръг с радиус r (метри) около (x, z). Връща колко нови клетки е отворил. */
  reveal(x: number, z: number, r: number): number {
    let n = 0;
    const cx = (x + WORLD_HALF) / FOG_CELL, cz = (z + WORLD_HALF) / FOG_CELL, rc = r / FOG_CELL;
    const x0 = Math.max(0, Math.floor(cx - rc)), x1 = Math.min(FOG_N - 1, Math.ceil(cx + rc));
    const z0 = Math.max(0, Math.floor(cz - rc)), z1 = Math.min(FOG_N - 1, Math.ceil(cz + rc));
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const dx = i + 0.5 - cx, dz = j + 0.5 - cz;
      if (dx * dx + dz * dz <= rc * rc && !this.grid[j * FOG_N + i]) { this.grid[j * FOG_N + i] = 1; n++; }
    }
    return n;
  }

  isExplored(x: number, z: number): boolean {
    const i = Math.floor((x + WORLD_HALF) / FOG_CELL), j = Math.floor((z + WORLD_HALF) / FOG_CELL);
    if (i < 0 || j < 0 || i >= FOG_N || j >= FOG_N) return false;
    return this.grid[j * FOG_N + i] === 1;
  }

  /** base64 от битове (512 байта). */
  serialize(): string {
    const bytes = new Uint8Array(this.grid.length / 8);
    for (let k = 0; k < this.grid.length; k++) if (this.grid[k]) bytes[k >> 3] |= 1 << (k & 7);
    return toBase64(bytes);
  }

  load(s: string | undefined): void {
    this.grid.fill(0);
    if (!s) return;
    try {
      const bytes = fromBase64(s);
      for (let k = 0; k < this.grid.length; k++) if (bytes[k >> 3] & (1 << (k & 7))) this.grid[k] = 1;
    } catch { /* развален запис — започва отначало */ }
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return s;
}
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]), b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1, d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out.push((n >> 16) & 255);
    if (c >= 0) out.push((n >> 8) & 255);
    if (d >= 0) out.push(n & 255);
  }
  return new Uint8Array(out);
}
