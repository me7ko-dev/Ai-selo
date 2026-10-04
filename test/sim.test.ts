// Проби за живото село: графици, летопис, повторимост, клонове на историята, „Докато те нямаше…“, избори, подсказки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VillageSim } from '../src/sim/VillageSim';
import { Timeline, MemorySnapshotStore } from '../src/sim/timeline';
import { catchUp, catchUpAsync, pickCards, AWAY_AI_CARDS } from '../src/sim/away';
import type { Brain, RetellRequest } from '../src/sim/brain/Brain';
import { ScriptedBrain } from '../src/sim/brain/ScriptedBrain';
import { PLACES, dist } from '../src/data/layout';
import { BONFIRE } from '../src/sim/schedules';
import { VILLAGERS, VILLAGER_IDS } from '../src/data/villagers';
import type { ChronicleEntry, SnapshotMeta, WorldState } from '../src/sim/types';

function hasNaN(x: unknown): boolean {
  if (typeof x === 'number') return !Number.isFinite(x);
  if (Array.isArray(x)) return x.some(hasNaN);
  if (x && typeof x === 'object') return Object.values(x).some(hasNaN);
  return false;
}
const cyr = /[а-яА-Я]/;

test('3 игрови дни: случки от различни видове, жителите се движат и спят у дома', () => {
  const sim = new VillageSim({ seed: 2024, brain: new ScriptedBrain() });
  const log: ChronicleEntry[] = [];
  let says = 0, hours = 0, days = 0;
  sim.bus.on('chronicle', e => log.push(e));
  sim.bus.on('say', () => says++);
  sim.bus.on('hour', () => hours++);
  sim.bus.on('day', () => days++);
  const start = Object.fromEntries(sim.state.villagers.map(v => [v.id, { ...v.pos }]));
  let moved = new Set<string>();
  const end = sim.state.time + 3 * 1440;
  while (sim.state.time < end) {
    sim.advance(0.5);
    // нощем (02:00) — всички спят у дома
    if (Math.abs((sim.state.time % 1440) - 120) < 0.25) {
      for (const v of sim.state.villagers) {
        assert.equal(v.activity, 'sleep', `${v.id} не спи в 02:00, а ${v.activity}`);
        assert.ok(dist(v.pos, PLACES[VILLAGERS[v.id].home].pos) < 1, `${v.id} не е у дома нощем`);
      }
    }
    for (const v of sim.state.villagers) if (dist(v.pos, start[v.id]) > 5) moved.add(v.id);
  }
  assert.equal(moved.size, VILLAGER_IDS.length, 'всички жители трябва да са се движили');
  const types = new Set(log.map(e => e.type));
  assert.ok(types.size >= 4, `видове случки: ${[...types]}`);
  assert.ok(log.length >= 20, `случки: ${log.length}`);
  for (const e of log) { assert.ok(cyr.test(e.text), e.text); assert.ok(e.importance >= 1 && e.importance <= 10); assert.equal(e.branchId, 'main'); }
  assert.ok(says > 30, `балончета: ${says}`);
  assert.equal(hours, 72); assert.equal(days, 3);
  assert.ok(!hasNaN(sim.state), 'няма NaN');
  for (const v of sim.state.villagers) {
    assert.ok(v.memories.length > 0 && v.memories.length <= 70);
    assert.ok(v.beliefs.length <= 5);
    assert.ok(cyr.test(v.mood));
  }
});

test('повторимост: от запис светът продължава еднакво', () => {
  const a = new VillageSim({ seed: 77 });
  a.advance(12 * 60 - 390); // Ден 1, 12:00
  assert.equal(a.state.time, 720);
  const snap: WorldState = a.snapshot();
  const steps = [0.004, 0.37, 1, 5, 60, 0.25, 33.3, 100, 200.096, 199.98];
  for (const s of steps) a.advance(s);
  const b = new VillageSim({ seed: 1 });
  b.load(snap);
  for (const s of steps) b.advance(s);
  assert.equal(JSON.stringify(b.state), JSON.stringify(a.state));
  assert.ok(Math.abs(a.state.time - (720 + steps.reduce((x, y) => x + y, 0))) < 1e-6);
  // и конструкторът със state
  const c = new VillageSim({ state: snap });
  for (const s of steps) c.advance(s);
  assert.equal(JSON.stringify(c.state), JSON.stringify(a.state));
});

