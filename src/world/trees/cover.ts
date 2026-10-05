// Ниската растителност: папрат (истински листа от Poly Haven fern_02), мухоморки и манатарки, цветя на поляната.
import * as THREE from 'three';
import { GeoBuilder, tube, Rand } from './builder';

// петте листа в текстурата fern_02 (u0, u1, v0 = основа, v1 = връх); v е отдолу нагоре
const FRONDS: [number, number, number, number][] = [
  [0.085, 0.235, 0.07, 0.89], [0.31, 0.47, 0.24, 0.97], [0.535, 0.665, 0.5, 0.97], [0.515, 0.655, 0.03, 0.49], [0.715, 0.865, 0.13, 0.89],
];

/** Папрат: 8–11 дъгообразни листа от средата навън. */
export function fernGeometry(seed: number, lod: 0 | 1): THREE.BufferGeometry {
  const rnd = new Rand(seed);
  const b = new GeoBuilder();
  const n = lod === 0 ? 10 : 6, segs = lod === 0 ? 6 : 3;
  const crown = new THREE.Vector3(0, -0.3, 0);
  for (let k = 0; k < n; k++) {
    const [u0, u1, v0, v1] = FRONDS[Math.floor(rnd.next() * FRONDS.length)];
    const az = (k / n) * Math.PI * 2 + rnd.jit(0.3);
    const len = rnd.range(0.75, 1.15) * (lod === 0 ? 1 : 1.1);
    const w = len * 0.2;
    const pitch0 = rnd.range(0.9, 1.25);
    const hd = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
    const side = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const rows: number[] = [];
    let p = new THREE.Vector3(hd.x * 0.05, 0.02, hd.z * 0.05);
    for (let s = 0; s <= segs; s++) {
      const f = s / segs;
      const pitch = pitch0 - f * (pitch0 + 0.45);
      const d = new THREE.Vector3(hd.x * Math.cos(pitch), Math.sin(pitch), hd.z * Math.cos(pitch));
      if (s > 0) p = p.clone().addScaledVector(d, len / segs);
      // лицевата страна е нагоре, закръглена навън
      const nUp = new THREE.Vector3().crossVectors(d, side).normalize();
      if (nUp.y < 0) nUp.negate();
      const out = p.clone().sub(crown).normalize();
      const nn = nUp.multiplyScalar(0.55).addScaledVector(out, 0.45).normalize();
      // листото се стеснява към върха, перата леко увисват встрани
      const ww = w * (1 - f * 0.35);
      rows.push(b.count);
      const ao = 0.55 + 0.45 * f;
      for (let e = 0; e < 2; e++) {
        const q = p.clone().addScaledVector(side, (e ? 0.5 : -0.5) * ww);
        q.y -= ww * 0.12;
        b.vert(q, nn, e ? u1 : u0, v0 + (v1 - v0) * f, ao, f, f > 0.3 ? 1 : 0);
      }
    }
    for (let s = 0; s < segs; s++) b.quad(rows[s], rows[s] + 1, rows[s + 1] + 1, rows[s + 1]);
  }
  return b.build();
}

/** Мухоморка (червена с бели точки) или манатарка (кафява) — малка група. */
export function mushroomGeometry(seed: number, kind: 'amanita' | 'bolete'): THREE.BufferGeometry {
  const rnd = new Rand(seed);
  const b = new GeoBuilder();
  const count = kind === 'amanita' ? 3 : 2;
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 26; i++) spots.push(new THREE.Vector3(rnd.jit(1), rnd.range(0.2, 1), rnd.jit(1)).normalize());
  const cols: number[] = [];
  for (let m = 0; m < count; m++) {
    const sc = m === 0 ? 1 : rnd.range(0.45, 0.75);
    const ox = m === 0 ? 0 : rnd.jit(0.28), oz = m === 0 ? 0 : rnd.jit(0.28);
    const H = (kind === 'amanita' ? 0.22 : 0.12) * sc, R = (kind === 'amanita' ? 0.13 : 0.11) * sc;
    const start = b.count;
    // пънче
    const sr = kind === 'amanita' ? 0.022 * sc : 0.04 * sc;
    tube(b, [
      { p: new THREE.Vector3(ox, -0.01, oz), r: sr * (kind === 'amanita' ? 1.8 : 1.5) },
      { p: new THREE.Vector3(ox, H * 0.15, oz), r: sr * 1.4 },
      { p: new THREE.Vector3(ox, H * 0.7, oz), r: sr },
      { p: new THREE.Vector3(ox, H, oz), r: sr * 0.9 },
    ], 8, 1, 1);
    for (let i = start; i < b.count; i++) cols.push(kind === 'amanita' ? 0.92 : 0.82, kind === 'amanita' ? 0.9 : 0.74, kind === 'amanita' ? 0.84 : 0.6);
    // шапка: полусфера, сплескана; по-зрелите — по-плоски
    const flat = rnd.range(0.5, 0.85);
    const cs = b.count;
    const RS = 14, RR = 5;
    const ring: number[] = [];
    for (let i = 0; i <= RR; i++) {
      const t = (i / RR) * Math.PI * 0.5;
      ring.push(b.count);
      for (let j = 0; j <= RS; j++) {
        const a = (j / RS) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a) * Math.sin(t), Math.cos(t), Math.sin(a) * Math.sin(t));
        const p = new THREE.Vector3(ox + dir.x * R * 1.05, H + dir.y * R * flat - R * 0.1, oz + dir.z * R * 1.05);
        b.vert(p, dir.clone().setY(dir.y / flat).normalize(), j / RS, i / RR, 1);
        let c: [number, number, number];
        if (kind === 'amanita') {
          const spot = spots.some((s) => s.distanceTo(dir) < 0.2);
          c = spot ? [0.95, 0.93, 0.86] : [0.72 - i * 0.02, 0.07, 0.04];
        } else c = [0.42 - i * 0.02, 0.26, 0.13];
        cols.push(...c);
      }
    }
    for (let i = 0; i < RR; i++) for (let j = 0; j < RS; j++) b.quad(ring[i] + j, ring[i] + j + 1, ring[i + 1] + j + 1, ring[i + 1] + j);
    // долната страна (пластинки) — светъл диск
    const ci = b.vert(new THREE.Vector3(ox, H - R * 0.12, oz), new THREE.Vector3(0, -1, 0), 0.5, 0.5, 0.7);
    cols.push(0.85, 0.82, 0.72);
    const last = ring[RR];
    for (let j = 0; j < RS; j++) b.tri(ci, last + j + 1, last + j);
    void cs;
  }
  const g = b.build();
  // цветът е в атрибута color (вместо оклузия)
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

