// Сградите и нещата на Самодивско и света (без къщите — те са в arch/house.ts): ковачницата, чешмата, орехът,
// кокошарникът, дърводелницата, станът, маси, бъчви, каруци, купи сено, мостът, крепостта, пещерата на Ламята…
// Всичко се строи в Kit (arch/kit.ts) по материали: камък, дялан камък, дърво, дъски, керемиди, желязо, слама…
import * as THREE from 'three';
import { Kit, type V3, type PartOpts } from './arch/kit';
import { roofOver, lantern } from './arch/house';
import { heightAt, BRIDGE, bridgeDeckHeight, terrainHeight } from './height';
import { lumpy } from './geom';
import type { Prop } from './plan';
import { Rng } from '../core/rng';

export { buildHouse } from './arch/house';

const WOOD = '#957660', WOOD_D = '#7a5e4c', PLANK = '#bba690', PLANK_D = '#9c8672', IRON = '#2c2826';
const LIME = '#e4ded3', ROCK_D = '#a49c90';

// ---------------------------------------------------------------- помощни
const _e = new THREE.Euler(), _v = new THREE.Vector3();
/** Цилиндър от точка A до точка B (клон, кол, ос). */
function rod(k: Kit, slot: Parameters<Kit['cyl']>[0], A: V3, B: V3, rA: number, rB: number, seg: number, o?: PartOpts & { caps?: boolean }): void {
  const a = new THREE.Vector3(...A), b = new THREE.Vector3(...B), len = a.distanceTo(b);
  if (len < 1e-4) return;
  const Y = b.clone().sub(a).normalize();
  const X = Math.abs(Y.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize(); X.crossVectors(Y, Z).normalize();
  k.pushMatrix(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a.add(b).multiplyScalar(0.5)));
  k.cyl(slot, rB, rA, len, seg, 0, 0, 0, { ...o, rx: 0, ry: 0, rz: 0 });
  k.pop();
}
/** Отрязан дънер: кора отстрани, светло дърво по срезите. Оста е по локалната y след завъртането (rx, ry, rz). */
function log(k: Kit, x: number, y: number, z: number, r: number, len: number, rx: number, ry: number, rz: number, tint = '#ffffff'): void {
  k.cyl('bark', r, r, len, 7, x, y, z, { rx, ry, rz, caps: false, tint });
  _v.set(0, len / 2, 0).applyEuler(_e.set(rx, ry, rz));
  for (const s of [-1, 1]) k.cyl('timber', r * 0.94, r * 0.94, 0.02, 7, x + _v.x * s, y + _v.y * s, z + _v.z * s, { rx, ry, rz, tint: '#e2c8a6', tile: [0.5, 0.5] });
}
/** Бъчва: издути дъски + железни обръчи. */
function barrel(k: Kit, x: number, y: number, z: number, h = 0.88, r = 0.3, rot = 0): void {
  const prof: [number, number][] = [[r * 0.84, 0], [r * 0.93, h * 0.18], [r, h * 0.5], [r * 0.93, h * 0.82], [r * 0.84, h]];
  k.lathe('planks', prof, 12, x, y, z, { tint: '#a8907a', tile: [0.9, 1.4], ry: rot });
  k.cyl('planks', r * 0.82, r * 0.82, 0.02, 12, x, y + h - 0.03, z, { tint: '#8a7462', tile: [0.9, 0.9] });
  for (const t of [0.1, 0.3, 0.7, 0.9]) {
    const rr = t < 0.2 || t > 0.8 ? r * 0.88 : r * 0.975;
    k.cyl('iron', rr + 0.012, rr + 0.012, 0.035, 12, x, y + h * t, z, { tint: IRON, caps: false, jitter: 0 });
  }
}
/** Сандък от дъски с рамка. */
function crate(k: Kit, x: number, y: number, z: number, s: number, ry: number): void {
  k.push(x, y, z, ry);
  k.box('planks', s, s, s, 0, s / 2, 0, { tint: PLANK, grain: 0, tile: [1.2, 1.9] });
  for (const sy of [0.04, s - 0.04]) for (const sz of [-1, 1]) k.box('timber', s + 0.02, 0.06, 0.04, 0, sy, sz * (s / 2 + 0.005), { tint: WOOD, bevel: 0.008 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('timber', 0.05, s, 0.05, sx * (s / 2 - 0.02), s / 2, sz * (s / 2 - 0.02), { tint: WOOD, bevel: 0.008 });
  k.pop();
}
/** Колело на каруца: главина, спици, дървен обод и железен шина. */
function wheel(k: Kit, x: number, y: number, z: number, R: number): void {
  const ring: V3[] = [];
  for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 2; ring.push([x + Math.sin(a) * R, y + Math.cos(a) * R, z]); }
  k.tube('timber', ring, 0.05, 5, { tint: WOOD });
  const rim: V3[] = ring.map(([px, py]) => [x + (px - x) * 1.07, y + (py - y) * 1.07, z]);
  k.tube('iron', rim, 0.022, 4, { tint: IRON, jitter: 0 });
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; rod(k, 'timber', [x, y, z], [x + Math.sin(a) * R, y + Math.cos(a) * R, z], 0.025, 0.02, 4, { tint: WOOD }); }
  k.cyl('timber', 0.09, 0.09, 0.22, 8, x, y, z, { rx: Math.PI / 2, tint: WOOD_D });
}
/** Каменна плоча/блок от дялан камък. */
const slab = (k: Kit, w: number, h: number, d: number, x: number, y: number, z: number, o?: PartOpts) => k.box('rock', w, h, d, x, y, z, { tint: LIME, bevel: 0.03, ...o });

