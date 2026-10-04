// Човешки скелет (жители, Стоян, самодиви, таласъм) и всичките му анимации.
// Знаци на ъглите: ръце/крака x<0 = напред; лакът x<0 и коляно x>0 = свиване;
// z>0 = лявата ръка/крак навън (лявото е +X), z<0 = дясната навън; гръб/глава x>0 = навеждане напред.
import * as THREE from 'three';
import type { AnimName } from './types';
import { RigModel, makePose, sampleKeys, type KeyFrame } from './rig';
import { joint } from './shared';

export const HIPS = 0, SPINE = 1, CHEST = 2, NECK = 3, HEAD = 4,
  LUA = 5, LFA = 6, LHAND = 7, RUA = 8, RFA = 9, RHAND = 10,
  LTH = 11, LSH = 12, LFT = 13, RTH = 14, RSH = 15, RFT = 16;
export const NJ = 17;
export const P = NJ * 3; // отместване на таза (в единици височина)

export type ToolKind = 'staff' | 'hammer' | 'crook' | 'basket' | 'spindle' | 'tray' | 'saw' | 'pipe';
export type HeldWeapon = 'saber' | 'ivan_saber' | 'bow' | null;

export interface HumanDims {
  H: number; bw: number;
  ankle: number; shin: number; thigh: number; hipH: number;
  spine: number; chest: number; neck: number; headR: number;
  shoulderX: number; hipX: number; upperArm: number; foreArm: number;
}

export function humanDims(H: number, build: 'thin' | 'normal' | 'stout' = 'normal', armScale = 1): HumanDims {
  const bw = build === 'thin' ? 0.88 : build === 'stout' ? 1.2 : 1;
  const ankle = 0.045 * H, shin = 0.21 * H, thigh = 0.215 * H;
  return {
    H, bw, ankle, shin, thigh, hipH: ankle + shin + thigh,
    spine: 0.12 * H, chest: 0.18 * H, neck: 0.045 * H, headR: 0.082 * H,
    shoulderX: 0.118 * H * (0.85 + 0.15 * bw), hipX: 0.055 * H * bw,
    upperArm: 0.17 * H * armScale, foreArm: 0.15 * H * armScale,
  };
}

const k = (spec: Record<number, [number, number, number]>, pos?: [number, number, number]) => makePose(NJ, spec, pos);
const ZERO = k({});
const READY = k({ [RUA]: [-0.25, 0, -0.15], [RFA]: [-0.7, 0, 0], [LUA]: [-0.1, 0, 0.12], [LFA]: [-0.4, 0, 0] });
const LUNGE: Record<number, [number, number, number]> = { [LTH]: [-0.55, 0, 0.05], [LSH]: [0.55, 0, 0], [LFT]: [0, 0, 0], [RTH]: [0.35, 0, -0.05], [RSH]: [0.25, 0, 0] };

