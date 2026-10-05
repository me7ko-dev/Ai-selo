// Процедурни реалистични дървета и храсти (по идеята на ez-tree на Daniel Greenheck, MIT — но свой код):
// смърч и ела (Рила/Родопите), дъб, плодно дърво, орех, сухо дърво, храсти. Всеки вид има 2 нива на детайл:
// lods[0] — отблизо (клони с иглички/листа), lods[1] — средно (малко големи карти). Отдалеч — „импостори“ (impostor.ts).
// Мерки при мащаб 1, в метри; основата на ствола е в (0,0,0).
import * as THREE from 'three';
import { GeoBuilder, tube, card, Rand, type TubePt } from './builder';

export type LeafKind = 'spruce' | 'fir' | 'oak' | 'ash';
export type BarkKind = 'conifer' | 'broadleaf' | 'dead';

export interface TreeLOD { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry | null }
export interface TreeModel {
  name: string;
  lods: TreeLOD[];
  /** височина на върха */
  height: number;
  /** най-голям радиус на короната (за импостора и избледняването) */
  radius: number;
  /** радиус на ствола долу */
  trunkR: number;
  leaf: LeafKind | null;
  bark: BarkKind;
}

// къде е клонката в текстурата (виж tools/prep-leaves.mjs): u0..u1 по ширина, основата е долу
const UV: Record<LeafKind, [number, number]> = { spruce: [0.04, 0.96], fir: [0.04, 0.96], oak: [0, 1], ash: [0, 1] };
const UP = new THREE.Vector3(0, 1, 0);

/** Права посока от ъгли: az — около y, pitch — над хоризонта. */
function dirOf(az: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), Math.cos(az) * Math.cos(pitch));
}
/** Хоризонтален перпендикуляр на d, завъртян около d на roll. */
function sideOf(d: THREE.Vector3, roll: number): THREE.Vector3 {
  const s = new THREE.Vector3().crossVectors(UP, d);
  if (s.lengthSq() < 1e-6) s.set(1, 0, 0);
  s.normalize();
  return s.applyAxisAngle(d, roll);
}

// ====================================================================== иглолистни
export interface ConiferOpts {
  seed: number; height: number; kind: 'spruce' | 'fir';
  /** откъде започва живата корона (част от височината) */
  crownBase: number;
  /** радиус на короната долу (част от височината) */
  width: number;
}

