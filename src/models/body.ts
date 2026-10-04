// Части на човешкото тяло и облеклото — общи за жителите, Стоян, самодивите и таласъма.
import * as THREE from 'three';
import { HumanoidModel, HIPS, SPINE, CHEST, NECK, HEAD, LUA, LFA, LHAND, RUA, RFA, RHAND, LTH, LSH, LFT, RTH, RSH, RFT } from './humanoid';
import { mat, part, cylGeo, boxGeo, sphGeo, lowSph, coneGeo, capGeo, joint, glow } from './shared';

const q = (x: number) => Math.round(x * 20) / 20;

/** Цилиндър от ставата надолу (дължина len, радиуси r1 при ставата и r2 в края). */
export function limbDown(parent: THREE.Object3D, len: number, r1: number, r2: number, m: THREE.Material, seg = 6, rz = 1): THREE.Mesh {
  return part(parent, cylGeo(q(r2 / r1), seg), m, r1, len, r1 * rz, 0, 0, 0, Math.PI, 0, 0);
}
export function limbUp(parent: THREE.Object3D, len: number, r1: number, r2: number, m: THREE.Material, seg = 7, rz = 1, y0 = 0): THREE.Mesh {
  return part(parent, cylGeo(q(r2 / r1), seg), m, r1, len, r1 * rz, 0, y0, 0);
}

export interface BodyOpts {
  skin: string;
  shirt: string;         // ръкави и гърди
  belt?: string;
  vest?: string;         // елек (отворен отпред)
  vestClosed?: boolean;
  legs: string;          // бедра/потури
  shin: string;          // подбедрици (навои/чорапи/ботуши)
  shoe: string;
  skirt?: { color: string; hem?: number; flare?: number; map?: THREE.Texture | null; emissive?: string };
  cuff?: string;         // ивица на ръкава
  sleeveFlare?: number;  // широки ръкави
  hands?: string;
  torsoColor?: string;
  emissive?: string;     // меко сияние (самодиви)
}

