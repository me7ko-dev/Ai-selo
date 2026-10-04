// Проби на плана на света: пътищата са проходими, арената на Ламята е празна, collide() работи.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlan, ROAD_SEGS, ARENA_RADIUS } from '../src/world/plan';
import { PLACES, ROAD_NODES } from '../src/data/layout';
import { heightAt, riverWaterHeight, terrainHeight, BRIDGE } from '../src/world/height';
import { CameraBlockers } from '../src/world/cameraBlock';

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

test('нивата на Иван има портичка: от пътя се влиза вътре', () => {
  const p = getPlan(), col = p.colliders;
  const gate = p.props.find(q => q.type === 'field_gate');
  const field = p.props.find(q => q.type === 'field');
  assert.ok(gate && field, 'няма портичка/нива');
  // от 4 м пред портичката до 4 м навътре — свободно
  const fx = Math.sin(field!.rot), fz = Math.cos(field!.rot); // локалното +z на нивата (навътре от северния зид)
  for (let t = -4; t <= 4; t += 0.5) {
    const x = gate!.x + fx * t, z = gate!.z + fz * t;
    assert.ok(!col.blocked(x, z, 0.4), `портичката е затворена при ${x.toFixed(1)},${z.toFixed(1)}`);
  }
});

test('от ореха на изток се минава право (чешмата не е на пътеката)', () => {
  const col = getPlan().colliders, W = PLACES.walnut.pos;
  for (let x = W.x + 4.2; x <= W.x + 18; x += 0.5) assert.ok(!col.blocked(x, W.z, 0.4), `препятствие при ${x.toFixed(1)},${W.z}`);
});

test('камерата се спира от стволове и къщи, не от короните', () => {
  const p = getPlan(), cb = new CameraBlockers(p);
  const t = p.pines[100];
  const g = heightAt(t.x, t.z);
  assert.ok(cb.hit(t.x, g + 2, t.z), 'стволът не спира камерата');
  assert.ok(!cb.hit(t.x + 1.4 * t.s, g + 3.5 * t.s, t.z), 'короната спира камерата');
  const h = p.houses[0];
  assert.ok(cb.hit(h.x, heightAt(h.x, h.z) + 3, h.z), 'къщата не спира камерата');
});
