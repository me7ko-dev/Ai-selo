// Какво трябва на героя/враговете/камерата от света. Светът (World3D) го изпълнява истински;
// за проби има simpleWorldQuery (само терен, без препятствия).
import { heightAt } from '../world/height';
import { LOCKED_REGIONS, PLACES, WORLD_HALF } from '../data/layout';

export interface WorldQuery {
  heightAt(x: number, z: number): number;
  /** Избутва кръг (x, z, radius) извън препятствията (къщи, зидове, дървета, скали) и границите на света. */
  collide(x: number, z: number, radius: number): { x: number; z: number };
  /** Ако точката е в заключено място — съобщението; иначе null. */
  lockedAt(x: number, z: number): string | null;
  /** Има ли вода (езерото, а по-късно и реката) — за звук/забавяне. */
  waterAt(x: number, z: number): boolean;
}

export const simpleWorldQuery: WorldQuery = {
  heightAt,
  collide(x, z) {
    const lim = WORLD_HALF - 8;
    return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-lim, Math.min(lim, z)) };
  },
  lockedAt(x, z) {
    for (const l of LOCKED_REGIONS) { const p = PLACES[l.place].pos; if (Math.hypot(x - p.x, z - p.z) < l.radius) return l.message; }
    return null;
  },
  waterAt() { return false; },
};
