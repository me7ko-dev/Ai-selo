// Начален екран: заглавие, бутони, ред за ИИ. Прозрачен фон с винетка — отзад лети 3D камерата.
import { h, onKeys, setText } from './dom';
import { dividerHtml } from './ornament';
import './css/start.css';

export interface StartOptions {
  hasSave: boolean;
  /** „Ден 4 · 18:20 — Самодивско“ — по желание, под „Продължи“. */
  saveLabel?: string;
  ai?: { connected: boolean; label: string };
  version?: string;
}

export class StartScreen {
  readonly el: HTMLElement;
  isOpen = false;
  onNew: () => void = () => {};
  onContinue: () => void = () => {};
  onLive: () => void = () => {};
  onSettings: () => void = () => {};
  private btnCont: HTMLButtonElement; private contHint: HTMLElement; private aiEl: HTMLElement; private aiDot: HTMLElement; private verEl: HTMLElement;
  private offKeys: (() => void) | null = null;

  constructor(root: HTMLElement) {
    const mk = (text: string, cls: string, fn: () => void) => {
      const b = h(`button.btn.start-btn.${cls}`, { text }) as HTMLButtonElement;
      b.addEventListener('click', () => fn());
      return b;
    };
    this.btnCont = mk('Продължи', 'cont', () => this.onContinue());
    this.contHint = h('div.start-hint');
    this.aiDot = h('span.dot');
    this.aiEl = h('span');
    this.verEl = h('span.start-ver');
    this.el = h('div.start.hidden', null,
      h('div.start-vignette'),
      h('div.start-center', null,
        h('div.start-kicker', { text: 'Ролева игра от българските митове' }),
        h('h1.start-title', { text: 'Балкански легенди' }),
        h('div.start-orn', { html: dividerHtml('wide') }),
        h('div.start-sub', { text: 'Край 1: Самодивско' }),
        h('div.start-tag', { text: 'Ламята пресуши Бистрица. Селото чака странник.' }),
        h('div.start-menu', null,
          mk('Нова игра', 'primary', () => this.onNew()),
          h('div.start-cont', null, this.btnCont, this.contHint),
          mk('Лайв режим', 'live', () => this.onLive()),
          mk('Настройки', 'set', () => this.onSettings()),
        ),
      ),
      h('div.start-foot', null, h('span.start-ai', null, this.aiDot, this.aiEl), this.verEl),
    );
    root.append(this.el);
  }

  show(o: StartOptions): void {
    this.update(o);
    this.el.classList.remove('hidden');
    if (!this.isOpen) {
      this.isOpen = true;
      this.offKeys = onKeys((e) => {
        if (e.code === 'Enter') { e.preventDefault(); if (!this.btnCont.disabled) this.onContinue(); else this.onNew(); }
      });
    }
  }

  update(o: Partial<StartOptions>): void {
    if (o.hasSave !== undefined) {
      this.btnCont.disabled = !o.hasSave;
      setText(this.contHint, o.hasSave ? (o.saveLabel ?? '') : 'Още няма запазена игра');
    } else if (o.saveLabel !== undefined) setText(this.contHint, o.saveLabel);
    if (o.ai) {
      setText(this.aiEl, o.ai.label);
      this.aiDot.className = `dot${o.ai.connected ? ' on' : ''}`;
    }
    if (o.version !== undefined) setText(this.verEl, o.version);
  }

  hide(): void {
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.offKeys?.(); this.offKeys = null;
  }
}
