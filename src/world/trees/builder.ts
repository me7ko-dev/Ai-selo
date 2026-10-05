// Строител на геометрия за растенията: тръби (стволове, клони) и карти (листа, иглички) с атрибути за
// вятъра и „оклузия“ (по-тъмно навътре в короната). Чиста математика — работи и в Node (пробите).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3();

/**
 * Атрибути на всеки връх:
 *  position, normal, uv;
 *  color  — оклузия (сиво; 1 = открито, 0.3 = дълбоко в короната);
 *  aWind  — x: колко се люлее с клона (0 при ствола → 1 на върха на клона), y: трептене на листо/иглица (0/1).
 */
export class GeoBuilder {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; wind: number[] = []; idx: number[] = [];

  get count(): number { return this.pos.length / 3; }

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, ao = 1, sway = 0, flutter = 0): number {
    this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.col.push(ao, ao, ao); this.wind.push(sway, flutter);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, a, c, d); }

  /** Добавя чужда геометрия (напр. от three) с матрица; ao/sway постоянни. */
  addGeometry(g: THREE.BufferGeometry, m: THREE.Matrix4, ao = 1, sway = 0, uvScale: [number, number] = [1, 1]): void {
    const gi = g.index ? g : g;
    const p = gi.attributes.position, n = gi.attributes.normal, uv = gi.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m);
      _n.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.vert(_v, _n, uv ? uv.getX(i) * uvScale[0] : 0, uv ? uv.getY(i) * uvScale[1] : 0, ao, sway);
    }
    if (gi.index) for (let i = 0; i < gi.index.count; i++) this.idx.push(base + gi.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Точка от централната линия на тръба. */
export interface TubePt { p: THREE.Vector3; r: number; ao?: number; sway?: number }

/**
 * Тръба по централна линия (без капачки), с паралелно пренасяне на рамката (без усукване).
 * uRep — колко пъти текстурата обикаля окръжността; vScale — метри на едно повторение по дължина.
 */
export function tube(b: GeoBuilder, pts: TubePt[], seg: number, uRep: number, vScale: number, v0 = 0, flare?: (i: number, a: number) => number): number {
  const n = pts.length;
  if (n < 2) return v0;
  // начална рамка
  _t.subVectors(pts[1].p, pts[0].p).normalize();
  const nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  const ref = Math.abs(_t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  nrm.crossVectors(ref, _t).normalize(); bin.crossVectors(_t, nrm).normalize();
  const prevT = _t.clone();
  let v = v0;
  const rings: number[] = [];
  for (let i = 0; i < n; i++) {
    const tan = i < n - 1 ? new THREE.Vector3().subVectors(pts[i + 1].p, pts[i].p) : new THREE.Vector3().subVectors(pts[i].p, pts[i - 1].p);
    if (i > 0 && i < n - 1) tan.add(new THREE.Vector3().subVectors(pts[i].p, pts[i - 1].p));
    tan.normalize();
    // пренасяне на рамката
    const ax = new THREE.Vector3().crossVectors(prevT, tan);
    if (ax.lengthSq() > 1e-10) {
      const ang = Math.acos(THREE.MathUtils.clamp(prevT.dot(tan), -1, 1));
      ax.normalize(); nrm.applyAxisAngle(ax, ang); bin.applyAxisAngle(ax, ang);
    }
    prevT.copy(tan);
    if (i > 0) v += pts[i].p.distanceTo(pts[i - 1].p) / vScale;
    rings.push(b.count);
    const { r, ao = 1, sway = 0 } = pts[i];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const rr = flare ? r * flare(i, a) : r;
      _n.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      _b.copy(pts[i].p).addScaledVector(_n, rr);
      b.vert(_b, _n, (j / seg) * uRep, v, ao, sway);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    for (let j = 0; j < seg; j++) b.quad(r0 + j, r0 + j + 1, r1 + j + 1, r1 + j);
  }
  return v;
}

/**
 * Карта (плоско листо/клонче) с основа в `base`, растяща по `dir`, широка `w`, дълга `len`; `up` задава равнината
 * (нормалата на картата е dir × side). uv: [u0,u1]×[0,1] — основата е долу (v=0).
 * Нормалите на върховете се „закръглят“ към посоката от центъра на короната (crown) — така листата се осветяват
 * като обем, а не като плоски карти. bend — колко се огъва надолу краят (иглиците на смърча).
 */
export function card(b: GeoBuilder, base: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, w: number, len: number,
  u0: number, u1: number, crown: THREE.Vector3, round: number, ao: number, sway0: number, sway1: number, bend = 0, segs = 1): void {
  const nCard = new THREE.Vector3().crossVectors(side, dir).normalize();
  const rows: number[] = [];
  for (let k = 0; k <= segs; k++) {
    const f = k / segs;
    const c = new THREE.Vector3().copy(base).addScaledVector(dir, len * f);
    c.y -= bend * len * f * f;
    rows.push(b.count);
    for (let s = 0; s < 2; s++) {
      const p = new THREE.Vector3().copy(c).addScaledVector(side, (s ? 0.5 : -0.5) * w);
      const out = new THREE.Vector3().subVectors(p, crown);
      if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
      out.normalize();
      // картата гледа навън от короната
      const nc = nCard.dot(out) < 0 ? nCard.clone().negate() : nCard.clone();
      const nn = nc.multiplyScalar(1 - round).addScaledVector(out, round).normalize();
      b.vert(p, nn, s ? u1 : u0, f, ao * (0.82 + 0.18 * f), sway0 + (sway1 - sway0) * f, 1);
    }
  }
  for (let k = 0; k < segs; k++) b.quad(rows[k], rows[k] + 1, rows[k + 1] + 1, rows[k + 1]);
}

/** Детерминиран генератор (mulberry32) — за повторими дървета. */
export class Rand {
  constructor(private s: number) { this.s = s >>> 0; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** ±a */
  jit(a: number): number { return (this.next() * 2 - 1) * a; }
}