// ---------------------------------------------------------------- самите неща
export function buildProp(k: Kit, p: Prop): void {
  const y = p.y ?? heightAt(p.x, p.z);
  const rng = new Rng(Math.floor(p.x * 73 + p.z * 197) >>> 0);
  const sc = p.type === 'cave' ? p.s : 1;
  k.push(p.x, y, p.z, p.rot, sc);
  switch (p.type) {
    case 'walnut': walnut(k, rng); break;
    case 'bench_ring': {
      // пейка в кръг около ореха: дъсчени седалки на дебели крака
      const R = p.s, n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a + a1) / 2;
        const len = 2 * R * Math.sin(Math.PI / n) + 0.04;
        k.box('planks', len, 0.07, 0.42, Math.sin(am) * R, 0.46, Math.cos(am) * R, { ry: am + Math.PI / 2, tint: PLANK, grain: 0, bevel: 0.01, tile: [1.2, 1.9] });
        k.box('timber', 0.14, 0.43, 0.36, Math.sin(a) * R, 0.215, Math.cos(a) * R, { ry: a, tint: WOOD, bevel: 0.015 });
      }
      break;
    }
    case 'fountain': fountain(k); break;
    case 'smithy': smithy(k, rng); break;
    case 'coop': {
      for (const [x, z] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) k.box('timber', 0.14, 0.62, 0.14, x, 0.31, z, { tint: WOOD, bevel: 0.015 });
      k.box('planks', 3.4, 1.6, 2.6, 0, 1.4, 0, { tint: '#d0c0ae', grain: 1, cell: 0.8, stain: 0.2, tile: [1.6, 1.9] });
      for (const s of [-1, 1]) for (const yy of [0.62, 2.18]) k.box('timber', 3.5, 0.1, 0.1, 0, yy, s * 1.32, { tint: WOOD, bevel: 0.01 });
      k.box('plain', 0.5, 0.6, 0.04, 0.8, 1.0, 1.31, { tint: '#1a1410', jitter: 0 });
      k.box('planks', 0.5, 0.04, 1.6, 0.8, 0.34, 2.0, { rx: -0.42, tint: PLANK, grain: 2 });
      for (let i = 0; i < 6; i++) k.box('timber', 0.46, 0.025, 0.03, 0.8, 0.15 + i * 0.12, 1.45 + i * 0.26, { rx: -0.42, tint: WOOD });
      roofOver(k, -2.0, 2.0, -1.6, 1.6, 2.2, 0.8, 'gable', { boards: true, tint: '#c8b8a6', timber: WOOD, eave: 0.35, gable: { slot: 'planks', tint: '#a8927c' } });
      break;
    }
    case 'workshop': {
      for (const [x, z] of [[-2.9, -2], [2.9, -2], [-2.9, 2], [2.9, 2]]) { k.box('timber', 0.2, 2.8, 0.2, x, 1.4, z, { tint: WOOD, bevel: 0.02 }); slab(k, 0.34, 0.16, 0.34, x, 0.05, z); }
      k.box('planks', 6, 2.6, 0.08, 0, 1.3, -2.05, { tint: '#b8a28c', grain: 1, cell: 0.8, stain: 0.2, tile: [1.6, 1.9] });
      for (const z of [-2, 2]) k.box('timber', 6.2, 0.18, 0.18, 0, 2.8, z, { tint: WOOD, bevel: 0.02 });
      roofOver(k, -3.5, 3.5, -2.6, 2.6, 2.89, 1.0, 'gable', { tint: '#e4d4c8', timber: WOOD, eave: 0.5, gable: { slot: 'planks', tint: '#a8927c' } });
      // тезгях с менгеме и сечива
      k.box('planks', 2.6, 0.1, 0.9, -0.8, 0.95, -1.2, { tint: '#c8b49e', grain: 0, bevel: 0.01, tile: [1.2, 1.9] });
      for (const [x, z] of [[-2, -1.6], [0.4, -1.6], [-2, -0.8], [0.4, -0.8]]) k.box('timber', 0.1, 0.9, 0.1, x, 0.45, z, { tint: WOOD, bevel: 0.01 });
      k.box('timber', 2.4, 0.06, 0.06, -0.8, 0.3, -1.2, { tint: WOOD });
      k.box('timber', 0.5, 0.15, 0.25, -1.5, 1.08, -1.2, { tint: '#a8865e', bevel: 0.01 });
      for (let i = 0; i < 5; i++) k.box('iron', 0.04, 0.32 + i * 0.04, 0.015, -1.8 + i * 0.22, 1.7, -1.98, { tint: '#3a3634' });
      // недовършен лък (тайната на Калин) на стената
      k.geo('timber', new THREE.TorusGeometry(0.75, 0.03, 5, 14, Math.PI * 0.8), 1.6, 1.6, -1.95, { rz: Math.PI * 0.6, tint: '#c8a07a' });
      // стърготини и дъски на земята
      k.box('plain', 1.4, 0.02, 1.0, 1.2, 0.01, 0.3, { ry: 0.4, tint: '#c9ac78', jitter: 0 });
      for (let i = 0; i < 4; i++) k.box('planks', 2.4, 0.04, 0.22, 1.4, 0.04 + i * 0.045, -1.2 + i * 0.02, { ry: 0.08 * i, tint: '#c8b49e', grain: 0, tile: [1.2, 1.9] });
      break;
    }
    case 'logs': {
      for (let i = 0; i < 6; i++) {
        const row = i < 3 ? 0 : 1, j = row ? i - 3 : i;
        if (row && j === 2) continue;
        log(k, (j - (row ? 0.5 : 1)) * 0.52, 0.26 + row * 0.45, (rng.next() - 0.5) * 0.3, 0.25 + rng.next() * 0.03, 3.0, 0, 0, Math.PI / 2);
      }
      break;
    }
    case 'sawhorse': {
      for (const s of [-0.6, 0.6]) { k.beam('timber', s, 0, -0.32, s, 0.82, 0, 0.08, 0.08, { tint: WOOD }); k.beam('timber', s, 0, 0.32, s, 0.82, 0, 0.08, 0.08, { tint: WOOD }); }
      k.box('timber', 1.5, 0.1, 0.1, 0, 0.8, 0, { tint: WOOD, bevel: 0.01 });
      log(k, 0, 1.0, 0, 0.2, 2.2, 0, 0, Math.PI / 2);
      k.box('iron', 0.7, 0.12, 0.004, 0.3, 1.27, 0.0, { tint: '#6a6a6a', jitter: 0 });
      break;
    }
    case 'loom': {
      // стан под малък навес
      for (const [x, z] of [[-1.4, -1.2], [1.4, -1.2], [-1.4, 1.2], [1.4, 1.2]]) k.box('timber', 0.14, 2.4, 0.14, x, 1.2, z, { tint: WOOD, bevel: 0.015 });
      roofOver(k, -1.8, 1.8, -1.6, 1.6, 2.4, 0.7, 'gable', { tint: '#e8d8cc', timber: WOOD, eave: 0.4, gable: null, th: 0.1 });
      for (const x of [-0.9, 0.9]) { k.box('timber', 0.1, 1.5, 0.1, x, 0.75, -0.4, { tint: '#a8865e', bevel: 0.01 }); k.box('timber', 0.1, 0.9, 0.1, x, 0.45, 0.4, { tint: '#a8865e', bevel: 0.01 }); }
      k.cyl('timber', 0.05, 0.05, 1.9, 8, 0, 1.45, -0.4, { rz: Math.PI / 2, tint: '#a8865e' });
      k.cyl('timber', 0.05, 0.05, 1.9, 8, 0, 0.85, 0.4, { rz: Math.PI / 2, tint: '#a8865e' });
      // тъканта: червено-черни шевици
      const cols = ['#b3262b', '#f2ead8', '#1f1a18', '#b3262b', '#f2ead8'];
      for (let i = 0; i < 10; i++) k.box('plain', 1.7, 0.05, 0.015, 0, 0.95 + i * 0.05, -0.4, { rx: -0.9, tint: cols[i % cols.length], jitter: 0.03 });
      k.box('plain', 1.7, 0.5, 0.015, 0, 1.15, 0.0, { rx: -0.95, tint: '#e8dcc4', jitter: 0 });
      for (let i = 0; i < 24; i++) k.box('plain', 0.006, 0.9, 0.006, -0.8 + i * 0.07, 1.12, -0.05, { rx: -0.72, tint: '#efe6d4', jitter: 0 });
      k.box('planks', 0.8, 0.07, 0.4, 0, 0.45, 0.9, { tint: PLANK, grain: 0, bevel: 0.01 });
      for (const x of [-0.32, 0.32]) k.box('timber', 0.06, 0.42, 0.3, x, 0.21, 0.9, { tint: WOOD });
      break;
    }
    case 'table': {
      k.box('planks', 1.6, 0.07, 0.9, 0, 0.78, 0, { tint: '#c8b49e', grain: 0, bevel: 0.012, tile: [1.2, 1.9] });
      for (const [x, z] of [[-0.68, -0.33], [0.68, -0.33], [-0.68, 0.33], [0.68, 0.33]]) k.box('timber', 0.08, 0.75, 0.08, x, 0.375, z, { tint: WOOD, bevel: 0.01 });
      k.box('timber', 1.3, 0.06, 0.05, 0, 0.22, 0, { tint: WOOD });
      for (const s of [-1, 1]) {
        k.box('planks', 1.6, 0.06, 0.3, 0, 0.45, s * 0.8, { tint: '#c0aa94', grain: 0, bevel: 0.01, tile: [1.2, 1.9] });
        for (const x of [-0.62, 0.62]) k.box('timber', 0.07, 0.43, 0.24, x, 0.215, s * 0.8, { tint: WOOD });
      }
      // паница, хляб и чайник (ханът — храна и чай)
      k.lathe('plain', [[0.0, 0], [0.1, 0.005], [0.17, 0.05], [0.19, 0.08], [0.17, 0.085], [0.15, 0.04], [0, 0.04]], 12, -0.3, 0.815, 0, { tint: '#b98a58' });
      k.geo('plain', new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), -0.3, 0.85, 0, { sy: 0.55, tint: '#c99a5a' });
      k.lathe('plain', [[0.0, 0], [0.09, 0], [0.12, 0.08], [0.11, 0.15], [0.06, 0.19], [0.03, 0.21], [0, 0.22]], 10, 0.35, 0.815, 0.1, { tint: '#7a4a32' });
      rod(k, 'plain', [0.45, 0.9, 0.1], [0.53, 0.97, 0.1], 0.014, 0.01, 5, { tint: '#7a4a32' });
      for (const [cx, cz] of [[0.15, -0.22], [0.55, -0.15]]) k.lathe('plain', [[0, 0], [0.04, 0], [0.045, 0.07], [0.04, 0.07], [0, 0.01]], 8, cx, 0.815, cz, { tint: '#d8cbb6' });
      break;
    }
    case 'barrels': {
      for (let i = 0; i < 3; i++) barrel(k, (i - 1) * 0.66, 0, (i % 2) * 0.42, 0.86 + (i % 2) * 0.06, 0.3, rng.next() * 6);
      break;
    }
    case 'crates': {
      for (let i = 0; i < 3; i++) { const s = 0.55 + (i % 2) * 0.15; crate(k, (i - 1) * 0.72, 0, (i % 2) * 0.3, s, rng.next() * 0.6); }
      crate(k, -0.4, 0.55, 0.0, 0.45, 0.3);
      break;
    }
    case 'haystack': {
      const s = p.s;
      k.geo('hay', lumpy(new THREE.SphereGeometry(1.4, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), 0.07, rng.int(1, 99)), 0, 0.15 * s, 0, { sx: s, sy: s * 1.55, sz: s, tint: '#e8d8b0', jitter: 0.05 });
      k.cyl('hay', 1.36 * s, 1.48 * s, 0.5 * s, 16, 0, 0.25 * s, 0, { tint: '#d8c49a', caps: false });
      rod(k, 'timber', [0, 0, 0], [0, 2.75 * s, 0], 0.05, 0.04, 6, { tint: WOOD_D });
      // разпиляна слама около купата
      for (let i = 0; i < 8; i++) { const a = rng.next() * 6.28, r = (1.5 + rng.next() * 0.5) * s; k.box('hay', 0.5, 0.05, 0.3, Math.sin(a) * r, 0.02, Math.cos(a) * r, { ry: rng.next() * 3, tint: '#d8c49a', jitter: 0.1 }); }
      break;
    }
    case 'woodpile': {
      // цепеници под навес от дъски
      k.box('planks', 0.95, 0.08, 2.3, 0, 0.04, 0, { tint: PLANK_D, grain: 2 });
      for (let r = 0; r < 5; r++) for (let i = 0; i < 6; i++) {
        const rr = 0.1 + rng.next() * 0.025;
        log(k, (rng.next() - 0.5) * 0.08, 0.17 + r * 0.205, -0.95 + i * 0.38 + (r % 2) * 0.08, rr, 0.85, 0, Math.PI / 2, Math.PI / 2, i % 3 ? '#ffffff' : '#e8dccc');
      }
      for (const z of [-1.1, 1.1]) for (const x of [-0.4, 0.4]) k.box('timber', 0.08, 1.35, 0.08, x, 0.67, z, { tint: WOOD, bevel: 0.01 });
      k.box('planks', 1.15, 0.05, 2.5, 0, 1.38, 0, { rz: 0.1, tint: PLANK_D, grain: 2 });
      break;
    }
    case 'cart': {
      // каруца: дъсчен кош, колела със спици, ок и ритли, сено отгоре
      k.box('planks', 2.4, 0.06, 1.3, 0, 0.74, 0, { tint: PLANK, grain: 0, tile: [1.2, 1.9] });
      for (const s of [-1, 1]) {
        k.box('planks', 2.4, 0.42, 0.05, 0, 0.98, s * 0.65, { tint: '#b29a84', grain: 0, tile: [1.2, 1.9] });
        for (let i = 0; i < 5; i++) k.box('timber', 0.05, 0.5, 0.06, -1.1 + i * 0.55, 0.98, s * 0.69, { tint: WOOD });
      }
      for (const s of [-1, 1]) k.box('planks', 0.05, 0.42, 1.3, s * 1.2, 0.98, 0, { tint: '#b29a84', grain: 2, tile: [1.2, 1.9] });
      k.cyl('timber', 0.05, 0.05, 1.7, 6, 0.25, 0.55, 0, { rx: Math.PI / 2, tint: WOOD_D });
      for (const s of [-0.82, 0.82]) wheel(k, 0.25, 0.55, s, 0.5);
      k.beam('timber', 1.2, 0.72, -0.42, 2.9, 0.38, -0.3, 0.07, 0.07, { tint: WOOD });
      k.beam('timber', 1.2, 0.72, 0.42, 2.9, 0.38, 0.3, 0.07, 0.07, { tint: WOOD });
      k.box('timber', 0.08, 0.08, 0.7, 2.75, 0.4, 0, { tint: WOOD });
      k.geo('hay', lumpy(new THREE.SphereGeometry(0.85, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), 0.08, rng.int(1, 99)), -0.2, 1.05, 0, { sx: 1.35, sy: 0.55, sz: 0.75, tint: '#e2cfa0' });
      break;
    }
    case 'scarecrow': {
      k.box('timber', 0.08, 2.1, 0.08, 0, 1.0, 0, { tint: WOOD }); k.box('timber', 1.5, 0.07, 0.07, 0, 1.55, 0, { tint: WOOD });
      k.box('plain', 0.52, 0.72, 0.28, 0, 1.36, 0, { tint: '#e8e0d0', jitter: 0 });
      k.box('plain', 1.2, 0.18, 0.18, 0, 1.58, 0, { tint: '#e2d8c6', jitter: 0 });
      k.box('plain', 0.54, 0.12, 0.3, 0, 1.06, 0, { tint: '#9a2a26', jitter: 0 });
      k.geo('hay', new THREE.SphereGeometry(0.2, 10, 8), 0, 2.05, 0, { tint: '#d8c49a' });
      k.cyl('plain', 0.36, 0.38, 0.03, 12, 0, 2.2, 0, { tint: '#3a2c1e' });
      k.cyl('plain', 0.15, 0.18, 0.2, 10, 0, 2.3, 0, { tint: '#3a2c1e' });
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) k.box('hay', 0.25, 0.02, 0.04, s * (0.78 + rng.next() * 0.06), 1.55 + (rng.next() - 0.5) * 0.1, (rng.next() - 0.5) * 0.08, { rz: (rng.next() - 0.5) * 0.8, tint: '#d8c49a' });
      break;
    }
    case 'field': {
      const w = Math.floor((p.extra ?? 2420) / 100), d = (p.extra ?? 2420) % 100;
      // редове жито: кръстосани карти със стръкове и класове (атласът на листата, дясната половина)
      for (let r = -d / 2 + 1.2; r < d / 2 - 0.6; r += 1.0) for (let x = -w / 2 + 0.6; x < w / 2 - 0.4; x += 0.55) {
        const hgt = 0.75 + rng.next() * 0.3, cw = 0.75, xx = x + (rng.next() - 0.5) * 0.2, zz = r + (rng.next() - 0.5) * 0.2;
        const g = rng.next(), tint = new THREE.Color().setRGB(0.9 + g * 0.2, 0.86 + g * 0.18, 0.7 + g * 0.15);
        const v0 = rng.next() < 0.5 ? 0 : 0.5;
        for (const a of [0.4 + rng.next() * 0.3, 0.4 + Math.PI / 2 + rng.next() * 0.3]) {
          const dx = Math.cos(a) * cw / 2, dz = -Math.sin(a) * cw / 2;
          k.card('leaves', [xx - dx, -0.02, zz - dz], [xx + dx, -0.02, zz + dz], [xx + dx, hgt, zz + dz], [xx - dx, hgt, zz - dz], [0, 1, 0], tint, [0.5, v0, 1, v0 + 0.5]);
        }
      }
      break;
    }
    case 'field_gate': {
      // два каменни стълба от двете страни на отвора в зида на нивата
      const half = (p.extra ?? 3.5) / 2;
      for (const x of [-half, half]) {
        k.box('stone', 0.7, 1.3, 0.7, x, 0.5, 0, { tint: '#f0ebe2', bevel: 0.04, grain: 1, tile: [1.6, 1.6] });
        slab(k, 0.84, 0.13, 0.84, x, 1.2, 0);
      }
      break;
    }
    case 'fold_shed': {
      for (const [x, z] of [[-2.4, 1.2], [2.4, 1.2], [0, 1.2]]) { k.box('timber', 0.18, 2.0, 0.18, x, 1.0, z, { tint: WOOD, bevel: 0.02 }); slab(k, 0.3, 0.14, 0.3, x, 0.04, z); }
      k.box('planks', 5, 2.0, 0.1, 0, 1.0, -1.25, { tint: '#d4c4b2', grain: 1, cell: 0.8, stain: 0.2, tile: [1.6, 1.9] });
      k.box('planks', 0.1, 2.0, 2.5, -2.45, 1.0, 0, { tint: '#d4c4b2', grain: 1, tile: [1.6, 1.9] }); k.box('planks', 0.1, 2.0, 2.5, 2.45, 1.0, 0, { tint: '#d4c4b2', grain: 1, tile: [1.6, 1.9] });
      k.box('timber', 5.2, 0.16, 0.16, 0, 2.0, 1.2, { tint: WOOD, bevel: 0.015 });
      roofOver(k, -2.9, 2.9, -1.7, 1.7, 2.04, 0.6, 'gable', { boards: true, tint: '#c8b8a6', timber: WOOD, eave: 0.4, gable: { slot: 'planks', tint: '#a8927c' } });
      // ясли със сено
      k.box('planks', 3.6, 0.5, 0.5, 0, 0.55, -0.85, { tint: PLANK_D, grain: 0 });
      k.geo('hay', lumpy(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0.1, 7), 0, 0.78, -0.85, { sx: 3.4, sy: 0.4, sz: 0.45, tint: '#dcc898' });
      break;
    }
    case 'inn_sign': {
      // стълб с рамо; самата табела „ХАН“ е в buildSigns (extras.ts) — виси под рамото на синджирчета
      slab(k, 0.4, 0.2, 0.4, 0, 0.06, 0);
      k.box('timber', 0.16, 3.0, 0.16, 0, 1.6, 0, { tint: WOOD, bevel: 0.02 });
      k.box('timber', 1.45, 0.11, 0.11, 0.62, 2.95, 0, { tint: WOOD, bevel: 0.015 });
      k.beam('timber', 0, 2.4, 0, 0.6, 2.92, 0, 0.08, 0.08, { tint: WOOD });
      for (const x of [0.17, 1.07]) k.tube('iron', [[x, 2.9, 0], [x, 2.74, 0]], 0.01, 4, { tint: IRON, jitter: 0 });
      lantern(k, 1.25, 2.62, 0);
      break;
    }
    case 'bridge': buildBridge(k); break;
    case 'tower': {
      const hgt = 7 + (p.extra ?? 0.5) * 4;
      k.cyl('masonry', 3.0, 3.35, hgt, 18, 0, hgt / 2 - 1, 0, { tint: '#e8e2d8', caps: false, tile: [2.6, 2.6] });
      k.cyl('masonry', 2.4, 2.4, hgt - 0.5, 14, 0, hgt / 2 - 1.2, 0, { tint: '#9a948a', caps: false, tile: [2.6, 2.6] });
      // назъбеният срутен връх
      for (let i = 0; i < 12; i++) {
        if (rng.next() < 0.35) continue;
        const a = (i / 12) * Math.PI * 2, hh = 0.5 + rng.next() * 2.2;
        k.box('masonry', 1.5, hh, 0.65, Math.sin(a) * 2.72, hgt - 1 + hh / 2 - 0.05, Math.cos(a) * 2.72, { ry: a, tint: '#e2dcd2', bevel: 0.06, tile: [2.6, 2.6] });
      }
      // бойници
      for (let i = 0; i < 4; i++) { const a = rng.next() * 6.28; k.box('plain', 0.22, 0.9, 0.3, Math.sin(a) * 3.2, 2.6 + i * 1.6, Math.cos(a) * 3.2, { ry: a, tint: '#0e0c0a', jitter: 0 }); }
      for (let i = 0; i < 6; i++) { const a = rng.next() * 6.28, r = 3.6 + rng.next() * 1.8; k.geo('rock', lumpy(new THREE.DodecahedronGeometry(0.3 + rng.next() * 0.45, 0), 0.35, i + 3), Math.sin(a) * r, 0.1, Math.cos(a) * r, { tint: '#c8c0b4', sy: 0.6, flat: true }); }
      break;
    }
    case 'rubble': {
      for (let i = 0; i < 4; i++) {
        const s = p.s * (0.35 + rng.next() * 0.45);
        k.geo(i ? 'rock' : 'masonry', lumpy(new THREE.DodecahedronGeometry(0.8, 0), 0.4, rng.int(1, 99)), (rng.next() - 0.5) * p.s, 0.15 * s, (rng.next() - 0.5) * p.s, { sx: s * 1.3, sy: s * 0.6, sz: s, tint: '#d0c8bc', flat: true, ry: rng.next() * 6 });
      }
      break;
    }
    case 'cave': {
      // скален масив с тъмен отвор (лицето на отвора е към +z): две колони, праг отгоре, маса отзад
      const rocks: [number, number, number, number, number][] = [
        [-6.6, 2.2, -1.6, 3.2, 1], [6.7, 2.0, -1.8, 3.3, 1], [0, 8.1, -2.6, 4.4, 0.7], [0, 5.5, -9, 7.5, 1],
        [-8.8, 1.2, -1.5, 3.0, 1], [8.6, 1.5, -2, 3.2, 1], [-4.5, 9.5, -4, 4.4, 1], [4.8, 9.8, -4.5, 4.6, 1], [0, 12, -8, 5.5, 1],
        // „рамене“ между колоните и прага — да не изглежда, че прагът виси
        [-4.4, 5.4, -1.8, 2.3, 0.9], [4.5, 5.2, -1.9, 2.4, 0.9],
      ];
      rocks.forEach(([x, yy, z, r, sy], i) => k.geo('rock', lumpy(new THREE.DodecahedronGeometry(r, 1), 0.28, i + 7), x, yy - 1.2, z, { ry: i * 1.3, sy, tint: i % 3 === 1 ? '#6e675e' : i % 3 === 2 ? '#857d72' : '#9a9286', flat: true, tile: [4, 4] }));
      // самият отвор: черна арка (лицето към +z), тъмен праг и под
      // (лицето е пред склона — иначе теренът зад пещерата я скрива)
      k.geo('plain', new THREE.CircleGeometry(3.4, 20, 0, Math.PI), 0, -0.6, 0.6, { sy: 1.25, tint: '#040303', jitter: 0 });
      k.geo('plain', new THREE.CylinderGeometry(3.4, 3.4, 1.2, 20, 1, true, -Math.PI / 2, Math.PI), 0, -0.6, 1.2, { rx: Math.PI / 2, sz: 1.25, tint: '#100c0a', jitter: 0 });
      k.box('plain', 6.8, 0.25, 5.0, 0, -0.05, -2.4, { tint: '#120f0d', jitter: 0 });
      // опушено около входа
      for (let i = 0; i < 7; i++) k.geo('rock', lumpy(new THREE.DodecahedronGeometry(0.8, 0), 0.4, i + 30), (i - 3) * 1.4, 0.05, 0.8 + rng.next() * 1.4, { ry: i, sy: 0.45, tint: '#3a3430', flat: true });
      break;
    }
    case 'bones': {
      for (let i = 0; i < 3; i++) {
        const a = rng.next() * 6.28, l = (0.5 + rng.next() * 0.6) * p.s, x = (rng.next() - 0.5) * 0.6, z = (rng.next() - 0.5) * 0.6;
        k.lathe('plain', [[0.0, 0], [0.07, 0.01], [0.075, 0.06], [0.035, 0.12], [0.03, l - 0.12], [0.035, l - 0.12 + 0.06], [0.07, l - 0.04], [0.06, l], [0, l]], 6, x - Math.sin(a) * l / 2, 0.06, z - Math.cos(a) * l / 2, { rx: Math.PI / 2, ry: a, tint: '#e2d6bc', jitter: 0.08 });
      }
      break;
    }
    case 'skull': {
      const s = p.s;
      k.geo('plain', new THREE.SphereGeometry(0.28 * s, 12, 9), 0, 0.22 * s, -0.04 * s, { sx: 0.95, sy: 0.85, sz: 1.15, tint: '#e2d6bc' });
      k.box('plain', 0.3 * s, 0.16 * s, 0.24 * s, 0, 0.12 * s, 0.2 * s, { tint: '#d8ccb2', bevel: 0.03 * s });
      for (const sx of [-1, 1]) k.geo('plain', new THREE.SphereGeometry(0.065 * s, 8, 6), sx * 0.09 * s, 0.25 * s, 0.26 * s, { tint: '#1a1410', jitter: 0 });
      // рога (стар бик — плячка на Ламята)
      for (const sx of [-1, 1]) rod(k, 'plain', [sx * 0.24 * s, 0.3 * s, 0], [sx * 0.62 * s, 0.52 * s, -0.08 * s], 0.07 * s, 0.015, 7, { tint: '#d0c4a8' });
      break;
    }
    case 'spring': {
      // пресъхналият извор: каменна стена с чучур, камъни в кръг, напукано дъно
      k.box('masonry', 3.2, 1.6, 0.8, 0, 0.6, -1.4, { tint: '#d8d0c4', bevel: 0.05, cell: 0.8, stain: 0.3 });
      slab(k, 3.4, 0.14, 0.95, 0, 1.45, -1.4, { tint: '#c8c0b4' });
      slab(k, 0.7, 0.5, 0.06, 0, 1.0, -0.98, { tint: '#b0a89c' });
      rod(k, 'iron', [0, 0.95, -0.98], [0, 0.88, -0.55], 0.045, 0.04, 8, { tint: '#4a4038' });
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; k.geo('rock', lumpy(new THREE.DodecahedronGeometry(0.45, 0), 0.4, i + 50), Math.sin(a) * 1.9, 0.1, Math.cos(a) * 1.6, { ry: i, sy: 0.6, tint: '#b8b0a4', flat: true }); }
      k.cyl('rock', 1.8, 1.8, 0.05, 16, 0, 0.02, 0, { tint: '#8a7a62', stain: 0.3 });
      break;
    }
    case 'dance_ring': {
      // венец от бели цветя в кръг
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2, r = p.s + (rng.next() - 0.5) * 0.3;
        k.geo('plain', new THREE.IcosahedronGeometry(0.12, 0), Math.sin(a) * r, 0.18, Math.cos(a) * r, { tint: i % 3 ? '#f6f2ea' : '#f3d35a' });
        k.cyl('plain', 0.01, 0.01, 0.18, 3, Math.sin(a) * r, 0.09, Math.cos(a) * r, { tint: '#4f7a3a' });
      }
      break;
    }
  }
  k.pop();
}

