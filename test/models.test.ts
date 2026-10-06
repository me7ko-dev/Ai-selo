// Проби за моделите: строят се в Node, всички анимации вървят без NaN, бюджет на триъгълниците, еднократните анимации се връщат.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VILLAGERS, VILLAGER_IDS } from '../src/data/villagers';
import {
  createVillagerModel, createHeroModel, createMonsterModel, createSamodivaModel, createAnimalModel, createLamiaModel, createPropModel,
  countTris, preloadCharacters, charactersReady, type AnimName, type CharacterModel,
} from '../src/models';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { initCharacterAssets, resetCharacters } from '../src/models/gltf/assets';
import { villagerSpec, heroSpec, samodivaSpec, paletteArray, G, HAIR } from '../src/models/gltf/looks';
import { chooseClip, locomotionClip, CLIPS, ONE_SHOTS } from '../src/models/gltf/animmap';
import { ONE_SHOT } from '../src/models/rig';

const ANIMS: AnimName[] = ['idle', 'walk', 'run', 'attack', 'attack2', 'hit', 'die', 'talk', 'work', 'sit', 'sleep', 'dance', 'jump', 'cast', 'wave', 'block'];

function allModels(): [string, CharacterModel][] {
  const out: [string, CharacterModel][] = VILLAGER_IDS.map((id) => [id, createVillagerModel(VILLAGERS[id].look)]);
  out.push(['hero', createHeroModel()], ['talasam', createMonsterModel('talasam')], ['fox', createMonsterModel('fox_talasam')], ['karakondzhul', createMonsterModel('karakondzhul')]);
  for (let i = 0; i < 3; i++) out.push(['samodiva' + i, createSamodivaModel(i)]);
  for (const k of ['sheep', 'goat', 'chicken', 'dog', 'cat', 'horse'] as const) out.push([k, createAnimalModel(k)]);
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
  const k = createMonsterModel('karakondzhul');
  assert.ok(countTris(k.root) <= 3000, `Караконджул: ${countTris(k.root)}`);
  assert.ok(k.height > 2.5);
  const l = countTris(createLamiaModel().root);
  assert.ok(l <= 20000, `Ламята: ${l}`); // гладки форми за PBR люспите (един бос — евтино)
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

test('мешовете са слети (малко draw call-ове)', () => {
  const count = (o: THREE.Object3D) => { let n = 0; o.traverse((c) => { if ((c as THREE.Mesh).isMesh || (c as THREE.Sprite).isSprite) n++; }); return n; };
  for (const [name, m] of allModels()) {
    const n = count(m.root);
    const lim = name === 'lamia' ? 60 : name === 'horse' ? 16 : ['sheep', 'goat', 'chicken', 'dog', 'cat', 'fox'].includes(name) ? 12 : 25;
    assert.ok(n <= lim, `${name}: ${n} меша`);
  }
  // анимацията продължава да мести слетите части
  const v = createVillagerModel(VILLAGERS.kalin.look);
  const sk = v.root.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
  assert.ok(sk && sk.skeleton.bones.length >= 17);
});

// ───────────────────────── реалистичните хора (src/models/gltf) ─────────────────────────
// В Node няма браузър → фабриките дават процедурните модели (горе); тук — чистата логика и файловете.

test('хората: в Node (без браузър) остават процедурните модели', async () => {
  assert.equal(await preloadCharacters({ quality: 'high' }), false);
  assert.equal(charactersReady(), false);
  const m = createVillagerModel(VILLAGERS.radka.look);
  assert.ok(!m.root.name.startsWith('gltf-'));
});

test('хората: носията на всеки жител', () => {
  for (const id of VILLAGER_IDS) {
    const look = VILLAGERS[id].look;
    const s = villagerSpec(look);
    assert.equal(s.body, look.gender === 'f' ? 'F' : 'M', id);
    assert.ok(s.cloth.includes(G.SHIRT), id + ': бяла риза');
    assert.equal(s.colors[G.SASH][0], look.belt, id + ': пояс');
    if (look.gender === 'f') {
      assert.ok(s.folk.includes(G.SKIRT), id + ': пола');
      assert.equal(s.folk.includes(G.APRON), !!look.apron, id + ': престилка');
      assert.equal(s.folk.includes(G.SCARF), !!look.scarf, id + ': забрадка');
    } else {
      assert.ok(s.folk.includes(G.VEST) && s.folk.includes(G.SASH), id + ': елек и пояс');
      assert.equal(s.hair.includes(HAIR.kalpak), look.hat === 'kalpak', id + ': калпак');
    }
    assert.equal(s.hair.includes(HAIR.beard), look.beard === 'full', id + ': брада');
    assert.equal(s.hair.includes(HAIR.mustache), look.beard === 'mustache', id + ': мустак');
    assert.ok(s.height > 1.4 && s.height < 2.1);
    assert.equal(s.stoop > 0, look.age === 'old', id + ': прегърбен е само старият');
    for (const k of s.hair) assert.ok(s.hairColors[k], id + ': цвят на косата');
  }
  assert.ok(villagerSpec(VILLAGERS.ivan.look).folk.includes(G.LEATHER), 'ковачът е с кожена престилка');
  const h = heroSpec();
  assert.equal(h.body, 'H');
  assert.equal(h.colors[G.HOOD][0], '#6b4a2f', 'кафявата качулка на Стоян');
  const hair = new Set([0, 1, 2, 3, 4].map((i) => samodivaSpec(i).hairColors[HAIR.flowing]));
  assert.ok(hair.size >= 3, 'самодивите се различават');
  assert.ok(samodivaSpec(0).glow && samodivaSpec(0).folk.includes(G.DRESS));
  const pal = paletteArray({ [G.SHIRT]: ['#ffffff', 1], [G.SASH]: ['#b3262b', 0.5] });
  assert.equal(pal.length, 80);
  assert.deepEqual([...pal.slice(4, 8)], [1, 1, 1, 1]);
  assert.ok(Math.abs(pal[12] - 0.451) < 0.01 && pal[15] === 0.5, 'линеен червен');
});

test('хората: всяка анимация на играта има клип', () => {
  const clips = new Set<string>(Object.values(CLIPS));
  for (const role of ['villager', 'hero', 'samodiva'] as const) {
    for (const tool of [undefined, 'staff', 'hammer', 'crook', 'basket', 'spindle', 'tray', 'saw', 'pipe'] as const) {
      for (const weapon of [null, 'saber', 'bow'] as const) {
        for (const a of ANIMS) {
          const c = chooseClip(a, { role, tool, weapon, old: tool === 'staff' });
          assert.ok(clips.has(c.clip), `${role}/${tool}/${a}: ${c.clip}`);
          assert.equal(c.loop, !ONE_SHOTS.has(a), a);
          if (c.from !== undefined && c.to !== undefined) assert.ok(c.to > c.from);
        }
      }
    }
  }
  assert.deepEqual([...ONE_SHOTS].sort(), [...ONE_SHOT].sort(), 'същите еднократни като процедурните');
  // ходене → тичане → спринт, с хистерезис
  assert.equal(locomotionClip(1.3, null), CLIPS.walk);
  assert.equal(locomotionClip(1.3, null, true), CLIPS.walkOld);
  assert.equal(locomotionClip(4.6, null), CLIPS.jog);
  assert.equal(locomotionClip(8.2, null), CLIPS.sprint);
  assert.equal(locomotionClip(2.5, CLIPS.jog), CLIPS.jog);
  assert.equal(locomotionClip(2.5, CLIPS.walk), CLIPS.walk);
});

test('хората: people.glb и anims.glb отговарят на договора', async () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/chars');
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const people = await io.read(path.join(dir, 'people.glb'));
  const nodes = people.getRoot().listNodes();
  const byName = (n: string) => nodes.find((x) => x.getName() === n);
  for (const body of ['M', 'F', 'H']) {
    assert.ok(byName(body), 'тяло ' + body);
    for (const part of body === 'H' ? ['cloth', 'skin', 'eyes'] : ['cloth', 'folk', 'skin', 'eyes']) {
      const n = byName(body + '_' + part);
      assert.ok(n?.getMesh() && n.getSkin(), body + '_' + part);
      assert.equal(n!.getSkin()!.listJoints().length, 65);
      const prim = n!.getMesh()!.listPrimitives()[0];
      assert.ok(prim.getAttribute('_GARMENT'), body + '_' + part + ': етикети на дрехите');
      const tris = prim.getIndices()!.getCount() / 3;
      assert.ok(tris < 16000, `${body}_${part}: ${tris} тр.`);
    }
  }
  const hair = byName('HAIR')!.getMesh()!.listPrimitives()[0];
  const pieces = new Set<number>();
  const g = hair.getAttribute('_GARMENT')!;
  for (let i = 0; i < g.getCount(); i++) pieces.add(g.getScalar(i));
  for (const k of Object.values(HAIR)) assert.ok(pieces.has(k), 'част на косата ' + k);
  const mats = people.getRoot().listMaterials().map((m) => m.getName());
  for (const m of ['cloth_peasant', 'cloth_ranger', 'folk', 'skin_m', 'skin_f', 'eyes', 'hair']) assert.ok(mats.includes(m), m);
  const anims = await io.read(path.join(dir, 'anims.glb'));
  const names = new Set(anims.getRoot().listAnimations().map((a) => a.getName()));
  for (const c of Object.values(CLIPS)) assert.ok(names.has(c), 'клип ' + c);
  const extras = anims.getRoot().getExtras() as { speeds?: Record<string, number> };
  assert.ok(extras.speeds && extras.speeds[CLIPS.walk] > 0.5 && extras.speeds[CLIPS.sprint] > 5, 'скорости на ходене');
  const size = fs.statSync(path.join(dir, 'people.glb')).size + fs.statSync(path.join(dir, 'anims.glb')).size;
  assert.ok(size < 35e6, 'общо под 35 MB');
});

