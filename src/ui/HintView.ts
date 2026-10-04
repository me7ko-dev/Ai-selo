// Подсказка за обучението: малка табелка над бързата лента. Не спира играта и не взима мишката.
// Текстът ползва „[клавиш]“ → <kbd>клавиш</kbd> и „*дума*“ → получер (виж hintHtml).
import { h } from './dom';
import { hintHtml } from './logic';
import { rosetteHtml } from './ornament';
import './css/hint.css';

export class HintView {
  readonly el: HTMLElement;
  isOpen = false;
  private txt: HTMLElement; private step: HTMLElement;
  private key = '';
  private timer: number | null = null;

  /** parent — мястото в HUD над подканата и бързата лента (Hud.bottomEl). */
  constructor(parent: HTMLElement) {
    this.txt = h('div.hint-txt');
    this.step = h('div.hint-step');
    this.el = h('div.hintbox.hidden', null, h('span.hint-ic', { html: rosetteHtml('1em') }), h('div.hint-main', null, this.step, this.txt), h('span.hint-ok', { text: '✓' }));
    parent.prepend(this.el);
  }

  /** Показва подсказка. label — малкият надпис отгоре (напр. „Съвет 2 от 6“). Същият текст не се преначертава. */
  show(text: string, label = 'Съвет'): void {
    const k = `${label}|${text}`;
    this.clearTimer();
    if (k === this.key && this.isOpen && !this.el.classList.contains('ok')) return;
    this.key = k;
    this.txt.innerHTML = hintHtml(text);
    this.step.textContent = label;
    this.el.className = 'hintbox';
    void this.el.offsetWidth;
    this.el.classList.add('in');
    this.isOpen = true;
  }

  /** „Браво“ — зелена отметка и изчезване. */
  done(ms = 900): void {
    if (!this.isOpen) return;
    this.el.classList.add('ok');
    this.clearTimer();
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    this.clearTimer();
    this.isOpen = false;
    this.key = '';
    this.el.className = 'hintbox hidden';
  }

  private clearTimer(): void { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }
}
