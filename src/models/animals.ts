// Животни: овца, коза (със звънче), куче, котка, конче (с черга на гърба), лисица-таласъм (четириноги) и кокошка.
import * as THREE from 'three';
import type { AnimName, AnimalKind } from './types';
import { RigModel } from './rig';
import { mat, part, cylGeo, sphGeo, lowSph, coneGeo, boxGeo, capGeo, joint, glow, haloSprite, cachedGeo, shevicaTex } from './shared';
import { furFrom } from './skin';
import { charactersReady } from './gltf/assets';

const s = Math.sin, c = Math.cos, max = Math.max;
const sm = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

// индекси на ставите на четириногите
const BODY = 0, NECK = 1, HEAD = 2, TAIL = 3, TAIL2 = 4, FLU = 5, FLL = 6, FRU = 7, FRL = 8, BLU = 9, BLL = 10, BRU = 11, BRL = 12;
const QJ = 13, QP = QJ * 3;
const GALLOP = [0, 0.35, 2.4, 2.8], TROT = [0, Math.PI, Math.PI, 0];
const LEG_IDS = [FLU, FLL, FRU, FRL, BLU, BLL, BRU, BRL];

export type QuadKind = AnimalKind | 'fox_talasam';
const MANE = '#211813';

interface QuadSpec {
  len: number; r: number; leg: number; legR: number; neck: number; neckTilt: number; head: number;
  body: string; legC: string; face: string; tail: number; tailUp: number; stepLen: number;
}
const SPECS: Record<Exclude<QuadKind, 'chicken'>, QuadSpec> = {
  sheep: { len: 0.72, r: 0.25, leg: 0.36, legR: 0.03, neck: 0.12, neckTilt: -0.9, head: 0.12, body: '#efebe0', legC: '#3a302a', face: '#3a302a', tail: 0.1, tailUp: 2.6, stepLen: 0.7 },
  goat: { len: 0.66, r: 0.17, leg: 0.44, legR: 0.026, neck: 0.22, neckTilt: -0.45, head: 0.11, body: '#a58a6c', legC: '#6a5440', face: '#e8e0d0', tail: 0.1, tailUp: -0.6, stepLen: 0.8 },
  dog: { len: 0.6, r: 0.15, leg: 0.36, legR: 0.03, neck: 0.15, neckTilt: -0.6, head: 0.11, body: '#4a3524', legC: '#e6d9c4', face: '#4a3524', tail: 0.28, tailUp: -1.1, stepLen: 0.9 },
  cat: { len: 0.36, r: 0.085, leg: 0.2, legR: 0.018, neck: 0.06, neckTilt: -0.7, head: 0.075, body: '#77767c', legC: '#77767c', face: '#8a898f', tail: 0.32, tailUp: -0.35, stepLen: 0.45 },
  // доресто балканско конче (~1,35 м до холката): тъмна грива, опашка и долни части на краката
  horse: { len: 1.3, r: 0.36, leg: 0.8, legR: 0.05, neck: 0.6, neckTilt: -0.95, head: 0.2, body: '#7a5034', legC: '#241a14', face: '#7a5034', tail: 0.8, tailUp: -2.75, stepLen: 1.5 },
  fox_talasam: { len: 0.62, r: 0.13, leg: 0.26, legR: 0.024, neck: 0.14, neckTilt: -0.7, head: 0.1, body: '#c0622a', legC: '#3a2418', face: '#c0622a', tail: 0.5, tailUp: 1.9, stepLen: 0.85 },
};

export class Quadruped extends RigModel {
  readonly height: number;
  private sp: QuadSpec;
  private bodyY: number;
  readonly kind: QuadKind;

