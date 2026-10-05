// Огради (дъсчени, плет, сух каменен зид), руините на крепостта, табелите: дъските са истинско дърво (Kit),
// а надписите са боядисани букви върху тях (прозрачен атлас от canvas).
import * as THREE from 'three';
import type { Kit, V3 } from './arch/kit';
import { heightAt } from './height';
import type { FenceRun, WorldPlan } from './plan';
import { Rng } from '../core/rng';
import { lumpy } from './geom';

const WOOD = '#9a7c66', PLANK = '#d2c4b4';

export function buildFences(k: Kit, fences: FenceRun[]): void {
  const rng = new Rng(5);
  for (const f of fences) {
    if (f.type === 'wattle') { wattle(k, f, rng); continue; }
    for (let i = 0; i < f.pts.length - 1; i++) {
      const [ax, az] = f.pts[i], [bx, bz] = f.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az); if (len < 0.05) continue;
      const ang = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const ya = heightAt(ax, az), yb = heightAt(bx, bz), ym = Math.min(ya, yb);
      if (f.type === 'wall') {
        // нисък сух каменен зид: по-широк долу, плочи отгоре, тук-там изпъкнал камък
        k.box('stone', 0.8, f.h * 0.55, len + 0.08, mx, ym + f.h * 0.275 - 0.15, mz, { ry: ang, tint: '#ece6dc', grain: 1, cell: 0.7, stain: 0.3, tile: [1.6, 1.6], jitter: 0.04 });
        k.box('stone', 0.68, f.h * 0.5, len + 0.06, mx, ym + f.h * 0.75 - 0.15, mz, { ry: ang, tint: '#e4ded4', grain: 1, cell: 0.7, stain: 0.3, tile: [1.6, 1.6], jitter: 0.04 });
        const n = Math.max(1, Math.round(len / 0.5));
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          k.box('rock', 0.5 + rng.next() * 0.35, 0.1 + rng.next() * 0.06, len / n + 0.12, x, ym + f.h - 0.08 + rng.next() * 0.04, z, { ry: ang + (rng.next() - 0.5) * 0.25, rz: (rng.next() - 0.5) * 0.12, tint: '#d4cec4', bevel: 0.03, jitter: 0.12 });
        }
        if (rng.next() < 0.5) k.geo('rock', lumpy(new THREE.DodecahedronGeometry(0.22, 0), 0.4, i + 3), mx + Math.cos(ang) * 0.38, ym + f.h * 0.35, mz - Math.sin(ang) * 0.38, { tint: '#c8c0b4', sy: 0.7, flat: true });
      } else {
        // дъсчена ограда: стълбове, две напречни летви, наковани дъски
        const lean = (rng.next() - 0.5) * 0.06;
        k.box('timber', 0.12, f.h + 0.35, 0.12, ax, ya + (f.h + 0.35) / 2 - 0.2, az, { ry: ang, rx: lean, tint: WOOD, bevel: 0.015 });
        for (const hh of [0.3, 0.82]) k.beam('timber', ax, ya + hh, az, bx, yb + hh, bz, 0.06, 0.09, { tint: '#8a6c58', bevel: 0.008 });
        const n = Math.max(1, Math.round(len / 0.17));
        const px = Math.cos(ang) * 0.06, pz = -Math.sin(ang) * 0.06; // дъските са от външната страна на летвите
        for (let j = 0; j < n; j++) {
          if (rng.next() < 0.04) continue; // паднала дъска
          const t = (j + 0.5) / n, hgt = f.h * (0.88 + rng.next() * 0.12);
          const yy = ya + (yb - ya) * t;
          k.box('planks', 0.12, hgt, 0.022, ax + (bx - ax) * t + px, yy + hgt / 2 - 0.04, az + (bz - az) * t + pz, { ry: ang + Math.PI / 2, rz: (rng.next() - 0.5) * 0.05, tint: rng.next() < 0.3 ? '#b8a898' : PLANK, grain: 1, tile: [1.2, 1.9], jitter: 0.1 });
        }
      }
    }
    if (f.type === 'fence') { const [lx, lz] = f.pts[f.pts.length - 1]; k.box('timber', 0.12, f.h + 0.35, 0.12, lx, heightAt(lx, lz) + (f.h + 0.35) / 2 - 0.2, lz, { tint: WOOD, bevel: 0.015 }); }
  }
}

