// Възрожденската къща (като в Копривщица, Жеравна, Трявна): каменен приземен етаж с ъглови блокове, бял варосан
// горен етаж с тъмни греди (паянтова конструкция), издаден напред на конзоли (еркер), дървен чардак със струговани
// балясини, стълба, дълбоки стрехи с открити ребра, покрив от „турски“ керемиди с редица капаци по ръба,
// комини с керемидено капаче, капаци на прозорците, решетки долу, тежка порта с железни ленти.
// Размерите и вратите са като в плана (plan.ts): препятствията, картата и местата на жителите зависят от тях.
import * as THREE from 'three';
import { Kit, smooth, type Slot, type V3 } from './kit';
import { heightAt } from '../height';
import type { HouseSpec } from '../plan';
import { Rng } from '../../core/rng';

// ---------------------------------------------------------------- земята под върха (кеш на 1 м)
const gcache = new Map<number, number>();
export function groundY(x: number, z: number): number {
  const ix = Math.round(x), iz = Math.round(z), key = (ix + 4096) * 8192 + (iz + 4096);
  let h = gcache.get(key);
  if (h === undefined) { h = heightAt(ix, iz); gcache.set(key, h); }
  return h;
}

/** Обикновеното изветряване: мръсно и влажно до земята (по-високо по камъка), долните лица — в сянка. */
export function setWeathering(k: Kit): void {
  k.shade = (p, slot, n) => {
    if (slot === 'glass' || slot === 'hot' || slot === 'wet' || slot === 'leaves') return 1;
    const h = p.y - groundY(p.x, p.z);
    const reach = slot === 'stone' || slot === 'masonry' || slot === 'rock' ? 0.95 : slot === 'plaster' ? 0.7 : 0.45;
    let f = 0.58 + 0.42 * smooth(-0.08, reach, h);
    if (n.y < -0.6) f *= 0.78;
    return f;
  };
}

// ---------------------------------------------------------------- облик на къщата
export interface Look { plaster: THREE.Color; stone: string; quoin: string; timber: string; planks: string; door: string; shutter: string; roof: THREE.Color }
const PLASTER = ['#fbf8f1', '#eef3f7', '#f8eedb', '#f6ecdc', '#f2f2ee', '#fbf2e4', '#f4efe4', '#f9f4ec'];
const STONE = ['#ffffff', '#ece5da', '#f6f0e6', '#e3dcd2'];
const TIMBER = ['#8c6c56', '#7c604c', '#94755e', '#76594a'];
const SHUTTER = ['#9a7a60', '#83988a', '#9c7c62', '#8597ae', '#a88a6c'];
// керемидите на снимката са доста оранжеви: малко повече зелено и синьо ги прави „печени“ и стари
const ROOF = [0.98, 0.86, 0.93, 0.8, 0.9];
export function lookFor(seed: number): Look {
  const r = new Rng(seed * 7 + 3);
  return {
    // варта е по-бяла от снимката на мазилката: изсветляваме ×1.3
    plaster: new THREE.Color(r.pick(PLASTER)).multiplyScalar(1.3), stone: r.pick(STONE), quoin: '#e8e4dc', timber: r.pick(TIMBER),
    planks: '#b49c86', door: r.pick(['#8a6a52', '#7c5c46', '#94745a']), shutter: r.pick(SHUTTER), roof: (() => { const b = r.pick(ROOF); return new THREE.Color(b * 0.9, b * 1.0, b * 1.08); })(),
  };
}

const IRON = '#2c2826';
const tmpC = new THREE.Color();
const litTint = (lit: number) => tmpC.set('#ffcf8a').multiplyScalar(lit).clone();

// ---------------------------------------------------------------- прозорец
export interface WinOpts {
  timber: string; planks?: string;
  /** рамка от греди (иначе рамката са стълбовете на стената) */
  frame?: boolean;
  bars?: boolean;
  /** цвят на капаците; без — няма капаци */
  shutter?: string;
  /** колко са отворени капаците (0 — затворени, π — опрени в стената) */
  open?: number;
  sill?: Slot | null;
  lit?: number;
  rows?: number;
}
/** Прозорец на стена в равнината z=0 (лицето навън е +z), център (x, y), отвор w×h. */
export function windowAt(k: Kit, x: number, y: number, w: number, h: number, o: WinOpts): void {
  const T = { tint: o.timber, bevel: 0.012 };
  k.box('glass', w, h, 0.02, x, y, 0.012, { tint: litTint(o.lit ?? 1), jitter: 0 });
  if (o.frame !== false) {
    k.box('timber', 0.09, h + 0.04, 0.12, x - w / 2 - 0.045, y, 0.045, { ...T, grain: 1 });
    k.box('timber', 0.09, h + 0.04, 0.12, x + w / 2 + 0.045, y, 0.045, { ...T, grain: 1 });
    k.box('timber', w + 0.36, 0.11, 0.15, x, y + h / 2 + 0.055, 0.06, { ...T, bevel: 0.016, grain: 0 });
  }
  if (o.sill !== null) {
    const s = o.sill ?? 'timber';
    k.box(s, w + 0.3, 0.07, 0.2, x, y - h / 2 - 0.035, 0.085, { tint: s === 'rock' ? '#d7d1c6' : o.timber, bevel: 0.02, grain: 0 });
  }
  // кръстачки: средна вертикална + хоризонтални
  k.box('timber', 0.035, h, 0.04, x, y, 0.036, { tint: o.timber, grain: 1, jitter: 0 });
  const rows = o.rows ?? 2;
  for (let j = 1; j < rows; j++) k.box('timber', w, 0.035, 0.04, x, y - h / 2 + (h * j) / rows, 0.036, { tint: o.timber, grain: 0, jitter: 0 });
  if (o.bars) {
    for (let i = 1; i <= 3; i++) k.box('iron', 0.022, h + 0.05, 0.022, x - w / 2 + (w * i) / 4, y, 0.08, { tint: IRON, jitter: 0.1 });
    k.box('iron', w + 0.06, 0.035, 0.012, x, y + h * 0.12, 0.08, { tint: IRON, jitter: 0 });
  }
  if (o.shutter) {
    const phi = o.open ?? 2.5, sw = w / 2 + 0.05;
    for (const s of [-1, 1]) {
      const hx = x + s * (w / 2 + 0.1);
      const dx = -s * Math.cos(phi), dz = Math.sin(phi);
      k.push(hx, y, 0.1, Math.atan2(-dz, dx));
      k.box('planks', sw, h + 0.05, 0.035, sw / 2, 0, 0, { tint: o.shutter, grain: 1, tile: [1.2, 1.9] });
      for (const yy of [-h * 0.32, h * 0.32]) k.box('planks', sw - 0.06, 0.07, 0.025, sw / 2, yy, 0.03, { tint: o.shutter, grain: 0, tile: [1.2, 1.9] });
      for (const yy of [-h * 0.32, h * 0.32]) k.box('iron', 0.16, 0.035, 0.02, 0.08, yy, -0.026, { tint: IRON, jitter: 0 });
      k.pop();
    }
  }
}

