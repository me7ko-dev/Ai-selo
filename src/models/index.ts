// Модели на героите, чудовищата, животните и предметите.
// Хората (жителите, Стоян, самодивите) са реалистични модели от public/assets/chars/ (src/models/gltf/), ако са заредени
// с preloadCharacters(); иначе (Node, телефон с „Ниско“, грешка при зареждане) — процедурните low-poly.
// Подписите на функциите са договорът — не ги сменяй.
import * as THREE from 'three';
import type { VillagerLook } from '../data/villagers';
import type { CharacterModel, HeroModel, LamiaModel, AnimalKind, MonsterKind, HorseModel } from './types';
import { buildVillager } from './villager';
import { Hero } from './hero';
import { Samodiva, Talasam } from './creatures';
import { Karakondzhul } from './karakondzhul';
import { Quadruped, buildAnimal, type HorseCoat } from './animals';
import { Lamia } from './lamia';
import { buildRosen, buildChest, buildSaber, buildBow, buildPotion, buildFeather, buildEgg } from './items';
export type { AnimName, CharacterModel, HeroModel, LamiaModel, AnimalKind, MonsterKind, HorseModel } from './types';
export { HORSE_COATS, type HorseCoat } from './animals';
export { countTris } from './shared';
import { mergeStatic } from './shared';
import { charactersReady } from './gltf/assets';
import { GltfCharacter } from './gltf/character';
import { villagerSpec, heroSpec, samodivaSpec, talasamSpec } from './gltf/looks';
export { preloadCharacters, charactersReady } from './gltf/assets';

/** Реалистичен модел, ако хората са заредени; при грешка — null (тогава процедурният). */
function gltfOr<T>(make: () => T): T | null {
  if (!charactersReady()) return null;
  try { return make(); } catch (e) { console.warn('Моделът на човека не стана — процедурен.', e); return null; }
}

/** Жител по външния му вид (VILLAGERS[id].look). Моделът има и `seatHeight` (за 'sit', по подразбиране 0.45 м). */
export function createVillagerModel(look: VillagerLook): CharacterModel {
  return gltfOr(() => new GltfCharacter(villagerSpec(look))) ?? buildVillager(look);
}

/** Стоян. Начално оръжие: 'saber' в ръката. */
export function createHeroModel(): HeroModel {
  return gltfOr(() => { const h = new GltfCharacter(heroSpec()); h.setWeapon('saber'); return h; }) ?? new Hero();
}

export function createMonsterModel(kind: MonsterKind): CharacterModel {
  if (kind === 'karakondzhul') return new Karakondzhul();
  if (kind === 'talasam') return gltfOr(() => new GltfCharacter(talasamSpec())) ?? new Talasam();
  return new Quadruped('fox_talasam');
}

export function createSamodivaModel(index = 0): CharacterModel {
  return gltfOr(() => new GltfCharacter(samodivaSpec(index))) ?? new Samodiva(index);
}

export function createAnimalModel(kind: AnimalKind): CharacterModel { return buildAnimal(kind); }

/** Кон с дадена маст (седлото се показва със setSaddled). */
export function createHorseModel(coat: HorseCoat = 'bay'): HorseModel { return new Quadruped('horse', coat); }

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
  // сандъкът пази отделен капак (име 'lid'), за да може да се отваря
  const lid = g.getObjectByName('lid');
  if (lid) mergeStatic(lid);
  mergeStatic(g, lid);
  return g;
}