export function conifer(o: ConiferOpts): TreeModel {
  const H = o.height, isFir = o.kind === 'fir';
  const trunkR = 0.017 * H + 0.02;
  const cb = H * o.crownBase;
  const Rmax = H * o.width;
  const [u0, u1] = UV[o.kind];
  const lods: TreeLOD[] = [];
  for (let lod = 0; lod < 2; lod++) {
    const rnd = new Rand(o.seed);
    const bark = new GeoBuilder(), lv = new GeoBuilder();
    // --- ствол: прав, с лека неравност; долу се разширява (корени)
    const lean = new THREE.Vector2(rnd.jit(0.012), rnd.jit(0.012));
    const trunkAt = (y: number) => new THREE.Vector3(lean.x * y + Math.sin(y * 0.7 + o.seed) * 0.03, y, lean.y * y + Math.cos(y * 0.9 + o.seed) * 0.03);
    const radAt = (y: number) => {
      const f = y / H;
      return trunkR * (1 - f) ** 0.9 + 0.012 + trunkR * 0.55 * Math.exp(-y * 2.4);
    };
    const tp: TubePt[] = [];
    const ns = lod === 0 ? 16 : 6;
    for (let i = 0; i <= ns; i++) {
      const f = i / ns, y = H * (lod === 0 ? f ** 1.15 : f) * 0.985;
      tp.push({ p: trunkAt(y), r: radAt(y), ao: 0.45 + 0.55 * Math.min(1, y / 2.5) });
    }
    tube(bark, tp, lod === 0 ? 10 : 5, 2, 1.1, 0, lod === 0 ? (i, a) => (i < 3 ? 1 + 0.18 * Math.max(0, Math.sin(a * 5 + o.seed)) * (1 - i / 3) : 1) : undefined);

    // --- сухи чепове под короната (само отблизо)
    if (lod === 0 && cb > 3) {
      for (let y = 2.2; y < cb - 0.3; y += rnd.range(0.35, 0.8)) {
        const az = rnd.next() * 6.283, len = rnd.range(0.25, 0.9) * Math.min(1, y / cb + 0.3);
        const a = trunkAt(y), r = radAt(y);
        const d = dirOf(az, rnd.range(-0.5, -0.1));
        const p0 = a.clone().addScaledVector(new THREE.Vector3(d.x, 0, d.z).normalize(), r * 0.8);
        tube(bark, [{ p: p0, r: 0.022, ao: 0.6 }, { p: p0.clone().addScaledVector(d, len), r: 0.006, ao: 0.7 }], 3, 1, 0.5);
      }
    }

    // --- живите клони на прешлени
    const crownTop = H * 0.985;
    const step = lod === 0 ? (isFir ? 0.58 : 0.55) : (isFir ? 0.95 : 0.9);
    let y = cb;
    let whorl = 0;
    while (y < crownTop - 0.5) {
      const hRel = (y - cb) / Math.max(0.1, crownTop - cb);
      // форма на короната: конус; при елата върхът е по-тъп
      let L = Rmax * Math.pow(1 - hRel, isFir ? 0.75 : 0.9) * rnd.range(0.85, 1.12) + 0.3;
      if (hRel < 0.12) L *= 0.75 + hRel * 2; // най-долните клони са по-къси (засенчени)
      const nb = (lod === 0 ? 5 : 4) + (rnd.next() < 0.4 ? 1 : 0);
      const off = rnd.next() * 6.283;
      for (let k = 0; k < nb; k++) {
        const az = off + (k / nb) * 6.283 + rnd.jit(0.35);
        const len = L * rnd.range(0.8, 1.1);
        // смърч: клоните излизат почти хоризонтално, увисват и вдигат върха; ела: по-плоски
        const pitch = isFir ? THREE.MathUtils.lerp(-0.12, 0.35, hRel) : THREE.MathUtils.lerp(-0.25, 0.55, hRel);
        const sag = isFir ? 0.12 : THREE.MathUtils.lerp(0.4, 0.08, hRel);
        const tipUp = isFir ? 0.02 : 0.16;
        const base = trunkAt(y);
        const hd = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
        const p = (f: number) => {
          const q = base.clone().addScaledVector(hd, radAt(y) * 0.7 + len * f * Math.cos(pitch));
          q.y += len * f * Math.sin(pitch) - sag * len * f * f + tipUp * len * f * f * f * f;
          return q;
        };
        const aoIn = 0.32 + 0.25 * hRel, aoOut = 0.95;
        // клонът се вижда само долу в короната (горе го скриват иглите)
        if (lod === 0 && hRel < 0.55 && len > 1.2) {
          const br = 0.012 + 0.018 * Math.min(1, len / 3);
          tube(bark, [0, 0.5, 1].map((f) => ({ p: p(f), r: br * (1 - f * 0.85), ao: aoIn + (aoOut - aoIn) * f * 0.7, sway: f })), 3, 1, 0.6);
        }
        // иглички: карти („клонки“) по клона; наклонени в различни посоки, за да има обем и отстрани
        const cardLen = THREE.MathUtils.clamp(len * (lod === 0 ? 0.62 : 1.0), 0.7, lod === 0 ? 1.9 : 3.4);
        const n = lod === 0 ? Math.max(1, Math.round(len / (cardLen * 0.78))) : 1;
        const crownC = new THREE.Vector3(base.x, y + (isFir ? 0.6 : 1.0), base.z);
        for (let c = 0; c < n; c++) {
          const f0 = lod === 0 ? 0.08 + (c / n) * 0.62 : 0.06;
          const a = p(f0), b2 = p(Math.min(1, f0 + 0.15));
          const d = b2.sub(a).normalize();
          // разперване встрани и въртене около клона
          const yaw = (c % 2 ? 1 : -1) * rnd.range(0.1, 0.4) * (lod === 0 ? 1 : 0.3);
          d.applyAxisAngle(UP, yaw);
          const roll = (rnd.next() < 0.5 ? -1 : 1) * rnd.range(0, isFir ? 0.6 : 1.0);
          const w = cardLen * (isFir ? 0.95 : 0.88);
          const ao = aoIn + (aoOut - aoIn) * (0.3 + 0.7 * f0);
          card(lv, a, d, sideOf(d, roll), w, cardLen, u0, u1, crownC, 0.6, ao, f0 * 0.8, Math.min(1, f0 + 0.5), isFir ? 0.05 : 0.16, lod === 0 && cardLen > 1.1 ? 2 : 1);
          // кръстосана карта (отстрани клонът да не е черта)
          if (lod === 1 || (lod === 0 && c === 0 && len > 1.6)) {
            card(lv, a, d, sideOf(d, roll + (rnd.next() < 0.5 ? 1.25 : -1.25)), w * 0.9, cardLen * 0.95, u0, u1, crownC, 0.6, ao * 0.92, f0 * 0.8, Math.min(1, f0 + 0.5), isFir ? 0.03 : 0.12, 1);
          }
          // смърчът има висящи клончета („гребен“)
          if (!isFir && lod === 0 && hRel < 0.65 && rnd.next() < 0.45) {
            const hang = new THREE.Vector3(d.x * 0.3, -1, d.z * 0.3).normalize();
            const hl = cardLen * rnd.range(0.5, 0.7);
            card(lv, p(f0 + 0.2).addScaledVector(UP, 0.05), hang, new THREE.Vector3(d.x, 0, d.z).normalize(), hl * 0.75, hl, u0, u1, crownC, 0.55, ao * 0.9, f0, f0 + 0.2, 0, 1);
          }
        }
      }
      whorl++;
      y += step * rnd.range(0.85, 1.15) * (1 - hRel * 0.35);
    }
    // връх (водач): кръстосани карти
    const topY = crownTop;
    for (let k = 0; k < 2; k++) {
      const d = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(Math.cos(k * 1.57), 0, Math.sin(k * 1.57));
      card(lv, trunkAt(topY - 1.3), d, s, 0.9, 1.6, u0, u1, trunkAt(topY - 2), 0.4, 1, 0.5, 1, 0, 1);
    }
    lods.push({ bark: bark.build(), leaves: lv.build() });
  }
  return { name: `${o.kind}_${o.seed}`, lods, height: H, radius: Rmax + 0.4, trunkR, leaf: o.kind, bark: 'conifer' };
}