// ---------------------------------------------------------------- врата
export interface DoorOpts { w: number; h: number; timber: string; door: string; double?: boolean; threshold?: boolean }
/** Врата в стена z=0 (лице +z), долният ѝ край на y=0; x — средата. */
export function doorAt(k: Kit, x: number, o: DoorOpts): void {
  const { w, h } = o;
  const T = { tint: o.timber, bevel: 0.02 };
  if (o.threshold !== false) k.box('rock', w + 0.42, 0.16, 0.44, x, 0.03, 0.18, { tint: '#d8d1c4', bevel: 0.03, grain: 0 });
  k.box('timber', 0.16, h + 0.12, 0.2, x - w / 2 - 0.08, (h + 0.12) / 2, 0.045, { ...T, grain: 1 });
  k.box('timber', 0.16, h + 0.12, 0.2, x + w / 2 + 0.08, (h + 0.12) / 2, 0.045, { ...T, grain: 1 });
  k.box('timber', w + 0.64, 0.2, 0.24, x, h + 0.2, 0.055, { ...T, bevel: 0.025, grain: 0 });
  const n = o.double ? 2 : 1, lw = w / n;
  for (let i = 0; i < n; i++) {
    const cx = x - w / 2 + lw * (i + 0.5);
    k.box('planks', lw - 0.012, h, 0.06, cx, h / 2 + 0.03, 0, { tint: o.door, grain: 1, tile: [1.1, 1.9] });
    for (const yy of [0.38, h - 0.42]) {
      k.box('iron', lw - 0.1, 0.05, 0.012, cx, yy, 0.036, { tint: IRON, jitter: 0 });
      for (let j = 0; j < 4; j++) k.box('iron', 0.032, 0.032, 0.016, cx - lw / 2 + 0.11 + (j * (lw - 0.22)) / 3, yy, 0.046, { tint: '#3a3430', jitter: 0 });
    }
  }
  // халка
  const rx = o.double ? x + 0.13 : x + lw / 2 - 0.14, ry = h * 0.5;
  const ring: V3[] = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; ring.push([rx + Math.sin(a) * 0.055, ry - 0.055 + Math.cos(a) * 0.055, 0.058]); }
  k.tube('iron', ring, 0.009, 4, { tint: IRON, jitter: 0 });
  k.box('iron', 0.05, 0.05, 0.02, rx, ry, 0.04, { tint: IRON, jitter: 0 });
}

// ---------------------------------------------------------------- покрив
export interface RoofOpts {
  tint?: THREE.ColorRepresentation;
  /** дъсчен покрив (навеси) вместо керемиди */
  boards?: boolean;
  timber?: string;
  /** фронтонът при покрив на две води (мазилка/дъски/камък) */
  gable?: { slot: Slot; tint: THREE.ColorRepresentation } | null;
  /** колко излиза стрехата отвъд стената (за ребрата и фронтона) */
  eave?: number;
  rafters?: boolean;
  th?: number;
}

/** Полуцилиндър (керемида-капак) от A до B, изпъкнал към up. */
function halfTile(k: Kit, A: THREE.Vector3, B: THREE.Vector3, rA: number, rB: number, up: THREE.Vector3, tint: THREE.ColorRepresentation, slot: Slot = 'roof', seg = 4): void {
  const len = A.distanceTo(B);
  const Y = new THREE.Vector3().subVectors(B, A).normalize();
  const Z = up.clone().addScaledVector(Y, -up.dot(Y)).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  const M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5).addScaledVector(Z, -Math.min(rA, rB) * 0.35));
  k.pushMatrix(M);
  k.cyl(slot, rB, rA, len, seg, 0, 0, 0, { arc: Math.PI, caps: false, tint, jitter: 0.07, grain: 1 });
  k.pop();
}
/** Редица капаци по било/ребро от A до B. */
function capRow(k: Kit, A: V3, B: V3, r: number, tint: THREE.ColorRepresentation): void {
  const a = new THREE.Vector3(...A), b = new THREE.Vector3(...B);
  const len = a.distanceTo(b), n = Math.max(1, Math.round(len / 0.36));
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const p0 = a.clone().lerp(b, i / n), p1 = a.clone().lerp(b, Math.min(1, (i + 1.12) / n));
    halfTile(k, p0, p1, r * 1.1, r * 0.94, up, tint, 'roof', 5);
  }
}
/** Редица керемиди по ръба на стрехата: от E0 до E1 (по ръба), надолу по наклона Sd, нормала N. */
function eaveRow(k: Kit, E0: THREE.Vector3, E1: THREE.Vector3, Sd: THREE.Vector3, N: THREE.Vector3, tint: THREE.ColorRepresentation): void {
  const len = E0.distanceTo(E1), sp = 0.165, n = Math.floor(len / sp);
  const off = (len - n * sp) / 2 + sp / 2;
  const dir = new THREE.Vector3().subVectors(E1, E0).normalize();
  const r = 0.068;
  for (let i = 0; i < n; i++) {
    const P = E0.clone().addScaledVector(dir, off + i * sp);
    const A = P.clone().addScaledVector(Sd, -0.34), B = P.clone().addScaledVector(Sd, 0.045);
    halfTile(k, A, B, r * 0.92, r, N, tint);
    // тъмният отвор на керемидата (отдолу е куха)
    const C = B.clone().addScaledVector(N, -r * 0.35);
    const X = new THREE.Vector3().crossVectors(Sd, N).normalize();
    const pts: V3[] = [];
    for (let j = 0; j <= 3; j++) { const a = -Math.PI / 2 + (j / 3) * Math.PI; const q = C.clone().addScaledVector(X, Math.sin(a) * r * 0.82).addScaledVector(N, Math.cos(a) * r * 0.82); pts.push([q.x, q.y, q.z]); }
    for (let j = 0; j < 3; j++) k.tri('plain', [C.x, C.y, C.z], pts[j], pts[j + 1], { tint: '#3a2a22', jitter: 0, n: [Sd.x, Sd.y, Sd.z] });
  }
}

