// Какво закрива камерата: стволовете на дърветата и къщите (чиста логика, без three.js).
// Камерата на героя пита cameraHit(x, y, z) по лъча от героя към себе си и се приближава, ако влиза в ствол или стена.
// Короните НЕ дърпат камерата: дърветата пред нея се разтварят (trees/materials.ts, VEG_CAMFADE) — така в гората
// камерата остава зад героя на нормално разстояние, вместо да се забива в него сред тъмните игли.
import { WORLD_HALF } from '../data/layout';
import { heightAt } from './height';
import type { WorldPlan } from './plan';

const CELL = 8;
const N = Math.ceil((WORLD_HALF * 2) / CELL);

/** Ствол: вертикален цилиндър до y1. Кутия (къща). */
type Shape =
  | { k: 'trunk'; x: number; z: number; y1: number; r: number }
  | { k: 'box'; x: number; z: number; hw: number; hd: number; cs: number; sn: number; y1: number };

export class CameraBlockers {
  private grid: Shape[][] = Array.from({ length: N * N }, () => []);

  constructor(plan: Pick<WorldPlan, 'pines' | 'oaks' | 'houses'> & Partial<Pick<WorldPlan, 'props'>>) {
    // мерките следват моделите във vegetation.ts: смърчът/елата са високи 17.5·s м, стволът ~0.3·s;
    // дъбът се разклонява на ~3 м, клоните са до ~5.5·s
    for (const t of plan.pines) this.add({ k: 'trunk', x: t.x, z: t.z, y1: heightAt(t.x, t.z) + 17 * t.s, r: 0.3 * t.s }, 0.3 * t.s);
    for (const t of plan.oaks) this.add({ k: 'trunk', x: t.x, z: t.z, y1: heightAt(t.x, t.z) + 5.5 * t.s, r: 0.4 * t.s }, 0.4 * t.s);
    // старият орех на мегдана — дебел ствол до разклона (~3.4 м)
    for (const p of plan.props ?? []) if (p.type === 'walnut') this.add({ k: 'trunk', x: p.x, z: p.z, y1: heightAt(p.x, p.z) + 4, r: 1.0 }, 1.0);
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

  /** Точката (с малък запас pad) вътре в ствол или къща ли е. */
  hit(x: number, y: number, z: number, pad = 0.25): boolean {
    for (const s of this.grid[this.ci(z) * N + this.ci(x)]) {
      if (s.k === 'trunk') {
        if (y > s.y1) continue;
        const r = s.r + pad;
        if ((x - s.x) ** 2 + (z - s.z) ** 2 < r * r) return true;
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