/** Тяло без глава. */
export function buildBody(m: HumanoidModel, o: BodyOpts): void {
  const d = m.d, H = d.H, bw = d.bw, J = m.j;
  const em = o.emissive ? { emissive: o.emissive, emissiveIntensity: 0.3 } : {};
  const skin = mat(o.skin, em), shirt = mat(o.shirt, em), legs = mat(o.legs, em), shin = mat(o.shin, em), shoe = mat(o.shoe, em);
  const torso = mat(o.torsoColor ?? o.shirt, em);
  // таз
  part(J[HIPS], lowSph(8, 5), legs, 0.1 * H * bw, 0.075 * H, 0.08 * H * bw, 0, -0.005 * H, 0);
  // корем и гърди
  limbUp(J[SPINE], d.spine + 0.01 * H, 0.098 * H * bw, 0.105 * H * bw, torso, 8, 0.8);
  limbUp(J[CHEST], d.chest * 0.9, 0.105 * H * bw, 0.12 * H * bw, torso, 8, 0.75);
  part(J[CHEST], lowSph(8, 4), torso, 0.12 * H * bw, 0.045 * H, 0.09 * H * bw, 0, d.chest * 0.9, 0);
  if (o.belt) part(J[SPINE], cylGeo(1, 8), mat(o.belt), 0.104 * H * bw, 0.05 * H, 0.084 * H * bw, 0, 0.005 * H, 0);
  if (o.vest) {
    const vm = mat(o.vest, { side: THREE.DoubleSide });
    const geo = o.vestClosed ? cylGeo(q(1.13), 8) : cylGeo(q(1.13), 8, true, Math.PI * 1.7, Math.PI * 0.15);
    part(J[CHEST], geo, vm, 0.11 * H * bw, d.chest * 0.88, 0.085 * H * bw, 0, -0.025 * H, 0);
  }
  // шия
  limbUp(J[NECK], d.neck + 0.02 * H, 0.034 * H, 0.032 * H, skin, 6, 1, -0.01 * H);
  // ръце
  const fl = o.sleeveFlare ?? 1;
  for (const [ua, fa, hd] of [[LUA, LFA, LHAND], [RUA, RFA, RHAND]]) {
    part(J[ua], lowSph(7, 5), shirt, 0.048 * H, 0.048 * H, 0.048 * H, 0, -0.005 * H, 0);
    limbDown(J[ua], d.upperArm, 0.044 * H, 0.04 * H, shirt);
    limbDown(J[fa], d.foreArm, 0.04 * H, 0.036 * H * fl, shirt);
    if (o.cuff) part(J[fa], cylGeo(1, 6), mat(o.cuff), 0.037 * H * fl, 0.022 * H, 0.037 * H * fl, 0, -d.foreArm - 0.002 * H, 0);
    part(J[hd], sphGeo(0), mat(o.hands ?? o.skin), 0.026 * H, 0.034 * H, 0.022 * H, 0, -0.03 * H, 0.004 * H);
  }
  // крака
  for (const [th, sh, ft, side] of [[LTH, LSH, LFT, 1], [RTH, RSH, RFT, -1]]) {
    limbDown(J[th], d.thigh + 0.01 * H, 0.062 * H * bw, 0.044 * H, legs);
    part(J[sh], lowSph(6, 4), shin, 0.042 * H, 0.04 * H, 0.042 * H);
    limbDown(J[sh], d.shin, 0.04 * H, 0.03 * H, shin);
    part(J[ft], boxGeo(), shoe, 0.05 * H, 0.032 * H, 0.11 * H, 0, -d.ankle + 0.016 * H, 0.025 * H);
    void side;
  }
  // пола (жени, самодиви)
  if (o.skirt) {
    const hem = o.skirt.hem ?? d.hipH - 0.08 * H;
    const flare = o.skirt.flare ?? 0.2;
    const top = 0.1 * H * bw;
    const sm = o.skirt.emissive ? mat(o.skirt.color, { emissive: o.skirt.emissive, emissiveIntensity: 0.3 }) : mat(o.skirt.color);
    m.skirtInfo = { top, flare: flare * H * bw, len: hem + 0.03 * H, y0: 0.03 * H };
    part(J[HIPS], cylGeo(q((flare * H * bw) / top), 10), sm, top, hem + 0.03 * H, top * 0.92, 0, 0.03 * H, 0, Math.PI, 0, 0);
  }
}

export interface HeadOpts {
  skin: string;
  hair: string;
  hairStyle?: 'cap' | 'none' | 'long' | 'bald';
  beard?: 'none' | 'mustache' | 'full';
  beardColor?: string;
  kalpak?: boolean;
  scarf?: string;
  braid?: boolean;
  eye?: string;
  eyeGlow?: string;
  noseScale?: number;
  ears?: 'round' | 'pointed';
  brow?: boolean;
  emissive?: string;
}