test('машината на времето: клон от минал момент', async () => {
  const tl = Timeline.create();
  assert.equal(tl.currentBranch, 'main');
  assert.equal(tl.branches()[0].label, 'Основна история');
  const sim = new VillageSim({ seed: 5 });
  const store = new MemorySnapshotStore();
  sim.bus.on('chronicle', e => tl.add(e));
  let deleted: string[] = [];
  let snapAtDay2: SnapshotMeta | undefined;
  for (let i = 0; i < 6 * 24; i++) {
    const prev = sim.state.time;
    sim.advance(60);
    for (const kind of tl.snapshotDue(prev, sim.state.time)) {
      const meta: SnapshotMeta = { id: `s${sim.state.branchId}-${sim.state.time}`, branchId: tl.currentBranch, time: sim.state.time, kind, label: '', realTime: 0 };
      await store.put(meta, sim.snapshot());
      const del = tl.registerSnapshot(meta);
      for (const id of del) await store.delete(id);
      deleted = deleted.concat(del);
      if (meta.time === 1440 + 600) snapAtDay2 = meta;
    }
  }
  assert.ok(deleted.length > 0, 'старите часови записи се трият');
  const metas = tl.snapshotsFor('main');
  assert.ok(metas.some(m => m.kind === 'day' && m.time < sim.state.time - 3 * 1440), 'дневните се пазят завинаги');
  assert.ok(!metas.some(m => m.kind === 'hour' && m.time < sim.state.time - 3 * 1440 - 60), 'старите часови ги няма');
  assert.equal((await store.list()).length, tl.snapshotsFor('main').length);

  // клон от Ден 4, 06:00
  const forkAt = 3 * 1440 + 360;
  const near = tl.nearestSnapshot('main', forkAt)!;
  assert.ok(near && near.time <= forkAt);
  const loaded = await store.get(near.id);
  assert.ok(loaded);
  const mainEntries = tl.entriesFor('main');
  const br = tl.fork(near.time);
  assert.equal(tl.currentBranch, br.id);
  assert.equal(br.parentId, 'main');
  const st = loaded!.state as WorldState;
  st.branchId = br.id;
  sim.load(st);
  sim.advance(1440); // цял ден: нощем може и нищо да не стане
  const forkEntries = tl.entriesFor(br.id);
  const parentBefore = mainEntries.filter(e => e.time <= near.time);
  const parentAfter = mainEntries.filter(e => e.time > near.time);
  for (const e of parentBefore) assert.ok(forkEntries.some(x => x.branchId === 'main' && x.id === e.id), 'има записите на родителя до разклонението');
  for (const e of parentAfter) assert.ok(!forkEntries.some(x => x.branchId === 'main' && x.id === e.id), 'няма записите на родителя след разклонението');
  assert.ok(forkEntries.some(e => e.branchId === br.id), 'клонът има свои записи');
  assert.equal(tl.entriesFor('main').length, mainEntries.length, 'основната история не се променя');
  for (let i = 1; i < forkEntries.length; i++) assert.ok(forkEntries[i - 1].time <= forkEntries[i].time);
  // сериализация
  const tl2 = new Timeline(JSON.parse(JSON.stringify(tl.data())));
  assert.equal(tl2.entriesFor(br.id).length, forkEntries.length);
  tl2.switchTo('main');
  assert.equal(tl2.currentBranch, 'main');
  assert.deepEqual(tl.snapshotDue(59, 61), ['hour']);
  assert.deepEqual(tl.snapshotDue(1439, 1441), ['day']);
  assert.deepEqual(tl.snapshotDue(61, 62), []);
});