/**
 * Покрив на четири води (hip) или на две води (gable) над [x0,x1]×[z0,z1] (с включена стряха) на височина y
 * (долната страна на стряхата). rise — колко се издига билото.
 */
export function roofOver(k: Kit, x0: number, x1: number, z0: number, z1: number, y: number, rise: number, kind: 'hip' | 'gable', o: RoofOpts = {}): number {
  const alongX = (x1 - x0) >= (z1 - z0);
  if (!alongX) { k.push(0, 0, 0, Math.PI / 2); [x0, x1, z0, z1] = [-z1, -z0, x0, x1]; }
  const th = o.th ?? 0.16, yt = y + th, zm = (z0 + z1) / 2, half = (z1 - z0) / 2;
  const a = kind === 'hip' ? Math.min(half, (x1 - x0) / 2) : 0;
  const R0: V3 = [x0 + a, yt + rise, zm], R1: V3 = [x1 - a, yt + rise, zm];
  const slot: Slot = o.boards ? 'planks' : 'roof';
  const tint = o.tint ?? '#ffffff';
  const ro = { tint, cell: 1.2, stain: o.boards ? 0.18 : 0.32, jitter: 0, tile: o.boards ? [1.6, 1.9] as [number, number] : undefined };
  const timber = o.timber ?? '#6e4e3a';
  const eave = o.eave ?? 0.8;
  const sl = rise / half;
  const nF = new THREE.Vector3(0, half, rise).normalize(), nB = new THREE.Vector3(0, half, -rise).normalize();
  const nL = new THREE.Vector3(-rise, a > 0 ? a : 1, 0).normalize(), nR = new THREE.Vector3(rise, a > 0 ? a : 1, 0).normalize();
  // горните плоскости
  k.quad(slot, [x0, yt, z1], [x1, yt, z1], R1, R0, { ...ro, g: [0, rise, -half] });
  k.quad(slot, [x1, yt, z0], [x0, yt, z0], R0, R1, { ...ro, g: [0, rise, half] });
  if (kind === 'hip') {
    k.quad(slot, [x0, yt, z0], [x0, yt, z1], R0, R0, { ...ro, g: [a, rise, 0] });
    k.quad(slot, [x1, yt, z1], [x1, yt, z0], R1, R1, { ...ro, g: [-a, rise, 0] });
  }
  // долната страна (дъски по ребрата), успоредна на керемидите
  const so = { tint: '#a08a76', jitter: 0, cell: 1.5, tile: [1.6, 1.9] as [number, number] };
  const dn = (p: V3): V3 => [p[0], p[1] - th, p[2]];
  k.quad('planks', [x0, y, z1], [x1, y, z1], dn(R1), dn(R0), { ...so, n: [0, -nF.y, -nF.z], g: [1, 0, 0] });
  k.quad('planks', [x1, y, z0], [x0, y, z0], dn(R0), dn(R1), { ...so, n: [0, -nB.y, -nB.z], g: [1, 0, 0] });
  if (kind === 'hip') {
    k.quad('planks', [x0, y, z0], [x0, y, z1], dn(R0), dn(R0), { ...so, n: [-nL.x, -nL.y, 0], g: [0, 0, 1] });
    k.quad('planks', [x1, y, z1], [x1, y, z0], dn(R1), dn(R1), { ...so, n: [-nR.x, -nR.y, 0], g: [0, 0, 1] });
  }
  // челата (дебелината на стряхата)
  const eo = { tint: '#8a705c', jitter: 0, tile: [1.2, 1.9] as [number, number] };
  k.quad('planks', [x0, y, z1], [x1, y, z1], [x1, yt, z1], [x0, yt, z1], { ...eo, n: [0, 0, 1], g: [1, 0, 0] });
  k.quad('planks', [x1, y, z0], [x0, y, z0], [x0, yt, z0], [x1, yt, z0], { ...eo, n: [0, 0, -1], g: [1, 0, 0] });
  if (kind === 'hip') {
    k.quad('planks', [x0, y, z0], [x0, y, z1], [x0, yt, z1], [x0, yt, z0], { ...eo, n: [-1, 0, 0], g: [0, 0, 1] });
    k.quad('planks', [x1, y, z1], [x1, y, z0], [x1, yt, z0], [x1, yt, z1], { ...eo, n: [1, 0, 0], g: [0, 0, 1] });
  } else {
    for (const x of [x0, x1]) {
      const s = x === x0 ? -1 : 1;
      k.quad('planks', [x, y, z0], [x, yt, z0], [x, yt + rise, zm], [x, y + rise, zm], { ...eo, n: [s, 0, 0], g: [0, rise, half] });
      k.quad('planks', [x, y, z1], [x, yt, z1], [x, yt + rise, zm], [x, y + rise, zm], { ...eo, n: [s, 0, 0], g: [0, rise, -half] });
    }
  }
  // открити ребра (греди) под стряхата
  if (o.rafters !== false) {
    // ребрата са в сянката на стряхата — по-тъмни, иначе изглеждат като дупки към небето
    const timber = new THREE.Color(o.timber ?? '#6e4e3a').multiplyScalar(0.72);
    const reach = eave + 0.12, step = 0.62;
    const along = (xa: number, xb: number, z: number, s: number) => {
      const n = Math.max(1, Math.round((xb - xa) / step));
      for (let i = 0; i <= n; i++) {
        const x = xa + ((xb - xa) * i) / n;
        k.beam('timber', x, y - 0.06, z, x, y - 0.06 + sl * reach, z - s * reach, 0.08, 0.12, { tint: timber });
      }
    };
    const inset = kind === 'hip' ? reach + 0.1 : 0.15;
    along(x0 + inset, x1 - inset, z1 - 0.02, 1);
    along(x0 + inset, x1 - inset, z0 + 0.02, -1);
    if (kind === 'hip') {
      const slx = a > 0 ? rise / a : sl;
      const side = (x: number, s: number) => {
        const n = Math.max(1, Math.round((z1 - z0 - 2 * inset) / step));
        for (let i = 0; i <= n; i++) {
          const z = z0 + inset + ((z1 - z0 - 2 * inset) * i) / n;
          k.beam('timber', x, y - 0.06, z, x - s * reach, y - 0.06 + slx * reach, z, 0.08, 0.12, { tint: timber });
        }
      };
      side(x0 + 0.02, -1); side(x1 - 0.02, 1);
    }
  }
  // фронтоните (при две води): петоъгълник на линията на стената
  if (kind === 'gable' && o.gable !== null) {
    const gs = o.gable ?? { slot: 'plaster' as Slot, tint: new THREE.Color('#f6f1e8').multiplyScalar(1.3) };
    for (const s of [-1, 1]) {
      const x = s < 0 ? x0 + eave : x1 - eave;
      const za = z0 + eave, zb = z1 - eave, ye = y + sl * eave - 0.02;
      const go = { tint: gs.tint, n: [s, 0, 0] as V3, cell: 0.6, stain: 0.2, jitter: 0, g: [0, 1, 0] as V3 };
      k.quad(gs.slot, [x, y - 0.02, za], [x, y - 0.02, zb], [x, ye, zb], [x, ye, za], go);
      k.tri(gs.slot, [x, ye, za], [x, ye, zb], [x, y + rise - 0.03, zm], go);
      if (gs.slot === 'plaster') {
        // греди: обтегач, „баба“ и подпори; малко прозорче-отдушник
        k.box('timber', 0.1, 0.16, zb - za + 0.1, x + s * 0.03, y + 0.06, zm, { tint: timber, bevel: 0.012, grain: 2 });
        k.box('timber', 0.1, rise - 0.12, 0.13, x + s * 0.03, y + rise / 2, zm, { tint: timber, bevel: 0.012, grain: 1 });
        k.beam('timber', x + s * 0.03, y + 0.12, za + 0.25, x + s * 0.03, y + rise * 0.62, zm - 0.08, 0.1, 0.11, { tint: timber, bevel: 0.01 });
        k.beam('timber', x + s * 0.03, y + 0.12, zb - 0.25, x + s * 0.03, y + rise * 0.62, zm + 0.08, 0.1, 0.11, { tint: timber, bevel: 0.01 });
        k.push(x, y + rise * 0.42, zm - 0.55, s * Math.PI / 2);
        windowAt(k, 0, 0, 0.32, 0.36, { timber, frame: true, sill: null, lit: 0.25, rows: 1 });
        k.pop();
      }
    }
  }
  // капаци по билото и ребрата, редица керемиди по стрехите
  if (!o.boards) {
    const capT = new THREE.Color(tint).multiplyScalar(0.92);
    if (R1[0] > R0[0]) capRow(k, [R0[0] - 0.12, R0[1] + 0.02, zm], [R1[0] + 0.12, R1[1] + 0.02, zm], 0.13, capT);
    if (kind === 'hip') {
      // ребрата спират малко преди билото (иначе при почти пирамидален покрив капаците стърчат на върха)
      const near = (A: V3, R: V3): V3 => [A[0] + (R[0] - A[0]) * 0.93, A[1] + (R[1] - A[1]) * 0.93, A[2] + (R[2] - A[2]) * 0.93];
      capRow(k, [x0, yt + 0.03, z0], near([x0, yt, z0], R0), 0.12, capT); capRow(k, [x0, yt + 0.03, z1], near([x0, yt, z1], R0), 0.12, capT);
      capRow(k, [x1, yt + 0.03, z0], near([x1, yt, z0], R1), 0.12, capT); capRow(k, [x1, yt + 0.03, z1], near([x1, yt, z1], R1), 0.12, capT);
      if (R1[0] - R0[0] < 0.8) k.cyl('roof', 0.05, 0.2, 0.32, 8, (R0[0] + R1[0]) / 2, R0[1] + 0.1, zm, { tint: capT, jitter: 0 });
    } else {
      for (const x of [x0 + 0.1, x1 - 0.1]) { capRow(k, [x, yt + 0.02, z0], [x, yt + rise + 0.02, zm], 0.11, capT); capRow(k, [x, yt + 0.02, z1], [x, yt + rise + 0.02, zm], 0.11, capT); }
    }
    const V = (p: V3) => new THREE.Vector3(...p);
    const sdF = new THREE.Vector3(0, -rise, half).normalize(), sdB = new THREE.Vector3(0, -rise, -half).normalize();
    const ins = kind === 'hip' ? 0.18 : 0.2;
    eaveRow(k, V([x0 + ins, yt, z1]), V([x1 - ins, yt, z1]), sdF, nF, tint);
    eaveRow(k, V([x1 - ins, yt, z0]), V([x0 + ins, yt, z0]), sdB, nB, tint);
    if (kind === 'hip') {
      const sdL = new THREE.Vector3(-a, -rise, 0).normalize(), sdR = new THREE.Vector3(a, -rise, 0).normalize();
      eaveRow(k, V([x0, yt, z0 + ins]), V([x0, yt, z1 - ins]), sdL, nL, tint);
      eaveRow(k, V([x1, yt, z1 - ins]), V([x1, yt, z0 + ins]), sdR, nR, tint);
    }
  }
  if (!alongX) k.pop();
  return yt + rise;
}

