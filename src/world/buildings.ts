// Сградите на Самодивско: възрожденски къщи (каменен приземен етаж, бял горен с тъмни греди, чардак,
// червени керемиди), ханът, ковачницата, чешмата, орехът, кокошарникът, дърводелницата, станът…
import * as THREE from 'three';
import { Batch, lumpy } from './geom';
import { PAL } from './palette';
import { heightAt, BRIDGE, bridgeDeckHeight, terrainHeight } from './height';
import type { HouseSpec, Prop } from './plan';
import { Rng } from '../core/rng';

type V3 = [number, number, number];
const STONES = ['#9a9184', '#8a8276', '#a69e90', '#7f786d', '#b0a898'];
const SHUTTER = ['#5a3b26', '#4a5a4a', '#5a3b26', '#3e4f63'];

/** Триъгълник с правилна посока на лицето (към out). */
function tri(b: Batch, a: V3, c: V3, d: V3, out: V3, color: string, list?: number[]) {
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const ok = nx * out[0] + ny * out[1] + nz * out[2] >= 0;
  const p = ok ? [...a, ...c, ...d] : [...a, ...d, ...c];
  if (list) list.push(...p); else b.tris(p, color);
}
function quad(b: Batch, a: V3, c: V3, d: V3, e: V3, out: V3, color: string) {
  const list: number[] = [];
  tri(b, a, c, d, out, color, list); tri(b, a, d, e, out, color, list);
  b.tris(list, color);
}
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Покрив на четири води (hip) или на две води (gable) над правоъгълник [x0,x1]×[z0,z1] на височина y. */
export function roof(b: Batch, x0: number, x1: number, z0: number, z1: number, y: number, rise: number, kind: 'hip' | 'gable', c1: string = PAL.roof, c2: string = PAL.roof2, gableColor: string = PAL.wall) {
  // работим така, че билото да е по по-дългата ос (x); иначе завъртаме
  const alongX = (x1 - x0) >= (z1 - z0);
  if (!alongX) { b.push(0, 0, 0, Math.PI / 2); [x0, x1, z0, z1] = [-z1, -z0, x0, x1]; }
  const th = 0.14, yt = y + th, zm = (z0 + z1) / 2, half = (z1 - z0) / 2;
  const a = kind === 'hip' ? Math.min(half, (x1 - x0) / 2) : 0;
  const r0: V3 = [x0 + a, yt + rise, zm], r1: V3 = [x1 - a, yt + rise, zm];
  const bands = 6;
  const band = (A: V3, B: V3, C: V3, D: V3, out: V3) => {
    // A-B ръб на стряхата, D-C (горе); ивици = редове керемиди
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands, t1 = (i + 1) / bands;
      const p0 = lerp3(A, D, t0), p1 = lerp3(B, C, t0), p2 = lerp3(B, C, t1), p3 = lerp3(A, D, t1);
      quad(b, p0, p1, p2, p3, out, i % 2 ? c1 : shade(c1, 0.9));
    }
  };
  // предна и задна страна
  band([x0, yt, z1], [x1, yt, z1], r1, r0, [0, 1, 1]);
  band([x1, yt, z0], [x0, yt, z0], r0, r1, [0, 1, -1]);
  if (kind === 'hip') {
    // страничните триъгълници
    for (let i = 0; i < bands; i++) {
      const t0 = i / bands, t1 = (i + 1) / bands;
      const L = (p: V3, q: V3, t: number) => lerp3(p, q, t);
      const A: V3 = [x0, yt, z0], B: V3 = [x0, yt, z1];
      quad(b, L(A, r0, t0), L(B, r0, t0), L(B, r0, t1), L(A, r0, t1), [-1, 1, 0], i % 2 ? c1 : shade(c1, 0.9));
      const C: V3 = [x1, yt, z1], D: V3 = [x1, yt, z0];
      quad(b, L(C, r1, t0), L(D, r1, t0), L(D, r1, t1), L(C, r1, t1), [1, 1, 0], i % 2 ? c1 : shade(c1, 0.9));
    }
    b.beam(x0, yt, z0, r0[0], r0[1], r0[2], 0.2, c2); b.beam(x0, yt, z1, r0[0], r0[1], r0[2], 0.2, c2);
    b.beam(x1, yt, z0, r1[0], r1[1], r1[2], 0.2, c2); b.beam(x1, yt, z1, r1[0], r1[1], r1[2], 0.2, c2);
  } else {
    // фронтони (бели триъгълници) малко навътре от стряхата
    const gi = 0.75;
    tri(b, [x0 + gi, y, z0 + gi], [x0 + gi, y, z1 - gi], [x0 + gi, yt + rise * (1 - gi / half), zm], [-1, 0, 0], gableColor);
    tri(b, [x1 - gi, y, z0 + gi], [x1 - gi, y, z1 - gi], [x1 - gi, yt + rise * (1 - gi / half), zm], [1, 0, 0], gableColor);
    // страничен ръб на покрива (дебелина)
    for (const x of [x0, x1]) {
      const s = x === x0 ? -1 : 1;
      quad(b, [x, y, z0], [x, yt, z0], [x, yt + rise, zm], [x, y + rise, zm], [s, 0, 0], c2);
      quad(b, [x, y, z1], [x, yt, z1], [x, yt + rise, zm], [x, y + rise, zm], [s, 0, 0], c2);
    }
  }
  if (r1[0] > r0[0]) b.beam(r0[0] - 0.1, r0[1] + 0.02, zm, r1[0] + 0.1, r1[1] + 0.02, zm, 0.26, c2);
  // долната страна на стряхата и челата
  quad(b, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], PAL.woodDark);
  quad(b, [x0, y, z1], [x1, y, z1], [x1, yt, z1], [x0, yt, z1], [0, 0, 1], c2);
  quad(b, [x0, y, z0], [x1, y, z0], [x1, yt, z0], [x0, yt, z0], [0, 0, -1], c2);
  if (kind === 'hip') {
    quad(b, [x0, y, z0], [x0, y, z1], [x0, yt, z1], [x0, yt, z0], [-1, 0, 0], c2);
    quad(b, [x1, y, z0], [x1, y, z1], [x1, yt, z1], [x1, yt, z0], [1, 0, 0], c2);
  }
  if (!alongX) b.pop();
}
function shade(c: string, f: number): string { const k = new THREE.Color(c).multiplyScalar(f); return '#' + k.getHexString(); }

