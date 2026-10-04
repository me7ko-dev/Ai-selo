// Самодиви и таласъм (човекоподобни създания).
import * as THREE from 'three';
import type { AnimName } from './types';
import { HumanoidModel, humanDims, P, HIPS, SPINE, CHEST, HEAD, LUA, LFA, LHAND, RUA, RFA, RHAND } from './humanoid';
import { buildBody, buildHead, limbDown } from './body';
import { cachedGeo, mat, part, cylGeo, sphGeo, coneGeo, boxGeo, joint, glow, hemTex, haloSprite } from './shared';

const HAIR = ['#e8d49a', '#3a2418', '#b8642e', '#ece6da', '#7a4a2a', '#d8b070'];
const FLOWERS = [['#ffffff', '#f2d64a', '#e86a8a'], ['#f2d64a', '#ffffff', '#7aa0e8'], ['#e86a8a', '#ffffff', '#f2d64a']];

export class Samodiva extends HumanoidModel {
  constructor(index = 0) {
    const d = humanDims(1.75, 'thin');
    super(d, { kind: 'samodiva', female: true }, 1.92);
    const H = d.H, J = this.j;
    const glowC = '#a9c4ff';
    buildBody(this, {
      skin: '#f4e4d8', shirt: '#f7f7ff', legs: '#f7f7ff', shin: '#f4e4d8', shoe: '#f4e4d8', belt: '#c8a24a',
      skirt: { color: '#f4f5ff', hem: d.hipH - 0.01 * H, flare: 0.25, emissive: glowC },
      cuff: '#c8a24a', sleeveFlare: 1.6, emissive: glowC,
    });
    // шевица по подгъва
    const si = this.skirtInfo!;
    const ht = hemTex('#f4f5ff', '#c23b32', '#c8a24a');
    const hm = ht ? mat('#ffffff', { map: ht, emissive: '#6a7ab0', emissiveIntensity: 0.35, side: THREE.DoubleSide }) : mat('#c23b32');
    part(J[HIPS], cylGeo(0.97, 10, true), hm, si.flare * 1.01, 0.06 * H, si.flare * 0.93, 0, si.y0 - si.len, 0, 0, 0, 0, false);
    const hair = HAIR[index % HAIR.length];
    buildHead(this, { skin: '#f6e6da', hair, eye: '#2a3a5a', noseScale: 0.85, emissive: glowC });
    // дълга коса — люлее се
    const R = d.headR;
    const hj = joint(J[HEAD], 0, R * 1.3, -R * 0.75);
    limbDown(hj, 0.45 * H, R * 0.95, R * 0.75, mat(hair), 6, 0.45);
    part(hj, sphGeo(0), mat(hair), R * 0.75, R * 0.35, R * 0.35, 0, -0.45 * H, 0, 0, 0, 0, false);
    this.addSway(hj, 1.2, 0.12);
    // венец от цветя
    const wr = joint(J[HEAD], 0, R * 1.55, -R * 0.05);
    wr.rotation.x = -0.25;
    part(wr, cachedGeo('wreath', () => new THREE.TorusGeometry(1, 0.11, 3, 10)), mat('#4f7a3a'), R * 0.92, R * 0.92, R * 0.92, 0, 0, 0, Math.PI / 2, 0, 0, false);
    const fl = FLOWERS[index % FLOWERS.length];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      part(wr, sphGeo(0), mat(fl[i % 3], { emissive: fl[i % 3], emissiveIntensity: 0.25 }), R * 0.2, R * 0.14, R * 0.2, Math.sin(a) * R * 0.92, R * 0.05, Math.cos(a) * R * 0.92, 0, a, 0, false);
    }
    const halo = haloSprite('#cfe0ff', 1.5, 0.14);
    halo.position.y = 0.2 * H; J[CHEST].add(halo);
    this.done();
  }

  protected extraPose(anim: AnimName, t: number, o: Float32Array): void {
    if (anim === 'die' || anim === 'sleep' || anim === 'sit') return;
    o[P + 1] += 0.045 + 0.015 * Math.sin(this.time * 1.5);
    if (anim === 'idle') { o[LUA * 3 + 2] += 0.12; o[RUA * 3 + 2] -= 0.12; o[HEAD * 3 + 2] += 0.08 * Math.sin(this.time * 0.6); }
  }
}