// ---------------------------------------------------------------- комин
/** Варосан комин с каменна плоча и керемидено капаче; (x, z) — локално, от y0 до top. */
export function chimney(k: Kit, x: number, z: number, y0: number, top: number, look: Look): void {
  const prev = k.shade;
  const base = new THREE.Vector3(x, top, z).applyMatrix4(k.top).y;
  // сажди към върха
  k.shade = (p, s, n) => (prev ? prev(p, s, n) : 1) * (s === 'plaster' ? 1 - 0.45 * smooth(base - 1.0, base, p.y) : 1);
  k.box('plaster', 0.64, top - y0, 0.64, x, (y0 + top) / 2, z, { tint: look.plaster, cell: 0.3, stain: 0.3, grain: 1, jitter: 0 });
  k.shade = prev;
  k.box('rock', 0.84, 0.09, 0.84, x, top + 0.045, z, { tint: '#bdb6aa', bevel: 0.02 });
  for (const [dx, dz] of [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]]) k.box('rock', 0.13, 0.3, 0.13, x + dx, top + 0.24, z + dz, { tint: '#9d968b', bevel: 0.015 });
  k.box('plain', 0.42, 0.25, 0.42, x, top + 0.22, z, { tint: '#141210', jitter: 0 });
  k.push(x, 0, z);
  roofOver(k, -0.5, 0.5, -0.5, 0.5, top + 0.39, 0.3, 'hip', { tint: look.roof, rafters: false, th: 0.06 });
  k.pop();
}

