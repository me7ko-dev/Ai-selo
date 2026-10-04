// Ламята — босът: змей-дракон с люспи, 4 крака с нокти, бодли по гърба, дълга опашка и ТРИ шии с глави.
// heads[0] е вдясно на Ламята (-X) = вляво на екрана за играч, който я гледа в лицето; heads[1] — средната; heads[2] — лявата ѝ (+X).
import * as THREE from 'three';
import type { AnimName, LamiaModel } from './types';
import { RigModel } from './rig';
import { mat, part, cylGeo, sphGeo, lowSph, coneGeo, boxGeo, joint, glow, scaleTex, haloSprite, cachedGeo } from './shared';

const NS = 6;            // прешлени на шията
const SEG = 0.66;        // дължина на прешлен
const TS = 6;            // прешлени на опашката
const NECK_REST = [0.2, -0.15, -0.1, 0.25, 0.45, 0.55];
const HEAD_REST = 0.4;
// отмествания за атака (спрямо покоя)
const BACK_OFF = [-0.35, -0.2, -0.1, 0.0, -0.2, -0.3];
const STRIKE_OFF = [1.75, 0.18, 0.1, -0.25, -0.45, -0.55];
const DEAD_OFF = [1.3, 1.2, 0.45, -0.5, -1.0, -0.95];
const HEAD_BACK = -0.5, HEAD_STRIKE = -0.55, HEAD_DEAD = -0.45;
const WINDUP = 0.6, STRIKE = 0.25, HOLD_BITE = 0.4, HOLD_FIRE = 1.3, RECOVER = 0.6;

const s = Math.sin, c = Math.cos;
const TROT = [0, Math.PI, Math.PI, 0];
const sm = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

type HeadMode = 'idle' | 'windup' | 'strike' | 'hold' | 'recover';
interface HeadState { mode: HeadMode; t: number; kind: 'bite' | 'fire'; alive: boolean; deadW: number; wb: number; ws: number; jaw: number; fire: number; }

