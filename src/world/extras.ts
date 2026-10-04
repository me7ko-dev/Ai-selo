// Огради, зидове, руините на крепостта, табелите (текст от canvas атлас).
import * as THREE from 'three';
import { Batch } from './geom';
import { PAL } from './palette';
import { heightAt } from './height';
import type { FenceRun, WorldPlan } from './plan';
import { Rng } from '../core/rng';

export function buildFences(b: Batch, fences: FenceRun[]): void {
  const rng = new Rng(5);
  for (const f of fences) {
    for (let i = 0; i < f.pts.length - 1; i++) {
      const [ax, az] = f.pts[i], [bx, bz] = f.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az); if (len < 0.05) continue;
      const ang = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const ya = heightAt(ax, az), yb = heightAt(bx, bz), ym = Math.min(ya, yb);
      if (f.type === 'wall') {
        // нисък сух каменен зид: блокове с различен цвят
        b.box(0.75, f.h, len + 0.1, mx, ym + f.h / 2 - 0.15, mz, rng.next() < 0.5 ? PAL.stone : '#8f887c', ang, 0, 0, 0.05);
        b.box(0.85, 0.16, len + 0.12, mx, ym + f.h - 0.1, mz, PAL.stoneLight, ang, 0, 0, 0.05);
        if (rng.next() < 0.5) b.box(0.4, 0.25, 0.5, mx + (rng.next() - 0.5) * 0.2, ym + f.h * 0.4, mz, STONE_VAR[i % 3], ang, 0, 0, 0.1);
      } else if (f.type === 'fence') {
        b.box(0.12, f.h + 0.3, 0.12, ax, ya + (f.h + 0.3) / 2 - 0.2, az, PAL.wood, ang);
        for (const hh of [0.45, 0.85]) b.beam(ax, ya + hh, az, bx, yb + hh, bz, 0.07, PAL.woodLight);
        // летви
        const n = Math.max(1, Math.round(len / 0.5));
        for (let k = 1; k < n; k += 2) { const t = k / n; b.box(0.09, f.h * 0.9, 0.04, ax + (bx - ax) * t, ya + (yb - ya) * t + f.h * 0.45 - 0.05, az + (bz - az) * t, '#6e5034', ang + Math.PI / 2, 0, 0, 0.15); }
      } else {
        // плет: колове + плетени пръти
        b.box(0.1, f.h + 0.25, 0.1, ax, ya + (f.h + 0.25) / 2 - 0.15, az, PAL.woodDark, ang);
        for (let k = 0; k < 4; k++) b.beam(ax, ya + 0.2 + k * 0.25, az, bx, yb + 0.2 + k * 0.25, bz, 0.08, k % 2 ? '#7a6040' : '#8a6e4a');
      }
    }
    const [lx, lz] = f.pts[f.pts.length - 1];
    if (f.type !== 'wall') b.box(0.12, f.h + 0.3, 0.12, lx, heightAt(lx, lz) + (f.h + 0.3) / 2 - 0.2, lz, PAL.wood);
  }
}
const STONE_VAR = ['#a69e90', '#7f786d', '#b0a898'];

export function buildRuins(b: Batch, ruins: WorldPlan['ruins']): void {
  const rng = new Rng(9);
  for (const [ax, az, bx, bz, h] of ruins) {
    const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az);
    const n = Math.max(2, Math.round(len / 1.1));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = heightAt(x, z);
      const hh = Math.max(0.6, h * (0.6 + rng.next() * 0.5) - (k === 0 || k === n - 1 ? 0.8 : 0));
      b.box(1.5, hh + 0.6, len / n + 0.05, x, y + hh / 2 - 0.3, z, rng.next() < 0.5 ? PAL.stone : '#8f887c', ang, 0, 0, 0.06);
      if (rng.next() < 0.4) b.box(0.7, 0.4, 0.6, x + (rng.next() - 0.5) * 0.4, y + hh + 0.1, z, PAL.stoneLight, ang + rng.next(), 0, 0, 0.1);
    }
  }
}

