// „Докато те нямаше…“ — до 6 картички с най-интересното, появяват се една след друга; „Продължи“.
import type { ChronicleType } from '../sim/types';
import { h, esc, onKeys } from './dom';
import { portrait, typeIcon, personName, TYPE_LABELS } from './icons';
import { dividerHtml } from './ornament';
import './css/away.css';

export interface AwayCard {
  title: string;
  text: string;
  /** „Ден 3 · 14:20“ (готов надпис) или общи игрови минути. */
  time: string | number;
  type: ChronicleType;
  participants: string[];        // id на жители / 'player'
  ai?: boolean;
}

export class AwayView {
  readonly el: HTMLElement;
  isOpen = false;
  private grid: HTMLElement; private sub: HTMLElement; private btn: HTMLButtonElement;
  private cb: (() => void) | null = null;
  private offKeys: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.grid = h('div.away-grid');
    this.sub = h('div.away-sub');
    this.btn = h('button.btn.gold.away-btn', { text: 'Продължи' }) as HTMLButtonElement;
    this.btn.addEventListener('click', () => this.done());
    this.el = h('div.away.hidden', null, h('div.away-inner', null,
      h('h2.away-title', { text: 'Докато те нямаше…' }),
      this.sub,
      h('div.away-orn', { html: dividerHtml() }),
      this.grid,
      this.btn));
    root.append(this.el);
  }

  /** subtitle напр. „Минаха 2 дни и 4 часа в Самодивско.“ */
  show(cards: AwayCard[], onContinue: () => void, subtitle = ''): void {
    this.cb = onContinue;
    this.sub.textContent = subtitle;
    this.sub.classList.toggle('hidden', !subtitle);
    const fmt = (t: string | number) => typeof t === 'number' ? `Ден ${Math.floor(t / 1440) + 1} · ${String(Math.floor((t % 1440) / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}` : t;
    const list = cards.slice(0, 6);
    this.grid.innerHTML = list.length ? list.map((c, i) => `
      <div class="away-card t-${c.type}" style="animation-delay:${0.25 + i * 0.32}s">
        <div class="away-card-top">${typeIcon(c.type, '1.3em')}<span class="away-kind">${TYPE_LABELS[c.type] ?? ''}</span><span class="away-time">${esc(fmt(c.time))}</span></div>
        <div class="away-card-t">${esc(c.title)}${c.ai ? ' <span class="away-ai" title="Разказано от ИИ">✦</span>' : ''}</div>
        <div class="away-card-x">${esc(c.text)}</div>
        <div class="away-people">${c.participants.slice(0, 5).map((p) => `<span title="${esc(personName(p))}">${portrait(p === 'player' ? 'hero' : p, '2em')}</span>`).join('')}</div>
      </div>`).join('') : '<div class="away-none">Тихо беше в Самодивско. Нищо особено не се случи.</div>';
    this.grid.dataset.n = String(list.length);
    this.btn.style.animationDelay = `${0.4 + list.length * 0.32}s`;
    this.el.classList.remove('hidden');
    if (!this.isOpen) {
      this.isOpen = true;
      this.offKeys = onKeys((e) => { if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') { e.preventDefault(); this.done(); } });
    }
  }

  hide(): void {
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.offKeys?.(); this.offKeys = null;
  }

  private done(): void {
    const cb = this.cb; this.cb = null;
    this.hide();
    cb?.();
  }
}
