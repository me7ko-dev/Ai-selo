// Основни проби: терен, пътища, генератор на случайни числа, игрово време.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heightAt } from '../src/world/height';
import { PLACES, roadPath } from '../src/data/layout';
import { Rng } from '../src/core/rng';
import { formatDayClock, dayPhase } from '../src/core/time';

test('селото е на равно, Ламин връх е висок', () => {
  const v = heightAt(PLACES.square.pos.x, PLACES.square.pos.z);
  assert.ok(Math.abs(v - 2) < 0.5, `мегданът е на ${v}`);
  assert.ok(heightAt(PLACES.lamia_peak.pos.x, PLACES.lamia_peak.pos.z) > 45);
  assert.ok(Math.abs(heightAt(PLACES.lamia_plateau.pos.x, PLACES.lamia_plateau.pos.z) - 30) < 2);
});

test('пътят от къщата на Гена до хана минава по пътищата', () => {
  const p = roadPath(PLACES.house_gena.pos, PLACES.inn.pos);
  assert.ok(p.length >= 2);
  assert.deepEqual(p[p.length - 1], PLACES.inn.pos);
});

test('Rng е повторим', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('игрово време', () => {
  assert.equal(formatDayClock(390), 'Ден 1 · 06:30');
  assert.equal(dayPhase(1440 + 22 * 60), 'night');
});