// ====================================================================== широколистни
export interface BroadleafOpts {
  seed: number; leaf: 'oak' | 'ash';
  /** височина на разклоняването */
  forkH: number;
  trunkR: number;
  /** брой главни клони, дължина, ъгъл от вертикалата (рад) */
  limbs: number; limbLen: number; limbAngle: number;
  /** втори ред клони на главен клон */
  twigs: number; twigLen: number;
  /** размер на картите с листа */
  leafSize: number; leafDensity: number;
  name: string;
}

export function broadleaf(o: BroadleafOpts): TreeModel {
  const [u0, u1] = UV[o.leaf];
  const lods: TreeLOD[] = [];
  let maxR = 0, maxY = 0;
  for (let lod = 0; lod < 2; lod++) {
    const rnd = new Rand(o.seed);
    const bark = new GeoBuilder(), lv = new GeoBuilder();
    // ствол: леко крив
    const lean = rnd.range(0, 6.283), leanA = rnd.range(0.02, 0.08);
    const trunk: TubePt[] = [];
    const ns = lod === 0 ? 7 : 3;
    for (let i = 0; i <= ns; i++) {
      const f = i / ns, yy = o.forkH * f;
      const p = new THREE.Vector3(Math.sin(lean) * leanA * yy + Math.sin(f * 3 + o.seed) * 0.05, yy, Math.cos(lean) * leanA * yy);
      trunk.push({ p, r: o.trunkR * (1 - 0.3 * f) * (1 + 0.45 * Math.exp(-yy * 3)), ao: 0.5 + 0.5 * Math.min(1, yy / 2) });
    }
    tube(bark, trunk, lod === 0 ? 12 : 6, 2, 1.3, 0, lod === 0 ? (i, a) => (i < 2 ? 1 + 0.25 * Math.max(0, Math.sin(a * 4 + o.seed)) * (1 - i / 2) : 1) : undefined);
    const top = trunk[trunk.length - 1].p;
    const crownC = new THREE.Vector3(top.x, o.forkH + o.limbLen * Math.cos(o.limbAngle) * 0.55, top.z);
    const leafCards: { p: THREE.Vector3; d: THREE.Vector3; size: number }[] = [];
    // главни клони
    const off = rnd.next() * 6.283;
    for (let l = 0; l < o.limbs; l++) {
      const az = off + (l / o.limbs) * 6.283 + rnd.jit(0.4);
      const ang = o.limbAngle * rnd.range(0.75, 1.2);
      const len = o.limbLen * rnd.range(0.8, 1.15);
      const r0 = o.trunkR * 0.62 * rnd.range(0.8, 1.05);
      const pts: TubePt[] = [];
      const nseg = lod === 0 ? 6 : 3;
      let p = top.clone(), d = dirOf(az, Math.PI / 2 - ang);
      for (let i = 0; i <= nseg; i++) {
        const f = i / nseg;
        pts.push({ p: p.clone(), r: r0 * (1 - 0.75 * f), ao: 0.55 + 0.4 * f, sway: f * 0.5 });
        // клоните извиват нагоре и встрани
        d.add(new THREE.Vector3(rnd.jit(0.18), 0.08, rnd.jit(0.18))).normalize();
        p = p.clone().addScaledVector(d, len / nseg);
      }
      tube(bark, pts, lod === 0 ? 6 : 4, 1, 1.0);
      // втори ред
      const nt = lod === 0 ? o.twigs : Math.max(2, Math.round(o.twigs * 0.5));
      for (let t = 0; t < nt; t++) {
        const f = 0.3 + 0.7 * (t + rnd.next() * 0.8) / nt;
        const ip = Math.min(pts.length - 2, Math.floor(f * (pts.length - 1)));
        const pa = pts[ip].p.clone().lerp(pts[ip + 1].p, f * (pts.length - 1) - ip);
        const pd = pts[ip + 1].p.clone().sub(pts[ip].p).normalize();
        const taz = rnd.next() * 6.283;
        const td = pd.clone().multiplyScalar(0.55).add(dirOf(taz, rnd.range(-0.3, 0.5))).normalize();
        const tl = o.twigLen * rnd.range(0.7, 1.2) * (1.15 - f * 0.4);
        const tr = r0 * 0.35 * (1 - f * 0.5);
        const tq = [pa, pa.clone().addScaledVector(td, tl * 0.5).add(new THREE.Vector3(0, tl * 0.06, 0)), pa.clone().addScaledVector(td, tl).add(new THREE.Vector3(0, -tl * 0.05, 0))];
        if (lod === 0) tube(bark, tq.map((q, i) => ({ p: q, r: tr * (1 - i * 0.45), ao: 0.7 + i * 0.12, sway: 0.5 + i * 0.25 })), 3, 1, 0.8);
        // листа: група карти към края на клонката
        const nl = lod === 0 ? Math.round(o.leafDensity * rnd.range(0.8, 1.2)) : 1;
        for (let k = 0; k < nl; k++) {
          const lf = lod === 0 ? 0.35 + 0.65 * (k + 0.5) / nl : 0.6;
          const lp = tq[1].clone().lerp(tq[2], lf).add(new THREE.Vector3(rnd.jit(0.25), rnd.jit(0.2), rnd.jit(0.25)));
          const ld = td.clone().add(new THREE.Vector3(rnd.jit(0.9), rnd.range(-0.1, 0.7), rnd.jit(0.9))).normalize();
          leafCards.push({ p: lp, d: ld, size: o.leafSize * (lod === 0 ? rnd.range(0.8, 1.15) : 1.75) });
        }
      }
      // листа и по края на главния клон
      const nend = lod === 0 ? 3 : 1;
      for (let k = 0; k < nend; k++) {
        const e = pts[pts.length - 1].p.clone().add(new THREE.Vector3(rnd.jit(0.4), rnd.jit(0.3), rnd.jit(0.4)));
        leafCards.push({ p: e, d: d.clone().add(new THREE.Vector3(rnd.jit(0.6), 0.3, rnd.jit(0.6))).normalize(), size: o.leafSize * (lod === 0 ? 1.1 : 1.9) });
      }
    }
    // картите: оклузия според разстоянието до центъра на короната
    let maxD = 0.1;
    for (const c of leafCards) maxD = Math.max(maxD, c.p.distanceTo(crownC));
    for (const c of leafCards) {
      const dd = c.p.distanceTo(crownC) / maxD;
      const ao = 0.38 + 0.62 * Math.min(1, dd * 1.1) * (0.8 + 0.2 * Math.min(1, (c.p.y - o.forkH) / (o.limbLen + 0.1)));
      const sw = 0.6 + 0.4 * dd;
      card(lv, c.p.clone().addScaledVector(c.d, -c.size * 0.3), c.d, sideOf(c.d, rnd.jit(1.2)), c.size * 0.95, c.size, u0, u1, crownC, 0.7, ao, sw, 1, 0.05, 1);
      if (lod === 1) {
        const s2 = sideOf(c.d, rnd.jit(1.2) + 1.57);
        card(lv, c.p.clone().addScaledVector(c.d, -c.size * 0.3), c.d, s2, c.size * 0.95, c.size, u0, u1, crownC, 0.7, ao, sw, 1, 0.05, 1);
      }
      if (lod === 0) { maxR = Math.max(maxR, Math.hypot(c.p.x, c.p.z) + c.size * 0.6); maxY = Math.max(maxY, c.p.y + c.size * 0.7); }
    }
    lods.push({ bark: bark.build(), leaves: lv.build() });
  }
  return { name: o.name, lods, height: maxY, radius: maxR, trunkR: o.trunkR, leaf: o.leaf, bark: 'broadleaf' };
}

