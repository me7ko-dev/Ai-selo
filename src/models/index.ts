// Модели на героите, чудовищата, животните и предметите — процедурни low-poly, с процедурна анимация.
// Подписите на функциите са договорът — не ги сменяй.
import * as THREE from 'three';
import type { VillagerLook } from '../data/villagers';
import type { CharacterModel, HeroModel, LamiaModel, AnimalKind, MonsterKind } from './types';
import { buildVillager } from './villager';
import { Hero } from './hero';
import { Samodiva, Talasam } from './creatures';
import { Quadruped, buildAnimal } from './animals';
import { Lamia } from './lamia';
import { buildRosen, buildChest, buildSaber, buildBow, buildPotion, buildFeather, buildEgg } from './items';
export type { AnimName, CharacterModel, HeroModel, LamiaModel, AnimalKind, MonsterKind } from './types';
export { countTris } from './shared';

/** Жител по външния му вид (VILLAGERS[id].look). Моделът има и `seatHeight` (за 'sit', по подразбиране 0.45 м). */
export function createVillagerModel(look: VillagerLook): CharacterModel { return buildVillager(look); }

/** Стоян. Начално оръжие: 'saber' в ръката. */
export function createHeroModel(): HeroModel { return new Hero(); }

export function createMonsterModel(kind: MonsterKind): CharacterModel {
  return kind === 'talasam' ? new Talasam() : new Quadruped('fox_talasam');
}

export function createSamodivaModel(index = 0): CharacterModel { return new Samodiva(index); }

export function createAnimalModel(kind: AnimalKind): CharacterModel { return buildAnimal(kind); }

export function createLamiaModel(): LamiaModel { return new Lamia(); }

/** Предмети в света (билка росен, сандък, сабя на земята…) — малки модели, основата е в y = 0. */
export type PropKind = 'rosen' | 'chest' | 'saber' | 'ivan_saber' | 'bow' | 'potion' | 'feather' | 'egg';
export function createPropModel(kind: PropKind): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'prop_' + kind;
  switch (kind) {
    case 'rosen': g.add(buildRosen()); break;
    case 'chest': g.add(buildChest()); break;
    case 'saber': case 'ivan_saber': {
      // лежи на земята, леко подпряна
      const s = buildSaber(kind === 'ivan_saber');
      s.rotation.set(-Math.PI / 2 + 0.08, 0, Math.PI / 2); s.position.set(-0.4, 0.03, 0);
      g.add(s); break;
    }
    case 'bow': {
      const b = buildBow(); b.rotation.set(Math.PI / 2, 0, Math.PI / 2); b.position.y = 0.03; g.add(b); break;
    }
    case 'potion': g.add(buildPotion()); break;
    case 'feather': g.add(buildFeather()); break;
    case 'egg': g.add(buildEgg()); break;
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}
