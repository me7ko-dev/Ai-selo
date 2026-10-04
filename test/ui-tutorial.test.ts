// Проби за обучението (подсказките) и малките помощници на интерфейса — без DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TutorialMachine, LINEAR_STEPS, STEP_TEXT, stepLabel, type TutorialFacts } from '../src/game/tutorial';
import { hintHtml, rectsOverlap } from '../src/ui/logic';
import { INTRO_PAGES } from '../src/ui/introArt';

const base: TutorialFacts = { playing: true, moved: 0, running: false, jumped: false, nearVillager: false, genaQuest: true, dialogue: false, panel: false, dusk: false, attacked: false, blocked: false, hp: 1 };

/** n кадъра по dt с еднакви факти; връща последния кадър и всички „done“. */
function run(m: TutorialMachine, f: Partial<TutorialFacts>, n: number, dt = 0.1) {
  const done: string[] = [];
  let last = m.update({ ...base, ...f }, dt);
  if (last.done) done.push(last.done);
  for (let i = 1; i < n; i++) { last = m.update({ ...base, ...f }, dt); if (last.done) done.push(last.done); }
  return { last, done };
}

test('подсказки: вървене → бягане/скок → баба Гена → E → прозорците', () => {
  const m = new TutorialMachine();
  assert.equal(run(m, {}, 1).last.step, 'move');
  // стоиш на място — не минава
  assert.equal(run(m, {}, 50).last.step, 'move');
  // вървиш 8 м
  assert.deepEqual(run(m, { moved: 0.2 }, 40).done, ['move']);
  // след паузата за отметката — бягане и скок
  assert.equal(run(m, {}, 20).last.step, 'run');
  assert.deepEqual(run(m, { moved: 0.3, running: true }, 12).done, []);
  assert.deepEqual(run(m, { jumped: true }, 2).done, ['run']);
  assert.equal(run(m, {}, 20).last.step, 'gena');
  // стигаш до жител → „gena“ е изпълнен, после „E — говориш“
  assert.deepEqual(run(m, { nearVillager: true }, 1).done, ['gena']);
  assert.equal(run(m, { nearVillager: true }, 20).last.step, 'talk');
  // отдалечаваш се — подсказката изчезва, без да е изпълнена
  assert.equal(run(m, { nearVillager: false }, 3).last.step, null);
  // връщаш се, натискаш E: разговор (прозорецът е отворен → не се играе), после затваряш
  assert.equal(run(m, { nearVillager: true }, 2).last.step, 'talk');
  run(m, { playing: false, dialogue: true }, 10);
  assert.deepEqual(run(m, {}, 1).done, ['talk']);
  assert.equal(run(m, {}, 20).last.step, 'panels');
  run(m, { playing: false, panel: true }, 3);
  assert.deepEqual(run(m, {}, 1).done, ['panels']);
  for (const s of LINEAR_STEPS) assert.ok(m.seen.has(s), s);
  assert.equal(run(m, {}, 30).last.step, null);
});

test('подсказки: здрач и рана идват, когато им дойде времето; запис/зареждане; изключване', () => {
  const m = new TutorialMachine({ seen: ['move', 'run', 'gena', 'talk', 'panels'] });
  assert.equal(run(m, {}, 5).last.step, null);
  assert.equal(run(m, { dusk: true }, 5).last.step, 'dusk');
  run(m, { dusk: true, attacked: true }, 3);
  assert.deepEqual(run(m, { dusk: true, blocked: true }, 30).done, ['dusk']);
  assert.equal(run(m, { hp: 0.3 }, 20).last.step, 'heal');
  assert.deepEqual(run(m, { hp: 0.9 }, 1).done, ['heal']);
  assert.ok(m.finished);
  // записът пази видяното
  const copy = new TutorialMachine(m.save());
  assert.ok(copy.finished);
  // боклук в записа не чупи
  const junk = new TutorialMachine({ seen: ['xx', 'move'] as never, off: 'да' as never });
  assert.deepEqual(junk.save().seen, ['move']);
  // изключени — нищо не се показва; reset пуска отначало
  const off = new TutorialMachine({ off: true });
  assert.equal(run(off, {}, 5).last.step, null);
  off.reset();
  assert.equal(run(off, {}, 1).last.step, 'move');
});

test('подсказки: ако задачата на баба Гена вече е взета, съветът за нея се прескача', () => {
  const m = new TutorialMachine({ seen: ['move', 'run'] });
  assert.equal(run(m, { genaQuest: false }, 1).last.step, null); // няма жител до теб → „E“ чака
  assert.ok(m.seen.has('gena'));
  assert.equal(run(m, { genaQuest: false, nearVillager: true }, 1).last.step, 'talk');
});

test('текстовете на подсказките: [клавиш] → <kbd>, екраниране, етикети', () => {
  assert.equal(hintHtml('[E] — говориш'), '<kbd>E</kbd> — говориш');
  assert.equal(hintHtml('при *баба Гена* <b>'), 'при <b>баба Гена</b> &lt;b&gt;');
  for (const s of Object.values(STEP_TEXT)) { assert.ok(/[а-я]/i.test(s)); assert.ok(!/[a-z]{4,}/.test(s.replace(/\[[^\]]+\]/g, '')), `английски в „${s}“`); }
  assert.equal(stepLabel('move'), 'Съвет 1 от 5');
  assert.equal(stepLabel('dusk'), 'Внимание');
});

test('правоъгълници и въведение', () => {
  assert.ok(rectsOverlap({ l: 0, t: 0, r: 10, b: 10 }, { l: 5, t: 5, r: 20, b: 20 }));
  assert.ok(!rectsOverlap({ l: 0, t: 0, r: 10, b: 10 }, { l: 12, t: 0, r: 20, b: 10 }));
  assert.ok(rectsOverlap({ l: 0, t: 0, r: 10, b: 10 }, { l: 12, t: 0, r: 20, b: 10 }, 3));
  assert.equal(INTRO_PAGES.length, 3);
  for (const p of INTRO_PAGES) { assert.ok(p.title && p.text.length > 40); assert.ok(p.art().startsWith('<svg')); }
});