// ---------------------------------------------------------------- стругована балясина и парапет
const BALUSTER: [number, number][] = [[0.032, 0], [0.032, 0.06], [0.023, 0.09], [0.042, 0.25], [0.02, 0.45], [0.027, 0.53], [0.021, 0.6], [0.032, 0.68]];
/** Парапет от (ax, az) до (bx, bz) на височина y (пода): горна и долна перила + балясини. */
export function railing(k: Kit, ax: number, az: number, bx: number, bz: number, y: number, timber: string): void {
  const T = { tint: timber, bevel: 0.012 };
  k.beam('timber', ax, y + 0.93, az, bx, y + 0.93, bz, 0.11, 0.07, T);
  k.beam('timber', ax, y + 0.15, az, bx, y + 0.15, bz, 0.09, 0.06, { tint: timber });
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.17));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    k.lathe('timber', BALUSTER, 5, ax + (bx - ax) * t, y + 0.18, az + (bz - az) * t, { tint: timber, tile: [0.5, 1.2] });
  }
}
/** Стълб на чардака: квадратен, скосен, с каменна основа и „капител“. */
function post(k: Kit, x: number, z: number, y0: number, y1: number, timber: string): void {
  k.box('rock', 0.36, 0.26, 0.36, x, y0 + 0.08, z, { tint: '#cfc8bb', bevel: 0.03 });
  k.box('timber', 0.17, y1 - y0 - 0.2, 0.17, x, (y0 + 0.2 + y1) / 2, z, { tint: timber, bevel: 0.025, grain: 1 });
  k.box('timber', 0.26, 0.1, 0.26, x, y1 - 0.05, z, { tint: timber, bevel: 0.02 });
}

