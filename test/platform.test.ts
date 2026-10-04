// Проби за платформата: Twitch чат, гласуване, настройки, записи (в паметта).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIrcLine, chatMessageFrom } from '../src/live/TwitchChat';
import { LiveVote, parseLiveCommand, liveAnnouncement, type LiveEventType, type VoteCounts } from '../src/live/LiveVote';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, mergeSettings, SETTINGS_KEY } from '../src/save/settings';
import { SaveManager, type MainSave } from '../src/save/SaveManager';
import { LiveSession } from '../src/live/LiveSession';
import type { SnapshotMeta } from '../src/sim/types';

test('parseIrcLine: PRIVMSG с тагове и display-name', () => {
  const raw = '@badge-info=;badges=broadcaster/1;color=#FF4500;display-name=Петьо_БГ;emotes=;id=abc-123;mod=0;room-id=1234;subscriber=0;tmi-sent-ts=1700000000000;turbo=0;user-id=5678;user-type= :petyo_bg!petyo_bg@petyo_bg.tmi.twitch.tv PRIVMSG #selo :!буря над селото\r\n';
  const l = parseIrcLine(raw)!;
  assert.equal(l.command, 'PRIVMSG');
  assert.equal(l.nick, 'petyo_bg');
  assert.deepEqual(l.params, ['#selo']);
  assert.equal(l.trailing, '!буря над селото');
  assert.equal(l.tags['display-name'], 'Петьо_БГ');
  assert.equal(l.tags['user-type'], '');
  assert.deepEqual(chatMessageFrom(l), { user: 'Петьо_БГ', text: '!буря над селото', color: '#FF4500' });
});

test('parseIrcLine: без display-name, екранирани тагове, PING, служебни редове', () => {
  const l = parseIrcLine('@display-name=;system-msg=hello\\sworld\\:x :gosho!gosho@gosho.tmi.twitch.tv PRIVMSG #selo :здрасти: как сте')!;
  assert.equal(l.tags['system-msg'], 'hello world;x');
  assert.deepEqual(chatMessageFrom(l), { user: 'gosho', text: 'здрасти: как сте' });
  const me = chatMessageFrom(parseIrcLine(':ivo!ivo@ivo.tmi.twitch.tv PRIVMSG #selo :\u0001ACTION танцува хоро\u0001'));
  assert.deepEqual(me, { user: 'ivo', text: 'танцува хоро' });
  const ping = parseIrcLine('PING :tmi.twitch.tv')!;
  assert.equal(ping.command, 'PING');
  assert.equal(ping.trailing, 'tmi.twitch.tv');
  const welcome = parseIrcLine(':tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!')!;
  assert.equal(welcome.command, '001');
  assert.equal(welcome.nick, '');
  assert.equal(chatMessageFrom(welcome), null);
  assert.equal(parseIrcLine(''), null);
  assert.equal(parseIrcLine('\r\n'), null);
});

test('команди: кирилица, латиница, главни букви, препинателни знаци', () => {
  assert.equal(parseLiveCommand('!караконджул'), 'karakondzhul');
  assert.equal(parseLiveCommand('!БУРЯ!!! сега'), 'storm');
  assert.equal(parseLiveCommand('  !Samodivi'), 'samodivi');
  assert.equal(parseLiveCommand('!sabor'), 'sabor');
  assert.equal(parseLiveCommand('!krazhba'), 'theft');
  assert.equal(parseLiveCommand('буря'), null);
  assert.equal(parseLiveCommand('!нещо'), null);
  assert.equal(liveAnnouncement('storm', 'Гошо'), 'Гошо извика буря над селото!');
});

