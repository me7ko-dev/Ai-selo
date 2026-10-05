// Меню / настройки (Esc): Игра, ИИ, Графика, Звук, Управление, Лайв.
import { MODEL_CHOICES, DEFAULT_AI, type AiSettings } from '../sim/brain/Brain';
import { h, esc, isolateInput } from './dom';
import { ModalView, cornersHtml } from './view';
import './css/settings.css';

export interface UiSettings {
  ai: AiSettings;
  graphics: { quality: 'low' | 'medium' | 'high'; shadows: boolean; pixelRatioCap: number };
  audio: { master: number; music: number; sfx: number };      // 0..1
  controls: { sensitivity: number; invertY: boolean };         // sensitivity 0.2..3
  live: { channel: string; voteSeconds: number };
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  ai: { ...DEFAULT_AI },
  graphics: { quality: 'high', shadows: true, pixelRatioCap: 1.5 },
  audio: { master: 0.8, music: 0.6, sfx: 0.8 },
  controls: { sensitivity: 1, invertY: false },
  live: { channel: '', voteSeconds: 30 },
};

export interface SettingsStatus {
  ai?: { connected: boolean; label: string; reason?: string; testing?: boolean };
  /** true = версията в браузъра (GitHub Pages) — показва обяснението защо няма ИИ. */
  browser?: boolean;
  /** true = отворено по време на игра (има „Продължи“, „Запази“, „Към началото“). */
  inGame?: boolean;
  live?: { running: boolean; label?: string };
  /** „Записано: Ден 4 · 18:20“ */
  saveLabel?: string;
  /** Подсказките за начинаещи са включени (по подразбиране — да). */
  hints?: boolean;
  /** Видеокартата и препоръчаното качество за нея. */
  gpu?: { name: string; recommended: 'low' | 'medium' | 'high' };
}

export type SettingsTab = 'game' | 'ai' | 'graphics' | 'audio' | 'controls' | 'live';
const TABS: [SettingsTab, string][] = [['game', 'Игра'], ['ai', 'ИИ'], ['graphics', 'Графика'], ['audio', 'Звук'], ['controls', 'Управление'], ['live', 'Лайв']];

export const CONTROLS_LIST: [string[], string][] = [
  [['W', 'A', 'S', 'D'], 'ходене'], [['Мишка'], 'камера'], [['Shift'], 'бягане'], [['Space'], 'скок'], [['Ляв бутон'], 'удар'], [['Десен бутон'], 'блок'], [['E'], 'говори / вземи'],
  [['Tab'], 'герой и раница'], [['M'], 'карта'], [['J'], 'летопис'], [['T'], 'машина на времето'], [['1', '–', '6'], 'бърза лента'], [['Esc'], 'меню / настройки'],
];

export class SettingsView extends ModalView {
  onChange: (s: UiSettings) => void = () => {};
  onSave: () => void = () => {};
  onExport: () => void = () => {};
  onImport: (file: File) => void = () => {};
  onMainMenu: () => void = () => {};
  onTestAi: () => void = () => {};
  onLiveStart: () => void = () => {};
  onLiveStop: () => void = () => {};
  onLiveDemo: () => void = () => {};
  /** Подсказки за начинаещи — вкл./изкл. */
  onHints: (on: boolean) => void = () => {};
  /** „Покажи съветите отначало“. */
  onHintsReset: () => void = () => {};

  private s: UiSettings = structuredClone(DEFAULT_UI_SETTINGS);
  private st: SettingsStatus = {};
  private tab: SettingsTab = 'game';
  private tabsEl: HTMLElement; private body: HTMLElement; private file: HTMLInputElement;

