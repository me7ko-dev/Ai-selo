// Проби на RPG логиката: раница, нива, задачи, запис/зареждане (без three.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, INV_SIZE } from '../src/rpg/inventory';
import { Stats, xpToNext, mitigate } from '../src/rpg/stats';
import { Quests, type QuestCtx } from '../src/rpg/quests';
import { FogGrid } from '../src/rpg/fog';
import type { QuestHost } from '../src/rpg/host';
import type { ItemId } from '../src/rpg/items';
import type { VillagerId } from '../src/data/villagers';

function mockHost() {
  const flags: Record<string, number | string | boolean> = {};
  const log: string[] = [];
  const host: QuestHost = {
    notify: (t) => log.push('notify:' + t),
    clue: (v, topic) => `${v} мисли нещо за ${topic}`,
    deed: (d) => log.push('deed:' + d.kind + ':' + (d.villager ?? '')),
    chronicle: (t) => log.push('chronicle:' + t),
    relation: (a, b, da, dt) => log.push(`relation:${a}:${b}:${da}:${dt}`),
    getFlag: (k) => flags[k],
    setFlag: (k, v) => { flags[k] = v; log.push('flag:' + k); },
    time: () => 600,
    riverFlow: () => log.push('river'),
    festival: () => log.push('festival'),
    inject: (e) => log.push('inject:' + e.type),
    villagerName: (id) => id,
    sfx: () => {},
  };
  return { host, flags, log };
}

function setup() {
  const { host, flags, log } = mockHost();
  const inv = Inventory.starting();
  const stats = new Stats();
  const events: string[] = [];
  const equipped: ItemId[] = [];
  let quests!: Quests;
  const ctx: QuestCtx = {
    host, inv,
    give: (id, n) => { inv.add(id, n); quests.onItem(id); },
    xp: (n) => { stats.addXp(n); },
    equip: (id) => { const i = inv.find(id); if (i >= 0) inv.equipFromSlot(i); equipped.push(id); },
    notify: () => {},
    questChanged: (id, stage) => events.push(`${id}:${stage}`),
    questDone: (id) => events.push(`${id}:DONE`),
  };
  quests = new Quests(ctx);
  const say = (v: VillagerId, id: string) => {
    const opts = quests.options(v).map(o => o.id);
    const r = quests.choose(v, id);
    return { opts, r };
  };
  return { host, flags, log, inv, stats, quests, events, equipped, say };
}

test('раница: добавяне, трупане, местене, пълна раница', () => {
  const inv = new Inventory();
  assert.equal(inv.add('banitsa', 12), 0);
  assert.equal(inv.slots[0]?.count, 10);
  assert.equal(inv.slots[1]?.count, 2);
  assert.equal(inv.count('banitsa'), 12);
  inv.move(1, 5);
  assert.equal(inv.slots[1], null);
  assert.equal(inv.slots[5]?.count, 2);
  inv.remove('banitsa', 3);
  assert.equal(inv.count('banitsa'), 9);
  // сливане при местене
  inv.add('tea', 1); const t = inv.find('tea');
  inv.move(5, 0); // banitsa върху banitsa
  assert.equal(inv.count('banitsa'), 9);
  assert.ok(t >= 0);
  // грошове
  inv.add('coin', 25); assert.equal(inv.gold, 25);
  // пълна
  const full = new Inventory();
  for (let i = 0; i < INV_SIZE; i++) full.add('saber', 1);
  assert.equal(full.add('bow', 1), 1);
  assert.equal(full.canAdd('bow'), false);
});

