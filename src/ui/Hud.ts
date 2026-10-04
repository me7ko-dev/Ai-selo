// HUD: портрет и ленти (горе вляво), кръгла мини-карта и задачи (горе вдясно), бърза лента (долу в средата),
// часовник и ИИ (долу вляво), подкана, известия, лента на боса, червено при удар, „Кликни, за да играеш“.
import type { IconKey } from '../data/icons';
import { dayPhase, formatDayClock, type DayPhase } from '../core/time';
import { h, setText, setStyle, clamp01, esc } from './dom';
import { icon, portrait } from './icons';
import { worldToMap, yawToScreenAngle } from './logic';
import { rosetteHtml } from './ornament';
import './css/hud.css';

export interface HudQuest { id: string; title: string; step: string; main?: boolean; done?: boolean }
export interface HotbarItem { icon: IconKey; count?: number; name?: string }

export interface HudData {
  name?: string;              // „Стоян“
  level: number;
  title?: string;             // „Странник“
  hp: number; hpMax: number;
  stamina: number; staminaMax: number;
  xp: number; xpMax: number;
  time: number;               // общо игрови минути
  phase?: DayPhase;           // ако липсва — смята се от time
  ai: { connected: boolean; label: string; busy?: boolean };
  quests: HudQuest[];
  hotbar: (HotbarItem | null)[]; // 6
  selected: number;           // 0..5
}

export type ToastKind = 'quest' | 'item' | 'info' | 'warn' | 'level';

export interface MapMarker { x: number; z: number; kind: 'quest' | 'boss' | 'place' }
export interface MapDot { x: number; z: number; color?: string }

export interface BossData {
  name: string;               // „Ламята“
  heads: { hp: number; max: number; name?: string }[]; // 3 глави
  phase: string;              // „Фаза 2 — Огнен дъх“
}

const TOAST_ICON: Record<ToastKind, IconKey> = { quest: 'quest', item: 'coin', info: 'letter', warn: 'claw', level: 'star' };

export class Hud {
  readonly el: HTMLElement;
  isOpen = true;
  private hpBar: HTMLElement; private hpLag: HTMLElement; private hpTxt: HTMLElement;
  private stBar: HTMLElement; private stTxt: HTMLElement;
  private xpBar: HTMLElement;
  private nameEl: HTMLElement; private lvlEl: HTMLElement;
  private clockEl: HTMLElement; private clockIcon: HTMLElement; private aiEl: HTMLElement; private aiDot: HTMLElement; private aiTxt: HTMLElement;
  private questsEl: HTMLElement; private questKey = '';
  private hotCells: { el: HTMLElement; ic: HTMLElement; cnt: HTMLElement; key: string }[] = [];
  private promptEl: HTMLElement; private promptTxt = '';
  private toasts: HTMLElement;
  private bossEl: HTMLElement; private bossName: HTMLElement; private bossPhase: HTMLElement; private bossHeads: HTMLElement; private bossKey = '';
  private vignette: HTMLElement; private hitEl: HTMLElement; private pausedEl: HTMLElement;
  private mm: HTMLCanvasElement; private mmCtx: CanvasRenderingContext2D; private mmBase: HTMLCanvasElement | HTMLImageElement | null = null;
  private mmSize = 0; private lastPhase: string = '';
  /** Радиус на мини-картата в метри. */
  minimapRadius = 60;