test('гласуване: старт, един глас на зрител, резултат, почивка', () => {
  let t = 1_000_000;
  const results: { type: LiveEventType; by: string; counts: VoteCounts }[] = [];
  const v = new LiveVote({ now: () => t, voteSeconds: 30, cooldownSeconds: 20, onResult: (type, by, counts) => results.push({ type, by, counts }) });
  assert.equal(v.state().active, false);
  assert.equal(v.feed('Петьо', 'здравейте'), false);
  assert.equal(v.state().active, false);

  assert.equal(v.feed('Петьо', '!самодиви'), true);
  let s = v.state();
  assert.equal(s.active, true);
  assert.equal(s.endsAt, t + 30_000);
  assert.equal(s.options.length, 5);
  assert.deepEqual(s.options.map((o) => o.label), ['Караконджул', 'Самодиви', 'Буря', 'Сбор', 'Кражба']);
  assert.equal(s.options.find((o) => o.type === 'samodivi')!.votes, 1);

  t += 5000; v.feed('Гошо', '!burya');
  t += 1000; v.feed('Мими', '!буря');
  t += 1000; v.feed('мими', '!сбор');            // същият зрител (друг регистър) — последният глас важи
  t += 1000; v.feed('Иво', '!буря');
  t += 1000; v.feed('Иво', '!буря');              // повторен глас не се брои двойно
  s = v.state();
  assert.equal(s.total, 4);
  assert.equal(s.options.find((o) => o.type === 'storm')!.votes, 2);
  assert.equal(s.options.find((o) => o.type === 'sabor')!.votes, 1);
  assert.equal(s.secondsLeft, 21);

  t += 20_999; v.tick();
  assert.equal(results.length, 0);
  t += 1; v.tick();
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'storm');
  assert.equal(results[0].by, 'Гошо');           // първият, извикал бурята
  assert.deepEqual(results[0].counts, { karakondzhul: 0, samodivi: 1, storm: 2, sabor: 1, theft: 0 });
  s = v.state();
  assert.equal(s.active, false);
  assert.equal(s.last?.type, 'storm');
  assert.equal(s.last?.label, 'Буря');
  assert.equal(s.last?.text, 'Гошо извика буря над селото!');

  // почивка: командите се пренебрегват
  t += 10_000;
  assert.equal(v.feed('Петьо', '!кражба'), false);
  assert.equal(v.state().active, false);
  t += 10_000;
  assert.equal(v.feed('Петьо', '!krazhba'), true);
  assert.equal(v.state().active, true);
  // при равенство печели изборът на пусналия гласуването
  t += 1000; v.feed('Гошо', '!караконджул');
  t += 30_000;
  const s2 = v.state();                           // state() също приключва изтеклото гласуване
  assert.equal(s2.active, false);
  assert.equal(results.length, 2);
  assert.equal(results[1].type, 'theft');
  assert.equal(results[1].by, 'Петьо');
});

test('демо чатът пуска гласуване без Twitch', () => {
  let t = 0;
  let got = 0;
  const v = new LiveVote({ now: () => t, voteSeconds: 10, onResult: () => got++ });
  for (let i = 0; i < 200; i++) { v.demoStep(); t += 1200; }
  assert.ok(got >= 3, `резултати: ${got}`);
});

function mockStorage(): Map<string, string> {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
  return m;
}

test('настройки: по подразбиране, сливане, боклук', () => {
  const m = mockStorage();
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  m.set(SETTINGS_KEY, '{не е json');
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  m.set(SETTINGS_KEY, JSON.stringify({ audio: { music: 0.2, sfx: 'много' }, graphics: { quality: 'ultra', shadows: false }, live: { channel: '#MoyKanal', voteSeconds: 9999 }, ai: null, extra: 1 }));
  const s = loadSettings();
  assert.equal(s.audio.music, 0.2);
  assert.equal(s.audio.sfx, DEFAULT_SETTINGS.audio.sfx);
  assert.equal(s.graphics.quality, DEFAULT_SETTINGS.graphics.quality);
  assert.equal(s.graphics.shadows, false);
  assert.equal(s.live.channel, 'MoyKanal');
  assert.equal(s.live.voteSeconds, 300);
  assert.deepEqual(s.ai, DEFAULT_SETTINGS.ai);
  m.set(SETTINGS_KEY, '[1,2,3]');
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  const changed = mergeSettings({ controls: { sensitivity: 2, invertY: true } });
  saveSettings(changed);
  assert.deepEqual(loadSettings(), changed);
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS); // без localStorage — не гърми
  saveSettings(changed);
});

