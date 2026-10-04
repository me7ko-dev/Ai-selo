// Препятствия на света (чиста логика, без three.js): кръгове, завъртени правоъгълници, отсечки.
// Пространствена мрежа с клетки CELL м → collide() проверява само близките.
import { LOCKED_REGIONS, PLACES, WORLD_HALF } from '../data/layout';

export interface CircleCol { kind: 'circle'; x: number; z: number; r: number }
/** Завъртян правоъгълник: център, половин размери по локалните оси, ъгъл rot (като rotation.y). */
export interface BoxCol { kind: 'box'; x: number; z: number; hw: number; hd: number; rot: number }
/** Отсечка с дебелина (зид, ограда, паднал дънер). */
export interface SegCol { kind: 'seg'; ax: number; az: number; bx: number; bz: number; r: number }
export type Collider = CircleCol | BoxCol | SegCol;

const CELL = 8;
const GRID_N = Math.ceil((WORLD_HALF * 2) / CELL);

function bounds(c: Collider): [number, number, number, number] {
  if (c.kind === 'circle') return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
  if (c.kind === 'box') { const e = Math.hypot(c.hw, c.hd); return [c.x - e, c.z - e, c.x + e, c.z + e]; }
  return [Math.min(c.ax, c.bx) - c.r, Math.min(c.az, c.bz) - c.r, Math.max(c.ax, c.bx) + c.r, Math.max(c.az, c.bz) + c.r];
}

export class CollisionWorld {
  readonly all: Collider[] = [];
  private grid: Collider[][] = Array.from({ length: GRID_N * GRID_N }, () => []);
  edgeLimit = WORLD_HALF - 8;
  /** Заключените места са невидима стена (кръг); lockedAt() връща съобщението малко преди стената. */
  lockWalls = LOCKED_REGIONS.map(l => ({ x: PLACES[l.place].pos.x, z: PLACES[l.place].pos.z, r: l.radius, message: l.message }));

  add(c: Collider): void {
    this.all.push(c);
    const [x0, z0, x1, z1] = bounds(c);
    const i0 = this.ci(x0), i1 = this.ci(x1), j0 = this.ci(z0), j1 = this.ci(z1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[j * GRID_N + i].push(c);
  }
  circle(x: number, z: number, r: number) { this.add({ kind: 'circle', x, z, r }); }
  box(x: number, z: number, w: number, d: number, rot: number) { this.add({ kind: 'box', x, z, hw: w / 2, hd: d / 2, rot }); }
  seg(ax: number, az: number, bx: number, bz: number, r: number) { this.add({ kind: 'seg', ax, az, bx, bz, r }); }

  private ci(v: number) { return Math.max(0, Math.min(GRID_N - 1, Math.floor((v + WORLD_HALF) / CELL))); }

  /** Колайдерите около точка (за проби/дебъг). */
  near(x: number, z: number): Collider[] { return this.grid[this.ci(z) * GRID_N + this.ci(x)]; }

  /** Блокирана ли е точката за кръг с радиус r. */
  blocked(x: number, z: number, r: number): boolean {
    const p = this.collide(x, z, r);
    return Math.abs(p.x - x) > 1e-4 || Math.abs(p.z - z) > 1e-4;
  }

  collide(x: number, z: number, radius: number): { x: number; z: number } {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const i0 = this.ci(x - radius), i1 = this.ci(x + radius), j0 = this.ci(z - radius), j1 = this.ci(z + radius);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        for (const c of this.grid[j * GRID_N + i]) {
          const p = pushOut(c, x, z, radius);
          if (p) { x = p[0]; z = p[1]; moved = true; }
        }
      }
      if (!moved) break;
    }
    for (const w of this.lockWalls) {
      const dx = x - w.x, dz = z - w.z, d = Math.hypot(dx, dz), min = w.r + radius;
      if (d < min && d > 1e-6) { x = w.x + (dx / d) * min; z = w.z + (dz / d) * min; }
    }
    const lim = this.edgeLimit;
    x = Math.max(-lim, Math.min(lim, x)); z = Math.max(-lim, Math.min(lim, z));
    return { x, z };
  }

  lockedAt(x: number, z: number): string | null {
    for (const w of this.lockWalls) if (Math.hypot(x - w.x, z - w.z) < w.r + 2.5) return w.message;
    return null;
  }
}

function pushOut(c: Collider, x: number, z: number, r: number): [number, number] | null {
  if (c.kind === 'circle') {
    const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, min = c.r + r;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return [c.x + min, z];
    return [c.x + (dx / d) * min, c.z + (dz / d) * min];
  }
  if (c.kind === 'seg') {
    const abx = c.bx - c.ax, abz = c.bz - c.az, l2 = abx * abx + abz * abz;
    let u = l2 > 0 ? ((x - c.ax) * abx + (z - c.az) * abz) / l2 : 0; u = Math.max(0, Math.min(1, u));
    const px = c.ax + abx * u, pz = c.az + abz * u;
    const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz, min = c.r + r;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) { const nl = Math.sqrt(l2) || 1; return [px - (abz / nl) * min, pz + (abx / nl) * min]; }
    return [px + (dx / d) * min, pz + (dz / d) * min];
  }
  // box: в локални координати (rotation.y: local→world x = lx cos + lz sin, z = -lx sin + lz cos)
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  const wx = x - c.x, wz = z - c.z;
  const lx = wx * cs - wz * sn, lz = wx * sn + wz * cs;
  const cx = Math.max(-c.hw, Math.min(c.hw, lx)), cz = Math.max(-c.hd, Math.min(c.hd, lz));
  let dx = lx - cx, dz = lz - cz;
  const d2 = dx * dx + dz * dz;
  let nlx: number, nlz: number;
  if (d2 > 1e-10) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    nlx = cx + (dx / d) * r; nlz = cz + (dz / d) * r;
  } else {
    // центърът е вътре → най-късият изход
    const ex = c.hw - Math.abs(lx), ez = c.hd - Math.abs(lz);
    if (ex < ez) { nlx = Math.sign(lx || 1) * (c.hw + r); nlz = lz; } else { nlx = lx; nlz = Math.sign(lz || 1) * (c.hd + r); }
  }
  return [c.x + nlx * cs + nlz * sn, c.z - nlx * sn + nlz * cs];
}