const ATTACK: KeyFrame[] = [
  { t: 0, p: READY },
  { t: 0.17, p: k({ [CHEST]: [-0.05, -0.65, 0], [SPINE]: [0, -0.25, 0], [RUA]: [-1.7, 0, -1.25], [RFA]: [-1.1, 0, 0], [RHAND]: [0.5, 0, 0], [LUA]: [-0.5, 0, 0.3], [LFA]: [-0.8, 0, 0], [HEAD]: [0, 0.5, 0], [LTH]: [-0.2, 0, 0.05], [RTH]: [0.15, 0, -0.05], [LSH]: [0.25, 0, 0], [RSH]: [0.2, 0, 0] }, [0, -0.02, 0]) },
  { t: 0.31, p: k({ ...LUNGE, [CHEST]: [0.15, 0.55, 0], [SPINE]: [0.12, 0.25, 0], [RUA]: [-1.45, 0, 0.35], [RFA]: [-0.15, 0, 0], [RHAND]: [1.25, 0, 0], [LUA]: [0.3, 0, 0.45], [LFA]: [-0.6, 0, 0], [HEAD]: [0, -0.5, 0] }, [0, -0.045, 0.02]) },
  { t: 0.42, p: k({ ...LUNGE, [CHEST]: [0.12, 0.6, 0], [SPINE]: [0.1, 0.25, 0], [RUA]: [-1.2, 0, 0.45], [RFA]: [-0.35, 0, 0], [RHAND]: [1.1, 0, 0], [LUA]: [0.3, 0, 0.45], [LFA]: [-0.6, 0, 0], [HEAD]: [0, -0.5, 0] }, [0, -0.045, 0.02]) },
  { t: 0.6, p: READY },
];
const ATTACK2: KeyFrame[] = [
  { t: 0, p: READY },
  { t: 0.22, p: k({ [CHEST]: [-0.3, 0.1, 0], [SPINE]: [-0.05, 0, 0], [RUA]: [-2.9, 0, -0.25], [RFA]: [-1.4, 0, 0], [LUA]: [-1.0, 0, 0.25], [LFA]: [-0.5, 0, 0], [HEAD]: [-0.15, 0, 0], [LTH]: [-0.15, 0, 0], [RTH]: [0.15, 0, 0] }, [0, 0.01, 0]) },
  { t: 0.36, p: k({ ...LUNGE, [CHEST]: [0.4, 0, 0], [SPINE]: [0.25, 0, 0], [RUA]: [-0.75, 0, 0.05], [RFA]: [-0.1, 0, 0], [LUA]: [0.4, 0, 0.3], [LFA]: [-0.4, 0, 0], [HEAD]: [-0.3, 0, 0] }, [0, -0.07, 0.03]) },
  { t: 0.46, p: k({ ...LUNGE, [CHEST]: [0.38, 0, 0], [SPINE]: [0.22, 0, 0], [RUA]: [-0.7, 0, 0.05], [RFA]: [-0.2, 0, 0], [LUA]: [0.4, 0, 0.3], [LFA]: [-0.4, 0, 0], [HEAD]: [-0.3, 0, 0] }, [0, -0.07, 0.03]) },
  { t: 0.65, p: READY },
];
const BOWSHOT: KeyFrame[] = [
  { t: 0, p: ZERO },
  { t: 0.25, p: k({ [CHEST]: [0, 0.6, 0], [SPINE]: [0, 0.3, 0], [HEAD]: [0, -0.8, 0], [LUA]: [-1.5, 0, 0.9], [LFA]: [0, 0, 0], [RUA]: [-1.3, 0, -0.6], [RFA]: [-2.2, 0, 0], [LTH]: [-0.2, 0, 0.15], [RTH]: [0.1, 0, -0.15] }) },
  { t: 0.45, p: k({ [CHEST]: [0, 0.6, 0], [SPINE]: [0, 0.3, 0], [HEAD]: [0, -0.8, 0], [LUA]: [-1.5, 0, 0.9], [LFA]: [0, 0, 0], [RUA]: [-1.2, 0, -1.2], [RFA]: [-2.4, 0, 0], [LTH]: [-0.2, 0, 0.15], [RTH]: [0.1, 0, -0.15] }) },
  { t: 0.52, p: k({ [CHEST]: [0, 0.6, 0], [SPINE]: [0, 0.3, 0], [HEAD]: [0, -0.8, 0], [LUA]: [-1.5, 0, 0.9], [LFA]: [0, 0, 0], [RUA]: [-0.6, 0, -1.3], [RFA]: [-0.5, 0, 0], [LTH]: [-0.2, 0, 0.15], [RTH]: [0.1, 0, -0.15] }) },
  { t: 0.75, p: ZERO },
];
const HIT: KeyFrame[] = [
  { t: 0, p: ZERO },
  { t: 0.08, p: k({ [CHEST]: [-0.35, 0.15, 0], [SPINE]: [-0.12, 0, 0], [HEAD]: [-0.35, 0, 0.1], [LUA]: [-0.3, 0, 0.45], [RUA]: [-0.3, 0, -0.45], [LFA]: [-0.7, 0, 0], [RFA]: [-0.7, 0, 0], [LSH]: [0.2, 0, 0], [RSH]: [0.25, 0, 0], [LTH]: [-0.1, 0, 0], [RTH]: [0.1, 0, 0] }, [0, -0.02, -0.03]) },
  { t: 0.4, p: ZERO },
];
const DIE: KeyFrame[] = [
  { t: 0, p: k({ [CHEST]: [-0.3, 0, 0], [HEAD]: [-0.25, 0, 0], [LUA]: [-0.2, 0, 0.5], [RUA]: [-0.2, 0, -0.5], [LSH]: [0.2, 0, 0], [RSH]: [0.2, 0, 0] }, [0, -0.02, 0]) },
  { t: 0.35, p: k({ [SPINE]: [0.35, 0, 0], [CHEST]: [0.1, 0, 0], [HEAD]: [0.3, 0, 0], [LUA]: [0, 0, 0.3], [RUA]: [0, 0, -0.3], [LTH]: [-0.75, 0, 0.1], [LSH]: [1.4, 0, 0], [RTH]: [-0.55, 0, -0.1], [RSH]: [1.2, 0, 0], [LFT]: [-0.5, 0, 0], [RFT]: [-0.5, 0, 0] }, [0, -0.2, 0]) },
  { t: 0.7, p: k({ [HIPS]: [-0.9, 0, 0], [SPINE]: [0.1, 0, 0], [HEAD]: [0.2, 0.3, 0], [LUA]: [-0.3, 0, 0.7], [RUA]: [-0.3, 0, -0.7], [LTH]: [-0.8, 0, 0.12], [LSH]: [1.1, 0, 0], [RTH]: [-0.6, 0, -0.12], [RSH]: [0.9, 0, 0] }, [0, -0.3, -0.1]) },
  { t: 1.0, p: k({ [HIPS]: [-1.53, 0, 0], [HEAD]: [-0.1, 0.55, 0], [LUA]: [0.2, 0, 1.1], [RUA]: [0.1, 0, -0.9], [LFA]: [-0.3, 0, 0], [RFA]: [-0.6, 0, 0], [LTH]: [0.0, 0, 0.18], [LSH]: [0.25, 0, 0], [RTH]: [-0.2, 0, -0.1], [RSH]: [0.5, 0, 0], [LFT]: [0.4, 0, 0], [RFT]: [0.4, 0, 0] }, [0, -0.405, -0.2]) },
];
const JUMP: KeyFrame[] = [
  { t: 0, p: ZERO },
  { t: 0.12, p: k({ [SPINE]: [0.3, 0, 0], [HEAD]: [-0.2, 0, 0], [LTH]: [-0.75, 0, 0], [LSH]: [1.3, 0, 0], [LFT]: [-0.5, 0, 0], [RTH]: [-0.75, 0, 0], [RSH]: [1.3, 0, 0], [RFT]: [-0.5, 0, 0], [LUA]: [0.7, 0, 0.1], [RUA]: [0.7, 0, -0.1] }, [0, -0.1, 0]) },
  { t: 0.3, p: k({ [SPINE]: [0.05, 0, 0], [LTH]: [-1.0, 0, 0], [LSH]: [1.4, 0, 0], [RTH]: [-0.3, 0, 0], [RSH]: [0.9, 0, 0], [LUA]: [-1.3, 0, 0.45], [RUA]: [-1.3, 0, -0.45], [LFA]: [-0.4, 0, 0], [RFA]: [-0.4, 0, 0] }) },
  { t: 0.6, p: k({ [LTH]: [-0.3, 0, 0], [LSH]: [0.45, 0, 0], [RTH]: [-0.2, 0, 0], [RSH]: [0.4, 0, 0], [LUA]: [-0.3, 0, 0.7], [RUA]: [-0.3, 0, -0.7] }) },
  { t: 0.68, p: k({ [SPINE]: [0.2, 0, 0], [LTH]: [-0.5, 0, 0], [LSH]: [0.9, 0, 0], [RTH]: [-0.5, 0, 0], [RSH]: [0.9, 0, 0], [LFT]: [-0.35, 0, 0], [RFT]: [-0.35, 0, 0], [LUA]: [-0.2, 0, 0.4], [RUA]: [-0.2, 0, -0.4] }, [0, -0.06, 0]) },
  { t: 0.75, p: ZERO },
];
const CAST: KeyFrame[] = [
  { t: 0, p: ZERO },
  { t: 0.35, p: k({ [CHEST]: [-0.2, 0, 0], [HEAD]: [-0.3, 0, 0], [LUA]: [-2.5, 0, 0.45], [RUA]: [-2.5, 0, -0.45], [LFA]: [-0.3, 0, 0], [RFA]: [-0.3, 0, 0] }, [0, 0.01, 0]) },
  { t: 0.6, p: k({ [CHEST]: [0.15, 0, 0], [SPINE]: [0.05, 0, 0], [LUA]: [-1.5, 0, 0.2], [RUA]: [-1.5, 0, -0.2], [LFA]: [0, 0, 0], [RFA]: [0, 0, 0], [LTH]: [-0.3, 0, 0], [LSH]: [0.3, 0, 0], [RTH]: [0.2, 0, 0] }, [0, -0.02, 0.01]) },
  { t: 0.75, p: k({ [CHEST]: [0.15, 0, 0], [SPINE]: [0.05, 0, 0], [LUA]: [-1.45, 0, 0.25], [RUA]: [-1.45, 0, -0.25], [LFA]: [-0.1, 0, 0], [RFA]: [-0.1, 0, 0], [LTH]: [-0.3, 0, 0], [LSH]: [0.3, 0, 0], [RTH]: [0.2, 0, 0] }, [0, -0.02, 0.01]) },
  { t: 1.0, p: ZERO },
];

