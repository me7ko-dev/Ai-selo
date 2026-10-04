// Какво закрива камерата: короните на боровете и дъбовете и къщите (чиста логика, без three.js).
// Камерата на героя пита cameraHit(x, y, z) по лъча от героя към себе си и се приближава, ако влиза в дърво или стена —
// иначе в гъстата гора се вижда само тъмнозелена стена от игли.
import { WORLD_HALF } from '../data/layout';
import { heightAt } from './height';
import type { WorldPlan } from './plan';

const CELL = 8;
const N = Math.ceil((WORLD_HALF * 2) / CELL);

/** Конус (бор): от y0 до y1, радиус r0 долу → 0 горе. Сфера (дъб): център cy, радиус r. Кутия (къща). */
type Shape =
  | { k: 'cone'; x: number; z: number; y0: number; y1: number; r0: number }
  | { k: 'ball'; x: number; z: number; cy: number; r: number }
  | { k: 'box'; x: number; z: number; hw: number; hd: number; cs: number; sn: number; y1: number };

export class CameraBlockers {
  private grid: Shape[][] = Array.from({ length: N * N }, () => []);

  constructor(plan: Pick<WorldPlan, 'pines' | 'oaks' | 'houses'>) {
    for (const t of plan.pines) {
      const g = heightAt(t.x, t.z) - 0.2 * t.s;
      // най-долният конус на бора: радиус 2,3, от 1,6 до 9,4 м (по мащаба); малко по-тесен, за да не скача камерата от клонки
      this.add({ k: 'cone', x: t.x, z: t.z, y0: g + 1.5 * t.s, y1: g + 9.4 * t.s, r0: 2.0 * t.s }, 2.0 * t.s);
    }
    for (const t of plan.oaks) {
      const g = heightAt(t.x, t.z);
      this.add({ k: 'ball', x: t.x, z: t.z, cy: g + 4.6 * t.s, r: 2.5 * t.s }, 2.5 * t.s);
    }
    for (const h of plan.houses) {
      const g = heightAt(h.x, h.z);
      this.add({ k: 'box', x: h.x, z: h.z, hw: h.w / 2, hd: h.d / 2, cs: Math.cos(h.rot), sn: Math.sin(h.rot), y1: g + 6.5 }, Math.hypot(h.w, h.d) / 2);
    }
  }

  private ci(v: number): number { return Math.max(0, Math.min(N - 1, Math.floor((v + WORLD_HALF) / CELL))); }

  private add(s: Shape, r: number): void {
    const i0 = this.ci(s.x - r), i1 = this.ci(s.x + r), j0 = this.ci(s.z - r), j1 = this.ci(s.z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[j * N + i].push(s);
  }

  /** Точката (с малък запас pad) вътре в корона или къща ли е. */
  hit(x: number, y: number, z: number, pad = 0.25): boolean {
    for (const s of this.grid[this.ci(z) * N + this.ci(x)]) {
      if (s.k === 'cone') {
        if (y < s.y0 - pad || y > s.y1) continue;
        const r = s.r0 * (1 - Math.max(0, y - s.y0) / (s.y1 - s.y0)) + pad;
        if ((x - s.x) ** 2 + (z - s.z) ** 2 < r * r) return true;
      } else if (s.k === 'ball') {
        const r = s.r + pad;
        if ((x - s.x) ** 2 + (y - s.cy) ** 2 + (z - s.z) ** 2 < r * r) return true;
      } else {
        if (y > s.y1) continue;
        const wx = x - s.x, wz = z - s.z;
        const lx = wx * s.cs - wz * s.sn, lz = wx * s.sn + wz * s.cs;
        if (Math.abs(lx) < s.hw + pad && Math.abs(lz) < s.hd + pad) return true;
      }
    }
    return false;
  }
}
