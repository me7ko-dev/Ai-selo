// ВРЕМЕННИ модели (капсули), докато агентът за модели направи истинските.
// Подписите на функциите са договорът — не ги сменяй.
import * as THREE from 'three';
import type { VillagerLook } from '../data/villagers';
import type { AnimName, CharacterModel, HeroModel, LamiaModel, AnimalKind, MonsterKind } from './types';
export type { AnimName, CharacterModel, HeroModel, LamiaModel, AnimalKind, MonsterKind } from './types';

class Capsule implements CharacterModel {
  readonly root = new THREE.Group();
  current: AnimName = 'idle';
  private t = 0;
  private body: THREE.Mesh;
  constructor(readonly height: number, color: string | number, head: string | number = '#e0b896') {
    const r = height * 0.18;
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(r, height - r * 2 - height * 0.2, 4, 8), new THREE.MeshStandardMaterial({ color, flatShading: true }));
    this.body.position.y = (height - height * 0.2) / 2;
    this.body.castShadow = true;
    const h = new THREE.Mesh(new THREE.SphereGeometry(height * 0.11, 8, 6), new THREE.MeshStandardMaterial({ color: head, flatShading: true }));
    h.position.y = height - height * 0.1; h.castShadow = true;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: head }));
    nose.position.set(0, height - height * 0.1, height * 0.11);
    this.root.add(this.body, h, nose);
  }
  play(anim: AnimName): void { this.current = anim; }
  update(dt: number, moveSpeed = 0): void {
    this.t += dt * (1 + moveSpeed);
    this.body.position.y = (this.height - this.height * 0.2) / 2 + (moveSpeed > 0.1 ? Math.abs(Math.sin(this.t * 5)) * 0.05 : 0);
  }
  flash(): void {}
  dispose(): void {}
}

export function createVillagerModel(look: VillagerLook): CharacterModel { return new Capsule(look.height, look.vest, look.skin); }

export function createHeroModel(): HeroModel {
  const c = new Capsule(1.8, '#6b4a2f') as unknown as HeroModel;
  (c as any).setWeapon = () => {};
  return c;
}

export function createMonsterModel(kind: MonsterKind): CharacterModel {
  return kind === 'talasam' ? new Capsule(1.5, '#2a2f2a', '#3a4a3a') : new Capsule(0.8, '#c0622a', '#d07a3a');
}

export function createSamodivaModel(index = 0): CharacterModel { return new Capsule(1.75, '#f4f4ff', '#f0e0d0'); }

export function createAnimalModel(kind: AnimalKind): CharacterModel {
  const s: Record<AnimalKind, [number, string]> = { sheep: [0.9, '#eeeae0'], goat: [0.9, '#8a7a6a'], chicken: [0.4, '#f0e8d8'], dog: [0.7, '#6a4a2a'], cat: [0.4, '#444'] };
  return new Capsule(s[kind][0], s[kind][1], s[kind][1]);
}

export function createLamiaModel(): LamiaModel {
  const c = new Capsule(6, '#4a6a3a', '#5a7a4a') as unknown as LamiaModel & { heads: THREE.Object3D[] };
  const heads: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshStandardMaterial({ color: '#6a8a4a', flatShading: true }));
    h.position.set((i - 1) * 1.8, 6.5, 1.5);
    c.root.add(h); heads.push(h);
  }
  (c as any).heads = heads;
  (c as any).setHeadAlive = (i: number, alive: boolean) => { heads[i].visible = alive; };
  (c as any).headAttack = () => {};
  return c;
}

/** Предмети в света (билка росен, сандък, сабя на земята…) — малки модели. */
export type PropKind = 'rosen' | 'chest' | 'saber' | 'ivan_saber' | 'bow' | 'potion' | 'feather' | 'egg';
export function createPropModel(kind: PropKind): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshStandardMaterial({ color: kind === 'rosen' ? '#9ad0ff' : '#e8c27a', emissive: kind === 'rosen' ? '#335577' : '#000000' }));
  m.position.y = 0.3;
  const g = new THREE.Group(); g.add(m); return g;
}
