// Строител на сградите с истински (PBR) материали.
// Всяка част отива в „слот“ (материал). UV се смятат в метри по лицето на частта (плътността на текстурата е еднаква
// навсякъде, шарката на дървото върви по дължината на гредата, камъкът и мазилката — хоризонтално).
// Цветът по върховете носи оттенъка и изветряването: мръсно и влажно до земята, тъмно под стрехите, петна по стените.
// Накрая всеки слот става една мрежа → за цялото село по едно извикване (draw call) на материал.
import * as THREE from 'three';

export type V3 = [number, number, number];
export type Slot =
  | 'plaster' | 'stone' | 'masonry' | 'timber' | 'planks' | 'roof' | 'bark' | 'hay' | 'rock'
  | 'plain' | 'iron' | 'glass' | 'hot' | 'wet' | 'leaves';
export const SLOTS: Slot[] = ['plaster', 'stone', 'masonry', 'timber', 'planks', 'roof', 'bark', 'hay', 'rock', 'plain', 'iron', 'glass', 'hot', 'wet', 'leaves'];

/** Колко метра е една плочка на текстурата: [напречно на шарката, по шарката]. */
export const TILE: Record<Slot, [number, number]> = {
  plaster: [2.2, 2.2], stone: [2.0, 2.0], masonry: [2.6, 2.6], timber: [0.5, 1.6], planks: [1.9, 1.9], roof: [3.0, 3.0],
  bark: [1.0, 1.6], hay: [1.6, 1.6], rock: [3.0, 3.0],
  plain: [1, 1], iron: [1, 1], glass: [1, 1], hot: [1, 1], wet: [1, 1], leaves: [1, 1],
};

/** Желязото е в същата мрежа като „обикновените“ неща (тъмен цвят) — едно извикване по-малко. */
const ALIAS: Partial<Record<Slot, Slot>> = { iron: 'plain' };

export interface PartOpts {
  /** завъртане на частта (в радиани, ред XYZ като THREE.Euler) */
  rx?: number; ry?: number; rz?: number;
  /** оттенък (умножава текстурата) */
  tint?: THREE.ColorRepresentation;
  /** по коя локална ос върви шарката (0=x, 1=y, 2=z); по подразбиране — най-дългата */
  grain?: 0 | 1 | 2;
  /** размер на плочката [напречно, по шарката] в метри (иначе TILE[slot]) */
  tile?: [number, number];
  /** скосени ръбове (м) — хващат светлината отблизо */
  bevel?: number;
  /** разделяне на лицата на клетки (м) — за петната и мръсотията по върховете */
  cell?: number;
  /** сила на петната (0..0.4) */
  stain?: number;
  /** случайно разсейване на яркостта на цялата част (0..0.3) */
  jitter?: number;
  /** без лица отгоре/отдолу (кутия) */
  noTop?: boolean; noBottom?: boolean;
}

type ShadeFn = (p: THREE.Vector3, slot: Slot, n: THREE.Vector3) => number;

