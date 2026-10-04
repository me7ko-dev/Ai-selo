// Проби за мозъка на жителите: сценарий (детерминиран, български), готови отговори, опашка, Ollama (фалшив сървър).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { VILLAGERS, VILLAGER_IDS, type VillagerId } from '../src/data/villagers';
import { ScriptedBrain, TALK_OPTION_IDS } from '../src/sim/brain/ScriptedBrain';
import { dialogueOptions } from '../src/sim/brain/options';
import { OllamaBrain, connectedLabel } from '../src/sim/brain/OllamaBrain';
import { BrainQueue, PRIORITY } from '../src/sim/brain/queue';
import { createBrain } from '../src/sim/brain/index';
import { cleanLine } from '../src/sim/brain/validate';
import type { Persona, TalkRequest, ChatRequest, AiSettings } from '../src/sim/brain/Brain';
import type { Memory } from '../src/sim/types';

const persona = (id: VillagerId, mood = 'спокоен'): Persona => {
  const v = VILLAGERS[id];
  return { id, name: v.name, job: v.job, card: v.card, speech: v.speech, mood, beliefs: [], secret: v.secret };
};
const MEM: Memory[] = [
  { id: 1, time: 1440 * 2 + 600, text: 'Петко се скара с Иван за козите.', importance: 6, about: ['petko', 'ivan'], kind: 'event' },
  { id: 2, time: 1440 * 2 + 700, text: 'Казват, че Мария крие писма в стана.', importance: 5, about: ['maria'], kind: 'rumor' },
  { id: 3, time: 1440 * 2 + 800, text: 'Странникът ми помогна да нося вода.', importance: 7, about: ['player'], kind: 'player' },
];
const SITS = ['Ден 3, 08:20, на мегдана. Вали. Реката е суха.', 'Ден 5, 22:40, край хана. Ясно. Реката е суха.', 'Ден 9, 14:00. Слънчево. Ламята е победена, реката тече. Сбор.'];
const RELS = [{ affinity: -60, trust: -60 }, { affinity: 0, trust: 0 }, { affinity: 40, trust: 50 }, { affinity: 80, trust: 85 }];

function talkReq(id: VillagerId, opts: Partial<TalkRequest> = {}): TalkRequest {
  return {
    speaker: persona(id),
    partner: { id: 'player', name: 'Стоян', isPlayer: true, relation: { affinity: 10, trust: 10 } },
    situation: SITS[0], memories: MEM, history: [], input: '', seed: 1, ...opts,
  };
}

function assertGood(text: string, where: string) {
  assert.equal(typeof text, 'string', where);
  assert.ok(text.trim().length > 0, `празно: ${where}`);
  assert.ok(/[а-я]/i.test(text), `няма кирилица: ${where}: ${text}`);
  assert.ok(!/undefined|NaN|\{|\}|\[|\]|<|>/.test(text), `шаблонът не е попълнен: ${where}: ${text}`);
  const letters = text.match(/[a-zа-яё]/gi) ?? [];
  const latin = text.match(/[a-z]/gi) ?? [];
  assert.ok(latin.length / Math.max(1, letters.length) < 0.05, `латиница: ${where}: ${text}`);
}

const brain = new ScriptedBrain();
const CHAT_TOPICS = ['weather', 'river', 'gossip', 'love', 'quarrel', 'work', 'stranger', 'lamia', 'election', 'festival', 'fear', 'greeting'];

test('ScriptedBrain: всички жители × всички готови отговори — детерминирано, на български', () => {
  for (const id of VILLAGER_IDS) {
    for (const opt of TALK_OPTION_IDS) {
      for (let s = 0; s < SITS.length; s++) {
        for (const rel of RELS) {
          const req = talkReq(id, { optionId: opt, input: opt, situation: SITS[s], seed: 100 + s, partner: { id: 'player', name: 'Стоян', isPlayer: true, relation: rel } });
          const a = brain.talkNow(req), b = brain.talkNow(structuredClone(req));
          assert.deepEqual(a, b, `не е детерминирано: ${id}/${opt}`);
          assert.equal(a.ai, false);
          assertGood(a.say, `${id}/${opt}`);
          if (a.remember) assertGood(a.remember, `${id}/${opt}/remember`);
          if (a.mood) assertGood(a.mood, `${id}/${opt}/mood`);
          if (opt === 'bye') assert.equal(a.action, 'end');
        }
      }
    }
  }
});

