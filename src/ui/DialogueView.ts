// Диалог с жител: портрет, име, работа, настроение, реплика с „пишеща машина“, „мисли…“, готови отговори (1–4),
// свободно поле, кратка история. Esc / × → onClose.
import type { DialogueOption } from '../sim/types';
import { h, esc, onKeys, isolateInput, setText } from './dom';
import { portrait, sparkle } from './icons';
import { cornersHtml } from './view';
import './css/dialogue.css';

export interface DialogueVillager { id: string; name: string; job: string; mood?: string }

export class DialogueView {
  readonly el: HTMLElement;
  isOpen = false;
  onOption: (id: string) => void = () => {};
  onFreeText: (text: string) => void = () => {};
  onClose: () => void = () => {};
  /** Знаци в секунда за „пишещата машина“. */
  cps = 55;

  private portraitEl: HTMLElement; private nameEl: HTMLElement; private jobEl: HTMLElement; private moodEl: HTMLElement;
  private lineEl: HTMLElement; private badgeEl: HTMLElement; private thinkEl: HTMLElement;
  private optsEl: HTMLElement; private input: HTMLInputElement; private sendBtn: HTMLButtonElement; private histEl: HTMLElement;
  private opts: DialogueOption[] = [];
  private full = ''; private shown = 0; private timer: number | null = null;
  private thinking = false; private who = '';
  private offKeys: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.portraitEl = h('div.dl-portrait');
    this.nameEl = h('div.dl-name'); this.jobEl = h('div.dl-job'); this.moodEl = h('div.dl-mood');
    this.lineEl = h('div.dl-line');
    this.badgeEl = h('span.badge');
    this.thinkEl = h('div.dl-think.hidden', { html: 'мисли<span class="dots"><i></i><i></i><i></i></span>' });
    this.optsEl = h('div.dl-opts');
    this.input = h('input.dl-input', { type: 'text', placeholder: 'Или му напиши каквото искаш…', maxlength: 240 }) as HTMLInputElement;
    this.sendBtn = h('button.btn.dl-send', { text: 'Кажи', title: 'Enter' }) as HTMLButtonElement;
    this.histEl = h('div.dl-hist.scroll');
    const close = h('button.icon-btn.dl-close', { text: '×', title: 'Затвори (Esc)' });
    close.addEventListener('click', () => this.dismiss());
    isolateInput(this.input);
    this.input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.send(); }
    });
    this.sendBtn.addEventListener('click', () => this.send());
    this.lineEl.addEventListener('click', () => this.skip());

    this.el = h('div.dialogue.hidden', null,
      h('div.dl-panel', { html: cornersHtml() },
        h('div.dl-left', null, this.portraitEl, this.nameEl, this.jobEl, this.moodEl),
        h('div.dl-main', null,
          this.histEl,
          h('div.dl-say', null, h('div.dl-meta', null, this.badgeEl), this.lineEl, this.thinkEl),
          this.optsEl,
          h('div.dl-free', null, this.input, this.sendBtn),
          h('div.dl-keys.hint', { html: '<kbd>1</kbd>–<kbd>4</kbd> отговор · <kbd>Space</kbd> прескочи · <kbd>Enter</kbd> пиши · <kbd>Esc</kbd> край' }),
        ),
        close,
      ));
    root.append(this.el);
  }

  open(v: DialogueVillager): void {
    this.portraitEl.innerHTML = portrait(v.id, '100%');
    setText(this.nameEl, v.name);
    setText(this.jobEl, v.job);
    this.setMood(v.mood);
    this.who = v.name;
    this.histEl.innerHTML = '';
    this.histEl.classList.add('empty');
    this.full = ''; this.shown = 0; this.lineEl.textContent = '';
    this.badgeEl.className = 'badge hidden';
    this.input.value = '';
    this.setOptions([]);
    this.setThinking(false);
    this.el.classList.remove('hidden');
    if (!this.isOpen) {
      this.isOpen = true;
      this.offKeys = onKeys((e) => this.key(e));
    }
  }

  /** Нова реплика на жителя. Предишната отива в историята. */
  say(text: string, opts: { ai?: boolean; mood?: string } = {}): void {
    if (this.full) this.addHistory(this.who, this.full, this.badgeEl.classList.contains('ai'));
    this.setThinking(false);
    this.full = text; this.shown = 0;
    this.lineEl.textContent = '';
    this.badgeEl.className = `badge${opts.ai ? ' ai' : ''}`;
    this.badgeEl.innerHTML = opts.ai ? `${sparkle('0.9em')} ИИ` : 'по сценарий';
    if (opts.mood !== undefined) this.setMood(opts.mood);
    this.stopTimer();
    const start = performance.now();
    this.timer = window.setInterval(() => {
      const n = Math.min(this.full.length, Math.floor(((performance.now() - start) / 1000) * this.cps));
      if (n !== this.shown) { this.shown = n; this.lineEl.textContent = this.full.slice(0, n); }
      if (n >= this.full.length) this.finish();
    }, 16);
  }

  /** Показва целия текст веднага. */
  skip(): void { if (this.timer !== null) this.finish(); }
  get typing(): boolean { return this.timer !== null; }

  setOptions(opts: DialogueOption[]): void {
    this.opts = opts.slice(0, 4);
    this.optsEl.innerHTML = '';
    this.opts.forEach((o, i) => {
      const b = h('button.dl-opt', null, h('kbd', { text: String(i + 1) }), h('span', { text: o.text })) as HTMLButtonElement;
      b.addEventListener('click', () => this.pick(i));
      this.optsEl.append(b);
    });
    this.syncDisabled();
  }

  setThinking(b: boolean): void {
    this.thinking = b;
    this.thinkEl.classList.toggle('hidden', !b);
    this.lineEl.classList.toggle('hidden', b);
    if (b) this.badgeEl.classList.add('hidden');
    this.syncDisabled();
  }

  setMood(mood?: string): void {
    setText(this.moodEl, mood ? `настроение: ${mood}` : '');
  }

  /** Добавя ред в историята (играта може да добавя и свои). */
  addHistory(who: string, text: string, ai = false): void {
    this.histEl.classList.remove('empty');
    const row = h('div.dl-hrow', { html: `<b>${esc(who)}:</b> ${esc(text)}${ai ? ` ${sparkle('0.75em')}` : ''}` });
    this.histEl.append(row);
    while (this.histEl.children.length > 12) this.histEl.firstElementChild?.remove();
    this.histEl.scrollTop = this.histEl.scrollHeight;
  }

  close(): void { this.hide(); }
  hide(): void {
    this.isOpen = false;
    this.stopTimer();
    this.el.classList.add('hidden');
    this.offKeys?.(); this.offKeys = null;
    this.input.blur();
  }
  dismiss(): void { if (!this.isOpen) return; this.hide(); this.onClose(); }

  // ---------------------------------------------------------------------------
  private finish(): void { this.stopTimer(); this.shown = this.full.length; this.lineEl.textContent = this.full; }
  private stopTimer(): void { if (this.timer !== null) { clearInterval(this.timer); this.timer = null; } }

  private syncDisabled(): void {
    for (const b of Array.from(this.optsEl.children) as HTMLButtonElement[]) b.disabled = this.thinking;
    this.sendBtn.disabled = this.thinking;
    this.el.classList.toggle('thinking', this.thinking);
  }

  private pick(i: number): void {
    const o = this.opts[i];
    if (!o || this.thinking) return;
    if (this.full) { this.addHistory(this.who, this.full, this.badgeEl.classList.contains('ai')); this.full = ''; }
    this.addHistory('Ти', o.text);
    this.onOption(o.id);
  }

  private send(): void {
    const t = this.input.value.trim();
    if (!t || this.thinking) return;
    this.input.value = '';
    if (this.full) { this.addHistory(this.who, this.full, this.badgeEl.classList.contains('ai')); this.full = ''; }
    this.addHistory('Ти', t);
    this.onFreeText(t);
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    const inInput = document.activeElement === this.input;
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.dismiss(); return; }
    if (inInput) return;
    if (e.code === 'Space') { e.preventDefault(); this.skip(); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.input.focus(); return; }
    const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
    if (m) { e.preventDefault(); if (this.typing) this.skip(); this.pick(Number(m[1]) - 1); }
  }
}