const s = Math.sin, c = Math.cos, max = Math.max;
const smooth01 = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

export interface HumanStyle {
  kind: 'villager' | 'hero' | 'samodiva' | 'talasam' | 'karakondzhul';
  female?: boolean;
  old?: boolean;
  tool?: ToolKind;
}

/** Общ клас за човешките модели — мешовете се добавят от строителите (villager.ts, hero.ts…). */
export class HumanoidModel extends RigModel {
  readonly height: number;
  readonly d: HumanDims;
  readonly j: THREE.Group[] = [];
  style: HumanStyle;
  weapon: HeldWeapon = null;
  /** Височина на седалката за 'sit' (м). */
  seatHeight = 0.45;
  /** Размери на полата (за подгъв/престилка). */
  skirtInfo?: { top: number; flare: number; len: number; y0: number };
  protected eyes: THREE.Object3D[] = [];
  private blinkT = 2 + Math.random() * 3;
  /** Допълнителни стави за вторично движение. */
  protected swayJoints: { j: THREE.Object3D; amp: number; v: number; a: number; base: number }[] = [];
  private prevSpeed = 0;

  constructor(d: HumanDims, style: HumanStyle, height?: number) {
    super();
    this.d = d;
    this.style = style;
    this.height = height ?? d.H;
    const r = this.root;
    const hips = joint(r, 0, d.hipH, 0, 'hips');
    const spine = joint(hips, 0, 0, 0, 'spine');
    const chest = joint(spine, 0, d.spine, 0, 'chest');
    const neck = joint(chest, 0, d.chest, 0, 'neck');
    const head = joint(neck, 0, d.neck, 0, 'head');
    const sy = d.chest - 0.03 * d.H;
    const lua = joint(chest, d.shoulderX, sy, 0, 'lua');
    const lfa = joint(lua, 0, -d.upperArm, 0, 'lfa');
    const lhand = joint(lfa, 0, -d.foreArm, 0, 'lhand');
    const rua = joint(chest, -d.shoulderX, sy, 0, 'rua');
    const rfa = joint(rua, 0, -d.upperArm, 0, 'rfa');
    const rhand = joint(rfa, 0, -d.foreArm, 0, 'rhand');
    const lth = joint(hips, d.hipX, 0, 0, 'lth');
    const lsh = joint(lth, 0, -d.thigh, 0, 'lsh');
    const lft = joint(lsh, 0, -d.shin, 0, 'lft');
    const rth = joint(hips, -d.hipX, 0, 0, 'rth');
    const rsh = joint(rth, 0, -d.thigh, 0, 'rsh');
    const rft = joint(rsh, 0, -d.shin, 0, 'rft');
    for (const g of [hips, spine, chest, neck, head, lua, lfa, lhand, rua, rfa, rhand, lth, lsh, lft, rth, rsh, rft]) { this.j.push(g); this.addJoint(g); }
    this.hand = rhand;
    if (style.old || style.kind === 'talasam') {
      this.bias = style.kind === 'talasam'
        ? k({ [SPINE]: [0.35, 0, 0], [CHEST]: [0.3, 0, 0], [NECK]: [-0.35, 0, 0], [HEAD]: [-0.3, 0, 0], [LTH]: [-0.35, 0, 0.05], [RTH]: [-0.35, 0, -0.05], [LSH]: [0.6, 0, 0], [RSH]: [0.6, 0, 0], [LFT]: [-0.25, 0, 0], [RFT]: [-0.25, 0, 0], [LUA]: [-0.35, 0, 0.12], [RUA]: [-0.35, 0, -0.12], [LFA]: [-0.3, 0, 0], [RFA]: [-0.3, 0, 0] }, [0, -0.045, 0])
        : k({ [SPINE]: [0.16, 0, 0], [CHEST]: [0.14, 0, 0], [NECK]: [-0.12, 0, 0], [HEAD]: [-0.12, 0, 0], [LTH]: [-0.06, 0, 0], [RTH]: [-0.06, 0, 0], [LSH]: [0.12, 0, 0], [RSH]: [0.12, 0, 0] }, [0, -0.008, 0]);
    }
  }

