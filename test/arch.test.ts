// Проби на сградите (без браузър): целият свят от къщи, неща, огради и руини се строи, геометрията е здрава
// и не надхвърля бюджета от триъгълници за видеокартата (GTX 1650).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getPlan } from '../src/world/plan';
import { Kit, SLOTS } from '../src/world/arch/kit';
import { buildHouse, buildProp } from '../src/world/buildings';
import { buildFences, buildRuins, buildSignPosts } from '../src/world/extras';
import { setWeathering } from '../src/world/arch/house';

test('сградите се строят бързо, със здрава геометрия и в бюджета', () => {
  const plan = getPlan(), k = new Kit();
  setWeathering(k);
  const t = performance.now();
  for (const h of plan.houses) buildHouse(k, h);
  for (const p of plan.props) buildProp(k, p);
  for (const f of plan.fences) buildFences(k, [f]);
  buildRuins(k, plan.ruins);
  buildSignPosts(() => k, plan, null);
  const ms = performance.now() - t;
  const total = Object.values(k.stats()).reduce((a, b) => a + b, 0);
  assert.ok(total > 80000 && total < 450000, `триъгълници: ${total}`);
  assert.ok(ms < 8000, `строенето отне ${Math.round(ms)} ms`);
  const mat = new THREE.MeshBasicMaterial();
  const meshes = k.meshes(Object.fromEntries(SLOTS.map((s) => [s, mat])), 'test');
  assert.ok(meshes.length >= 10, `мрежи: ${meshes.length}`);
  for (const m of meshes) {
    const g = m.geometry;
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const a = g.getAttribute(name).array as Float32Array;
      for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${m.name}.${name}[${i}] = ${a[i]}`);
    }
    const idx = g.index!.array, n = g.getAttribute('position').count;
    for (let i = 0; i < idx.length; i++) assert.ok(idx[i] < n, `${m.name}: индекс извън мрежата`);
  }
});

test('прозорците светят: всяка къща има стъкла, ковачницата — жар', () => {
  const plan = getPlan();
  for (const h of plan.houses) {
    const k = new Kit();
    buildHouse(k, h);
    assert.ok((k.stats().glass ?? 0) >= 12 * 8, `${h.id}: малко стъкла`);
  }
  const k = new Kit();
  buildProp(k, plan.props.find((p) => p.type === 'smithy')!);
  assert.ok((k.stats().hot ?? 0) > 0, 'ковачницата няма жар');
});