  constructor(root: HTMLElement) {
    this.el = h('div.hud');
    // --- горе вляво ---
    const hero = h('div.hud-hero', null,
      h('div.hud-portrait', { html: portrait('hero', '100%') }),
      h('div.hud-hero-info', null,
        (this.nameEl = h('div.hud-name', { text: 'Стоян' })),
        (this.lvlEl = h('div.hud-lvl', { text: 'Ниво 1 · Странник' })),
        h('div.hud-barrow', null, h('div.bar.hp', null, (this.hpLag = h('b')), (this.hpBar = h('i')), (this.hpTxt = h('span.bar-txt'))) ),
        h('div.hud-barrow', null, h('div.bar.st', null, (this.stBar = h('i')), (this.stTxt = h('span.bar-txt')))),
        h('div.bar.xp', null, (this.xpBar = h('i'))),
      ),
    );
    // --- горе вдясно ---
    this.mm = h('canvas.hud-mm-canvas') as HTMLCanvasElement;
    this.mmCtx = this.mm.getContext('2d')!;
    const mmWrap = h('div.hud-mm', null, this.mm, h('div.hud-mm-ring'), h('div.hud-mm-n', { text: 'С' }));
    this.questsEl = h('div.hud-quests');
    const right = h('div.hud-right', null, mmWrap, this.questsEl);
    // --- долу в средата ---
    const hot = h('div.hud-hotbar');
    for (let i = 0; i < 6; i++) {
      const ic = h('div.hot-ic'), cnt = h('div.hot-cnt');
      const el = h('div.hot-cell', null, h('div.hot-key', { text: String(i + 1) }), ic, cnt);
      hot.append(el);
      this.hotCells.push({ el, ic, cnt, key: '' });
    }
    this.promptEl = h('div.hud-prompt.hidden');
    // --- долу вляво ---
    this.clockIcon = h('div.hud-clock-ic');
    this.clockEl = h('div.hud-clock-txt');
    this.aiDot = h('span.dot'); this.aiTxt = h('span');
    this.aiEl = h('div.hud-ai', null, this.aiDot, this.aiTxt);
    const clock = h('div.hud-clock', null, h('div.hud-clock-row', null, this.clockIcon, this.clockEl), this.aiEl);
    // --- останалото ---
    this.toasts = h('div.hud-toasts');
    this.bossName = h('div.boss-name'); this.bossPhase = h('div.boss-phase'); this.bossHeads = h('div.boss-heads');
    this.bossEl = h('div.hud-boss.hidden', null, h('div.boss-title', { html: `${rosetteHtml('0.8em')}` }, this.bossName, h('span', { html: rosetteHtml('0.8em') })), this.bossHeads, this.bossPhase);
    this.vignette = h('div.hud-vignette');
    this.hitEl = h('div.hud-hit', { html: '<i></i><i></i><i></i><i></i>' });
    this.pausedEl = h('div.hud-paused.hidden', null, h('div.hud-paused-box', null,
      h('div.hud-paused-t', { text: 'Кликни, за да играеш' }),
      h('div.hint', { html: '<kbd>Esc</kbd> меню · <kbd>Tab</kbd> раница · <kbd>M</kbd> карта · <kbd>J</kbd> летопис · <kbd>T</kbd> машина на времето' })));

    this.el.append(this.vignette, hero, right, this.bossEl, h('div.hud-bottom', null, this.promptEl, hot), clock, this.toasts, this.hitEl, this.pausedEl);
    root.append(this.el);
  }

  show(): void { this.el.classList.remove('hidden'); this.isOpen = true; }
  hide(): void { this.el.classList.add('hidden'); this.isOpen = false; }