/** Глава с лице. */
export function buildHead(m: HumanoidModel, o: HeadOpts): THREE.Object3D {
  const d = m.d, H = d.H, R = d.headR;
  const hd = m.j[HEAD];
  const skin = mat(o.skin, o.emissive ? { emissive: o.emissive, emissiveIntensity: 0.25 } : {});
  const cy = R * 0.95;
  const head = part(hd, sphGeo(1), skin, R * 0.95, R * 1.08, R, 0, cy, 0);
  // нос
  const ns = o.noseScale ?? 1;
  part(hd, coneGeo(4), mat(o.skin), 0.016 * H * ns, 0.03 * H * ns, 0.016 * H * ns, 0, cy - 0.005 * H, R * 0.92, Math.PI / 2 + 0.25, 0, 0);
  // очи
  for (const sx of [1, -1]) {
    const e = o.eyeGlow
      ? part(hd, sphGeo(0), glow(o.eyeGlow), 0.014 * H, 0.011 * H, 0.008 * H, sx * 0.032 * H, cy + 0.01 * H, R * 0.86, 0, 0, sx * 0.3, false)
      : part(hd, boxGeo(), mat(o.eye ?? '#2a1d14'), 0.014 * H, 0.02 * H, 0.008 * H, sx * 0.03 * H, cy + 0.012 * H, R * 0.88, 0, sx * 0.25, 0, false);
    m.addEye(e);
    if (o.brow !== false && !o.eyeGlow) part(hd, boxGeo(), mat(o.beardColor ?? o.hair), 0.026 * H, 0.006 * H, 0.008 * H, sx * 0.031 * H, cy + 0.03 * H, R * 0.87, 0, sx * 0.25, sx * -0.12, false);
  }
  // уши
  if (o.ears === 'pointed') {
    for (const sx of [1, -1]) part(hd, coneGeo(4), skin, 0.018 * H, 0.07 * H, 0.012 * H, sx * R * 0.9, cy + 0.01 * H, -0.01 * H, 0.3, 0, -sx * 1.2);
  } else if (!o.scarf) {
    for (const sx of [1, -1]) part(hd, sphGeo(0), skin, 0.012 * H, 0.02 * H, 0.012 * H, sx * R * 0.93, cy, 0, 0, 0, 0, false);
  }
  const hairM = mat(o.hair);
  const style = o.hairStyle ?? 'cap';
  if (!o.scarf && style !== 'bald' && style !== 'none') {
    // коса — шапчица отгоре и отзад
    part(hd, capGeo(9, 4, Math.PI * 0.55), hairM, R * 1.02, R * 1.1, R * 1.05, 0, cy + 0.004 * H, -0.006 * H, -0.35, 0, 0);
  }
  if (o.kalpak) {
    const km = mat('#1e1a17');
    part(hd, cylGeo(0.88, 8), km, R * 0.98, R * 1.15, R * 1.0, 0, cy + R * 0.6, -0.008 * H, -0.12, 0, 0.04);
    part(hd, capGeo(8, 2, Math.PI / 2), km, R * 0.86, R * 0.22, R * 0.88, 0, cy + R * 1.73, -0.02 * H, -0.12, 0, 0.04, false);
  }
  if (o.scarf) {
    const sm = mat(o.scarf);
    part(hd, capGeo(10, 5, Math.PI * 0.62), sm, R * 1.1, R * 1.2, R * 1.12, 0, cy, -0.01 * H, -0.42, 0, 0);
    // краищата на забрадката отзад
    part(hd, coneGeo(4), sm, R * 0.85, R * 1.5, R * 0.35, 0, cy - R * 1.45, -R * 0.75, -0.25, Math.PI / 4, 0);
    // възел под брадата
    part(hd, sphGeo(0), sm, R * 0.28, R * 0.22, R * 0.22, 0, cy - R * 1.05, R * 0.35, 0, 0, 0, false);
    // ивица шевица над челото
    part(hd, cylGeo(1, 10, true, Math.PI * 0.9, -Math.PI * 0.45), mat('#c8a24a', { side: THREE.DoubleSide }), R * 1.06, R * 0.1, R * 1.06, 0, cy + R * 0.42, R * 0.06, -0.42, 0, 0, false);
  }
  if (o.braid) {
    const b = joint(hd, 0, cy - R * 0.4, -R * 0.95);
    for (let i = 0; i < 4; i++) part(b, sphGeo(0), hairM, R * 0.3 - i * R * 0.04, R * 0.32, R * 0.28, 0, -i * R * 0.45, -i * R * 0.06, 0, 0, 0, false);
    part(b, sphGeo(0), mat('#b3262b'), R * 0.15, R * 0.15, R * 0.15, 0, -4 * R * 0.45 + R * 0.15, -0.25 * R, 0, 0, 0, false);
  }
  const bc = mat(o.beardColor ?? o.hair);
  if (o.beard === 'mustache' || o.beard === 'full') {
    for (const sx of [1, -1]) part(hd, boxGeo(), bc, 0.04 * H, 0.014 * H, 0.016 * H, sx * 0.02 * H, cy - 0.024 * H, R * 0.9, 0, sx * 0.25, sx * 0.45, false);
  }
  if (o.beard === 'full') {
    part(hd, coneGeo(6), bc, R * 0.62, R * 0.9, R * 0.45, 0, cy - R * 0.25, R * 0.48, Math.PI - 0.35, 0, 0);
  }
  return head;
}