// ---------------------------------------------------------------- стена на горния етаж с гредите
interface Opening { x: number; w: number; h: number; y: number; door?: boolean; lit?: number; open?: number }
/** Дървената конструкция на една стена на горния етаж (лице z=0, навън +z), дължина len, от y0 до y0+H. */
function upperWall(k: Kit, len: number, y0: number, H: number, ops: Opening[], look: Look, rng: Rng): void {
  const T = { tint: look.timber, bevel: 0.014 };
  const bt = 0.17;
  k.box('timber', len + 0.14, bt, 0.13, 0, y0 + bt / 2, -0.005, { ...T, grain: 0 });
  k.box('timber', len + 0.14, bt, 0.13, 0, y0 + H - bt / 2, -0.005, { ...T, grain: 0 });
  // вертикалите: ъгли + стълбове от двете страни на всеки отвор
  const posts: number[] = [-len / 2 + 0.075, len / 2 - 0.075];
  for (const o of ops) if (!o.door) posts.push(o.x - o.w / 2 - 0.07, o.x + o.w / 2 + 0.07);
  posts.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const p of posts) if (!merged.length || p - merged[merged.length - 1] > 0.22) merged.push(p);
  const inOpening = (a: number, b: number) => ops.some((o) => o.x + o.w / 2 + 0.1 > a && o.x - o.w / 2 - 0.1 < b);
  let dirFlip = rng.next() < 0.5;
  for (let i = 0; i < merged.length; i++) {
    k.box('timber', 0.14, H - 2 * bt + 0.02, 0.11, merged[i], y0 + H / 2, 0, { ...T, grain: 1 });
    if (i === merged.length - 1) continue;
    const a = merged[i] + 0.07, b = merged[i + 1] - 0.07, gw = b - a;
    if (inOpening(a, b) || gw < 0.6) continue;
    const ya = y0 + bt, yb = y0 + H - bt;
    if (gw > 2.0) {
      const m = (a + b) / 2;
      k.box('timber', 0.14, H - 2 * bt + 0.02, 0.11, m, y0 + H / 2, 0, { ...T, grain: 1 });
      k.beam('timber', a, ya, 0, m - 0.07, yb, 0, 0.1, 0.12, T);
      k.beam('timber', b, ya, 0, m + 0.07, yb, 0, 0.1, 0.12, T);
    } else {
      if (dirFlip) k.beam('timber', a, ya, 0, b, yb, 0, 0.1, 0.12, T); else k.beam('timber', b, ya, 0, a, yb, 0, 0.1, 0.12, T);
      dirFlip = !dirFlip;
    }
  }
  for (const o of ops) {
    if (o.door) {
      k.push(0, y0 + 0.04, 0);
      doorAt(k, o.x, { w: o.w, h: o.h, timber: look.timber, door: look.door, threshold: false });
      k.pop();
      continue;
    }
    k.box('timber', o.w + 0.04, 0.1, 0.11, o.x, o.y - o.h / 2 - 0.05, 0, { ...T, grain: 0 });
    k.box('timber', o.w + 0.04, 0.1, 0.11, o.x, o.y + o.h / 2 + 0.05, 0, { ...T, grain: 0 });
    windowAt(k, o.x, o.y, o.w, o.h, { timber: look.timber, frame: false, sill: 'timber', shutter: look.shutter, open: o.open, lit: o.lit, rows: 3 });
  }
}

const winLit = (rng: Rng) => (rng.next() < 0.3 ? 0.12 + rng.next() * 0.15 : 0.65 + rng.next() * 0.35);

