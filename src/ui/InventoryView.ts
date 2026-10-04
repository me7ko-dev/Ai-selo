// Герой и раница (Tab): статистики, 6 слота екипировка около силует, раница 6×4, бърза лента, подсказки, влачене.
import type { IconKey } from '../data/icons';
import { h, esc } from './dom';
import { icon } from './icons';
import { ModalView, cornersHtml } from './view';
import { dividerHtml } from './ornament';
import './css/inventory.css';

export type EquipSlot = 'weapon' | 'head' | 'body' | 'hands' | 'feet' | 'amulet';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'head', 'body', 'hands', 'feet', 'amulet'];
export const EQUIP_LABELS: Record<EquipSlot, string> = { weapon: 'Оръжие', head: 'Глава', body: 'Тяло', hands: 'Ръце', feet: 'Крака', amulet: 'Амулет' };
const EQUIP_ICON: Record<EquipSlot, IconKey> = { weapon: 'sword', head: 'kalpak', body: 'vest', hands: 'gloves', feet: 'tsarvuli', amulet: 'martenitsa' };

export interface ItemView {
  id: string;
  name: string;
  icon: IconKey;
  count: number;
  desc: string;
  kind: string;                    // 'weapon' | 'armor' | 'food' | 'potion' | 'quest' | 'material' …
  /** Ако предметът се облича — в кой слот (тогава клик = onEquip, иначе клик = onUse). */
  equip?: EquipSlot;
  /** Редове за подсказката: [{ label: 'Щета', value: '+12' }]. */
  stats?: { label: string; value: string }[];
  /** 'common' | 'rare' | 'legend' — цвят на рамката. */
  rarity?: 'common' | 'rare' | 'legend';
}

export interface HeroStats {
  level: number; title?: string;
  xp: number; xpMax: number;
  hp: number; hpMax: number;
  stamina: number; staminaMax: number;
  damage: number; armor: number; gold: number;
}

export interface InventoryData {
  slots: (ItemView | null)[];      // 24 (6×4)
  equipment: Record<EquipSlot, ItemView | null>;
  hotbar: (ItemView | null)[];     // 6
  stats: HeroStats;
}

type Ref = { area: 'bag'; i: number } | { area: 'eq'; slot: EquipSlot } | { area: 'hot'; i: number };
const KIND_LABEL: Record<string, string> = { weapon: 'оръжие', armor: 'облекло', food: 'храна', potion: 'отвара', quest: 'за задача', material: 'материал', amulet: 'амулет', misc: 'вещ' };

export class InventoryView extends ModalView {
  onUse: (i: number) => void = () => {};
  onEquip: (i: number) => void = () => {};
  onUnequip: (slot: EquipSlot) => void = () => {};
  onMove: (from: number, to: number) => void = () => {};
  /** i = индекс в раницата; i = -1 → изчисти клетката hot. */
  onAssignHotbar: (i: number, hot: number) => void = () => {};

  private data: InventoryData | null = null;
  private statsEl: HTMLElement; private eqEl: HTMLElement; private bagEl: HTMLElement; private hotEl: HTMLElement; private tip: HTMLElement;
  private drag: Ref | null = null;