/** Прозорец с рамка и капаци на стена с нормала +z (в текущите локални координати). glow — партида за стъклото. */
function windowAt(b: Batch, glow: Batch, x: number, y: number, z: number, w: number, h: number, shutter: string, open = 0.5) {
  glow.box(w, h, 0.06, x, y, z + 0.02, '#ffc874', 0, 0, 0, 0);
  const t = 0.09, fc = PAL.woodDark;
  b.box(w + t * 2, t, 0.1, x, y + h / 2 + t / 2, z + 0.04, fc);
  b.box(w + t * 2 + 0.1, t * 1.3, 0.18, x, y - h / 2 - t / 2, z + 0.07, fc);
  b.box(t, h, 0.1, x - w / 2 - t / 2, y, z + 0.04, fc);
  b.box(t, h, 0.1, x + w / 2 + t / 2, y, z + 0.04, fc);
  b.box(0.05, h, 0.04, x, y, z + 0.06, fc);
  // капаци
  const sw = w / 2 + 0.02;
  for (const s of [-1, 1]) {
    const hx = x + s * (w / 2 + t);
    const a = s * open;
    b.box(sw, h, 0.05, hx + s * Math.cos(open) * sw / 2, y, z + 0.05 + Math.sin(open) * sw / 2, shutter, a === 0 ? 0 : -a);
  }
}

