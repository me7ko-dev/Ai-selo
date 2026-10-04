// Проби за чистата логика на интерфейса (без DOM): иконки, портрети, шевици, карта, летопис, машина на времето.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icon, ICON_KEYS, portrait, typeIcon, TYPE_COLORS, TYPE_LABELS, personName } from '../src/ui/icons';
import { stitch, STRIP_TILE, ROSETTE, ornamentVars, dividerHtml } from '../src/ui/ornament';
import { worldToMap, yawToScreenAngle, groupByDay, entriesForBranch, branchLanes, entriesAround, entryAt, paginate, dayTimeLabel } from '../src/ui/logic';
import type { IconKey } from '../src/data/icons';
import { VILLAGER_IDS } from '../src/data/villagers';
import type { Branch, ChronicleEntry, ChronicleType } from '../src/sim/types';

const ALL_KEYS: IconKey[] = ['saber', 'ivan_saber', 'bow', 'rosen', 'potion', 'banitsa', 'tea', 'bread', 'apple',
  'kalpak', 'cloak', 'vest', 'tsarvuli', 'gloves', 'martenitsa', 'ring',
  'fox_tail', 'lamia_scale', 'claw', 'coin', 'bell', 'egg', 'key', 'letter', 'wood', 'iron', 'feather', 'map',
  'quest', 'sun', 'moon', 'heart', 'shield', 'sword', 'star', 'empty'];

test('всяка иконка има SVG', () => {
  for (const k of ALL_KEYS) {
    assert.ok(ICON_KEYS.includes(k), `липсва ${k}`);
    const s = icon(k, 32);
    assert.match(s, /^<svg [^>]*viewBox="0 0 24 24"[^>]*>.+<\/svg>$/s);
    assert.ok(s.includes('width="32px"'));
  }
});

test('портрети за всички жители и героя, с уникални id', () => {
  const seen = new Set<string>();
  for (const id of [...VILLAGER_IDS, 'hero', 'непознат']) {
    const s = portrait(id, '3em');
    assert.ok(s.startsWith('<svg') && s.endsWith('</svg>'), id);
    const m = /id="(pc\d+)g"/.exec(s);
    assert.ok(m && !seen.has(m[1]), 'уникален id на градиента');
    seen.add(m![1]);
  }
  assert.equal(personName('player'), 'Странникът');
  assert.equal(personName('gena'), 'баба Гена');
});

test('иконки, цветове и имена за всеки вид запис', () => {
  const types: ChronicleType[] = ['talk', 'quarrel', 'love', 'theft', 'rumor', 'election', 'work', 'festival', 'monster', 'player', 'quest', 'weather', 'live', 'reflection', 'mood', 'system'];
  for (const t of types) {
    assert.ok(typeIcon(t).includes('<svg'));
    assert.match(TYPE_COLORS[t], /^#[0-9a-f]{6}$/i);
    assert.ok(TYPE_LABELS[t].length > 2);
  }
});

test('шевиците са правоъгълни схеми и стават на SVG', () => {
  for (const rows of [STRIP_TILE, ROSETTE]) assert.ok(rows.every((r) => r.length === rows[0].length));
  assert.ok(stitch(['RK', 'G.']).split('<rect').length - 1 === 3);
  const v = ornamentVars();
  assert.ok(v['--orn-strip'].startsWith('url("data:image/svg+xml,'));
  assert.ok(dividerHtml().includes('orn-rosette'));
});

test('карта: свят → пиксели, север горе', () => {
  assert.deepEqual(worldToMap(-300, -300, 1024), { px: 0, py: 0 });
  assert.deepEqual(worldToMap(0, 0, 1024), { px: 512, py: 512 });
  assert.deepEqual(worldToMap(300, 300, 1024), { px: 1024, py: 1024 });
  // yaw 0 = гледа към +z (юг) → стрелката сочи надолу (завъртяна на π)
  assert.equal(yawToScreenAngle(0), Math.PI);
  // yaw π = гледа на север → стрелката сочи нагоре
  assert.equal(yawToScreenAngle(Math.PI), 0);
});

const E = (id: number, time: number, branchId = 'main', type: ChronicleType = 'talk', importance = 3): ChronicleEntry =>
  ({ id, time, branchId, type, importance, participants: [], text: `запис ${id}` });

test('летопис: групиране по дни, най-новите първо', () => {
  const es = [E(1, 400), E(2, 1500), E(3, 1600), E(4, 3000)];
  const g = groupByDay(es);
  assert.deepEqual(g.map((x) => x.day), [1, 2, 3]);
  assert.equal(g[1].entries.length, 2);
  const n = groupByDay(es, true);
  assert.deepEqual(n.map((x) => x.day), [3, 2, 1]);
  assert.equal(n[1].entries[0].id, 3);
  assert.equal(dayTimeLabel(1440 + 14 * 60 + 20), 'Ден 2 · 14:20');
});

test('страници: не надвишават реда на страница', () => {
  const pages = paginate([1, 2, 3, 4, 5, 6], () => 2, 5);
  assert.deepEqual(pages, [[1, 2], [3, 4], [5, 6]]);
  assert.deepEqual(paginate([10], () => 99, 5), [[10]]);
});

test('машина на времето: клонове, ленти, записи на клон', () => {
  const branches: Branch[] = [
    { id: 'main', parentId: null, forkTime: 0, forkEntryId: 0, createdAt: 1, label: 'Основна' },
    { id: 'b2', parentId: 'main', forkTime: 500, forkEntryId: 2, createdAt: 2, label: 'Клон 2' },
    { id: 'b3', parentId: 'b2', forkTime: 800, forkEntryId: 11, createdAt: 3, label: 'Клон 3' },
    { id: 'c', parentId: 'main', forkTime: 900, forkEntryId: 3, createdAt: 4, label: 'Клон 4' },
  ];
  const lanes = branchLanes(branches);
  assert.equal(lanes.get('main'), 0);
  assert.equal(lanes.get('b2'), 1);
  assert.equal(lanes.get('b3'), 2);
  assert.equal(lanes.get('c'), 3);
  const es = [E(1, 100), E(2, 400), E(3, 700), E(10, 600, 'b2'), E(11, 750, 'b2'), E(12, 900, 'b2'), E(20, 850, 'b3')];
  assert.deepEqual(entriesForBranch(es, branches, 'b2').map((e) => e.id), [1, 2, 10, 11, 12]);
  assert.deepEqual(entriesForBranch(es, branches, 'b3').map((e) => e.id), [1, 2, 10, 11, 20]);
  assert.deepEqual(entriesForBranch(es, branches, 'main').map((e) => e.id), [1, 2, 3]);
  assert.equal(entryAt(es.filter((e) => e.branchId === 'main'), 650)?.id, 2);
  assert.equal(entryAt(es, 50), null);
  assert.deepEqual(entriesAround(es, 700, 100).map((e) => e.id), [10, 3, 11]);
});