test('хората: реалистичните модели изпълняват договора (в Node, без текстури)', async () => {
  // GLB без картинките (в Node няма Image) → GLTFLoader.parse → същите шаблони като в играта
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/chars');
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const strip = async (file: string) => {
    const d = await io.read(path.join(dir, file));
    for (const t of d.getRoot().listTextures()) t.dispose();
    return (await io.writeBinary(d)).slice().buffer;
  };
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder: ThreeMeshopt } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const loader = new GLTFLoader().setMeshoptDecoder(ThreeMeshopt);
  const people = await loader.parseAsync(await strip('people.glb'), '');
  const anims = await loader.parseAsync(await strip('anims.glb'), '');
  initCharacterAssets(people, anims);
  try {
    assert.equal(charactersReady(), true);
    const all: [string, CharacterModel][] = VILLAGER_IDS.map((id) => [id, createVillagerModel(VILLAGERS[id].look)]);
    const hero = createHeroModel();
    all.push(['hero', hero]);
    for (let i = 0; i < 3; i++) all.push(['samodiva' + i, createSamodivaModel(i)]);
    for (const [name, m] of all) {
      assert.ok(m.root.name.startsWith('gltf-'), name + ': реалистичен');
      assert.ok(m.height > 1.4 && m.height < 2.2, name + ': височина ' + m.height);
      assert.ok(m.hand, name + ': ръка');
      for (const a of ANIMS) {
        m.play(a);
        for (let i = 0; i < 20; i++) m.update(1 / 30, a === 'run' ? 4.5 : a === 'walk' ? 1.3 : 0);
        assert.ok(finite(m.root), `${name}/${a}`);
      }
      // стъпалата на земята (в покой)
      m.play('idle'); for (let i = 0; i < 30; i++) m.update(1 / 30, 0);
      m.root.updateMatrixWorld(true);
      const foot = m.root.getObjectByName('ball_l')!.getWorldPosition(new THREE.Vector3());
      assert.ok(foot.y > -0.05 && foot.y < 0.12, `${name}: стъпало на ${foot.y.toFixed(3)} м`);
      // броят мешове (draw call-ове) на човек — малко
      let draws = 0;
      m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) draws++; });
      assert.ok(draws <= 16, `${name}: ${draws} меша`);
      m.flash(0xff0000); m.update(0.5); m.dispose();
    }
    // еднократните се връщат към предишната; die остава
    const m = createVillagerModel(VILLAGERS.ivan.look);
    m.play('walk'); m.update(0.1, 1.3);
    m.play('attack');
    assert.equal(m.current, 'attack');
    m.play('walk');
    assert.equal(m.current, 'attack');
    for (let i = 0; i < 60; i++) m.update(1 / 30, 1.3);
    assert.equal(m.current, 'walk');
    m.play('die');
    for (let i = 0; i < 150; i++) m.update(1 / 30);
    assert.equal(m.current, 'die');
    m.play('idle');
    assert.equal(m.current, 'idle');
    m.dispose();
    // Стоян: оръжията
    const h = createHeroModel();
    h.setWeapon('bow'); h.setWeapon('ivan_saber'); h.setWeapon(null); h.setWeapon('saber');
    let inHand = 0;
    h.hand!.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) inHand++; });
    assert.ok(inHand > 0, 'сабята е в ръката');
    h.dispose();
  } finally {
    resetCharacters();
  }
  assert.equal(charactersReady(), false);
});
