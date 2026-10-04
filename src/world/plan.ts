// Планът на света (чиста логика, без three.js): къде стои всяка сграда, ограда, дърво, камък,
// и препятствията за collide(). World3D строи мрежите по този план; пробите го проверяват в Node.
import {
  FOREST, PLACES, RIVER_HALF_WIDTH, RIVER_PATH as RIVER_PATH_LOCAL, ROAD_EDGES, ROAD_NODES, ROSEN_SPOTS, VILLAGE_CENTER, WORLD_HALF, LOCKED_REGIONS, type PlaceId,
} from '../data/layout';
import { Rng } from '../core/rng';
import { fbm, heightAt, riverInfo, terrainHeight, BRIDGE } from './height';
import { CollisionWorld } from './collision';

export type Seg = [number, number, number, number];
export const ROAD_SEGS: Seg[] = ROAD_EDGES.map(([a, b]) => [ROAD_NODES[a].x, ROAD_NODES[a].z, ROAD_NODES[b].x, ROAD_NODES[b].z]);

export function segDist(x: number, z: number, s: Seg): number {
  const abx = s[2] - s[0], abz = s[3] - s[1], l2 = abx * abx + abz * abz;
  let u = l2 > 0 ? ((x - s[0]) * abx + (z - s[1]) * abz) / l2 : 0; u = Math.max(0, Math.min(1, u));
  return Math.hypot(s[0] + abx * u - x, s[1] + abz * u - z);
}
/** Разстояние до най-близкия път. */
export function roadDist(x: number, z: number): number {
  let d = Infinity;
  for (const s of ROAD_SEGS) { const v = segDist(x, z, s); if (v < d) d = v; }
  return d;
}
/** Ширина на пътя (половин) — в селото по-широк. */
export function roadHalfWidth(x: number, z: number): number {
  const dv = Math.hypot(x - VILLAGE_CENTER.x, z - VILLAGE_CENTER.z);
  return dv < 75 ? 1.9 : 1.5;
}

export const GLADE = PLACES.glade.pos, POND = PLACES.pond.pos, PLATEAU = PLACES.lamia_plateau.pos, PEAK = PLACES.lamia_peak.pos;
export const FORT = PLACES.fortress.pos, SWAMP = PLACES.swamp.pos;
export const ARENA_RADIUS = 26;

/** 0..1 — колко е „гора“ тук (борова). */
export function forestMask(x: number, z: number): number {
  const d = Math.hypot(x - FOREST.center.x, z - FOREST.center.z);
  const r = FOREST.radius * (0.86 + 0.32 * (fbm(x * 0.018 + 40, z * 0.018 - 13, 3) - 0.5) * 2);
  let m = 1 - smoothstep(r - 14, r, d);
  // поляната и пътеките
  const dg = Math.hypot(x - GLADE.x, z - GLADE.z);
  m *= smoothstep(28, 40, dg);
  return m;
}
export function smoothstep(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

export interface HouseSpec {
  id: PlaceId; kind: 'house' | 'inn';
  x: number; z: number; rot: number;
  w: number; d: number;           // приземният етаж (по локалните x и z)
  chardak: 'left' | 'right' | 'front'; chardakW: number;
  roof: 'hip' | 'gable'; seed: number;
  /** пълният отпечатък за препятствието (вкл. чардака) */
  fw: number; fd: number; fx: number; fz: number;
}
export interface Prop { type: string; x: number; z: number; rot: number; s: number; y?: number; extra?: number }
export interface TreeInst { x: number; z: number; s: number; rot: number; tint: number }
export interface FenceRun { type: 'fence' | 'wall' | 'wattle'; pts: [number, number][]; h: number }

export interface WorldPlan {
  houses: HouseSpec[];
  props: Prop[];                 // всичко дребно и сградите без къщите (ковачница, хан…)
  fences: FenceRun[];            // отсечки (оградите вече са разрязани там, където минават пътища)
  pines: TreeInst[]; oaks: TreeInst[]; bushes: TreeInst[]; rocks: TreeInst[]; deadTrees: TreeInst[];
  ferns: TreeInst[]; mushrooms: TreeInst[]; logs: TreeInst[]; flowers: TreeInst[];
  swampPools: { x: number; z: number; r: number; y: number }[];
  signs: { x: number; z: number; rot: number; boards: { text: string; dir: number }[] }[];
  /** разрушените зидове на крепостта: [ax, az, bx, bz, височина] */
  ruins: [number, number, number, number, number][];
  colliders: CollisionWorld;
  /** Отпечатъци на сгради/огради за картата и тревата: завъртени правоъгълници. */
  footprints: { x: number; z: number; w: number; d: number; rot: number; kind: string }[];
}

// ---- помощни: отпечатъци и чист терен -------------------------------------------------------
type Rect = { x: number; z: number; w: number; d: number; rot: number };
function rectContains(r: Rect, px: number, pz: number, pad: number): boolean {
  const cs = Math.cos(r.rot), sn = Math.sin(r.rot), wx = px - r.x, wz = pz - r.z;
  const lx = wx * cs - wz * sn, lz = wx * sn + wz * cs;
  return Math.abs(lx) < r.w / 2 + pad && Math.abs(lz) < r.d / 2 + pad;
}
/** Минава ли път през правоъгълника (с отстояние pad). */
function rectHitsRoad(r: Rect, pad: number): boolean {
  const reach = Math.hypot(r.w, r.d) / 2 + pad + 2;
  for (const s of ROAD_SEGS) {
    if (segDist(r.x, r.z, s) > reach) continue;
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(2, Math.ceil(len / 0.5));
    for (let i = 0; i <= n; i++) {
      const u = i / n, px = s[0] + (s[2] - s[0]) * u, pz = s[1] + (s[3] - s[1]) * u;
      if (rectContains(r, px, pz, pad + 1.6)) return true;
    }
  }
  return false;
}
function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  // проста проверка с точки по периметъра на двата правоъгълника
  const test = (p: Rect, q: Rect) => {
    const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      if (i > 0 && i < 8 && j > 0 && j < 8) continue;
      const lx = (i / 8 - 0.5) * p.w, lz = (j / 8 - 0.5) * p.d;
      if (rectContains(q, p.x + lx * cs + lz * sn, p.z - lx * sn + lz * cs, pad)) return true;
    }
    return false;
  };
  return test(a, b) || test(b, a) || rectContains(b, a.x, a.z, pad);
}