test('ScriptedBrain: различни семена дават разнообразие и не повтаря реплика от историята', () => {
  for (const id of VILLAGER_IDS) {
    const seen = new Set<string>();
    for (let s = 0; s < 30; s++) seen.add(brain.talkNow(talkReq(id, { optionId: 'news', seed: s })).say);
    assert.ok(seen.size >= 4, `${id}: само ${seen.size} различни новини`);
    // история: казаното не се повтаря
    const history: { who: string; text: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const r = brain.talkNow(talkReq(id, { optionId: 'self', seed: 5, history: [...history] }));
      assert.ok(!history.some((h) => h.text === r.say), `${id}: повтори „${r.say}“`);
      history.push({ who: id, text: r.say });
    }
  }
});

test('ScriptedBrain: свободен текст — разпознава темата', () => {
  const r1 = brain.talkNow(talkReq('radka', { input: 'Кой краде кокошките?' }));
  assert.match(r1.say, /кокош/i);
  assert.ok(r1.remember && /кокош/.test(r1.remember));
  const r2 = brain.talkNow(talkReq('peyu', { input: 'Какво стана с реката?' }));
  assert.match(r2.say, /Бистриц|река|вода|нив|чешм|кладен|корит/i);
  const r3 = brain.talkNow(talkReq('ivan', { input: 'Какво мислиш за Мария?' }));
  assert.match(r3.say, /Мари/);
  const r4 = brain.talkNow(talkReq('petko', { input: 'Ти си глупак!' }));
  assert.equal(r4.mood, 'обиден');
  assert.ok(r4.remember && /обиди/.test(r4.remember));
  const r5 = brain.talkNow(talkReq('maria', { input: 'Ти си глупачка!' }));
  assert.equal(r5.mood, 'обидена');
  const r6 = brain.talkNow(talkReq('gena', { input: 'Сбогом, бабо!' }));
  assert.equal(r6.action, 'end');
  const r7 = brain.talkNow(talkReq('gena', { input: 'Къде расте росенът?' }));
  assert.match(r7.say, /росен/i);
  const r8 = brain.talkNow(talkReq('kalin', { input: 'Колко е часът в далечния град?' }));
  assertGood(r8.say, 'непознато');
  const r9 = brain.talkNow(talkReq('gena', { input: 'Разкажи ми за Ламята' }));
  assert.match(r9.say, /Лам/);
});

test('ScriptedBrain: тайната — само при голямо доверие', () => {
  const low = brain.talkNow(talkReq('peyu', { optionId: 'secret', partner: { id: 'player', name: 'Стоян', isPlayer: true, relation: { affinity: 0, trust: 0 } } }));
  assert.ok(!/Радка|дълг|дължа/.test(low.say), low.say);
  const high = brain.talkNow(talkReq('peyu', { optionId: 'secret', partner: { id: 'player', name: 'Стоян', isPlayer: true, relation: { affinity: 70, trust: 90 } } }));
  assert.match(high.say, /Радка|дълг|Дълж/);
});

