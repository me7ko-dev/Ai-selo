// Лайв режим: „● НА ЖИВО“, карта с гласуването (броячи, ленти, команди, обратно броене), съобщение за резултата, чат.
import { h, esc, setText } from './dom';
import { rosetteHtml } from './ornament';
import './css/live.css';

export interface VoteOption { cmd: string; label: string; count: number }
export interface VoteData {
  question?: string;              // по подразбиране „Какво да се случи в селото?“
  options: VoteOption[];          // cmd = '!буря'
  endsAt: number;                 // Date.now() + ms — броячът върви сам
  duration?: number;              // ms (за лентата на времето), по подразбиране 30000
}

export class LiveOverlay {
  readonly el: HTMLElement;
  isOpen = false;
  private badge: HTMLElement; private chanEl: HTMLElement;
  private card: HTMLElement; private q: HTMLElement; private opts: HTMLElement; private timeEl: HTMLElement; private timeBar: HTMLElement;
  private chatEl: HTMLElement; private resEl: HTMLElement;
  private vote: VoteData | null = null; private timer: number | null = null; private optKey = '';

  constructor(root: HTMLElement) {
    this.chanEl = h('span.lv-chan');
    this.badge = h('div.lv-badge', null, h('span.lv-rec'), h('b', { text: 'НА ЖИВО' }), this.chanEl);
    this.q = h('div.lv-q');
    this.opts = h('div.lv-opts');
    this.timeEl = h('span.lv-time');
    this.timeBar = h('i');
    this.card = h('div.lv-card.hidden', null, h('div.lv-q-row', { html: rosetteHtml('0.85em') }, this.q, this.timeEl), this.opts, h('div.lv-timebar', null, this.timeBar), h('div.lv-help', { text: 'Пиши командата в чата, за да гласуваш' }));
    this.chatEl = h('div.lv-chat');
    this.resEl = h('div.lv-result.hidden');
    this.el = h('div.live.hidden', null, this.badge, this.card, this.chatEl, this.resEl);
    root.append(this.el);
  }

  /** Показва/скрива целия слой; channel — името на канала до значката. */
  setLive(on: boolean, channel = ''): void {
    this.isOpen = on;
    this.el.classList.toggle('hidden', !on);
    setText(this.chanEl, channel ? `#${channel}` : '');
    if (!on) this.setVote(null);
  }
  show(channel = ''): void { this.setLive(true, channel); }
  hide(): void { this.setLive(false); }

  /** Ново гласуване или обновени броячи. null = скрий картата. */
  setVote(v: VoteData | null): void {
    this.vote = v;
    if (!v) { this.card.classList.add('hidden'); this.stop(); this.optKey = ''; return; }
    this.card.classList.remove('hidden');
    setText(this.q, v.question ?? 'Какво да се случи в селото?');
    const total = Math.max(1, v.options.reduce((a, o) => a + o.count, 0));
    const max = Math.max(...v.options.map((o) => o.count), 0);
    const key = v.options.map((o) => o.cmd).join('|');
    if (key !== this.optKey) {
      this.optKey = key;
      this.opts.innerHTML = v.options.map(() => `<div class="lv-opt"><div class="lv-opt-bar"></div><span class="lv-cmd"></span><span class="lv-lbl"></span><b class="lv-cnt"></b></div>`).join('');
    }
    v.options.forEach((o, i) => {
      const el = this.opts.children[i] as HTMLElement;
      (el.querySelector('.lv-opt-bar') as HTMLElement).style.width = `${(o.count / total) * 100}%`;
      setText(el.querySelector('.lv-cmd') as HTMLElement, o.cmd);
      setText(el.querySelector('.lv-lbl') as HTMLElement, o.label);
      setText(el.querySelector('.lv-cnt') as HTMLElement, String(o.count));
      el.classList.toggle('lead', o.count > 0 && o.count === max);
    });
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 250);
    this.tick();
  }

  /** Голямо съобщение: „Пешо извика буря над селото!“ */
  result(text: string, ms = 5000): void {
    this.resEl.innerHTML = `${rosetteHtml('1em')}<span>${esc(text)}</span>${rosetteHtml('1em')}`;
    this.resEl.classList.remove('hidden', 'go'); void this.resEl.offsetWidth; this.resEl.classList.add('go');
    window.setTimeout(() => this.resEl.classList.add('hidden'), ms);
  }

  /** Ред в чата (последните 6). */
  chat(user: string, text: string, color?: string): void {
    const row = h('div.lv-msg', { html: `<b style="color:${esc(color ?? nickColor(user))}">${esc(user)}</b> ${esc(text)}` });
    this.chatEl.append(row);
    while (this.chatEl.children.length > 6) this.chatEl.firstElementChild?.remove();
  }

  private tick(): void {
    if (!this.vote) return;
    const left = Math.max(0, this.vote.endsAt - Date.now());
    setText(this.timeEl, `${Math.ceil(left / 1000)} с`);
    this.timeBar.style.width = `${(left / (this.vote.duration ?? 30000)) * 100}%`;
    this.card.classList.toggle('ending', left < 5000);
    if (left <= 0) this.stop();
  }
  private stop(): void { if (this.timer !== null) { clearInterval(this.timer); this.timer = null; } }
}

function nickColor(n: string): string {
  let x = 0; for (let i = 0; i < n.length; i++) x = (x * 31 + n.charCodeAt(i)) >>> 0;
  return ['#e8c27a', '#9cd07a', '#8fb8f0', '#f09a8a', '#d6a0e8', '#7fd0c8', '#f6c27a'][x % 7];
}