const texCache = new Map<string, THREE.Texture | null>();
function scales(rx: number, ry: number, belly = false): THREE.Texture | null {
  const key = `${rx}|${ry}|${belly}`;
  if (texCache.has(key)) return texCache.get(key)!;
  const base = scaleTex(belly);
  let t: THREE.Texture | null = null;
  if (base) { t = base.clone(); t.repeat.set(rx, ry); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
  texCache.set(key, t);
  return t;
}
function scaleMat(rx: number, ry: number, belly = false): THREE.Material {
  const t = scales(rx, ry, belly);
  return t ? mat('#ffffff', { map: t }) : mat(belly ? '#cfc27a' : '#6f8a36');
}

export class Lamia extends RigModel implements LamiaModel {
  readonly height = 6.6;
  readonly heads: THREE.Object3D[] = [];
  /** Точка в устата на всяка глава — оттам излиза огънят. */
  readonly mouths: THREE.Object3D[] = [];
  private iBody = 0; private iChest = 1; private iTail = 2; private iLeg = 0; private iNeck: number[] = []; private iHead: number[] = []; private iJaw: number[] = []; private iWing = 0;
  private hs: HeadState[] = [];
  private eyeMeshes: THREE.Mesh[][] = [];
  private mouthGlow: THREE.Mesh[] = [];
  private mouthHalo: THREE.Sprite[] = [];
  private headMeshes: THREE.Mesh[][] = [];
  private scratch = new Float32Array(0);
  private bodyY = 1.95;

  constructor() {
    super();
    const r = this.root;
    const body = joint(r, 0, this.bodyY, 0, 'body');
    const chest = joint(body, 0, 0.2, 1.3, 'chest');
    this.iBody = this.addJoint(body);
    this.iChest = this.addJoint(chest);
    const skin = scaleMat(6, 3), skinS = scaleMat(3, 1), belly = scaleMat(1, 6, true);
    const dark = mat('#2e3f1e'), spikeM = mat('#c9b46a'), claw = mat('#e8dfc0'), horn = mat('#d9cba0');
    // тяло
    part(body, sphGeo(2), skin, 1.45, 1.3, 2.1, 0, 0, -0.2);
    part(body, sphGeo(1), belly, 1.2, 0.8, 1.9, 0, -0.6, -0.2, 0, 0, 0, false);
    part(chest, sphGeo(1), skin, 1.25, 1.2, 1.3, 0, 0.1, 0.2);
    part(chest, sphGeo(1), belly, 1.0, 0.75, 1.1, 0, -0.42, 0.35, 0, 0, 0, false);
    part(body, sphGeo(1), skin, 1.15, 1.05, 1.3, 0, -0.05, -1.9);
    // бодли по гърба
    for (let i = 0; i < 8; i++) {
      const z = 1.7 - i * 0.55, hgt = 0.45 + 0.25 * Math.sin((i / 7) * Math.PI);
      const y = 1.25 - Math.abs(z + 0.2) * 0.12;
      part(i < 2 ? chest : body, coneGeo(4), spikeM, 0.16, hgt, 0.3, 0, i < 2 ? y - 0.05 : y, i < 2 ? z - 1.3 : z, -0.35, 0, 0);
    }
    // опашка
    this.iTail = this.joints.length;
    let prev: THREE.Object3D = body;
    for (let i = 0; i < TS; i++) {
      const tj = joint(prev, 0, i === 0 ? -0.15 : 0.85, i === 0 ? -2.4 : 0, 'tail' + i);
      tj.rotation.x = i === 0 ? -1.87 : 0.1;
      this.addJoint(tj);
      const r0 = 0.8 * (1 - i / TS) + 0.08, r1 = 0.8 * (1 - (i + 1) / TS) + 0.06;
      part(tj, cylGeo(Math.round((r1 / r0) * 20) / 20, 8), skinS, r0, 0.9, r0 * 0.9);
      part(tj, coneGeo(4), spikeM, 0.08 + r0 * 0.12, 0.25 + r0 * 0.35, 0.18, 0, 0.45, r0 * 0.85, 0.5, 0, 0, false);
      prev = tj;
    }
    part(prev, coneGeo(4), spikeM, 0.28, 0.6, 0.08, 0, 0.85, 0, 0, 0, 0);
    // крака
    this.iLeg = this.joints.length;
    const legs: [THREE.Object3D, number, number, number][] = [[chest, 1.05, -0.45, 0.3], [chest, -1.05, -0.45, 0.3], [body, 1.1, -0.35, -1.7], [body, -1.1, -0.35, -1.7]];
    for (const [par, x, y, z] of legs) {
      const u = joint(par, x, y, z);
      u.rotation.z = Math.sign(x) * 0.45;
      const l = joint(u, 0, -0.9, 0);
      l.rotation.z = -Math.sign(x) * 0.45;
      this.addJoint(u); this.addJoint(l);
      part(u, sphGeo(1), skinS, 0.55, 0.55, 0.6, 0, 0, 0);
      part(u, cylGeo(0.65, 7), skinS, 0.5, 0.95, 0.52, 0, 0, 0, Math.PI, 0, 0);
      part(l, sphGeo(0), skinS, 0.34, 0.3, 0.36, 0, 0, 0, 0, 0, 0, false);
      part(l, cylGeo(0.8, 6), skinS, 0.32, 0.85, 0.34, 0, 0, 0, Math.PI, 0, 0);
      part(l, sphGeo(0), dark, 0.36, 0.16, 0.46, 0, -0.85, 0.12, 0, 0, 0, false);
      for (let k = -1; k <= 1; k++) part(l, coneGeo(4), claw, 0.06, 0.28, 0.06, k * 0.14, -0.9, 0.45, Math.PI / 2 + 0.3, 0, 0, false);
    }
    // криле (малки)
    this.iWing = this.joints.length;
    const wingGeo = cachedGeo('lamiaWing', () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(1.6, 0.9); sh.lineTo(1.9, 0.2); sh.lineTo(1.4, -0.1); sh.lineTo(1.1, -0.6); sh.lineTo(0.6, -0.4); sh.lineTo(0, -0.3); sh.closePath();
      return new THREE.ShapeGeometry(sh);
    });
    const wingM = mat('#8a5a36', { side: THREE.DoubleSide });
    for (const sx of [1, -1]) {
      const w = joint(body, sx * 0.9, 1.0, 0.7);
      w.rotation.set(0, sx > 0 ? 1.15 : Math.PI - 1.15, 0.35);
      this.addJoint(w);
      const wm = new THREE.Mesh(wingGeo, wingM); wm.castShadow = true; w.add(wm);
    }
    // шии и глави
    const xs = [-0.75, 0, 0.75];
    for (let h = 0; h < 3; h++) {
      const idx: number[] = [];
      let p: THREE.Object3D = chest;
      for (let k = 0; k < NS; k++) {
        const nj = k === 0 ? joint(chest, xs[h], 0.6, 0.9) : joint(p, 0, SEG, 0);
        nj.rotation.x = NECK_REST[k];
        if (k === 0) { nj.rotation.z = -xs[h] * 0.45; nj.rotation.y = 0; }
        idx.push(this.addJoint(nj));
        const r0 = 0.5 - k * 0.045, r1 = 0.5 - (k + 1) * 0.045;
        part(nj, cylGeo(Math.round((r1 / r0) * 20) / 20, 8), skinS, r0, SEG + 0.04, r0 * 0.9);
        part(nj, lowSph(8, 5), skinS, r0 * 1.02, r0 * 0.6, r0 * 0.92, 0, 0, 0, 0, 0, 0, false);
        part(nj, coneGeo(4), spikeM, 0.06, 0.22, 0.12, 0, SEG * 0.5, -r0 * 0.88, -Math.PI / 2 - 0.4, 0, 0, false);
        p = nj;
      }
      this.iNeck.push(idx[0]);
      const head = joint(p, 0, SEG, 0, 'head' + h);
      head.rotation.x = HEAD_REST;
      this.iHead.push(this.addJoint(head));
      this.heads.push(head);
      const hm: THREE.Mesh[] = [];
      // череп и муцуна (+Y напред по шията, -Z е темето, +Z е долната челюст)
      hm.push(part(head, sphGeo(1), skin, 0.36, 0.5, 0.32, 0, 0.25, -0.05));
      hm.push(part(head, cylGeo(0.6, 6), skinS, 0.27, 0.65, 0.18, 0, 0.45, -0.07));
      part(head, coneGeo(4), dark, 0.05, 0.1, 0.05, 0.1, 1.08, -0.12, 0, 0, 0, false);
      part(head, coneGeo(4), dark, 0.05, 0.1, 0.05, -0.1, 1.08, -0.12, 0, 0, 0, false);
      // рога
      for (const sx of [1, -1]) {
        part(head, coneGeo(5), horn, 0.08, 0.6, 0.08, sx * 0.2, 0.15, -0.3, -2.5, 0, sx * 0.35);
        part(head, coneGeo(4), horn, 0.05, 0.3, 0.05, sx * 0.3, 0.32, -0.15, -2.2, 0, sx * 0.9, false);
      }
      // гребен
      for (let k = 0; k < 3; k++) part(head, coneGeo(4), spikeM, 0.05, 0.18, 0.1, 0, 0.1 + k * 0.2, -0.36, -Math.PI / 2 - 0.5, 0, 0, false);
      // очи
      const eyes: THREE.Mesh[] = [];
      for (const sx of [1, -1]) eyes.push(part(head, sphGeo(0), glow('#ffb52e'), 0.07, 0.1, 0.05, sx * 0.28, 0.45, -0.2, 0, 0, 0, false));
      const eh = haloSprite('#ffa030', 0.9, 0.5); eh.position.set(0, 0.45, -0.25); head.add(eh);
      eyes.push(eh as unknown as THREE.Mesh);
      this.eyeMeshes.push(eyes);
      // горни зъби
      for (let k = 0; k < 4; k++) for (const sx of [1, -1]) part(head, coneGeo(3), claw, 0.025, 0.09, 0.025, sx * 0.18, 0.6 + k * 0.12, 0.08, Math.PI / 2 + 1.2, 0, 0, false);
      // долна челюст
      const jaw = joint(head, 0, 0.3, 0.1, 'jaw' + h);
      this.iJaw.push(this.addJoint(jaw));
      hm.push(part(jaw, cylGeo(0.55, 6), skinS, 0.24, 0.72, 0.1, 0, 0, 0.04));
      for (let k = 0; k < 3; k++) for (const sx of [1, -1]) part(jaw, coneGeo(3), claw, 0.022, 0.08, 0.022, sx * 0.13, 0.3 + k * 0.12, -0.02, -Math.PI / 2 - 1.2, 0, 0, false);
      // огън в устата
      const mg = part(head, sphGeo(1), glow('#ff8a2a', 0.9), 0.16, 0.42, 0.12, 0, 0.62, 0.08, 0, 0, 0, false);
      mg.visible = false; this.mouthGlow.push(mg);
      const mh = haloSprite('#ff7a1a', 2.2, 0.8); mh.position.set(0, 0.9, 0.1); mh.visible = false; head.add(mh); this.mouthHalo.push(mh);
      const mouth = new THREE.Object3D(); mouth.position.set(0, 1.1, 0.06); head.add(mouth); this.mouths.push(mouth);
      this.headMeshes.push(hm);
      this.hs.push({ mode: 'idle', t: 0, kind: 'bite', alive: true, deadW: 0, wb: 0, ws: 0, jaw: 0, fire: 0 });
    }
    this.finish();
    this.scratch = new Float32Array(this.cur.length);
  }

  protected stride(run: boolean): number { return run ? 5 : 3.2; }
  protected mapAnim(a: AnimName): AnimName {
    switch (a) {
      case 'walk': case 'run': case 'hit': case 'die': case 'idle': return a;
      case 'sit': case 'sleep': return 'sleep';
      default: return 'idle';
    }
  }
  protected duration(a: AnimName): number { return a === 'die' ? 2.0 : a === 'hit' ? 0.5 : 0.6; }

  play(anim: AnimName, opts?: { loop?: boolean; speed?: number }): void {
    // атаките на тялото са атаки с глави
    if (anim === 'attack') { this.headAttack(this.pickHead(), 'bite'); return; }
    if (anim === 'attack2') { this.headAttack(this.pickHead(), 'fire'); return; }
    if (anim === 'cast') { for (let i = 0; i < 3; i++) this.headAttack(i, 'fire'); return; }
    super.play(anim, opts);
  }
  private pickHead(): number {
    const alive = [1, 0, 2].filter((i) => this.hs[i].alive && this.hs[i].mode === 'idle');
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : 1;
  }

  setHeadAlive(i: number, alive: boolean): void {
    const h = this.hs[i]; if (!h) return;
    h.alive = alive;
    if (!alive) { h.mode = 'idle'; h.fire = 0; }
    const em = this.eyeMeshes[i];
    for (let k = 0; k < 2; k++) this.setMeshMat(em[k], alive ? glow('#ffb52e') : mat('#1c1c14'));
    em[2].visible = alive;
    const dm = alive ? null : mat('#5a5a48');
    const hm = this.headMeshes[i];
    // тъмна, „мъртва“ глава — подмяна на материала на черепа, муцуната и челюстта
    for (const m of hm) this.setMeshMat(m, dm ?? (m === hm[0] ? scaleMat(6, 3) : scaleMat(3, 1)));
  }

  /** Атака с глава: замах назад (~0.6 с), после удар ниско пред Ламята. Ударът каца в ~0.85 с. */
  headAttack(i: number, kind: 'bite' | 'fire' = 'bite'): void {
    const h = this.hs[i]; if (!h || !h.alive || this.active === 'die') return;
    if (h.mode !== 'idle' && h.mode !== 'recover') return;
    h.mode = 'windup'; h.t = 0; h.kind = kind;
  }
  /** Фаза на атаката на глава i (за бойната логика): 'idle' | 'windup' | 'strike' | 'hold' | 'recover'. */
  headPhase(i: number): HeadMode { return this.hs[i]?.mode ?? 'idle'; }

  private stepHeads(dt: number): void {
    for (let i = 0; i < 3; i++) {
      const h = this.hs[i];
      h.deadW += ((h.alive && this.active !== 'die' && this.active !== 'sleep' ? 0 : 1) - h.deadW) * Math.min(1, dt * (this.active === 'sleep' ? 1.5 : 2.5));
      h.t += dt;
      const hold = h.kind === 'fire' ? HOLD_FIRE : HOLD_BITE;
      switch (h.mode) {
        case 'idle': h.wb += (0 - h.wb) * Math.min(1, dt * 6); h.ws += (0 - h.ws) * Math.min(1, dt * 6); h.jaw = 0; h.fire = 0; break;
        case 'windup': {
          const k = sm(h.t / WINDUP); h.wb = k; h.ws = 0; h.jaw = 0.25 * k;
          if (h.t >= WINDUP) { h.mode = 'strike'; h.t = 0; }
          break;
        }
        case 'strike': {
          const k = Math.min(1, h.t / STRIKE); const e = k * k * (3 - 2 * k);
          h.wb = 1 - e; h.ws = e;
          h.jaw = h.kind === 'fire' ? 0.25 + 0.5 * e : 0.25 + 0.45 * Math.sin(k * Math.PI);
          if (h.t >= STRIKE) { h.mode = 'hold'; h.t = 0; }
          break;
        }
        case 'hold': {
          h.wb = 0; h.ws = 1;
          if (h.kind === 'fire') { h.jaw = 0.75 + 0.05 * s(h.t * 20); h.fire = Math.min(1, h.t / 0.15); }
          else h.jaw = Math.max(0, 0.1 - h.t);
          if (h.t >= hold) { h.mode = 'recover'; h.t = 0; }
          break;
        }
        case 'recover': {
          const e = sm(h.t / RECOVER); h.ws = 1 - e; h.wb = 0; h.jaw *= 0.9; h.fire = Math.max(0, h.fire - dt * 5);
          if (h.t >= RECOVER) { h.mode = 'idle'; h.t = 0; }
          break;
        }
      }
      const mg = this.mouthGlow[i];
      mg.visible = h.fire > 0.02;
      this.mouthHalo[i].visible = mg.visible;
      if (mg.visible) { const k = h.fire * (0.85 + 0.15 * s(this.time * 30 + i)); mg.scale.set(0.2 * k, 0.5 * k, 0.15 * k); this.mouthHalo[i].scale.set(2.2 * k, 2.2 * k, 1); }
    }
  }

  protected pose(a: AnimName, t: number, o: Float32Array): void {
    const T = this.time;
    const P = this.nJ * 3;
    const B = this.iBody * 3, C = this.iChest * 3;
    const breath = s(T * 1.3);
    o[P + 1] = 0.05 * breath;
    o[C] = -0.02 * breath;
    // шиите се люлеят независимо
    for (let h = 0; h < 3; h++) {
      const ph = h * 2.1;
      for (let k = 0; k < NS; k++) {
        const j = (this.iNeck[h] + k) * 3;
        o[j] = 0.05 * s(T * 0.8 + ph - k * 0.4);
        o[j + 2] = 0.07 * s(T * 0.55 + ph - k * 0.5);
      }
      const hj = this.iHead[h] * 3;
      o[hj + 2] = 0.25 * s(T * 0.4 + ph);
      o[hj] = 0.08 * s(T * 0.7 + ph);
      o[this.iJaw[h] * 3] = 0.12 * Math.max(0, s(T * 0.5 + ph * 1.7));
    }
    for (let k = 0; k < TS; k++) o[(this.iTail + k) * 3 + 2] = 0.1 * s(T * 1.1 - k * 0.7);
    const W = this.iWing * 3;
    o[W + 2] = 0.08 * s(T * 0.9); o[W + 5] = -0.08 * s(T * 0.9);
    const L = this.iLeg;
    switch (a) {
      case 'walk': case 'run': {
        const p = this.phase, run = a === 'run';
        const A = run ? 0.55 : 0.38;
        for (let i = 0; i < 4; i++) {
          const q = p + TROT[i];
          o[(L + i * 2) * 3] = -A * s(q);
          o[(L + i * 2 + 1) * 3] = 0.5 * Math.max(0, c(q));
        }
        o[B + 2] = 0.05 * s(p); o[B + 1] = 0.04 * s(p);
        o[P + 1] += 0.06 * Math.abs(s(p));
        for (let k = 0; k < TS; k++) o[(this.iTail + k) * 3 + 2] = 0.2 * s(p - k * 0.8);
        for (let h = 0; h < 3; h++) o[this.iNeck[h] * 3] += 0.06 * s(p * 2 + h);
        break;
      }
      case 'hit': {
        const e = s(Math.min(1, t / 0.5) * Math.PI);
        o[C] -= 0.2 * e; o[B] -= 0.06 * e; o[P + 2] = -0.25 * e;
        for (let h = 0; h < 3; h++) for (let k = 0; k < 3; k++) o[(this.iNeck[h] + k) * 3] -= 0.18 * e;
        break;
      }
      case 'die': {
        const e = sm(t / 1.6);
        o[P + 1] = -(this.bodyY - 1.15) * e; o[B + 2] = 0.22 * e; o[C] = 0.15 * e;
        for (let i = 0; i < 4; i++) { const sx = i % 2 ? -1 : 1; o[(L + i * 2) * 3 + 2] = sx * 0.55 * e; o[(L + i * 2) * 3] = (i < 2 ? -0.5 : 0.4) * e; o[(L + i * 2 + 1) * 3] = (i < 2 ? 1.1 : 0.9) * e; }
        for (let k = 0; k < TS; k++) o[(this.iTail + k) * 3 + 2] = 0.12 * e * (k + 1) * 0.3;
        o[W + 2] = -0.5 * e; o[W + 5] = 0.5 * e;
        break;
      }
      case 'sleep': {
        o[P + 1] = -(this.bodyY - 1.2) + 0.04 * s(T * 0.6);
        for (let i = 0; i < 4; i++) { const sx = i % 2 ? -1 : 1; o[(L + i * 2) * 3] = i < 2 ? -0.9 : -0.6; o[(L + i * 2 + 1) * 3] = i < 2 ? 1.6 : 1.3; o[(L + i * 2) * 3 + 2] = sx * 0.3; }
        for (let k = 0; k < TS; k++) o[(this.iTail + k) * 3 + 2] = 0.3 + 0.02 * s(T * 0.5 - k);
        break;
      }
    }
  }

  update(dt: number, moveSpeed?: number): void {
    if (dt > 0.1) dt = 0.1;
    this.stepHeads(dt);
    super.update(dt, moveSpeed);
  }

  protected apply(): void {
    if (!this.scratch.length) { super.apply(); return; }
    const cur = this.cur;
    this.scratch.set(cur);
    for (let h = 0; h < 3; h++) {
      const st = this.hs[h];
      const dw = st.deadW;
      for (let k = 0; k < NS; k++) {
        const j = (this.iNeck[h] + k) * 3;
        const atk = BACK_OFF[k] * st.wb + STRIKE_OFF[k] * st.ws;
        cur[j] = (cur[j] + atk) * (1 - dw) + DEAD_OFF[k] * dw;
        if (k === 0) cur[j + 2] = cur[j + 2] * (1 - dw) + (h - 1) * 0.55 * dw;
        else cur[j + 2] *= 1 - dw;
        if (st.mode === 'hold' && st.kind === 'fire') cur[j + 2] += 0.06 * s(st.t * 3) ;
      }
      const hj = this.iHead[h] * 3;
      cur[hj] = (cur[hj] + HEAD_BACK * st.wb + HEAD_STRIKE * st.ws) * (1 - dw) + HEAD_DEAD * dw;
      cur[hj + 2] *= 1 - dw * 0.5;
      cur[hj + 1] = cur[hj + 1] * (1 - dw) + (h - 1) * 0.4 * dw;
      const jj = this.iJaw[h] * 3;
      cur[jj] = (cur[jj] + st.jaw) * (1 - dw) + 0.25 * dw;
    }
    super.apply();
    cur.set(this.scratch);
  }
}
void boxGeo;
