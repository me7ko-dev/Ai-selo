// Имена над главите на жителите + балончета с реплики. Елементите се преизползват (без нов DOM всеки кадър).
import { h, setText } from './dom';
import { sparkle } from './icons';
import './css/nametags.css';

export interface NameTag {
  id: string;
  name: string;
  job: string;
  x: number; y: number;          // екранни px (CSS) — точката над главата
  dist: number;                  // метри до камерата
  visible: boolean;
  bubble?: { text: string; ai?: boolean } | null;
}

interface TagEl { el: HTMLElement; label: HTMLElement; name: HTMLElement; job: HTMLElement; bubble: HTMLElement; btxt: HTMLElement; bai: HTMLElement; text: string; seen: number; shown: boolean }

export class NameTags {
  readonly el: HTMLElement;
  isOpen = true;
  /** Над това разстояние (м) етикетите изчезват. */
  maxDist = 38;
  /** Балончетата се виждат до това разстояние. */
  bubbleDist = 30;
  private tags = new Map<string, TagEl>();
  private frame = 0;

  constructor(root: HTMLElement) {
    this.el = h('div.nametags');
    root.append(this.el);
  }

  show(): void { this.el.classList.remove('hidden'); this.isOpen = true; }
  hide(): void { this.el.classList.add('hidden'); this.isOpen = false; }

  update(tags: NameTag[]): void {
    this.frame++;
    const shown: { t: NameTag; e: TagEl; scale: number; bubble: boolean }[] = [];
    for (const t of tags) {
      let e = this.tags.get(t.id);
      if (!e) e = this.make(t.id);
      e.seen = this.frame;
      const vis = t.visible && t.dist < this.maxDist;
      if (!vis) { if (e.shown) { e.el.style.opacity = '0'; e.el.style.visibility = 'hidden'; e.shown = false; } continue; }
      if (!e.shown) { e.el.style.visibility = 'visible'; e.shown = true; }
      setText(e.name, t.name);
      setText(e.job, t.job);
      const near = Math.max(0, Math.min(1, (t.dist - 4) / (this.maxDist - 4)));
      const scale = 1.05 - near * 0.33;
      const b = t.bubble && t.dist < this.bubbleDist ? t.bubble : null;
      if (b) {
        if (b.text !== e.text) { e.text = b.text; setText(e.btxt, b.text); e.bubble.classList.remove('in'); void e.bubble.offsetWidth; }
        e.bai.style.display = b.ai ? '' : 'none';
      } else if (e.text) {
        e.text = '';
        e.bubble.classList.remove('in');
      }
      shown.push({ t, e, scale, bubble: !!b });
    }
    // разреждане: по-близките остават на място, по-далечните, които се застъпват с тях, се качват нагоре
    shown.sort((a, b) => a.t.dist - b.t.dist);
    const placed: { l: number; r: number; top: number; bot: number }[] = [];
    for (const it of shown) {
      const { t, e, scale } = it;
      const lw = e.label.offsetWidth, lh = e.label.offsetHeight;
      type Fit = { x: number; y: number; w: number; hgt: number; cost: number };
      const hitAt = (x: number, y: number, w: number, hgt: number) =>
        placed.find((p) => x - w / 2 < p.r - 2 && x + w / 2 > p.l + 2 && y - hgt < p.bot - 1 && y > p.top + 1);
      const stack = (x: number, w: number, hgt: number): Fit => {
        let y = t.y;
        for (let k = 0; k < 8; k++) { const hit = hitAt(x, y, w, hgt); if (!hit) break; y = hit.top - 1; }
        return { x, y, w, hgt, cost: Math.abs(x - t.x) * 0.8 + (t.y - y) };
      };
      const fit = (withBubble: boolean): Fit => {
        const bw = withBubble ? e.bubble.offsetWidth : 0, bh = withBubble ? e.bubble.offsetHeight + 11 : 0;
        const w = Math.max(lw, bw) * scale, hgt = (lh + bh) * scale;
        let best = stack(t.x, w, hgt);
        const first = hitAt(t.x, t.y, w, hgt);
        if (first) {
          // или малко встрани от по-близкия
          for (const x of [first.r + 2 + w / 2, first.l - 2 - w / 2]) { const c = stack(x, w, hgt); if (c.cost < best.cost) best = c; }
        }
        return best;
      };
      let f = fit(it.bubble);
      // балонче, което би отлетяло далеч от главата, се скрива (остава само името) — по-близкият говори
      let withBubble = it.bubble;
      if (withBubble && f.cost > 60) { f = fit(false); withBubble = false; }
      e.bubble.classList.toggle('in', withBubble);
      // етикет, изместен много далеч от човека, само обърква — скрий го
      const lost = f.cost > 110;
      const { x, y, w, hgt } = f;
      if (!lost) placed.push({ l: x - w / 2, r: x + w / 2, top: y - hgt, bot: y });
      const op = lost ? 0 : t.dist > this.maxDist - 8 ? (this.maxDist - t.dist) / 8 : 1;
      e.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      e.el.style.opacity = op.toFixed(2);
      e.el.style.zIndex = String(1000 - Math.round(t.dist * 10));
    }
    // жители, които не са подадени този кадър — скрий
    for (const e of this.tags.values()) if (e.seen !== this.frame && e.shown) { e.el.style.opacity = '0'; e.el.style.visibility = 'hidden'; e.shown = false; }
  }

  private make(id: string): TagEl {
    const name = h('div.nt-name'), job = h('div.nt-job'), btxt = h('span.nt-btxt'), bai = h('span.nt-ai', { html: sparkle('0.95em'), title: 'Казано от ИИ' });
    const bubble = h('div.nt-bubble', null, bai, btxt);
    const label = h('div.nt-label', null, name, job);
    const el = h('div.nt', null, bubble, label);
    el.style.visibility = 'hidden';
    this.el.append(el);
    const t: TagEl = { el, label, name, job, bubble, btxt, bai, text: '', seen: 0, shown: false };
    this.tags.set(id, t);
    return t;
  }

  clear(): void { this.el.innerHTML = ''; this.tags.clear(); }
}