  /** Вика се от строителя след добавяне на мешовете. */
  done(): this { this.finish(); return this; }

  protected stride(run: boolean): number { return (run ? 1.25 : 0.78) * this.d.H * (this.style.old ? 0.85 : 1); }

  protected duration(anim: AnimName): number {
    if (anim === 'attack') return this.weapon === 'bow' ? 0.75 : 0.6;
    if (anim === 'attack2') return 0.65;
    return super.duration(anim);
  }

  protected pose(anim: AnimName, t: number, o: Float32Array): void {
    const T = this.time;
    switch (anim) {
      case 'idle': this.idle(T, o); this.carry(o, 0); break;
      case 'walk': this.walk(o, false); this.carry(o, 1); break;
      case 'run': this.walk(o, true); this.carry(o, 2); break;
      case 'talk': this.talk(T, o); this.carry(o, 0, true); break;
      case 'work': this.work(t, o); break;
      case 'sit': this.sit(T, o); break;
      case 'sleep': this.sleep(T, o); break;
      case 'dance': this.dance(t, o); break;
      case 'block': this.block(T, o); break;
      case 'attack': sampleKeys(o, this.weapon === 'bow' ? BOWSHOT : ATTACK, t); break;
      case 'attack2': sampleKeys(o, this.weapon === 'bow' ? BOWSHOT : ATTACK2, t); break;
      case 'hit': sampleKeys(o, HIT, t); break;
      case 'die': sampleKeys(o, DIE, t); this.biasW = smooth01(1 - t * 2); break;
      case 'jump': sampleKeys(o, JUMP, t); break;
      case 'cast': sampleKeys(o, CAST, t); break;
      case 'wave': this.wave(t, o); break;
    }
    this.extraPose(anim, t, o);
    // отместванията на таза са в единици височина
    o[P] *= this.d.H; o[P + 1] *= this.d.H; o[P + 2] *= this.d.H;
  }

