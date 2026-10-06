// Договор за моделите на героите и чудовищата. Моделът гледа към +Z, стъпалата са в y = 0.
// За да го завъртиш към посока (dx, dz): root.rotation.y = Math.atan2(dx, dz).
import type * as THREE from 'three';

export type AnimName =
  | 'idle' | 'walk' | 'run' | 'attack' | 'attack2' | 'hit' | 'die' | 'talk' | 'work' | 'sit' | 'sleep'
  | 'dance' | 'jump' | 'cast' | 'wave' | 'block';

export interface CharacterModel {
  readonly root: THREE.Group;
  /** Приблизителна височина (за етикета с името над главата). */
  readonly height: number;
  /** Смяна на анимация. Еднократните (attack, hit, die, jump, cast, wave) сами се връщат към предишната. */
  play(anim: AnimName, opts?: { loop?: boolean; speed?: number }): void;
  readonly current: AnimName;
  /** Всеки кадър. moveSpeed (м/с) нагласява темпото на ходене/тичане. */
  update(dt: number, moveSpeed?: number): void;
  /** Кратко оцветяване при удар (null = махни). */
  flash(color?: number): void;
  /** Точка в ръката (за оръжие) — ако има. */
  readonly hand?: THREE.Object3D;
  dispose(): void;
}

export interface HeroModel extends CharacterModel {
  /** Смяна на оръжието в ръката: 'saber' (начално), 'ivan_saber' (Сабята на Иван), 'bow', null. */
  setWeapon(kind: 'saber' | 'ivan_saber' | 'bow' | null): void;
}

export interface LamiaModel extends CharacterModel {
  /** Трите глави (за прицел, удари и ефекти). */
  readonly heads: THREE.Object3D[];
  setHeadAlive(i: number, alive: boolean): void;
  /** Анимация на атака с една глава (захапка/огън). */
  headAttack(i: number, kind?: 'bite' | 'fire'): void;
}

export type AnimalKind = 'sheep' | 'goat' | 'chicken' | 'dog' | 'cat' | 'horse';
export type MonsterKind = 'talasam' | 'fox_talasam' | 'karakondzhul';
