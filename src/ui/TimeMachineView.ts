// Машина на времето (T): времева линия по дни, точки за случки, ленти за клоновете, записи, „сега“;
// избор на момент (клик/влачене) → случките около него; „Гледай“ ×1/×10/×100, „Зареди оттук“ (нов клон), „Запази сега“, смяна на клон.
import type { Branch, ChronicleEntry, SnapshotMeta } from '../sim/types';
import { MINUTES_PER_DAY, dayOf } from '../core/time';
import { h, esc, setText } from './dom';
import { typeIcon, TYPE_COLORS, sparkle } from './icons';
import { ModalView, cornersHtml } from './view';
import { branchLanes, entriesAround, entriesForBranch, entryAt, dayTimeLabel } from './logic';
import './css/timemachine.css';

export interface TimeMachineData {
  entries: ChronicleEntry[];      // всички клонове
  branches: Branch[];
  snapshots: SnapshotMeta[];
  currentBranch: string;
  now: number;                    // игрови минути (сегашният момент на текущия клон)
}

export type WatchSpeed = 1 | 10 | 100;

export class TimeMachineView extends ModalView {
  /** Пусни преиграване от time със скорост speed (на клона branchId). */
  onWatch: (time: number, speed: WatchSpeed, branchId: string) => void = () => {};
  onStopWatch: () => void = () => {};
  /** Зареди света от time на клона branchId → нов клон (потвърдено от играча). */
  onLoadFrom: (time: number, branchId: string) => void = () => {};
  onSaveNow: () => void = () => {};
  onSwitchBranch: (id: string) => void = () => {};

  private d: TimeMachineData = { entries: [], branches: [], snapshots: [], currentBranch: 'main', now: 0 };
  private sel = 0; private selBranch = 'main';
  private speed: WatchSpeed = 10;
  private v0 = 0; private v1 = MINUTES_PER_DAY; // видим интервал
  private lanes = new Map<string, number>();
  private playhead: number | null = null;

  private track: HTMLElement; private content: HTMLElement; private cursor: HTMLElement; private cursorLbl: HTMLElement; private playEl: HTMLElement;
  private laneLbls: HTMLElement; private side: HTMLElement; private selLbl: HTMLElement; private selBr: HTMLElement; private list: HTMLElement;
  private ticker: HTMLElement; private tickTxt: HTMLElement; private tickTime: HTMLElement; private branchesEl: HTMLElement; private confirmEl: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private watchBtn: HTMLButtonElement;
  private lastListKey = '';