/** Плет: колове през ~0.4 м и пръти, които се вият навътре-навън между тях. */
function wattle(k: Kit, f: FenceRun, rng: Rng): void {
  // точките по цялата линия, на равни разстояния
  const stakes: [number, number, number, number, number][] = []; // x, z, y, nx, nz
  for (let i = 0; i < f.pts.length - 1; i++) {
    const [ax, az] = f.pts[i], [bx, bz] = f.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.05) continue;
    const n = Math.max(1, Math.round(len / 0.42));
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let j = 0; j < n; j++) { const t = j / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; stakes.push([x, z, heightAt(x, z), nx, nz]); }
  }
  const [lx, lz] = f.pts[f.pts.length - 1];
  if (stakes.length) { const s = stakes[stakes.length - 1]; stakes.push([lx, lz, heightAt(lx, lz), s[3], s[4]]); }
  if (stakes.length < 2) return;
  stakes.forEach(([x, z, y], i) => {
    const hgt = f.h + 0.2 + rng.next() * 0.15;
    k.cyl('bark', 0.035, 0.045, hgt, 5, x, y + hgt / 2 - 0.1, z, { rx: (rng.next() - 0.5) * 0.08, rz: (rng.next() - 0.5) * 0.08, tint: '#b8a898', caps: i % 2 === 0 });
  });
  const rows = Math.round(f.h / 0.1);
  for (let r = 0; r < rows; r++) {
    const pts: V3[] = [];
    stakes.forEach(([x, z, y, nx, nz], i) => {
      const o = ((i + r) % 2 ? 1 : -1) * 0.045;
      pts.push([x + nx * o, y + 0.12 + r * 0.1 + (rng.next() - 0.5) * 0.02, z + nz * o]);
      // междинна точка — прътът е гладък между коловете
      const nb = stakes[i + 1];
      if (nb) pts.push([(x + nb[0]) / 2, (y + nb[2]) / 2 + 0.12 + r * 0.1, (z + nb[1]) / 2]);
    });
    k.tube('bark', pts, 0.02, 4, { tint: r % 3 === 0 ? '#a89480' : '#c4b29c', tile: [0.4, 1.6] });
  }
}

export function buildRuins(k: Kit, ruins: WorldPlan['ruins']): void {
  const rng = new Rng(9);
  for (const [ax, az, bx, bz, h] of ruins) {
    const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az);
    const n = Math.max(2, Math.round(len / 1.1));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = heightAt(x, z);
      const hh = Math.max(0.6, h * (0.6 + rng.next() * 0.5) - (j === 0 || j === n - 1 ? 0.8 : 0));
      k.box('masonry', 1.5, hh + 0.6, len / n + 0.05, x, y + hh / 2 - 0.3, z, { ry: ang, tint: '#ece6dc', grain: 1, cell: 0.8, stain: 0.35, jitter: 0.05 });
      // изронен връх: по-малки блокове отгоре
      if (rng.next() < 0.6) k.box('masonry', 0.9 + rng.next() * 0.4, 0.3 + rng.next() * 0.4, len / n * (0.4 + rng.next() * 0.5), x + (rng.next() - 0.5) * 0.3, y + hh + 0.1, z, { ry: ang + (rng.next() - 0.5) * 0.2, tint: '#e2dcd2', bevel: 0.05 });
      if (rng.next() < 0.35) k.geo('rock', lumpy(new THREE.DodecahedronGeometry(0.35 + rng.next() * 0.25, 0), 0.4, j + 11), x + Math.cos(ang) * (1.1 + rng.next()), y + 0.1, z - Math.sin(ang) * (1.1 + rng.next()), { tint: '#cfc8bc', sy: 0.6, flat: true, ry: rng.next() * 6 });
    }
  }
}

// ---------------------------------------------------------------- табелите
const BOARD_H = 0.34, BOARD_W = 1.5, TIP = 0.25;
interface Board { text: string; x: number; y: number; z: number; rot: number; w: number; h: number; arrow: boolean }
function boardsOf(plan: WorldPlan, innSign: { x: number; z: number; rot: number } | null): Board[] {
  const out: Board[] = [];
  for (const s of plan.signs) {
    const y = heightAt(s.x, s.z);
    s.boards.forEach((bd, i) => {
      // дъската сочи по посоката bd.dir (световен ъгъл като rotation.y): локалното +x трябва да гледа натам
      out.push({ text: bd.text, x: s.x + Math.sin(bd.dir) * 0.75, y: y + 2.3 - i * 0.42, z: s.z + Math.cos(bd.dir) * 0.75, rot: bd.dir - Math.PI / 2, w: BOARD_W, h: BOARD_H, arrow: true });
    });
  }
  if (innSign) {
    const y = heightAt(innSign.x, innSign.z), cs = Math.cos(innSign.rot), sn = Math.sin(innSign.rot);
    out.push({ text: 'ХАН', x: innSign.x + 0.62 * cs, y: y + 2.42, z: innSign.z - 0.62 * sn, rot: innSign.rot, w: 1.1, h: 0.55, arrow: false });
  }
  return out;
}