export function buildHouse(b: Batch, glow: Batch, h: HouseSpec): void {
  const rng = new Rng(h.seed);
  const isInn = h.kind === 'inn';
  const g = isInn ? 2.7 : 2.5, u = isInn ? 2.8 : 2.5, w = h.w, d = h.d;
  // основата на най-ниската точка, за да няма висящи ъгли
  const cs = Math.cos(h.rot), sn = Math.sin(h.rot);
  let base = Infinity;
  for (const [lx, lz] of [[-h.fw / 2, -h.fd / 2], [h.fw / 2, -h.fd / 2], [-h.fw / 2, h.fd / 2], [h.fw / 2, h.fd / 2], [0, 0]]) {
    const x = h.x + (lx + h.fx) * cs + (lz + h.fz) * sn, z = h.z - (lx + h.fx) * sn + (lz + h.fz) * cs;
    base = Math.min(base, heightAt(x, z));
  }
  b.push(h.x, base, h.z, h.rot); glow.push(h.x, base, h.z, h.rot);
  const shutter = isInn ? PAL.woodDark : SHUTTER[h.seed % SHUTTER.length];
  const overhang = h.chardak === 'front' ? 0 : 0.55;

  // каменен цокъл + приземен етаж
  b.box(w + 0.2, 0.5, d + 0.2, 0, -0.1, 0, PAL.stoneDark);
  b.box(w, g, d, 0, g / 2, 0, PAL.stone, 0, 0, 0, 0.04);
  // камъни по фасадите
  for (let side = 0; side < 4; side++) {
    const along = side < 2 ? w : d, n = Math.round(along * 2.2);
    for (let k = 0; k < n; k++) {
      const sx = (rng.next() - 0.5) * (along - 0.5), sy = 0.25 + rng.next() * (g - 0.5);
      const sw = 0.3 + rng.next() * 0.45, shh = 0.18 + rng.next() * 0.2, col = STONES[Math.floor(rng.next() * STONES.length)];
      if (side === 0) b.box(sw, shh, 0.08, sx, sy, d / 2 + 0.02, col);
      if (side === 1) b.box(sw, shh, 0.08, sx, sy, -d / 2 - 0.02, col);
      if (side === 2) b.box(0.08, shh, sw, w / 2 + 0.02, sy, sx * (d / w), col);
      if (side === 3) b.box(0.08, shh, sw, -w / 2 - 0.02, sy, sx * (d / w), col);
    }
  }
  // врата + малки прозорчета на приземния етаж
  const doorX = (h.chardak === 'left' ? -1 : h.chardak === 'right' ? 1 : 0) * (w / 2 - 1.3);
  b.box(1.15, 2.05, 0.1, doorX, 1.02, d / 2 + 0.05, PAL.wood);
  b.box(1.45, 0.18, 0.16, doorX, 2.12, d / 2 + 0.07, PAL.woodDark);
  b.box(0.14, 2.1, 0.14, doorX - 0.65, 1.05, d / 2 + 0.07, PAL.woodDark);
  b.box(0.14, 2.1, 0.14, doorX + 0.65, 1.05, d / 2 + 0.07, PAL.woodDark);
  b.box(0.08, 0.08, 0.1, doorX + 0.4, 1.0, d / 2 + 0.12, '#2a2622');
  b.push(0, 0, 0, 0); glow.push(0, 0, 0, 0);
  windowAt(b, glow, -doorX * 0.9 || 2.2, 1.45, d / 2, 0.55, 0.6, shutter, 0.15);
  b.pop(); glow.pop();
  for (const s of [-1, 1]) {
    b.push(s * w / 2, 0, 0, s * Math.PI / 2); glow.push(s * w / 2, 0, 0, s * Math.PI / 2);
    windowAt(b, glow, 0, 1.5, 0, 0.5, 0.55, shutter, 0.1);
    b.pop(); glow.pop();
  }

  // горният етаж: бял, издаден напред (еркер), тъмни греди
  const uz0 = -d / 2 - 0.05, uz1 = d / 2 + overhang, uw = w + 0.12;
  b.box(uw, u, uz1 - uz0, 0, g + u / 2, (uz0 + uz1) / 2, PAL.wall, 0, 0, 0, 0.025);
  const bc = PAL.wood, bt = 0.16;
  // хоризонтални греди
  for (const y of [g + 0.08, g + u - 0.08]) {
    b.box(uw + 0.08, bt, bt, 0, y, uz1 + 0.03, bc); b.box(uw + 0.08, bt, bt, 0, y, uz0 - 0.03, bc);
    b.box(bt, bt, uz1 - uz0 + 0.08, uw / 2 + 0.03, y, (uz0 + uz1) / 2, bc); b.box(bt, bt, uz1 - uz0 + 0.08, -uw / 2 - 0.03, y, (uz0 + uz1) / 2, bc);
  }
  // вертикални стълбове и диагонални подпори
  const nPost = Math.max(3, Math.round(uw / 1.6));
  for (let k = 0; k <= nPost; k++) {
    const x = -uw / 2 + (k / nPost) * uw;
    b.box(0.13, u, 0.1, x, g + u / 2, uz1 + 0.03, bc);
    b.box(0.13, u, 0.1, x, g + u / 2, uz0 - 0.03, bc);
  }
  for (const s of [-1, 1]) {
    for (let k = 0; k <= 3; k++) b.box(0.1, u, 0.13, s * (uw / 2 + 0.03), g + u / 2, uz0 + (k / 3) * (uz1 - uz0), bc);
    b.beam(s * (uw / 2 + 0.04), g + 0.1, uz0 + 0.1, s * (uw / 2 + 0.04), g + u - 0.1, uz0 + (uz1 - uz0) / 3, 0.09, bc);
  }
  // конзоли под еркера
  if (overhang > 0) for (let k = 0; k <= nPost; k += 1) {
    const x = -uw / 2 + (k / nPost) * uw;
    b.beam(x, g - 0.7, d / 2, x, g, uz1, 0.12, bc);
  }
  // прозорци на горния етаж
  const nWin = Math.max(2, Math.floor(w / 2.3));
  for (let k = 0; k < nWin; k++) {
    const x = -uw / 2 + ((k + 0.5) / nWin) * uw;
    b.push(x, 0, uz1, 0); glow.push(x, 0, uz1, 0);
    windowAt(b, glow, 0, g + u * 0.52, 0.02, isInn ? 0.8 : 0.7, isInn ? 1.1 : 0.95, shutter, 0.35 + rng.next() * 0.5);
    b.pop(); glow.pop();
  }
  b.push(0, 0, uz0, Math.PI); glow.push(0, 0, uz0, Math.PI);
  windowAt(b, glow, -w / 4, g + u * 0.52, 0.02, 0.6, 0.8, shutter, 0.4);
  windowAt(b, glow, w / 4, g + u * 0.52, 0.02, 0.6, 0.8, shutter, 0.6);
  b.pop(); glow.pop();
  for (const s of [-1, 1]) {
    if ((s === -1 && h.chardak === 'left') || (s === 1 && h.chardak === 'right')) continue;
    b.push(s * (uw / 2), 0, (uz0 + uz1) / 2, s * Math.PI / 2); glow.push(s * (uw / 2), 0, (uz0 + uz1) / 2, s * Math.PI / 2);
    windowAt(b, glow, 0, g + u * 0.52, 0.02, 0.6, 0.85, shutter, 0.3);
    b.pop(); glow.pop();
  }

  // чардак
  const cw = h.chardakW;
  let rx0 = -uw / 2, rx1 = uw / 2, rz0 = uz0, rz1 = uz1;
  const post = (x: number, z: number) => { b.box(0.18, g + u, 0.18, x, (g + u) / 2, z, PAL.wood); b.box(0.36, 0.2, 0.36, x, 0.1, z, PAL.stoneDark); };
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    b.beam(ax, g + 0.95, az, bx, g + 0.95, bz, 0.1, PAL.woodLight);
    b.beam(ax, g + 0.25, az, bx, g + 0.25, bz, 0.08, PAL.wood);
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 0.28);
    for (let k = 1; k < n; k++) { const t = k / n; b.box(0.05, 0.7, 0.05, ax + (bx - ax) * t, g + 0.6, az + (bz - az) * t, PAL.woodLight, 0, 0, 0, 0.1); }
  };
  if (h.chardak === 'front') {
    const z0 = d / 2, z1 = d / 2 + cw;
    b.box(w, 0.16, cw, 0, g, (z0 + z1) / 2, PAL.wood);
    for (const x of [-w / 2 + 0.1, -w / 6, w / 6, w / 2 - 0.1]) post(x, z1 - 0.1);
    rail(-w / 2 + 0.1, z1 - 0.1, w / 2 - 0.1, z1 - 0.1);
    rail(-w / 2 + 0.1, z0, -w / 2 + 0.1, z1 - 0.1); rail(w / 2 - 0.1, z0, w / 2 - 0.1, z1 - 0.1);
    rz1 = z1;
    // стълба от едната страна
    const sx = w / 2 + 0.6;
    for (let k = 0; k < 8; k++) b.box(0.9, 0.12, 0.34, sx, 0.15 + k * (g / 8), z1 - 0.4 - k * 0.32, PAL.woodLight);
    b.beam(sx + 0.45, 0.1, z1 - 0.2, sx + 0.45, g, z1 - 2.8, 0.1, PAL.wood);
  } else {
    const s = h.chardak === 'left' ? -1 : 1;
    const xin = s * w / 2, xout = s * (w / 2 + cw);
    b.box(cw, 0.16, uz1 - uz0, (xin + xout) / 2, g, (uz0 + uz1) / 2, PAL.wood);
    post(xout - s * 0.1, uz1 - 0.1); post(xout - s * 0.1, uz0 + 0.1); post(xout - s * 0.1, (uz0 + uz1) / 2);
    rail(xout - s * 0.1, uz0 + 0.1, xout - s * 0.1, uz1 - 0.1);
    rail(xin, uz1 - 0.1, xout - s * 0.1, uz1 - 0.1);
    if (s < 0) rx0 = xout; else rx1 = xout;
    // стълба отпред
    for (let k = 0; k < 8; k++) b.box(0.9, 0.12, 0.3, xout - s * 0.6, 0.15 + k * (g / 8), uz1 + 0.25 + (7 - k) * 0.28, PAL.woodLight);
    // под чардака: дървен склад/плет
    b.box(cw - 0.3, 1.0, 0.1, (xin + xout) / 2, 0.5, uz0 + 0.2, PAL.woodDark);
    // бяла стена на горния етаж откъм чардака с врата
    b.box(0.95, 1.9, 0.08, xin + s * 0.06, g + 0.95 + 0.1, (uz0 + uz1) / 2, PAL.wood, Math.PI / 2);
  }
  // покривът
  const eave = 0.85;
  const span = Math.min(rx1 - rx0, rz1 - rz0) + eave * 2;
  roof(b, rx0 - eave, rx1 + eave, rz0 - eave, rz1 + eave, g + u, span * 0.27, h.roof);
  // комини
  const chim = (x: number, z: number) => {
    const top = g + u + span * 0.27 + 0.9;
    b.box(0.62, top - g - u + 0.2, 0.62, x, (g + u + top) / 2, z, PAL.wall, 0, 0, 0, 0.03);
    b.box(0.8, 0.12, 0.8, x, top + 0.06, z, PAL.stoneDark);
    b.box(0.2, 0.3, 0.2, x - 0.22, top + 0.27, z, PAL.stoneDark); b.box(0.2, 0.3, 0.2, x + 0.22, top + 0.27, z, PAL.stoneDark);
    b.geo(new THREE.ConeGeometry(0.62, 0.38, 4), PAL.roof2, x, top + 0.6, z, 0, Math.PI / 4, 0);
  };
  chim(w * 0.22 * (rng.next() < 0.5 ? -1 : 1), -d * 0.12);
  if (isInn) chim(-w * 0.3, d * 0.1);
  b.pop(); glow.pop();
}