// ---------------------------------------------------------------- орехът на мегдана
function walnut(k: Kit, rng: Rng): void {
  // ствол с разширена основа, дебели клони, корона от листа (снопове листа — карти с текстура, виж materials.ts)
  k.lathe('bark', [[1.35, -0.2], [1.1, 0.25], [0.9, 0.8], [0.78, 1.8], [0.72, 3.0], [0.68, 3.9], [0.6, 4.4]], 12, 0, 0, 0, { tint: '#d8d0c8', tile: [1.2, 1.8] });
  for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; rod(k, 'bark', [Math.sin(a) * 0.6, 0.15, Math.cos(a) * 0.6], [Math.sin(a) * 1.7, -0.05, Math.cos(a) * 1.7], 0.32, 0.12, 6, { tint: '#d0c8c0', caps: false }); }
  const limbs: V3[] = [[3.4, 6.4, 1.2], [-3.2, 6.8, 1.6], [0.8, 7.2, -3.4], [-1.2, 6.2, 3.6], [2.4, 7.8, -1.2], [-2.0, 8.4, -1.6]];
  const tips: V3[] = [];
  limbs.forEach((L, i) => {
    rod(k, 'bark', [0, 3.8, 0], L, 0.45, 0.24, 8, { tint: '#d0c8c0', caps: false });
    // по-тънки клонки към края
    for (let j = 0; j < 3; j++) {
      const t: V3 = [L[0] * 1.35 + (rng.next() - 0.5) * 2.2, L[1] + 1.2 + rng.next() * 1.6, L[2] * 1.35 + (rng.next() - 0.5) * 2.2];
      rod(k, 'bark', L, t, 0.2, 0.06, 5, { tint: '#d0c8c0', caps: false });
      tips.push(t);
    }
    tips.push(L);
    void i;
  });
  // листата: снопове кръстосани карти около краищата на клоните + обща корона (нормали навън от средата → мек обем)
  const C = new THREE.Vector3(0, 8.2, 0);
  const cards = (cx: number, cy: number, cz: number, R: number, n: number, shell: number) => {
    for (let i = 0; i < n; i++) {
      // по-гъсто към повърхността на короната (вътре почти не се вижда — по-малко слоеве за видеокартата)
      const u = rng.next() * 2 - 1, phi = rng.next() * Math.PI * 2, rr = R * (shell + (1 - shell) * Math.sqrt(rng.next()));
      const s = Math.sqrt(1 - u * u);
      const px = cx + Math.cos(phi) * s * rr, py = cy + u * rr * 0.75, pz = cz + Math.sin(phi) * s * rr;
      const size = 1.6 + rng.next() * 1.0;
      const nrm = new THREE.Vector3(px, py, pz).sub(C).normalize();
      const ry = rng.next() * Math.PI, rx = (rng.next() - 0.5) * 1.2;
      const g = rng.next();
      const tint = new THREE.Color().setRGB(0.8 + g * 0.22, 0.84 + g * 0.18, 0.74 + g * 0.16);
      // светли отвън, тъмни навътре и отдолу (самозасенчване на короната)
      const depth = new THREE.Vector3(px, py, pz).distanceTo(C) / 5.2;
      tint.multiplyScalar((0.4 + Math.min(1, depth) * 0.6) * (0.75 + 0.25 * Math.max(0, Math.min(1, (py - 5.5) / 5))));
      leafCard(k, px, py, pz, size, rx, ry, nrm, tint);
    }
  };
  cards(0, 8.6, 0, 4.5, 200, 0.55);
  for (const t of tips) cards(t[0], t[1] + 0.3, t[2], 2.1, 12, 0.3);
}
/** Карта с листа: квадрат size×size, завъртян (rx, ry), с нормала nrm (навън от короната). */
function leafCard(k: Kit, x: number, y: number, z: number, size: number, rx: number, ry: number, nrm: THREE.Vector3, tint: THREE.Color): void {
  const h = size / 2;
  const M = new THREE.Matrix4().makeRotationFromEuler(_e.set(rx, ry, 0));
  const c = (a: number, b: number): V3 => { const v = new THREE.Vector3(a, b, 0).applyMatrix4(M); return [x + v.x, y + v.y, z + v.z]; };
  // лявата половина на атласа е 2×2 снопа листа — всяка карта взема един от тях
  const q = Math.floor(Math.abs(Math.sin(x * 12.9 + z * 78.2)) * 4) % 4, u0 = (q % 2) * 0.25, v0 = Math.floor(q / 2) * 0.5;
  k.card('leaves', c(-h, -h), c(h, -h), c(h, h), c(-h, h), [nrm.x, nrm.y, nrm.z], tint, [u0, v0, u0 + 0.25, v0 + 0.5]);
}