/** Атлас с боядисаните букви (прозрачен фон) + лицата на табелите като една мрежа. */
export function buildSigns(plan: WorldPlan, innSign: { x: number; z: number; rot: number } | null): THREE.Mesh {
  const boards = boardsOf(plan, innSign);
  // всеки надпис — в свой ред на атласа, със същите пропорции като дъската (иначе буквите се разтягат)
  const key = (b: Board) => `${b.text}|${b.w}|${b.h}`;
  const uniq = new Map<string, Board>();
  for (const b of boards) if (!uniq.has(key(b))) uniq.set(key(b), b);
  const W = 512;
  const rows = [...uniq.values()].map((b) => ({ b, h: Math.round((W * (b.h - 0.04)) / (b.w - 0.08)) }));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = THREE.MathUtils.ceilPowerOfTwo(Math.max(256, rows.reduce((a, r) => a + r.h, 0)));
  const ctx = cv.getContext('2d')!;
  const uvOf = new Map<string, [number, number, number, number]>();
  let y = 0;
  rows.forEach(({ b, h: rowH }, i) => {
    const t = b.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fs = Math.round(rowH * 0.62); const font = () => `bold ${fs}px "Ruslan Display", "Philosopher", Georgia, serif`;
    ctx.font = font();
    while (ctx.measureText(t).width > W - 44 && fs > 10) { fs -= 2; ctx.font = font(); }
    // изрязано в дървото (тъмна сянка), после боядисано с вар
    ctx.fillStyle = 'rgba(28,18,10,0.85)'; ctx.fillText(t, W / 2 + 2, y + rowH / 2 + 4);
    ctx.fillStyle = '#efe4cc'; ctx.fillText(t, W / 2, y + rowH / 2 + 2);
    // изтъркана боя: малки драскотини
    ctx.globalCompositeOperation = 'destination-out';
    const r = new Rng(i + 17);
    for (let k = 0; k < 90; k++) { ctx.fillStyle = `rgba(0,0,0,${0.25 + r.next() * 0.5})`; ctx.fillRect(r.next() * W, y + r.next() * rowH, 1 + r.next() * 5, 1 + r.next() * 1.5); }
    ctx.globalCompositeOperation = 'source-over';
    uvOf.set(key(b), [0, 1 - (y + rowH) / cv.height, 1, 1 - y / cv.height]);
    y += rowH;
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const b of boards) {
    const r = uvOf.get(key(b))!;
    m4.makeRotationY(b.rot).setPosition(b.x, b.y, b.z); nm.getNormalMatrix(m4);
    // двете лица (към +z и към -z), малко пред дъската
    const quads: [number, number[], number[]][] = [[0.033, [0, 0, 1], [r[0], r[2]]], [-0.033, [0, 0, -1], [r[2], r[0]]]];
    for (const [dz, n, [u0, u1]] of quads) {
      const w = b.w - 0.08, h = b.h - 0.04;
      const P = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      const U = (px: number) => u0 + ((px + w / 2) / w) * (u1 - u0), Vv = (py: number) => r[1] + ((py + h / 2) / h) * (r[3] - r[1]);
      const triIdx = dz > 0 ? [[0, 1, 2], [0, 2, 3]] : [[0, 2, 1], [0, 3, 2]];
      for (const t of triIdx) for (const i of t) {
        v.set(P[i][0], P[i][1], dz).applyMatrix4(m4); pos.push(v.x, v.y, v.z);
        const nn = new THREE.Vector3(...n).applyMatrix3(nm).normalize(); nor.push(nn.x, nn.y, nn.z);
        uv.push(U(P[i][0]), Vv(P[i][1]));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = 'signs';
  return mesh;
}

/** Стълбовете и дъските на табелите (истинско дърво), в общата партида. */
export function buildSignPosts(k: (x: number, z: number) => Kit, plan: WorldPlan, innSign: { x: number; z: number; rot: number } | null): void {
  for (const s of plan.signs) {
    const kk = k(s.x, s.z), y = heightAt(s.x, s.z);
    kk.box('rock', 0.38, 0.22, 0.38, s.x, y + 0.04, s.z, { tint: '#d8d1c4', bevel: 0.03 });
    kk.box('timber', 0.16, 2.75, 0.16, s.x, y + 1.42, s.z, { tint: WOOD, bevel: 0.02 });
    kk.cyl('planks', 0.0, 0.17, 0.16, 4, s.x, y + 2.87, s.z, { ry: Math.PI / 4, tint: '#9c8672' });
  }
  for (const b of boardsOf(plan, innSign)) {
    const kk = k(b.x, b.z);
    kk.push(b.x, b.y, b.z, b.rot);
    const w = b.w, h = b.h;
    const poly: [number, number][] = b.arrow
      ? [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2 + TIP, 0], [w / 2, h / 2], [-w / 2, h / 2]]
      : [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    kk.prism('planks', poly, 0.06, 0, 0, 0, { tint: '#8a705a', grain: 0, tile: [1.2, 1.9] });
    if (b.arrow) kk.box('iron', 0.05, 0.05, 0.08, -w / 2 + 0.12, 0, 0, { tint: '#2c2826', jitter: 0 });
    kk.pop();
  }
}
