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

interface TagEl { el: HTMLElement; name: HTMLElement; job: HTMLElement; bubble: HTMLElement; btxt: HTMLElement; bai: HTMLElement; text: string; seen: number; shown: boolean }

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
      const op = t.dist > this.maxDist - 8 ? (this.maxDist - t.dist) / 8 : 1;
      e.el.style.transform = `translate3d(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      e.el.style.opacity = op.toFixed(2);
      e.el.style.zIndex = String(1000 - Math.round(t.dist * 10));
      const b = t.bubble && t.dist < this.bubbleDist ? t.bubble : null;
      if (b) {
        if (b.text !== e.text) { e.text = b.text; setText(e.btxt, b.text); e.bubble.classList.remove('in'); void e.bubble.offsetWidth; }
        e.bai.style.display = b.ai ? '' : 'none';
        e.bubble.classList.add('in');
      } else if (e.text) {
        e.text = '';
        e.bubble.classList.remove('in');
      }
    }
    // жители, които не са подадени този кадър — скрий
    for (const e of this.tags.values()) if (e.seen !== this.frame && e.shown) { e.el.style.opacity = '0'; e.el.style.visibility = 'hidden'; e.shown = false; }
  }

  private make(id: string): TagEl {
    const name = h('div.nt-name'), job = h('div.nt-job'), btxt = h('span.nt-btxt'), bai = h('span.nt-ai', { html: sparkle('0.95em'), title: 'Казано от ИИ' });
    const bubble = h('div.nt-bubble', null, bai, btxt);
    const el = h('div.nt', null, bubble, h('div.nt-label', null, name, job));
    el.style.visibility = 'hidden';
    this.el.append(el);
    const t: TagEl = { el, name, job, bubble, btxt, bai, text: '', seen: 0, shown: false };
    this.tags.set(id, t);
    return t;
  }

  clear(): void { this.el.innerHTML = ''; this.tags.clear(); }
}