test('ScriptedBrain: разговори между жители — всички теми, детерминирани', () => {
  for (const a of VILLAGER_IDS) for (const b of VILLAGER_IDS) {
    if (a === b) continue;
    for (const topic of CHAT_TOPICS) {
      const req: ChatRequest = {
        a: persona(a), b: persona(b), topic, situation: SITS[(a.length + b.length) % 3], memoriesA: MEM, memoriesB: MEM,
        relationAB: VILLAGERS[a].relations[b] ?? { affinity: 0, trust: 0 }, relationBA: VILLAGERS[b].relations[a] ?? { affinity: 0, trust: 0 },
        rumor: topic === 'gossip' ? 'Казват, че кметът дължи пари.' : undefined, seed: 42,
      };
      const r1 = brain.chatNow(req), r2 = brain.chatNow(structuredClone(req));
      assert.deepEqual(r1, r2, `${a}/${b}/${topic}`);
      assert.ok(r1.lines.length >= 2 && r1.lines.length <= 4, `${a}/${b}/${topic}: ${r1.lines.length} реплики`);
      for (const l of r1.lines) { assert.ok(l.who === a || l.who === b); assertGood(l.text, `${a}/${b}/${topic}`); }
      assertGood(r1.summary, `${a}/${b}/${topic}/summary`);
      assert.ok(typeof r1.affinityDelta === 'number' && r1.affinityDelta >= -10 && r1.affinityDelta <= 10);
    }
  }
  const love = brain.chatNow({ a: persona('ivan'), b: persona('maria'), topic: 'love', situation: SITS[1], memoriesA: [], memoriesB: [], relationAB: { affinity: 75, trust: 50 }, relationBA: { affinity: 35, trust: 40 }, seed: 3 });
  assert.match(love.summary, /Иван/);
  assert.ok((love.affinityDelta ?? 0) > 0);
  const q = brain.chatNow({ a: persona('petko'), b: persona('ivan'), topic: 'quarrel', situation: SITS[0], memoriesA: [], memoriesB: [], relationAB: { affinity: -45, trust: -40 }, relationBA: { affinity: -40, trust: -45 }, seed: 3 });
  assert.match(q.lines.map((l) => l.text).join(' ') + q.summary, /коз|нив|Петко|Иван/);
});

test('ScriptedBrain: реакции, планове, размисъл', () => {
  const events = ['storm', 'theft', 'karakondzhul', 'samodivi', 'sabor', 'Ламята е победена!', 'Бистрица пак тече!', 'Радка е новият кмет.', 'Странникът донесе росен на баба Гена.', 'Странникът обиди Петко.', 'нещо странно'];
  for (const id of VILLAGER_IDS) {
    for (const ev of events) {
      const req = { speaker: persona(id), event: ev, memories: MEM, situation: SITS[0], seed: 9 };
      const r = brain.reactNow(req);
      assert.deepEqual(r, brain.reactNow(structuredClone(req)));
      assertGood(r.say, `react ${id}/${ev}`);
    }
    for (const s of SITS) {
      const p = brain.planNow({ speaker: persona(id), situation: s, memories: MEM, seed: 4 });
      assertGood(p.plan, `plan ${id}`);
    }
    const rf = brain.reflectNow({ speaker: persona(id), memories: MEM, beliefs: ['Старо убеждение.', 'Реката е суха и това ме плаши.'], seed: 2 });
    assert.ok(rf.beliefs.length > 0 && rf.beliefs.length <= 5);
    for (const b of rf.beliefs) assertGood(b, `belief ${id}`);
  }
  const rf = brain.reflectNow({ speaker: persona('kalin'), memories: [{ id: 9, time: 3000, text: 'Странникът ми помогна и ме похвали.', importance: 8, about: ['player'], kind: 'player' }], beliefs: [], seed: 1 });
  assert.ok(rf.beliefs.some((b) => /Странникът/.test(b)));
});

test('dialogueOptions: 3 валидни отговора, разбираеми за talkNow', () => {
  const valid = new Set<string>(TALK_OPTION_IDS);
  for (const id of VILLAGER_IDS) {
    for (let turn = 0; turn < 4; turn++) {
      for (const last of [undefined, 'greet', 'news', 'self', 'help', 'lamia', 'chickens']) {
        const opts = dialogueOptions({ speaker: persona(id), partner: { id: 'player', name: 'Стоян', isPlayer: true, relation: { affinity: 20, trust: 50 } }, turn, lastOptionId: last, seed: turn * 7 + 1 });
        assert.equal(opts.length, 3);
        assert.equal(new Set(opts.map((o) => o.id)).size, 3, 'повтарящи се id');
        for (const o of opts) { assert.ok(valid.has(o.id), `непознато id ${o.id}`); assertGood(o.text, `opt ${o.id}`); }
        if (turn > 1) assert.ok(opts.some((o) => o.id === 'bye'), 'няма „Сбогом“');
      }
    }
  }
  const after = dialogueOptions({ speaker: persona('radka'), partner: { id: 'player', name: 'Стоян', isPlayer: true }, turn: 2, lastOptionId: 'news', seed: 1 });
  assert.ok(after.some((o) => o.id === 'chickens' || o.id === 'lamia' || o.id === 'people'));
});