test('екипировка и бърза лента', () => {
  const inv = Inventory.starting();
  assert.equal(inv.equipment.weapon, 'saber');
  assert.equal(inv.equipment.body, 'yamurluk');
  assert.equal(inv.equipment.feet, 'tsarvuli');
  assert.equal(inv.count('banitsa'), 2);
  assert.equal(inv.hotbar[0], 'banitsa');
  assert.equal(inv.hotbar[1], 'tea');
  inv.add('ivan_saber', 1);
  const i = inv.find('ivan_saber');
  assert.equal(inv.equipFromSlot(i), 'weapon');
  assert.equal(inv.equipment.weapon, 'ivan_saber');
  assert.equal(inv.slots[i]?.id, 'saber'); // старата сабя е на мястото ѝ
  assert.ok(inv.unequip('feet'));
  assert.equal(inv.equipment.feet, null);
  assert.equal(inv.count('tsarvuli'), 1);
  const b = inv.bonuses();
  assert.equal(b.weaponDamage, 26);
  assert.equal(b.armor, 8);
  inv.assignHotbar(inv.find('tsarvuli'), 3);
  assert.equal(inv.hotbar[3], 'tsarvuli');
  const s = inv.serialize();
  const inv2 = new Inventory(); inv2.load(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(inv2.serialize(), s);
});

test('опит и нива', () => {
  const st = new Stats();
  assert.equal(st.level, 1);
  assert.equal(st.title, 'Странник');
  assert.equal(st.maxHp, 100);
  st.hp = 10;
  const ups = st.addXp(xpToNext(1) + 5);
  assert.deepEqual(ups, [2]);
  assert.equal(st.xp, 5);
  assert.equal(st.hp, st.maxHp);
  assert.ok(st.maxHp > 100);
  st.addXp(100000);
  assert.equal(st.level, 10);
  assert.equal(st.damage(14), 14 + 18);
  assert.ok(mitigate(100, 50) === 50);
});

test('задача 1 → 3: росен, после Ламята, после дядо Пею', () => {
  const T = setup();
  assert.deepEqual(T.quests.options('gena').map(o => o.id), ['q:rosen_ask']);
  const r1 = T.quests.choose('gena', 'q:rosen_ask');
  assert.ok(r1 && r1.options && r1.options.length === 2);
  T.quests.choose('gena', 'q:rosen_accept');
  assert.equal(T.quests.stages.rosen, 'collect');
  assert.ok(T.quests.wantsRosen());
  assert.match(T.quests.step('rosen'), /0\/3/);
  T.inv.add('rosen', 1); T.quests.onItem('rosen');
  T.inv.add('rosen', 1); T.quests.onItem('rosen');
  assert.match(T.quests.step('rosen'), /2\/3/);
  T.inv.add('rosen', 1); T.quests.onItem('rosen');
  assert.equal(T.quests.stages.rosen, 'return');
  const r2 = T.quests.choose('gena', 'q:rosen_give');
  assert.ok(r2 && /Ламин връх/.test(r2.say));
  assert.equal(T.quests.stages.rosen, 'done');
  assert.equal(T.quests.stages.lamia, 'go');
  assert.equal(T.inv.count('rosen_potion'), 2);
  assert.equal(T.inv.count('rosen'), 0);
  assert.ok(T.stats.level >= 2);
  assert.ok(T.log.some(l => l === 'deed:quest_done:gena'));
  assert.ok(T.quests.markers().some(m => m.kind === 'boss'));
  // Ламята
  T.flags.lamia_dead = true;
  T.quests.onLamiaDefeated();
  assert.equal(T.quests.stages.lamia, 'report');
  const r3 = T.quests.choose('peyu', 'q:lamia_report');
  assert.equal(r3?.options?.length, 2);
  T.quests.choose('peyu', 'q:lamia_mart');
  assert.equal(T.quests.stages.lamia, 'done');
  assert.equal(T.inv.count('martenitsa'), 1);
  // бонус: Калин
  assert.ok(T.quests.options('kalin').some(o => o.id === 'q:kalin_bow'));
  T.quests.choose('kalin', 'q:kalin_bow');
  assert.equal(T.inv.count('bow'), 1);
  assert.equal(T.quests.options('kalin').length, 0);
  assert.ok(T.events.includes('rosen:DONE') && T.events.includes('lamia:DONE'));
});

test('задача 2: кокошките — подсказки, лисица, награда', () => {
  const T = setup();
  T.quests.choose('radka', 'q:chickens_ask');
  T.quests.choose('radka', 'q:chickens_accept');
  assert.equal(T.quests.stages.chickens, 'ask');
  assert.ok(T.quests.options('maria').some(o => o.id === 'q:chickens_clue'));
  assert.ok(!T.quests.options('radka').some(o => o.id === 'q:chickens_clue'));
  const c1 = T.quests.choose('maria', 'q:chickens_clue');
  assert.equal(c1?.say, 'maria мисли нещо за chickens');
  assert.equal(T.quests.stages.chickens, 'ask');
  assert.ok(!T.quests.options('maria').some(o => o.id === 'q:chickens_clue')); // втори път не пита
  T.quests.choose('kalin', 'q:chickens_clue');
  assert.equal(T.quests.stages.chickens, 'watch');
  assert.ok(T.quests.foxActive());
  // хваната лисица
  T.quests.onFoxCaught();
  assert.equal(T.flags.fox_caught, true);
  T.inv.add('fox_tail', 1); T.quests.onItem('fox_tail');
  assert.equal(T.quests.stages.chickens, 'return');
  const gold = T.inv.gold;
  T.quests.choose('radka', 'q:chickens_tail');
  assert.equal(T.quests.stages.chickens, 'done');
  assert.equal(T.inv.gold, gold + 40);
  assert.ok(T.log.includes('relation:radka:petko:20:25'));
  assert.ok(T.log.some(l => l === 'deed:helped:radka'));
});

test('странична: Желязо и вълна', () => {
  const T = setup();
  const a = T.quests.choose('ivan', 'q:iron_ask');
  assert.ok(a && a.say.includes('ivan мисли нещо за goats'));
  T.quests.choose('ivan', 'q:iron_accept');
  assert.equal(T.quests.stages.iron, 'bell');
  T.inv.add('bell', 1); T.quests.onItem('bell');
  assert.equal(T.quests.stages.iron, 'confront');
  const p = T.quests.choose('petko', 'q:iron_bell');
  assert.equal(p?.options?.length, 2);
  T.quests.choose('petko', 'q:iron_kind');
  assert.equal(T.quests.stages.iron, 'tell');
  assert.equal(T.inv.count('bell'), 0);
  T.quests.choose('ivan', 'q:iron_tell');
  assert.equal(T.quests.stages.iron, 'done');
  assert.ok(T.log.includes('relation:ivan:petko:40:30'));
  assert.equal(T.flags.ivan_petko_peace, true);
  assert.equal(T.inv.equipment.weapon, 'ivan_saber');
  assert.deepEqual(T.equipped, ['ivan_saber']);
  // грешен жител/етап → null
  assert.equal(T.quests.choose('maria', 'q:iron_tell'), null);
  assert.equal(T.quests.choose('maria', 'news'), null);
});

test('запис → зареждане на задачите и мъглата', () => {
  const T = setup();
  T.quests.choose('gena', 'q:rosen_accept');
  T.quests.choose('radka', 'q:chickens_accept');
  T.quests.choose('maria', 'q:chickens_clue');
  const s = JSON.parse(JSON.stringify(T.quests.serialize()));
  const T2 = setup();
  T2.quests.load(s);
  assert.deepEqual(T2.quests.serialize(), T.quests.serialize());
  assert.equal(T2.quests.log().length, 2);
  const f = new FogGrid();
  assert.ok(f.reveal(0, 40, 40) > 0);
  assert.ok(f.isExplored(0, 40));
  assert.ok(!f.isExplored(200, -200));
  const f2 = new FogGrid(); f2.load(f.serialize());
  assert.deepEqual([...f2.grid], [...f.grid]);
});
