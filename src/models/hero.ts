// Стоян — странникът: кафяво наметало с качулка, сабя на гърба.
import * as THREE from 'three';
import type { HeroModel } from './types';
import { HumanoidModel, humanDims, CHEST, NECK, LHAND, RHAND, type HeldWeapon } from './humanoid';
import { buildBody, buildHead } from './body';
import { buildSaber, buildScabbard, buildBow } from './items';
import { mat, part, cylGeo, sphGeo, boxGeo, joint, mergeStatic } from './shared';

const CLOAK = '#6b4a2f';

export class Hero extends HumanoidModel implements HeroModel {
  private saber: THREE.Group;
  private ivan?: THREE.Group;
  private bow?: THREE.Group;
  private backSlot: THREE.Group;

  constructor() {
    const d = humanDims(1.8, 'normal');
    super(d, { kind: 'hero' }, 1.8);
    const H = d.H, J = this.j;
    buildBody(this, {
      skin: '#d9ab84', shirt: '#e6dcc6', torsoColor: '#e6dcc6', belt: '#b3262b', vest: '#4a3426', vestClosed: false,
      legs: '#3b3129', shin: '#3a2618', shoe: '#2a1a10',
    });
    // кожени наръкавници
    buildHead(this, { skin: '#d9ab84', hair: '#4a2c18', beard: 'none', noseScale: 1.05 });
    // лека брада по бузите (набола)
    part(J[4], sphGeo(1), mat('#5a3a24'), d.headR * 0.9, d.headR * 0.5, d.headR * 0.85, 0, d.headR * 0.6, 0.004 * H, 0, 0, 0, false).scale.set(d.headR * 0.93, d.headR * 0.45, d.headR * 0.9);
    // наметало — закачено на раменете, люлее се
    const cm = mat(CLOAK, { side: THREE.DoubleSide });
    const top = joint(J[CHEST], 0, d.chest * 0.97, -0.01 * H, 'cloak');
    part(top, cylGeo(1.75, 9, true, Math.PI * 1.5, -Math.PI * 0.75), cm, 0.112 * H, 0.52 * H, 0.09 * H, 0, 0.01 * H, 0, Math.PI, 0, 0);
    // раменна пелерина
    part(J[CHEST], cylGeo(1.6, 9, true, Math.PI * 1.7, -Math.PI * 0.85), cm, 0.09 * H, 0.1 * H, 0.08 * H, 0, d.chest * 1.02, 0, Math.PI, 0, 0);
    this.addSway(top, 1.0, 0.06);
    // качулката — отметната на гърба
    part(J[NECK], sphGeo(1), mat(CLOAK), 0.075 * H, 0.06 * H, 0.055 * H, 0, 0.0, -0.06 * H, 0.4, 0, 0);
    // закопчалка
    part(J[CHEST], sphGeo(0), mat('#c9a050'), 0.014 * H, 0.014 * H, 0.01 * H, 0, d.chest * 0.98, 0.075 * H, 0, 0, 0, false);
    // торбичка на колана
    part(J[1], boxGeo(), mat('#5a3e26'), 0.05 * H, 0.06 * H, 0.03 * H, 0.08 * H, -0.01 * H, 0.06 * H, 0, -0.6, 0);
    // ножница на гърба
    this.backSlot = joint(J[CHEST], -0.07 * H, d.chest * 0.95, -0.105 * H, 'back');
    this.backSlot.rotation.set(0.22, 0, Math.PI + 0.6);
    const sc = buildScabbard(); this.backSlot.add(sc);
    this.saber = buildSaber(false);
    mergeStatic(this.saber);
    this.done();
    this.trackMesh(this.saber);
    this.setWeapon('saber');
  }

  setWeapon(kind: 'saber' | 'ivan_saber' | 'bow' | null): void {
    this.weapon = kind as HeldWeapon;
    const hand = this.j[RHAND];
    const inHand = (g: THREE.Group) => { hand.add(g); g.position.set(0, -0.032 * this.d.H, 0.012 * this.d.H); g.rotation.set(Math.PI / 2, -Math.PI / 2, 0); g.visible = true; };
    if (kind === 'saber') inHand(this.saber);
    else { this.backSlot.add(this.saber); this.saber.position.set(0, 0, 0); this.saber.rotation.set(0, 0, 0); this.saber.visible = true; }
    if (kind === 'ivan_saber') {
      if (!this.ivan) { this.ivan = buildSaber(true); mergeStatic(this.ivan); this.trackMesh(this.ivan); }
      inHand(this.ivan);
    } else if (this.ivan) this.ivan.visible = false;
    if (kind === 'bow' && !this.bow) {
      // лъкът се прави чак когато потрябва
      this.bow = buildBow(); mergeStatic(this.bow); this.trackMesh(this.bow);
      this.j[LHAND].add(this.bow);
      this.bow.position.set(0, -0.03 * this.d.H, 0.01 * this.d.H);
      this.bow.rotation.set(1.2, 0, 0);
    }
    if (this.bow) this.bow.visible = kind === 'bow';
  }
}