test('„Докато те нямаше…“: до 6 картички, точно време, таван 2 дни', () => {
  const sim = new VillageSim({ seed: 9 });
  const brain = new ScriptedBrain();
  sim.setBrain(brain);
  const t0 = sim.state.time;
  assert.deepEqual(catchUp(sim, 10 * 1000), []); // 2,5 игрови минути — нищо
  assert.equal(sim.state.time, t0);
  const cards = catchUp(sim, 60 * 60 * 1000); // 1 реален час = 900 игрови минути
  assert.ok(Math.abs(sim.state.time - (t0 + 900)) < 1e-6);
  assert.ok(cards.length >= 1 && cards.length <= 6, `картички: ${cards.length}`);
  for (const c of cards) { assert.ok(cyr.test(c.title) && cyr.test(c.text)); }
  assert.equal(sim.brain, brain, 'мозъкът се връща');
  const t1 = sim.state.time;
  const many = catchUp(sim, 7 * 24 * 3600 * 1000); // седмица → таван 2 дни
  assert.ok(Math.abs(sim.state.time - (t1 + 2880)) < 1e-6);
  assert.ok(many.length <= 6 && many.length >= 4);
  const talks = many.filter(c => c.type === 'talk').length;
  assert.ok(talks <= 2, 'не само разговори');
  for (let i = 1; i < many.length; i++) assert.ok(many[i - 1].time <= many[i].time);
  assert.equal(pickCards([]).length, 0);
});

test('избори за кмет до Ден 10/11', () => {
  const sim = new VillageSim({ seed: 31337 });
  let el: { mayor: string; votes: Record<string, number> } | null = null;
  sim.bus.on('election', e => { el = e; });
  const log: ChronicleEntry[] = [];
  sim.bus.on('chronicle', e => log.push(e));
  while (!el && sim.state.time < 11 * 1440) sim.advance(30);
  assert.ok(el, 'изборите се състояха');
  const e = el as unknown as { mayor: string; votes: Record<string, number> };
  assert.equal(Object.values(e.votes).reduce((a, b) => a + b, 0), 7);
  assert.equal(sim.state.mayor, e.mayor);
  assert.equal(sim.state.nextElectionDay, 20);
  assert.ok(log.some(x => x.type === 'election' && x.importance >= 6));
});

test('подсказки: всеки жител казва нещо на български; Радка си признава, ако вярва на странника', () => {
  const sim = new VillageSim({ seed: 3 });
  for (const id of VILLAGER_IDS) for (const t of ['chickens', 'goats', 'lamia'] as const) {
    const s = sim.clueFor(id, t);
    assert.ok(s.length > 10 && cyr.test(s), `${id}/${t}: ${s}`);
  }
  const before = sim.clueFor('radka', 'chickens');
  assert.match(before, /Петко/);
  sim.adjustRelation('radka', 'player', 50, 60);
  const after = sim.clueFor('radka', 'chickens');
  assert.notEqual(after, before);
  assert.match(after, /лисица/);
  // Иван вини Петко; Гена дава вярна следа
  assert.match(sim.clueFor('ivan', 'chickens'), /Петко/);
  assert.match(sim.clueFor('gena', 'chickens'), /следи/);
  // след хванатата лисица
  sim.state.flags.fox_caught = true;
  assert.match(sim.clueFor('petko', 'chickens'), /[Зз]вяр/);
});

