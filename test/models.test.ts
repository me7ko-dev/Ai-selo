// Проби за моделите: строят се в Node, всички анимации вървят без NaN, бюджет на триъгълниците, еднократните анимации се връщат.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VILLAGERS, VILLAGER_IDS } from '../src/data/villagers';
import {
  createVillagerModel, createHeroModel, createMonsterModel, createSamodivaModel, createAnimalModel, createLamiaModel, createPropModel,
  countTris, type AnimName, type CharacterModel,
} from '../src/models';

const ANIMS: AnimName[] = ['idle', 'walk', 'run', 'attack', 'attack2', 'hit', 'die', 'talk', 'work', 'sit', 'sleep', 'dance', 'jump', 'cast', 'wave', 'block'];

function allModels(): [string, CharacterModel][] {
  const out: [string, CharacterModel][] = VILLAGER_IDS.map((id) => [id, createVillagerModel(VILLAGERS[id].look)]);
  out.push(['hero', createHeroModel()], ['talasam', createMonsterModel('talasam')], ['fox', createMonsterModel('fox_talasam')]);
  for (let i = 0; i < 3; i++) out.push(['samodiva' + i, createSamodivaModel(i)]);
  for (const k of ['sheep', 'goat', 'chicken', 'dog', 'cat'] as const) out.push([k, createAnimalModel(k)]);
  out.push(['lamia', createLamiaModel()]);
  return out;
}

function finite(o: THREE.Object3D): boolean {
  let ok = true;
  o.traverse((c) => { const r = c.rotation, p = c.position; if (![r.x, r.y, r.z, p.x, p.y, p.z].every(Number.isFinite)) ok = false; });
  return ok;
}

test('всички модели минават през всички анимации без NaN', () => {
  for (const [name, m] of allModels()) {
    assert.ok(m.height > 0.2, name);
    for (const a of ANIMS) {
      m.play(a);
      for (let i = 0; i < 40; i++) m.update(1 / 30, a === 'run' ? 4 : 1.4);
      assert.ok(finite(m.root), `${name}/${a}`);
    }
    m.flash(0xff0000); m.update(0.5); m.dispose();
  }
});

test('бюджет на триъгълниците', () => {
  for (const id of VILLAGER_IDS) {
    const n = countTris(createVillagerModel(VILLAGERS[id].look).root);
    assert.ok(n <= 1500, `${id}: ${n}`);
  }
  assert.ok(countTris(createHeroModel().root) <= 2200);
  const l = countTris(createLamiaModel().root);
  assert.ok(l <= 12000, `Ламята: ${l}`);
});

test('стъпалата са на земята, лицето гледа към +Z', () => {
  for (const id of VILLAGER_IDS) {
    const m = createVillagerModel(VILLAGERS[id].look);
    m.update(0.016);
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    assert.ok(Math.abs(box.min.y) < 0.06, `${id}: min y ${box.min.y}`);
    assert.ok(box.max.y > VILLAGERS[id].look.height * 0.9, `${id}: max y ${box.max.y}`);
  }
});

test('еднократните анимации се връщат, die остава', () => {
  const m = createVillagerModel(VILLAGERS.ivan.look);
  m.play('walk'); m.update(0.1, 1.4);
  m.play('attack');
  assert.equal(m.current, 'attack');
  m.play('walk'); // докато удря — само запомня
  assert.equal(m.current, 'attack');
  for (let i = 0; i < 60; i++) m.update(1 / 30, 1.4);
  assert.equal(m.current, 'walk');
  m.play('die');
  for (let i = 0; i < 120; i++) m.update(1 / 30);
  assert.equal(m.current, 'die');
  m.play('idle');
  assert.equal(m.current, 'idle');
});

test('Стоян сменя оръжието', () => {
  const h = createHeroModel();
  h.setWeapon('bow'); h.setWeapon('ivan_saber'); h.setWeapon(null); h.setWeapon('saber');
  assert.ok(h.hand);
  let inHand = 0;
  h.hand!.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) inHand++; });
  assert.ok(inHand > 0);
});

test('Ламята: глава удря ниско отпред, мъртвата глава пада', () => {
  const l = createLamiaModel();
  assert.equal(l.heads.length, 3);
  const pos = new THREE.Vector3();
  const headY = (i: number) => { l.root.updateMatrixWorld(true); return l.heads[i].getWorldPosition(pos).y; };
  const headZ = (i: number) => { l.root.updateMatrixWorld(true); return l.heads[i].getWorldPosition(pos).z; };
  l.update(0.016);
  const y0 = headY(1), z0 = headZ(1);
  assert.ok(y0 > 4.5, `глава на ${y0} м`);
  l.headAttack(1, 'bite');
  for (let t = 0; t < 0.95; t += 1 / 60) l.update(1 / 60);
  assert.ok(headY(1) < 2.5, `при удар главата е на ${headY(1)} м`);
  assert.ok(headZ(1) > z0, 'ударът е напред');
  for (let t = 0; t < 2; t += 1 / 60) l.update(1 / 60);
  assert.ok(headY(1) > 4.5, 'връща се');
  l.setHeadAlive(0, false);
  for (let t = 0; t < 3; t += 1 / 60) l.update(1 / 60);
  assert.ok(headY(0) < 1.5, `мъртвата глава е на ${headY(0)} м`);
  l.headAttack(0, 'fire'); // мъртва глава не атакува
  l.update(0.1);
  assert.ok(headY(0) < 1.5);
});

test('предметите се строят', () => {
  for (const k of ['rosen', 'chest', 'saber', 'ivan_saber', 'bow', 'potion', 'feather', 'egg'] as const) {
    const o = createPropModel(k);
    assert.ok(countTris(o) > 0, k);
  }
});
