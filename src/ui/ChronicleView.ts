// Летопис на Самодивско (J): стара отворена книга, записи по дни, филтри по жител и вид, страници.
import type { ChronicleEntry, ChronicleType } from '../sim/types';
import { VILLAGER_IDS, VILLAGERS } from '../data/villagers';
import { formatClock } from '../core/time';
import { h, esc } from './dom';
import { portrait, typeIcon, sparkle, TYPE_LABELS } from './icons';
import { ModalView } from './view';
import { groupByDay, paginate } from './logic';
import { rosetteHtml } from './ornament';
import './css/chronicle.css';

export interface ChronicleData {
  entries: ChronicleEntry[];
  /** Заглавие (по подразбиране „Летопис на Самодивско“). */
  title?: string;
  /** Кои жители да има като филтри (по подразбиране всички 7). */
  villagers?: { id: string; name: string }[];
}

type Row = { kind: 'day'; day: number; cont?: boolean } | { kind: 'e'; e: ChronicleEntry; first: boolean };

const FILTER_TYPES: ChronicleType[] = ['talk', 'quarrel', 'love', 'theft', 'rumor', 'election', 'festival', 'monster', 'player', 'quest', 'weather', 'live', 'reflection'];

export class ChronicleView extends ModalView {
  private data: ChronicleData = { entries: [] };
  private who: string | null = null;
  private type: ChronicleType | null = null;
  private newest = true;
  private spread = 0;
  private pages: Row[][] = [];
  private whoEl: HTMLElement; private typeEl: HTMLElement; private left: HTMLElement; private right: HTMLElement;
  private pageNo: HTMLElement; private prevBtn: HTMLButtonElement; private nextBtn: HTMLButtonElement; private orderBtn: HTMLButtonElement;
  private titleEl: HTMLElement;
  /** Колко „реда“ събира една страница (настройва се при нужда). */
  linesPerPage = 19;
  charsPerLine = 46;