// ---------------------------------------------------------------- къщата
export function buildHouse(k: Kit, h: HouseSpec): void {
  const rng = new Rng(h.seed);
  const L = lookFor(h.seed);
  const isInn = h.kind === 'inn';
  const g = isInn ? 2.7 : 2.5, u = isInn ? 2.8 : 2.5, w = h.w, d = h.d;
  // основата на най-ниската точка, за да няма висящи ъгли
  const cs = Math.cos(h.rot), sn = Math.sin(h.rot);
  let base = Infinity;
  for (const [lx, lz] of [[-h.fw / 2, -h.fd / 2], [h.fw / 2, -h.fd / 2], [-h.fw / 2, h.fd / 2], [h.fw / 2, h.fd / 2], [0, 0]]) {
    const x = h.x + (lx + h.fx) * cs + (lz + h.fz) * sn, z = h.z - (lx + h.fx) * sn + (lz + h.fz) * cs;
    base = Math.min(base, heightAt(x, z));
  }
  k.push(h.x, base, h.z, h.rot);
  // под стряхата мазилката и гредите са в сянка
  const prevShade = k.shade, topY = base + g + u;
  k.shade = (p, s, n) => {
    let f = prevShade ? prevShade(p, s, n) : 1;
    if (s === 'plaster' || s === 'timber') f *= 1 - 0.3 * smooth(topY - 0.85, topY - 0.02, p.y);
    return f;
  };
  const overhang = h.chardak === 'front' ? 0 : 0.55;
  const uz0 = -d / 2 - 0.05, uz1 = d / 2 + overhang, uw = w + 0.12, ud = uz1 - uz0, uzc = (uz0 + uz1) / 2;
  const T = { tint: L.timber, bevel: 0.016 };

  // ---- каменният приземен етаж
  k.box('stone', w + 0.18, 0.56, d + 0.18, 0, 0.06, 0, { tint: '#d2cbc0', bevel: 0.06, cell: 0.9, stain: 0.25, grain: 1, jitter: 0, noBottom: true });
  k.box('stone', w, g - 0.34, d, 0, 0.34 + (g - 0.34) / 2, 0, { tint: L.stone, grain: 1, cell: 0.6, stain: 0.24, noTop: true, noBottom: true, jitter: 0 });
  // ъглови блокове (дялан камък)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    let y = 0.34, i = sx * sz > 0 ? 0 : 1;
    while (y < g - 0.2) {
      const sh = Math.min(0.24 + rng.next() * 0.12, g - 0.04 - y);
      const longX = i % 2 === 0;
      const lx = longX ? 0.5 + rng.next() * 0.16 : 0.27, lz = longX ? 0.27 : 0.5 + rng.next() * 0.16;
      k.box('rock', lx, sh - 0.018, lz, sx * (w / 2 - lx / 2 + 0.022), y + sh / 2, sz * (d / 2 - lz / 2 + 0.022), { tint: L.quoin, bevel: 0.028, jitter: 0.07 });
      y += sh; i++;
    }
  }
  // портата
  const doorX = (h.chardak === 'left' ? -1 : h.chardak === 'right' ? 1 : 0) * (w / 2 - 1.3);
  k.push(0, 0, d / 2, 0);
  doorAt(k, doorX, { w: 1.15, h: 2.05, timber: L.timber, door: L.door, double: true });
  // долни прозорчета с решетки
  windowAt(k, -doorX * 0.9 || 2.2, 1.45, 0.55, 0.6, { timber: L.timber, bars: true, sill: 'rock', shutter: L.shutter, open: 2.7, lit: winLit(rng), rows: 2 });
  k.pop();
  for (const s of [-1, 1]) {
    k.push(s * w / 2, 0, 0, s * Math.PI / 2);
    windowAt(k, 0, 1.5, 0.5, 0.55, { timber: L.timber, bars: true, sill: 'rock', shutter: L.shutter, open: 2.8, lit: winLit(rng), rows: 2 });
    k.pop();
  }

  // ---- горният етаж: варосан, издаден напред, с греди
  k.box('plaster', uw, u, ud, 0, g + u / 2, uzc, { tint: L.plaster, grain: 1, cell: 0.5, stain: 0.3, noTop: true, jitter: 0 });
  const winW = isInn ? 0.8 : 0.7, winH = isInn ? 1.1 : 0.95, winY = g + u * 0.52;
  const nWin = Math.max(2, Math.floor(w / 2.3));
  const front: Opening[] = [];
  for (let i = 0; i < nWin; i++) front.push({ x: -uw / 2 + ((i + 0.5) / nWin) * uw, w: winW, h: winH, y: winY, lit: winLit(rng), open: 2.0 + rng.next() * 0.9 });
  k.push(0, 0, uz1, 0); upperWall(k, uw, g, u, front, L, rng); k.pop();
  k.push(0, 0, uz0, Math.PI);
  upperWall(k, uw, g, u, [-w / 4, w / 4].map((x) => ({ x, w: 0.6, h: 0.8, y: winY, lit: winLit(rng), open: 2.2 + rng.next() * 0.7 })), L, rng);
  k.pop();
  for (const s of [-1, 1]) {
    const toChardak = (s === -1 && h.chardak === 'left') || (s === 1 && h.chardak === 'right');
    k.push(s * uw / 2, 0, uzc, s * Math.PI / 2);
    const ops: Opening[] = toChardak
      ? [{ x: -s * 0.6, w: 0.9, h: 1.85, y: g, door: true }, { x: s * 1.4, w: 0.55, h: 0.8, y: winY, lit: winLit(rng), open: 2.4 }]
      : [{ x: 0, w: 0.6, h: 0.85, y: winY, lit: winLit(rng), open: 2.0 + rng.next() * 0.9 }];
    upperWall(k, ud, g, u, ops, L, rng);
    k.pop();
  }
  // еркерът: греди-конзоли, подпори и дъсчен таван отдолу
  if (overhang > 0) {
    const n = Math.round(uw / 0.55);
    for (let i = 0; i <= n; i++) {
      const x = -uw / 2 + 0.07 + ((uw - 0.14) * i) / n;
      k.box('timber', 0.12, 0.15, overhang + 0.12, x, g - 0.075, d / 2 + overhang / 2 + 0.03, { tint: L.timber, grain: 2 });
    }
    k.box('planks', uw, 0.03, overhang, 0, g - 0.016, d / 2 + overhang / 2, { tint: '#a8907a', grain: 0, jitter: 0, noTop: true });
    for (const x of [-uw / 2 + 0.12, -uw / 6, uw / 6, uw / 2 - 0.12]) k.beam('timber', x, g - 0.85, d / 2 + 0.02, x, g - 0.14, uz1 - 0.06, 0.12, 0.13, T);
  }

  // ---- чардакът
  const cw = h.chardakW;
  let rx0 = -uw / 2, rx1 = uw / 2, rz0 = uz0, rz1 = uz1;
  const roofY = g + u;
  if (h.chardak === 'front') {
    const z0 = d / 2, z1 = d / 2 + cw;
    k.box('planks', w + 0.1, 0.07, cw, 0, g - 0.035, (z0 + z1) / 2, { tint: '#b29a84', grain: 2, jitter: 0, tile: [1.6, 1.9] });
    k.box('timber', w + 0.1, 0.2, 0.16, 0, g - 0.16, z1 - 0.08, { ...T, grain: 0 });
    for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) k.box('timber', 0.14, 0.18, cw, x, g - 0.16, (z0 + z1) / 2, { ...T, grain: 2 });
    const px = [-w / 2 + 0.1, -w / 6, w / 6, w / 2 - 0.1];
    for (const x of px) post(k, x, z1 - 0.1, 0, roofY - 0.18, L.timber);
    k.box('timber', w + 0.1, 0.18, 0.18, 0, roofY - 0.09, z1 - 0.1, { ...T, grain: 0 });
    for (const x of px) for (const s of [-1, 1]) if (Math.abs(x + s * 0.5) < w / 2) k.beam('timber', x, roofY - 0.75, z1 - 0.1, x + s * 0.5, roofY - 0.2, z1 - 0.1, 0.1, 0.1, T);
    for (let i = 0; i < px.length - 1; i++) railing(k, px[i] + 0.1, z1 - 0.1, px[i + 1] - 0.1, z1 - 0.1, g, L.timber);
    railing(k, -w / 2 + 0.1, z0 + 0.08, -w / 2 + 0.1, z1 - 0.2, g, L.timber);
    railing(k, w / 2 - 0.1, z0 + 0.08, w / 2 - 0.1, z1 - 1.35, g, L.timber);
    rz1 = z1;
    // стълбата отстрани (отвън на чардака)
    const sx = w / 2 + 0.6;
    stairs(k, sx, z1 - 0.4 - 7 * 0.32, sx, z1 - 0.4, g, 0.9, L, 'z');
  } else {
    const s = h.chardak === 'left' ? -1 : 1;
    const xin = s * w / 2, xout = s * (w / 2 + cw), xm = (xin + xout) / 2;
    k.box('planks', cw, 0.07, ud, xm, g - 0.035, uzc, { tint: '#b29a84', grain: 0, jitter: 0, tile: [1.6, 1.9] });
    k.box('timber', 0.16, 0.2, ud, xout - s * 0.08, g - 0.16, uzc, { ...T, grain: 2 });
    k.box('timber', cw, 0.18, 0.14, xm, g - 0.16, uz1 - 0.07, { ...T, grain: 0 });
    const pz = [uz1 - 0.1, uzc, uz0 + 0.1];
    for (const z of pz) post(k, xout - s * 0.1, z, 0, roofY - 0.18, L.timber);
    k.box('timber', 0.18, 0.18, ud, xout - s * 0.1, roofY - 0.09, uzc, { ...T, grain: 2 });
    for (const z of pz) for (const t of [-1, 1]) if (Math.abs(z + t * 0.5 - uzc) < ud / 2) k.beam('timber', xout - s * 0.1, roofY - 0.75, z, xout - s * 0.1, roofY - 0.2, z + t * 0.5, 0.1, 0.1, T);
    railing(k, xout - s * 0.1, uz0 + 0.2, xout - s * 0.1, uzc - 0.1, g, L.timber);
    railing(k, xout - s * 0.1, uzc + 0.1, xout - s * 0.1, uz1 - 0.2, g, L.timber);
    railing(k, xin + s * 0.08, uz1 - 0.1, xout - s * 1.15, uz1 - 0.1, g, L.timber);
    if (s < 0) rx0 = xout; else rx1 = xout;
    // стълбата отпред, към чардака
    stairs(k, xout - s * 0.6, uz1 + 0.25 + 7 * 0.28, xout - s * 0.6, uz1 + 0.25, g, 0.9, L, 'z');
    // под чардака: дъсчена преграда отзад и дърва
    k.box('planks', cw - 0.3, g - 0.15, 0.05, xm, (g - 0.15) / 2, uz0 + 0.25, { tint: '#9c846e', grain: 1, tile: [1.6, 1.9] });
    for (let r = 0; r < 4; r++) for (let i = 0; i < 7; i++) {
      const z = uz0 + 0.55 + r * 0.0, yy = 0.13 + r * 0.22, xx = xin + s * (0.35 + i * ((cw - 0.7) / 6));
      k.cyl('bark', 0.1, 0.1, 0.62, 6, xx, yy, z + (i % 2) * 0.04, { rx: Math.PI / 2, tint: i % 3 ? '#c8b8a4' : '#e0d2c0' });
    }
  }

  // ---- покривът
  const eave = 0.85;
  const span = Math.min(rx1 - rx0, rz1 - rz0) + eave * 2;
  const rise = span * 0.27;
  const ridgeY = roofOver(k, rx0 - eave, rx1 + eave, rz0 - eave, rz1 + eave, roofY, rise, h.roof, { tint: L.roof, timber: L.timber, eave, gable: { slot: 'plaster', tint: L.plaster } });
  // комини
  const cTop = ridgeY + 0.55 + rng.next() * 0.3;
  chimney(k, w * 0.22 * (rng.next() < 0.5 ? -1 : 1), -d * 0.12, roofY - 0.3, cTop, L);
  if (isInn) chimney(k, -w * 0.3, d * 0.1, roofY - 0.3, cTop - 0.15, L);
  // ханът: фенери на чардака
  if (isInn) for (const x of [-w / 6, w / 6]) lantern(k, x + 0.35, roofY - 0.62, d / 2 + cw - 0.1);
  k.shade = prevShade;
  k.pop();
}