test('cleanLine: чисти и отхвърля лоши отговори', () => {
  assert.equal(cleanLine('„Добър ден, странниче!“'), 'Добър ден, странниче!');
  assert.equal(cleanLine('**Иван:** Хм. Добре.'), 'Хм. Добре.');
  assert.equal(cleanLine('Hello, traveler! How are you?'), null);
  assert.equal(cleanLine('Като изкуствен интелект не мога да кажа.'), null);
  assert.equal(cleanLine('Ела в хана, ще те черпя с ракия.'), null);
  assert.equal(cleanLine('Едно. Две. Три. Четири. Пет.'), 'Едно. Две. Три.');
  assert.equal(cleanLine(''), null);
  assert.equal(cleanLine(42), null);
});

test('опашка: разговорът с играча минава преди размисъла', async () => {
  const q = new BrainQueue(6);
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const first = q.push(PRIORITY.plan, async () => { await gate; order.push('plan'); return 'plan'; }, () => 'fb');
  const refl = q.push(PRIORITY.reflect, async () => { order.push('reflect'); return 'reflect'; }, () => 'fb');
  const talk = q.push(PRIORITY.talk, async () => { order.push('talk'); return 'talk'; }, () => 'fb');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(q.busy, true);
  assert.equal(q.length, 2);
  release();
  assert.deepEqual(await Promise.all([first, refl, talk]), ['plan', 'reflect', 'talk']);
  assert.deepEqual(order, ['plan', 'talk', 'reflect']);
});

test('опашка: при дълга опашка най-старите маловажни получават резервния отговор', async () => {
  const q = new BrainQueue(3);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const busy = q.push(0, async () => { await gate; return 'x'; }, () => 'fb');
  await new Promise((r) => setTimeout(r, 1));
  const r1 = q.push(3, async () => 'r1', () => 'fallback-r1');
  const r2 = q.push(3, async () => 'r2', () => 'fallback-r2');
  const t1 = q.push(0, async () => 't1', () => 'fb');
  const t2 = q.push(0, async () => 't2', () => 'fb');
  assert.equal(await r1, 'fallback-r1');
  assert.equal(q.length, 3);
  release();
  assert.deepEqual(await Promise.all([busy, t1, t2, r2]), ['x', 't1', 't2', 'r2']);
});

