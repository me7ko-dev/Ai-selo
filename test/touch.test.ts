// Проби за управлението с пръсти: джойстикът, настройките за телефон, съветите — без DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickVector, STICK_RADIUS, RUN_AT, DEAD, pinchZoom } from '../src/ui/touchStick';
import { mergeSettings, mergeSettingsFor, TOUCH_GRAPHICS, DEFAULT_SETTINGS } from '../src/save/settings';
import { STEP_TEXT, TOUCH_STEP_TEXT } from '../src/game/tutorial';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('джойстик: мъртва зона, посоки, таван 1', () => {
  assert.deepEqual(stickVector(0, 0), { fwd: 0, right: 0, mag: 0 });
  // малко помръдване — нищо
  assert.equal(stickVector(STICK_RADIUS * DEAD * 0.5, 0).mag, 0);
  // нагоре (y надолу е +) = напред
  const up = stickVector(0, -STICK_RADIUS);
  close(up.fwd, 1); close(up.right, 0); close(up.mag, 1);
  // вдясно
  const r = stickVector(STICK_RADIUS * 3, 0);
  close(r.right, 1); close(r.fwd, 0);
  // по диагонал дължината е ≤ 1
  const d = stickVector(STICK_RADIUS, STICK_RADIUS);
  assert.ok(Math.hypot(d.fwd, d.right) <= 1 + 1e-9);
  // половин път — ходене, не бягане
  const half = stickVector(0, -STICK_RADIUS * 0.5);
  assert.ok(half.mag > 0.2 && half.mag < RUN_AT);
  // до ръба — бягане
  assert.ok(stickVector(0, -STICK_RADIUS).mag >= RUN_AT);
});

test('настройки: телефонът започва с ниско качество, без да пипа запазения избор', () => {
  // компютър — както досега
  assert.deepEqual(mergeSettingsFor({}), mergeSettings({}));
  assert.equal(mergeSettingsFor({}).graphics.quality, DEFAULT_SETTINGS.graphics.quality);
  // телефон без запис — лека графика
  const t = mergeSettingsFor({}, { touch: true });
  assert.deepEqual(t.graphics, TOUCH_GRAPHICS);
  assert.equal(t.graphics.quality, 'low');
  assert.equal(t.graphics.pixelRatioCap, 1);
  // останалото е по подразбиране
  assert.deepEqual(t.audio, DEFAULT_SETTINGS.audio);
  // телефон със запазен избор — изборът остава
  const saved = mergeSettingsFor({ graphics: { quality: 'high', shadows: true, pixelRatioCap: 1.5 } }, { touch: true });
  assert.equal(saved.graphics.quality, 'high');
  assert.equal(saved.graphics.pixelRatioCap, 1.5);
  // частичен запис (само звук) — графиката е за телефон, звукът — запазеният
  const part = mergeSettingsFor({ audio: { master: 0.3 } }, { touch: true });
  assert.equal(part.graphics.quality, 'low');
  assert.equal(part.audio.master, 0.3);
  // боклук не чупи
  assert.equal(mergeSettingsFor('xx', { touch: true }).graphics.quality, 'low');
});

test('съветите за пръсти: всички стъпки, на български, без клавиатура', () => {
  assert.deepEqual(Object.keys(TOUCH_STEP_TEXT).sort(), Object.keys(STEP_TEXT).sort());
  for (const [k, txt] of Object.entries(TOUCH_STEP_TEXT)) {
    assert.ok(txt.length > 10, k);
    assert.ok(!/\[(W|A|S|D|Shift|Space|Tab|M|J|T)\]|мишка/.test(txt), `${k}: ${txt}`);
  }
});

test('щипване: раздалечаване приближава, събиране отдалечава', () => {
  assert.ok(pinchZoom(100, 220) < 0);
  assert.ok(pinchZoom(220, 100) > 0);
  assert.equal(pinchZoom(150, 150), 0);
});