test('играчът: разговор, дела, случки отвън', async () => {
  const sim = new VillageSim({ seed: 8 });
  sim.advance(10 * 60);
  const v = sim.villager('maria');
  sim.setPlayer({ x: v.pos.x + 1, z: v.pos.z });
  const r0 = sim.beginTalk('maria');
  assert.ok(r0.say && r0.options.length > 0);
  assert.equal(sim.villager('maria').talkingWith, 'player');
  const pos = { ...sim.villager('maria').pos };
  sim.advance(5);
  assert.deepEqual(sim.villager('maria').pos, pos, 'стои, докато говори');
  const r1 = await sim.playerSay('maria', { optionId: r0.options[0].id, text: r0.options[0].text });
  assert.ok(r1.say.length > 0);
  sim.endTalk('maria');
  assert.equal(sim.villager('maria').talkingWith, null);
  const log: ChronicleEntry[] = [];
  sim.bus.on('chronicle', e => log.push(e));
  sim.recordDeed({ kind: 'helped', villager: 'kalin', text: 'Странникът помогна на Калин да пренесе греди.', importance: 5, affinity: 20, trust: 15, witnesses: ['gena'] });
  assert.ok(sim.villager('kalin').relations.player.affinity >= 25);
  assert.ok(sim.villager('gena').memories.some(m => m.kind === 'player'));
  for (const ev of [{ type: 'storm' }, { type: 'karakondzhul' }, { type: 'samodivi' }, { type: 'sabor', by: 'зрител' }, { type: 'theft' }, { type: 'custom', text: 'Над селото прелетя ято щъркели.' }] as const) sim.inject(ev);
  assert.ok(log.length >= 7);
  assert.equal(sim.state.weather, 'storm');
  sim.advance(30);
  assert.ok(sim.state.villagers.every(x => x.activity !== 'dance'));
  assert.ok(sim.situation('ivan').startsWith('Ден 1,'));
  assert.ok(sim.retrieveMemories('gena', ['player']).length <= 8);
  assert.equal(sim.persona('peyu').name, 'дядо Пею');
  assert.ok(!hasNaN(sim.state));
});

test('сборът: вечерта всички играят хоро около огъня', () => {
  const sim = new VillageSim({ seed: 4 });
  sim.inject({ type: 'sabor' });
  sim.advance(19 * 60 - sim.state.time); // 19:00
  const dancers = sim.state.villagers.filter(v => v.activity === 'dance');
  assert.ok(dancers.length >= 6, `танцуват: ${dancers.length}`);
  for (const d of dancers) assert.ok(Math.abs(dist(d.pos, BONFIRE) - 4.6) < 0.5);
});

test('бързина: 2 игрови дни за под 2 секунди', () => {
  const sim = new VillageSim({ seed: 42 });
  const t = performance.now();
  for (let i = 0; i < 2880; i += 2) sim.advance(2);
  const ms = performance.now() - t;
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});

test('ИИ мозък: допълнителни реплики, без да спира селото; старите отговори се изхвърлят след load', async () => {
  let chats = 0, talks = 0;
  const pending: (() => void)[] = [];
  type ChatReq = Parameters<ScriptedBrain['chat']>[0];
  type ChatRep = Awaited<ReturnType<ScriptedBrain['chat']>>;
  const fake = {
    status: () => ({ connected: true, model: 'проба', label: 'ИИ: свързан (проба)', busy: false, queue: 0 }),
    talk: async () => { talks++; return { say: 'Здравей от ИИ.', mood: 'весела', remember: 'Странникът ме заговори.', ai: true }; },
    chat: (req: ChatReq) => new Promise<ChatRep>(res => {
      chats++;
      pending.push(() => res({ lines: [{ who: req.a.id, text: 'ИИ реплика.' }, { who: req.b.id, text: 'ИИ отговор.' }], summary: `${req.a.name} и ${req.b.name} си говориха (ИИ).`, ai: true }));
    }),
    react: async () => ({ say: 'Ох (ИИ)!', ai: true }),
    plan: async () => ({ plan: 'план (ИИ)', ai: true }),
    reflect: async () => ({ beliefs: ['Убеждение от ИИ.'], ai: true }),
  };
  const sim = new VillageSim({ seed: 12 });
  sim.setBrain(fake);
  const aiSays: string[] = [], aiLog: ChronicleEntry[] = [];
  sim.bus.on('say', s => { if (s.ai) aiSays.push(s.text); });
  sim.bus.on('chronicle', e => { if (e.ai) aiLog.push(e); });
  sim.setPlayer({ ...PLACES.inn.pos });
  const t0 = sim.state.time;
  for (let i = 0; i < 900 && chats === 0; i++) sim.advance(1);
  assert.ok(chats > 0, 'ИИ разговор е поискан');
  assert.ok(sim.state.time > t0);
  pending.shift()!();
  await new Promise(r => setTimeout(r, 0));
  sim.advance(2);
  assert.ok(aiSays.includes('ИИ реплика.'), 'ИИ репликите се показват');
  assert.equal(aiLog.length, 1);
  // отговор, който пристига след load, се изхвърля
  for (let i = 0; i < 900 && pending.length === 0; i++) sim.advance(1);
  assert.ok(pending.length > 0);
  sim.load(sim.snapshot());
  const before = aiSays.length;
  pending.forEach(f => f());
  await new Promise(r => setTimeout(r, 0));
  sim.advance(2);
  assert.equal(aiSays.filter(t => t === 'ИИ реплика.').length, aiSays.slice(0, before).filter(t => t === 'ИИ реплика.').length);
  const r = await sim.playerSay('radka', { text: 'Как си?' });
  assert.equal(r.ai, true); assert.equal(talks, 1);
  assert.ok(sim.villager('radka').memories.some(m => m.text === 'Странникът ме заговори.'));
});