// ---------------------------------------------------------------- шум за петната
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Гладък шум 0..1 (стойности в решетка, тристранна интерполация). */
export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
export function fbm3(x: number, y: number, z: number): number {
  return vnoise(x, y, z) * 0.6 + vnoise(x * 2.3 + 17, y * 2.3, z * 2.3 - 5) * 0.4;
}
export const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- една мрежа (слот)
class Mesher {
  p = new Float32Array(3 * 1024); n = new Float32Array(3 * 1024); t = new Float32Array(2 * 1024); c = new Float32Array(3 * 1024);
  i = new Uint32Array(3 * 1024);
  vc = 0; ic = 0;
  private growV(): void {
    const cap = this.p.length / 3 * 2;
    const g = (a: Float32Array, k: number) => { const b = new Float32Array(cap * k); b.set(a); return b; };
    this.p = g(this.p, 3); this.n = g(this.n, 3); this.t = g(this.t, 2); this.c = g(this.c, 3);
  }
  v(px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, w: number, r: number, g: number, b: number): number {
    if (this.vc * 3 + 3 > this.p.length) this.growV();
    const k = this.vc * 3, q = this.vc * 2;
    this.p[k] = px; this.p[k + 1] = py; this.p[k + 2] = pz;
    this.n[k] = nx; this.n[k + 1] = ny; this.n[k + 2] = nz;
    this.t[q] = u; this.t[q + 1] = w;
    this.c[k] = r; this.c[k + 1] = g; this.c[k + 2] = b;
    return this.vc++;
  }
  tri(a: number, b: number, c: number): void {
    if (this.ic + 3 > this.i.length) { const x = new Uint32Array(this.i.length * 2); x.set(this.i); this.i = x; }
    this.i[this.ic++] = a; this.i[this.ic++] = b; this.i[this.ic++] = c;
  }
  get triangles(): number { return this.ic / 3; }
  build(): THREE.BufferGeometry | null {
    if (!this.ic) return null;
    const g = new THREE.BufferGeometry(), n = this.vc;
    g.setAttribute('position', new THREE.BufferAttribute(this.p.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.n.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.t.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.slice(0, n * 3), 3));
    const idx = n > 65535 ? this.i.slice(0, this.ic) : Uint16Array.from(this.i.subarray(0, this.ic));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _n = new THREE.Vector3(), _g = new THREE.Vector3(), _U = new THREE.Vector3(), _V = new THREE.Vector3(), _P = new THREE.Vector3(), _t = new THREE.Vector3();
const _col = new THREE.Color();
const BOX_CORNERS: V3[] = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];

export class Kit {
  private ms = new Map<Slot, Mesher>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  /** Засенчване по върховете в света (мръсотия до земята, сянка под стрехите…); null — без. */
  shade: ShadeFn | null = null;
  private salt = 0;

  private mesher(slot: Slot): Mesher {
    const s = ALIAS[slot] ?? slot;
    let m = this.ms.get(s);
    if (!m) { m = new Mesher(); this.ms.set(s, m); }
    return m;
  }
  get top(): THREE.Matrix4 { return this.stack[this.stack.length - 1]; }
  /** Локални координати: позиция + завъртане около y (+ мащаб). */
  push(x: number, y: number, z: number, rotY = 0, scale = 1): void {
    _q.setFromEuler(_e.set(0, rotY, 0));
    this.stack.push(this.top.clone().multiply(_m.compose(_v.set(x, y, z), _q, _s.set(scale, scale, scale))));
  }
  pushMatrix(m: THREE.Matrix4): void { this.stack.push(this.top.clone().multiply(m)); }
  pop(): void { if (this.stack.length > 1) this.stack.pop(); }
  /** Броят триъгълници по слотове (за доклада). */
  stats(): Record<string, number> { const r: Record<string, number> = {}; for (const [k, m] of this.ms) r[k] = m.triangles; return r; }

