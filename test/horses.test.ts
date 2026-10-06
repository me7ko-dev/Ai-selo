// Проби за конете: стадата, опитомяване, седло, езда (по-бързо от тичане), слизане, повикване, запис/зареждане.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HorseManager, HERDS, HORSES, RIDE_GALLOP, HORSE_REACH } from '../src/rpg/horses';
import { Hero, RUN_SPEED, NO_INPUT } from '../src/rpg/hero';
import { simpleWorldQuery } from '../src/core/world-query';
import { createHeroModel, HORSE_COATS } from '../src/models';
import { heightAt, normalAt } from '../src/world/height';
import { ITEMS } from '../src/rpg/items';

const world = simpleWorldQuery;
const pool = () => ({ stamina: 100, maxStamina: 100 });

test('стадата са на равни, отключени ливади; конете имат имена и масти', () => {
  for (const h of HERDS) {
    assert.equal(world.lockedAt(h.x, h.z), null, h.place);
    assert.ok(normalAt(h.x, h.z)[1] > 0.95, `стръмно: ${h.place}`);
  }
  assert.ok(HORSES.length >= 10);
  assert.equal(new Set(HORSES.map((h) => h.id)).size, HORSES.length);
  for (const h of HORSES) assert.ok(HORSE_COATS[h.coat] && HERDS[h.herd], h.id);
  assert.ok(ITEMS.saddle.value! > 0);
});

test('дивите пасат около стадото си', () => {
  const m = new HorseManager(null, world);
  const hero = { pos: new THREE.Vector3(500, 0, 500), yaw: 0, speed: 0 };
  for (let i = 0; i < 600; i++) m.update(0.05, hero, false);
  for (const h of m.list) {
    const herd = HERDS[h.def.herd];
    assert.ok(Math.hypot(h.pos.x - herd.x, h.pos.z - herd.z) < herd.r + 3, `${h.def.id} избяга от стадото`);
    assert.ok(Math.abs(h.pos.y - heightAt(h.pos.x, h.pos.z)) < 1e-6);
  }
});

test('тичащ човек плаши дивите, но не и опитомените', () => {
  const m = new HorseManager(null, world);
  const [wild, tame] = [m.list[0], m.list[1]];
  m.tame(tame);
  const hero = { pos: new THREE.Vector3(wild.pos.x + 3, 0, wild.pos.z), yaw: 0, speed: 8 };
  m.update(0.05, hero, true);
  assert.equal(wild.state, 'flee');
  assert.notEqual(tame.state, 'flee');
});

test('опитомяване → седло → езда → слизане; записът ги помни', () => {
  const m = new HorseManager(null, world);
  const h = m.get('dorcho')!;
  assert.ok(!h.owned);
  const near = m.nearest(h.pos.x + 1, h.pos.z, HORSE_REACH);
  assert.ok(near);
  m.tame(h); m.saddle(h);
  assert.ok(h.owned && h.saddled);
  m.mount(h);
  assert.equal(m.riding, 'dorcho');
  // ездачът мести коня
  const hero = { pos: new THREE.Vector3(10, 0, 120), yaw: 1, speed: 12 };
  m.update(0.05, hero, false);
  assert.equal(h.pos.x, 10); assert.equal(h.yaw, 1);
  const save = m.serialize();
  assert.equal(save.riding, 'dorcho');
  const m2 = new HorseManager(null, world);
  m2.load(save);
  assert.equal(m2.riding, 'dorcho');
  assert.ok(m2.get('dorcho')!.saddled);
  const p = m2.dismount();
  assert.ok(p && Math.hypot(p.x - 10, p.z - 120) < 2);
  assert.equal(m2.riding, null);
  // стари записи без коне
  const m3 = new HorseManager(null, world);
  m3.load(undefined);
  assert.equal(m3.owned().length, 0);
});

test('повиканият кон идва при героя', () => {
  const m = new HorseManager(null, world);
  const h = m.get('belcho')!;
  m.tame(h); m.saddle(h);
  const hero = { pos: new THREE.Vector3(h.pos.x + 60, 0, h.pos.z + 20), yaw: 0, speed: 0 };
  assert.equal(m.call(hero.pos.x, hero.pos.z), h);
  for (let i = 0; i < 400 && h.state === 'come'; i++) m.update(0.05, hero, false);
  assert.ok(Math.hypot(h.pos.x - hero.pos.x, h.pos.z - hero.pos.z) < 4);
  assert.equal(new HorseManager(null, world).call(0, 0), null);
});

test('на кон героят е по-бърз от тичане, не удря и не скача', () => {
  const hero = new Hero(createHeroModel());
  hero.setPosition(0, 140, world, Math.PI);
  hero.setMounted(true, 1);
  const sp = pool();
  const cam = 0; // камерата гледа към -z → W е към -z
  for (let i = 0; i < 120; i++) hero.update(0.05, { ...NO_INPUT, fwd: 1, run: true, attack: i === 50, jump: i === 60 }, cam, world, sp);
  assert.ok(hero.speed > RUN_SPEED + 2 && hero.speed <= RIDE_GALLOP + 1e-6, `скорост ${hero.speed}`);
  assert.ok(!hero.attacking);
  assert.ok(hero.grounded);
  assert.ok(sp.stamina >= 99, 'галопът не уморява ездача');
  hero.setMounted(false);
  assert.ok(!hero.mounted);
});