test('„Докато те нямаше…“ с ИИ: светът е същият, ИИ преразказва до 3 картички, таван на чакането', async () => {
  const sb = new ScriptedBrain();
  let asked: RetellRequest | null = null;
  const fake = (mode: 'ok' | 'hang' | 'off'): Brain => ({
    status: () => ({ ...sb.status(), connected: mode !== 'off' }),
    talk: r => sb.talk(r), chat: r => sb.chat(r), react: r => sb.react(r), plan: r => sb.plan(r), reflect: r => sb.reflect(r),
    retell: (req) => { asked = req; return mode === 'hang' ? new Promise(() => {}) : Promise.resolve({ texts: req.events.map((e, i) => `Разказвачът казва (${i + 1}): ${e.title}.`), ai: true }); },
  });
  const ref = new VillageSim({ seed: 77 });
  const refCards = catchUp(ref, 3 * 3600 * 1000);
  const sim = new VillageSim({ seed: 77 });
  const cards = await catchUpAsync(sim, 3 * 3600 * 1000, fake('ok'));
  assert.deepEqual(sim.snapshot(), ref.snapshot(), 'превъртането е детерминирано, както без ИИ');
  assert.equal(cards.length, refCards.length);
  const ai = cards.filter(c => c.ai);
  assert.equal(ai.length, Math.min(AWAY_AI_CARDS, cards.length));
  assert.equal(asked!.events.length, ai.length);
  for (const c of ai) assert.match(c.text, /^Разказвачът казва/);
  // избрани са най-важните
  const minAi = Math.min(...ai.map(c => c.score ?? 0)), maxRest = Math.max(-99, ...cards.filter(c => !c.ai).map(c => c.score ?? 0));
  assert.ok(minAi >= maxRest, 'ИИ преразказва най-важните картички');
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i - 1].time <= cards[i].time, 'редът по време се пази');
  // ИИ мълчи → след тавана остават картичките по сценарий
  const sim2 = new VillageSim({ seed: 77 });
  const t0 = Date.now();
  const c2 = await catchUpAsync(sim2, 3 * 3600 * 1000, fake('hang'), { timeoutMs: 60 });
  assert.ok(Date.now() - t0 < 3000);
  assert.deepEqual(c2.map(c => c.text), refCards.map(c => c.text));
  assert.ok(c2.every(c => !c.ai));
  // няма връзка → без ИИ
  const c3 = await catchUpAsync(new VillageSim({ seed: 77 }), 3 * 3600 * 1000, fake('off'));
  assert.ok(c3.every(c => !c.ai));
  // по подразбиране — мозъкът на симулацията; кратко отсъствие → нищо
  assert.deepEqual(await catchUpAsync(new VillageSim({ seed: 1, brain: fake('ok') }), 1000), []);
});