  // ------------------------------------------------------------ помощни
  private local(x: number, y: number, z: number, o: PartOpts | undefined, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    _q.setFromEuler(_e.set(o?.rx ?? 0, o?.ry ?? 0, o?.rz ?? 0));
    return this.top.clone().multiply(_m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)));
  }
  /** Основният цвят на частта: оттенък × случайно разсейване. */
  private base(o: PartOpts | undefined, seedPos: THREE.Vector3): [number, number, number] {
    _col.set(o?.tint ?? 0xffffff);
    const j = o?.jitter ?? 0.06;
    let f = 1;
    if (j) { this.salt++; f = 1 + (hash3(Math.round(seedPos.x * 37), Math.round(seedPos.y * 41), Math.round(seedPos.z * 43) + this.salt) - 0.5) * 2 * j; }
    return [_col.r * f, _col.g * f, _col.b * f];
  }
  private shadeAt(slot: Slot, p: THREE.Vector3, n: THREE.Vector3, stain: number): number {
    let f = this.shade ? this.shade(p, slot, n) : 1;
    if (stain) f *= 1 - stain * smooth(0.35, 0.85, fbm3(p.x * 0.45, p.y * 0.6, p.z * 0.45));
    return f;
  }
  /** Оси на UV: V по шарката (проектирана в лицето), U напречно. */
  private uvAxes(n: THREE.Vector3, g: THREE.Vector3, fallback: THREE.Vector3): void {
    _V.copy(g).addScaledVector(n, -g.dot(n));
    if (_V.lengthSq() < 0.09) { _V.copy(fallback).addScaledVector(n, -fallback.dot(n)); if (_V.lengthSq() < 1e-6) _V.set(n.y, n.z, n.x).cross(n); }
    _V.normalize(); _U.crossVectors(_V, n).normalize();
  }

  /**
   * Четириъгълник c0→c1→c2→c3 (в света) с нормала n, разделен на nu×nv клетки (за петната).
   * g — посоката на шарката в света; tile — [U, V] в метри.
   */
  private grid(slot: Slot, c0: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3, c3: THREE.Vector3, n: THREE.Vector3, g: THREE.Vector3,
    tile: [number, number], col: [number, number, number], nu: number, nv: number, stain: number): void {
    const m = this.mesher(slot);
    // посока: c0→c1→c3 трябва да е обратно на часовника гледано откъм n
    _a.subVectors(c1, c0); _b.subVectors(c3, c0);
    const flip = _t.crossVectors(_a, _b).dot(n) < 0;
    _d.subVectors(c3, c0);
    this.uvAxes(n, g, _d);
    const U = _U.clone(), V = _V.clone();
    const first = m.vc;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const s = i / nu, t = j / nv;
      _P.set(
        (c0.x * (1 - s) + c1.x * s) * (1 - t) + (c3.x * (1 - s) + c2.x * s) * t,
        (c0.y * (1 - s) + c1.y * s) * (1 - t) + (c3.y * (1 - s) + c2.y * s) * t,
        (c0.z * (1 - s) + c1.z * s) * (1 - t) + (c3.z * (1 - s) + c2.z * s) * t);
      const f = this.shadeAt(slot, _P, n, stain);
      m.v(_P.x, _P.y, _P.z, n.x, n.y, n.z, _P.dot(U) / tile[0], _P.dot(V) / tile[1], col[0] * f, col[1] * f, col[2] * f);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = first + j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
      if (flip) { m.tri(a, c, b); m.tri(a, d, c); } else { m.tri(a, b, c); m.tri(a, c, d); }
    }
  }
  private tri3(slot: Slot, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3, g: THREE.Vector3, tile: [number, number], col: [number, number, number], stain: number): void {
    const m = this.mesher(slot);
    _t.subVectors(b, a).cross(_d.subVectors(c, a));
    const flip = _t.dot(n) < 0;
    _d.subVectors(b, a);
    this.uvAxes(n, g, _d);
    const ids = [a, b, c].map((p) => {
      const f = this.shadeAt(slot, p, n, stain);
      return m.v(p.x, p.y, p.z, n.x, n.y, n.z, p.dot(_U) / tile[0], p.dot(_V) / tile[1], col[0] * f, col[1] * f, col[2] * f);
    });
    if (flip) m.tri(ids[0], ids[2], ids[1]); else m.tri(ids[0], ids[1], ids[2]);
  }

  // ------------------------------------------------------------ части
  /** Кутия w×h×d с център (x, y, z) в локалните координати. */
  box(slot: Slot, w: number, h: number, d: number, x: number, y: number, z: number, o?: PartOpts): void {
    const L = this.local(x, y, z, o);
    _nm.getNormalMatrix(L);
    const size = [w, h, d];
    const grain = o?.grain ?? (w >= h && w >= d ? 0 : h >= d ? 1 : 2);
    const gw = new THREE.Vector3(grain === 0 ? 1 : 0, grain === 1 ? 1 : 0, grain === 2 ? 1 : 0).applyMatrix3(_nm).normalize();
    const tile = o?.tile ?? TILE[slot];
    const center = new THREE.Vector3(0, 0, 0).applyMatrix4(L);
    const col = this.base(o, center);
    const stain = o?.stain ?? 0;
    const bev = Math.min(o?.bevel ?? 0, w * 0.45, h * 0.45, d * 0.45);
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const P = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyMatrix4(L);
    const N = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyMatrix3(_nm).normalize();
    const cell = o?.cell ?? 0;
    // шестте лица (при скосяване — смалени с bev)
    for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) {
      if (ax === 1 && sg === 1 && o?.noTop) continue;
      if (ax === 1 && sg === -1 && o?.noBottom) continue;
      const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
      const e1 = size[a1] / 2 - bev, e2 = size[a2] / 2 - bev;
      const pt = (s1: number, s2: number) => { const v = [0, 0, 0]; v[ax] = sg * size[ax] / 2; v[a1] = s1 * e1; v[a2] = s2 * e2; return P(v[0], v[1], v[2]); };
      const nl = [0, 0, 0]; nl[ax] = sg;
      const nu = cell ? Math.max(1, Math.round((e1 * 2) / cell)) : 1, nv = cell ? Math.max(1, Math.round((e2 * 2) / cell)) : 1;
      this.grid(slot, pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1), N(nl[0], nl[1], nl[2]), gw, tile, col, nu, nv, stain);
    }
    if (bev <= 0) return;
    // 12 скосени ръба
    for (let ax = 0; ax < 3; ax++) {
      const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
      for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
        const e = size[ax] / 2 - bev;
        const pt = (sa: number, onA1: boolean) => {
          const v = [0, 0, 0]; v[ax] = sa * e;
          v[a1] = s1 * (size[a1] / 2 - (onA1 ? 0 : bev)); v[a2] = s2 * (size[a2] / 2 - (onA1 ? bev : 0));
          return P(v[0], v[1], v[2]);
        };
        const nl = [0, 0, 0]; nl[a1] = s1; nl[a2] = s2;
        this.grid(slot, pt(-1, true), pt(1, true), pt(1, false), pt(-1, false), N(nl[0], nl[1], nl[2]), gw, tile, col, 1, 1, stain);
      }
    }
    // 8 ъглови триъгълника
    for (const [sx, sy, sz] of BOX_CORNERS) {
      const a = P(sx * hx, sy * (hy - bev), sz * (hz - bev)), b = P(sx * (hx - bev), sy * hy, sz * (hz - bev)), c = P(sx * (hx - bev), sy * (hy - bev), sz * hz);
      this.tri3(slot, a, b, c, N(sx, sy, sz), gw, tile, col, stain);
    }
  }

  /** Греда със сечение w×h между две точки; h е „нагоре“ (най-вертикалната посока, перпендикулярна на гредата). */
  beam(slot: Slot, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h = w, o?: PartOpts): void {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const len = a.distanceTo(b);
    if (len < 1e-4) return;
    const dir = b.clone().sub(a).divideScalar(len);
    // локалната z на гредата = посоката ѝ; y = най-близо до света нагоре
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const xA = new THREE.Vector3().crossVectors(up, dir).normalize();
    const yA = new THREE.Vector3().crossVectors(dir, xA).normalize();
    const R = new THREE.Matrix4().makeBasis(xA, yA, dir).setPosition(a.add(b).multiplyScalar(0.5));
    this.pushMatrix(R);
    this.box(slot, w, h, len, 0, 0, 0, { ...o, grain: 2, rx: 0, ry: 0, rz: 0 });
    this.pop();
  }

  /** Цилиндър/пресечен конус по локалната y с център (x, y, z); arc — само част от кръга (полуцилиндър = π). */
  cyl(slot: Slot, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, o?: PartOpts & { arc?: number; caps?: boolean }): void {
    const L = this.local(x, y, z, o);
    _nm.getNormalMatrix(L);
    const tile = o?.tile ?? TILE[slot], stain = o?.stain ?? 0;
    const col = this.base(o, new THREE.Vector3().applyMatrix4(L));
    const m = this.mesher(slot);
    const arc = o?.arc ?? Math.PI * 2, full = arc >= Math.PI * 2 - 1e-6;
    const n = full ? seg : seg;
    const slope = (rb - rt) / h;
    const first = m.vc;
    const ravg = (rt + rb) / 2;
    for (let j = 0; j <= 1; j++) {
      const yy = -h / 2 + j * h, r = j ? rt : rb;
      for (let i = 0; i <= n; i++) {
        const a = -arc / 2 + (i / n) * arc;
        const sx = Math.sin(a), cz = Math.cos(a);
        _P.set(sx * r, yy, cz * r).applyMatrix4(L);
        _n.set(sx, slope, cz).applyMatrix3(_nm).normalize();
        const f = this.shadeAt(slot, _P, _n, stain);
        m.v(_P.x, _P.y, _P.z, _n.x, _n.y, _n.z, (a * ravg) / tile[0], (yy + y) / tile[1], col[0] * f, col[1] * f, col[2] * f);
      }
    }
    for (let i = 0; i < n; i++) { const a = first + i, b = a + 1, c = a + n + 2, d = a + n + 1; m.tri(a, b, c); m.tri(a, c, d); }
    if (o?.caps !== false && full) {
      for (const j of [0, 1]) {
        const yy = -h / 2 + j * h, r = j ? rt : rb;
        if (r < 1e-4) continue;
        _n.set(0, j ? 1 : -1, 0).applyMatrix3(_nm).normalize();
        _P.set(0, yy, 0).applyMatrix4(L);
        const f = this.shadeAt(slot, _P, _n, stain);
        const c0 = m.v(_P.x, _P.y, _P.z, _n.x, _n.y, _n.z, 0, 0, col[0] * f, col[1] * f, col[2] * f);
        const ring: number[] = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          _P.set(Math.sin(a) * r, yy, Math.cos(a) * r).applyMatrix4(L);
          ring.push(m.v(_P.x, _P.y, _P.z, _n.x, _n.y, _n.z, (Math.sin(a) * r) / tile[0], (Math.cos(a) * r) / tile[1], col[0] * f, col[1] * f, col[2] * f));
        }
        for (let i = 0; i < n; i++) { if (j) m.tri(c0, ring[i], ring[(i + 1) % n]); else m.tri(c0, ring[(i + 1) % n], ring[i]); }
      }
    }
  }

  /** Стругован профил (балясина, стълб, делва): точки [радиус, височина] отдолу нагоре, около локалната y. */
  lathe(slot: Slot, prof: [number, number][], seg: number, x: number, y: number, z: number, o?: PartOpts): void {
    const L = this.local(x, y, z, o);
    _nm.getNormalMatrix(L);
    const tile = o?.tile ?? TILE[slot], stain = o?.stain ?? 0;
    const col = this.base(o, new THREE.Vector3().applyMatrix4(L));
    const m = this.mesher(slot);
    const first = m.vc, k = prof.length;
    const ravg = prof.reduce((acc, q) => acc + q[0], 0) / k;
    let arcLen = 0;
    for (let j = 0; j < k; j++) {
      const [r, yy] = prof[j];
      const p0 = prof[Math.max(0, j - 1)], p1 = prof[Math.min(k - 1, j + 1)];
      const dr = p1[0] - p0[0], dy = p1[1] - p0[1];
      if (j > 0) arcLen += Math.hypot(r - prof[j - 1][0], yy - prof[j - 1][1]);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2, sx = Math.sin(a), cz = Math.cos(a);
        _P.set(sx * r, yy, cz * r).applyMatrix4(L);
        _n.set(sx * dy, -dr, cz * dy).applyMatrix3(_nm).normalize();
        const f = this.shadeAt(slot, _P, _n, stain);
        m.v(_P.x, _P.y, _P.z, _n.x, _n.y, _n.z, (a * ravg) / tile[0], arcLen / tile[1], col[0] * f, col[1] * f, col[2] * f);
      }
    }
    for (let j = 0; j < k - 1; j++) for (let i = 0; i < seg; i++) {
      const a = first + j * (seg + 1) + i, b = a + 1, c = a + seg + 2, d = a + seg + 1;
      m.tri(a, b, c); m.tri(a, c, d);
    }
  }

  /** Тръба по начупена линия (пръти на плет, халки, синджири): r — радиус, sides — страни. */
  tube(slot: Slot, pts: V3[], r: number, sides = 5, o?: PartOpts): void {
    if (pts.length < 2) return;
    const L = this.top;
    _nm.getNormalMatrix(L);
    const tile = o?.tile ?? TILE[slot], stain = o?.stain ?? 0;
    const W = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(L));
    const col = this.base(o, W[0]);
    const m = this.mesher(slot);
    const first = m.vc;
    let along = 0;
    const T = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), up = new THREE.Vector3();
    for (let j = 0; j < W.length; j++) {
      const p = W[j], pa = W[Math.max(0, j - 1)], pb = W[Math.min(W.length - 1, j + 1)];
      T.subVectors(pb, pa).normalize();
      up.set(0, 1, 0); if (Math.abs(T.y) > 0.9) up.set(1, 0, 0);
      X.crossVectors(up, T).normalize(); Y.crossVectors(T, X).normalize();
      if (j > 0) along += p.distanceTo(W[j - 1]);
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        _n.copy(X).multiplyScalar(Math.cos(a)).addScaledVector(Y, Math.sin(a));
        _P.copy(p).addScaledVector(_n, r);
        const f = this.shadeAt(slot, _P, _n, stain);
        m.v(_P.x, _P.y, _P.z, _n.x, _n.y, _n.z, (a * r) / tile[0], along / tile[1], col[0] * f, col[1] * f, col[2] * f);
      }
    }
    for (let j = 0; j < W.length - 1; j++) for (let i = 0; i < sides; i++) {
      const a = first + j * (sides + 1) + i, b = a + 1, c = a + sides + 2, d = a + sides + 1;
      m.tri(a, c, b); m.tri(a, d, c);
    }
  }

  /** Четириъгълник по 4 точки (локални) — плосък; g — посока на шарката (локална, по подразбиране „нагоре“). */
  quad(slot: Slot, a: V3, b: V3, c: V3, d: V3, o?: PartOpts & { n?: V3; g?: V3; nu?: number; nv?: number }): void {
    const L = this.top;
    _nm.getNormalMatrix(L);
    const A = new THREE.Vector3(...a).applyMatrix4(L), B = new THREE.Vector3(...b).applyMatrix4(L), C = new THREE.Vector3(...c).applyMatrix4(L), D = new THREE.Vector3(...d).applyMatrix4(L);
    const n = o?.n ? new THREE.Vector3(...o.n).applyMatrix3(_nm).normalize() : new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A)).normalize();
    const g = new THREE.Vector3(...(o?.g ?? [0, 1, 0])).applyMatrix3(_nm).normalize();
    const col = this.base(o, A);
    let nu = o?.nu ?? 1, nv = o?.nv ?? 1;
    if (o?.cell) { nu = Math.max(1, Math.round(Math.max(A.distanceTo(B), D.distanceTo(C)) / o.cell)); nv = Math.max(1, Math.round(Math.max(A.distanceTo(D), B.distanceTo(C)) / o.cell)); }
    this.grid(slot, A, B, C, D, n, g, o?.tile ?? TILE[slot], col, nu, nv, o?.stain ?? 0);
  }
  /** Триъгълник (локални точки); n — нормала навън. */
  tri(slot: Slot, a: V3, b: V3, c: V3, o?: PartOpts & { n?: V3; g?: V3 }): void {
    const L = this.top;
    _nm.getNormalMatrix(L);
    const A = new THREE.Vector3(...a).applyMatrix4(L), B = new THREE.Vector3(...b).applyMatrix4(L), C = new THREE.Vector3(...c).applyMatrix4(L);
    const n = o?.n ? new THREE.Vector3(...o.n).applyMatrix3(_nm).normalize() : new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).normalize();
    const g = new THREE.Vector3(...(o?.g ?? [0, 1, 0])).applyMatrix3(_nm).normalize();
    this.tri3(slot, A, B, C, n, g, o?.tile ?? TILE[slot], this.base(o, A), o?.stain ?? 0);
  }

  /** Призма: многоъгълник в равнината xy (локално), изтеглен по z с дебелина depth (резбовани дъски, табели-стрелки). */
  prism(slot: Slot, poly: [number, number][], depth: number, x: number, y: number, z: number, o?: PartOpts): void {
    const L = this.local(x, y, z, o);
    const col = this.base(o, new THREE.Vector3().applyMatrix4(L));
    const po: PartOpts = { ...o, rx: 0, ry: 0, rz: 0, jitter: 0, tint: new THREE.Color().setRGB(col[0], col[1], col[2]) };
    this.pushMatrix(new THREE.Matrix4().copy(this.top).invert().multiply(L));
    const hz = depth / 2, k = poly.length;
    const g: V3 = o?.grain === 0 ? [1, 0, 0] : [0, 1, 0];
    const tris = THREE.ShapeUtils.triangulateShape(poly.map(([px, py]) => new THREE.Vector2(px, py)), []);
    for (const s of [1, -1]) for (const [i0, i1, i2] of tris) {
      const p = (q: [number, number]): V3 => [q[0], q[1], s * hz];
      this.tri(slot, p(poly[i0]), p(poly[i1]), p(poly[i2]), { ...po, n: [0, 0, s], g });
    }
    const area = poly.reduce((acc, p, j) => acc + p[0] * poly[(j + 1) % k][1] - poly[(j + 1) % k][0] * p[1], 0);
    const sgn = area >= 0 ? 1 : -1;
    for (let i = 0; i < k; i++) {
      const a = poly[i], b = poly[(i + 1) % k];
      const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
      // навън: (ey, -ex) при обход обратно на часовника
      this.quad(slot, [a[0], a[1], hz], [b[0], b[1], hz], [b[0], b[1], -hz], [a[0], a[1], -hz], { ...po, n: [sgn * ey / l, -sgn * ex / l, 0], g: [0, 0, 1] });
    }
    this.pop();
  }

  /** Произволна геометрия (скали, тор, конус…): UV — кутийна проекция по нормалата на всеки триъгълник. */
  geo(slot: Slot, geo: THREE.BufferGeometry, x: number, y: number, z: number, o?: PartOpts & { sx?: number; sy?: number; sz?: number; flat?: boolean }): void {
    const L = this.local(x, y, z, o, o?.sx ?? 1, o?.sy ?? 1, o?.sz ?? 1);
    _nm.getNormalMatrix(L);
    let gg = geo.index ? geo.toNonIndexed() : geo;
    if (o?.flat || !gg.attributes.normal) { gg = gg === geo ? gg.clone() : gg; gg.computeVertexNormals(); }
    const pos = gg.attributes.position as THREE.BufferAttribute, nor = gg.attributes.normal as THREE.BufferAttribute;
    const tile = o?.tile ?? TILE[slot], stain = o?.stain ?? 0;
    const col = this.base(o, new THREE.Vector3().applyMatrix4(L));
    const m = this.mesher(slot);
    const fn = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      p0.fromBufferAttribute(pos, i).applyMatrix4(L); p1.fromBufferAttribute(pos, i + 1).applyMatrix4(L); p2.fromBufferAttribute(pos, i + 2).applyMatrix4(L);
      fn.subVectors(p1, p0).cross(_t.subVectors(p2, p0)).normalize();
      // кутийна проекция по най-силната ос на лицето
      const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
      const ids: number[] = [];
      for (const [k, p] of [[i, p0], [i + 1, p1], [i + 2, p2]] as [number, THREE.Vector3][]) {
        _n.fromBufferAttribute(nor, k).applyMatrix3(_nm).normalize();
        if (o?.flat) _n.copy(fn);
        const u = ay >= ax && ay >= az ? p.x : ax >= az ? p.z : p.x, v = ay >= ax && ay >= az ? p.z : p.y;
        const f = this.shadeAt(slot, p, _n, stain);
        ids.push(m.v(p.x, p.y, p.z, _n.x, _n.y, _n.z, u / tile[0], v / tile[1], col[0] * f, col[1] * f, col[2] * f));
      }
      m.tri(ids[0], ids[1], ids[2]);
    }
    if (gg !== geo) gg.dispose();
    geo.dispose();
  }

  /** Всички слотове → мрежи (една на материал). */
  meshes(mats: Partial<Record<Slot, THREE.Material>>, name: string, noShadow: Slot[] = ['glass', 'hot', 'wet']): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [slot, m] of this.ms) {
      const mat = mats[slot];
      const geo = m.build();
      if (!geo || !mat) { geo?.dispose(); continue; }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${name}_${slot}`;
      mesh.castShadow = !noShadow.includes(slot);
      mesh.receiveShadow = slot !== 'hot';
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
    this.ms.clear();
    return out;
  }
}