// ====================================================================== сухо дърво
export function deadTree(seed: number, height: number): TreeModel {
  const lods: TreeLOD[] = [];
  let maxR = 0.5;
  for (let lod = 0; lod < 2; lod++) {
    const rnd = new Rand(seed);
    const bark = new GeoBuilder();
    const r0 = 0.17 + height * 0.012;
    const tp: TubePt[] = [];
    const ns = lod === 0 ? 8 : 3;
    const lean = new THREE.Vector2(rnd.jit(0.05), rnd.jit(0.05));
    for (let i = 0; i <= ns; i++) {
      const f = i / ns, y = height * f;
      tp.push({ p: new THREE.Vector3(lean.x * y + Math.sin(y * 1.3 + seed) * 0.06, y, lean.y * y), r: r0 * (1 - 0.7 * f) * (1 + 0.5 * Math.exp(-y * 3)), ao: 0.55 + 0.45 * Math.min(1, y / 2) });
    }
    tube(bark, tp, lod === 0 ? 8 : 5, 1, 1.2, 0, lod === 0 ? (i, a) => (i === ns ? 1 + 0.6 * Math.abs(Math.sin(a * 3 + seed)) : 1) : undefined);
    // голи клони
    const nb = lod === 0 ? 7 : 4;
    for (let k = 0; k < nb; k++) {
      const f = rnd.range(0.35, 0.92), y = height * f;
      const base = tp[Math.min(ns, Math.round(f * ns))].p.clone(); base.y = y;
      const d = dirOf(rnd.next() * 6.283, rnd.range(0.1, 0.8));
      const len = rnd.range(0.8, 2.2) * (1.1 - f * 0.5);
      const mid = base.clone().addScaledVector(d, len * 0.5).add(new THREE.Vector3(0, len * 0.08, 0));
      const end = base.clone().addScaledVector(d, len).add(new THREE.Vector3(rnd.jit(0.2), len * 0.15, rnd.jit(0.2)));
      tube(bark, [{ p: base, r: r0 * 0.3 * (1 - f * 0.4), sway: 0 }, { p: mid, r: r0 * 0.18, sway: 0.4 }, { p: end, r: 0.012, sway: 0.8 }], lod === 0 ? 4 : 3, 1, 0.8);
      maxR = Math.max(maxR, Math.hypot(end.x, end.z));
      if (lod === 0) {
        // малки разклонения
        for (let j = 0; j < 2; j++) {
          const s = mid.clone().lerp(end, rnd.range(0.1, 0.7));
          const d2 = d.clone().add(new THREE.Vector3(rnd.jit(0.9), rnd.range(0, 0.8), rnd.jit(0.9))).normalize();
          tube(bark, [{ p: s, r: 0.02, sway: 0.6 }, { p: s.clone().addScaledVector(d2, len * 0.35), r: 0.005, sway: 1 }], 3, 1, 0.5);
        }
      }
    }
    lods.push({ bark: bark.build(), leaves: null });
  }
  return { name: `dead_${seed}`, lods, height, radius: maxR, trunkR: 0.2, leaf: null, bark: 'dead' };
}

