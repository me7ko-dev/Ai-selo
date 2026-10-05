// Нива на детайл (LOD) за много еднакви неща (дървета, храсти, камъни): всеки кадър — кои екземпляри са близо
// (пълен детайл), кои средно (по-прост модел) и кои далеч (импостор). Изрязва невидимите (извън кадъра) и ги
// подрежда отпред назад (по-малко прерисуване). Списъците се пишат в InstancedMesh-и с готови матрици; двете нива в
// ивицата на смяната се рисуват едновременно и шейдърът ги допълва с решетка (виж materials.ts).
import * as THREE from 'three';

/** Част от модела: геометрия + материал; depth — за сенките; pre — проход само за дълбочина преди всичко (листата). */
export interface LodPart { geo: THREE.BufferGeometry; mat: THREE.Material; depth?: THREE.Material; pre?: THREE.Material; castShadow: boolean }
export interface LodVariant { lods: LodPart[][]; height: number; radius: number }
export interface LodInstance { x: number; y: number; z: number; s: number; rot: number; v: number; r: number; g: number; b: number }

/** Прозорец по разстояние за ниво l: (появява се от x до y, изчезва от z до w). */
export function lodWindow(ends: number[], l: number, fade: number, out = new THREE.Vector4()): THREE.Vector4 {
  if (l === 0) return out.set(-2, -1, ends[0], ends[0] + fade);
  return out.set(ends[l - 1], ends[l - 1] + fade, ends[l], ends[l] + fade);
}

const CELL = 24;

interface Slot { meshes: THREE.InstancedMesh[]; mat: THREE.InstancedBufferAttribute; col: THREE.InstancedBufferAttribute; n: number }
/** Едно ниво на един вариант: близо (хвърля сянка) и далеч (без сянка — извън картата на сенките). */
interface Level { near: Slot; far: Slot | null }

export class LodField {
  readonly group = new THREE.Group();
  /** прозорците на нивата — споделени Vector4 с материалите (промяна → веднага в шейдъра) */
  readonly windows: THREE.Vector4[];
  private ends: number[];
  private fade: number;
  private n: number;
  private mats: Float32Array;
  private cols: Float32Array;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array; private br: Float32Array; private bh: Float32Array;
  private vi: Uint16Array;
  private count: number[];
  private cells: { cx: number; cy: number; cz: number; r: number; items: Uint32Array; d: number }[] = [];
  private order: number[] = [];
  private levels: Level[][] = []; // [variant][lod]
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private lastKey = '';
  /** до това разстояние се рисуват всички (и зад камерата) — за сенките */
  keepNear = 22;
  /** по-далеч от това нивата без пълен детайл не хвърлят сянка (картата на сенките е около героя) */
  shadowDist = 45;
  enabled = true;

