// Караконджул — рошав, прегърбен зимен демон (~3 м): сплъстена тъмна козина, дълга конско-козя глава с рога,
// червени светещи очи, дълги ръце с нокти, копита. Страшен, но без кръв.
import * as THREE from 'three';
import type { AnimName } from './types';
import { HumanoidModel, humanDims, NJ, HIPS, SPINE, CHEST, NECK, HEAD, LUA, LFA, LHAND, RUA, RFA, RHAND, LTH, LSH, LFT, RTH, RSH, RFT } from './humanoid';
import { makePose } from './rig';
import { buildBody } from './body';
import { mat, part, cylGeo, sphGeo, coneGeo, boxGeo, joint, glow, haloSprite } from './shared';
import { furFrom } from './skin';
import { charactersReady } from './gltf/assets';

const FUR = '#3a2e25', FUR2 = '#4d3d2f', FUR3 = '#241c16';

export class Karakondzhul extends HumanoidModel {
  constructor() {
    const d = humanDims(3.1, 'stout', 1.4);
    super(d, { kind: 'karakondzhul' }, 2.75);
    const H = d.H, J = this.j;
    this.realistic = charactersReady();
    this.bias = makePose(NJ, {
      [SPINE]: [0.4, 0, 0], [CHEST]: [0.35, 0, 0], [NECK]: [-0.3, 0, 0], [HEAD]: [-0.4, 0, 0],
      [LTH]: [-0.4, 0, 0.08], [RTH]: [-0.4, 0, -0.08], [LSH]: [0.75, 0, 0], [RSH]: [0.75, 0, 0], [LFT]: [-0.35, 0, 0], [RFT]: [-0.35, 0, 0],
      [LUA]: [-0.45, 0, 0.2], [RUA]: [-0.45, 0, -0.2], [LFA]: [-0.35, 0, 0], [RFA]: [-0.35, 0, 0],
    }, [0, -0.06, 0]);
    buildBody(this, { skin: '#3a3028', shirt: FUR, torsoColor: FUR, legs: FUR3, shin: FUR, shoe: '#121010', hands: '#4a3e34' });
    const f1 = mat(FUR), f2 = mat(FUR2), f3 = mat(FUR3);
    const tufts = [f1, f2, f3];
    // сплъстени кичури козина (конуси, сочещи надолу)
    const tuft = (par: THREE.Object3D, n: number, rx: number, rz: number, y0: number, y1: number, len: number, w: number, seed: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + seed;
        const y = y0 + ((i * 37 + seed * 11) % 10) / 10 * (y1 - y0);
        const l = len * (0.7 + ((i * 13) % 7) / 10);
        part(par, coneGeo(4), tufts[(i + seed) % 3], w, l, w * 0.7, Math.sin(a) * rx, y, Math.cos(a) * rz, Math.PI + Math.cos(a) * 0.35, a, -Math.sin(a) * 0.35, i % 3 === 0);
      }
    };
    const bw = d.bw;
    tuft(J[CHEST], 12, 0.13 * H * bw, 0.1 * H * bw, 0.02 * H, d.chest * 0.95, 0.09 * H, 0.04 * H, 1);
    tuft(J[SPINE], 8, 0.11 * H * bw, 0.09 * H * bw, -0.02 * H, d.spine, 0.08 * H, 0.035 * H, 2);
    tuft(J[HIPS], 9, 0.11 * H * bw, 0.09 * H * bw, -0.04 * H, 0.0, 0.1 * H, 0.035 * H, 3);
    for (const [ua, fa, th, sh] of [[LUA, LFA, LTH, LSH], [RUA, RFA, RTH, RSH]]) {
      tuft(J[ua], 4, 0.045 * H, 0.045 * H, -d.upperArm * 0.9, -0.02 * H, 0.07 * H, 0.025 * H, 4);
      tuft(J[fa], 4, 0.04 * H, 0.04 * H, -d.foreArm * 0.9, -0.02 * H, 0.06 * H, 0.022 * H, 5);
      tuft(J[th], 4, 0.06 * H, 0.06 * H, -d.thigh * 0.8, -0.02 * H, 0.08 * H, 0.03 * H, 6);
      tuft(J[sh], 3, 0.04 * H, 0.04 * H, -d.shin, -d.shin * 0.75, 0.05 * H, 0.025 * H, 7); // четина над копитата
    }
    // гърбица от козина на раменете
    part(J[CHEST], sphGeo(1), f3, 0.13 * H * bw, 0.06 * H, 0.09 * H, 0, d.chest * 0.92, -0.03 * H, 0.3, 0, 0);
    // копита — тъмни, разцепени
    const hoof = mat('#121010');
    for (const ft of [LFT, RFT]) {
      part(J[ft], boxGeo(), mat('#2a2622'), 0.006 * H, 0.034 * H, 0.04 * H, 0, -d.ankle + 0.017 * H, 0.07 * H, 0, 0, 0, false);
      part(J[ft], cylGeo(1.15, 6), hoof, 0.035 * H, 0.04 * H, 0.04 * H, 0, -d.ankle, 0.0, 0, 0, 0);
    }
    // дълги нокти
    const claw = mat('#d8cfb4');
    for (const hd of [LHAND, RHAND]) for (let i = 0; i < 4; i++) {
      part(J[hd], coneGeo(4), claw, 0.006 * H, 0.055 * H, 0.006 * H, (i - 1.5) * 0.01 * H, -0.05 * H, 0.01 * H, Math.PI - 0.4, 0, (i - 1.5) * 0.12, false);
    }
    // глава — дълга, конско-козя
    const hd = J[HEAD];
    const R = 0.055 * H;
    const skin = mat('#2e2620'), bone = mat('#cdbf9e'), dark = mat('#0e0c0b');
    part(hd, sphGeo(1), skin, R * 0.95, R * 1.0, R * 1.1, 0, R * 0.9, 0);
    const sn = joint(hd, 0, R * 0.75, R * 0.6); sn.rotation.x = 0.3;
    part(sn, cylGeo(0.6, 6), skin, R * 0.6, R * 2.1, R * 0.5, 0, 0, 0, Math.PI / 2, 0, 0);
    part(sn, sphGeo(0), skin, R * 0.38, R * 0.32, R * 0.3, 0, -R * 0.02, R * 2.05, 0, 0, 0, false);
    for (const sx of [1, -1]) part(sn, sphGeo(0), dark, R * 0.09, R * 0.07, R * 0.06, sx * R * 0.17, R * 0.08, R * 2.3, 0, 0, 0, false);
    // долна челюст и криви зъби (не кървави)
    part(sn, boxGeo(), mat('#241e19'), R * 0.55, R * 0.18, R * 1.7, 0, -R * 0.38, R * 0.95, 0.12, 0, 0);
    for (const [x, z] of [[0.2, 1.7], [-0.22, 1.5], [0.12, 1.2]]) part(sn, coneGeo(3), bone, R * 0.05, R * 0.2, R * 0.05, x * R, -R * 0.3, z * R, Math.PI, 0, 0, false);
    // козя брада
    part(sn, coneGeo(4), f3, R * 0.22, R * 0.9, R * 0.18, 0, -R * 0.45, R * 0.8, Math.PI - 0.25, 0, 0, false);
    // очи — червени, светят
    for (const sx of [1, -1]) {
      const e = part(hd, sphGeo(0), glow('#ff2a14'), R * 0.16, R * 0.12, R * 0.1, sx * R * 0.55, R * 1.15, R * 0.75, 0, sx * 0.4, 0, false);
      this.addEye(e);
    }
    const eh = haloSprite('#ff2a10', 0.6, 0.5); eh.position.set(0, R * 1.15, R * 0.9); hd.add(eh);
    // рога — извити нагоре и назад
    for (const sx of [1, -1]) {
      const h1 = joint(hd, sx * R * 0.5, R * 1.6, -R * 0.1);
      h1.rotation.set(-0.5, 0, -sx * 0.55);
      part(h1, cylGeo(0.7, 6), bone, R * 0.26, R * 1.5, R * 0.26);
      const h2 = joint(h1, 0, R * 1.45, 0);
      h2.rotation.set(-0.8, 0, -sx * 0.2);
      part(h2, cylGeo(0.6, 5), bone, R * 0.18, R * 1.1, R * 0.18);
      const h3 = joint(h2, 0, R * 1.08, 0);
      h3.rotation.set(-0.9, 0, 0);
      part(h3, coneGeo(5), bone, R * 0.11, R * 0.9, R * 0.11, 0, 0, 0, 0, 0, 0, false);
      // уши, щръкнали встрани
      part(hd, coneGeo(4), skin, R * 0.18, R * 0.75, R * 0.1, sx * R * 0.85, R * 1.05, -R * 0.2, 0, 0, -sx * 1.6, false);
    }
    // грива по тила и шията
    for (let i = 0; i < 6; i++) part(hd, coneGeo(4), tufts[i % 3], R * 0.3, R * (1.1 + (i % 3) * 0.3), R * 0.15, (i % 2 ? 1 : -1) * R * 0.15 * (i % 3), R * (1.6 - i * 0.3), -R * 0.9, -2.6, 0, 0, i % 2 === 0);
    tuft(J[NECK], 6, 0.05 * H, 0.05 * H, 0, d.neck, 0.08 * H, 0.03 * H, 8);
    this.done();
  }

  /** Сплъстена козина по тялото, груба тъмна кожа по главата и ръцете. */
  protected skinFor(m: THREE.MeshLambertMaterial): THREE.Material | undefined {
    const hex = '#' + m.color.getHexString();
    if (hex === FUR || hex === FUR2 || hex === FUR3) return furFrom('fur', hex, m, [3, 3]);
    if (hex === '#3a3028' || hex === '#4a3e34' || hex === '#2e2620' || hex === '#241e19') return furFrom('hide', hex, m);
    return undefined;
  }

  protected stride(run: boolean): number { return run ? 3.8 : 2.3; }

  protected extraPose(anim: AnimName, t: number, o: Float32Array): void {
    const T = this.time;
    if (anim === 'walk' || anim === 'run') {
      // тежко, заплашително полюшване: дълги ръце се люлеят, главата се клати, раменете се въртят
      const p = this.phase;
      o[LUA * 3] *= 1.6; o[RUA * 3] *= 1.6;
      o[CHEST * 3 + 2] = 0.08 * Math.sin(p);
      o[HEAD * 3] += 0.12 * Math.sin(p * 2);
      o[HEAD * 3 + 2] = -0.1 * Math.sin(p);
      o[SPINE * 3 + 2] = 0.05 * Math.sin(p);
    } else if (anim === 'idle') {
      // тежко дишане, ръце висят и леко потрепват
      o[CHEST * 3] -= 0.04 * Math.sin(T * 1.4);
      o[LHAND * 3 + 2] = 0.2 * Math.sin(T * 3.1) * Math.sin(T * 0.7);
      o[RHAND * 3 + 2] = -0.2 * Math.sin(T * 2.7 + 1) * Math.sin(T * 0.5);
    }
  }
}