export class Talasam extends HumanoidModel {
  constructor() {
    const d = humanDims(1.7, 'thin', 1.35);
    super(d, { kind: 'talasam' }, 1.5);
    const H = d.H, J = this.j;
    const skin = '#66745c';
    buildBody(this, { skin, shirt: '#3c4438', torsoColor: '#353d31', legs: '#30362c', shin: '#465240', shoe: '#3a4436', hands: '#68745c' });
    buildHead(this, { skin, hair: '#1e221c', hairStyle: 'bald', eyeGlow: '#e0ff5a', ears: 'pointed', noseScale: 1.7, brow: false });
    const R = d.headR;
    // уста — тъмна резка с криви зъбки
    part(J[HEAD], boxGeo(), mat('#141812'), R * 0.7, R * 0.12, R * 0.1, 0, R * 0.55, R * 0.88, 0.1, 0, 0, false);
    for (const x of [-0.2, 0.15]) part(J[HEAD], coneGeo(3), mat('#d8d0b0'), R * 0.06, R * 0.15, R * 0.05, x * R, R * 0.6, R * 0.92, Math.PI, 0, 0, false);
    // рошави кичури
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI - Math.PI / 2;
      part(J[HEAD], coneGeo(3), mat('#1e221c'), R * 0.12, R * 0.9, R * 0.12, Math.sin(a) * R * 0.6, R * 1.75, -R * 0.2 - Math.cos(a) * R * 0.2, -2.2 + Math.abs(a) * 0.2, 0, a * 0.8, false);
    }
    const eyeHalo = haloSprite('#d8ff5a', 0.32, 0.55);
    eyeHalo.position.set(0, R * 1.05, R * 0.95); J[HEAD].add(eyeHalo);
    // нокти
    const claw = mat('#d6ceb0');
    for (const hd of [LHAND, RHAND]) for (let i = 0; i < 3; i++) {
      part(J[hd], coneGeo(4), claw, 0.008 * H, 0.06 * H, 0.008 * H, (i - 1) * 0.012 * H, -0.055 * H, 0.012 * H, Math.PI - 0.35, 0, (i - 1) * 0.15, false);
    }
    // дрипи около кръста и по ръцете
    const rag1 = mat('#2a2e27', { side: THREE.DoubleSide }), rag2 = mat('#3d4a36', { side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const len = (0.12 + ((i * 7) % 5) * 0.03) * H;
      part(J[HIPS], boxGeo(), i % 2 ? rag1 : rag2, 0.05 * H, len, 0.004 * H, Math.sin(a) * 0.085 * H, -len / 2 + 0.02 * H, Math.cos(a) * 0.075 * H, Math.cos(a) * 0.15, a, -Math.sin(a) * 0.15, false);
    }
    for (const [ua, fa] of [[LUA, LFA], [RUA, RFA]]) {
      part(J[ua], boxGeo(), rag1, 0.004 * H, 0.14 * H, 0.04 * H, 0, -0.12 * H, -0.035 * H, 0.15, 0, 0, false);
      part(J[fa], boxGeo(), rag2, 0.004 * H, 0.11 * H, 0.035 * H, 0, -0.1 * H, -0.03 * H, 0.2, 0, 0, false);
    }
    // мъх по раменете
    for (const x of [1, -1]) part(J[CHEST], sphGeo(0), mat('#4f6a3a'), 0.05 * H, 0.025 * H, 0.05 * H, x * 0.1 * H, d.chest * 0.95, -0.01 * H, 0, 0, 0, false);
    part(J[SPINE], sphGeo(0), mat('#4f6a3a'), 0.04 * H, 0.03 * H, 0.02 * H, 0.05 * H, 0.06 * H, -0.075 * H, 0, 0, 0, false);
    void glow;
    this.done();
  }
  protected stride(run: boolean): number { return run ? 2.0 : 1.1; }
}
