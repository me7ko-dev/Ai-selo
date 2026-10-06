// Предметите в играта (без three.js). Имената и описанията са на български.
import type { IconKey } from '../data/icons';

export type EquipSlot = 'weapon' | 'head' | 'body' | 'hands' | 'feet' | 'amulet';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'head', 'body', 'hands', 'feet', 'amulet'];
export const EQUIP_SLOT_NAMES: Record<EquipSlot, string> = {
  weapon: 'оръжие', head: 'глава', body: 'тяло', hands: 'ръце', feet: 'крака', amulet: 'амулет',
};

export type ItemId =
  | 'saber' | 'ivan_saber' | 'bow'
  | 'kalpak' | 'yamurluk' | 'gloves' | 'tsarvuli' | 'martenitsa'
  | 'rosen' | 'rosen_potion' | 'banitsa' | 'tea'
  | 'fox_tail' | 'lamia_scale' | 'claw' | 'bell' | 'saddle' | 'coin';

export type ItemKind = 'weapon' | 'armor' | 'consumable' | 'quest' | 'loot' | 'trophy' | 'gold';

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  icon: IconKey;
  kind: ItemKind;
  /** Максимум в една клетка. */
  stack: number;
  slot?: EquipSlot;
  damage?: number;
  armor?: number;
  maxHp?: number;
  maxStamina?: number;
  /** Лекува живот. */
  heal?: number;
  /** Връща сила. */
  stamina?: number;
  /** Оръжие от разстояние (лък). */
  ranged?: boolean;
  /** Цена в грошове (за продажба/купуване). */
  value?: number;
}

const D = (d: ItemDef) => d;

export const ITEMS: Record<ItemId, ItemDef> = {
  saber: D({ id: 'saber', name: 'Сабя', desc: 'Стара, но вярна сабя. Носиш я от далечния си край.', icon: 'saber', kind: 'weapon', stack: 1, slot: 'weapon', damage: 14, value: 20 }),
  ivan_saber: D({ id: 'ivan_saber', name: 'Сабята на Иван', desc: 'Изкована от Иван ковача в знак на благодарност. Остра като дума на мълчалив човек.', icon: 'ivan_saber', kind: 'weapon', stack: 1, slot: 'weapon', damage: 26, value: 120 }),
  bow: D({ id: 'bow', name: 'Лъкът на Калин', desc: 'Калин го правил тайно цяло лято — за героя, който ще спаси селото. Стреля надалеч.', icon: 'bow', kind: 'weapon', stack: 1, slot: 'weapon', damage: 18, ranged: true, value: 100 }),
  kalpak: D({ id: 'kalpak', name: 'Калпак', desc: 'Агнешки калпак от дядо Пею. Топъл и горд като кмета.', icon: 'kalpak', kind: 'armor', stack: 1, slot: 'head', armor: 6, maxHp: 10, value: 40 }),
  yamurluk: D({ id: 'yamurluk', name: 'Ямурлук', desc: 'Кафяво вълнено наметало с качулка. Пази от вятър, дъжд и нокти.', icon: 'cloak', kind: 'armor', stack: 1, slot: 'body', armor: 8, value: 30 }),
  gloves: D({ id: 'gloves', name: 'Кожени ръкавици', desc: 'Здрави ръкавици от щавена кожа. Сабята не се изплъзва.', icon: 'gloves', kind: 'armor', stack: 1, slot: 'hands', armor: 4, damage: 2, value: 25 }),
  tsarvuli: D({ id: 'tsarvuli', name: 'Цървули', desc: 'Леки цървули от свинска кожа. С тях се тича дълго.', icon: 'tsarvuli', kind: 'armor', stack: 1, slot: 'feet', armor: 3, maxStamina: 10, value: 15 }),
  martenitsa: D({ id: 'martenitsa', name: 'Мартеница', desc: 'Бяло и червено, усукани за здраве. Дава сила на сърцето.', icon: 'martenitsa', kind: 'armor', stack: 1, slot: 'amulet', maxHp: 40, value: 50 }),
  rosen: D({ id: 'rosen', name: 'Росен', desc: 'Билка, която расте само в Тъмната гора. Баба Гена я търси за отвара.', icon: 'rosen', kind: 'quest', stack: 10 }),
  rosen_potion: D({ id: 'rosen_potion', name: 'Отвара от росен', desc: 'Горчива отвара на баба Гена. Лекува и тежки рани.', icon: 'potion', kind: 'consumable', stack: 5, heal: 80, value: 30 }),
  banitsa: D({ id: 'banitsa', name: 'Баница', desc: 'Топла баница със сирене от хана. Възвръща живота.', icon: 'banitsa', kind: 'consumable', stack: 10, heal: 35, value: 6 }),
  tea: D({ id: 'tea', name: 'Билков чай', desc: 'Чай от мащерка и липа. Връща силата за тичане и бой.', icon: 'tea', kind: 'consumable', stack: 10, stamina: 100, heal: 5, value: 4 }),
  fox_tail: D({ id: 'fox_tail', name: 'Лисича опашка', desc: 'Рижа опашка с черен връх — от лисицата-таласъм, която крадеше кокошките.', icon: 'fox_tail', kind: 'quest', stack: 1 }),
  lamia_scale: D({ id: 'lamia_scale', name: 'Люспа от Ламята', desc: 'Тежка зелена люспа, твърда като желязо. Доказателство за победата.', icon: 'lamia_scale', kind: 'trophy', stack: 5, value: 200 }),
  claw: D({ id: 'claw', name: 'Таласъмски нокът', desc: 'Черен извит нокът. Ковачът дава грошове за такива.', icon: 'claw', kind: 'loot', stack: 20, value: 3 }),
  bell: D({ id: 'bell', name: 'Звънче', desc: 'Медно звънче от козя шия, намерено в нивата на Иван. Чие ли е?', icon: 'bell', kind: 'quest', stack: 1 }),
  saddle: D({ id: 'saddle', name: 'Седло', desc: 'Дървено седло от Калин: кожена седалка, стремена и шарена черга. Застани до опитомен кон и натисни [E], за да го оседлаеш.', icon: 'saddle', kind: 'loot', stack: 3, value: 30 }),
  coin: D({ id: 'coin', name: 'грошове', desc: 'Сребърни грошове.', icon: 'coin', kind: 'gold', stack: 99999 }),
};

export function itemDef(id: string): ItemDef | undefined { return (ITEMS as Record<string, ItemDef>)[id]; }
export function isItemId(id: string): id is ItemId { return id in ITEMS; }

/** Изглед на предмет за интерфейса. */
export interface ItemStackView { id: ItemId; name: string; icon: IconKey; count: number; desc: string; kind: ItemKind; slot?: EquipSlot; stats?: string }

export function statLine(d: ItemDef): string {
  const p: string[] = [];
  if (d.damage) p.push(d.kind === 'weapon' ? `Удар ${d.damage}` : `Удар +${d.damage}`);
  if (d.armor) p.push(`Броня +${d.armor}`);
  if (d.maxHp) p.push(`Живот +${d.maxHp}`);
  if (d.maxStamina) p.push(`Сила +${d.maxStamina}`);
  if (d.heal) p.push(`Лекува ${d.heal}`);
  if (d.stamina) p.push(`Сила +${d.stamina}`);
  if (d.ranged) p.push('от разстояние');
  return p.join(' · ');
}

export function viewOf(id: ItemId, count: number): ItemStackView {
  const d = ITEMS[id];
  const s = statLine(d);
  return { id, name: d.name, icon: d.icon, count, desc: d.desc, kind: d.kind, slot: d.slot, stats: s || undefined };
}
