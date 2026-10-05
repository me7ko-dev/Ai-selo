// Дребни екрани: смърт, голямо съобщение, зареждане, потвърждение, „Пауза“.
import { h, esc, onKeys, setText, clamp01 } from './dom';
import { dividerHtml, rosetteHtml } from './ornament';
import { cornersHtml } from './view';
import './css/misc.css';

/** „Падна в бой…“ + „Събуди се в хана“. */
export class DeathScreen {
  readonly el: HTMLElement;
  isOpen = false;
  onRespawn: () => void = () => {};
  private sub: HTMLElement; private btn: HTMLButtonElement; private off: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.sub = h('div.death-sub');
    this.btn = h('button.btn.gold.death-btn', { text: 'Събуди се в хана' }) as HTMLButtonElement;
    this.btn.addEventListener('click', () => this.respawn());
    this.el = h('div.death.hidden', null, h('div.death-box', null,
      h('div.death-title', { text: 'Падна в бой…' }), h('div', { html: dividerHtml() }), this.sub, this.btn));
    root.append(this.el);
  }

  /** subtitle по желание, напр. „Ламята те повали. Радка те намери пред хана.“ */
  show(subtitle = 'Тъмнината те обгърна. Някой от селото ще те намери…'): void {
    setText(this.sub, subtitle);
    this.el.classList.remove('hidden');
    if (!this.isOpen) { this.isOpen = true; this.off = onKeys((e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.respawn(); } }); }
  }
  hide(): void { this.isOpen = false; this.el.classList.add('hidden'); this.off?.(); this.off = null; }
  private respawn(): void { this.hide(); this.onRespawn(); }
}

type BannerKind = 'gold' | 'red' | 'quest';
interface BannerItem { title: string; subtitle: string; ms: number; kind: BannerKind; key?: string }

/** Голямо съобщение в средата с шевици: „Ламята е победена! Бистрица тече отново!“ */
export class Banner {
  readonly el: HTMLElement;
  isOpen = false;
  private t: HTMLElement; private s: HTMLElement; private timer: number | null = null;

  constructor(root: HTMLElement) {
    this.t = h('div.banner-t'); this.s = h('div.banner-s');
    this.el = h('div.banner.hidden', null, h('div.banner-box', null, h('div.orn-strip'), h('div.banner-in', null, this.t, this.s), h('div.orn-strip')));
    root.append(this.el);
  }

  /** Чакащи надписи: победа + ново ниво идват в един кадър — вторият се показва след първия, вместо да го смени. */
  private queue: BannerItem[] = [];
  private cur: BannerItem | null = null;

  /**
   * kind: 'gold' (победа/задача) | 'red' (опасност) | 'quest' (нова задача).
   * opt.key — чакащ надпис със същия ключ се заменя (няколко нови нива наведнъж → само последното);
   * opt.urgent — показва се веднага, а текущият изчаква след него.
   */
  show(title: string, subtitle = '', ms = 4500, kind: BannerKind = 'gold', opt: { key?: string; urgent?: boolean } = {}): void {
    const item: BannerItem = { title, subtitle, ms, kind, key: opt.key };
    if (this.isOpen && this.timer !== null && this.cur) {
      if (opt.urgent) { this.queue.unshift(this.cur); this.display(item); return; }
      if (item.key && this.cur.key === item.key) { this.display(item); return; }
      const same = this.queue.findIndex((q) => (item.key && q.key === item.key) || (q.title === title && q.subtitle === subtitle));
      if (same >= 0) this.queue[same] = item;
      else if (this.queue.length < 4) this.queue.push(item);
      return;
    }
    this.display(item);
  }
  private display(it: BannerItem): void {
    this.cur = it;
    this.t.innerHTML = `${rosetteHtml('0.7em')}<span>${esc(it.title)}</span>${rosetteHtml('0.7em')}`;
    setText(this.s, it.subtitle);
    this.s.classList.toggle('hidden', !it.subtitle);
    this.el.className = `banner k-${it.kind}`;
    void this.el.offsetWidth; this.el.classList.add('go');
    this.isOpen = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = it.ms > 0 ? window.setTimeout(() => this.close(true), it.ms) : null;
  }
  /** Скрива надписа (и забравя чакащите). */
  hide(): void { this.queue = []; this.close(false); }
  private close(next: boolean): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('out');
    window.setTimeout(() => {
      if (this.isOpen) return;
      this.el.classList.add('hidden');
      const q = next ? this.queue.shift() : undefined;
      if (q) this.display(q);
    }, 450);
  }
}