/** Всичко останало, което не е къща: по типа на Prop. */
export function buildProp(b: Batch, glow: Batch, p: Prop): void {
  const y = p.y ?? heightAt(p.x, p.z);
  const rng = new Rng(Math.floor(p.x * 73 + p.z * 197) >>> 0);
  const sc = p.type === 'cave' ? p.s : 1;
  b.push(p.x, y, p.z, p.rot, sc); glow.push(p.x, y, p.z, p.rot, sc);
  switch (p.type) {
    case 'walnut': {
      // огромно старо орехово дърво
      b.cyl(0.75, 1.1, 4.4, 9, 0, 2.2, 0, '#5a4636');
      b.cyl(1.4, 1.6, 0.5, 9, 0, 0.1, 0, '#5a4636');
      const limbs: V3[] = [[3.4, 6.4, 1.2], [-3.2, 6.8, 1.6], [0.8, 7.2, -3.4], [-1.2, 6.2, 3.6], [2.4, 7.8, -1.2]];
      for (const [x, yy, z] of limbs) b.beam(0, 3.9, 0, x, yy, z, 0.42, '#5a4636');
      const greens = ['#3f6b30', '#4f7a3a', '#46733a', '#5a8a3f'];
      const blobs: [number, number, number, number][] = [[0, 8.6, 0, 4.4], [3.8, 7.6, 1.4, 3.2], [-3.6, 7.9, 1.8, 3.3], [1.0, 8.2, -3.8, 3.2], [-1.4, 7.4, 3.9, 3.0], [2.8, 9.4, -1.6, 2.8], [-2.4, 9.6, -1.6, 2.7], [0.6, 10.4, 1.2, 2.6], [4.8, 6.6, -1.8, 2.2], [-4.6, 6.8, -1.0, 2.2]];
      blobs.forEach(([x, yy, z, r], i) => b.geo(lumpy(new THREE.IcosahedronGeometry(r, 1), 0.28, i + 3), greens[i % greens.length], x, yy, z, 0, i, 0, 1, 0.82, 1, 0.08));
      break;
    }
    case 'bench_ring': {
      const R = p.s, n = 10;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        const x = Math.sin((a + a1) / 2) * R, z = Math.cos((a + a1) / 2) * R, len = 2 * R * Math.sin(Math.PI / n) + 0.05;
        b.box(len, 0.08, 0.5, x, 0.48, z, PAL.woodLight, (a + a1) / 2);
        b.box(0.1, 0.45, 0.4, Math.sin(a) * R, 0.22, Math.cos(a) * R, PAL.wood, a);
      }
      break;
    }
    case 'fountain': {
      // чешма: каменна стена с арка, тръба, корито
      b.box(2.8, 2.0, 0.6, 0, 1.0, -0.3, PAL.stoneLight, 0, 0, 0, 0.05);
      b.geo(new THREE.CylinderGeometry(1.4, 1.4, 0.6, 12, 1, false, -Math.PI / 2, Math.PI), PAL.stoneLight, 0, 2.0, -0.3, -Math.PI / 2, 0, 0);
      roof(b, -1.75, 1.75, -0.85, 0.25, 3.25, 0.45, 'gable', PAL.roof, PAL.roof2, PAL.stoneLight);
      b.box(0.5, 0.5, 0.06, 0, 2.55, 0.01, PAL.stoneDark);
      b.box(1.0, 1.3, 0.05, 0, 1.6, 0.01, '#d8cfbe');
      b.cyl(0.06, 0.06, 0.5, 6, 0, 1.25, 0.25, '#6c6a64', Math.PI / 2 - 0.15);
      b.box(2.2, 0.6, 1.0, 0, 0.3, 0.75, PAL.stone);
      b.box(1.9, 0.05, 0.75, 0, 0.58, 0.75, '#4d7f8c', 0, 0, 0, 0);
      b.box(0.3, 0.12, 0.3, 0, 0.66, 0.6, '#6aa0ad', 0, 0, 0, 0);
      break;
    }
    case 'smithy': {
      // открит навес: задна каменна стена, странични полустени, стълбове, покрив; огнище с жар; наковалня
      b.box(7, 3.0, 0.6, 0, 1.5, -3, PAL.stone, 0, 0, 0, 0.05);
      b.box(0.5, 1.4, 5.6, -3.3, 0.7, -0.2, PAL.stone); b.box(0.5, 1.4, 2.4, 3.3, 0.7, -1.8, PAL.stone);
      for (const [x, z] of [[-3.3, 2.8], [3.3, 2.8], [-3.3, -0.2], [3.3, -0.2]]) b.box(0.24, 3.1, 0.24, x, 1.55, z, PAL.wood);
      b.box(7.2, 0.2, 0.2, 0, 3.05, 2.8, PAL.wood);
      roof(b, -4.2, 4.2, -3.8, 3.6, 3.15, 1.4, 'gable', '#7b5a3c', '#5a3b26', PAL.stone);
      // огнище
      b.box(2.0, 1.0, 1.6, -1.6, 0.5, -2.0, PAL.stoneDark);
      glow.box(1.4, 0.1, 1.0, -1.6, 1.02, -2.0, '#ff7a2a', 0, 0, 0, 0.3);
      for (let k = 0; k < 6; k++) glow.box(0.25, 0.12, 0.25, -2.1 + rng.next() * 1.0, 1.08, -2.3 + rng.next() * 0.6, '#ffb347', rng.next(), 0, 0, 0.2);
      b.box(1.2, 4.6, 1.0, -1.6, 3.3, -2.6, PAL.stone);
      b.box(0.9, 0.9, 0.7, -1.6, 5.9, -2.6, PAL.stoneDark);
      // мех
      b.box(0.8, 0.4, 1.2, -3.0, 0.9, -1.6, '#6b4a2f');
      // наковалня
      b.cyl(0.25, 0.32, 0.7, 8, 1.0, 0.35, 0.4, PAL.woodDark);
      b.box(0.9, 0.22, 0.32, 1.0, 0.82, 0.4, '#3a3a3c'); b.box(0.3, 0.16, 0.22, 1.5, 0.82, 0.4, '#3a3a3c');
      // корито с вода и сечива
      b.box(1.2, 0.5, 0.6, 2.4, 0.25, -2.2, PAL.wood); b.box(1.0, 0.03, 0.4, 2.4, 0.5, -2.2, '#3f6470', 0, 0, 0, 0);
      for (let k = 0; k < 4; k++) b.box(0.05, 0.8, 0.05, 1.8 + k * 0.3, 1.9, -2.66, '#4a4644');
      break;
    }
    case 'coop': {
      for (const [x, z] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) b.box(0.15, 0.6, 0.15, x, 0.3, z, PAL.wood);
      b.box(3.4, 1.6, 2.6, 0, 1.4, 0, '#8a6644', 0, 0, 0, 0.08);
      for (let k = 0; k < 6; k++) b.box(0.06, 1.6, 0.04, -1.5 + k * 0.6, 1.4, 1.31, PAL.wood);
      b.box(0.5, 0.6, 0.05, 0.8, 1.0, 1.32, '#2a1e16');
      b.box(0.5, 0.06, 1.6, 0.8, 0.3, 2.0, PAL.woodLight, 0, -0.42);
      roof(b, -2.0, 2.0, -1.6, 1.6, 2.2, 0.8, 'gable', '#7b5a3c', PAL.woodDark, '#8a6644');
      break;
    }
    case 'workshop': {
      for (const [x, z] of [[-2.9, -2], [2.9, -2], [-2.9, 2], [2.9, 2]]) b.box(0.2, 2.8, 0.2, x, 1.4, z, PAL.wood);
      b.box(6, 2.6, 0.12, 0, 1.3, -2.05, PAL.woodLight, 0, 0, 0, 0.12);
      roof(b, -3.5, 3.5, -2.6, 2.6, 2.85, 1.0, 'gable', '#7b5a3c', PAL.woodDark, PAL.woodLight);
      // тезгях
      b.box(2.6, 0.12, 0.9, -0.8, 0.95, -1.2, PAL.woodLight);
      for (const [x, z] of [[-2, -1.6], [0.4, -1.6], [-2, -0.8], [0.4, -0.8]]) b.box(0.1, 0.9, 0.1, x, 0.45, z, PAL.wood);
      b.box(0.5, 0.15, 0.25, -1.5, 1.08, -1.2, '#8a6a48');
      // недовършен лък (тайната на Калин) на стената
      b.geo(new THREE.TorusGeometry(0.75, 0.035, 4, 12, Math.PI * 0.8), '#6b4a2f', 1.6, 1.6, -1.95, 0, 0, Math.PI * 0.6);
      // стърготини
      b.box(1.4, 0.03, 1.0, 1.2, 0.02, 0.3, '#d9c08a', 0.4);
      break;
    }
    case 'logs': {
      for (let k = 0; k < 6; k++) {
        const row = k < 3 ? 0 : 1, i = row ? k - 3 : k;
        b.cyl(0.26, 0.26, 3.0, 7, (i - (row ? 0.5 : 1)) * 0.5, 0.26 + row * 0.44, 0, '#6e4d33', 0, 0, Math.PI / 2);
      }
      break;
    }
    case 'sawhorse': {
      for (const s of [-0.6, 0.6]) { b.beam(s, 0, -0.3, s, 0.8, 0, 0.08, PAL.wood); b.beam(s, 0, 0.3, s, 0.8, 0, 0.08, PAL.wood); }
      b.box(1.5, 0.1, 0.1, 0, 0.8, 0, PAL.wood);
      b.cyl(0.2, 0.2, 2.2, 7, 0, 1.0, 0, '#7a5434', 0, 0, Math.PI / 2);
      break;
    }
    case 'loom': {
      // стан под малък навес
      for (const [x, z] of [[-1.4, -1.2], [1.4, -1.2], [-1.4, 1.2], [1.4, 1.2]]) b.box(0.14, 2.4, 0.14, x, 1.2, z, PAL.wood);
      roof(b, -1.8, 1.8, -1.6, 1.6, 2.4, 0.7, 'gable', '#8a6a48', PAL.woodDark, PAL.woodLight);
      for (const x of [-0.9, 0.9]) { b.box(0.1, 1.5, 0.1, x, 0.75, -0.4, PAL.woodLight); b.box(0.1, 0.9, 0.1, x, 0.45, 0.4, PAL.woodLight); }
      b.box(1.9, 0.1, 0.1, 0, 1.45, -0.4, PAL.woodLight); b.box(1.9, 0.1, 0.1, 0, 0.85, 0.4, PAL.woodLight);
      // тъканта: червено-черни шевици
      const cols = [PAL.red, '#f2ead8', '#1f1a18', PAL.red, '#f2ead8'];
      for (let k = 0; k < 10; k++) b.box(1.7, 0.06, 0.02, 0, 0.95 + k * 0.05, -0.4 + (k * 0.05) * 0, cols[k % cols.length], 0, -0.9, 0, 0);
      b.box(1.7, 0.5, 0.02, 0, 1.15, 0.0, '#e8dcc4', 0, -0.95);
      b.box(0.8, 0.08, 0.5, 0, 0.45, 0.9, PAL.wood);
      break;
    }
    case 'table': {
      b.box(1.6, 0.08, 0.9, 0, 0.78, 0, PAL.woodLight);
      for (const [x, z] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) b.box(0.08, 0.76, 0.08, x, 0.38, z, PAL.wood);
      for (const s of [-1, 1]) { b.box(1.6, 0.07, 0.3, 0, 0.45, s * 0.8, PAL.woodLight); b.box(0.07, 0.44, 0.25, -0.65, 0.22, s * 0.8, PAL.wood); b.box(0.07, 0.44, 0.25, 0.65, 0.22, s * 0.8, PAL.wood); }
      // паница и чайник (ханът — храна и чай)
      b.cyl(0.18, 0.12, 0.08, 8, -0.3, 0.86, 0, '#c9a77a');
      b.cyl(0.11, 0.13, 0.18, 8, 0.35, 0.91, 0.1, '#8a5a3a');
      break;
    }
    case 'barrels': case 'crates': {
      if (p.type === 'barrels') for (let k = 0; k < 3; k++) {
        const x = (k - 1) * 0.65, z = (k % 2) * 0.4;
        b.cyl(0.3, 0.27, 0.85, 9, x, 0.43, z, '#6e4a2e');
        b.cyl(0.31, 0.31, 0.05, 9, x, 0.2, z, '#3a3430', 0, 0, 0, 0); b.cyl(0.31, 0.31, 0.05, 9, x, 0.66, z, '#3a3430', 0, 0, 0, 0);
      } else for (let k = 0; k < 3; k++) {
        const s = 0.55 + (k % 2) * 0.15;
        b.box(s, s, s, (k - 1) * 0.7, s / 2 + (k === 2 ? 0 : 0), (k % 2) * 0.3, '#9a7a52', rng.next());
        b.box(s + 0.02, 0.06, s + 0.02, (k - 1) * 0.7, s * 0.8, (k % 2) * 0.3, '#6e5236', 0);
      }
      break;
    }
    case 'haystack': {
      const s = p.s;
      b.geo(lumpy(new THREE.SphereGeometry(1.4, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), 0.15, rng.int(1, 99)), '#d2b05a', 0, 0, 0, 0, 0, 0, s, s * 1.6, s, 0.1);
      b.cyl(1.35 * s, 1.45 * s, 0.6 * s, 9, 0, 0.3 * s, 0, '#c4a24e');
      b.cyl(0.05, 0.05, 1.0, 5, 0, 2.3 * s, 0, PAL.wood);
      break;
    }
    case 'woodpile': {
      b.box(0.9, 0.1, 2.2, 0, 0.05, 0, PAL.woodDark);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) b.cyl(0.11, 0.11, 0.85, 6, 0, 0.18 + r * 0.21, -0.95 + k * 0.38 + (r % 2) * 0.1, k % 3 ? '#8a6a48' : '#a8865a', Math.PI / 2, 0, 0, 0.15);
      b.box(1.1, 0.06, 2.4, 0, 1.12, 0, PAL.woodDark, 0, 0, 0.1);
      break;
    }
    case 'cart': {
      b.box(2.4, 0.5, 1.3, 0, 0.95, 0, '#8a6644');
      b.box(2.5, 0.08, 1.4, 0, 0.7, 0, PAL.wood);
      for (const s of [-0.75, 0.75]) b.geo(new THREE.TorusGeometry(0.5, 0.07, 4, 10), PAL.woodDark, 0.2, 0.55, s, 0, 0, 0);
      b.beam(1.2, 0.8, -0.4, 2.8, 0.4, -0.3, 0.08, PAL.wood); b.beam(1.2, 0.8, 0.4, 2.8, 0.4, 0.3, 0.08, PAL.wood);
      b.box(1.6, 0.4, 0.9, -0.2, 1.3, 0, '#d2b05a', 0.1);
      break;
    }
    case 'scarecrow': {
      b.box(0.08, 2.0, 0.08, 0, 1.0, 0, PAL.wood); b.box(1.5, 0.08, 0.08, 0, 1.55, 0, PAL.wood);
      b.box(0.5, 0.7, 0.3, 0, 1.4, 0, '#efe6d4'); b.box(0.52, 0.12, 0.32, 0, 1.12, 0, PAL.red);
      b.geo(new THREE.SphereGeometry(0.2, 6, 5), '#d8c49a', 0, 2.05, 0);
      b.geo(new THREE.ConeGeometry(0.35, 0.3, 7), '#3a2a1c', 0, 2.28, 0);
      break;
    }
    case 'field': {
      const w = Math.floor((p.extra ?? 2420) / 100), d = (p.extra ?? 2420) % 100;
      // редове с жито/царевица: ниски зелено-златни купчинки по редовете
      for (let r = -d / 2 + 1.2; r < d / 2 - 0.6; r += 1.2) for (let x = -w / 2 + 0.8; x < w / 2 - 0.5; x += 1.6) {
        const hgt = 0.5 + rng.next() * 0.35;
        b.box(1.3, hgt, 0.45, x, hgt / 2, r, rng.next() < 0.5 ? '#b9a64e' : '#9ba548', 0, 0, 0, 0.12);
      }
      break;
    }
    case 'fold_shed': {
      for (const [x, z] of [[-2.4, 1.2], [2.4, 1.2]]) b.box(0.18, 2.0, 0.18, x, 1.0, z, PAL.wood);
      b.box(5, 2.0, 0.15, 0, 1.0, -1.25, PAL.woodLight, 0, 0, 0, 0.12);
      b.box(0.15, 2.0, 2.5, -2.45, 1.0, 0, PAL.woodLight); b.box(0.15, 2.0, 2.5, 2.45, 1.0, 0, PAL.woodLight);
      roof(b, -2.9, 2.9, -1.7, 1.7, 2.0, 0.6, 'gable', '#7b5a3c', PAL.woodDark, PAL.woodLight);
      break;
    }
    case 'inn_sign': {
      b.box(0.14, 3.0, 0.14, 0, 1.5, 0, PAL.wood);
      b.box(1.4, 0.1, 0.1, 0.62, 2.9, 0, PAL.wood);
      b.beam(0, 2.4, 0, 0.6, 2.9, 0, 0.07, PAL.wood);
      break;
    }
    case 'bridge': {
      // каменен мост с арка; повърхността следва bridgeDeckHeight (в height.ts)
      buildBridge(b);
      break;
    }
    case 'tower': {
      const hgt = 7 + (p.extra ?? 0.5) * 4;
      b.cyl(3.0, 3.3, hgt, 10, 0, hgt / 2 - 1, 0, PAL.stone, 0, 0, 0, 0.08);
      for (let k = 0; k < 10; k++) {
        if (rng.next() < 0.4) continue;
        const a = (k / 10) * Math.PI * 2, hh = 0.6 + rng.next() * 2.2;
        b.box(1.6, hh, 0.9, Math.sin(a) * 2.7, hgt - 1 + hh / 2, Math.cos(a) * 2.7, PAL.stone, a);
      }
      for (let k = 0; k < 3; k++) { const a = rng.next() * 6.28; b.box(0.25, 1.0, 0.3, Math.sin(a) * 3.2, 3 + k * 1.8, Math.cos(a) * 3.2, '#2a2622', a); }
      b.geo(lumpy(new THREE.DodecahedronGeometry(1.4, 0), 0.4, 3), PAL.stoneDark, 3.5, 0.3, 1.5, 0, 0, 0, 1, 0.5, 1);
      break;
    }
    case 'rubble': {
      b.geo(lumpy(new THREE.DodecahedronGeometry(0.8, 0), 0.4, rng.int(1, 99)), PAL.stone, 0, 0.2, 0, 0, 0, 0, p.s * 1.3, p.s * 0.6, p.s);
      break;
    }
    case 'cave': {
      // скален масив с тъмен отвор (лицето на отвора е към +z): две колони, праг отгоре, маса отзад
      const rocks: [number, number, number, number, number][] = [
        [-6.6, 2.2, -1.6, 3.2, 1], [6.7, 2.0, -1.8, 3.3, 1], [0, 8.6, -2.6, 4.4, 0.7], [0, 5.5, -9, 7.5, 1],
        [-8.8, 1.2, -1.5, 3.0, 1], [8.6, 1.5, -2, 3.2, 1], [-4.5, 9.5, -4, 4.4, 1], [4.8, 9.8, -4.5, 4.6, 1], [0, 12, -8, 5.5, 1],
      ];
      rocks.forEach(([x, yy, z, r, sy], i) => b.geo(lumpy(new THREE.DodecahedronGeometry(r, 1), 0.28, i + 7), i % 3 === 1 ? PAL.rockDark : i % 3 === 2 ? '#6e675d' : PAL.rock, x, yy - 1.2, z, 0, i * 1.3, 0, 1, sy, 1, 0.1));
      // самият отвор: тъмна арка с дълбочина
      b.geo(new THREE.CylinderGeometry(3.4, 3.4, 5.0, 16, 1, false, -Math.PI / 2, Math.PI), '#070605', 0, 0.0, -2.4, -Math.PI / 2, 0, 0, 1, 1, 1.25, 0);
      b.box(6.8, 0.25, 5.0, 0, -0.05, -2.4, '#120f0d', 0, 0, 0, 0);
      // опушено около входа
      for (let k = 0; k < 7; k++) b.geo(lumpy(new THREE.DodecahedronGeometry(0.8, 0), 0.4, k + 30), '#2e2824', (k - 3) * 1.4, 0.05, 0.8 + rng.next() * 1.4, 0, k, 0, 1, 0.45, 1);
      break;
    }
    case 'bones': {
      for (let k = 0; k < 3; k++) {
        const a = rng.next() * 6.28, l = 0.5 + rng.next() * 0.6;
        b.cyl(0.05, 0.05, l * p.s, 5, (rng.next() - 0.5) * 0.6, 0.06, (rng.next() - 0.5) * 0.6, '#e6dcc4', Math.PI / 2, a, 0, 0.1);
      }
      break;
    }
    case 'skull': {
      b.geo(new THREE.IcosahedronGeometry(0.28 * p.s, 0), '#e6dcc4', 0, 0.2 * p.s, 0, 0, 0, 0, 1, 0.85, 1.1);
      b.box(0.08, 0.06, 0.04, -0.09, 0.24 * p.s, 0.29 * p.s, '#2a2420'); b.box(0.08, 0.06, 0.04, 0.09, 0.24 * p.s, 0.29 * p.s, '#2a2420');
      // рога (стар бик — плячка на Ламята)
      b.cyl(0.02, 0.07, 0.5, 5, -0.32 * p.s, 0.32 * p.s, 0, '#d8ccb2', 0, 0, 1.0);
      b.cyl(0.02, 0.07, 0.5, 5, 0.32 * p.s, 0.32 * p.s, 0, '#d8ccb2', 0, 0, -1.0);
      break;
    }
    case 'spring': {
      // пресъхналият извор: каменна чешма-извор, напукано дъно
      b.box(3.2, 1.6, 0.8, 0, 0.6, -1.4, PAL.stone, 0, 0, 0, 0.06);
      b.cyl(0.1, 0.1, 0.6, 6, 0, 1.0, -0.9, '#5e5a52', Math.PI / 2);
      for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; b.geo(lumpy(new THREE.DodecahedronGeometry(0.45, 0), 0.4, k + 50), PAL.stoneDark, Math.sin(a) * 1.9, 0.1, Math.cos(a) * 1.6, 0, k, 0, 1, 0.6, 1); }
      b.cyl(1.8, 1.8, 0.05, 12, 0, 0.02, 0, '#7a6a52', 0, 0, 0, 0.1);
      break;
    }
    case 'dance_ring': {
      // венец от бели цветя в кръг
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2, r = p.s + (rng.next() - 0.5) * 0.3;
        b.geo(new THREE.IcosahedronGeometry(0.12, 0), k % 3 ? '#f6f2ea' : '#f3d35a', Math.sin(a) * r, 0.18, Math.cos(a) * r);
        b.cyl(0.01, 0.01, 0.18, 3, Math.sin(a) * r, 0.09, Math.cos(a) * r, '#4f7a3a');
      }
      break;
    }
  }
  b.pop(); glow.pop();
}