  constructor(root: HTMLElement) {
    super(root, 'inv-back');
    this.closeKeys = ['Tab'];
    this.statsEl = h('div.inv-stats');
    this.eqEl = h('div.inv-eq');
    this.bagEl = h('div.inv-bag');
    this.hotEl = h('div.inv-hot');
    this.tip = h('div.inv-tip.hidden');
    const close = h('button.icon-btn.close-x', { text: '×', title: 'Затвори (Tab / Esc)' });
    close.addEventListener('click', () => this.dismiss());
    const box = h('div.modal.inv', { html: cornersHtml() },
      h('div.modal-head', null, h('div.modal-title', { text: 'Герой и раница' }), h('span.hint', { html: '<kbd>Tab</kbd> затвори' }), close),
      h('div.inv-body', null,
        h('div.inv-col.inv-left', null, h('div.inv-h', { text: 'Стоян' }), this.statsEl),
        h('div.inv-col.inv-mid', null, h('div.inv-h', { text: 'Екипировка' }), this.eqEl),
        h('div.inv-col.inv-right', null,
          h('div.inv-h', { text: 'Раница' }), this.bagEl,
          h('div.inv-h.sm', { text: 'Бърза лента' }), this.hotEl,
          h('div.hint.inv-help', { text: 'Клик — използвай / облечи · Десен клик — свали · Влачи до бързата лента' })),
      ),
    );
    this.el.append(box, this.tip);
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.dismiss(); });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  open(d: InventoryData): void { this.update(d); this.openBase(); }
  show(d: InventoryData): void { this.open(d); }

  update(d: InventoryData): void {
    this.data = d;
    this.renderStats(d.stats);
    this.renderEq(d.equipment);
    this.bagEl.innerHTML = '';
    for (let i = 0; i < 24; i++) this.bagEl.append(this.cell(d.slots[i] ?? null, { area: 'bag', i }));
    this.hotEl.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const c = this.cell(d.hotbar[i] ?? null, { area: 'hot', i });
      c.append(h('span.inv-key', { text: String(i + 1) }));
      this.hotEl.append(c);
    }
  }

  hide(): void { super.hide(); this.tip.classList.add('hidden'); }

  private renderStats(s: HeroStats): void {
    const row = (ic: IconKey, label: string, val: string, cls = '') => `<div class="inv-stat ${cls}">${icon(ic, '1.3em')}<span>${label}</span><b>${esc(val)}</b></div>`;
    const bar = (cls: string, v: number, m: number) => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, (v / Math.max(1, m)) * 100))}%"></i><span class="bar-txt">${Math.ceil(v)} / ${m}</span></div>`;
    this.statsEl.innerHTML = `
      <div class="inv-lvl"><span class="inv-lvl-n">${s.level}</span><div><div class="inv-lvl-t">Ниво ${s.level}</div><div class="hint">${esc(s.title ?? 'Странник')}</div></div></div>
      <div class="inv-barlbl">Опит <span>${s.xp} / ${s.xpMax}</span></div><div class="bar xp inv-xp"><i style="width:${(s.xp / Math.max(1, s.xpMax)) * 100}%"></i></div>
      <div class="inv-barlbl">Живот</div>${bar('hp', s.hp, s.hpMax)}
      <div class="inv-barlbl">Сила</div>${bar('st', s.stamina, s.staminaMax)}
      ${dividerHtml()}
      ${row('sword', 'Щета', String(s.damage))}
      ${row('shield', 'Броня', String(s.armor))}
      ${row('coin', 'Жълтици', String(s.gold), 'gold')}`;
  }

  private renderEq(eq: Record<EquipSlot, ItemView | null>): void {
    this.eqEl.innerHTML = `<svg class="inv-sil" viewBox="0 0 100 140" aria-hidden="true"><path d="M50 8 C38 8 33 18 33 28 C33 36 36 42 40 45 C28 48 20 56 18 70 L14 100 L24 102 L28 78 L30 132 L46 132 L50 96 L54 132 L70 132 L72 78 L76 102 L86 100 L82 70 C80 56 72 48 60 45 C64 42 67 36 67 28 C67 18 62 8 50 8 Z" fill="rgba(232,194,122,0.07)" stroke="rgba(232,194,122,0.3)" stroke-width="1"/><path d="M50 8 C40 8 34 16 33 26 C40 20 60 20 67 26 C66 16 60 8 50 8 Z" fill="rgba(107,74,47,0.35)"/></svg>`;
    for (const s of EQUIP_SLOTS) {
      const c = this.cell(eq[s], { area: 'eq', slot: s });
      c.classList.add('inv-eqslot', `eq-${s}`);
      if (!eq[s]) c.insertAdjacentHTML('beforeend', `<span class="inv-ghost">${icon(EQUIP_ICON[s], '100%')}</span>`);
      c.append(h('span.inv-eqlbl', { text: EQUIP_LABELS[s] }));
      this.eqEl.append(c);
    }
  }

  private cell(it: ItemView | null, ref: Ref): HTMLElement {
    const c = h(`div.inv-cell${it ? '' : '.empty'}${it?.rarity ? `.r-${it.rarity}` : ''}`);
    if (it) {
      c.insertAdjacentHTML('beforeend', `<span class="inv-ic">${icon(it.icon, '100%')}</span>${it.count > 1 ? `<span class="inv-cnt">${it.count}</span>` : ''}`);
      c.draggable = true;
      c.addEventListener('dragstart', (e) => { this.drag = ref; c.classList.add('dragging'); this.tip.classList.add('hidden'); e.dataTransfer?.setData('text/plain', JSON.stringify(ref)); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
      c.addEventListener('dragend', () => { this.drag = null; c.classList.remove('dragging'); });
      c.addEventListener('mouseenter', (e) => this.showTip(it, e));
      c.addEventListener('mousemove', (e) => this.moveTip(e));
      c.addEventListener('mouseleave', () => this.tip.classList.add('hidden'));
      c.addEventListener('click', () => this.click(ref, it));
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.rclick(ref); });
    }
    c.addEventListener('dragover', (e) => { if (this.drag && this.canDrop(this.drag, ref)) { e.preventDefault(); c.classList.add('over'); } });
    c.addEventListener('dragleave', () => c.classList.remove('over'));
    c.addEventListener('drop', (e) => { e.preventDefault(); c.classList.remove('over'); if (this.drag) this.drop(this.drag, ref); this.drag = null; });
    return c;
  }

  private click(ref: Ref, it: ItemView): void {
    if (ref.area === 'bag') { if (it.equip) this.onEquip(ref.i); else this.onUse(ref.i); }
    else if (ref.area === 'eq') this.onUnequip(ref.slot);
    else if (ref.area === 'hot') {
      // клик в бързата лента = използвай предмета (намираме го в раницата по id)
      const i = this.data?.slots.findIndex((s) => s?.id === it.id) ?? -1;
      if (i >= 0) this.onUse(i);
    }
  }

  private rclick(ref: Ref): void {
    if (ref.area === 'eq') this.onUnequip(ref.slot);
    else if (ref.area === 'hot') this.onAssignHotbar(-1, ref.i);
    else if (ref.area === 'bag') { const it = this.data?.slots[ref.i]; if (it?.equip) this.onEquip(ref.i); }
  }

  private canDrop(from: Ref, to: Ref): boolean {
    if (from.area === 'bag' && to.area === 'eq') return this.data?.slots[from.i]?.equip === to.slot;
    if (from.area === 'eq') return to.area === 'bag';
    if (from.area === 'hot') return to.area === 'hot' || to.area === 'bag';
    return true;
  }

  private drop(from: Ref, to: Ref): void {
    if (from.area === 'bag' && to.area === 'bag') { if (from.i !== to.i) this.onMove(from.i, to.i); }
    else if (from.area === 'bag' && to.area === 'eq') this.onEquip(from.i);
    else if (from.area === 'bag' && to.area === 'hot') this.onAssignHotbar(from.i, to.i);
    else if (from.area === 'eq' && to.area === 'bag') this.onUnequip(from.slot);
    else if (from.area === 'hot' && to.area === 'bag') this.onAssignHotbar(-1, from.i);
    else if (from.area === 'hot' && to.area === 'hot' && from.i !== to.i) {
      const it = this.data?.hotbar[from.i];
      const bi = it ? this.data!.slots.findIndex((s) => s?.id === it.id) : -1;
      if (bi >= 0) { this.onAssignHotbar(bi, to.i); this.onAssignHotbar(-1, from.i); }
    }
  }

  private showTip(it: ItemView, e: MouseEvent): void {
    const kind = KIND_LABEL[it.kind] ?? it.kind;
    const stats = (it.stats ?? []).map((s) => `<div class="tip-stat"><span>${esc(s.label)}</span><b>${esc(s.value)}</b></div>`).join('');
    const action = it.equip ? 'Клик — облечи' : (it.kind === 'food' || it.kind === 'potion') ? 'Клик — използвай' : '';
    this.tip.innerHTML = `<div class="tip-head">${icon(it.icon, '2em')}<div><div class="tip-name r-${it.rarity ?? 'common'}">${esc(it.name)}${it.count > 1 ? ` <span class="hint">×${it.count}</span>` : ''}</div><div class="tip-kind">${esc(kind)}</div></div></div><div class="tip-desc">${esc(it.desc)}</div>${stats}${action ? `<div class="tip-act">${action}</div>` : ''}`;
    this.tip.classList.remove('hidden');
    this.moveTip(e);
  }

  private moveTip(e: MouseEvent): void {
    const r = this.tip.getBoundingClientRect();
    let x = e.clientX + 18, y = e.clientY + 18;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
    this.tip.style.transform = `translate(${x}px, ${y}px)`;
  }
}