  constructor(root: HTMLElement) {
    super(root, 'set-back');
    this.tabsEl = h('div.set-tabs');
    this.body = h('div.set-body.scroll');
    this.file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' }) as HTMLInputElement;
    this.file.addEventListener('change', () => { const f = this.file.files?.[0]; if (f) this.onImport(f); this.file.value = ''; });
    const close = h('button.icon-btn.close-x', { text: '×', title: 'Затвори (Esc)' });
    close.addEventListener('click', () => this.dismiss());
    this.el.append(h('div.modal.set', { html: cornersHtml() },
      h('div.modal-head', null, h('div.modal-title', { text: 'Меню' }), close),
      h('div.set-main', null, this.tabsEl, this.body), this.file));
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.dismiss(); });
  }

  open(settings: UiSettings, status: SettingsStatus = {}, tab?: SettingsTab): void {
    this.s = structuredClone(settings);
    this.st = status;
    if (tab) this.tab = tab; else if (!status.inGame && this.tab === 'game') this.tab = 'game';
    this.render();
    this.openBase();
  }
  show(settings: UiSettings, status: SettingsStatus = {}, tab?: SettingsTab): void { this.open(settings, status, tab); }

  /** Обновява състоянието (напр. след „Провери връзката“) без да губи въведеното. */
  setStatus(status: SettingsStatus): void { this.st = { ...this.st, ...status }; if (this.isOpen) this.render(); }
  setTab(tab: SettingsTab): void { this.tab = tab; this.render(); }
  get settings(): UiSettings { return structuredClone(this.s); }

  private changed(): void { this.onChange(structuredClone(this.s)); }

  private render(): void {
    this.tabsEl.innerHTML = '';
    for (const [k, label] of TABS) {
      const b = h(`button.set-tab${k === this.tab ? '.on' : ''}`, { text: label });
      b.addEventListener('click', () => { this.tab = k; this.render(); });
      this.tabsEl.append(b);
    }
    this.body.innerHTML = '';
    const B = this.body;
    const sec = (title: string) => B.append(h('div.set-sec', { text: title }));
    const row = (label: string, ctl: HTMLElement, hint?: string) => B.append(h('label.set-row', null, h('span.set-lbl', null, label, hint ? h('span.set-hint', { text: hint }) : null), ctl));
    const btn = (text: string, cls: string, fn: () => void) => { const b = h(`button.btn.${cls}`, { text }); b.addEventListener('click', fn); return b; };
    const toggle = (v: boolean, fn: (v: boolean) => void) => {
      const b = h(`button.set-toggle${v ? '.on' : ''}`, { html: `<i></i><span>${v ? 'Да' : 'Не'}</span>` });
      b.addEventListener('click', (e) => { e.preventDefault(); v = !v; b.classList.toggle('on', v); b.querySelector('span')!.textContent = v ? 'Да' : 'Не'; fn(v); });
      return b;
    };
    const slider = (v: number, min: number, max: number, step: number, fmt: (v: number) => string, fn: (v: number) => void) => {
      const out = h('span.set-val', { text: fmt(v) });
      const r = h('input', { type: 'range', min, max, step, value: v }) as HTMLInputElement;
      r.addEventListener('input', () => { const x = Number(r.value); out.textContent = fmt(x); fn(x); });
      return h('div.set-slider', null, r, out);
    };
    const text = (v: string, ph: string, fn: (v: string) => void) => {
      const i = h('input', { type: 'text', value: v, placeholder: ph, spellcheck: 'false' }) as HTMLInputElement;
      isolateInput(i);
      i.addEventListener('change', () => fn(i.value.trim()));
      return i;
    };
    const seg = <T extends string | number>(v: T, opts: [T, string][], fn: (v: T) => void) => {
      const w = h('div.set-seg');
      for (const [k, l] of opts) {
        const b = h(`button.btn.small${k === v ? '.on' : ''}`, { text: l });
        b.addEventListener('click', (e) => { e.preventDefault(); w.querySelectorAll('.btn').forEach((x) => x.classList.remove('on')); b.classList.add('on'); fn(k); });
        w.append(b);
      }
      return w;
    };
    const pct = (v: number) => `${Math.round(v * 100)}%`;

    switch (this.tab) {
      case 'game': {
        const g = h('div.set-game');
        if (this.st.inGame) {
          g.append(btn('Продължи', 'primary', () => this.dismiss()), btn('Запази', '', () => this.onSave()));
        }
        g.append(btn('Свали записа', '', () => this.onExport()), btn('Зареди от файл', '', () => this.file.click()));
        if (this.st.inGame) g.append(btn('Към началото', 'ghost', () => this.onMainMenu()));
        B.append(g);
        if (this.st.saveLabel) B.append(h('div.set-hint.c', { text: this.st.saveLabel }));
        B.append(h('p.set-p', { text: '„Свали записа“ запазва целия свят (с летописа и клоновете на историята) във файл на компютъра ти. С „Зареди от файл“ го връщаш обратно — и на друг компютър.' }));
        break;
      }
      case 'ai': {
        const a = this.st.ai;
        B.append(h(`div.set-status${a?.connected ? '.ok' : ''}`, null, h(`span.dot${a?.connected ? '.on' : a?.testing ? '.busy' : ''}`), h('span', { text: a?.testing ? 'Проверявам връзката…' : (a?.label ?? 'ИИ: няма връзка — жителите говорят по сценарий') })));
        if (a?.reason) B.append(h('p.set-p.warn', { text: a.reason }));
        row('Жители с ИИ', toggle(this.s.ai.enabled, (v) => { this.s.ai.enabled = v; this.changed(); }), 'изключено = винаги по сценарий');
        row('Адрес на Ollama', text(this.s.ai.url, DEFAULT_AI.url, (v) => { this.s.ai.url = v || DEFAULT_AI.url; this.changed(); }));
        const custom = !MODEL_CHOICES.includes(this.s.ai.model);
        const sel = h('select', null, ...MODEL_CHOICES.map((m) => h('option', { value: m, text: m, selected: m === this.s.ai.model })), h('option', { value: '__custom', text: 'Друг модел…', selected: custom })) as HTMLSelectElement;
        const cust = text(custom ? this.s.ai.model : '', 'напр. qwen3:1.7b', (v) => { if (v) { this.s.ai.model = v; this.changed(); } });
        cust.classList.toggle('hidden', !custom);
        sel.addEventListener('change', () => { if (sel.value === '__custom') { cust.classList.remove('hidden'); cust.focus(); } else { cust.classList.add('hidden'); this.s.ai.model = sel.value; this.changed(); } });
        row('Модел', h('div.set-model', null, sel, cust), 'малък модел за видеокарта 4 GB');
        row('Изчакване', slider(this.s.ai.timeoutMs / 1000, 5, 60, 1, (v) => `${v} с`, (v) => { this.s.ai.timeoutMs = v * 1000; this.changed(); }), 'после — по сценарий');
        B.append(h('div.set-game', null, btn('Провери връзката', 'gold', () => this.onTestAi())));
        sec('Как работи');
        B.append(h('div.set-p', { html: `
          <p>Жителите могат да мислят с <b>локален ИИ</b> — програмата <b>Ollama</b> на твоя компютър. Нищо не се праща в интернет. Без ИИ играта работи напълно: жителите говорят по сценарий.</p>
          ${this.st.browser !== false ? '<p class="warn">Версията в браузъра (от сайта на играта) <b>не може</b> да се свърже с Ollama — браузърът не позволява на сайт от интернет да говори с програма на компютъра ти. За жители с ИИ свали <b>версията за Windows</b>.</p>' : ''}
          <p>Как да сложиш модел:</p>
          <ol><li>Инсталирай Ollama (ollama.com).</li><li>Отвори „Команден ред“ и напиши:<br><code>ollama pull ${esc(MODEL_CHOICES[0])}</code></li><li>Пусни играта за Windows и натисни „Провери връзката“.</li></ol>` }));
        break;
      }
      case 'graphics': {
        const QDESC: Record<string, string> = {
          high: 'Пълен вид: меки сенки близо и далеч, засенчване в ъглите, блясък, отражения. За отделна видеокарта (напр. GTX 1650).',
          medium: 'Сенки около героя, блясък, по-леки отражения — около два пъти по-бързо.',
          low: 'Без сенки и ефекти, по-малка резолюция — за слаби лаптопи и телефони.',
        };
        const desc = h('p.set-p.set-hint', { text: QDESC[this.s.graphics.quality] });
        row('Качество', seg(this.s.graphics.quality, [['low', 'Ниско'], ['medium', 'Средно'], ['high', 'Високо']], (v) => { this.s.graphics.quality = v; desc.textContent = QDESC[v]; this.changed(); }));
        B.append(desc);
        row('Сенки', toggle(this.s.graphics.shadows, (v) => { this.s.graphics.shadows = v; this.changed(); }));
        row('Резолюция (таван)', slider(this.s.graphics.pixelRatioCap, 0.5, 2, 0.25, (v) => `×${v.toFixed(2)}`, (v) => { this.s.graphics.pixelRatioCap = v; this.changed(); }), 'по-ниско = повече кадри');
        const g = this.st.gpu;
        if (g?.name) {
          const QN: Record<string, string> = { low: 'Ниско', medium: 'Средно', high: 'Високо' };
          // името на картата без „ANGLE (…, … Direct3D11 …)“
          const short = g.name.replace(/^ANGLE \(([^,]*),\s*/, '').replace(/\s*(\(0x[0-9a-f]+\))?\s*Direct3D.*$/i, '').replace(/\)$/, '');
          B.append(h('p.set-p.set-hint', { text: `Видеокарта: ${short} — препоръчано: ${QN[g.recommended]}.` }));
        }
        B.append(h('p.set-p', { text: 'Ако играта насича, сложи „Средно“ или „Ниско“ (играта и сама сваля качеството, ако кадрите паднат много).' }));
        break;
      }
      case 'audio':
        row('Общо', slider(this.s.audio.master, 0, 1, 0.05, pct, (v) => { this.s.audio.master = v; this.changed(); }));
        row('Музика', slider(this.s.audio.music, 0, 1, 0.05, pct, (v) => { this.s.audio.music = v; this.changed(); }));
        row('Ефекти', slider(this.s.audio.sfx, 0, 1, 0.05, pct, (v) => { this.s.audio.sfx = v; this.changed(); }));
        break;
      case 'controls':
        row('Чувствителност на мишката', slider(this.s.controls.sensitivity, 0.2, 3, 0.1, (v) => `×${v.toFixed(1)}`, (v) => { this.s.controls.sensitivity = v; this.changed(); }));
        row('Обърната мишка (горе/долу)', toggle(this.s.controls.invertY, (v) => { this.s.controls.invertY = v; this.changed(); }));
        row('Подсказки', toggle(this.st.hints !== false, (v) => this.onHints(v)), 'малки съвети над бързата лента — за първите стъпки');
        B.append(h('div.set-game', null, btn('Покажи съветите отначало', 'small', () => this.onHintsReset())));
        sec('Клавиши');
        B.append(h('div.set-keys', { html: CONTROLS_LIST.map(([k, v]) => `<div><span>${k.map((x) => x === '–' ? '–' : `<kbd>${esc(x)}</kbd>`).join(' ')}</span><em>${esc(v)}</em></div>`).join('') }));
        break;
      case 'live': {
        const lv = this.st.live;
        B.append(h('p.set-p', { text: 'В лайв режим зрителите в чата на твоя канал гласуват какво да се случи в селото — с команди като !буря, !сбор, !караконджул, !самодиви, !кражба. Не трябват ключове или пароли: играта само чете чата.' }));
        row('Канал', text(this.s.live.channel, 'името на канала', (v) => { this.s.live.channel = v.replace(/^#/, '').toLowerCase(); this.changed(); }));
        row('Време за гласуване', slider(this.s.live.voteSeconds, 10, 120, 5, (v) => `${v} с`, (v) => { this.s.live.voteSeconds = v; this.changed(); }));
        B.append(h(`div.set-status${lv?.running ? '.ok' : ''}`, null, h(`span.dot${lv?.running ? '.on' : ''}`), h('span', { text: lv?.label ?? (lv?.running ? 'На живо' : 'Лайв режимът е спрян') })));
        B.append(h('div.set-game', null,
          lv?.running ? btn('Спри лайв', 'primary', () => this.onLiveStop()) : btn('Започни лайв', 'gold', () => this.onLiveStart()),
          btn('Пробен чат', '', () => this.onLiveDemo())));
        B.append(h('p.set-p.set-hint', { text: '„Пробен чат“ пуска измислени зрители, за да видиш как изглежда гласуването.' }));
        break;
      }
    }
  }

}
