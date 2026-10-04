// Проба на RPG частта: прост терен + Rpg + фалшив QuestHost (пише в конзолата).
// Клавиши: WASD/Shift/Space/мишка — герой; E — вземи; клик — заключи мишката;
// N — нощ (22:30), B — ден (10:00), T — таласъм отпред, L — при Ламята, K — убий Ламята,
// G — дай предмети, F — етап „пази кокошарника“, R — етап „росен“, H — лекувай, I — раницата в конзолата.
import { Engine } from '../engine/Engine';
import { createPlaceholderWorld } from '../world/placeholder';
import { simpleWorldQuery } from '../core/world-query';
import { formatDayClock, minuteOfDay, MINUTES_PER_DAY } from '../core/time';
import { VILLAGERS, type VillagerId } from '../data/villagers';
import { Rpg } from '../rpg/Rpg';
import type { QuestHost } from '../rpg/host';
import type { ItemId } from '../rpg/items';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const dbg = document.getElementById('dbg')!;
const logEl = document.getElementById('log')!;
const engine = new Engine(canvas);
createPlaceholderWorld(engine.scene);

let time = 10 * 60; // Ден 1, 10:00
let timeScale = 1;
const flags: Record<string, number | string | boolean> = {};
const lines: string[] = [];
const log = (s: string) => { lines.push(s); if (lines.length > 14) lines.shift(); logEl.textContent = lines.join('\n'); console.log('[rpg]', s); };

const host: QuestHost = {
  notify: (t, k) => log(`notify(${k ?? ''}): ${t}`),
  clue: (v, topic) => `(${VILLAGERS[v].short} за ${topic}) Чух, че нещо рижо минава нощем покрай кокошарника.`,
  deed: (d) => log(`deed: ${d.kind} ${d.villager ?? ''} — ${d.text}`),
  chronicle: (t, p, imp) => log(`летопис [${imp}]: ${t}`),
  relation: (a, b, da, dt) => log(`relation ${a}↔${b} ${da}/${dt}`),
  getFlag: (k) => flags[k],
  setFlag: (k, v) => { flags[k] = v; log(`flag ${k}=${v}`); },
  time: () => time,
  riverFlow: (on) => log(`river ${on}`),
  festival: (on) => log(`festival ${on}`),
  inject: (e) => log(`inject ${e.type}`),
  villagerName: (id) => VILLAGERS[id].name,
  sfx: () => {},
  waitUntil: (m) => { const cur = minuteOfDay(time); time += ((m - cur) + MINUTES_PER_DAY) % MINUTES_PER_DAY; },
};

const rpg = new Rpg(engine, simpleWorldQuery, host);
rpg.bus.on('notify', (n) => log(`» ${n.text}`));
rpg.bus.on('levelup', (e) => log(`НИВО ${e.level}`));
rpg.bus.on('quest', (q) => log(`задача ${q.title}: ${q.text}`));
rpg.bus.on('questDone', (q) => log(`ГОТОВО: ${q.title}`));
rpg.bus.on('boss', (b) => log(`boss active=${b.active} phase=${b.phase} heads=${b.heads.map(h => h.hp).join('/')}`));
rpg.bus.on('died', () => log('УМРЯ'));
rpg.bus.on('killed', (k) => log(`убит: ${k.kind}`));

const setTimeOfDay = (m: number) => { const cur = minuteOfDay(time); time += ((m - cur) + MINUTES_PER_DAY) % MINUTES_PER_DAY; };
const talk = (v: VillagerId) => { rpg.onTalk(v); const o = rpg.questOptions(v); console.log(v, o); return o; };
const choose = (v: VillagerId, id: string) => { const r = rpg.questChoose(v, id); console.log(r); return r; };
Object.assign(window as unknown as Record<string, unknown>, { rpg, engine, host, flags, talk, choose, setTimeOfDay, getTime: () => time, setTimeScale: (s: number) => { timeScale = s; } });

canvas.addEventListener('click', () => engine.input.lock());

engine.onUpdate((dt) => {
  const inp = engine.input;
  if (inp.pressedRaw('KeyN')) setTimeOfDay(22 * 60 + 30);
  if (inp.pressedRaw('KeyB')) setTimeOfDay(10 * 60);
  if (inp.pressedRaw('KeyT')) rpg.debug.spawnTalasam(7);
  if (inp.pressedRaw('KeyL')) rpg.debug.toLamia();
  if (inp.pressedRaw('KeyK')) rpg.debug.killBoss();
  if (inp.pressedRaw('KeyH')) rpg.debug.heal();
  if (inp.pressedRaw('KeyE')) rpg.interact();
  if (inp.pressedRaw('KeyI')) console.log(rpg.inventory());
  if (inp.pressedRaw('KeyG')) (['ivan_saber', 'bow', 'kalpak', 'gloves', 'martenitsa', 'rosen_potion', 'banitsa', 'tea'] as ItemId[]).forEach(id => rpg.debug.give(id, id === 'banitsa' ? 5 : 1));
  if (inp.pressedRaw('KeyR')) { rpg.quests.stages.rosen = 'collect'; }
  if (inp.pressedRaw('KeyF')) { rpg.quests.stages.chickens = 'watch'; rpg.teleport(40, 60); setTimeOfDay(22 * 60 + 10); }
  time += dt * 0.25 * timeScale;
  rpg.update(dt, time);
  const h = rpg.hud();
  const hint = rpg.interactHint();
  dbg.textContent = [
    `${formatDayClock(time)}   fps ${engine.fps.toFixed(0)}`,
    `Стоян · Ниво ${h.level} · ${h.title}   XP ${h.xp}/${h.xpNext}   грошове ${h.gold}`,
    `Живот ${h.hp}/${h.maxHp}   Сила ${h.stamina}/${h.maxStamina}${h.blocking ? '  [БЛОК]' : ''}${h.dead ? '  [МЪРТЪВ]' : ''}`,
    `Лента: ${h.hotbar.map((c, i) => `${i + 1}:${c ? c.name + '×' + c.count : '—'}`).join('  ')}`,
    h.boss ? `ЛАМЯТА фаза ${h.boss.phase}: ${h.boss.heads.map(x => `${x.hp}/${x.max}`).join(' | ')}` : '',
    hint ? `[E] ${hint.label}` : '',
    `x ${rpg.heroPos.x.toFixed(1)} z ${rpg.heroPos.z.toFixed(1)}`,
    ...rpg.questLog().map(q => `${q.done ? '✔' : '•'} ${q.title}: ${q.step}`),
    '',
    'N нощ · B ден · T таласъм · L Ламята · K убий я · G предмети · F лисица · R росен · H лек',
  ].filter(Boolean).join('\n');
});
engine.start();
