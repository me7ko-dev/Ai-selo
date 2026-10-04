// Карта на света (M): пергамент, мъгла над неизследваното (64×64), имена на местата, стрелка, знаци, роза на ветровете, легенда.
import { PLACES, LOCKED_REGIONS } from '../data/layout';
import { h } from './dom';
import { icon } from './icons';
import { ModalView, cornersHtml } from './view';
import { worldToMap, yawToScreenAngle } from './logic';
import type { MapMarker, MapDot } from './Hud';
import './css/map.css';

export interface MapLabel { x: number; z: number; text: string; size?: 'big' | 'mid' | 'small' }

export interface MapData {
  base: HTMLCanvasElement | HTMLImageElement | null;  // 1024² основна карта
  /** 64×64 (ред по ред, север горе): >0 = изследвано. null = всичко се вижда. */
  explored?: ArrayLike<number> | null;
  player: { x: number; z: number; yaw: number };
  markers?: MapMarker[];
  dots?: MapDot[];
  labels?: MapLabel[];
}

/** Главните места по подразбиране. */
export const DEFAULT_LABELS: MapLabel[] = [
  { ...PLACES.square.pos, z: PLACES.square.pos.z + 22, text: 'Самодивско', size: 'big' },
  { ...PLACES.forest.pos, text: 'Тъмната гора', size: 'big' },
  { ...PLACES.glade.pos, x: PLACES.glade.pos.x + 48, z: PLACES.glade.pos.z + 40, text: 'Поляната на самодивите', size: 'mid' },
  { x: 104, z: 120, text: 'Бистрица', size: 'small' },
  { ...PLACES.lamia_peak.pos, z: PLACES.lamia_peak.pos.z - 28, text: 'Ламин връх', size: 'mid' },
  { ...PLACES.lamia_plateau.pos, z: PLACES.lamia_plateau.pos.z + 36, text: 'Бърлогата на Ламята', size: 'small' },
  { ...PLACES.fortress.pos, z: PLACES.fortress.pos.z + 34, text: 'Старата крепост', size: 'mid' },
  { ...PLACES.swamp.pos, text: 'Блатото на юдите', size: 'mid' },
];

const SIZE = 1024;

export class MapView extends ModalView {
  private cv: HTMLCanvasElement; private ctx: CanvasRenderingContext2D;
  private layer: HTMLElement; private paper: HTMLCanvasElement | null = null;