// ====================================================================== храст
export function bush(seed: number, leaf: 'oak' | 'ash'): TreeModel {
  const [u0, u1] = UV[leaf];
  const lods: TreeLOD[] = [];
  for (let lod = 0; lod < 2; lod++) {
    const rnd = new Rand(seed);
    const bark = new GeoBuilder(), lv = new GeoBuilder();
    const crownC = new THREE.Vector3(0, 0.55, 0);
    const ns = lod === 0 ? 7 : 0;
    for (let k = 0; k < ns; k++) {
      const d = dirOf(rnd.next() * 6.283, rnd.range(0.7, 1.35));
      const len = rnd.range(0.9, 1.6);
      const b0 = new THREE.Vector3(rnd.jit(0.15), 0, rnd.jit(0.15));
      tube(bark, [{ p: b0, r: 0.025, ao: 0.4 }, { p: b0.clone().addScaledVector(d, len * 0.5), r: 0.017, ao: 0.6, sway: 0.4 }, { p: b0.clone().addScaledVector(d, len).add(new THREE.Vector3(0, -0.1, 0)), r: 0.006, ao: 0.8, sway: 1 }], 3, 1, 0.5);
    }
    const nc = lod === 0 ? 24 : 8;
    for (let k = 0; k < nc; k++) {
      // карти по повърхност на сплескано кълбо, гледат навън
      const az = rnd.next() * 6.283, el = rnd.range(-0.2, 1.3);
      const out = dirOf(az, el);
      const rr = (lod === 0 ? rnd.range(0.35, 0.9) : 0.45) * 1.0;
      const p = new THREE.Vector3(out.x * rr * 1.15, 0.5 + out.y * rr * 0.75, out.z * rr * 1.15);
      const d = out.clone().add(new THREE.Vector3(rnd.jit(0.5), 0.6, rnd.jit(0.5))).normalize();
      const size = lod === 0 ? rnd.range(0.65, 0.95) : rnd.range(1.05, 1.3);
      const ao = 0.42 + 0.58 * Math.min(1, rr / 0.9) * (0.7 + 0.3 * Math.max(0, out.y));
      card(lv, p.clone().addScaledVector(d, -size * 0.35), d, sideOf(d, rnd.jit(1.4)), size * 0.8, size, u0, u1, crownC, 0.75, ao, 0.5, 1, 0.04, 1);
    }
    lods.push({ bark: bark.build(), leaves: lv.build() });
  }
  return { name: `bush_${leaf}_${seed}`, lods, height: 1.6, radius: 1.3, trunkR: 0.05, leaf, bark: 'broadleaf' };
}