  /** Добавка за наследниците (напр. самодивата се рее). */
  protected extraPose(anim: AnimName, t: number, o: Float32Array): void {}

  private idle(T: number, o: Float32Array): void {
    const b = s(T * 2.1), sw = s(T * 0.55);
    o[CHEST * 3] = -0.025 * b;
    o[LUA * 3 + 2] = 0.07 + 0.015 * b; o[RUA * 3 + 2] = -0.07 - 0.015 * b;
    o[LFA * 3] = -0.14; o[RFA * 3] = -0.14;
    o[LUA * 3] = 0.02 * b; o[RUA * 3] = 0.02 * b;
    o[P] = 0.012 * sw; o[HIPS * 3 + 2] = 0.03 * sw; o[LTH * 3 + 2] = -0.03 * sw; o[RTH * 3 + 2] = -0.03 * sw;
    o[SPINE * 3 + 2] = -0.025 * sw;
    o[LSH * 3] = 0.04 + 0.03 * max(0, -sw); o[RSH * 3] = 0.04 + 0.03 * max(0, sw);
    o[HEAD * 3 + 1] = 0.35 * s(T * 0.31) * s(T * 0.13);
    o[HEAD * 3] = 0.05 * s(T * 0.7);
    if (this.style.kind === 'talasam' || this.style.kind === 'karakondzhul') { o[HEAD * 3 + 2] = 0.25 * s(T * 0.9) * s(T * 2.3); o[LFA * 3] = -0.3 + 0.1 * s(T * 1.3); }
  }

  private walk(o: Float32Array, run: boolean): void {
    const p = this.phase, sw = s(p), cw = c(p);
    const v = this.moveSpeed > 0.05 ? this.moveSpeed : run ? 4.5 : 1.4;
    if (!run) {
      const a = Math.min(1.25, 0.55 + v * 0.32);
      o[LTH * 3] = -0.42 * a * sw; o[RTH * 3] = 0.42 * a * sw;
      o[LSH * 3] = 0.08 + 0.65 * a * max(0, cw) * max(0, cw); o[RSH * 3] = 0.08 + 0.65 * a * max(0, -cw) * max(0, -cw);
      o[LFT * 3] = 0.3 * max(0, -sw) - 0.15 * max(0, sw); o[RFT * 3] = 0.3 * max(0, sw) - 0.15 * max(0, -sw);
      o[LUA * 3] = 0.38 * a * sw; o[RUA * 3] = -0.38 * a * sw;
      o[LUA * 3 + 2] = 0.07; o[RUA * 3 + 2] = -0.07;
      o[LFA * 3] = -0.2 - 0.3 * max(0, -sw); o[RFA * 3] = -0.2 - 0.3 * max(0, sw);
      o[HIPS * 3 + 1] = -0.12 * a * sw; o[CHEST * 3 + 1] = 0.2 * a * sw;
      o[HIPS * 3 + 2] = 0.03 * cw;
      o[SPINE * 3] = 0.05; o[HEAD * 3] = -0.03;
      o[P + 1] = 0.022 * a * (Math.abs(cw) - 0.6);
    } else {
      o[LTH * 3] = -0.2 - 0.75 * sw; o[RTH * 3] = -0.2 + 0.75 * sw;
      o[LSH * 3] = 0.35 + 1.25 * max(0, cw); o[RSH * 3] = 0.35 + 1.25 * max(0, -cw);
      o[LFT * 3] = 0.35 * max(0, -sw); o[RFT * 3] = 0.35 * max(0, sw);
      o[LUA * 3] = 0.75 * sw; o[RUA * 3] = -0.75 * sw;
      o[LUA * 3 + 2] = 0.12; o[RUA * 3 + 2] = -0.12;
      o[LFA * 3] = -1.25; o[RFA * 3] = -1.25;
      o[HIPS * 3 + 1] = -0.18 * sw; o[CHEST * 3 + 1] = 0.3 * sw;
      o[SPINE * 3] = 0.22; o[CHEST * 3] = 0.05; o[NECK * 3] = -0.12; o[HEAD * 3] = -0.08;
      o[P + 1] = 0.035 * (Math.abs(cw) - 0.3) - 0.02;
    }
  }

  private talk(T: number, o: Float32Array): void {
    const b = s(T * 2.1);
    o[CHEST * 3] = -0.02 * b;
    o[CHEST * 3 + 1] = 0.1 * s(T * 1.1);
    o[RUA * 3] = -0.35 + 0.18 * s(T * 2.3); o[RUA * 3 + 2] = -0.18 - 0.08 * s(T * 1.3);
    o[RFA * 3] = -0.95 + 0.4 * s(T * 3.1 + 1);
    o[RHAND * 3 + 2] = 0.3 * s(T * 2.7);
    o[LUA * 3] = -0.15 + 0.15 * s(T * 1.7 + 2); o[LUA * 3 + 2] = 0.12;
    o[LFA * 3] = -0.5 + 0.35 * s(T * 2.6);
    o[HEAD * 3] = 0.09 * s(T * 4.2) * max(0, s(T * 0.9));
    o[HEAD * 3 + 1] = 0.15 * s(T * 0.7);
    o[HEAD * 3 + 2] = 0.06 * s(T * 0.5);
    o[LSH * 3] = 0.04; o[RSH * 3] = 0.04;
  }