  constructor(kind: Exclude<QuadKind, 'chicken'>) {
    super();
    this.kind = kind;
    this.realistic = charactersReady();
    const S = this.sp = SPECS[kind];
    const r = this.root;
    const bodyY = this.bodyY = S.leg + S.r * 0.55;
    const body = joint(r, 0, bodyY, 0, 'body');
    const neck = joint(body, 0, S.r * 0.35, S.len * 0.45, 'neck');
    neck.rotation.x = -S.neckTilt;
    const head = joint(neck, 0, S.neck, 0, 'head');
    head.rotation.x = S.neckTilt + (kind === 'horse' ? 1.3 : 0); // конят държи муцуната надолу
    const tail = joint(body, 0, S.r * 0.4, -S.len * 0.5, 'tail');
    tail.rotation.x = S.tailUp;
    const tail2 = joint(tail, 0, S.tail * 0.5, 0, 'tail2');
    if (kind === 'dog') tail2.rotation.x = 0.9;
    if (kind === 'cat') tail2.rotation.x = -0.5;
    const legJ: THREE.Group[] = [];
    const lx = S.r * 0.62, fz = S.len * 0.36, bz = -S.len * 0.36, ly = -S.r * 0.35;
    const L2 = S.leg * 0.5, L1 = bodyY + ly - L2;
    for (const [x, z] of [[lx, fz], [-lx, fz], [lx, bz], [-lx, bz]]) {
      const u = joint(body, x, ly, z);
      const l = joint(u, 0, -L1, 0);
      legJ.push(u, l);
    }
    for (const j of [body, neck, head, tail, tail2, ...legJ]) this.addJoint(j);
    this.height = bodyY + S.r + S.neck * 0.6 + S.head;

    const bm = mat(S.body), lm = mat(S.legC), fm = mat(S.face);
    const fox = kind === 'fox_talasam';
    const foxM = fox ? mat(S.body, { emissive: '#1a3a66', emissiveIntensity: 0.25 }) : bm;
    // тяло
    if (kind === 'sheep') {
      part(body, sphGeo(1), bm, S.r * 1.05, S.r * 0.95, S.len * 0.55, 0, 0, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        part(body, sphGeo(0), bm, S.r * 0.5, S.r * 0.45, S.r * 0.5, Math.cos(a) * S.r * 0.75, Math.abs(Math.sin(a)) * S.r * 0.5 + 0.02, (i % 3 - 1) * S.len * 0.3, a, a, 0, false);
      }
    } else {
      part(body, sphGeo(1), foxM, S.r, S.r * 0.95, S.len * 0.55, 0, 0, 0);
      part(body, sphGeo(0), foxM, S.r * 0.95, S.r, S.r * 1.1, 0, S.r * 0.05, S.len * 0.32);
    }
    if (kind === 'dog' || fox || kind === 'goat') part(body, sphGeo(0), mat(kind === 'goat' ? '#e8e0d0' : '#ece2d0'), S.r * 0.6, S.r * 0.7, S.r * 0.5, 0, -S.r * 0.15, S.len * 0.45, 0, 0, 0, false);
    // шия и глава
    if (kind === 'horse') {
      // дълбока, плоска отстрани шия, по-дебела при гърдите
      part(neck, cylGeo(0.62, 8), bm, S.r * 0.4, S.neck + S.head * 0.35, S.r * 0.78, 0, -S.r * 0.3, -S.r * 0.05);
    } else part(neck, cylGeo(0.8, 6), kind === 'sheep' ? bm : foxM, S.r * 0.42, S.neck + S.head * 0.3, S.r * 0.42, 0, -S.r * 0.1, 0);
    const hg = part(head, sphGeo(1), kind === 'sheep' ? fm : foxM, S.head * 0.8, S.head * 0.85, S.head, 0, 0, S.head * 0.2);
    void hg;
    // муцуна
    const snoutLen = kind === 'horse' ? 2.1 : kind === 'fox_talasam' ? 1.3 : kind === 'dog' ? 1.0 : kind === 'goat' ? 0.9 : kind === 'cat' ? 0.35 : 0.7;
    part(head, cylGeo(kind === 'horse' ? 0.9 : 0.55, 6), kind === 'sheep' ? fm : (kind === 'dog' || kind === 'goat') ? mat(kind === 'goat' ? '#d8cfbd' : '#e6d9c4') : fox ? foxM : fm, S.head * (kind === 'horse' ? 0.62 : 0.5), S.head * snoutLen, S.head * (kind === 'horse' ? 0.62 : 0.45), 0, -S.head * 0.2, S.head * 0.7, Math.PI / 2 - 0.15, 0, 0);
    part(head, sphGeo(0), mat('#1a1414'), S.head * 0.14, S.head * 0.12, S.head * 0.12, 0, -S.head * 0.12, S.head * (0.75 + snoutLen), 0, 0, 0, false);
    // очи
    for (const x of [1, -1]) {
      const em = fox ? glow('#8fe8ff') : mat('#141010');
      part(head, sphGeo(0), em, S.head * 0.13, S.head * 0.15, S.head * 0.1, x * S.head * 0.45, S.head * 0.2, S.head * 0.75, 0, 0, 0, false);
    }
    // уши
    for (const x of [1, -1]) {
      if (kind === 'horse') part(head, coneGeo(5), bm, S.head * 0.17, S.head * 0.65, S.head * 0.1, x * S.head * 0.38, S.head * 0.65, -S.head * 0.15, -0.25, 0, -x * 0.2);
      else if (kind === 'cat' || fox) part(head, coneGeo(4), fox ? foxM : bm, S.head * 0.3, S.head * (fox ? 0.9 : 0.7), S.head * 0.15, x * S.head * 0.45, S.head * 0.6, S.head * 0.05, 0, 0, -x * 0.25);
      else if (kind === 'dog') part(head, boxGeo(), mat('#3a281a'), S.head * 0.3, S.head * 0.6, S.head * 0.1, x * S.head * 0.75, S.head * 0.15, 0, 0, 0, x * 0.35);
      else part(head, sphGeo(0), kind === 'sheep' ? fm : bm, S.head * 0.45, S.head * 0.15, S.head * 0.22, x * S.head * 0.9, S.head * 0.3, -S.head * 0.05, 0, 0, -x * 0.4);
    }
    if (kind === 'sheep') part(head, sphGeo(0), bm, S.head * 0.75, S.head * 0.5, S.head * 0.7, 0, S.head * 0.65, -S.head * 0.05, 0, 0, 0, false);
    if (kind === 'goat') {
      const horn = mat('#d8cdb0');
      for (const x of [1, -1]) part(head, coneGeo(5), horn, S.head * 0.17, S.head * 1.3, S.head * 0.17, x * S.head * 0.3, S.head * 0.6, -S.head * 0.1, -0.9, 0, -x * 0.2);
      part(head, coneGeo(4), mat('#e8e0d0'), S.head * 0.18, S.head * 0.7, S.head * 0.18, 0, -S.head * 0.55, S.head * 0.85, Math.PI - 0.3, 0, 0, false);
      // звънче на шията
      part(neck, coneGeo(6), mat('#c9a040'), 0.035, 0.06, 0.035, 0, 0.02, S.r * 0.45, 0, 0, 0, false);
      part(neck, cylGeo(1, 6, true), mat('#8a3a2a', { side: THREE.DoubleSide }), S.r * 0.46, 0.02, S.r * 0.46, 0, 0.07, 0, 0, 0, 0, false);
    }
    if (kind === 'dog') part(neck, cylGeo(1, 6, true), mat('#b3262b', { side: THREE.DoubleSide }), S.r * 0.44, 0.025, S.r * 0.44, 0, 0.04, 0, 0, 0, 0, false);
    if (kind === 'horse') {
      const maneM = mat(MANE);
      // грива по тила (на кичури) + перчем между ушите
      for (let i = 0; i < 6; i++) {
        const f = i / 5;
        part(neck, boxGeo(), maneM, S.r * 0.09, S.neck * 0.22, S.r * (0.42 - f * 0.12), (i % 2 ? 0.012 : -0.012), S.neck * (0.1 + f * 0.85), -S.r * (0.42 - f * 0.06), 0.25, 0, (i % 2 ? 0.08 : -0.08));
      }
      part(head, coneGeo(5), maneM, S.head * 0.22, S.head * 0.55, S.head * 0.12, 0, S.head * 0.55, S.head * 0.25, 1.9, 0, 0, false);
      // бяла звезда на челото
      part(head, sphGeo(0), mat('#efe9df'), S.head * 0.22, S.head * 0.3, S.head * 0.08, 0, S.head * 0.45, S.head * 0.82, -0.3, 0, 0, false);
      // по-плътни гърди и задница
      part(body, sphGeo(1), bm, S.r * 1.02, S.r * 1.0, S.r * 1.15, 0, -S.r * 0.02, -S.len * 0.33);
      // черга с шевици (червено-черна) на гърба
      const st = shevicaTex('#a8282a');
      const bl = st ? mat('#ffffff', { map: st, side: THREE.DoubleSide, flat: false }) : mat('#a8282a', { side: THREE.DoubleSide });
      part(body, capGeo(14, 6, Math.PI * 0.5), bl, S.r * 1.07, S.r * 1.03, S.len * 0.38, 0, 0, S.len * 0.04, 0, 0, 0, false);
    }
    // опашка
    if (fox) {
      const tm = mat('#d98a4a', { emissive: '#4ab0ff', emissiveIntensity: 0.9 });
      part(tail, sphGeo(1), foxM, S.r * 0.4, S.tail * 0.35, S.r * 0.4, 0, S.tail * 0.2, 0);
      part(tail2, sphGeo(1), tm, S.r * 0.55, S.tail * 0.42, S.r * 0.55, 0, S.tail * 0.2, 0);
      part(tail2, sphGeo(0), glow('#bfeeff'), S.r * 0.35, S.tail * 0.18, S.r * 0.35, 0, S.tail * 0.55, 0, 0, 0, 0, false);
      const h = haloSprite('#6ac8ff', 0.55, 0.55); h.position.y = S.tail * 0.4; tail2.add(h);
      const eh = haloSprite('#8fe8ff', 0.3, 0.5); eh.position.set(0, S.head * 0.2, S.head * 0.85); head.add(eh);
    } else if (kind === 'horse') {
      // опашка от косми: разширява се надолу
      part(tail, cylGeo(1.8, 7), mat(MANE), 0.05, S.tail * 0.52, 0.04, 0, 0, 0);
      part(tail2, cylGeo(1.2, 7), mat(MANE), 0.09, S.tail * 0.58, 0.07, 0, 0, 0);
    } else if (kind === 'sheep' || kind === 'goat') {
      part(tail, sphGeo(0), kind === 'sheep' ? bm : bm, S.r * 0.25, S.tail, S.r * 0.2, 0, S.tail * 0.3, 0, 0, 0, 0, false);
    } else {
      part(tail, cylGeo(0.7, 5), bm, S.r * 0.18, S.tail * 0.52, S.r * 0.18, 0, 0, 0);
      part(tail2, cylGeo(0.5, 5), bm, S.r * 0.13, S.tail * 0.5, S.r * 0.13, 0, 0, 0);
    }
    // крака
    for (let i = 0; i < 4; i++) {
      const u = legJ[i * 2], l = legJ[i * 2 + 1];
      const upLen = -l.position.y;
      part(u, cylGeo(0.75, 5), kind === 'sheep' || kind === 'horse' ? bm : (kind === 'dog' ? bm : fox ? foxM : lm), S.legR * (kind === 'sheep' ? 2.4 : kind === 'horse' ? 2.6 : 1.6), upLen, S.legR * (kind === 'sheep' ? 2.4 : 1.6), 0, 0, 0, Math.PI, 0, 0);
      part(l, cylGeo(0.8, 5), lm, S.legR, L2, S.legR, 0, 0, 0, Math.PI, 0, 0);
      part(l, boxGeo(), mat(kind === 'sheep' || kind === 'goat' ? '#2a2420' : S.legC), S.legR * 2.2, S.legR * 1.4, S.legR * 2.8, 0, -L2 + S.legR * 0.7, S.legR * 0.5, 0, 0, 0, false);
    }
    void L2;
    this.finish();
  }

