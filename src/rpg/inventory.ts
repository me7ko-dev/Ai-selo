// Раница 6×4, екипировка (6 слота), бърза лента (6). Чиста логика — без three.js.
import { EQUIP_SLOTS, ITEMS, type EquipSlot, type ItemId, isItemId } from './items';

export const INV_SIZE = 24;
export const HOTBAR_SIZE = 6;

export interface Stack { id: ItemId; count: number }

export interface InventorySave {
  slots: (Stack | null)[];
  equipment: Record<EquipSlot, ItemId | null>;
  hotbar: (ItemId | null)[];
  gold: number;
}

export class Inventory {
  slots: (Stack | null)[] = new Array(INV_SIZE).fill(null);
  equipment: Record<EquipSlot, ItemId | null> = { weapon: null, head: null, body: null, hands: null, feet: null, amulet: null };
  /** Бързата лента сочи вид предмет (не клетка) — броят е общият брой в раницата. */
  hotbar: (ItemId | null)[] = new Array(HOTBAR_SIZE).fill(null);
  gold = 0;

  /** Добавя предмети. Връща колко НЕ са влезли (раницата е пълна). Грошовете отиват в gold. */
  add(id: ItemId, count = 1): number {
    if (count <= 0) return 0;
    if (id === 'coin') { this.gold += count; return 0; }
    const max = ITEMS[id].stack;
    let left = count;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.count < max) { const k = Math.min(max - s.count, left); s.count += k; left -= k; }
    }
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      if (!this.slots[i]) { const k = Math.min(max, left); this.slots[i] = { id, count: k }; left -= k; }
    }
    return left;
  }

  /** Може ли да влезе (без да добавя). */
  canAdd(id: ItemId, count = 1): boolean {
    if (id === 'coin') return true;
    const max = ITEMS[id].stack;
    let room = 0;
    for (const s of this.slots) { if (!s) room += max; else if (s.id === id) room += max - s.count; }
    return room >= count;
  }

  count(id: ItemId): number {
    if (id === 'coin') return this.gold;
    let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n;
  }
  has(id: ItemId, n = 1): boolean { return this.count(id) >= n || this.isEquipped(id) && n === 1; }
  isEquipped(id: ItemId): boolean { return EQUIP_SLOTS.some(sl => this.equipment[sl] === id); }

  /** Маха n броя (от последните клетки). Връща true, ако е имало достатъчно. */
  remove(id: ItemId, n = 1): boolean {
    if (id === 'coin') { if (this.gold < n) return false; this.gold -= n; return true; }
    if (this.count(id) < n) return false;
    for (let i = INV_SIZE - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) { const k = Math.min(s.count, n); s.count -= k; n -= k; if (s.count <= 0) this.slots[i] = null; }
    }
    return true;
  }

  removeAt(i: number, n = 1): Stack | null {
    const s = this.slots[i]; if (!s) return null;
    const k = Math.min(n, s.count);
    s.count -= k; if (s.count <= 0) this.slots[i] = null;
    return { id: s.id, count: k };
  }

  /** Местене/размяна/сливане между клетки. */
  move(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= INV_SIZE || to >= INV_SIZE) return;
    const a = this.slots[from], b = this.slots[to];
    if (!a) return;
    if (b && b.id === a.id) {
      const max = ITEMS[a.id].stack;
      const k = Math.min(max - b.count, a.count);
      b.count += k; a.count -= k;
      if (a.count <= 0) this.slots[from] = null;
      return;
    }
    this.slots[to] = a; this.slots[from] = b;
  }

  /** Слага предмета от клетка i в неговия слот; старият отива на мястото му. Връща слота или null. */
  equipFromSlot(i: number): EquipSlot | null {
    const s = this.slots[i]; if (!s) return null;
    const def = ITEMS[s.id]; if (!def.slot) return null;
    const prev = this.equipment[def.slot];
    this.equipment[def.slot] = s.id;
    this.removeAt(i, 1);
    if (prev) {
      if (!this.slots[i]) this.slots[i] = { id: prev, count: 1 };
      else this.add(prev, 1);
    }
    return def.slot;
  }

  /** Сваля предмета от слота в раницата. false, ако раницата е пълна. */
  unequip(slot: EquipSlot): boolean {
    const id = this.equipment[slot]; if (!id) return false;
    if (!this.canAdd(id, 1)) return false;
    this.add(id, 1); this.equipment[slot] = null;
    return true;
  }

  /** Слага направо (за начално снаряжение и награди). */
  equipDirect(id: ItemId): void {
    const def = ITEMS[id]; if (!def.slot) return;
    const prev = this.equipment[def.slot];
    this.equipment[def.slot] = id;
    if (prev) this.add(prev, 1);
  }

  /** Намира клетка с предмета. */
  find(id: ItemId): number { return this.slots.findIndex(s => !!s && s.id === id); }

  assignHotbar(slot: number, hot: number): void {
    if (hot < 0 || hot >= HOTBAR_SIZE) return;
    const s = this.slots[slot];
    if (!s) { this.hotbar[hot] = null; return; }
    // един вид — една клетка в лентата
    for (let h = 0; h < HOTBAR_SIZE; h++) if (this.hotbar[h] === s.id) this.hotbar[h] = null;
    this.hotbar[hot] = s.id;
  }

  /** Сумарни бонуси от екипировката. */
  bonuses(): { damage: number; armor: number; maxHp: number; maxStamina: number; weaponDamage: number; ranged: boolean } {
    let damage = 0, armor = 0, maxHp = 0, maxStamina = 0;
    for (const sl of EQUIP_SLOTS) {
      const id = this.equipment[sl]; if (!id) continue;
      const d = ITEMS[id];
      if (sl !== 'weapon') damage += d.damage ?? 0;
      armor += d.armor ?? 0; maxHp += d.maxHp ?? 0; maxStamina += d.maxStamina ?? 0;
    }
    const w = this.equipment.weapon ? ITEMS[this.equipment.weapon] : null;
    return { damage, armor, maxHp, maxStamina, weaponDamage: w?.damage ?? 3, ranged: !!w?.ranged };
  }

  serialize(): InventorySave {
    return {
      slots: this.slots.map(s => (s ? { id: s.id, count: s.count } : null)),
      equipment: { ...this.equipment },
      hotbar: [...this.hotbar],
      gold: this.gold,
    };
  }

  load(s: InventorySave): void {
    this.slots = new Array(INV_SIZE).fill(null);
    (s.slots ?? []).forEach((st, i) => { if (st && i < INV_SIZE && isItemId(st.id) && st.count > 0) this.slots[i] = { id: st.id, count: st.count }; });
    for (const sl of EQUIP_SLOTS) { const id = s.equipment?.[sl]; this.equipment[sl] = id && isItemId(id) ? id : null; }
    this.hotbar = new Array(HOTBAR_SIZE).fill(null);
    (s.hotbar ?? []).forEach((h, i) => { if (h && i < HOTBAR_SIZE && isItemId(h)) this.hotbar[i] = h; });
    this.gold = Math.max(0, Math.floor(s.gold ?? 0));
  }

  /** Началното снаряжение на Стоян. */
  static starting(): Inventory {
    const inv = new Inventory();
    inv.equipment.weapon = 'saber';
    inv.equipment.body = 'yamurluk';
    inv.equipment.feet = 'tsarvuli';
    inv.add('banitsa', 2);
    inv.add('tea', 1);
    inv.hotbar[0] = 'banitsa';
    inv.hotbar[1] = 'tea';
    inv.gold = 15;
    return inv;
  }
}