  /** ~10×/с. Пипа DOM само при промяна. */
  update(d: HudData): void {
    setText(this.nameEl, d.name ?? 'Стоян');
    setText(this.lvlEl, `Ниво ${d.level} · ${d.title ?? 'Странник'}`);
    const hp = clamp01(d.hp / Math.max(1, d.hpMax));
    setStyle(this.hpBar, 'width', `${(hp * 100).toFixed(1)}%`);
    setStyle(this.hpLag, 'width', `${(hp * 100).toFixed(1)}%`);
    setText(this.hpTxt, `${Math.ceil(d.hp)} / ${d.hpMax}`);
    this.el.classList.toggle('low-hp', hp < 0.25);
    const st = clamp01(d.stamina / Math.max(1, d.staminaMax));
    setStyle(this.stBar, 'width', `${(st * 100).toFixed(1)}%`);
    setText(this.stTxt, `${Math.floor(d.stamina)} / ${d.staminaMax}`);
    setStyle(this.xpBar, 'width', `${(clamp01(d.xp / Math.max(1, d.xpMax)) * 100).toFixed(1)}%`);

    setText(this.clockEl, formatDayClock(d.time));
    const ph = d.phase ?? dayPhase(d.time);
    if (ph !== this.lastPhase) {
      this.lastPhase = ph;
      this.clockIcon.innerHTML = icon(ph === 'night' || ph === 'dusk' ? 'moon' : 'sun', '1.6em');
      this.clockIcon.className = `hud-clock-ic ph-${ph}`;
    }
    setText(this.aiTxt, d.ai.label);
    this.aiDot.className = `dot${d.ai.connected ? (d.ai.busy ? ' busy' : ' on') : ''}`;
    this.aiEl.classList.toggle('off', !d.ai.connected);

    const qk = JSON.stringify(d.quests);
    if (qk !== this.questKey) {
      this.questKey = qk;
      const list = [...d.quests].sort((a, b) => Number(!!b.main) - Number(!!a.main));
      this.questsEl.innerHTML = list.length
        ? `<div class="hq-title">${rosetteHtml('0.75em')}<span>Задачи</span></div>` + list.map((q) =>
          `<div class="hq${q.main ? ' main' : ''}${q.done ? ' done' : ''}"><div class="hq-name">${q.main ? icon('quest', '0.95em') : '<span class="hq-bullet">◆</span>'}${esc(q.title)}</div><div class="hq-step">${esc(q.step)}</div></div>`).join('')
        : '';
      this.questsEl.classList.toggle('hidden', !list.length);
    }

    for (let i = 0; i < 6; i++) {
      const c = this.hotCells[i], it = d.hotbar[i] ?? null;
      const key = it ? `${it.icon}|${it.count ?? ''}` : '';
      if (key !== c.key) {
        c.key = key;
        c.ic.innerHTML = it ? icon(it.icon, '100%') : '';
        c.cnt.textContent = it && it.count !== undefined && it.count > 1 ? String(it.count) : '';
        c.el.title = it?.name ?? '';
        c.el.classList.toggle('empty', !it);
      }
      c.el.classList.toggle('sel', i === d.selected);
    }
  }

  // ------------------------------------------------------------------ мини-карта
  /** Основна карта (1024² px за света 600×600 м). */
  setMinimap(base: HTMLCanvasElement | HTMLImageElement | null): void { this.mmBase = base; }

