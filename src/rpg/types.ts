// Общи типове на RPG частта (без three.js): събития, данни за интерфейса, запис на играча.
import type { IconKey } from '../data/icons';
import type { EquipSlot, ItemId, ItemKind, ItemStackView } from './items';
import type { InventorySave } from './inventory';
import type { QuestsSave, NotifyKind } from './quests';
import type { StatsSave } from './stats';

export type { EquipSlot, ItemId, ItemKind, ItemStackView, NotifyKind };

export interface BossHead { hp: number; max: number }

export interface RpgEvents extends Record<string, unknown> {
  notify: { text: string; kind: NotifyKind };
  levelup: { level: number; title: string };
  died: Record<string, never>;
  respawn: Record<string, never>;
  pickup: { item: ItemId; count: number; name: string; icon: IconKey };
  killed: { kind: 'talasam' | 'fox_talasam' | 'lamia' | 'lamia_head' };
  quest: { id: string; stage: string; title: string; text: string };
  questDone: { id: string; title: string };
  boss: { active: boolean; heads: BossHead[]; phase: number };
  lamiaDefeated: Record<string, never>;
  /** Число за щета: target 'hero' — Стоян пострада; 'enemy' — Стоян удари (x,y,z е в света, за плаващи числа). */
  damage: { amount: number; target: 'hero' | 'enemy'; x: number; y: number; z: number; blocked?: boolean; crit?: boolean };
  /** Звук: swing, hit, hurt, block, die, pickup, coin, levelup, growl, roar, bite, fire, rock, bow, quest, jump, chest, fox, heal */
  sfx: { name: string };
}

export interface HotbarCell { icon: IconKey; name: string; count: number; id: ItemId }

export interface HudState {
  hp: number; maxHp: number;
  stamina: number; maxStamina: number;
  level: number; title: string;
  xp: number; xpNext: number;
  gold: number;
  hotbar: (HotbarCell | null)[];
  boss: { heads: BossHead[]; phase: number; name: string } | null;
  dead: boolean;
  blocking: boolean;
}

export interface InventoryState {
  slots: (ItemStackView | null)[];
  equipment: Record<EquipSlot, ItemStackView | null>;
  stats: { damage: number; armor: number; maxHp: number; maxStamina: number; level: number; title: string; xp: number; xpNext: number; gold: number };
  hotbar: (ItemId | null)[];
}

export interface PlayerSave {
  v: 1;
  stats: StatsSave;
  inventory: InventorySave;
  quests: QuestsSave;
  pos: { x: number; z: number; yaw: number };
  /** base64 на 64×64 бита */
  explored: string;
  lamia: { heads: number[]; dead: boolean };
  /** Индекси на обраните места с росен (ROSEN_SPOTS). */
  rosenPicked: number[];
  bellTaken: boolean;
  chestsOpened: string[];
}