function buildBridge(b: Batch): void {
  // работим в световни координати (височините идват от bridgeDeckHeight)
  b.pop(); b.push(0, 0, 0, 0);
  const { x0, x1, z, halfW } = BRIDGE;
  const n = 26;
  const bed = terrainHeight((x0 + x1) / 2, z) - 0.6;
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n, xm = (xa + xb) / 2;
    const top = bridgeDeckHeight(xm, z)!;
    // свод: под средата е празно (арка), отстрани — плътно
    const u = (xm - (x0 + x1) / 2) / 7.5;
    const archTop = Math.abs(u) < 1 ? bed + Math.sqrt(1 - u * u) * 4.6 : -Infinity;
    const bottom = archTop > -Infinity ? archTop : Math.min(terrainHeight(xm, z), top) - 1.2;
    const h = top - bottom;
    if (h > 0.05) b.box(xb - xa + 0.02, h, halfW * 2, xm, bottom + h / 2, z, i % 2 ? PAL.stone : '#a49c8e', 0, 0, 0, 0.05);
    // настилка
    b.box(xb - xa + 0.02, 0.08, halfW * 2 - 0.2, xm, top + 0.02, z, '#8f877a', 0, 0, 0, 0.08);
    // парапети
    for (const s of [-1, 1]) b.box(xb - xa + 0.03, 0.75, 0.38, xm, top + 0.35, z + s * (halfW + 0.05), '#b0a898', 0, 0, 0, 0.06);
  }
  // каменни блокове по свода
  for (let k = 0; k <= 12; k++) {
    const a = Math.PI * (k / 12), x = (x0 + x1) / 2 - Math.cos(a) * 7.5, yy = bed + Math.sin(a) * 4.6;
    for (const s of [-1, 1]) b.box(0.7, 0.5, 0.12, x, yy, z + s * (halfW + 0.02), PAL.stoneDark, 0, 0, a - Math.PI / 2);
  }
}