// ---------------------------------------------------------------- чешмата
function fountain(k: Kit): void {
  // каменна чешма: стена от дялан камък с арка-ниша, плоча с надпис, тръба (чучур), корито; керемидено покривче
  k.box('masonry', 2.8, 2.1, 0.62, 0, 1.0, -0.3, { tint: '#ece6dc', cell: 0.5, stain: 0.3, bevel: 0.04, tile: [1.8, 1.8] });
  k.box('masonry', 3.0, 0.3, 0.75, 0, 0.1, -0.3, { tint: '#d8d0c4', bevel: 0.04, tile: [1.8, 1.8] });
  // арката: тъмна ниша + дъга от клинци
  k.box('plain', 1.0, 1.25, 0.04, 0, 1.25, 0.005, { tint: '#2a2622', jitter: 0 });
  k.geo('plain', new THREE.CircleGeometry(0.5, 12, 0, Math.PI), 0, 1.875, 0.006, { tint: '#2a2622', jitter: 0 });
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI, r = 0.62;
    k.box('rock', 0.26, 0.17, 0.12, Math.cos(a) * r, 1.875 + Math.sin(a) * r, 0.03, { rz: a - Math.PI / 2, tint: i === 4 ? '#f2eee6' : LIME, bevel: 0.02 });
  }
  for (const s of [-1, 1]) slab(k, 0.2, 1.3, 0.12, s * 0.62, 1.25, 0.03);
  slab(k, 0.62, 0.42, 0.05, 0, 1.55, 0.03, { tint: '#d4ccbe', bevel: 0.015 });
  // корниз и покривче
  slab(k, 3.1, 0.14, 0.82, 0, 2.12, -0.3);
  roofOver(k, -1.75, 1.75, -0.85, 0.25, 2.2, 0.42, 'gable', { tint: '#e2d0c4', eave: 0.3, gable: { slot: 'masonry', tint: '#ece6dc' }, rafters: false, th: 0.1 });
  // чучур и струя
  rod(k, 'iron', [0, 1.25, 0.02], [0, 1.2, 0.36], 0.035, 0.03, 8, { tint: '#6a5a3c' });
  k.cyl('plain', 0.016, 0.024, 0.62, 6, 0, 0.88, 0.37, { tint: '#b4c4ca', caps: false, jitter: 0 });
  // коритото: дебели каменни стени, дъно и вода вътре
  const tr = { tint: '#ddd6ca', bevel: 0.035, cell: 0.5, stain: 0.25, jitter: 0 };
  k.box('rock', 2.2, 0.62, 0.15, 0, 0.31, 0.78 + 0.45, tr);
  k.box('rock', 2.2, 0.62, 0.15, 0, 0.31, 0.78 - 0.45, tr);
  for (const s of [-1, 1]) k.box('rock', 0.15, 0.62, 0.78, s * 1.025, 0.31, 0.78, tr);
  k.box('rock', 1.95, 0.3, 0.78, 0, 0.15, 0.78, tr);
  k.box('wet', 1.92, 0.02, 0.76, 0, 0.5, 0.78, { tint: '#0e1416', jitter: 0 });
}

