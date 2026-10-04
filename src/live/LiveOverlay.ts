// Оверлей за лайв режима: „НА ЖИВО“, карта с гласуването, последните съобщения и голямо съобщение за случката.
// Без марки и лога на Twitch/YouTube. Стилът е като HUD-а (тъмни панели, златна рамка).
import type { LiveSessionState } from './LiveSession';

const CSS = `
.bl-live{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:40;pointer-events:none;font-family:Philosopher,serif;color:#f3ead7;display:flex;flex-direction:column;align-items:center;gap:8px;width:min(460px,calc(100vw - 32px))}
.bl-live-badge{display:flex;align-items:center;gap:8px;background:rgba(20,16,12,0.72);border:1px solid rgba(232,194,122,0.35);border-radius:10px;padding:4px 12px;font-size:13px;color:#c9bfa8}
.bl-live-badge b{color:#fff;background:#b3262b;border-radius:6px;padding:1px 8px;font-family:'Ruslan Display',Philosopher,serif;letter-spacing:1px;font-weight:normal}
.bl-live-badge i{width:8px;height:8px;border-radius:50%;background:#e04040;animation:bl-live-pulse 1.2s infinite}
@keyframes bl-live-pulse{50%{opacity:.25}}
.bl-live-card{width:100%;box-sizing:border-box;background:rgba(20,16,12,0.72);border:1px solid rgba(232,194,122,0.35);border-radius:10px;padding:10px 14px}
.bl-live-card h3{margin:0 0 6px;font:normal 16px 'Ruslan Display',Philosopher,serif;color:#e8c27a;display:flex;justify-content:space-between}
.bl-live-row{display:grid;grid-template-columns:110px 1fr 32px;align-items:center;gap:8px;font-size:14px;margin:3px 0}
.bl-live-row small{color:#c9bfa8}
.bl-live-bar{height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden}
.bl-live-bar i{display:block;height:100%;background:linear-gradient(90deg,#b3262b,#e8c27a);transition:width .3s}
.bl-live-hint{font-size:12px;color:#c9bfa8;text-align:center;background:rgba(20,16,12,0.6);border-radius:8px;padding:2px 10px}
.bl-live-card .bl-live-hint{background:none;padding:0}
.bl-live-chat{position:fixed;left:12px;bottom:120px;z-index:40;pointer-events:none;font-family:Philosopher,serif;font-size:13px;color:#f3ead7;max-width:320px;display:flex;flex-direction:column;gap:3px}
.bl-live-chat div{background:rgba(20,16,12,0.6);border-radius:8px;padding:2px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bl-live-chat b{color:#e8c27a;font-weight:normal}
.bl-live-announce{position:fixed;top:28%;left:50%;transform:translate(-50%,-50%);z-index:41;pointer-events:none;font:normal clamp(22px,3.4vw,44px) 'Ruslan Display',Philosopher,serif;color:#e8c27a;text-shadow:0 2px 12px #000,0 0 30px rgba(179,38,43,.8);text-align:center;width:calc(100vw - 32px);opacity:0;transition:opacity .6s}
.bl-live-announce.show{opacity:1}
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class LiveOverlay {
  private root: HTMLDivElement;
  private chat: HTMLDivElement;
  private announceEl: HTMLDivElement;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastShown = 0;

  constructor(parent: HTMLElement = document.body) {
    if (!document.getElementById('bl-live-css')) {
      const st = document.createElement('style');
      st.id = 'bl-live-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = document.createElement('div');
    this.root.className = 'bl-live';
    this.chat = document.createElement('div');
    this.chat.className = 'bl-live-chat';
    this.announceEl = document.createElement('div');
    this.announceEl.className = 'bl-live-announce';
    parent.append(this.root, this.chat, this.announceEl);
  }

  /** Голямо съобщение в средата на екрана („Гошо извика буря над селото!“). */
  announce(text: string, ms = 4500): void {
    this.announceEl.textContent = text;
    this.announceEl.classList.add('show');
    if (this.announceTimer) clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => this.announceEl.classList.remove('show'), ms);
  }

  /** Прерисува оверлея (викай при onChange на LiveSession и веднъж в секунда за отброяването). */
  render(s: LiveSessionState): void {
    const v = s.vote;
    let html = `<div class="bl-live-badge"><i></i><b>НА ЖИВО</b><span>${esc(s.statusLabel)}</span></div>`;
    if (v.active) {
      const max = Math.max(1, ...v.options.map((o) => o.votes));
      html += `<div class="bl-live-card"><h3><span>Какво да сполети селото?</span><span>${v.secondsLeft} с</span></h3>`;
      for (const o of v.options) {
        html += `<div class="bl-live-row"><span>${esc(o.label)}<br><small>${esc(o.cmd)}</small></span><div class="bl-live-bar"><i style="width:${Math.round((o.votes / max) * 100)}%"></i></div><span>${o.votes}</span></div>`;
      }
      html += `<div class="bl-live-hint">Пиши командата в чата · един глас на зрител</div></div>`;
    } else {
      html += `<div class="bl-live-hint">Пиши в чата: !караконджул · !самодиви · !буря · !сбор · !кражба</div>`;
    }
    this.root.innerHTML = html;
    this.chat.innerHTML = s.recent.map((m) => `<div><b>${esc(m.user)}:</b> ${esc(m.text)}</div>`).join('');
    if (v.last && v.last.at !== this.lastShown) {
      this.lastShown = v.last.at;
      this.announce(v.last.text);
    }
  }

  dispose(): void {
    if (this.announceTimer) clearTimeout(this.announceTimer);
    this.root.remove();
    this.chat.remove();
    this.announceEl.remove();
  }
}