  protected stride(run: boolean): number { return this.sp.stepLen * (run ? 2.2 : 1); }

  /** Козината/вълната по цвета на частта (тялото, краката, муцуната, белите петна, опашката на лисицата). */
  protected skinFor(m: THREE.MeshLambertMaterial): THREE.Material | undefined {
    const hex = '#' + m.color.getHexString(), S = this.sp, sheep = this.kind === 'sheep';
    if (hex === S.body) return furFrom(sheep ? 'wool' : 'fur', hex, m, sheep ? [3, 3] : this.kind === 'horse' ? [4, 4] : [2, 2]);
    if (hex === S.legC || hex === S.face) return furFrom(sheep ? 'hide' : 'fur', hex, m);
    if (['#e8e0d0', '#ece2d0', '#d8cfbd', '#e6d9c4', '#d98a4a', '#3a281a', MANE, '#efe9df'].includes(hex)) return furFrom('fur', hex, m);
    return undefined;
  }

  protected mapAnim(a: AnimName): AnimName {
    switch (a) {
      case 'talk': case 'cast': case 'wave': case 'block': case 'dance': return 'idle';
      case 'attack2': return 'attack';
      case 'work': return this.kind === 'sheep' || this.kind === 'goat' || this.kind === 'horse' ? 'work' : 'idle';
      case 'sit': return this.kind === 'dog' || this.kind === 'cat' ? 'sit' : 'sleep';
      default: return a;
    }
  }
  protected duration(a: AnimName): number { return a === 'die' ? 0.8 : a === 'attack' ? 0.55 : a === 'jump' ? 0.6 : a === 'hit' ? 0.4 : 0.5; }