// ---------------------------------------------------------------- ковачницата
function smithy(k: Kit, rng: Rng): void {
  // открит навес: задна каменна стена, странични полустени, стълбове, покрив; огнище с жар и комин; наковалня
  const prev = k.shade;
  // сажди около огнището и комина
  const soot = new THREE.Vector3(-1.6, 1.0, -2.4).applyMatrix4(k.top);
  k.shade = (pp, s, n) => {
    const f = prev ? prev(pp, s, n) : 1;
    if (s === 'glass' || s === 'hot') return f;
    const d = Math.hypot(pp.x - soot.x, (pp.y - soot.y) * 0.55, pp.z - soot.z);
    return f * (0.45 + 0.55 * Math.min(1, d / 2.6));
  };
  k.box('stone', 7, 3.0, 0.6, 0, 1.5, -3, { tint: '#e8e0d4', cell: 0.6, stain: 0.3, grain: 1 });
  k.box('stone', 0.5, 1.4, 5.6, -3.3, 0.7, -0.2, { tint: '#e8e0d4', grain: 1, cell: 0.7 });
  k.box('stone', 0.5, 1.4, 2.4, 3.3, 0.7, -1.8, { tint: '#e8e0d4', grain: 1, cell: 0.7 });
  slab(k, 0.6, 0.1, 5.7, -3.3, 1.43, -0.2); slab(k, 0.6, 0.1, 2.5, 3.3, 1.43, -1.8);
  for (const [x, z] of [[-3.3, 2.8], [3.3, 2.8], [-3.3, -0.2], [3.3, -0.2]]) k.box('timber', 0.24, 3.1, 0.24, x, 1.55, z, { tint: WOOD, bevel: 0.025 });
  k.box('timber', 7.2, 0.22, 0.22, 0, 3.05, 2.8, { tint: WOOD, bevel: 0.02 });
  for (const x of [-3.3, 3.3]) k.box('timber', 0.2, 0.2, 6.2, x, 3.05, -0.1, { tint: WOOD, bevel: 0.02 });
  roofOver(k, -4.2, 4.2, -3.8, 3.6, 3.16, 1.4, 'gable', { tint: '#b8a49a', timber: WOOD, eave: 0.9, gable: { slot: 'planks', tint: '#8a7462' } });
  // огнището: каменен блок, жар, обла качулка и комин
  k.box('stone', 2.0, 1.0, 1.6, -1.6, 0.5, -2.0, { tint: '#b8b0a4', grain: 1, bevel: 0.03 });
  slab(k, 2.1, 0.08, 1.7, -1.6, 1.0, -2.0, { tint: '#7a7268' });
  k.box('hot', 1.3, 0.06, 0.9, -1.6, 1.06, -2.0, { tint: '#ff6a1a', jitter: 0.1 });
  for (let i = 0; i < 10; i++) k.geo('hot', new THREE.IcosahedronGeometry(0.09 + rng.next() * 0.06, 0), -2.1 + rng.next() * 1.0, 1.1, -2.35 + rng.next() * 0.7, { tint: rng.next() < 0.5 ? '#ffb347' : '#ff7a2a', jitter: 0.2 });
  for (let i = 0; i < 6; i++) k.geo('plain', new THREE.IcosahedronGeometry(0.08 + rng.next() * 0.05, 0), -2.2 + rng.next() * 1.2, 1.09, -2.4 + rng.next() * 0.8, { tint: '#1a1614', jitter: 0.2, flat: true });
  k.box('stone', 1.9, 0.9, 1.2, -1.6, 2.4, -2.3, { tint: '#9a9286', grain: 1, bevel: 0.04 });
  k.box('stone', 1.2, 3.6, 0.95, -1.6, 4.5, -2.6, { tint: '#b0a89c', grain: 1, cell: 0.6, stain: 0.35 });
  slab(k, 1.4, 0.12, 1.15, -1.6, 6.36, -2.6, { tint: '#8a8276' });
  k.box('plain', 0.6, 0.1, 0.5, -1.6, 6.42, -2.6, { tint: '#0c0a08', jitter: 0 });
  // мехът: кожа между две дъски, дръжка
  k.box('planks', 0.75, 0.05, 1.15, -3.0, 0.72, -1.6, { tint: PLANK_D, grain: 2 });
  k.geo('plain', new THREE.SphereGeometry(0.5, 12, 8), -3.0, 0.88, -1.62, { sx: 0.72, sy: 0.32, sz: 1.05, tint: '#5a3e2a' });
  k.box('planks', 0.7, 0.05, 1.1, -3.0, 1.04, -1.6, { rx: -0.12, tint: PLANK_D, grain: 2 });
  k.beam('timber', -3.0, 1.06, -1.0, -3.0, 1.4, -0.35, 0.05, 0.05, { tint: WOOD });
  k.beam('timber', -2.7, 0.75, -2.15, -2.2, 0.85, -2.1, 0.06, 0.06, { tint: WOOD_D });
  // наковалнята на пън
  k.cyl('bark', 0.34, 0.38, 0.55, 9, 1.0, 0.275, 0.4, { tint: '#d0c4b8', caps: false });
  k.cyl('timber', 0.33, 0.33, 0.02, 9, 1.0, 0.55, 0.4, { tint: '#c8b090' });
  k.box('iron', 0.34, 0.12, 0.28, 1.0, 0.62, 0.4, { tint: '#3a3836', bevel: 0.02 });
  k.box('iron', 0.2, 0.14, 0.16, 1.0, 0.74, 0.4, { tint: '#3a3836', bevel: 0.01 });
  k.box('iron', 0.62, 0.13, 0.24, 1.0, 0.875, 0.4, { tint: '#4a4846', bevel: 0.015 });
  k.geo('iron', new THREE.ConeGeometry(0.1, 0.36, 10), 1.49, 0.89, 0.4, { rz: -Math.PI / 2, sz: 0.9, tint: '#4a4846' });
  // чук и клещи на наковалнята
  k.box('iron', 0.14, 0.06, 0.06, 0.85, 0.97, 0.45, { tint: '#2a2826' });
  rod(k, 'timber', [0.85, 0.97, 0.45], [0.55, 0.97, 0.65], 0.016, 0.014, 5, { tint: WOOD });
  // коритото с вода и сечивата на стената
  k.box('planks', 1.2, 0.5, 0.6, 2.4, 0.25, -2.2, { tint: PLANK_D, grain: 0 });
  k.box('wet', 1.06, 0.02, 0.46, 2.4, 0.46, -2.2, { tint: '#0c1012', jitter: 0 });
  for (let i = 0; i < 5; i++) {
    const x = 1.6 + i * 0.32, l = 0.6 + rng.next() * 0.3;
    rod(k, 'iron', [x, 2.2, -2.68], [x + (rng.next() - 0.5) * 0.06, 2.2 - l, -2.68], 0.014, 0.014, 4, { tint: '#3a3634' });
    k.box('iron', 0.1, 0.06, 0.03, x, 2.2 - l, -2.68, { tint: '#2a2826' });
  }
  k.box('timber', 1.9, 0.08, 0.06, 2.24, 2.22, -2.68, { tint: WOOD });
  // купчина въглища и желязо
  for (let i = 0; i < 8; i++) k.geo('plain', new THREE.IcosahedronGeometry(0.12 + rng.next() * 0.08, 0), 2.6 + rng.next() * 0.5, 0.06, -0.8 + rng.next() * 0.6, { tint: '#141210', flat: true });
  for (let i = 0; i < 4; i++) k.box('iron', 1.1, 0.04, 0.04, 2.0, 0.03 + i * 0.04, 0.6 + i * 0.05, { ry: 0.3 + i * 0.1, tint: '#4a3a30' });
  k.shade = prev;
}

