// Примерни данни за галерията на интерфейса.
import type { Ui } from '../ui';
import type { HudData } from '../ui/Hud';
import type { Place, PlaceId, Vec2 } from '../data/layout';
import { ICON_KEYS, icon, portrait, typeIcon, TYPE_LABELS } from '../ui/icons';
import type { ChronicleType } from '../sim/types';

export function hudData(): HudData {
  return {
    name: 'Стоян', level: 7, title: 'Странник',
    hp: 72, hpMax: 120, stamina: 64, staminaMax: 100, xp: 340, xpMax: 600,
    time: 11 * 1440 + 6 * 60 + 40,
    ai: { connected: true, label: 'ИИ: свързан (qwen3.5:4b)' },
    quests: [
      { id: 'rosen', title: 'Три стръка росен', step: 'Събери росен в Тъмната гора (1/3)' },
      { id: 'lamia', title: 'Ламята', step: 'Разбери къде спи Ламята', main: true },
      { id: 'chickens', title: 'Кой краде кокошките?', step: 'Попитай Радка в хана' },
    ],
    hotbar: [{ icon: 'saber', name: 'Сабя' }, { icon: 'potion', count: 3, name: 'Отвара' }, { icon: 'banitsa', count: 2, name: 'Баница' }, { icon: 'tea', count: 1 }, null, { icon: 'rosen', count: 1 }],
    selected: 0,
  };
}

/** Процедурна основна карта (1024²) — само за галерията. */
export function makeBaseMap(size: number, places: Record<PlaceId, Place>, river: Vec2[], forest: { center: Vec2; radius: number },
  w2m: (x: number, z: number, s: number) => { px: number; py: number }): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, '#5f8a42'); grd.addColorStop(1, '#6f9a4a');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  // петна трева
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) { g.fillStyle = rnd() > 0.5 ? 'rgba(79,122,58,0.35)' : 'rgba(140,170,90,0.25)'; g.beginPath(); g.arc(rnd() * size, rnd() * size, 4 + rnd() * 18, 0, 7); g.fill(); }
  const P = (v: Vec2) => w2m(v.x, v.z, size);
  const k = size / 600;
  // гора
  const fc = P(forest.center);
  for (let i = 0; i < 700; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * forest.radius * k;
    g.fillStyle = rnd() > 0.5 ? '#2f4a35' : '#3a5a40';
    g.beginPath(); g.arc(fc.px + Math.cos(a) * r, fc.py + Math.sin(a) * r, 3 + rnd() * 6, 0, 7); g.fill();
  }
  // планина
  const pk = P(places.lamia_peak.pos);
  for (let i = 6; i > 0; i--) { g.fillStyle = `rgba(${120 + i * 12},${112 + i * 10},${100 + i * 9},0.9)`; g.beginPath(); g.arc(pk.px - 10, pk.py + 10, i * 20 * k, 0, 7); g.fill(); }
  // блато
  const sw = P(places.swamp.pos);
  g.fillStyle = '#4a5a3a'; g.beginPath(); g.arc(sw.px, sw.py, 55 * k, 0, 7); g.fill();
  // река
  g.strokeStyle = '#b8a888'; g.lineWidth = 12 * k * 0.9; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); river.forEach((v, i) => { const p = P(v); if (i) g.lineTo(p.px, p.py); else g.moveTo(p.px, p.py); }); g.stroke();
  // езерце
  const pd = P(places.pond.pos); g.fillStyle = '#4a7aa0'; g.beginPath(); g.arc(pd.px, pd.py, 13 * k, 0, 7); g.fill();
  // пътища
  g.strokeStyle = '#c9b48a'; g.lineWidth = 3 * k;
  const road = (a: Vec2, b: Vec2) => { const p = P(a), q = P(b); g.beginPath(); g.moveTo(p.px, p.py); g.lineTo(q.px, q.py); g.stroke(); };
  road(places.start.pos, places.square.pos); road(places.square.pos, places.forest_edge.pos); road(places.square.pos, places.bridge.pos); road(places.bridge.pos, places.fortress.pos);
  // площад и къщи
  const sq = P(places.square.pos); g.fillStyle = '#c9b48a'; g.beginPath(); g.arc(sq.px, sq.py, 14 * k, 0, 7); g.fill();
  for (const pl of Object.values(places)) {
    if (!pl.id.startsWith('house') && !['smithy', 'inn', 'workshop_kalin', 'coop'].includes(pl.id)) continue;
    const p = P(pl.pos); g.fillStyle = '#a4472f'; g.fillRect(p.px - 4 * k, p.py - 3 * k, 8 * k, 6 * k);
    g.fillStyle = '#efe6d4'; g.fillRect(p.px - 4 * k, p.py + 1.5 * k, 8 * k, 1.5 * k);
  }
  // крепост
  const fo = P(places.fortress.pos); g.strokeStyle = '#9a9184'; g.lineWidth = 4 * k; g.strokeRect(fo.px - 14 * k, fo.py - 14 * k, 28 * k, 28 * k);
  return c;
}

const TYPES: ChronicleType[] = ['talk', 'quarrel', 'love', 'theft', 'rumor', 'election', 'work', 'festival', 'monster', 'player', 'quest', 'weather', 'live', 'reflection', 'mood', 'system'];

/** Икони, портрети и видове записи — табло за преглед. */
export function iconBoard(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:2em;pointer-events:auto;overflow:auto;background:rgba(20,16,12,.85);border:1px solid rgba(232,194,122,.35);border-radius:10px;padding:1.2em;display:flex;flex-direction:column;gap:1.2em';
  const row = (html: string) => `<div style="display:flex;flex-wrap:wrap;gap:1em">${html}</div>`;
  el.innerHTML = [
    '<div class="modal-title">Иконки</div>',
    row(ICON_KEYS.map((k) => `<div style="width:5.5em;text-align:center;font-size:.75em;color:#c9bfa8">${icon(k, '3.2em')}<br>${k}</div>`).join('')),
    '<div class="modal-title">Портрети</div>',
    row(['hero', 'gena', 'peyu', 'petko', 'ivan', 'maria', 'radka', 'kalin'].map((k) => `<div style="text-align:center;font-size:.75em;color:#c9bfa8">${portrait(k, '6em')}<br>${k}</div>`).join('')),
    '<div class="modal-title">Видове записи</div>',
    row(TYPES.map((t) => `<div style="display:flex;align-items:center;gap:.4em;font-size:.85em">${typeIcon(t, '1.6em')} ${TYPE_LABELS[t]}</div>`).join('')),
  ].join('');
  return el;
}

export function showExtra(ui: Ui, key: string, sceneBg: (k: 'day' | 'dusk' | 'night') => string, scene: HTMLElement, keep: (el: HTMLElement) => void, base: HTMLCanvasElement): void {
  if (key === 'icons') {
    const el = iconBoard(); ui.root.append(el); keep(el);
  }
  void sceneBg; void scene; void base;
}