  private sit(T: number, o: Float32Array): void {
    const d = this.d;
    o[LTH * 3] = -1.52; o[RTH * 3] = -1.52; o[LTH * 3 + 2] = 0.08; o[RTH * 3 + 2] = -0.08;
    o[LSH * 3] = 1.5; o[RSH * 3] = 1.5;
    o[LUA * 3] = -0.55; o[RUA * 3] = -0.55; o[LFA * 3] = -0.55; o[RFA * 3] = -0.55;
    o[LUA * 3 + 2] = 0.05; o[RUA * 3 + 2] = -0.05;
    o[CHEST * 3] = -0.02 * s(T * 2.1) + 0.04;
    o[HEAD * 3 + 1] = 0.3 * s(T * 0.27) * s(T * 0.11);
    o[P + 1] = (this.seatHeight + 0.055 * d.H - d.hipH) / d.H;
    this.biasW = 0.5;
  }

  private sleep(T: number, o: Float32Array): void {
    o[HIPS * 3] = -1.53;
    o[P + 1] = -(this.d.hipH / this.d.H - 0.075); o[P + 2] = -0.2;
    o[CHEST * 3] = 0.03 * s(T * 1.2);
    o[HEAD * 3 + 1] = 0.45; o[HEAD * 3] = -0.1;
    o[LUA * 3] = -0.35; o[LUA * 3 + 2] = -0.1; o[LFA * 3] = -1.3;
    o[RUA * 3] = -0.35; o[RUA * 3 + 2] = 0.1; o[RFA * 3] = -1.3;
    o[LTH * 3] = -0.15; o[LSH * 3] = 0.3; o[RTH * 3] = -0.05; o[RSH * 3] = 0.15; o[LTH * 3 + 2] = 0.06;
    o[LFT * 3] = 0.5; o[RFT * 3] = 0.5;
    this.biasW = 0;
  }

  private block(T: number, o: Float32Array): void {
    const b = s(T * 3);
    o[RUA * 3] = -1.35; o[RUA * 3 + 1] = 0.3; o[RUA * 3 + 2] = 0.25; o[RFA * 3] = -1.15;
    o[RHAND * 3 + 2] = -1.2;
    o[LUA * 3] = -0.9; o[LUA * 3 + 2] = 0.15; o[LFA * 3] = -1.3;
    o[CHEST * 3] = 0.08 + 0.02 * b; o[CHEST * 3 + 1] = 0.25; o[HEAD * 3 + 1] = -0.25;
    o[LTH * 3] = -0.4; o[LSH * 3] = 0.5; o[RTH * 3] = 0.3; o[RSH * 3] = 0.35; o[LTH * 3 + 2] = 0.08; o[RTH * 3 + 2] = -0.1;
    o[P + 1] = -0.04; o[P + 2] = -0.01;
  }

  private wave(t: number, o: Float32Array): void {
    const e = smooth01(t / 0.25) * smooth01((1.6 - t) / 0.3);
    o[RUA * 3] = -0.25 * e; o[RUA * 3 + 2] = -2.55 * e;
    o[RFA * 3] = -0.25 * e; o[RFA * 3 + 2] = (0.15 + 0.45 * s(t * 11)) * e;
    o[HEAD * 3 + 2] = -0.12 * e; o[HEAD * 3 + 1] = -0.1 * e;
    o[CHEST * 3 + 2] = 0.05 * e;
    o[LUA * 3 + 2] = 0.07; o[LFA * 3] = -0.15;
  }