  /** Всеки кадър. yaw = rotation.y на героя (0 = гледа към +z/юг). */
  minimap(px: number, pz: number, yaw: number, markers: MapMarker[] = [], dots: MapDot[] = []): void {
    const cssSize = this.mm.clientWidth;
    if (!cssSize) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(cssSize * dpr);
    if (size !== this.mmSize) { this.mm.width = this.mm.height = size; this.mmSize = size; }
    const ctx = this.mmCtx, R = size / 2, r = this.minimapRadius, k = R / r; // пиксела на метър
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#3f5a33'; ctx.fillRect(0, 0, size, size);
    const base = this.mmBase;
    if (base) {
      const bw = (base as HTMLCanvasElement).width || 1024;
      const c = worldToMap(px, pz, bw), sr = (r / 600) * bw;
      ctx.drawImage(base, c.px - sr, c.py - sr, sr * 2, sr * 2, 0, 0, size, size);
    }
    // лека сянка към ръба
    const g = ctx.createRadialGradient(R, R, R * 0.6, R, R, R);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    // жители
    const dotR = Math.max(2, size * 0.022);
    for (const d of dots) {
      const sx = R + (d.x - px) * k, sy = R + (d.z - pz) * k;
      if ((sx - R) ** 2 + (sy - R) ** 2 > (R - dotR) ** 2) continue;
      ctx.beginPath(); ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = d.color ?? '#f3ead7'; ctx.fill();
      ctx.lineWidth = dpr; ctx.strokeStyle = 'rgba(20,16,12,0.85)'; ctx.stroke();
    }
    // знаци (задачи/бос) — извън обхвата се лепят по ръба
    const mk = size * 0.045;
    for (const m of markers) {
      let dx = (m.x - px) * k, dy = (m.z - pz) * k;
      const L = Math.hypot(dx, dy), lim = R - mk * 1.3;
      const edge = L > lim;
      if (edge) { dx = (dx / L) * lim; dy = (dy / L) * lim; }
      const sx = R + dx, sy = R + dy;
      ctx.save(); ctx.translate(sx, sy);
      if (m.kind === 'boss') {
        ctx.beginPath(); ctx.arc(0, 0, mk * 0.9, 0, Math.PI * 2); ctx.fillStyle = '#c8423a'; ctx.fill();
        ctx.lineWidth = dpr * 1.5; ctx.strokeStyle = '#1a0c08'; ctx.stroke();
        ctx.fillStyle = '#1a0c08'; ctx.beginPath(); ctx.arc(-mk * 0.3, -mk * 0.1, mk * 0.18, 0, 7); ctx.arc(mk * 0.3, -mk * 0.1, mk * 0.18, 0, 7); ctx.fill();
      } else {
        const s = m.kind === 'place' ? mk * 0.7 : mk;
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.75, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.75, 0); ctx.closePath();
        ctx.fillStyle = m.kind === 'place' ? '#c9bfa8' : '#e8c27a'; ctx.fill();
        ctx.lineWidth = dpr * 1.4; ctx.strokeStyle = '#2a1a0e'; ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
    // играчът
    ctx.save(); ctx.translate(R, R); ctx.rotate(yawToScreenAngle(yaw));
    const a = size * 0.07;
    ctx.beginPath(); ctx.moveTo(0, -a); ctx.lineTo(a * 0.7, a * 0.75); ctx.lineTo(0, a * 0.35); ctx.lineTo(-a * 0.7, a * 0.75); ctx.closePath();
    ctx.fillStyle = '#fff4d6'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3 * dpr; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = dpr * 1.3; ctx.strokeStyle = '#b3262b'; ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ съобщения
  toast(text: string, kind: ToastKind = 'info', ms = 4200): void {
    const t = h(`div.toast.t-${kind}`, null, h('span.toast-ic', { html: icon(TOAST_ICON[kind], '1.5em') }), h('span.toast-txt', { text }));
    this.toasts.append(t);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, ms);
  }

  /** „[E] Говори с баба Гена“ — подава се текстът след клавиша; null скрива. key по подразбиране 'E'. */
  prompt(text: string | null, key = 'E'): void {
    const k = text ? `${key}|${text}` : '';
    if (k === this.promptTxt) return;
    this.promptTxt = k;
    if (!text) { this.promptEl.classList.add('hidden'); return; }
    this.promptEl.innerHTML = `<kbd>${esc(key)}</kbd><span>${esc(text)}</span>`;
    this.promptEl.classList.remove('hidden');
  }

  boss(d: BossData | null): void {
    if (!d) { this.bossEl.classList.add('hidden'); this.bossKey = ''; return; }
    this.bossEl.classList.remove('hidden');
    setText(this.bossName, d.name);
    setText(this.bossPhase, d.phase);
    if (this.bossHeads.children.length !== d.heads.length) {
      this.bossHeads.innerHTML = d.heads.map(() => `<div class="boss-head"><div class="bar hp boss-bar"><b></b><i></i></div><div class="boss-hname"></div></div>`).join('');
    }
    const key = JSON.stringify(d.heads);
    if (key === this.bossKey) return;
    this.bossKey = key;
    d.heads.forEach((hd, i) => {
      const el = this.bossHeads.children[i] as HTMLElement;
      const f = clamp01(hd.hp / Math.max(1, hd.max));
      (el.querySelector('i') as HTMLElement).style.width = `${f * 100}%`;
      (el.querySelector('b') as HTMLElement).style.width = `${f * 100}%`;
      el.classList.toggle('dead', hd.hp <= 0);
      setText(el.querySelector('.boss-hname') as HTMLElement, hd.hp <= 0 ? `${hd.name ?? `Глава ${i + 1}`} — отсечена` : (hd.name ?? `Глава ${i + 1}`));
    });
  }

  /** Червено по краищата при удар. strength 0..1. */
  flashDamage(strength = 1): void {
    const v = this.vignette;
    v.style.setProperty('--dmg', String(0.35 + 0.65 * clamp01(strength)));
    v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash');
  }

  /** Знак в центъра при попадение (crit = по-голям, златен). */
  hitMarker(crit = false): void {
    const e = this.hitEl;
    e.classList.toggle('crit', crit);
    e.classList.remove('go'); void e.offsetWidth; e.classList.add('go');
  }

  /** Показва „Кликни, за да играеш“ (когато мишката не е заключена). Не спира кликовете към играта. */
  setPaused(paused: boolean): void { this.pausedEl.classList.toggle('hidden', !paused); }
}