/** Екран за зареждане с лента. */
export class LoadingScreen {
  readonly el: HTMLElement;
  isOpen = false;
  private bar: HTMLElement; private txt: HTMLElement;

  constructor(root: HTMLElement) {
    this.bar = h('i'); this.txt = h('div.load-txt');
    this.el = h('div.loading.hidden', null, h('div.loading-box', null,
      h('div.loading-title', { text: 'Балкански легенди' }), h('div', { html: dividerHtml() }), this.txt, h('div.loading-bar', null, this.bar)));
    root.append(this.el);
  }
  show(text = 'Селото се събужда…', progress = 0): void { this.isOpen = true; this.el.classList.remove('hidden', 'out'); this.update(progress, text); }
  /** progress 0..1 */
  update(progress: number, text?: string): void {
    this.bar.style.width = `${clamp01(progress) * 100}%`;
    if (text !== undefined) setText(this.txt, text);
  }
  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('out');
    window.setTimeout(() => { if (!this.isOpen) this.el.classList.add('hidden'); }, 500);
  }
}

export interface ConfirmOptions { title: string; text: string; ok?: string; cancel?: string; danger?: boolean }

/** Прозорец „Сигурен ли си?“. ask() връща Promise<boolean>. Enter = да, Esc = не. */
export class ConfirmDialog {
  readonly el: HTMLElement;
  isOpen = false;
  private t: HTMLElement; private x: HTMLElement; private ok: HTMLButtonElement; private no: HTMLButtonElement;
  private resolve: ((v: boolean) => void) | null = null; private off: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.t = h('div.modal-title'); this.x = h('div.cf-text');
    this.ok = h('button.btn.gold') as HTMLButtonElement; this.no = h('button.btn') as HTMLButtonElement;
    this.ok.addEventListener('click', () => this.done(true));
    this.no.addEventListener('click', () => this.done(false));
    this.el = h('div.modal-back.cf-back.hidden', null, h('div.modal.cf', { html: cornersHtml() }, h('div.modal-head', null, this.t), this.x, h('div.cf-btns', null, this.no, this.ok)));
    root.append(this.el);
  }

  ask(o: ConfirmOptions): Promise<boolean> {
    this.done(false);
    setText(this.t, o.title); setText(this.x, o.text);
    setText(this.ok, o.ok ?? 'Да'); setText(this.no, o.cancel ?? 'Откажи');
    this.ok.className = `btn ${o.danger ? 'primary' : 'gold'}`;
    this.el.classList.remove('hidden');
    this.isOpen = true;
    this.off = onKeys((e) => {
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.done(false); }
      else if (e.code === 'Enter') { e.preventDefault(); this.done(true); }
    });
    return new Promise((r) => { this.resolve = r; });
  }
  hide(): void { this.done(false); }

  private done(v: boolean): void {
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.off?.(); this.off = null;
    const r = this.resolve; this.resolve = null; r?.(v);
  }
}

/** Малък надпис „Пауза“ горе в средата. */
export class PauseHint {
  readonly el: HTMLElement;
  isOpen = false;
  constructor(root: HTMLElement) {
    this.el = h('div.pause-hint.hidden', { html: `${rosetteHtml('0.8em')}<span>Пауза</span>${rosetteHtml('0.8em')}` });
    root.append(this.el);
  }
  show(text = 'Пауза'): void { this.el.querySelector('span')!.textContent = text; this.el.classList.remove('hidden'); this.isOpen = true; }
  hide(): void { this.el.classList.add('hidden'); this.isOpen = false; }
}