  /** windows — готовите Vector4 на нивата (същите, които са дадени на материалите); стойностите се попълват тук. */
  constructor(readonly name: string, readonly variants: LodVariant[], insts: LodInstance[], opts: { ends: number[]; fade: number; windows?: THREE.Vector4[] }) {
    this.group.name = name;
    this.ends = opts.ends.slice(); this.fade = opts.fade;
    const nl = variants[0].lods.length;
    this.windows = Array.from({ length: nl }, (_, l) => lodWindow(this.ends, l, this.fade, opts.windows?.[l]));
    const n = (this.n = insts.length);
    this.mats = new Float32Array(n * 16); this.cols = new Float32Array(n * 3);
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.br = new Float32Array(n); this.bh = new Float32Array(n); this.vi = new Uint16Array(n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    this.count = new Array(variants.length).fill(0);
    insts.forEach((t, i) => {
      m.compose(p.set(t.x, t.y, t.z), q.setFromEuler(e.set(0, t.rot, 0)), s.set(t.s, t.s, t.s));
      m.toArray(this.mats, i * 16);
      this.cols[i * 3] = t.r; this.cols[i * 3 + 1] = t.g; this.cols[i * 3 + 2] = t.b;
      const vr = variants[t.v];
      this.px[i] = t.x; this.py[i] = t.y + vr.height * t.s * 0.5; this.pz[i] = t.z;
      this.bh[i] = vr.height * t.s;
      this.br[i] = Math.max(vr.height * 0.5, vr.radius) * t.s + 1;
      this.vi[i] = t.v; this.count[t.v]++;
    });
    // клетки
    const buckets = new Map<string, number[]>();
    insts.forEach((t, i) => { const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i); });
    for (const items of buckets.values()) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const i of items) {
        x0 = Math.min(x0, this.px[i] - this.br[i]); x1 = Math.max(x1, this.px[i] + this.br[i]);
        y0 = Math.min(y0, this.py[i] - this.br[i]); y1 = Math.max(y1, this.py[i] + this.br[i]);
        z0 = Math.min(z0, this.pz[i] - this.br[i]); z1 = Math.max(z1, this.pz[i] + this.br[i]);
      }
      this.cells.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, r: Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2, items: Uint32Array.from(items), d: 0 });
    }
    this.order = this.cells.map((_, i) => i);
    this.levels = variants.map(() => []);
    for (let l = 0; l < nl; l++) this.makeLevel(l, variants.map((vr) => vr.lods[l]));
  }

  private makeSlot(v: number, l: number, parts: LodPart[], shadow: boolean, tag: string): Slot {
    const cap = Math.max(1, this.count[v]);
    const mat = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16); mat.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); col.setUsage(THREE.DynamicDrawUsage);
    const meshes: THREE.InstancedMesh[] = [];
    const mk = (geo: THREE.BufferGeometry, m: THREE.Material, name: string, order: number) => {
      const im = new THREE.InstancedMesh(geo, m, cap);
      im.instanceMatrix = mat; im.instanceColor = col;
      im.count = 0; im.frustumCulled = false; im.visible = false;
      im.name = name; im.renderOrder = order;
      meshes.push(im); this.group.add(im);
      return im;
    };
    parts.forEach((pt, k) => {
      const im = mk(pt.geo, pt.mat, `${this.name}_v${v}_l${l}_${k}${tag}`, l);
      im.castShadow = shadow && pt.castShadow;
      // далечните (извън картата на сенките) не четат сенки — по-евтино
      im.receiveShadow = tag !== 'f';
      if (pt.depth) im.customDepthMaterial = pt.depth;
      // проходът само за дълбочина — преди всичко останало
      if (pt.pre) { const p = mk(pt.geo, pt.pre, `${this.name}_v${v}_l${l}_${k}${tag}p`, -10 + l); p.castShadow = false; p.receiveShadow = false; }
    });
    return { meshes, mat, col, n: 0 };
  }

  private makeLevel(l: number, partsPerVariant: LodPart[][]): void {
    partsPerVariant.forEach((parts, v) => {
      const shadow = parts.some((p) => p.castShadow);
      const near = this.makeSlot(v, l, parts, shadow, '');
      // нивата след първото: отделни мрежи без сянка за далечните екземпляри
      const far = l > 0 && shadow ? this.makeSlot(v, l, parts, false, 'f') : null;
      this.levels[v][l] = { near, far };
    });
  }

  /** Добавя още едно (най-далечно) ниво — напр. импосторите, когато са готови. */
  addLevel(partsPerVariant: LodPart[][], window: THREE.Vector4, receiveShadow = true): void {
    const l = this.windows.length;
    this.windows.push(window);
    partsPerVariant.forEach((parts, v) => this.variants[v].lods.push(parts));
    this.makeLevel(l, partsPerVariant);
    for (const row of this.levels) for (const m of row[l].near.meshes) m.receiveShadow = receiveShadow && !m.name.endsWith('p');
    this.lastKey = '';
  }

  /** Нови граници на нивата с модели (качество; импостори готови/не). Прозорецът на добавено ниво се пипа отвън. */
  setEnds(ends: number[], fade = this.fade): void {
    this.ends = ends.slice(); this.fade = fade;
    for (let l = 0; l < ends.length; l++) lodWindow(this.ends, l, this.fade, this.windows[l]);
    this.lastKey = '';
  }
  get lodEnds(): readonly number[] { return this.ends; }

  /** Разпределя екземплярите по нивата за тази камера. */
  update(cam: THREE.Camera, force = false): void {
    const cp = cam.position;
    const key = `${cp.x.toFixed(2)},${cp.y.toFixed(2)},${cp.z.toFixed(2)},${cam.quaternion.x.toFixed(4)},${cam.quaternion.y.toFixed(4)},${cam.quaternion.z.toFixed(4)},${this.windows.length}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    for (const row of this.levels) for (const lv of row) { lv.near.n = 0; if (lv.far) lv.far.n = 0; }
    if (this.enabled) {
      this.pm.multiplyMatrices((cam as THREE.PerspectiveCamera).projectionMatrix, cam.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.pm);
      const planes = this.frustum.planes;
      const nl = this.windows.length;
      let far = 0;
      for (const w of this.windows) far = Math.max(far, w.w);
      const cx = cp.x, cy = cp.y, cz = cp.z, keep = this.keepNear, sh = this.shadowDist;
      const sphereIn = (x: number, y: number, z: number, r: number) => {
        for (let k = 0; k < 6; k++) { const pl = planes[k]; if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -r) return false; }
        return true;
      };
      // клетките отпред назад
      for (const c of this.cells) c.d = Math.hypot(c.cx - cx, c.cy - cy, c.cz - cz);
      this.order.sort((a, b) => this.cells[a].d - this.cells[b].d);
      for (const ci of this.order) {
        const c = this.cells[ci];
        if (c.d - c.r > far) continue;
        const cellNear = c.d - c.r < keep;
        if (!cellNear && !sphereIn(c.cx, c.cy, c.cz, c.r)) continue;
        const items = c.items;
        for (let j = 0; j < items.length; j++) {
          const i = items[j];
          // разстоянието е до основата (като в шейдъра)
          const by = this.py[i] - this.bh[i] * 0.5;
          const dx = this.px[i] - cx, dy = by - cy, dz = this.pz[i] - cz;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= far) continue;
          if (d > keep && !sphereIn(this.px[i], this.py[i], this.pz[i], this.br[i])) continue;
          const row = this.levels[this.vi[i]];
          for (let l = 0; l < nl; l++) {
            const w = this.windows[l];
            if (d < w.x || d >= w.w) continue;
            const lv = row[l];
            const s = lv.far && d > sh ? lv.far : lv.near;
            const a = s.mat.array as Float32Array, o = s.n * 16, src = i * 16;
            for (let k = 0; k < 16; k++) a[o + k] = this.mats[src + k];
            const ca = s.col.array as Float32Array, oc = s.n * 3;
            ca[oc] = this.cols[i * 3]; ca[oc + 1] = this.cols[i * 3 + 1]; ca[oc + 2] = this.cols[i * 3 + 2];
            s.n++;
          }
        }
      }
    }
    for (const row of this.levels) for (const lv of row) for (const s of lv.far ? [lv.near, lv.far] : [lv.near]) {
      for (const m of s.meshes) { m.count = s.n; m.visible = s.n > 0; }
      if (s.n > 0) {
        s.mat.clearUpdateRanges(); s.mat.addUpdateRange(0, s.n * 16); s.mat.needsUpdate = true;
        s.col.clearUpdateRanges(); s.col.addUpdateRange(0, s.n * 3); s.col.needsUpdate = true;
      }
    }
  }

  /** Сенки на ниво (напр. „средното“ ниво без сенки при по-ниско качество). */
  setShadows(lod: number, on: boolean): void {
    for (const row of this.levels) { const lv = row[lod]; if (!lv) continue; for (const m of lv.near.meshes) if (!m.name.endsWith('p')) m.castShadow = on; }
  }

  /** Броят нарисувани екземпляри по нива (за доклада). */
  counts(): number[] {
    const out = new Array(this.windows.length).fill(0);
    for (const row of this.levels) row.forEach((lv, l) => { out[l] += lv.near.n + (lv.far?.n ?? 0); });
    return out;
  }
}