/** Атлас с надписите + дъските на табелите като една мрежа. */
export function buildSigns(plan: WorldPlan, innSign: { x: number; z: number; rot: number } | null): THREE.Mesh {
  const texts = new Set<string>(['ХАН']);
  for (const s of plan.signs) for (const bd of s.boards) texts.add(bd.text);
  const list = [...texts];
  const W = 1024, rowH = 96, cv = document.createElement('canvas');
  cv.width = W; cv.height = Math.max(256, THREE.MathUtils.ceilPowerOfTwo(list.length * rowH));
  const ctx = cv.getContext('2d')!;
  const uvOf = new Map<string, [number, number, number, number]>();
  list.forEach((t, i) => {
    const y = i * rowH;
    // дъска
    const gr = ctx.createLinearGradient(0, y, 0, y + rowH);
    gr.addColorStop(0, '#8a6440'); gr.addColorStop(0.5, '#7a5634'); gr.addColorStop(1, '#5e3f24');
    ctx.fillStyle = gr; ctx.fillRect(0, y, W, rowH);
    ctx.strokeStyle = 'rgba(40,24,12,0.35)'; ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(0, y + 10 + k * 15 + Math.sin(k) * 3); ctx.bezierCurveTo(W * 0.3, y + 14 + k * 15, W * 0.6, y + 6 + k * 15, W, y + 12 + k * 15); ctx.stroke(); }
    ctx.strokeStyle = '#3e281a'; ctx.lineWidth = 6; ctx.strokeRect(3, y + 3, W - 6, rowH - 6);
    ctx.fillStyle = '#f3ead7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fs = 64; ctx.font = `bold ${fs}px "Ruslan Display", "Philosopher", Georgia, serif`;
    while (ctx.measureText(t).width > W - 60 && fs > 20) { fs -= 4; ctx.font = `bold ${fs}px "Ruslan Display", "Philosopher", Georgia, serif`; }
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
    ctx.fillText(t, W / 2, y + rowH / 2 + 3);
    ctx.shadowBlur = 0;
    uvOf.set(t, [0, 1 - (y + rowH) / cv.height, 1, 1 - y / cv.height]);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), nm = new THREE.Matrix3();
  const addBoard = (text: string, x: number, y: number, z: number, rotY: number, w: number, h: number, arrow: boolean) => {
    const r = uvOf.get(text)!;
    m4.makeRotationY(rotY).setPosition(x, y, z); nm.getNormalMatrix(m4);
    // две страни (лице към +z и към -z), с дебелина 0.06
    const quads: [number, number[], number[]][] = [[0.035, [0, 0, 1], [r[0], r[2]]], [-0.035, [0, 0, -1], [r[2], r[0]]]];
    for (const [dz, n, [u0, u1]] of quads) {
      const tip = arrow ? 0.25 : 0;
      const P = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2 + tip, 0], [w / 2, h / 2], [-w / 2, h / 2]];
      const U = (px: number) => u0 + ((px + w / 2) / w) * (u1 - u0), Vv = (py: number) => r[1] + ((py + h / 2) / h) * (r[3] - r[1]);
      const triIdx = dz > 0 ? [[0, 1, 3], [0, 3, 4], [1, 2, 3]] : [[0, 3, 1], [0, 4, 3], [1, 3, 2]];
      for (const t of triIdx) for (const i of t) {
        v.set(P[i][0], P[i][1], dz).applyMatrix4(m4); pos.push(v.x, v.y, v.z);
        const nn = new THREE.Vector3(...n).applyMatrix3(nm).normalize(); nor.push(nn.x, nn.y, nn.z);
        uv.push(Math.min(Math.max(U(P[i][0]), Math.min(u0, u1)), Math.max(u0, u1)), Vv(P[i][1]));
      }
    }
  };
  for (const s of plan.signs) {
    const y = heightAt(s.x, s.z);
    s.boards.forEach((bd, i) => {
      // дъската сочи по посоката bd.dir (световен ъгъл като rotation.y): локалното +x трябва да гледа натам
      const rot = bd.dir - Math.PI / 2;
      const cx = s.x + Math.sin(bd.dir) * 0.75, cz = s.z + Math.cos(bd.dir) * 0.75;
      addBoard(bd.text, cx, y + 2.3 - i * 0.42, cz, rot, 1.5, 0.34, true);
    });
  }
  if (innSign) {
    const y = heightAt(innSign.x, innSign.z);
    const cs = Math.cos(innSign.rot), sn = Math.sin(innSign.rot);
    addBoard('ХАН', innSign.x + 0.62 * cs, y + 2.45, innSign.z - 0.62 * sn, innSign.rot, 1.1, 0.55, false);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'signs';
  return mesh;
}

/** Стълбовете на табелите (в общата партида). */
export function buildSignPosts(b: Batch, plan: WorldPlan): void {
  for (const s of plan.signs) {
    const y = heightAt(s.x, s.z);
    b.box(0.16, 2.8, 0.16, s.x, y + 1.3, s.z, PAL.wood);
    b.box(0.3, 0.12, 0.3, s.x, y + 2.75, s.z, PAL.woodDark);
  }
}