/** Мести правоъгълника назад (и малко встрани), докато не пречи на пътища и други сгради. */
function placeClear(r: Rect, taken: Rect[], pad = 0.6): Rect {
  const fx = Math.sin(r.rot), fz = Math.cos(r.rot);   // лицето
  const sx = Math.cos(r.rot), sz = -Math.sin(r.rot);  // встрани
  const tries: [number, number][] = [[0, 0]];
  for (let b = 0.5; b <= 18; b += 0.5) for (const s of [0, -0.5, 0.5, -1, 1, -2, 2, -3, 3]) tries.push([b, s * b * 0.6]);
  for (const [back, side] of tries) {
    const c: Rect = { ...r, x: r.x - fx * back + sx * side, z: r.z - fz * back + sz * side };
    if (rectHitsRoad(c, pad)) continue;
    if (taken.some(t => rectsOverlap(c, t, 1.2))) continue;
    if (riverInfo(c.x, c.z).dist < RIVER_HALF_WIDTH + 8 + Math.max(c.w, c.d) / 2) continue;
    return c;
  }
  return r;
}

// ---- самият план ------------------------------------------------------------------------------
let _plan: WorldPlan | null = null;
export function getPlan(): WorldPlan { return _plan ??= buildPlan(); }

function buildPlan(): WorldPlan {
  const rng = new Rng(20260704);
  const col = new CollisionWorld();
  const taken: Rect[] = [];
  const footprints: WorldPlan['footprints'] = [];
  const props: Prop[] = [];
  const houses: HouseSpec[] = [];
  const fences: FenceRun[] = [];

  const takeRect = (r: Rect, kind: string, collide = true) => {
    taken.push(r); footprints.push({ ...r, kind });
    if (collide) col.box(r.x, r.z, r.w, r.d, r.rot);
  };
  /** локално → световно за правоъгълник r */
  const L = (r: { x: number; z: number; rot: number }, lx: number, lz: number): [number, number] => {
    const cs = Math.cos(r.rot), sn = Math.sin(r.rot);
    return [r.x + lx * cs + lz * sn, r.z - lx * sn + lz * cs];
  };

  // площадът — орехът и пейката около него
  const W = PLACES.walnut.pos;
  col.circle(W.x, W.z, 1.0);
  props.push({ type: 'walnut', x: W.x, z: W.z, rot: 0.4, s: 1 });
  props.push({ type: 'bench_ring', x: W.x, z: W.z, rot: 0, s: 2.6 });
  col.circle(W.x, W.z, 3.0);
  taken.push({ x: W.x, z: W.z, w: 7, d: 7, rot: 0 });

  // ---- къщите
  const houseIds: PlaceId[] = ['house_gena', 'house_peyu', 'house_petko', 'house_ivan', 'house_maria', 'house_radka', 'house_kalin'];
  const variants: Pick<HouseSpec, 'w' | 'd' | 'chardak' | 'roof' | 'chardakW'>[] = [
    { w: 7.6, d: 6.2, chardak: 'left', roof: 'hip', chardakW: 2.4 },
    { w: 9.4, d: 6.8, chardak: 'front', roof: 'hip', chardakW: 2.2 },
    { w: 7.2, d: 6.0, chardak: 'right', roof: 'gable', chardakW: 2.2 },
    { w: 8.4, d: 6.4, chardak: 'right', roof: 'hip', chardakW: 2.4 },
    { w: 8.0, d: 6.6, chardak: 'left', roof: 'hip', chardakW: 2.6 },
    { w: 8.6, d: 6.2, chardak: 'front', roof: 'gable', chardakW: 2.0 },
    { w: 7.4, d: 6.0, chardak: 'left', roof: 'hip', chardakW: 2.2 },
  ];
  houseIds.forEach((id, i) => {
    const pl = PLACES[id], v = variants[i];
    // отпечатък вкл. чардака
    let fw = v.w, fd = v.d, fx = 0, fz = 0;
    if (v.chardak === 'left') { fw += v.chardakW; fx = -v.chardakW / 2; }
    if (v.chardak === 'right') { fw += v.chardakW; fx = v.chardakW / 2; }
    if (v.chardak === 'front') { fd += v.chardakW; fz = v.chardakW / 2; }
    const rot = pl.facing ?? 0;
    const [cx, cz] = L({ x: pl.pos.x, z: pl.pos.z, rot }, fx, fz);
    const r = placeClear({ x: cx, z: cz, w: fw, d: fd, rot }, taken);
    const [hx, hz] = L(r, -fx, -fz);
    houses.push({ id, kind: 'house', x: hx, z: hz, rot, ...v, seed: 100 + i * 17, fw, fd, fx, fz });
    takeRect(r, 'house');
  });

  // ---- ханът (два етажа, по-голям)
  {
    const pl = PLACES.inn, rot = pl.facing ?? 0;
    const v = { w: 9.6, d: 6.8, chardak: 'front' as const, roof: 'hip' as const, chardakW: 2.0 };
    const fd = v.d + v.chardakW;
    // ханът стои в клина между пътищата към кокошарника и към Радка (по-навътре от точката на мястото)
    const [cx, cz] = L({ x: pl.pos.x + 9, z: pl.pos.z - 1.6, rot }, 0, v.chardakW / 2);
    const r = placeClear({ x: cx, z: cz, w: v.w, d: fd, rot }, taken);
    const [hx, hz] = L(r, 0, -v.chardakW / 2);
    houses.push({ id: 'inn', kind: 'inn', x: hx, z: hz, rot, ...v, seed: 777, fw: v.w, fd, fx: 0, fz: v.chardakW / 2 });
    takeRect(r, 'house');
    // маси и пейки отпред (пред чардака)
    for (let k = 0; k < 3; k++) {
      const [tx, tz] = L(r, (k - 1) * 3.6, fd / 2 + 2.6);
      if (roadDist(tx, tz) > 2.8) { props.push({ type: 'table', x: tx, z: tz, rot, s: 1 }); col.box(tx, tz, 1.8, 2.2, rot); }
    }
    const [bx, bz] = L(r, v.w / 2 + 0.9, 1); props.push({ type: 'barrels', x: bx, z: bz, rot, s: 1 }); col.circle(bx, bz, 0.9);
    const [sx, sz] = L(r, -v.w / 2 - 0.2, fd / 2 + 0.6); props.push({ type: 'inn_sign', x: sx, z: sz, rot, s: 1 }); col.circle(sx, sz, 0.25);
  }

  // ---- ковачницата
  {
    const pl = PLACES.smithy, rot = pl.facing ?? 0;
    const r = placeClear({ x: pl.pos.x, z: pl.pos.z, w: 7, d: 6, rot }, taken);
    footprints.push({ ...r, kind: 'shed' }); taken.push(r);
    props.push({ type: 'smithy', x: r.x, z: r.z, rot, s: 1 });
    // задната стена с огнището, стълбове, наковалнята
    const [ax, az] = L(r, -3.3, -3); const [bx, bz] = L(r, 3.3, -3); col.seg(ax, az, bx, bz, 0.45);
    const [fx, fz] = L(r, -1.6, -1.9); col.circle(fx, fz, 1.2);
    for (const [px, pz] of [[-3.3, 2.8], [3.3, 2.8]]) { const [qx, qz] = L(r, px, pz); col.circle(qx, qz, 0.25); }
    const [nx, nz] = L(r, 1.0, 0.4); col.circle(nx, nz, 0.5);
  }

  // ---- кокошарникът
  {
    const pl = PLACES.coop, rot = pl.facing ?? 0;
    const r = placeClear({ x: pl.pos.x, z: pl.pos.z, w: 3.6, d: 2.8, rot }, taken);
    takeRect(r, 'shed');
    props.push({ type: 'coop', x: r.x, z: r.z, rot, s: 1 });
  }
  // ---- дърводелницата
  {
    const pl = PLACES.workshop_kalin, rot = pl.facing ?? 0;
    const r = placeClear({ x: pl.pos.x, z: pl.pos.z, w: 6, d: 4.2, rot }, taken);
    takeRect(r, 'shed');
    props.push({ type: 'workshop', x: r.x, z: r.z, rot, s: 1 });
    const [lx, lz] = L(r, 4.6, 0.5);
    if (roadDist(lx, lz) > 3) { props.push({ type: 'logs', x: lx, z: lz, rot: rot + Math.PI / 2, s: 1 }); col.box(lx, lz, 1.8, 3.2, rot); }
    const [sx, sz] = L(r, 0.5, 3.4);
    if (roadDist(sx, sz) > 2.6) { props.push({ type: 'sawhorse', x: sx, z: sz, rot, s: 1 }); col.circle(sx, sz, 0.6); }
  }
  // ---- станът на Мария
  {
    const pl = PLACES.loom_maria, rot = pl.facing ?? 0;
    const r = placeClear({ x: pl.pos.x, z: pl.pos.z, w: 3, d: 2.6, rot }, taken);
    takeRect(r, 'canopy', false);
    props.push({ type: 'loom', x: r.x, z: r.z, rot, s: 1 });
    col.box(r.x, r.z, 2.0, 1.4, rot);
  }
  // ---- чешмата
  {
    // в клина между пътищата североизточно от мегдана, с лице към ореха (на старото място placeClear я буташе
    // до (11.9, 39.1) — точно на пътеката от ореха към източния път)
    void PLACES.well;
    const rot = -0.72;
    const r = placeClear({ x: 13.2, z: 25.4, w: 3.2, d: 2.2, rot }, taken, 0.2);
    takeRect(r, 'fountain');
    props.push({ type: 'fountain', x: r.x, z: r.z, rot, s: 1 });
  }
  // ---- кошарата: плетена ограда в кръг с отвор към пътя + навес
  {
    const pl = PLACES.sheepfold, R = 8.5;
    const toNode = Math.atan2(ROAD_NODES.sheepfold.x - pl.pos.x, ROAD_NODES.sheepfold.z - pl.pos.z);
    const pts: [number, number][] = [];
    for (let a = 0.35; a <= Math.PI * 2 - 0.35 + 1e-6; a += 0.25) {
      const ang = toNode + a; pts.push([pl.pos.x + Math.sin(ang) * R, pl.pos.z + Math.cos(ang) * R]);
    }
    fences.push({ type: 'wattle', pts, h: 1.1 });
    const back = toNode + Math.PI;
    const sx = pl.pos.x + Math.sin(back) * 5.2, sz = pl.pos.z + Math.cos(back) * 5.2;
    props.push({ type: 'fold_shed', x: sx, z: sz, rot: back + Math.PI, s: 1 });
    col.box(sx, sz, 5, 2.6, back + Math.PI);
    footprints.push({ x: sx, z: sz, w: 5, d: 2.6, rot: back + Math.PI, kind: 'shed' });
    footprints.push({ x: pl.pos.x, z: pl.pos.z, w: R * 2, d: R * 2, rot: 0, kind: 'fold' });
    for (let k = 0; k < 2; k++) {
      const a = toNode + Math.PI * (0.55 + k * 0.9), hx = pl.pos.x + Math.sin(a) * (R + 3.5), hz = pl.pos.z + Math.cos(a) * (R + 3.5);
      if (roadDist(hx, hz) > 4) { props.push({ type: 'haystack', x: hx, z: hz, rot: a, s: 1 + k * 0.15 }); col.circle(hx, hz, 1.6); }
    }
  }
  // ---- нивата на Иван: редове + плашило
  {
    const pl = PLACES.field_ivan;
    const r = placeClear({ x: pl.pos.x + 6, z: pl.pos.z + 6, w: 24, d: 20, rot: 0.08 }, taken, 0.4);
    footprints.push({ ...r, kind: 'field' }); taken.push(r);
    props.push({ type: 'field', x: r.x, z: r.z, rot: r.rot, s: 1, extra: r.w * 100 + r.d });
    const [sx, sz] = L(r, 2, 1); props.push({ type: 'scarecrow', x: sx, z: sz, rot: 0.5, s: 1 }); col.circle(sx, sz, 0.3);
    // ниска каменна ограда около нивата с портичка на север (до хлопатаря/камбаната на Иван, откъм пътя)
    const c = (lx: number, lz: number) => L(r, lx, lz);
    const g0 = -2.6, g1 = 0.9;
    fences.push({ type: 'wall', pts: [c(g1, -10.8), c(12.8, -10.8), c(12.8, 10.8), c(-12.8, 10.8), c(-12.8, -10.8), c(g0, -10.8)], h: 0.8 });
    const [gx, gz] = c((g0 + g1) / 2, -10.8);
    props.push({ type: 'field_gate', x: gx, z: gz, rot: r.rot, s: 1, extra: g1 - g0 });
    for (const lx of [g0, g1]) { const [px, pz] = c(lx, -10.8); col.circle(px, pz, 0.45); }
    for (let k = 0; k < 3; k++) {
      const [hx, hz] = c(16 + k * 0.5, -6 + k * 5.5);
      if (roadDist(hx, hz) > 4) { props.push({ type: 'haystack', x: hx, z: hz, rot: k, s: 0.9 + k * 0.1 }); col.circle(hx, hz, 1.5); }
    }
  }

  // ---- стълбите към чардаците (стърчат извън отпечатъка на къщата) — да не се минава през тях
  for (const h of houses) {
    const rr = { x: h.x, z: h.z, rot: h.rot };
    const [sx, sz] = h.chardak === 'front'
      ? L(rr, h.w / 2 + 0.6, h.d / 2 + h.chardakW - 1.52)
      : L(rr, (h.chardak === 'left' ? -1 : 1) * (h.w / 2 + h.chardakW - 0.6), h.d / 2 + 0.55 + 1.23);
    if (roadDist(sx, sz) > roadHalfWidth(sx, sz) + 1.0) col.box(sx, sz, 1.0, h.chardak === 'front' ? 2.5 : 2.3, h.rot);
  }

  // ---- дворове: дървени огради зад къщите, дърва за огрев, плодни дървета
  const oaks: TreeInst[] = [];
  for (const h of houses) {
    const rr = { x: h.x, z: h.z, rot: h.rot };
    if (h.kind === 'house') {
      const yw = h.fw / 2 + 4, yb = -h.d / 2 - 6;
      const c = (lx: number, lz: number) => L(rr, lx + h.fx, lz);
      fences.push({ type: 'fence', pts: [c(-yw, 1), c(-yw, yb), c(yw, yb), c(yw, 1)], h: 1.0 });
      const [wx, wz] = L(rr, (h.chardak === 'left' ? 1 : -1) * (h.w / 2 + 1.0), -h.d / 2 + 1.4);
      if (roadDist(wx, wz) > 3) { props.push({ type: 'woodpile', x: wx, z: wz, rot: h.rot + Math.PI / 2, s: 1 }); col.box(wx, wz, 0.9, 2.2, h.rot); }
      const [tx, tz] = L(rr, (rng.next() - 0.5) * h.w, yb + 2.4);
      if (roadDist(tx, tz) > 4) { oaks.push({ x: tx, z: tz, s: 0.7 + rng.next() * 0.25, rot: rng.next() * 6.28, tint: 0.3 + rng.next() * 0.3 }); col.circle(tx, tz, 0.4); }
    }
  }
  // каменни зидове покрай пътя на юг от входа и до моста
  fences.push({ type: 'wall', pts: [[-3.6, 96], [-3.6, 128]], h: 0.9 });
  fences.push({ type: 'wall', pts: [[3.6, 99], [3.6, 128]], h: 0.9 });
  fences.push({ type: 'wall', pts: [[-12, 90], [-3.6, 96]], h: 0.9 });
  fences.push({ type: 'wall', pts: [[56, 30], [70, 36]], h: 0.9 });
  fences.push({ type: 'wall', pts: [[58, 60], [72, 52]], h: 0.9 });

  // ---- разрязване на оградите там, където минават пътища / сгради; препятствия
  const cutFences: FenceRun[] = [];
  for (const f of fences) {
    let run: [number, number][] = [];
    const flush = () => { if (run.length >= 2) cutFences.push({ type: f.type, pts: run, h: f.h }); run = []; };
    for (let i = 0; i < f.pts.length - 1; i++) {
      const [ax, az] = f.pts[i], [bx, bz] = f.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 1.0));
      for (let k = 0; k <= n; k++) {
        const u = k / n, px = ax + (bx - ax) * u, pz = az + (bz - az) * u;
        const blocked = roadDist(px, pz) < roadHalfWidth(px, pz) + 1.4
          || taken.some(t => rectContains(t, px, pz, 0.4) && f.type !== 'wattle' && !(t.w > 16))
          || riverInfo(px, pz).dist < RIVER_HALF_WIDTH + 5;
        if (blocked) flush(); else if (!(k === 0 && run.length && run[run.length - 1][0] === px && run[run.length - 1][1] === pz)) run.push([px, pz]);
      }
    }
    flush();
  }
  for (const f of cutFences) for (let i = 0; i < f.pts.length - 1; i++) col.seg(f.pts[i][0], f.pts[i][1], f.pts[i + 1][0], f.pts[i + 1][1], f.type === 'wall' ? 0.35 : 0.15);

  // ---- дребни неща в селото: бъчви, сандъци, купи сено
  const villageBits: [string, number, number][] = [
    ['crates', -27, 38], ['barrels', -38, 52], ['haystack', -46, 58], ['crates', 34, 58], ['woodpile', 12, 62],
    ['barrels', 18, 22], ['haystack', 60, 92], ['crates', -12, 24], ['cart', -10, 60], ['cart', 50, 40],
  ];
  for (const [t, x, z] of villageBits) {
    const r = placeClear({ x, z, w: t === 'cart' ? 3.2 : 1.8, d: t === 'cart' ? 1.8 : 1.8, rot: rng.next() * 6.28 }, taken, 0.2);
    if (rectHitsRoad(r, 0.3)) continue;
    taken.push(r);
    props.push({ type: t, x: r.x, z: r.z, rot: r.rot, s: 1 });
    if (t === 'cart') col.box(r.x, r.z, 3.0, 1.6, r.rot); else col.circle(r.x, r.z, t === 'haystack' ? 1.5 : 0.8);
  }

  // ---- мостът
  props.push({ type: 'bridge', x: (BRIDGE.x0 + BRIDGE.x1) / 2, z: BRIDGE.z, rot: 0, s: 1 });
  col.seg(BRIDGE.x0 + 7, BRIDGE.z - BRIDGE.halfW - 0.2, BRIDGE.x1 - 7, BRIDGE.z - BRIDGE.halfW - 0.2, 0.3);
  col.seg(BRIDGE.x0 + 7, BRIDGE.z + BRIDGE.halfW + 0.2, BRIDGE.x1 - 7, BRIDGE.z + BRIDGE.halfW + 0.2, 0.3);

  // ---- табели на кръстопътищата
  const signs: WorldPlan['signs'] = [];
  const dirTo = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(b.x - a.x, b.z - a.z);
  const addSign = (node: string, boards: { text: string; to: { x: number; z: number } }[]) => {
    const n = ROAD_NODES[node];
    for (let k = 0; k < 16; k++) {
      const a = k * 0.785 + 0.4, rr = 3.2 + (k >> 3);
      const x = n.x + Math.sin(a) * rr, z = n.z + Math.cos(a) * rr;
      if (roadDist(x, z) < 2.6 || taken.some(t => rectContains(t, x, z, 0.6))) continue;
      signs.push({ x, z, rot: 0, boards: boards.map(b => ({ text: b.text, dir: dirTo({ x, z }, b.to) })) });
      col.circle(x, z, 0.2);
      return;
    }
  };
  addSign('gate', [{ text: 'Самодивско', to: PLACES.square.pos }, { text: 'Към нивите', to: ROAD_NODES.fields }, { text: 'Пътят на юг', to: ROAD_NODES.south }]);
  addSign('bridge_w', [{ text: 'Старата крепост', to: PLACES.fortress.pos }, { text: 'Ламин връх', to: ROAD_NODES.river_mid }, { text: 'Самодивско', to: PLACES.square.pos }]);
  addSign('forest_edge', [{ text: 'Тъмната гора', to: ROAD_NODES.forest_mid }, { text: 'Самодивско', to: PLACES.square.pos }]);
  addSign('forest_deep', [{ text: 'Поляната', to: PLACES.glade.pos }]);
  addSign('river_mid', [{ text: 'Ламин връх', to: PLACES.lamia_plateau.pos }]);
  // табела пред блатото + барикада от дънери
  const logs: TreeInst[] = [];
  // паднал дънер: дълъг 4.2·s по локалната ос x (rotation.y = rot)
  const addLogCol = (x: number, z: number, s: number, rot: number) => {
    const dx = Math.cos(rot) * 2.1 * s, dz = -Math.sin(rot) * 2.1 * s;
    col.seg(x - dx, z - dz, x + dx, z + dz, 0.35 * s);
  };
  {
    const sw = LOCKED_REGIONS[0], sp = PLACES[sw.place].pos;
    const dx = VILLAGE_CENTER.x - sp.x, dz = VILLAGE_CENTER.z - sp.z, l = Math.hypot(dx, dz);
    const bx = sp.x + (dx / l) * (sw.radius + 1.5), bz = sp.z + (dz / l) * (sw.radius + 1.5);
    const sx = sp.x + (dx / l) * (sw.radius + 5), sz = sp.z + (dz / l) * (sw.radius + 5);
    signs.push({ x: sx, z: sz, rot: 0, boards: [{ text: 'Блатото — затворено', dir: Math.atan2(-dx, -dz) }] });
    col.circle(sx, sz, 0.2);
    for (let k = -2; k <= 2; k++) {
      const px = bx + (-dz / l) * k * 2.6, pz = bz + (dx / l) * k * 2.6;
      const lr = Math.atan2(-dz, dx) + (rng.next() - 0.5) * 0.6;
      logs.push({ x: px, z: pz, s: 1.2, rot: lr, tint: 0 }); addLogCol(px, pz, 1.2, lr);
    }
  }

  // ---- Старата крепост: зид в кръг с пролуки + две разрушени кули
  const F = FORT;
  const ruins: [number, number, number, number, number][] = [];
  {
    const R = 19, gateA = Math.atan2(ROAD_NODES.fortress.x - F.x, ROAD_NODES.fortress.z - F.z);
    const towers = [gateA + 2.1, gateA - 2.6];
    for (const ta of towers) {
      const tx = F.x + Math.sin(ta) * R, tz = F.z + Math.cos(ta) * R;
      props.push({ type: 'tower', x: tx, z: tz, rot: ta, s: 1, extra: rng.next() });
      col.circle(tx, tz, 3.2);
    }
    const segs = 22;
    for (let k = 0; k < segs; k++) {
      const a0 = gateA + 0.45 + (k / segs) * (Math.PI * 2 - 0.9), a1 = gateA + 0.45 + ((k + 1) / segs) * (Math.PI * 2 - 0.9);
      if (rng.next() < 0.22) continue; // срутено
      const ax = F.x + Math.sin(a0) * R, az = F.z + Math.cos(a0) * R, bx = F.x + Math.sin(a1) * R, bz = F.z + Math.cos(a1) * R;
      const hgt = 1.2 + rng.next() * 3.2;
      ruins.push([ax, az, bx, bz, hgt]);
      col.seg(ax, az, bx, bz, 0.7);
    }
    for (let k = 0; k < 14; k++) {
      const a = rng.next() * 6.28, rr = R + (rng.next() - 0.3) * 6;
      props.push({ type: 'rubble', x: F.x + Math.sin(a) * rr, z: F.z + Math.cos(a) * rr, rot: rng.next() * 6, s: 0.5 + rng.next() * 0.7 });
    }
  }

  // ---- Ламин връх: пещерата, кости, опушени скали, пресъхналият извор
  const rocks: TreeInst[] = [];
  {
    const dx = PEAK.x - PLATEAU.x, dz = PEAK.z - PLATEAU.z, l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
    const cx = PLATEAU.x + ux * (ARENA_RADIUS + 1.5), cz = PLATEAU.z + uz * (ARENA_RADIUS + 1.5);
    // пещерата стои на склона: основата е на височината на точката пред входа (откъм арената)
    const caveY = Math.min(heightAt(cx, cz), heightAt(cx - ux * 1, cz - uz * 1)) - 0.3;
    props.push({ type: 'cave', x: cx, z: cz, rot: Math.atan2(-ux, -uz), s: 1.45, y: caveY });
    col.circle(cx + ux * 7.5, cz + uz * 7.5, 6);
    col.circle(cx - uz * 9.5 + ux * 1.5, cz + ux * 9.5 + uz * 1.5, 3.8);
    col.circle(cx + uz * 9.5 + ux * 1.5, cz - ux * 9.5 + uz * 1.5, 3.8);
    for (let k = 0; k < 18; k++) {
      const a = rng.next() * 6.28, rr = 6 + rng.next() * 18;
      props.push({ type: rng.next() < 0.6 ? 'bones' : 'skull', x: PLATEAU.x + Math.sin(a) * rr, z: PLATEAU.z + Math.cos(a) * rr, rot: rng.next() * 6.28, s: 0.7 + rng.next() * 0.6 });
    }
    // опушени скали по ръба на арената (извън радиуса ѝ)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 6.28 + rng.next() * 0.3, rr = ARENA_RADIUS + 1.5 + rng.next() * 5;
      const x = PLATEAU.x + Math.sin(a) * rr, z = PLATEAU.z + Math.cos(a) * rr;
      if (roadDist(x, z) < 4) continue;
      const s = 1.2 + rng.next() * 1.6;
      rocks.push({ x, z, s, rot: rng.next() * 6.28, tint: -1 });
      col.circle(x, z, s * 0.8);
    }
    const SP = { x: 136, z: -146 }; // изворът на Бистрица
    props.push({ type: 'spring', x: SP.x, z: SP.z, rot: Math.atan2(PLATEAU.x - SP.x, PLATEAU.z - SP.z), s: 1 });
  }

  // ---- дървета, храсти, камъни навсякъде
  const pines: TreeInst[] = [], bushes: TreeInst[] = [], deadTrees: TreeInst[] = [], ferns: TreeInst[] = [], mushrooms: TreeInst[] = [], flowers: TreeInst[] = [];
  const dV = (x: number, z: number) => Math.hypot(x - VILLAGE_CENTER.x, z - VILLAGE_CENTER.z);
  const clearOf = (x: number, z: number, pad: number) => {
    if (roadDist(x, z) < roadHalfWidth(x, z) + pad) return false;
    if (riverInfo(x, z).dist < RIVER_HALF_WIDTH + 5) return false;
    if (Math.hypot(x - PLATEAU.x, z - PLATEAU.z) < ARENA_RADIUS + 6) return false;
    if (Math.hypot(x - F.x, z - F.z) < 26) return false;
    if (Math.hypot(x - POND.x, z - POND.z) < 20) return false;
    if (Math.abs(x) > WORLD_HALF - 4 || Math.abs(z) > WORLD_HALF - 4) return false;
    for (const t of taken) if (rectContains(t, x, z, 2)) return false;
    return true;
  };
  const step = 3.4;
  for (let gz = -WORLD_HALF; gz < WORLD_HALF; gz += step) for (let gx = -WORLD_HALF; gx < WORLD_HALF; gx += step) {
    const x = gx + (rng.next() - 0.5) * step * 0.9, z = gz + (rng.next() - 0.5) * step * 0.9;
    const r0 = rng.next(), r1 = rng.next(), r2 = rng.next();
    const fm = forestMask(x, z);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const h = terrainHeight(x, z);
    const inSwamp = Math.hypot(x - SWAMP.x, z - SWAMP.z) < 66;
    const v = dV(x, z);
    if (inSwamp) {
      if (r0 < 0.05 && clearOf(x, z, 1)) { deadTrees.push({ x, z, s: 0.8 + r1 * 0.6, rot: r2 * 6.28, tint: r1 }); col.circle(x, z, 0.35); }
      else if (r0 < 0.09 && clearOf(x, z, 1)) bushes.push({ x, z, s: 0.6 + r1 * 0.5, rot: r2 * 6.28, tint: 0.9 });
      continue;
    }
    if (fm > 0.05) {
      const nearRosen = ROSEN_SPOTS.some(p => Math.hypot(x - p.x, z - p.z) < 3.2);
      if (r0 < fm * 0.7 && !nearRosen && clearOf(x, z, 2.6)) {
        const s = 0.75 + r1 * 0.75;
        pines.push({ x, z, s, rot: r2 * 6.28, tint: r1 }); col.circle(x, z, 0.32 * s + 0.08);
      } else if (r0 < fm * 0.97 && clearOf(x, z, 1.4)) {
        if (r1 < 0.45) ferns.push({ x, z, s: 0.6 + r2 * 0.6, rot: r1 * 20, tint: r2 });
        else if (r1 < 0.6) mushrooms.push({ x, z, s: 0.6 + r2 * 0.6, rot: r1 * 20, tint: r2 });
        else if (r1 < 0.66) {
          const s = 0.8 + r2 * 0.6;
          if (clearOf(x, z, 1.0 + 2.2 * s)) { logs.push({ x, z, s, rot: r2 * 9, tint: 1 }); addLogCol(x, z, s, r2 * 9); }
        }
        else bushes.push({ x, z, s: 0.6 + r2 * 0.5, rot: r1 * 20, tint: 0.7 });
      }
      continue;
    }
    // планините по края — борове на петна; склоновете на Ламин връх — редки борове и камъни
    const edgeBand = smoothstep(WORLD_HALF - 85, WORLD_HALF - 40, edge);
    const patch = fbm(x * 0.02 - 7, z * 0.02 + 3, 2);
    const nearPeak = Math.hypot(x - PEAK.x, z - PEAK.z);
    if (edgeBand > 0 && v > 110) {
      if (r0 < edgeBand * 0.55 * smoothstep(0.38, 0.6, patch) && h < 70 && clearOf(x, z, 3)) {
        const s = 0.9 + r1 * 0.8; pines.push({ x, z, s, rot: r2 * 6.28, tint: r1 }); col.circle(x, z, 0.32 * s + 0.08);
        continue;
      }
      if (r0 > 0.985 && clearOf(x, z, 2)) { const s = 1 + r1 * 2.2; rocks.push({ x, z, s, rot: r2 * 6.28, tint: r1 }); col.circle(x, z, s * 0.75); continue; }
    }
    if (nearPeak < 95 && Math.hypot(x - PLATEAU.x, z - PLATEAU.z) > 36) {
      if (r0 < 0.05 && h < 48 && clearOf(x, z, 3)) { const s = 0.8 + r1 * 0.6; pines.push({ x, z, s, rot: r2 * 6.28, tint: r1 }); col.circle(x, z, 0.3 * s + 0.08); continue; }
      if (r0 > (h > 34 ? 0.8 : 0.93) && clearOf(x, z, 2.5)) { const s = 0.8 + r1 * (h > 34 ? 3.2 : 2.4); rocks.push({ x, z, s, rot: r2 * 6.28, tint: r1 }); col.circle(x, z, s * 0.75); continue; }
    }
    // поляните: широколистни дървета и храсти на групи, цветя
    const grove = fbm(x * 0.025 + 11, z * 0.025 - 5, 3);
    const riverD = riverInfo(x, z).dist;
    const riverBank = riverD > 12 && riverD < 26 ? 0.1 : 0;
    const villageEdge = v > 70 && v < 130 ? 0.02 : 0;
    const pOak = Math.max(0, (grove - 0.56) * 0.5) + riverBank + villageEdge * (grove > 0.45 ? 1 : 0);
    const pFar = v > 55 ? 1 : 0;
    if (r0 < pOak * pFar && clearOf(x, z, 3)) { const s = 0.8 + r1 * 0.6; oaks.push({ x, z, s, rot: r2 * 6.28, tint: r1 }); col.circle(x, z, 0.4 * s + 0.1); continue; }
    if (r0 > 1 - (pOak * 0.6 + 0.012) * pFar && clearOf(x, z, 1.5)) { bushes.push({ x, z, s: 0.6 + r1 * 0.7, rot: r2 * 6.28, tint: r1 * 0.6 }); continue; }
    if (r0 > 0.994 && v > 60 && clearOf(x, z, 2)) { const s = 0.5 + r1 * 1.2; rocks.push({ x, z, s, rot: r2 * 6.28, tint: r1 }); if (s > 0.9) col.circle(x, z, s * 0.7); continue; }
  }
  // камъни в сухото корито (без препятствия — по тях се минава)
  for (let k = 0; k < 520; k++) {
    const i = Math.floor(rng.next() * 1000) / 1000;
    const p = riverPoint(i);
    const off = (rng.next() - 0.5) * RIVER_HALF_WIDTH * 2.1;
    const x = p.x + p.nx * off, z = p.z + p.nz * off;
    if (Math.abs(z - BRIDGE.z) < 4 && x > BRIDGE.x0 && x < BRIDGE.x1) continue;
    rocks.push({ x, z, s: 0.15 + Math.pow(rng.next(), 3) * 0.9, rot: rng.next() * 6.28, tint: 2 + rng.next() * 0.5 });
  }
  // поляната на самодивите: цветя навсякъде, кръг от камъни
  for (let k = 0; k < 900; k++) {
    const a = rng.next() * 6.28, rr = Math.sqrt(rng.next()) * 34;
    const x = GLADE.x + Math.sin(a) * rr, z = GLADE.z + Math.cos(a) * rr;
    if (Math.hypot(x - POND.x, z - POND.z) < 15) continue;
    flowers.push({ x, z, s: 0.7 + rng.next() * 0.6, rot: rng.next() * 6.28, tint: rng.next() });
  }
  {
    const rc = { x: GLADE.x + 10, z: GLADE.z + 12 };
    props.push({ type: 'dance_ring', x: rc.x, z: rc.z, rot: 0, s: 6 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 6.28, x = rc.x + Math.sin(a) * 6.5, z = rc.z + Math.cos(a) * 6.5;
      rocks.push({ x, z, s: 0.45 + rng.next() * 0.15, rot: rng.next() * 6, tint: 3 });
    }
  }
  // блатото: локви мътна вода
  const swampPools: WorldPlan['swampPools'] = [];
  for (let k = 0; k < 26; k++) {
    const a = rng.next() * 6.28, rr = Math.sqrt(rng.next()) * 52;
    const x = SWAMP.x + Math.sin(a) * rr, z = SWAMP.z + Math.cos(a) * rr;
    const r = 4 + rng.next() * 8;
    // ниво на водата — малко над най-ниската точка наоколо
    let lo = Infinity; for (let j = 0; j < 8; j++) { const b = (j / 8) * 6.28; lo = Math.min(lo, terrainHeight(x + Math.sin(b) * r * 0.6, z + Math.cos(b) * r * 0.6)); }
    swampPools.push({ x, z, r, y: Math.min(lo, terrainHeight(x, z)) + 0.35 });
  }

  return { houses, props, fences: cutFences, pines, oaks, bushes, rocks, deadTrees, ferns, mushrooms, logs, flowers, swampPools, signs, colliders: col, footprints, ruins };
}

/** Точка по коритото при параметър t (0..1) + нормала встрани. */
export function riverPoint(t: number): { x: number; z: number; nx: number; nz: number } {
  const P = RIVER_PATH_LOCAL;
  let total = 0; const lens: number[] = [];
  for (let i = 0; i < P.length - 1; i++) { const l = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z); lens.push(l); total += l; }
  let d = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const u = Math.min(1, d / lens[i]), a = P[i], b = P[i + 1];
      const tx = (b.x - a.x) / lens[i], tz = (b.z - a.z) / lens[i];
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, nx: -tz, nz: tx };
    }
    d -= lens[i];
  }
  return { x: P[0].x, z: P[0].z, nx: 1, nz: 0 };
}