// ---------------------------------------------------------------- каменният мост
function buildBridge(k: Kit): void {
  // работим в световни координати (височините идват от bridgeDeckHeight)
  k.pop(); k.push(0, 0, 0, 0);
  const { x0, x1, z, halfW } = BRIDGE;
  const n = 26;
  const bed = terrainHeight((x0 + x1) / 2, z) - 0.6;
  const M = { tile: [2.2, 2.2] as [number, number], jitter: 0 };
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n, xm = (xa + xb) / 2;
    const top = bridgeDeckHeight(xm, z)!;
    // свод: под средата е празно (арка), отстрани — плътно
    const u = (xm - (x0 + x1) / 2) / 7.5;
    const archTop = Math.abs(u) < 1 ? bed + Math.sqrt(1 - u * u) * 4.6 : -Infinity;
    const bottom = archTop > -Infinity ? archTop : Math.min(terrainHeight(xm, z), top) - 1.2;
    const h = top - bottom;
    if (h > 0.05) k.box('masonry', xb - xa + 0.02, h, halfW * 2, xm, bottom + h / 2, z, { ...M, tint: '#e6e0d6', grain: 1 });
    // настилка от плочи
    k.box('stone', xb - xa + 0.02, 0.08, halfW * 2 - 0.2, xm, top + 0.02, z, { ...M, tint: '#cfc8bc', grain: 0, tile: [1.6, 1.6] });
    // парапети с каменни капаци
    for (const s of [-1, 1]) {
      k.box('masonry', xb - xa + 0.03, 0.7, 0.38, xm, top + 0.33, z + s * (halfW + 0.05), { ...M, tint: '#e2dcd2', grain: 1 });
      k.box('rock', xb - xa + 0.03, 0.1, 0.46, xm, top + 0.73, z + s * (halfW + 0.05), { tint: '#d4cdc2', jitter: 0.08, bevel: 0.02 });
    }
  }
  // клинци по свода
  for (let i = 1; i < 14; i++) {
    // по елипсата на свода, всеки клинец — по нормалата ѝ, малко над ръба на отвора
    const a = Math.PI * (i / 14), A = 7.5, B = 4.6;
    const nx = -Math.cos(a) / A, ny = Math.sin(a) / B, nl = Math.hypot(nx, ny);
    const x = (x0 + x1) / 2 - Math.cos(a) * A + (nx / nl) * 0.22, yy = bed + Math.sin(a) * B + (ny / nl) * 0.22;
    for (const s of [-1, 1]) k.box('rock', 0.5, 0.5, 0.1, x, yy, z + s * (halfW + 0.03), { rz: Math.atan2(-nx, ny), tint: '#cfc8bc', bevel: 0.025, jitter: 0.1 });
  }
}
