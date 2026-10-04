// Галерия на интерфейса: всеки изглед с примерни данни. Отвори /dev/ui.html#hud (… #dialogue, #inventory и т.н.).
// Добави „&clean“ в адреса, за да скриеш лентата с бутоните (за снимки).
import { mountUi, type Ui } from '../ui';
import { PLACES, RIVER_PATH, FOREST } from '../data/layout';
import { VILLAGERS, VILLAGER_IDS } from '../data/villagers';
import { DEFAULT_AI } from '../sim/brain/Brain';
import { worldToMap } from '../ui/logic';
import * as M from './ui-mock';
import { showExtra } from './ui-scenes';

const scene = document.getElementById('scene')!;
scene.style.background = sceneBg('day');
const ui: Ui = mountUi(document.getElementById('ui')!);
(window as unknown as { __ui: Ui }).__ui = ui;
const base = M.makeBaseMap(1024, PLACES, RIVER_PATH, FOREST, worldToMap);
ui.hud.setMinimap(base);

function sceneBg(kind: 'day' | 'dusk' | 'night'): string {
  const sky = kind === 'day' ? '#9cc7e8, #e9f1f4 48%' : kind === 'dusk' ? '#5a4a7a, #e2795a 38%, #f6c27a 50%' : '#0d1530, #253a6b 50%';
  const hills = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="none"><path d="M0 470 C200 400 330 430 520 380 C700 330 820 420 1000 370 C1200 320 1380 400 1600 360 V900 H0Z" fill="${kind === 'night' ? '#1a2a3a' : '#7a8fa0'}" opacity="0.7"/><path d="M0 560 C220 500 380 540 600 500 C820 460 980 540 1200 500 C1380 470 1500 520 1600 500 V900 H0Z" fill="${kind === 'night' ? '#18301f' : '#4f7a3a'}"/><path d="M0 680 C300 640 520 700 800 660 C1100 620 1300 690 1600 650 V900 H0Z" fill="${kind === 'night' ? '#10220f' : '#6f9a4a'}"/></svg>`);
  return `url("data:image/svg+xml,${hills}") center/100% 100% no-repeat, linear-gradient(180deg, ${sky})`;
}

// --------------------------------------------------------------------------------------- превключване
type ViewKey = string;
const VIEWS: ViewKey[] = ['start', 'hud', 'dialogue', 'inventory', 'map', 'chronicle', 'chronicle-empty', 'time', 'away', 'settings', 'live', 'death', 'banner', 'loading', 'confirm', 'pause', 'icons'];

const clean = location.hash.includes('clean') || location.search.includes('clean');
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;z-index:1000;left:50%;bottom:0;transform:translateX(-50%);display:flex;gap:4px;flex-wrap:wrap;justify-content:center;padding:4px;background:rgba(0,0,0,.6);border-radius:8px 8px 0 0;font:12px sans-serif';
for (const v of VIEWS) {
  const b = document.createElement('button');
  b.textContent = v; b.style.cssText = 'cursor:pointer;padding:2px 6px';
  b.onclick = () => { location.hash = v; };
  bar.append(b);
}
if (!clean) document.body.append(bar);

let raf = 0;
let iconsEl: HTMLElement | null = null;

function hideAll(): void {
  cancelAnimationFrame(raf);
  const u = ui as unknown as Record<string, { hide?: () => void }>;
  for (const k of Object.keys(u)) if (k !== 'root' && k !== 'hud' && k !== 'tags') u[k]?.hide?.();
  ui.hud.hide(); ui.tags.update([]);
  ui.hud.boss(null); ui.hud.prompt(null); ui.hud.setPaused(false);
  iconsEl?.remove(); iconsEl = null;
  scene.style.background = sceneBg('day');
}

function showHud(): void {
  ui.hud.show();
  ui.hud.update(M.hudData());
  ui.hud.minimap(4, 46, 0.6, [{ x: -150, z: -60, kind: 'quest' }], [{ x: -10, z: 30 }]);
}

function route(): void {
  const key = (location.hash.slice(1).split('&')[0] || 'hud') as ViewKey;
  hideAll();
  switch (key) {
    case 'start':
      scene.style.background = sceneBg('dusk');
      ui.start.show({ hasSave: true, saveLabel: 'Ден 4 · 18:20 — Самодивско', ai: { connected: false, label: 'ИИ: няма връзка — жителите говорят по сценарий' }, version: 'в0.1' });
      break;
    case 'hud': {
      showHud();
      ui.hud.prompt('Говори с баба Гена');
      ui.hud.boss({ name: 'Ламята', phase: 'Фаза 2 — огнен дъх', heads: [{ hp: 0, max: 400, name: 'Лява глава' }, { hp: 260, max: 400, name: 'Средна глава' }, { hp: 390, max: 400, name: 'Дясна глава' }] });
      ui.hud.toast('Нова задача: „Три стръка росен“', 'quest', 60000);
      ui.hud.toast('Взе росен ×1', 'item', 60000);
      ui.hud.toast('Стигна ниво 7!', 'level', 60000);
      ui.hud.toast('Таласъмите излизат по здрач.', 'warn', 60000);
      let t = 0;
      const villagers = VILLAGER_IDS.map((id, i) => ({ id, a: i * 0.9 }));
      const loop = () => {
        t += 0.016;
        const px = 4 + Math.sin(t * 0.3) * 8, pz = 46 + Math.cos(t * 0.3) * 6;
        ui.hud.minimap(px, pz, t * 0.6, [{ x: -150, z: -60, kind: 'quest' }, { x: 150, z: -168, kind: 'boss' }, { x: 31, z: 43, kind: 'place' }],
          villagers.map((v) => ({ x: VILLAGERS[v.id].id === 'gena' ? -40 : Math.cos(v.a + t * 0.1) * 30, z: 40 + Math.sin(v.a + t * 0.1) * 25, color: '#f3ead7' })));
        const W = innerWidth, H = innerHeight;
        ui.tags.update([
          { id: 'gena', name: 'баба Гена', job: 'билкарка', x: W * 0.36, y: H * 0.5, dist: 7, visible: true, bubble: { text: 'Чедо, росенът расте там, дето слънцето не стига.', ai: true } },
          { id: 'ivan', name: 'Иван', job: 'ковач', x: W * 0.6, y: H * 0.47, dist: 14, visible: true, bubble: { text: 'Мария, ела довечера на мегдана.' } },
          { id: 'radka', name: 'Радка', job: 'стопанка на хана', x: W * 0.72, y: H * 0.52, dist: 25, visible: true },
          { id: 'petko', name: 'Петко', job: 'овчар', x: W * 0.2, y: H * 0.55, dist: 33, visible: true },
        ]);
        raf = requestAnimationFrame(loop);
      };
      loop();
      if (location.hash.includes('paused')) ui.hud.setPaused(true);
      if (location.hash.includes('dmg')) setTimeout(() => ui.hud.flashDamage(1), 300);
      break;
    }
    case 'dialogue':
      showHud();
      ui.dialogue.open({ id: 'gena', name: 'баба Гена', job: 'билкарка', mood: 'весела' });
      ui.dialogue.say('Ей го на, странникът! Чедо, ако ми донесеш три стръка росен от Тъмната гора, ще ти кажа къде спи Ламята.', { ai: false });
      ui.dialogue.say('Ама внимавай — по здрач там излизат таласъми. Кой каквото прави, на себе си го прави.', { ai: true, mood: 'загрижена' });
      ui.dialogue.setOptions([{ id: 'yes', text: 'Ще ги донеса, бабо.' }, { id: 'where', text: 'Къде точно расте росенът?' }, { id: 'lamia', text: 'Какво знаеш за Ламята?' }, { id: 'bye', text: 'Довиждане.' }]);
      ui.dialogue.onOption = (id) => { ui.dialogue.setThinking(true); setTimeout(() => ui.dialogue.say(`(Отговор на „${id}“) Хайде, чедо, върви с късмет.`, { ai: true }), 1200); };
      ui.dialogue.onFreeText = (t) => { ui.dialogue.setThinking(true); setTimeout(() => ui.dialogue.say(`„${t}“? Хм, чудни работи питаш.`, { ai: false }), 1200); };
      if (location.hash.includes('thinking')) ui.dialogue.setThinking(true);
      break;
    default:
      showExtra(ui, key, sceneBg, scene, (el) => { iconsEl = el; }, base);
  }
}
addEventListener('hashchange', route);
route();
void DEFAULT_AI;