  protected pose(a: AnimName, t: number, o: Float32Array): void {
    const T = this.time, S = this.sp;
    const graze = this.kind === 'sheep' || this.kind === 'goat' || this.kind === 'horse';
    const horse = this.kind === 'horse';
    switch (a) {
      case 'idle': case 'work': {
        o[QP + 1] = 0.006 * s(T * 2.4);
        o[HEAD * 3 + 1] = 0.4 * s(T * 0.4) * s(T * 0.17);
        o[TAIL * 3 + 1] = (this.kind === 'dog' ? 0.5 : 0.15) * s(T * (this.kind === 'dog' ? 10 : 2));
        o[TAIL2 * 3 + 1] = 0.2 * s(T * 2.5 + 1);
        if (graze) {
          const u = (T % 7) / 7;
          const down = a === 'work' ? 1 : u < 0.45 ? sm(u / 0.08) * sm((0.45 - u) / 0.08) : 0;
          // конят е висок — шията слиза почти до земята
          o[NECK * 3] = (horse ? 1.55 : 1.1) * down; o[HEAD * 3] = (horse ? 0.55 : 0.3) * down + 0.08 * down * s(T * 9);
          o[HEAD * 3 + 1] *= 1 - down;
        }
        if (this.kind === 'cat') o[TAIL * 3 + 2] = 0.3 * s(T * 1.1);
        if (this.kind === 'fox_talasam') { o[NECK * 3] = 0.15 + 0.1 * s(T * 0.8); o[TAIL * 3 + 1] = 0.35 * s(T * 1.6); o[QP + 1] -= 0.03; o[FLU * 3] = -0.1; o[FRU * 3] = -0.1; }
        break;
      }
      case 'walk': case 'run': {
        const p = this.phase, run = a === 'run';
        const A = run ? 0.75 : 0.45;
        const ph = run ? GALLOP : TROT;
        for (let i = 0; i < 4; i++) {
          const q = p + ph[i];
          o[LEG_IDS[i * 2] * 3] = -A * s(q);
          o[LEG_IDS[i * 2 + 1] * 3] = (i < 2 ? 1 : 0.8) * (run ? 0.9 : 0.6) * max(0, c(q));
        }
        o[QP + 1] = (run ? 0.04 : 0.012) * Math.abs(s(p * (run ? 1 : 2)));
        o[BODY * 3] = run ? 0.12 * s(p + 1) : 0;
        o[HEAD * 3] = run ? -0.1 : 0.05 * s(p * 2);
        o[NECK * 3] = run ? 0.3 : 0.1;
        o[TAIL * 3] = run ? -0.4 : 0;
        o[TAIL * 3 + 1] = 0.25 * s(p);
        if (this.kind === 'fox_talasam') { o[NECK * 3] += 0.3; o[QP + 1] -= 0.04; o[TAIL * 3] = -0.9; }
        break;
      }
      case 'attack': {
        const e = sm(t / 0.15) * sm((0.55 - t) / 0.3);
        o[QP + 2] = 0.18 * e; o[BODY * 3] = 0.15 * e; o[NECK * 3] = 0.5 * e; o[HEAD * 3] = -0.2 * e;
        o[FLU * 3] = -0.6 * e; o[FRU * 3] = -0.5 * e; o[BLU * 3] = 0.4 * e; o[BRU * 3] = 0.4 * e;
        break;
      }
      case 'hit': {
        const e = s(Math.min(1, t / 0.4) * Math.PI);
        o[BODY * 3 + 2] = 0.2 * e; o[NECK * 3] = -0.5 * e; o[QP + 2] = -0.06 * e; o[TAIL * 3] = 0.5 * e;
        break;
      }
      case 'jump': {
        const e = s(Math.min(1, t / 0.6) * Math.PI);
        o[FLU * 3] = -0.8 * e; o[FLL * 3] = 1.2 * e; o[FRU * 3] = -0.8 * e; o[FRL * 3] = 1.2 * e;
        o[BLU * 3] = 0.7 * e; o[BRU * 3] = 0.7 * e; o[BODY * 3] = -0.2 * e;
        break;
      }
      case 'die': {
        const e = sm(t / 0.6);
        o[BODY * 3 + 2] = 1.5 * e; o[QP + 1] = -(this.bodyY - S.r * 0.95) * e; o[QP] = -S.r * 0.2 * e;
        o[NECK * 3] = 0.3 * e; o[HEAD * 3] = 0.2 * e;
        o[FLU * 3] = -0.3 * e; o[FRU * 3] = -0.2 * e; o[BLU * 3] = 0.3 * e; o[BRU * 3] = 0.2 * e;
        break;
      }
      case 'sit': {
        o[BODY * 3] = -0.55; o[QP + 1] = -this.bodyY * 0.32; o[QP + 2] = -S.len * 0.1;
        o[FLU * 3] = 0.55; o[FRU * 3] = 0.55;
        o[BLU * 3] = -0.9; o[BRU * 3] = -0.9; o[BLL * 3] = 1.9; o[BRL * 3] = 1.9;
        o[HEAD * 3] = 0.35; o[HEAD * 3 + 1] = 0.4 * s(T * 0.3);
        o[TAIL * 3] = 0.8; o[TAIL * 3 + 1] = 0.3 * s(T * 1.5);
        break;
      }
      case 'sleep': {
        o[QP + 1] = -S.leg * 0.88;
        o[FLU * 3] = -1.45; o[FRU * 3] = -1.45; o[FLL * 3] = 0; o[FRL * 3] = 0;
        o[BLU * 3] = -1.3; o[BRU * 3] = -1.3; o[BLL * 3] = 1.5; o[BRL * 3] = 1.5;
        o[BLU * 3 + 2] = 0.4; o[BRU * 3 + 2] = -0.4;
        o[NECK * 3] = 0.7; o[HEAD * 3] = 0.2; o[HEAD * 3 + 1] = 0.5;
        o[TAIL * 3 + 1] = 1.0;
        o[QP + 1] += 0.004 * s(T * 1.3);
        break;
      }
    }
  }
}

