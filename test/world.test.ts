// Проби на плана на света: пътищата са проходими, арената на Ламята е празна, collide() работи.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlan, ROAD_SEGS, ARENA_RADIUS } from '../src/world/plan';
import { PLACES, ROAD_NODES } from '../src/data/layout';
import { heightAt, riverWaterHeight, terrainHeight, BRIDGE } from '../src/world/height';

test('планът се строи бързо', () => {
  const t = performance.now();
  const p = getPlan();
  const ms = performance.now() - t;
  assert.ok(p.houses.length === 8, `къщи: ${p.houses.length}`);
  assert.ok(p.pines.length > 1500, `борове: ${p.pines.length}`);
  assert.ok(ms < 8000, `планът отне ${ms} ms`);
});

test('пътищата са проходими (никое препятствие не ги затваря)', () => {
  const col = getPlan().colliders;
  const bad: string[] = [];
  for (const s of ROAD_SEGS) {
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
    for (let d = 0; d <= len; d += 0.7) {
      const x = s[0] + ((s[2] - s[0]) * d) / len, z = s[1] + ((s[3] - s[1]) * d) / len;
      if (col.blocked(x, z, 0.4)) bad.push(`${x.toFixed(1)},${z.toFixed(1)}`);
    }
  }
  assert.equal(bad.length, 0, `блокирани точки по пътищата: ${bad.slice(0, 12).join(' ')}`);
});

test('възлите на пътищата са свободни', () => {
  const col = getPlan().colliders;
  for (const [k, n] of Object.entries(ROAD_NODES)) assert.ok(!col.blocked(n.x, n.z, 0.5), `възелът ${k} е блокиран`);
});

test('арената на Ламята е без препятствия', () => {
  const col = getPlan().colliders, c = PLACES.lamia_plateau.pos;
  for (let r = 0; r <= ARENA_RADIUS - 1; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
    const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
    assert.ok(!col.blocked(x, z, 0.5), `препятствие в арената при ${x.toFixed(1)},${z.toFixed(1)}`);
  }
});

test('collide избутва от къща, ограничава света и блатото', () => {
  const p = getPlan(), h = p.houses[0];
  const r = p.colliders.collide(h.x, h.z, 0.4);
  assert.ok(Math.hypot(r.x - h.x, r.z - h.z) > 2, 'не излиза от къщата');
  const e = p.colliders.collide(400, -400, 0.4);
  assert.ok(Math.abs(e.x) <= 300 && Math.abs(e.z) <= 300);
  const s = PLACES.swamp.pos;
  const q = p.colliders.collide(s.x, s.z - 10, 0.4);
  assert.ok(Math.hypot(q.x - s.x, q.z - s.z) >= 62, 'влиза в блатото');
  assert.ok(p.colliders.lockedAt(q.x, q.z), 'няма съобщение до блатото');
});

test('мостът: по него се ходи над коритото, водата е под него', () => {
  const x = (BRIDGE.x0 + BRIDGE.x1) / 2, z = BRIDGE.z;
  assert.ok(heightAt(x, z) > terrainHeight(x, z) + 2, 'мостът не е над коритото');
  assert.ok(riverWaterHeight(x, z) < heightAt(x, z) - 1);
});
