// Въведение при „Нова игра“: 3 илюстровани страници (Ламята, селото, Стоян). Space / Enter / клик — нататък, Esc — прескочи.
import { h, onKeys, setText } from './dom';
import { dividerHtml } from './ornament';
import { cornersHtml } from './view';
import { INTRO_PAGES } from './introArt';
export { INTRO_PAGES, type IntroPage } from './introArt';
import './css/intro.css';

export class IntroView {
  readonly el: HTMLElement;
  isOpen = false;
  /** Вика се, когато въведението свърши (последната страница или „Прескочи“). */
  onDone: () => void = () => {};
  private page = 0;
  private artEl: HTMLElement; private kickerEl: HTMLElement; private titleEl: HTMLElement; private textEl: HTMLElement;
  private dotsEl: HTMLElement; private nextBtn: HTMLButtonElement; private card: HTMLElement;
  private offKeys: (() => void) | null = null;
  private openedAt = 0;

  constructor(root: HTMLElement) {
    this.artEl = h('div.intro-art');
    this.kickerEl = h('div.intro-kicker');
    this.titleEl = h('h2.intro-title');
    this.textEl = h('p.intro-text');
    this.dotsEl = h('div.intro-dots');
    this.nextBtn = h('button.btn.gold.intro-next') as HTMLButtonElement;
    this.nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
    const skip = h('button.btn.ghost.small.intro-skip', { text: 'Прескочи', title: 'Esc' });
    skip.addEventListener('click', (e) => { e.stopPropagation(); this.finish(); });
    this.card = h('div.intro-card', { html: cornersHtml() },
      h('div.intro-frame', null, this.artEl, h('div.orn-strip.intro-strip')),
      h('div.intro-body', null, this.kickerEl, this.titleEl, h('div.intro-orn', { html: dividerHtml() }), this.textEl),
      h('div.intro-foot', null, this.dotsEl, h('div.intro-keys.hint', { html: '<kbd>Space</kbd> или клик — нататък · <kbd>Esc</kbd> — прескочи' }), this.nextBtn),
    );
    this.el = h('div.intro.hidden', null, h('div.intro-back'), this.card, skip);
    // клик където и да е — следващата страница
    this.el.addEventListener('click', () => this.next());
    root.append(this.el);
  }

  show(onDone?: () => void): void {
    if (onDone) this.onDone = onDone;
    this.page = 0;
    this.render();
    this.el.classList.remove('hidden');
    this.openedAt = performance.now();
    if (!this.isOpen) {
      this.isOpen = true;
      this.offKeys = onKeys((e) => {
        if (!this.isOpen || e.repeat) return;
        if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.finish(); }
        else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.next(); }
        else if (e.code === 'ArrowLeft' && this.page > 0) { e.preventDefault(); this.page--; this.render(); }
      });
    }
  }

  /** Скрива без onDone. */
  hide(): void {
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.offKeys?.(); this.offKeys = null;
  }

  get pageIndex(): number { return this.page; }
  /** Прескача на страница i (0..2) — за галерията. */
  goTo(i: number): void { this.page = Math.max(0, Math.min(INTRO_PAGES.length - 1, i)); this.render(); }

  next(): void {
    if (!this.isOpen) return;
    // клавишът/кликът, с който е натиснато „Нова игра“, да не прелисти веднага
    if (performance.now() - this.openedAt < 250) return;
    if (this.page >= INTRO_PAGES.length - 1) { this.finish(); return; }
    this.page++;
    this.render();
  }

  private finish(): void {
    if (!this.isOpen) return;
    this.hide();
    this.onDone();
  }

  private render(): void {
    const p = INTRO_PAGES[this.page];
    this.artEl.innerHTML = p.art();
    setText(this.kickerEl, p.kicker);
    setText(this.titleEl, p.title);
    setText(this.textEl, p.text);
    const last = this.page === INTRO_PAGES.length - 1;
    setText(this.nextBtn, last ? 'Тръгни към селото' : 'Нататък ›');
    this.nextBtn.classList.toggle('last', last);
    this.dotsEl.innerHTML = INTRO_PAGES.map((_, i) => `<i class="${i === this.page ? 'on' : i < this.page ? 'past' : ''}"></i>`).join('');
    // анимацията на страницата — отначало
    this.card.classList.remove('turn'); void this.card.offsetWidth; this.card.classList.add('turn');
  }
}
