// Проби на самодивите: поклон → благословия до зори (веднъж на нощ), обида → проклятие, баба Гена го сваля и споделя тайната си.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Samodivi, RING, BLESS, CURSE, nightKey, nightEnd, samodiviDancing, BOW_RANGE } from '../src/rpg/samodivi';
import type { QuestHost } from '../src/rpg/host';
import type { PlayerDeed } from '../src/sim/types';

const D = 1440;
const at = (day: number, h: number, m = 0) => day * D + h * 60 + m;

function host() {
  const deeds: PlayerDeed[] = [];
  const notes: string[] = [];
  const h: QuestHost = {
    notify: (t) => notes.push(t), clue: () => '', deed: (d) => deeds.push(d), chronicle: () => {}, relation: () => {},
    getFlag: () => undefined, setFlag: () => {}, time: () => 0, riverFlow: () => {}, festival: () => {}, inject: () => {},
    villagerName: (id) => id, sfx: () => {},
  };
  return { h, deeds, notes };
}

test('самодивите: кога играят и коя нощ е', () => {
  assert.equal(samodiviDancing(at(2, 12)), false);
  assert.equal(samodiviDancing(at(2, 23)), true);
  assert.equal(samodiviDancing(at(3, 3)), true);
  assert.equal(samodiviDancing(at(2, 12), at(2, 13)), true, 'извиканата случка — и денем');
  assert.equal(nightKey(at(2, 23)), 2);
  assert.equal(nightKey(at(3, 2)), 2, 'след полунощ — още същата нощ');
  assert.equal(nightEnd(at(2, 23)), at(3, 4, 30));
});

test('самодивите: зони около хорото', () => {
  const s = new Samodivi();
  const t = at(1, 23);
  assert.equal(s.zone(RING.x, RING.z + BOW_RANGE + 1, t, true), 'none');
  assert.equal(s.zone(RING.x, RING.z + RING.r + 3, t, true), 'near');
  assert.equal(s.zone(RING.x, RING.z + 3.5, t, true), 'warn');
  assert.equal(s.zone(RING.x + 1, RING.z, t, true), 'inside');
  assert.equal(s.zone(RING.x, RING.z + RING.r + 3, t, false), 'none', 'денем ги няма');
});

test('самодивите: поклон → благословия до зазоряване, веднъж на нощ', () => {
  const s = new Samodivi();
  const t = at(1, 23);
  assert.equal(s.canBow(t, true), true);
  assert.equal(s.bow(t, false), null, 'без хоро няма на кого да се поклониш');
  const line = s.bow(t, true);
  assert.ok(line && line.length > 20);
  assert.equal(s.blessed(t + 60), true);
  assert.equal(s.damageMul(t + 60), BLESS.damage);
  assert.ok(s.regen(t + 60) > 0);
  assert.equal(s.speedMul(t + 60), 1);
  assert.equal(s.label(t + 60), 'благословен');
  assert.equal(s.canBow(t + 30, true), false, 'втори път същата нощ — не');
  assert.equal(s.bow(at(2, 1), true), null, 'след полунощ е същата нощ');
  assert.equal(s.blessed(at(2, 4, 29)), true);
  assert.equal(s.blessed(at(2, 4, 31)), false, 'с утрото избледнява');
  assert.equal(s.expired(at(2, 4, 29), at(2, 4, 31)), 'bless');
  assert.equal(s.canBow(at(2, 22), true), true, 'следващата нощ — пак може');
});

test('самодивите: обида → проклятие, изчезват до сутринта, баба Гена го сваля', () => {
  const s = new Samodivi();
  const t = at(1, 23);
  s.bow(t, true);
  const line = s.offend(t + 10, true, 'attack');
  assert.ok(line);
  assert.equal(s.cursed(t + 20), true);
  assert.equal(s.blessed(t + 20), false, 'благословията изчезва');
  assert.equal(s.damageMul(t + 20), CURSE.damage);
  assert.equal(s.speedMul(t + 20), CURSE.speed);
  assert.equal(s.label(t + 20), 'прокълнат');
  assert.equal(s.gone(t + 20), true);
  assert.equal(s.zone(RING.x, RING.z, t + 20, true), 'none', 'изчезнаха — няма повече проклятия тази нощ');
  assert.equal(s.offend(t + 30, true, 'trespass'), null);
  assert.equal(s.cursed(at(2, 12)), true, 'и на следващия ден');
  assert.equal(s.gone(at(2, 12)), false);
  // баба Гена
  const { h, deeds } = host();
  assert.deepEqual(s.options('ivan', at(2, 12)), []);
  const opts = s.options('gena', at(2, 12)).map((o) => o.id);
  assert.deepEqual(opts, ['q:sam_lift'], 'докато си прокълнат — само „Самодивите ме проклеха…“');
  const r = s.choose('gena', 'q:sam_lift', at(2, 12), h);
  assert.ok(r && /самодива ме научи/.test(r.say), 'намеква тайната си');
  assert.equal(s.cursed(at(2, 12)), false);
  assert.equal(deeds[0].villager, 'gena');
  assert.ok((deeds[0].trust ?? 0) > 0);
  assert.equal(s.choose('gena', 'q:sam_lift', at(2, 12), h), null, 'втори път — нищо');
  // без Гена — до 20:00 на следващия ден
  const s2 = new Samodivi();
  s2.offend(at(1, 23), true, 'trespass');
  assert.equal(s2.cursed(at(2, 19, 59)), true);
  assert.equal(s2.cursed(at(2, 20, 1)), false);
  assert.equal(s2.expired(at(2, 19, 59), at(2, 20, 1)), 'curse');
});

test('самодивите: след благословия баба Гена споделя тайната си (веднъж)', () => {
  const s = new Samodivi();
  assert.deepEqual(s.options('gena', at(1, 12)), []);
  s.bow(at(1, 23), true);
  assert.deepEqual(s.options('gena', at(2, 10)).map((o) => o.id), ['q:sam_secret']);
  const { h, deeds } = host();
  const r = s.choose('gena', 'q:sam_secret', at(2, 10), h);
  assert.ok(r && /видях — самодива/.test(r.say));
  assert.equal(s.secretTold, true);
  assert.equal(deeds[0].villager, 'gena');
  assert.ok((deeds[0].trust ?? 0) >= 20);
  assert.ok(deeds[0].importance < 4, 'тайната не става слух');
  assert.deepEqual(s.options('gena', at(2, 10)), []);
});

test('самодивите: запис и зареждане', () => {
  const s = new Samodivi();
  s.bow(at(1, 23), true);
  s.offend(at(1, 23, 30), true, 'attack');
  const json = JSON.parse(JSON.stringify(s.serialize()));
  const b = new Samodivi();
  b.load(json);
  assert.deepEqual(b.serialize(), s.serialize());
  assert.equal(b.cursed(at(2, 10)), true);
  const c = new Samodivi();
  c.load(undefined); // стар запис без самодиви
  assert.equal(c.cursed(0), false);
  assert.equal(c.canBow(at(1, 23), true), true);
});