  constructor(root: HTMLElement) {
    super(root, 'map-back');
    this.closeKeys = ['KeyM'];
    this.cv = h('canvas.map-cv') as HTMLCanvasElement;
    this.cv.width = this.cv.height = SIZE;
    this.ctx = this.cv.getContext('2d')!;
    this.layer = h('div.map-layer');
    const close = h('button.icon-btn.close-x.map-close', { text: '×', title: 'Затвори (M / Esc)' });
    close.addEventListener('click', () => this.dismiss());
    const legend = h('div.map-legend', { html: `
      <div class="map-legend-t">Знаци</div>
      <div><span class="lg-arrow"></span> Ти си тук</div>
      <div><span class="lg-quest"></span> Задача</div>
      <div><span class="lg-boss"></span> Опасност</div>
      <div><span class="lg-dot"></span> Жител</div>
      <div><span class="lg-hatch"></span> Затворен път</div>
      <div><span class="lg-fog"></span> Неизследвано</div>
      <div class="map-legend-k"><kbd>M</kbd> затвори</div>` });
    const compass = h('div.map-compass', { html: COMPASS });
    const frame = h('div.map-frame', null, this.cv, h('div.map-paper'), this.layer, compass, h('div.map-title', { text: 'Край 1: Самодивско' }));
    this.el.append(h('div.map-wrap', { html: cornersHtml() }, frame, legend, close));
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.dismiss(); });
  }

  open(d: MapData): void { this.update(d); this.openBase(); }
  show(d: MapData): void { this.open(d); }

  update(d: MapData): void {
    this.render(d);
    this.renderLayer(d);
  }

  private render(d: MapData): void {
    const g = this.ctx;
    g.save();
    g.fillStyle = '#e4d1a6'; g.fillRect(0, 0, SIZE, SIZE);
    if (d.base) {
      g.filter = 'sepia(0.9) saturate(0.55) brightness(1.08) contrast(1.15)';
      g.globalAlpha = 0.92;
      g.drawImage(d.base, 0, 0, SIZE, SIZE);
      g.filter = 'none'; g.globalAlpha = 1;
      g.globalCompositeOperation = 'soft-light'; g.fillStyle = '#e0a860'; g.fillRect(0, 0, SIZE, SIZE); g.globalCompositeOperation = 'source-over';
    }
    // хартия
    g.globalCompositeOperation = 'multiply';
    g.drawImage(this.paperTex(), 0, 0, SIZE, SIZE);
    g.globalCompositeOperation = 'source-over';
    // затворени места — щрихи
    for (const lr of LOCKED_REGIONS) {
      const p = PLACES[lr.place]; if (!p) continue;
      const c = worldToMap(p.pos.x, p.pos.z, SIZE), r = (lr.radius / 600) * SIZE;
      g.save(); g.beginPath(); g.arc(c.px, c.py, r, 0, Math.PI * 2); g.clip();
      g.fillStyle = 'rgba(70,40,20,0.12)'; g.fillRect(c.px - r, c.py - r, r * 2, r * 2);
      g.strokeStyle = 'rgba(80,40,20,0.55)'; g.lineWidth = 2;
      for (let x = -r * 2; x < r * 2; x += 11) { g.beginPath(); g.moveTo(c.px + x, c.py - r); g.lineTo(c.px + x + r * 2, c.py + r); g.stroke(); }
      g.restore();
      g.setLineDash([6, 5]); g.strokeStyle = 'rgba(90,40,20,0.7)'; g.lineWidth = 2.2;
      g.beginPath(); g.arc(c.px, c.py, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    // мъгла
    if (d.explored && d.explored.length >= 64 * 64) {
      const fog = document.createElement('canvas'); fog.width = fog.height = SIZE;
      const fg = fog.getContext('2d')!;
      fg.fillStyle = '#d9c393'; fg.fillRect(0, 0, SIZE, SIZE);
      fg.globalCompositeOperation = 'multiply'; fg.drawImage(this.paperTex(), 0, 0, SIZE, SIZE);
      // облачета от мастило
      fg.globalCompositeOperation = 'source-over';
      fg.strokeStyle = 'rgba(120,90,50,0.18)'; fg.lineWidth = 2;
      for (let y = 30; y < SIZE; y += 64) for (let x = (y / 64) % 2 ? 0 : 32; x < SIZE; x += 64) { fg.beginPath(); fg.arc(x, y, 14, Math.PI, Math.PI * 2); fg.arc(x + 18, y, 10, Math.PI, Math.PI * 2); fg.stroke(); }
      const mask = document.createElement('canvas'); mask.width = mask.height = 64;
      const mg = mask.getContext('2d')!, img = mg.createImageData(64, 64);
      for (let i = 0; i < 64 * 64; i++) { img.data[i * 4 + 3] = d.explored[i] > 0 ? 255 : 0; }
      mg.putImageData(img, 0, 0);
      fg.globalCompositeOperation = 'destination-out';
      fg.filter = 'blur(14px)'; fg.imageSmoothingEnabled = true;
      fg.drawImage(mask, 0, 0, SIZE, SIZE);
      fg.drawImage(mask, 0, 0, SIZE, SIZE);
      fg.filter = 'none';
      g.drawImage(fog, 0, 0);
    }
    // тъмни ръбове
    const vg = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.35, SIZE / 2, SIZE / 2, SIZE * 0.75);
    vg.addColorStop(0, 'rgba(90,50,20,0)'); vg.addColorStop(1, 'rgba(90,50,20,0.45)');
    g.fillStyle = vg; g.fillRect(0, 0, SIZE, SIZE);
    g.restore();
  }

  private renderLayer(d: MapData): void {
    const pct = (x: number, z: number) => { const p = worldToMap(x, z, 100); return `left:${p.px}%;top:${p.py}%`; };
    const labels = (d.labels ?? DEFAULT_LABELS).map((l) => `<div class="map-lbl ${l.size ?? 'mid'}" style="${pct(l.x, l.z)}">${l.text}</div>`).join('');
    const dots = (d.dots ?? []).map((m) => `<i class="map-dot" style="${pct(m.x, m.z)};${m.color ? `background:${m.color}` : ''}"></i>`).join('');
    const marks = (d.markers ?? []).map((m) => `<div class="map-mk ${m.kind}" style="${pct(m.x, m.z)}">${m.kind === 'quest' ? icon('quest', '100%') : m.kind === 'boss' ? BOSS_MARK : ''}</div>`).join('');
    const a = yawToScreenAngle(d.player.yaw);
    const player = `<div class="map-player" style="${pct(d.player.x, d.player.z)};transform:translate(-50%,-50%) rotate(${a}rad)"><svg viewBox="0 0 20 20"><path d="M10 1 L17 18 L10 14 L3 18 Z" fill="#b3262b" stroke="#2a1a0e" stroke-width="1.4" stroke-linejoin="round"/></svg></div>`;
    this.layer.innerHTML = labels + dots + marks + player;
  }

  /** Шум за хартия (веднъж). */
  private paperTex(): HTMLCanvasElement {
    if (this.paper) return this.paper;
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!, img = g.createImageData(512, 512);
    let s = 1234567;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 512 * 512; i++) {
      const v = 225 + rnd() * 30;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.96; img.data[i * 4 + 2] = v * 0.88; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // петна
    for (let i = 0; i < 40; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 20 + rnd() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(180,140,90,0.18)'); gr.addColorStop(1, 'rgba(180,140,90,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // влакна
    g.strokeStyle = 'rgba(150,120,80,0.12)'; g.lineWidth = 0.7;
    for (let i = 0; i < 260; i++) { const x = rnd() * 512, y = rnd() * 512; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 8); g.stroke(); }
    this.paper = c;
    return c;
  }
}

const BOSS_MARK = `<svg viewBox="0 0 24 24"><path d="M4 20 C4 11 7 5 12 5 C17 5 20 11 20 20 L17 17 L14.5 20 L12 17 L9.5 20 L7 17 Z" fill="#9a1e1a" stroke="#2a0a08" stroke-width="1.2"/><path d="M5 8 L7.5 2.5 L9.5 7 M19 8 L16.5 2.5 L14.5 7" fill="#9a1e1a" stroke="#2a0a08" stroke-width="1"/><circle cx="9.5" cy="11.5" r="1.4" fill="#f6c27a"/><circle cx="14.5" cy="11.5" r="1.4" fill="#f6c27a"/></svg>`;

const COMPASS = `<svg viewBox="0 0 100 100" aria-hidden="true">
<circle cx="50" cy="50" r="36" fill="none" stroke="#5a3a1a" stroke-width="1.2"/>
<circle cx="50" cy="50" r="31" fill="none" stroke="#5a3a1a" stroke-width="0.6" stroke-dasharray="2 2"/>
<g fill="#5a3a1a"><path d="M50 8 L56 44 L50 50 L44 44 Z" fill="#9a1e1a"/><path d="M50 92 L56 56 L50 50 L44 56 Z"/><path d="M8 50 L44 44 L50 50 L44 56 Z"/><path d="M92 50 L56 44 L50 50 L56 56 Z"/></g>
<g fill="#8a6a3a" opacity="0.8"><path d="M50 50 L72 28 L58 46 Z"/><path d="M50 50 L28 28 L46 42 Z"/><path d="M50 50 L72 72 L54 58 Z"/><path d="M50 50 L28 72 L42 54 Z"/></g>
<circle cx="50" cy="50" r="3" fill="#e8c27a" stroke="#5a3a1a"/>
<text x="50" y="7" text-anchor="middle" font-size="11" fill="#7a1a16" font-family="Ruslan Display, serif">С</text>
<text x="50" y="100" text-anchor="middle" font-size="9" fill="#5a3a1a" font-family="Ruslan Display, serif">Ю</text>
<text x="3" y="53" text-anchor="middle" font-size="9" fill="#5a3a1a" font-family="Ruslan Display, serif">З</text>
<text x="97" y="53" text-anchor="middle" font-size="9" fill="#5a3a1a" font-family="Ruslan Display, serif">И</text>
</svg>`;