test('лайв сесия: гласуването става InjectedEvent', () => {
  let t = 0;
  const got: { e: unknown; text: string }[] = [];
  const live = new LiveSession({ channel: '', voteSeconds: 10, now: () => t, onEvent: (e, text) => got.push({ e, text }) });
  live.start();
  assert.equal(live.isDemo, true);
  assert.equal(live.state().statusLabel, 'Демо чат (без Twitch)');
  live.stop();                       // спира демо таймера, за да не държи Node жив
  live.vote.feed('Стамен', '!сбор');
  t += 10_000;
  live.tick();
  assert.deepEqual(got, [{ e: { type: 'sabor', by: 'Стамен' }, text: 'Стамен свика сбор на мегдана!' }]);
});

test('звук: без WebAudio (Node) нищо не гърми', async () => {
  const { Audio, SFX_NAMES } = await import('../src/audio/Sfx');
  const a = new Audio();
  a.unlock();
  assert.equal(a.unlocked, false);
  a.setVolumes({ master: 2, music: -1 });
  for (const n of SFX_NAMES) a.play(n);
  a.ambient('day', true); a.ambient('none', false);
  a.setMusic('festival'); a.setMusic('none');
  a.dispose();
  assert.equal(SFX_NAMES.length, 21);
});

const meta = (id: string, time: number): SnapshotMeta => ({ id, branchId: 'main', time, kind: 'hour', label: `Ден 1 · ${time}`, realTime: 1000 + time });

test('записи: без IndexedDB → в паметта; put/get/list/delete/износ/внос', async () => {
  const sm = await SaveManager.open();
  assert.equal(sm.memoryOnly, true);
  assert.equal(await sm.hasSave(), false);
  const main: MainSave = { version: 1, savedAt: 123, game: { hp: 10, bag: ['росен'] }, timeline: { branches: [] } };
  await sm.saveMain(main);
  assert.equal(await sm.hasSave(), true);
  assert.deepEqual(await sm.loadMain(), main);

  const st = { world: { time: 600 } };
  await sm.put(meta('b', 700), { world: { time: 700 } });
  await sm.put(meta('a', 600), st);
  st.world.time = 9; // промяна след записа не влияе на записаното
  assert.deepEqual((await sm.get('a'))!.state, { world: { time: 600 } });
  assert.deepEqual((await sm.list()).map((m) => m.id), ['a', 'b']);
  await sm.delete('b');
  assert.deepEqual((await sm.list()).map((m) => m.id), ['a']);
  assert.equal(await sm.get('b'), undefined);

  const blob = await sm.exportBlob();
  const json = JSON.parse(await blob.text());
  assert.equal(json.kind, 'balkanski-legendi-save');
  assert.equal(json.version, 1);
  assert.equal(json.snapshots.length, 1);

  const other = SaveManager.inMemory();
  await other.put(meta('x', 1), {});
  await other.importFile(blob);
  assert.deepEqual(await other.loadMain(), main);
  assert.deepEqual((await other.list()).map((m) => m.id), ['a']);

  await assert.rejects(other.importFile(new Blob(['нещо друго'])), /Балкански легенди/);
  await assert.rejects(other.importFile(new Blob([JSON.stringify({ kind: 'balkanski-legendi-save', version: 7, snapshots: [] })])), /версия/);
  await assert.rejects(other.importFile(new Blob([JSON.stringify({ kind: 'balkanski-legendi-save', version: 1, main: null, snapshots: [{ meta: {} }] })])), /повредени/);
  assert.deepEqual((await other.list()).map((m) => m.id), ['a']); // лош файл не трие нищо

  // чистене на старите часови записи (пазят се 3 игрови дни; дневните — завинаги)
  await other.put(meta('h-old', 100), {});
  await other.put({ ...meta('d-old', 50), kind: 'day' }, {});
  await other.put(meta('h-new', 4500), {});
  assert.equal(await other.pruneHourly(4500), 1);
  assert.deepEqual((await other.list()).map((m) => m.id), ['d-old', 'a', 'h-new']);

  await other.wipe();
  assert.equal(await other.hasSave(), false);
  assert.deepEqual(await other.list(), []);
});