  constructor(root: HTMLElement) {
    super(root, 'tm-back');
    this.closeKeys = ['KeyT'];
    this.content = h('div.tm-content');
    this.cursor = h('div.tm-cursor'); this.cursorLbl = h('div.tm-cursor-lbl'); this.cursor.append(this.cursorLbl);
    this.playEl = h('div.tm-play.hidden');
    this.track = h('div.tm-track', null, this.content, this.cursor, this.playEl);
    this.laneLbls = h('div.tm-lanelbls');
    this.selLbl = h('div.tm-sel-t'); this.selBr = h('div.tm-sel-b');
    this.list = h('div.tm-list.scroll');
    this.tickTime = h('span.tm-tick-time'); this.tickTxt = h('span.tm-tick-txt');
    const stop = h('button.btn.small', { text: '■ Спри' });
    stop.addEventListener('click', () => this.onStopWatch());
    this.ticker = h('div.tm-ticker.hidden', null, h('span.tm-live', { html: '▶ Гледаш' }), this.tickTime, this.tickTxt, stop);
    this.branchesEl = h('div.tm-branches');
    this.confirmEl = h('div.tm-confirm.hidden');

    this.watchBtn = h('button.btn.primary.tm-watch', { text: '▶ Гледай' }) as HTMLButtonElement;
    this.watchBtn.addEventListener('click', () => this.onWatch(this.sel, this.speed, this.selBranch));
    const speeds = h('div.tm-speeds');
    for (const s of [1, 10, 100] as WatchSpeed[]) {
      const b = h(`button.btn.small${s === this.speed ? '.on' : ''}`, { text: `×${s}` }) as HTMLButtonElement;
      b.addEventListener('click', () => { this.speed = s; this.speedBtns.forEach((x, i) => x.classList.toggle('on', [1, 10, 100][i] === s)); });
      this.speedBtns.push(b); speeds.append(b);
    }
    const load = h('button.btn.gold', { text: 'Зареди оттук' });
    load.addEventListener('click', () => this.askLoad());
    const save = h('button.btn', { text: 'Запази сега' });
    save.addEventListener('click', () => this.onSaveNow());
    const zoomAll = h('button.btn.small.ghost', { text: 'Всички дни' });
    zoomAll.addEventListener('click', () => { this.fit(); this.renderTrack(); });
    const zoomDay = h('button.btn.small.ghost', { text: 'Един ден' });
    zoomDay.addEventListener('click', () => { this.v0 = this.sel - MINUTES_PER_DAY / 2; this.v1 = this.sel + MINUTES_PER_DAY / 2; this.clampView(); this.renderTrack(); });

    this.side = h('div.tm-side', null,
      this.selLbl, this.selBr,
      h('div.tm-h', { text: 'Какво стана тогава' }), this.list,
      h('div.tm-actions', null, h('div.tm-row', null, this.watchBtn, speeds), h('div.tm-row', null, load, save)),
      this.confirmEl,
    );
    const close = h('button.icon-btn.close-x', { text: '×', title: 'Затвори (T / Esc)' });
    close.addEventListener('click', () => this.dismiss());
    this.el.append(h('div.modal.tm', { html: cornersHtml() },
      h('div.modal-head', null, h('div.modal-title', { text: 'Машина на времето' }), h('span.hint', { text: 'Кликни или влачи по линията, за да избереш момент · колелцето приближава' }), close),
      this.ticker,
      h('div.tm-body', null,
        h('div.tm-left', null,
          h('div.tm-timeline', null, this.laneLbls, this.track),
          h('div.tm-under', null, h('div.tm-legend', { html: LEGEND }), h('div.tm-zoom', null, zoomDay, zoomAll)),
          h('div.tm-h', { text: 'Клонове на историята' }), this.branchesEl),
        this.side),
    ));
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.dismiss(); });

    // избор с клик/влачене
    let dragging = false;
    const pick = (e: PointerEvent) => {
      const r = this.track.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      this.sel = Math.round(this.v0 + f * (this.v1 - this.v0));
      const cr = this.content.getBoundingClientRect();
      const laneH = cr.height / Math.max(1, this.lanes.size);
      const lane = Math.max(0, Math.min(this.lanes.size - 1, Math.floor((e.clientY - cr.top) / laneH)));
      for (const [id, l] of this.lanes) if (l === lane) this.selBranch = id;
      // не след края на клона
      this.sel = Math.min(this.sel, this.branchEnd(this.selBranch));
      this.sel = Math.max(this.sel, this.branchStart(this.selBranch));
      this.renderCursor(); this.renderSide();
    };
    this.track.addEventListener('pointerdown', (e) => { dragging = true; this.track.setPointerCapture(e.pointerId); pick(e); });
    this.track.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
    this.track.addEventListener('pointerup', () => { dragging = false; });
    this.track.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.track.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width, at = this.v0 + f * (this.v1 - this.v0);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const span = this.v1 - this.v0, dx = ((e.shiftKey ? e.deltaY : e.deltaX) / r.width) * span;
        this.v0 += dx; this.v1 += dx;
      } else {
        const k = e.deltaY > 0 ? 1.25 : 0.8;
        const span = Math.max(120, (this.v1 - this.v0) * k);
        this.v0 = at - f * span; this.v1 = this.v0 + span;
      }
      this.clampView(); this.renderTrack();
    }, { passive: false });
  }

  open(d: TimeMachineData): void {
    this.d = d;
    this.sel = d.now; this.selBranch = d.currentBranch;
    this.openBase();
    this.fit();
    this.update(d);
  }
  show(d: TimeMachineData): void { this.open(d); }

  update(d: TimeMachineData): void {
    this.d = d;
    this.lanes = branchLanes(d.branches.length ? d.branches : [{ id: d.currentBranch, parentId: null, forkTime: 0, forkEntryId: 0, createdAt: 0, label: 'Основна история' }]);
    if (!this.lanes.has(this.selBranch)) this.selBranch = d.currentBranch;
    this.renderTrack();
    this.renderSide();
    this.renderBranches();
  }

  /** Показва преиграването: линия на момента + лента с текущата случка. null = спряно. */
  setPlayhead(time: number | null): void {
    this.playhead = time;
    this.el.classList.toggle('watching', time !== null);
    if (time === null) { this.playEl.classList.add('hidden'); this.ticker.classList.add('hidden'); this.watchBtn.disabled = false; return; }
    this.watchBtn.disabled = true;
    this.playEl.classList.remove('hidden');
    this.ticker.classList.remove('hidden');
    if (time < this.v0 || time > this.v1) { const span = this.v1 - this.v0; this.v0 = time - span * 0.2; this.v1 = this.v0 + span; this.clampView(); this.renderTrack(); }
    this.playEl.style.left = `${this.pct(time)}%`;
    setText(this.tickTime, dayTimeLabel(time));
    const list = entriesForBranch(this.d.entries, this.d.branches, this.selBranch);
    const e = entryAt(list, time);
    setText(this.tickTxt, e ? e.text : '…');
    // подчертай текущата точка
    this.content.querySelectorAll('.tm-dot.cur').forEach((x) => x.classList.remove('cur'));
    if (e) this.content.querySelector(`.tm-dot[data-id="${e.id}"][data-b="${CSS.escape(e.branchId)}"]`)?.classList.add('cur');
    this.sel = time; this.renderCursor(); this.renderSide(e?.id);
  }

  hide(): void { super.hide(); this.confirmEl.classList.add('hidden'); }

  // ------------------------------------------------------------------------------------------
  private span(): [number, number] {
    let a = Infinity, b = -Infinity;
    for (const e of this.d.entries) { if (e.time < a) a = e.time; if (e.time > b) b = e.time; }
    for (const br of this.d.branches) if (br.parentId) { a = Math.min(a, br.forkTime); b = Math.max(b, br.forkTime); }
    b = Math.max(b, this.d.now);
    if (!isFinite(a)) a = this.d.now - MINUTES_PER_DAY;
    a = Math.floor(a / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    b = Math.max(a + MINUTES_PER_DAY, Math.ceil((b + 1) / MINUTES_PER_DAY) * MINUTES_PER_DAY);
    return [a, b];
  }
  private fit(): void { [this.v0, this.v1] = this.span(); }
  private clampView(): void {
    const [a, b] = this.span();
    const span = Math.min(b - a, this.v1 - this.v0);
    if (this.v0 < a) { this.v0 = a; this.v1 = a + span; }
    if (this.v1 > b) { this.v1 = b; this.v0 = b - span; }
  }
  private pct(t: number): number { return ((t - this.v0) / Math.max(1, this.v1 - this.v0)) * 100; }

  private branchById(id: string): Branch | undefined { return this.d.branches.find((b) => b.id === id); }
  private branchStart(id: string): number { const b = this.branchById(id); return b && b.parentId ? b.forkTime : this.span()[0]; }
  private branchEnd(id: string): number {
    if (id === this.d.currentBranch) return this.d.now;
    let end = this.branchStart(id);
    for (const e of this.d.entries) if (e.branchId === id && e.time > end) end = e.time;
    for (const s of this.d.snapshots) if (s.branchId === id && s.time > end) end = s.time;
    return end;
  }

  private renderTrack(): void {
    const n = Math.max(1, this.lanes.size);
    this.track.style.setProperty('--lanes', String(n));
    const laneTop = (l: number) => ((l + 0.5) / n) * 100;
    let html = '';
    // дни
    const d0 = dayOf(this.v0), d1 = dayOf(this.v1);
    const spanDays = (this.v1 - this.v0) / MINUTES_PER_DAY;
    for (let d = d0; d <= d1; d++) {
      const t = (d - 1) * MINUTES_PER_DAY;
      if (t >= this.v0 && t <= this.v1) html += `<div class="tm-day" style="left:${this.pct(t)}%"><span>Ден ${d}</span></div>`;
      if (spanDays <= 3) for (const hh of [6, 12, 18]) { const th = t + hh * 60; if (th > this.v0 && th < this.v1) html += `<div class="tm-hour" style="left:${this.pct(th)}%"><span>${String(hh).padStart(2, '0')}:00</span></div>`; }
    }
    // ленти + разклонения (SVG)
    let svg = `<svg class="tm-svg" viewBox="0 0 1000 ${n * 100}" preserveAspectRatio="none">`;
    for (const [id, l] of this.lanes) {
      const b = this.branchById(id);
      const x0 = Math.max(0, this.pct(this.branchStart(id)) * 10), x1 = Math.min(1000, this.pct(this.branchEnd(id)) * 10);
      const y = (l + 0.5) * 100, cur = id === this.d.currentBranch;
      if (x1 > 0 && x0 < 1000) svg += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="tm-lane${cur ? ' cur' : ''}" vector-effect="non-scaling-stroke"/>`;
      if (b?.parentId && this.lanes.has(b.parentId)) {
        const py = (this.lanes.get(b.parentId)! + 0.5) * 100, fx = this.pct(b.forkTime) * 10;
        svg += `<path d="M${fx} ${py} C${fx + 18} ${py}, ${fx} ${y}, ${fx + 22} ${y}" class="tm-fork${cur ? ' cur' : ''}" vector-effect="non-scaling-stroke"/>`;
      }
    }
    svg += '</svg>';
    html += svg;
    // записи на света
    for (const s of this.d.snapshots) {
      const l = this.lanes.get(s.branchId); if (l === undefined || s.time < this.v0 || s.time > this.v1) continue;
      html += `<i class="tm-snap k-${s.kind}" style="left:${this.pct(s.time)}%;top:calc(${laneTop(l)}% + 0.75em)" title="Запис: ${esc(s.label)}"></i>`;
    }
    // точки
    for (const e of this.d.entries) {
      const l = this.lanes.get(e.branchId); if (l === undefined || e.time < this.v0 || e.time > this.v1) continue;
      const sz = 0.35 + Math.max(1, Math.min(10, e.importance)) * 0.075;
      html += `<i class="tm-dot${e.ai ? ' ai' : ''}" data-id="${e.id}" data-b="${esc(e.branchId)}" style="left:${this.pct(e.time)}%;top:${laneTop(l)}%;--s:${sz.toFixed(2)}em;background:${TYPE_COLORS[e.type] ?? '#c9bfa8'}" title="${esc(dayTimeLabel(e.time))} — ${esc(e.text)}"></i>`;
    }
    // сега
    const cl = this.lanes.get(this.d.currentBranch) ?? 0;
    if (this.d.now >= this.v0 && this.d.now <= this.v1) html += `<div class="tm-now" style="left:${this.pct(this.d.now)}%;top:${laneTop(cl)}%"><span>Сега</span></div>`;
    this.content.innerHTML = html;
    // имена на клоновете
    this.laneLbls.style.setProperty('--lanes', String(n));
    this.laneLbls.innerHTML = [...this.lanes.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => {
      const b = this.branchById(id);
      return `<div class="tm-lanelbl${id === this.d.currentBranch ? ' cur' : ''}" title="${esc(b?.label ?? id)}">${esc(b?.label ?? id)}</div>`;
    }).join('');
    this.renderCursor();
    if (this.playhead !== null) this.playEl.style.left = `${this.pct(this.playhead)}%`;
  }

  private renderCursor(): void {
    const p = this.pct(this.sel);
    this.cursor.style.left = `${p}%`;
    this.cursor.classList.toggle('hidden', p < 0 || p > 100);
    setText(this.cursorLbl, dayTimeLabel(this.sel));
    this.cursorLbl.classList.toggle('flip', p > 82);
  }

  private renderSide(hl?: number): void {
    setText(this.selLbl, dayTimeLabel(this.sel));
    const b = this.branchById(this.selBranch);
    this.selBr.innerHTML = `клон: <b>${esc(b?.label ?? 'Основна история')}</b>${this.selBranch === this.d.currentBranch ? ' <span class="badge ai">текущ</span>' : ''}`;
    const list = entriesAround(entriesForBranch(this.d.entries, this.d.branches, this.selBranch), this.sel, 240, 10);
    const key = `${this.selBranch}|${list.map((e) => e.id).join(',')}|${hl ?? ''}`;
    if (key === this.lastListKey) return;
    this.lastListKey = key;
    this.list.innerHTML = list.length ? list.map((e) =>
      `<div class="tm-e${e.id === hl ? ' hl' : ''}${e.time > this.sel ? ' after' : ''}">${typeIcon(e.type, '1.1em')}<div><div class="tm-e-t">${dayTimeLabel(e.time)}${e.ai ? ` ${sparkle('0.8em')}` : ''}</div><div class="tm-e-x">${esc(e.text)}</div></div></div>`).join('')
      : '<div class="tm-none">Тихо беше — нищо не е записано около този момент.</div>';
    this.list.querySelector('.hl')?.scrollIntoView({ block: 'nearest' });
  }

  private renderBranches(): void {
    const sorted = [...this.lanes.entries()].sort((a, b) => a[1] - b[1]);
    this.branchesEl.innerHTML = '';
    for (const [id] of sorted) {
      const b = this.branchById(id); const cur = id === this.d.currentBranch;
      const row = h(`div.tm-br${cur ? '.cur' : ''}`, null,
        h('span.tm-br-n', { text: b?.label ?? id }),
        h('span.hint', { text: b?.parentId ? `от ${dayTimeLabel(b.forkTime)}` : 'от началото' }));
      if (cur) row.append(h('span.badge.ai', { text: 'тук си' }));
      else { const sw = h('button.btn.small', { text: 'Превключи' }); sw.addEventListener('click', () => this.onSwitchBranch(id)); row.append(sw); }
      this.branchesEl.append(row);
    }
  }

  private askLoad(): void {
    const t = this.sel, br = this.selBranch;
    this.confirmEl.innerHTML = '';
    const yes = h('button.btn.gold', { text: 'Да, зареди' }), no = h('button.btn', { text: 'Откажи' });
    yes.addEventListener('click', () => { this.confirmEl.classList.add('hidden'); this.onLoadFrom(t, br); });
    no.addEventListener('click', () => this.confirmEl.classList.add('hidden'));
    // светът се зарежда от най-близкия запис преди избрания момент (както в Timeline.nearestSnapshot) — кажи от кога
    let snap = -1;
    for (let id: string | null = br, until = Infinity; id;) {
      const b = this.branchById(id);
      for (const s of this.d.snapshots) if (s.branchId === id && s.time <= until && s.time <= t && s.time > snap) snap = s.time;
      if (!b || !b.parentId) break;
      until = b.forkTime; id = b.parentId;
    }
    const from = snap >= 0 && t - snap > 30 ? ` Светът тръгва от записа в ${dayTimeLabel(snap)} и селото доживява до избрания момент (героят е както беше тогава).` : '';
    this.confirmEl.append(
      h('div.tm-confirm-t', { text: `Да се върнем ли към ${dayTimeLabel(t)}?` }),
      ...(from ? [h('p', { text: from.trim() })] : []),
      h('p', { text: 'Светът ще продължи оттам по нов път — ще се създаде нов клон на историята. Сегашната история не се трие: остава запазена и можеш да се върнеш към нея по всяко време.' }),
      h('div.tm-row', null, yes, no));
    this.confirmEl.classList.remove('hidden');
  }

  protected onKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 600 : 60;
    if (e.code === 'ArrowRight') { e.preventDefault(); this.sel = Math.min(this.branchEnd(this.selBranch), this.sel + step); this.renderCursor(); this.renderSide(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); this.sel = Math.max(this.branchStart(this.selBranch), this.sel - step); this.renderCursor(); this.renderSide(); }
    else if (e.code === 'Space') { e.preventDefault(); if (this.playhead === null) this.onWatch(this.sel, this.speed, this.selBranch); else this.onStopWatch(); }
  }
}

const LEGEND = ['quarrel', 'love', 'theft', 'rumor', 'festival', 'monster', 'player', 'quest'].map((t) =>
  `<span><i style="background:${TYPE_COLORS[t as keyof typeof TYPE_COLORS]}"></i>${({ quarrel: 'кавга', love: 'любов', theft: 'кражба', rumor: 'слух', festival: 'празник', monster: 'чудовище', player: 'ти', quest: 'задача' } as Record<string, string>)[t]}</span>`).join('') +
  '<span><b class="snap"></b>запис</span>';