/** Дървена стълба от (x0, z0) на земята до (x1, z1) на височина top; axis — по коя ос върви. */
function stairs(k: Kit, x0: number, z0: number, x1: number, z1: number, top: number, wdt: number, L: Look, _axis: 'z'): void {
  const n = 8, len = Math.hypot(x1 - x0, z1 - z0);
  const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  const px = -dz, pz = dx; // встрани
  const T = { tint: L.timber, bevel: 0.012 };
  // стъпала
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y = 0.12 + (i * (top - 0.12)) / (n - 1);
    k.push(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, Math.atan2(dx, dz));
    k.box('planks', wdt, 0.055, 0.3, 0, y, 0, { tint: '#b6a08a', grain: 0, tile: [1.6, 1.9] });
    k.pop();
  }
  // носачи
  for (const s of [-1, 1]) {
    const ox = px * s * (wdt / 2 + 0.03), oz = pz * s * (wdt / 2 + 0.03);
    k.beam('timber', x0 - dx * 0.2 + ox, 0.02, z0 - dz * 0.2 + oz, x1 + dx * 0.1 + ox, top - 0.02, z1 + dz * 0.1 + oz, 0.06, 0.24, T);
  }
  // перило отвън
  const ox = px * (wdt / 2 + 0.06), oz = pz * (wdt / 2 + 0.06);
  k.beam('timber', x0 + ox, 0.95, z0 + oz, x1 + ox, top + 0.93, z1 + oz, 0.07, 0.07, T);
  for (const t of [0.04, 0.5, 0.96]) {
    const xx = x0 + (x1 - x0) * t + ox, zz = z0 + (z1 - z0) * t + oz, yb = 0.05 + t * (top - 0.1);
    k.box('timber', 0.07, 0.95, 0.07, xx, yb + 0.47, zz, { ...T, grain: 1 });
  }
}

/** Фенер: железна рамка + светещо стъкло (нощем грее). */
export function lantern(k: Kit, x: number, y: number, z: number): void {
  k.box('glass', 0.16, 0.22, 0.16, x, y, z, { tint: litTint(1), jitter: 0 });
  k.box('iron', 0.22, 0.03, 0.22, x, y + 0.125, z, { tint: IRON, jitter: 0 });
  k.box('iron', 0.2, 0.03, 0.2, x, y - 0.125, z, { tint: IRON, jitter: 0 });
  k.cyl('iron', 0.02, 0.12, 0.1, 4, x, y + 0.19, z, { tint: IRON, jitter: 0, ry: Math.PI / 4 });
  for (const [dx, dz] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) k.box('iron', 0.018, 0.25, 0.018, x + dx, y, z + dz, { tint: IRON, jitter: 0 });
  k.tube('iron', [[x, y + 0.24, z], [x, y + 0.42, z]], 0.008, 4, { tint: IRON, jitter: 0 });
}