// ---------- кокошка ----------
const CB = 0, CN = 1, CH = 2, CLL = 3, CRL = 4, CLW = 5, CRW = 6, CT = 7, CJ = 8, CP = CJ * 3;
export class Chicken extends RigModel {
  readonly height = 0.42;
  constructor() {
    super();
    const r = this.root;
    const body = joint(r, 0, 0.2, 0);
    const neck = joint(body, 0, 0.05, 0.07);
    const head = joint(neck, 0, 0.1, 0.01);
    const ll = joint(body, 0.045, -0.04, 0);
    const rl = joint(body, -0.045, -0.04, 0);
    const lw = joint(body, 0.075, 0.03, 0);
    const rw = joint(body, -0.075, 0.03, 0);
    const tail = joint(body, 0, 0.04, -0.1);
    tail.rotation.x = -0.6;
    for (const j of [body, neck, head, ll, rl, lw, rw, tail]) this.addJoint(j);
    this.realistic = charactersReady();
    const white = mat('#f2ece0'), red = mat('#c8322a'), yel = mat('#e8a030');
    part(body, sphGeo(1), white, 0.085, 0.08, 0.11, 0, 0, 0);
    part(neck, cylGeo(0.7, 5), white, 0.04, 0.1, 0.035, 0, -0.01, 0);
    part(head, sphGeo(0), white, 0.042, 0.045, 0.045, 0, 0.0, 0.005);
    part(head, coneGeo(4), yel, 0.013, 0.035, 0.01, 0, -0.005, 0.045, Math.PI / 2, 0, 0, false);
    part(head, boxGeo(), red, 0.008, 0.035, 0.045, 0, 0.045, 0.0, 0, 0, 0, false);
    part(head, sphGeo(0), red, 0.01, 0.018, 0.008, 0, -0.03, 0.035, 0, 0, 0, false);
    for (const x of [1, -1]) part(head, sphGeo(0), mat('#141010'), 0.007, 0.007, 0.007, x * 0.032, 0.01, 0.02, 0, 0, 0, false);
    for (const [l] of [[ll], [rl]]) {
      part(l, cylGeo(1, 4), yel, 0.008, 0.16, 0.008, 0, 0, 0, Math.PI, 0, 0, false);
      part(l, boxGeo(), yel, 0.03, 0.006, 0.04, 0, -0.157, 0.012, 0, 0, 0, false);
    }
    for (const [w, x] of [[lw, 1], [rw, -1]] as [THREE.Group, number][]) part(w, sphGeo(0), mat('#e2d8c6'), 0.02, 0.055, 0.085, x * 0.005, -0.02, -0.01, 0.2, 0, 0);
    part(tail, coneGeo(4), mat('#e2d8c6'), 0.05, 0.1, 0.025, 0, 0, 0, 0, 0, 0);
    this.finish();
  }
  protected skinFor(m: THREE.MeshLambertMaterial): THREE.Material | undefined {
    const hex = '#' + m.color.getHexString();
    return hex === '#f2ece0' || hex === '#e2d8c6' ? furFrom('feathers', hex, m, [3, 3]) : undefined;
  }
  protected stride(run: boolean): number { return run ? 0.5 : 0.25; }
  protected mapAnim(a: AnimName): AnimName {
    if (a === 'run' || a === 'walk' || a === 'die' || a === 'hit' || a === 'idle' || a === 'sleep' || a === 'jump') return a;
    if (a === 'sit') return 'sleep';
    return a === 'attack' || a === 'attack2' ? 'hit' : 'idle';
  }
  protected duration(a: AnimName): number { return a === 'die' ? 0.7 : 0.5; }
  protected pose(a: AnimName, t: number, o: Float32Array): void {
    const T = this.time;
    switch (a) {
      case 'idle': {
        // кълве
        const u = (T % 2.6) / 2.6;
        const peck = u < 0.3 ? Math.abs(s(u / 0.3 * Math.PI * 3)) : 0;
        o[CN * 3] = 1.2 * peck * (u < 0.3 ? 1 : 0) + 0.1 * s(T * 0.7);
        o[CB * 3] = 0.35 * (u < 0.3 ? 1 : 0) * sm(Math.min(u, 0.3 - u) * 20);
        o[CH * 3 + 1] = u > 0.4 ? 0.6 * s(T * 1.3) : 0;
        o[CH * 3 + 2] = u > 0.6 ? 0.3 * s(T * 2.1) : 0;
        break;
      }
      case 'walk': case 'run': {
        const p = this.phase, run = a === 'run';
        o[CLL * 3] = -0.6 * s(p); o[CRL * 3] = 0.6 * s(p);
        o[CN * 3] = 0.25 * s(p * 2); o[CH * 3] = -0.25 * s(p * 2);
        o[CP + 1] = 0.01 * Math.abs(s(p));
        if (run) { o[CLW * 3 + 2] = 0.6 + 0.5 * s(T * 30); o[CRW * 3 + 2] = -0.6 - 0.5 * s(T * 30); o[CB * 3] = 0.3; }
        break;
      }
      case 'hit': case 'jump': {
        const e = s(Math.min(1, t / 0.5) * Math.PI);
        o[CLW * 3 + 2] = (0.8 + 0.6 * s(T * 35)) * e; o[CRW * 3 + 2] = -(0.8 + 0.6 * s(T * 35)) * e;
        o[CP + 1] = 0.08 * e; o[CN * 3] = -0.4 * e;
        break;
      }
      case 'die': {
        const e = sm(t / 0.5);
        o[CB * 3 + 2] = 1.5 * e; o[CP + 1] = -0.12 * e; o[CN * 3] = 0.8 * e; o[CLL * 3] = -0.5 * e; o[CRL * 3] = -0.3 * e;
        break;
      }
      case 'sleep': {
        o[CP + 1] = -0.11; o[CN * 3] = -0.6; o[CH * 3] = 0.9; o[CLL * 3] = -1.4; o[CRL * 3] = -1.4;
        break;
      }
    }
  }
}

export function buildAnimal(kind: AnimalKind): RigModel {
  return kind === 'chicken' ? new Chicken() : new Quadruped(kind);
}
void lowSph; void cachedGeo;