/** Цветя: туфа от 4 стръка с главички (бели петели + жълто среде; цветът — от екземпляра). */
export function flowerGeometry(seed: number): THREE.BufferGeometry {
  const rnd = new Rand(seed);
  const b = new GeoBuilder();
  const cols: number[] = [];
  const push = (from: number, c: [number, number, number]) => { for (let i = from; i < b.count; i++) cols.push(...c); };
  for (let k = 0; k < 4; k++) {
    const ox = rnd.jit(0.12), oz = rnd.jit(0.12), h = rnd.range(0.22, 0.42);
    const lean = new THREE.Vector3(rnd.jit(0.06), 0, rnd.jit(0.06));
    const s0 = b.count;
    tube(b, [{ p: new THREE.Vector3(ox, 0, oz), r: 0.006, sway: 0 }, { p: new THREE.Vector3(ox, h * 0.5, oz).add(lean.clone().multiplyScalar(0.5)), r: 0.005, sway: 0.5 }, { p: new THREE.Vector3(ox, h, oz).add(lean), r: 0.004, sway: 1 }], 3, 1, 1);
    push(s0, [0.25, 0.42, 0.16]);
    // листенце
    const l0 = b.count;
    const la = rnd.next() * 6.28, lp = new THREE.Vector3(ox, 0.03, oz);
    const ld = new THREE.Vector3(Math.sin(la), 0.5, Math.cos(la)).normalize(), ls = new THREE.Vector3(Math.cos(la), 0, -Math.sin(la));
    const a0 = b.vert(lp, UPV, 0, 0, 1), a1 = b.vert(lp.clone().addScaledVector(ld, 0.09).addScaledVector(ls, 0.02), UPV, 0, 0, 1);
    const a2 = b.vert(lp.clone().addScaledVector(ld, 0.16), UPV, 0, 0, 1), a3 = b.vert(lp.clone().addScaledVector(ld, 0.09).addScaledVector(ls, -0.02), UPV, 0, 0, 1);
    b.quad(a0, a1, a2, a3); b.quad(a0, a3, a2, a1);
    push(l0, [0.22, 0.4, 0.14]);
    // главичка: 8 петела
    const top = new THREE.Vector3(ox, h, oz).add(lean);
    const r = rnd.range(0.025, 0.04);
    const p0 = b.count;
    const c = b.vert(top.clone().add(new THREE.Vector3(0, 0.006, 0)), UPV, 0, 0, 1, 1);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r;
      b.vert(top.clone().add(new THREE.Vector3(Math.cos(a) * rr, (i % 2 ? 0 : -0.006), Math.sin(a) * rr)), UPV, 0, 0, 1, 1);
    }
    for (let i = 0; i < 16; i++) { b.tri(c, p0 + 1 + ((i + 1) % 16), p0 + 1 + i); b.tri(c, p0 + 1 + i, p0 + 1 + ((i + 1) % 16)); }
    push(p0, [1, 1, 1]);
    cols[p0 * 3] = 1.0; cols[p0 * 3 + 1] = 0.82; cols[p0 * 3 + 2] = 0.2;
  }
  const g = b.build();
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}
const UPV = new THREE.Vector3(0, 1, 0);