  private dance(t: number, o: Float32Array): void {
    const bps = 2.3, b = t * bps;
    const n = Math.floor(b) % 6, f = b - Math.floor(b), kk = s(f * Math.PI);
    o[P + 1] = -0.012 + 0.016 * Math.abs(s(b * Math.PI));
    o[P] = 0.035 * s((Math.PI * 2 * b) / 6);
    switch (n) {
      case 0: o[RTH * 3 + 2] = -0.22 * kk; o[RSH * 3] = 0.25 * kk; break;
      case 1: o[LTH * 3 + 2] = -0.12 * kk; o[LTH * 3] = 0.15 * kk; o[LSH * 3] = 0.25 * kk; break;
      case 2: o[RTH * 3 + 2] = -0.22 * kk; o[RSH * 3] = 0.25 * kk; break;
      case 3: o[LTH * 3] = -0.6 * kk; o[LSH * 3] = 0.75 * kk; o[LFT * 3] = 0.3 * kk; o[RSH * 3] = 0.15 * kk; break;
      case 4: o[LTH * 3 + 2] = 0.2 * kk; o[LSH * 3] = 0.25 * kk; break;
      case 5: o[RTH * 3] = -0.6 * kk; o[RSH * 3] = 0.75 * kk; o[RFT * 3] = 0.3 * kk; o[LSH * 3] = 0.15 * kk; break;
    }
    // ръце надолу, леко встрани — държат съседите за ръце; люлеят се с ритъма
    const arm = 0.1 * s(b * Math.PI);
    o[LUA * 3 + 2] = 0.5; o[RUA * 3 + 2] = -0.5;
    o[LUA * 3] = -0.12 + arm; o[RUA * 3] = -0.12 + arm;
    o[LFA * 3] = -0.18; o[RFA * 3] = -0.18;
    o[CHEST * 3] = -0.04 + 0.03 * s(b * Math.PI * 2);
    o[HEAD * 3] = -0.06; o[HEAD * 3 + 1] = 0.15 * s((Math.PI * 2 * b) / 6);
    o[HIPS * 3 + 2] = 0.04 * s(b * Math.PI);
  }

  /** Как се държи сечивото/оръжието при ходене и стоене (mode: 0 стои, 1 ходи, 2 тича). */
  private carry(o: Float32Array, mode: number, talking = false): void {
    const tool = this.style.tool;
    if (this.weapon === 'saber' || this.weapon === 'ivan_saber') {
      if (!talking) {
        o[RFA * 3] = mode === 2 ? -1.3 : -0.75;
        o[RUA * 3] *= 0.5; o[RUA * 3 + 2] = -0.12;
      }
      return;
    }
    if (this.weapon === 'bow') { o[LFA * 3] = mode === 2 ? -1.2 : -0.45; o[LUA * 3] *= 0.5; return; }
    switch (tool) {
      case 'staff': case 'crook':
        if (!talking) { o[RUA * 3] = -0.22 + o[RUA * 3] * 0.25; o[RFA * 3] = -0.55; o[RUA * 3 + 2] = -0.12; }
        break;
      case 'basket':
        o[LUA * 3] = -0.12 + o[LUA * 3] * 0.2; o[LFA * 3] = -1.45; o[LUA * 3 + 2] = 0.12;
        break;
      case 'spindle':
        o[LUA * 3] = -0.15 + o[LUA * 3] * 0.2; o[LFA * 3] = -1.1; o[LUA * 3 + 2] = 0.08;
        break;
      case 'tray':
        o[RUA * 3] = -0.35; o[RFA * 3] = -1.15; o[RUA * 3 + 2] = -0.05;
        o[LUA * 3] = -0.35; o[LFA * 3] = -1.15; o[LUA * 3 + 2] = 0.05;
        break;
    }
  }