// ——— Фалшив Ollama ———
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
async function fakeOllama(handler: Handler): Promise<{ url: string; close: () => Promise<void>; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { calls.push(`${req.method} ${req.url}`); handler(req, body, res); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
const json = (res: ServerResponse, obj: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const chatContent = (content: string) => ({ model: 'qwen3.5:4b', message: { role: 'assistant', content }, done: true });
const tags = (names: string[]) => ({ models: names.map((n) => ({ name: n, model: n })) });
const settings = (url: string, extra: Partial<AiSettings> = {}): AiSettings => ({ enabled: true, url, model: 'qwen3.5:4b', timeoutMs: 2000, ...extra });

test('Ollama: свързан, валиден отговор → ai:true', async () => {
  let lastBody: Record<string, unknown> = {};
  const srv = await fakeOllama((req, body, res) => {
    if (req.url === '/api/tags') return json(res, tags(['qwen3.5:4b', 'gemma4:e2b']));
    lastBody = JSON.parse(body);
    json(res, chatContent(JSON.stringify({ say: 'Добро утро, странниче! Ела, ела.', action: 'none', mood: 'весела', remember: 'Странникът дойде при мен сутринта.' })));
  });
  const ob = new OllamaBrain(settings(srv.url), new ScriptedBrain());
  const statuses: string[] = [];
  const off = ob.onStatus((s) => statuses.push(s.label));
  const st = await ob.connect();
  assert.equal(st.connected, true);
  assert.equal(st.label, connectedLabel('qwen3.5:4b'));
  assert.equal(st.label, 'ИИ: свързан (qwen3.5:4b)');
  assert.ok(statuses.includes('ИИ: свързан (qwen3.5:4b)'));
  const r = await ob.talk(talkReq('gena', { optionId: 'greet', input: 'Здравей' }));
  assert.equal(r.ai, true);
  assert.equal(r.say, 'Добро утро, странниче! Ела, ела.');
  assert.equal(r.mood, 'весела');
  assert.equal(lastBody.stream, false);
  assert.equal(lastBody.think, false);
  assert.equal(lastBody.keep_alive, '30m');
  assert.deepEqual(lastBody.options, { num_ctx: 4096, temperature: 0.8 });
  assert.equal((lastBody.messages as unknown[]).length, 2);
  assert.equal(typeof lastBody.format, 'object');
  off(); ob.dispose(); await srv.close();
});

test('Ollama: моделът с „:latest“ се разпознава', async () => {
  const srv = await fakeOllama((req, _b, res) => json(res, tags(['llama3.2:latest'])));
  const ob = new OllamaBrain(settings(srv.url, { model: 'llama3.2' }), new ScriptedBrain());
  assert.equal((await ob.connect()).connected, true);
  ob.dispose(); await srv.close();
});

test('Ollama: лош JSON / английски / „като ИИ“ → резерв по сценарий (ai:false)', async () => {
  const answers = ['това не е json', JSON.stringify({ say: 'Hello traveler, welcome to the village!', action: 'none', mood: 'happy', remember: '' }), JSON.stringify({ say: 'Като езиков модел не мога да отговоря.', action: 'none', mood: 'спокоен', remember: '' })];
  let i = 0;
  const srv = await fakeOllama((req, _b, res) => {
    if (req.url === '/api/tags') return json(res, tags(['qwen3.5:4b']));
    json(res, chatContent(answers[i++ % answers.length]));
  });
  const sb = new ScriptedBrain();
  const ob = new OllamaBrain(settings(srv.url), sb);
  await ob.connect();
  for (let k = 0; k < 3; k++) {
    const req = talkReq('radka', { optionId: 'news', seed: k });
    const r = await ob.talk(req);
    assert.equal(r.ai, false, `отговор ${k}`);
    assert.deepEqual(r, sb.talkNow(req));
  }
  // чат с невалидни реплики → резерв
  const chatReq: ChatRequest = { a: persona('ivan'), b: persona('maria'), topic: 'love', situation: SITS[0], memoriesA: [], memoriesB: [], relationAB: { affinity: 70, trust: 50 }, relationBA: { affinity: 30, trust: 40 }, seed: 1 };
  const cr = await ob.chat(chatReq);
  assert.equal(cr.ai, false);
  ob.dispose(); await srv.close();
});

test('Ollama: бавен сървър → изтичане → резерв', async () => {
  const srv = await fakeOllama((req, _b, res) => {
    if (req.url === '/api/tags') return json(res, tags(['qwen3.5:4b']));
    setTimeout(() => { try { json(res, chatContent(JSON.stringify({ say: 'Късно е.', action: 'none', mood: 'спокоен', remember: '' }))); } catch { /* затворено */ } }, 1500);
  });
  const sb = new ScriptedBrain();
  const ob = new OllamaBrain(settings(srv.url, { timeoutMs: 150 }), sb);
  await ob.connect();
  const req = talkReq('ivan', { optionId: 'self' });
  const t0 = Date.now();
  const r = await ob.talk(req);
  assert.ok(Date.now() - t0 < 1200, 'не изчака изтичането');
  assert.equal(r.ai, false);
  assert.deepEqual(r, sb.talkNow(req));
  assert.equal(ob.status().connected, true, 'изтичането не бива да разкача');
  ob.dispose(); await srv.close();
});

test('Ollama: липсващ модел → причина с „ollama pull“', async () => {
  const srv = await fakeOllama((req, _b, res) => json(res, tags(['gemma3:4b'])));
  const ob = new OllamaBrain(settings(srv.url), new ScriptedBrain());
  const st = await ob.connect();
  assert.equal(st.connected, false);
  assert.equal(st.label, 'ИИ: няма връзка — жителите говорят по сценарий');
  assert.match(st.reason ?? '', /ollama pull qwen3\.5:4b/);
  const r = await ob.talk(talkReq('gena', { optionId: 'greet' }));
  assert.equal(r.ai, false);
  ob.dispose(); await srv.close();
});

test('Ollama: не работи → причина „Ollama не отговаря“; изключен → „ИИ е изключен“', async () => {
  const srv = await fakeOllama((_r, _b, res) => json(res, {}));
  const url = srv.url;
  await srv.close();
  const ob = new OllamaBrain(settings(url), new ScriptedBrain());
  const st = await ob.connect();
  assert.equal(st.connected, false);
  assert.match(st.reason ?? '', /Ollama не отговаря/);
  ob.dispose();
  const h = createBrain(settings(url, { enabled: false }));
  const st2 = await h.connect();
  assert.equal(st2.connected, false);
  assert.equal(st2.reason, 'ИИ е изключен от настройките.');
  const r = await h.brain.talk(talkReq('maria', { optionId: 'greet' }));
  assert.equal(r.ai, false);
  assert.deepEqual(r, h.scripted.talkNow(talkReq('maria', { optionId: 'greet' })));
  h.ollama?.dispose();
});

test('Ollama: https страница + http адрес → обяснение, без заявка', async () => {
  const srv = await fakeOllama((_r, _b, res) => json(res, tags(['qwen3.5:4b'])));
  const g = globalThis as { location?: unknown };
  const had = 'location' in g;
  const old = g.location;
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'https:' }, configurable: true, writable: true });
  try {
    const ob = new OllamaBrain(settings(srv.url), new ScriptedBrain());
    const st = await ob.connect();
    assert.equal(st.connected, false);
    assert.match(st.reason ?? '', /GitHub Pages/);
    assert.equal(srv.calls.length, 0);
    ob.dispose();
  } finally {
    if (had) Object.defineProperty(globalThis, 'location', { value: old, configurable: true, writable: true });
    else delete g.location;
    await srv.close();
  }
});