  constructor(root: HTMLElement) {
    super(root, 'chr-back');
    this.closeKeys = ['KeyJ'];
    this.whoEl = h('div.chr-who');
    this.typeEl = h('div.chr-types');
    this.left = h('div.chr-page.left');
    this.right = h('div.chr-page.right');
    this.pageNo = h('div.chr-pageno');
    this.titleEl = h('div.chr-title');
    this.prevBtn = h('button.icon-btn.chr-nav.prev', { html: '‹', title: 'Назад (←)' }) as HTMLButtonElement;
    this.nextBtn = h('button.icon-btn.chr-nav.next', { html: '›', title: 'Напред (→)' }) as HTMLButtonElement;
    this.orderBtn = h('button.btn.small.ghost', { text: 'Най-новите първо' }) as HTMLButtonElement;
    this.prevBtn.addEventListener('click', () => this.turn(-1));
    this.nextBtn.addEventListener('click', () => this.turn(1));
    this.orderBtn.addEventListener('click', () => { this.newest = !this.newest; this.spread = 0; this.rebuild(); });
    const close = h('button.icon-btn.close-x', { text: '×', title: 'Затвори (J / Esc)' });
    close.addEventListener('click', () => this.dismiss());
    const book = h('div.chr-book', null,
      h('div.chr-cover'),
      h('div.chr-pages', null, this.left, h('div.chr-spine'), this.right),
      this.prevBtn, this.nextBtn,
    );
    this.el.append(h('div.chr-wrap', null,
      h('div.chr-top', null, this.titleEl, close),
      h('div.chr-filters', null, this.whoEl, h('div.chr-frow', null, this.typeEl, this.orderBtn)),
      book,
      h('div.chr-foot', null, this.pageNo, h('span.hint', { html: '<kbd>←</kbd> <kbd>→</kbd> страници · <kbd>J</kbd> затвори' })),
    ));
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.dismiss(); });
  }

  open(d: ChronicleData): void { this.spread = 0; this.update(d); this.openBase(); }
  show(d: ChronicleData): void { this.open(d); }

  update(d: ChronicleData): void {
    this.data = d;
    this.titleEl.innerHTML = `${rosetteHtml('0.8em')}<span>${esc(d.title ?? 'Летопис на Самодивско')}</span>${rosetteHtml('0.8em')}`;
    const vs = d.villagers ?? VILLAGER_IDS.map((id) => ({ id, name: VILLAGERS[id].name }));
    this.whoEl.innerHTML = '';
    const all = h(`button.chr-chip.all${this.who === null ? '.on' : ''}`, { text: 'Всички' });
    all.addEventListener('click', () => { this.who = null; this.spread = 0; this.update(this.data); });
    this.whoEl.append(all);
    for (const v of [...vs, { id: 'player', name: 'Странникът' }]) {
      const b = h(`button.chr-chip${this.who === v.id ? '.on' : ''}`, { title: v.name, html: `${portrait(v.id === 'player' ? 'hero' : v.id, '1.7em')}<span>${esc(v.name)}</span>` });
      b.addEventListener('click', () => { this.who = this.who === v.id ? null : v.id; this.spread = 0; this.update(this.data); });
      this.whoEl.append(b);
    }
    this.typeEl.innerHTML = '';
    for (const t of FILTER_TYPES) {
      const b = h(`button.chr-type${this.type === t ? '.on' : ''}`, { title: TYPE_LABELS[t], html: typeIcon(t, '1.15em') });
      b.addEventListener('click', () => { this.type = this.type === t ? null : t; this.spread = 0; this.update(this.data); });
      this.typeEl.append(b);
    }
    this.rebuild();
  }

  private filtered(): ChronicleEntry[] {
    return this.data.entries.filter((e) =>
      (this.who === null || e.participants.includes(this.who)) && (this.type === null || e.type === this.type));
  }

  private rebuild(): void {
    this.orderBtn.textContent = this.newest ? 'Най-новите първо' : 'Отначало';
    const groups = groupByDay(this.filtered(), this.newest);
    const rows: Row[] = [];
    for (const g of groups) { rows.push({ kind: 'day', day: g.day }); g.entries.forEach((e, i) => rows.push({ kind: 'e', e, first: i === 0 })); }
    const w = (r: Row) => r.kind === 'day' ? 2 : 0.5 + Math.ceil((r.e.text.length + 8) / this.charsPerLine);
    this.pages = paginate(rows, w, this.linesPerPage);
    // заглавие „Ден N“ най-долу на страницата, без записи под него — мести се горе на следващата
    for (let i = 0; i < this.pages.length - 1; i++) {
      const p = this.pages[i];
      while (p.length > 1 && p[p.length - 1].kind === 'day') this.pages[i + 1].unshift(p.pop()!);
    }
    // ако страница започва с запис, повтори деня горе („продължение“)
    for (let i = 1; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p[0].kind === 'e') {
        let day = 0;
        for (const r of this.pages[i - 1]) if (r.kind === 'day') day = r.day;
        if (!day) for (let j = i - 1; j >= 0 && !day; j--) for (const r of this.pages[j]) if (r.kind === 'day') day = r.day;
        p.unshift({ kind: 'day', day, cont: true });
      }
    }
    const maxSpread = Math.max(0, Math.ceil(this.pages.length / 2) - 1);
    this.spread = Math.min(this.spread, maxSpread);
    this.render();
  }

  private render(): void {
    const L = this.pages[this.spread * 2], R = this.pages[this.spread * 2 + 1];
    if (!this.pages.length) {
      const empty = this.data.entries.length ? 'Няма записи за този избор.' : 'Летописът още е празен. Животът в Самодивско тепърва започва…';
      this.left.innerHTML = `<div class="chr-empty"><div class="chr-empty-orn">${rosetteHtml('2.2em')}</div>${empty}</div>`;
      this.right.innerHTML = '';
    } else {
      this.left.innerHTML = L ? this.pageHtml(L) : '';
      this.right.innerHTML = R ? this.pageHtml(R) : `<div class="chr-end">${rosetteHtml('1.6em')}<div>Краят на записаното засега.</div></div>`;
    }
    const total = Math.max(1, Math.ceil(this.pages.length / 2));
    this.pageNo.textContent = `Разтвор ${this.spread + 1} от ${total}`;
    this.prevBtn.disabled = this.spread <= 0;
    this.nextBtn.disabled = this.spread >= total - 1;
  }

  private pageHtml(rows: Row[]): string {
    return rows.map((r) => {
      if (r.kind === 'day') return `<div class="chr-day${r.cont ? ' cont' : ''}"><i></i><span>Ден ${r.day}${r.cont ? ' <em>(продължение)</em>' : ''}</span><i></i></div>`;
      const e = r.e;
      const txt = esc(e.text);
      const body = r.first && txt.length > 1 ? `<span class="chr-init">${txt[0]}</span>${txt.slice(1)}` : txt;
      return `<div class="chr-e${e.importance >= 7 ? ' big' : ''}"><div class="chr-meta"><span class="chr-time">${formatClock(e.time)}</span>${typeIcon(e.type, '1.05em', '#6b3a1a')}</div><div class="chr-text">${body}${e.ai ? ` <span class="chr-ai" title="Написано от ИИ">✦</span>` : ''}</div></div>`;
    }).join('');
  }

  private turn(d: number): void {
    const total = Math.max(1, Math.ceil(this.pages.length / 2));
    const n = Math.max(0, Math.min(total - 1, this.spread + d));
    if (n === this.spread) return;
    this.spread = n;
    this.el.querySelector('.chr-pages')?.classList.remove('flip-l', 'flip-r');
    void (this.el.querySelector('.chr-pages') as HTMLElement)?.offsetWidth;
    this.el.querySelector('.chr-pages')?.classList.add(d > 0 ? 'flip-r' : 'flip-l');
    this.render();
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.code === 'ArrowRight' || e.code === 'PageDown' || e.code === 'KeyD') { e.preventDefault(); this.turn(1); }
    else if (e.code === 'ArrowLeft' || e.code === 'PageUp' || e.code === 'KeyA') { e.preventDefault(); this.turn(-1); }
    else if (e.code === 'Home') { this.spread = 0; this.render(); }
  }
}

void sparkle;