  private work(t: number, o: Float32Array): void {
    const T = this.time;
    switch (this.style.tool) {
      case 'hammer': {
        const u = (t % 1.0);
        let kk = 0;
        if (u < 0.6) kk = smooth01(u / 0.6); else if (u < 0.7) kk = 1 - smooth01((u - 0.6) / 0.1); else kk = 0;
        o[RUA * 3] = -0.55 - 1.9 * kk; o[RUA * 3 + 2] = -0.15; o[RFA * 3] = -0.45 - 0.9 * kk;
        o[LUA * 3] = -0.55; o[LFA * 3] = -0.85; o[LUA * 3 + 2] = 0.1;
        o[SPINE * 3] = 0.12; o[CHEST * 3] = 0.12 - 0.15 * kk; o[CHEST * 3 + 1] = 0.08 * kk;
        o[HEAD * 3] = 0.3;
        o[LTH * 3] = -0.2; o[LSH * 3] = 0.2; o[RTH * 3] = 0.12; o[RSH * 3] = 0.1;
        o[P + 1] = -0.01 * (1 - kk);
        break;
      }
      case 'spindle': {
        o[LUA * 3] = -0.2; o[LFA * 3] = -1.1; o[LUA * 3 + 2] = 0.08;
        const w = s(T * 1.8);
        o[RUA * 3] = -0.45 + 0.25 * w; o[RFA * 3] = -0.9 + 0.5 * w; o[RUA * 3 + 2] = -0.1;
        o[RHAND * 3 + 1] = 0.8 * s(T * 9);
        o[HEAD * 3] = 0.2; o[HEAD * 3 + 1] = -0.15;
        o[CHEST * 3] = -0.02 * s(T * 2.1);
        break;
      }
      case 'saw': {
        const w = s(t * 5.5);
        o[SPINE * 3] = 0.3; o[CHEST * 3] = 0.25; o[HEAD * 3] = 0.1;
        o[RUA * 3] = -0.7 + 0.45 * w; o[RFA * 3] = -0.7 - 0.5 * w; o[RUA * 3 + 2] = -0.05;
        o[CHEST * 3 + 1] = -0.08 * w;
        o[LUA * 3] = -0.75; o[LFA * 3] = -0.5; o[LUA * 3 + 2] = -0.05;
        o[LTH * 3] = -0.35; o[LSH * 3] = 0.35; o[RTH * 3] = 0.25; o[RSH * 3] = 0.1;
        o[P + 1] = -0.02; o[P + 2] = -0.01 * w;
        break;
      }
      case 'crook': case 'staff': {
        const sw = s(T * 0.5);
        o[RUA * 3] = -0.55; o[RFA * 3] = -0.95; o[RUA * 3 + 2] = 0.05;
        o[LUA * 3] = -0.6; o[LFA * 3] = -1.0; o[LUA * 3 + 2] = -0.25;
        o[SPINE * 3] = 0.12; o[CHEST * 3] = 0.08;
        o[HEAD * 3 + 1] = 0.5 * s(T * 0.23); o[HEAD * 3] = -0.05;
        o[P] = 0.015 * sw; o[HIPS * 3 + 2] = 0.04 * sw; o[LTH * 3 + 2] = -0.04 * sw; o[RTH * 3 + 2] = -0.04 * sw;
        o[RTH * 3] = 0.1; o[LSH * 3] = 0.06 + 0.1 * max(0, sw);
        break;
      }
      case 'basket': {
        o[LUA * 3] = -0.12; o[LFA * 3] = -1.45; o[LUA * 3 + 2] = 0.12;
        const u = (t % 3.2) / 3.2;
        const kk = u < 0.35 ? smooth01(u / 0.35) : u < 0.6 ? 1 : 1 - smooth01((u - 0.6) / 0.3);
        const pick = u > 0.35 && u < 0.6 ? s((u - 0.35) * 40) * 0.15 : 0;
        o[SPINE * 3] = 0.75 * kk; o[CHEST * 3] = 0.3 * kk; o[NECK * 3] = -0.2 * kk; o[HEAD * 3] = 0.1 * kk;
        o[LTH * 3] = -0.6 * kk; o[LSH * 3] = 0.9 * kk; o[RTH * 3] = -0.35 * kk; o[RSH * 3] = 0.65 * kk;
        o[LFT * 3] = -0.3 * kk; o[RFT * 3] = -0.3 * kk;
        o[RUA * 3] = -0.9 * kk + pick; o[RFA * 3] = -0.2 - 0.1 * kk; o[RUA * 3 + 2] = -0.1;
        o[P + 1] = -0.13 * kk; o[P + 2] = -0.03 * kk;
        break;
      }
      case 'tray': {
        const w = s(T * 1.3);
        o[RUA * 3] = -0.55 + 0.2 * w; o[RFA * 3] = -0.95 + 0.2 * w; o[LUA * 3] = -0.55 + 0.2 * w; o[LFA * 3] = -0.95 + 0.2 * w;
        o[SPINE * 3] = 0.12 + 0.1 * max(0, w); o[HEAD * 3] = 0.1 + 0.15 * max(0, w);
        o[HEAD * 3 + 1] = 0.2 * s(T * 0.4);
        break;
      }
      default: {
        const w = s(T * 3);
        o[RUA * 3] = -0.6; o[RFA * 3] = -0.8 + 0.3 * w; o[LUA * 3] = -0.6; o[LFA * 3] = -0.8 - 0.3 * w;
        o[SPINE * 3] = 0.2; o[HEAD * 3] = 0.25;
      }
    }
  }

  protected secondary(dt: number): void {
    // мигане
    if (this.eyes.length) {
      this.blinkT -= dt;
      const closed = this.blinkT < 0.12 && this.active !== 'sleep' ? 0.15 : this.active === 'sleep' || (this.active === 'die' && this.t > 0.6) ? 0.15 : 1;
      for (const e of this.eyes) e.scale.y = closed * (e.userData.sy as number);
      if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 4;
    }
    // наметало/коса — пружина според скоростта
    const sp = this.active === 'walk' || this.active === 'run' ? (this.moveSpeed > 0.05 ? this.moveSpeed : this.active === 'run' ? 4.5 : 1.4) : 0;
    this.prevSpeed += (sp - this.prevSpeed) * Math.min(1, dt * 4);
    for (const w of this.swayJoints) {
      const target = w.base + w.amp * (this.prevSpeed * 0.09 + 0.04 * s(this.time * 2.2 + w.base * 10) * (0.4 + this.prevSpeed * 0.3));
      w.v += ((target - w.a) * 40 - w.v * 9) * dt;
      w.a += w.v * dt;
      w.j.rotation.x = w.a;
    }
  }

  addSway(j: THREE.Object3D, amp: number, base = 0): void { this.swayJoints.push({ j, amp, base, a: base, v: 0 }); }
  addEye(e: THREE.Object3D): void { e.userData.sy = e.scale.y; this.eyes.push(e); }
}