test('Ollama: чат, план, размисъл с валиден ИИ', async () => {
  const srv = await fakeOllama((req, body, res) => {
    if (req.url === '/api/tags') return json(res, tags(['qwen3.5:4b']));
    const b = JSON.parse(body) as { format: { properties: Record<string, unknown> } };
    const props = Object.keys(b.format.properties);
    if (props.includes('lines')) return json(res, chatContent(JSON.stringify({ lines: [{ who: 'ivan', text: 'Хм. Хубава шевица.' }, { who: 'maria', text: 'Благодаря ти, Иване!' }], summary: 'Иван похвали шевицата на Мария.', affinityDelta: 4 })));
    if (props.includes('plan')) return json(res, chatContent(JSON.stringify({ plan: 'Днес ще кова подкови.' })));
    if (props.includes('beliefs')) return json(res, chatContent(JSON.stringify({ beliefs: ['Странникът е добър човек.', 'Мария ми се усмихна.'] })));
    json(res, chatContent(JSON.stringify({ say: 'Буря! Прибирайте се!', mood: 'уплашен', remember: 'Имаше буря.' })));
  });
  const ob = new OllamaBrain(settings(srv.url), new ScriptedBrain());
  await ob.connect();
  const c = await ob.chat({ a: persona('ivan'), b: persona('maria'), topic: 'love', situation: SITS[0], memoriesA: [], memoriesB: [], relationAB: { affinity: 70, trust: 50 }, relationBA: { affinity: 30, trust: 40 }, seed: 1 });
  assert.equal(c.ai, true); assert.equal(c.lines.length, 2); assert.equal(c.affinityDelta, 4);
  const p = await ob.plan({ speaker: persona('ivan'), situation: SITS[0], memories: [], seed: 1 });
  assert.deepEqual(p, { plan: 'Днес ще кова подкови.', ai: true });
  const rf = await ob.reflect({ speaker: persona('ivan'), memories: MEM, beliefs: [], seed: 1 });
  assert.equal(rf.ai, true); assert.equal(rf.beliefs.length, 2);
  const re = await ob.react({ speaker: persona('ivan'), event: 'storm', memories: [], situation: SITS[0], seed: 1 });
  assert.equal(re.ai, true); assert.equal(re.mood, 'уплашен');
  ob.dispose(); await srv.close();
});