// ====================================================================== набор видове
export interface TreeSet {
  /** смърч (млади, после зрели), ела */
  conifers: TreeModel[];
  oaks: TreeModel[];
  fruit: TreeModel[];
  walnut: TreeModel;
  dead: TreeModel[];
  bushes: TreeModel[];
}

/** Всички варианти. Бързо (~десетки ms). */
export function buildTreeSet(): TreeSet {
  return {
    conifers: [
      conifer({ seed: 11, height: 15, kind: 'spruce', crownBase: 0.06, width: 0.23 }),
      conifer({ seed: 23, height: 16, kind: 'spruce', crownBase: 0.1, width: 0.22 }),
      conifer({ seed: 37, height: 18, kind: 'spruce', crownBase: 0.33, width: 0.2 }),
      conifer({ seed: 41, height: 19, kind: 'spruce', crownBase: 0.4, width: 0.19 }),
      conifer({ seed: 53, height: 17, kind: 'fir', crownBase: 0.3, width: 0.2 }),
      conifer({ seed: 67, height: 16, kind: 'fir', crownBase: 0.12, width: 0.22 }),
    ],
    oaks: [
      broadleaf({ seed: 101, name: 'oak_a', leaf: 'oak', forkH: 2.8, trunkR: 0.34, limbs: 4, limbLen: 5.2, limbAngle: 0.75, twigs: 7, twigLen: 2.4, leafSize: 1.75, leafDensity: 5 }),
      broadleaf({ seed: 131, name: 'oak_b', leaf: 'oak', forkH: 3.4, trunkR: 0.32, limbs: 4, limbLen: 5.8, limbAngle: 0.62, twigs: 7, twigLen: 2.2, leafSize: 1.7, leafDensity: 5 }),
    ],
    fruit: [
      broadleaf({ seed: 211, name: 'fruit', leaf: 'ash', forkH: 1.5, trunkR: 0.17, limbs: 4, limbLen: 3.0, limbAngle: 0.85, twigs: 5, twigLen: 1.5, leafSize: 1.3, leafDensity: 5 }),
    ],
    walnut: broadleaf({ seed: 307, name: 'walnut', leaf: 'ash', forkH: 3.4, trunkR: 0.85, limbs: 6, limbLen: 7.0, limbAngle: 0.95, twigs: 10, twigLen: 3.0, leafSize: 2.1, leafDensity: 6 }),
    dead: [deadTree(401, 6.5), deadTree(409, 5.2)],
    bushes: [bush(501, 'ash'), bush(509, 'oak')],
  };
}
