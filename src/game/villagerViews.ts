// 3D жителите: следват state-а на селото (основния или „гледане назад“) — позиция, посока, анимация.
import * as THREE from 'three';
import { createVillagerModel, type AnimName, type CharacterModel } from '../models';
import { VILLAGERS, VILLAGER_IDS, type VillagerId } from '../data/villagers';
import type { VillagerState, WorldState } from '../sim/types';
import { heightAt } from '../world/height';

interface View {
  id: VillagerId;
  model: CharacterModel;
  pos: THREE.Vector3;
  yaw: number;
  anim: AnimName | '';
  speed: number;
  init: boolean;
  visible: boolean;
}

export interface TagInfo { id: VillagerId; head: THREE.Vector3; visible: boolean; bubble: { text: string; ai?: boolean } | null }

const tmp = new THREE.Vector3();

function animFor(v: VillagerState, speed: number): AnimName {
  switch (v.activity) {
    case 'dance': case 'celebrate': return 'dance';
    case 'flee': return speed > 0.2 ? 'run' : 'idle';
    default: break;
  }
  if (speed > 0.25) return speed > 2.4 ? 'run' : 'walk';
  switch (v.activity) {
    case 'work': return 'work';
    case 'talk': case 'gossip': case 'argue': return 'talk';
    case 'sit': case 'eat': return 'sit';
    case 'sleep': return 'sleep';
    case 'mourn': return 'sit';
    case 'vote': return 'idle';
    default: return 'idle';
  }
}

function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class VillagerViews {
  readonly views = new Map<VillagerId, View>();
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (const id of VILLAGER_IDS) {
      const model = createVillagerModel(VILLAGERS[id].look);
      model.root.name = 'villager:' + id;
      this.group.add(model.root);
      this.views.set(id, { id, model, pos: new THREE.Vector3(), yaw: 0, anim: '', speed: 0, init: false, visible: true });
    }
  }

  /** snap = веднага на място (след зареждане/превъртане). */
  update(dt: number, state: WorldState, snap = false, playerPos?: THREE.Vector3): void {
    for (const v of state.villagers) {
      const view = this.views.get(v.id);
      if (!view) continue;
      tmp.set(v.pos.x, heightAt(v.pos.x, v.pos.z), v.pos.z);
      if (!view.init || snap || view.pos.distanceTo(tmp) > 10) { view.pos.copy(tmp); view.init = true; view.yaw = v.facing; }
      const px = view.pos.x, pz = view.pos.z;
      const k = 1 - Math.exp(-dt * 12);
      view.pos.lerp(tmp, k);
      const moved = Math.hypot(view.pos.x - px, view.pos.z - pz) / Math.max(dt, 1e-4);
      view.speed += (moved - view.speed) * Math.min(1, dt * 6);
      // спи вкъщи → не се вижда
      const hidden = v.activity === 'sleep' && !!v.place && v.place.startsWith('house_');
      if (hidden !== !view.visible) { view.model.root.visible = !hidden; view.visible = !hidden; }
      if (hidden) continue;
      // посока: когато говори с играча — към играча
      let face = v.facing;
      if (v.talkingWith === 'player' && playerPos) face = Math.atan2(playerPos.x - view.pos.x, playerPos.z - view.pos.z);
      view.yaw = angleLerp(view.yaw, face, 1 - Math.exp(-dt * 8));
      const anim = animFor(v, view.speed);
      if (anim !== view.anim) { view.model.play(anim); view.anim = anim; }
      view.model.update(dt, view.speed);
      view.model.root.position.copy(view.pos);
      view.model.root.rotation.y = view.yaw;
    }
  }

  /** Точката над главата (за етикета с името). */
  head(id: VillagerId, out = new THREE.Vector3()): THREE.Vector3 {
    const v = this.views.get(id)!;
    return out.copy(v.pos).setY(v.pos.y + v.model.height + 0.35);
  }

  /** Най-близкият видим жител до точка (за [E] Говори). */
  nearest(p: THREE.Vector3, maxDist: number): { id: VillagerId; dist: number } | null {
    let best: VillagerId | null = null, bd = maxDist;
    for (const v of this.views.values()) {
      if (!v.visible) continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      if (d < bd) { bd = d; best = v.id; }
    }
    return best ? { id: best, dist: bd } : null;
  }

  isVisible(id: VillagerId): boolean { return this.views.get(id)?.visible ?? false; }
  position(id: VillagerId): THREE.Vector3 { return this.views.get(id)!.pos; }

  setVisible(on: boolean): void { this.group.visible = on; }
}
