// Растителността на света: гората (смърч и ела), широколистни дървета, старият орех на мегдана, сухи дървета,
// храсти, камъни, паднали дънери, папрат, гъби, цветя. Реалистични процедурни модели (src/world/trees/) с
// PBR материали, вятър и нива на детайл: отблизо — пълни модели, средно — по-прости, отдалеч — импостори.
// Местата идват от плана (plan.ts) и не се местят — от тях зависят препятствията.
import * as THREE from 'three';
import { heightAt, normalAt } from './height';
import type { TreeInst, WorldPlan } from './plan';
import { forestMask } from './plan';
import { VILLAGE_CENTER } from '../data/layout';
import { loadTex, pbr } from './tex';
import { buildTreeSet, type TreeModel } from './trees/species';
import { barkMaterial, leafMaterial, depthMaterial, prepassMaterial, type VegUniforms, type VegMatOpts } from './trees/materials';
import { LodField, type LodInstance, type LodVariant, type LodPart } from './trees/lod';
import { bakeImpostors, impostorGeometry, impostorMaterial } from './trees/impostor';
import { rockGeometry, logGeometry, addTriplanar } from './trees/rocks';
import { fernGeometry, mushroomGeometry, flowerGeometry } from './trees/cover';

export type VegQuality = 'low' | 'medium' | 'high';

/** Остава за съвместимост: група от мрежи с най-голямо разстояние (World3D ги крие по разстояние). */
export interface InstGroup { name: string; meshes: THREE.InstancedMesh[]; maxDist: number }

/** Общите стойности за избледняването на дърветата: камерата и героят (обновява ги World3D всеки кадър). */
export interface TreeFadeUniforms { uCamPos: { value: THREE.Vector3 }; uFocus: { value: THREE.Vector3 }; uFadeOn: { value: number } }
export function treeFadeUniforms(): TreeFadeUniforms {
  return { uCamPos: { value: new THREE.Vector3(0, -1e4, 0) }, uFocus: { value: new THREE.Vector3() }, uFadeOn: { value: 1 } };
}

// ---------------------------------------------------------------- граници на нивата по качество (м)
interface QSet { tree: number[]; treeFar: number; bush: number[]; rock: number[]; midShadow: boolean }
const Q: Record<VegQuality, QSet> = {
  high: { tree: [24, 70], treeFar: 520, bush: [22, 140], rock: [28, 200], midShadow: true }, // по-къси за GTX 1650 (гората е най-скъпата)
  medium: { tree: [20, 65], treeFar: 420, bush: [18, 120], rock: [22, 190], midShadow: false },
  low: { tree: [10, 40], treeFar: 300, bush: [10, 70], rock: [12, 110], midShadow: false },
};
const FADE = 6;

/** Хеш 0..1 от координати — за избор на вариант. */
const h01 = (x: number, z: number, k = 0) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };

/** Височината на основата: на стръмно — малко по-дълбоко, за да не виси. */
function baseY(t: TreeInst, sink: number, steepK: number): number {
  const steep = 1 - normalAt(t.x, t.z)[1];
  return heightAt(t.x, t.z) - sink * t.s - steep * steepK * t.s;
}

interface TreeMats { bark: THREE.MeshStandardMaterial; leaf: THREE.MeshStandardMaterial | null; bd: THREE.Material; ld: THREE.Material | null; pre: THREE.Material | null }
interface Simple { meshes: THREE.InstancedMesh[]; maxDist: number; win: THREE.Vector4 }

export class Vegetation {
  readonly group = new THREE.Group();
  readonly u: VegUniforms;
  private fields: LodField[] = [];
  private trees!: LodField; private broad!: LodField; private dead!: LodField; private bushes!: LodField; private rocks!: LodField;
  private simple: Simple[] = [];
  private walnut: THREE.InstancedMesh[] = [];
  private impostorLod = new THREE.Vector4(1e5, 1e5 + 1, 1e5 + 2, 1e5 + 3);
  private impostorReady = false;
  private bakeInputs: { model: TreeModel; bark: THREE.MeshStandardMaterial; leaf: THREE.MeshStandardMaterial | null }[] = [];
  private bakeTex: THREE.Texture[] = [];
  private quality: VegQuality = 'high';
  private ds = 1;
  private tmp = new THREE.Vector3();
  private leafTex!: Record<'spruce' | 'fir' | 'oak' | 'ash', THREE.Texture>;
  private leafCol!: Record<'spruce' | 'fir' | 'oak' | 'ash', THREE.Color>;

  constructor(plan: WorldPlan, fade: TreeFadeUniforms, private renderer: THREE.WebGLRenderer | null, scene: THREE.Scene | null, private camera: THREE.Camera | null) {
    this.group.name = 'vegetation';
    this.u = { ...fade, uTime: { value: 0 }, uWind: { value: 0.5 } };
    this.build(plan);
    // разпределянето по нива става точно преди рисуването — с крайното положение на камерата за кадъра
    if (scene && camera) {
      const prev = scene.onBeforeRender;
      scene.onBeforeRender = (...a: Parameters<THREE.Scene['onBeforeRender']>) => {
        prev.apply(scene, a);
        if (a[2] === this.camera) this.cull(a[2]);
      };
    }
  }

  // ================================================================ строене
  /** Материалите на един модел за всяко ниво (прозорците wins са общи за полето). */
  private treeMats(wins: THREE.Vector4[], model: TreeModel, barkP: THREE.MeshStandardMaterialParameters, bend: number, camFade = true, prepass = true): TreeMats[] {
    return wins.map((w, l) => {
      const o: VegMatOpts = { lod: w, crownR: Math.max(2.2, model.radius * 0.6), top: model.height, bend, camFade };
      const bark = barkMaterial(this.u, o, { ...barkP });
      const leaf = model.leaf ? leafMaterial(this.u, o, { map: this.leafTex[model.leaf], color: this.leafCol[model.leaf] }, prepass) : null;
      // сенките на средното ниво — плътни карти (без alpha-test)
      return { bark, leaf, bd: depthMaterial(this.u, o), ld: model.leaf ? depthMaterial(this.u, o, l > 0) : null, pre: leaf && prepass ? prepassMaterial(this.u, o, leaf) : null };
    });
  }

  private variantOf(model: TreeModel, mats: TreeMats[], shadow: boolean[]): LodVariant {
    return {
      height: model.height, radius: model.radius,
      lods: model.lods.map((l, i) => {
        const parts: LodPart[] = [{ geo: l.bark, mat: mats[i].bark, depth: mats[i].bd, castShadow: shadow[i] }];
        if (l.leaves && mats[i].leaf) parts.push({ geo: l.leaves, mat: mats[i].leaf!, depth: mats[i].ld!, pre: mats[i].pre ?? undefined, castShadow: shadow[i] });
        return parts;
      }),
    };
  }

  private treeField(name: string, models: TreeModel[], insts: LodInstance[], ends: number[], far: number, barkP: (i: number) => THREE.MeshStandardMaterialParameters, bend: number, shadow = [true, true], camFade = true): LodField {
    const wins = [new THREE.Vector4(), new THREE.Vector4()];
    const variants = models.map((m, i) => this.variantOf(m, this.treeMats(wins, m, barkP(i), bend, camFade), shadow));
    const f = new LodField(name, variants, insts, { ends, fade: FADE, windows: wins });
    this.fields.push(f); this.group.add(f.group);
    return f;
  }

  private build(plan: WorldPlan): void {
    const u = this.u, q = Q.high;
    const set = buildTreeSet();
    // --- текстури
    // кора: цвят + нормали + грапавост (зеленият канал на arm); без aoMap/metalnessMap — оклузията е във върховете,
    // а металът е 0 (две четения на текстура по-малко на всеки пиксел)
    const barkOf = (id: string): THREE.MeshStandardMaterialParameters => {
      const p = pbr(id);
      return { map: p.map, normalMap: p.normalMap, roughnessMap: p.roughnessMap, roughness: 1, metalness: 0 };
    };
    const coniferBark = barkOf('pine_bark');
    const broadBark = barkOf('bark_brown_02');
    const spruceTex = loadTex('trees/spruce_spray.png', { srgb: true });
    const oakTex = loadTex('trees/oak_cluster.png', { srgb: true });
    const ashTex = loadTex('trees/ash_cluster.png', { srgb: true });
    const mossTex = loadTex('tex/mossy_rock/mossy_rock_diff_1k.jpg', { srgb: true });
    const rockMap = loadTex('tex/rock_boulder_dry/rock_boulder_dry_diff_1k.jpg', { srgb: true });
    const rockNor = loadTex('tex/rock_boulder_dry/rock_boulder_dry_nor_gl_1k.jpg');
    const fernMap = loadTex('tex/fern_02/fern_02_diff_1k.jpg', { srgb: true, wrap: false });
    const fernAlpha = loadTex('tex/fern_02/fern_02_alpha_1k.jpg', { wrap: false });
    this.bakeTex = [coniferBark.map!, broadBark.map!, spruceTex, oakTex, ashTex];
    this.leafTex = { spruce: spruceTex, fir: spruceTex, oak: oakTex, ash: ashTex };
    // цветове на листата (умножават снимката): смърчът — тъмнозелен, елата — още по-тъмна и синкава
    this.leafCol = { spruce: new THREE.Color(0.5, 0.6, 0.55), fir: new THREE.Color(0.42, 0.53, 0.52), oak: new THREE.Color(0.85, 0.92, 0.78), ash: new THREE.Color(0.88, 0.95, 0.8) };

    // ================= иглолистна гора (смърч, ела) — кората е сиво-кафява (текстурата на бора е по-червена)
    const coniferBarkP: THREE.MeshStandardMaterialParameters = { ...coniferBark, color: new THREE.Color(0.5, 0.47, 0.48) };
    const firBarkP: THREE.MeshStandardMaterialParameters = { ...coniferBark, color: new THREE.Color(0.66, 0.66, 0.68) };
    const coniferInsts: LodInstance[] = plan.pines.map((t) => {
      const hsh = h01(t.x, t.z);
      const fir = hsh < 0.26;
      const v = fir ? (t.s < 0.95 ? 5 : 4) : t.s < 0.95 ? (hsh < 0.63 ? 0 : 1) : (hsh < 0.63 ? 2 : 3);
      const sc = (17.5 * t.s) / set.conifers[v].height;
      const k = 0.88 + t.tint * 0.22;
      return { x: t.x, y: baseY(t, 0.25, 1.4), z: t.z, s: sc, rot: t.rot, v, r: k * (0.96 + h01(t.z, t.x, 1) * 0.08), g: k, b: k * (0.94 + h01(t.x, t.z, 2) * 0.1) };
    });
    this.trees = this.treeField('conifers', set.conifers, coniferInsts, q.tree, q.treeFar, (i) => (i >= 4 ? firBarkP : coniferBarkP), 0.35);

    // ================= широколистни (дъб; плодни дървета в дворовете)
    const broadModels = [...set.oaks, ...set.fruit];
    const broadBarkP: THREE.MeshStandardMaterialParameters = { ...broadBark, color: new THREE.Color(0.85, 0.82, 0.78) };
    const broadInsts: LodInstance[] = plan.oaks.map((t) => {
      const yard = Math.hypot(t.x - VILLAGE_CENTER.x, t.z - VILLAGE_CENTER.z) < 72 && t.s < 0.96;
      const v = yard ? 2 : h01(t.x, t.z) < 0.5 ? 0 : 1;
      const k = 0.9 + t.tint * 0.2;
      return { x: t.x, y: baseY(t, 0.15, 1.2), z: t.z, s: t.s * (yard ? 1 : 1.05), rot: t.rot, v, r: k, g: k, b: k * 0.95 };
    });
    this.broad = this.treeField('broadleaf', broadModels, broadInsts, q.tree, q.treeFar, () => broadBarkP, 0.25);

    // ================= старият орех на мегдана (един, винаги в пълен детайл)
    const wp = plan.props.find((p) => p.type === 'walnut');
    if (wp) {
      const m = set.walnut;
      const mats = this.treeMats([new THREE.Vector4(-2, -1, 1e5, 1e5 + 1)], m, broadBarkP, 0.15, true, false)[0];
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3(wp.x, heightAt(wp.x, wp.z) - 0.15, wp.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wp.rot), new THREE.Vector3(1, 1, 1));
      const parts: [THREE.BufferGeometry, THREE.Material, THREE.Material][] = [[m.lods[0].bark, mats.bark, mats.bd]];
      if (m.lods[0].leaves && mats.leaf) parts.push([m.lods[0].leaves, mats.leaf, mats.ld!]);
      for (const [g, mt, dm] of parts) {
        const im = new THREE.InstancedMesh(g, mt, 1);
        im.setMatrixAt(0, mtx); im.setColorAt(0, new THREE.Color(1, 1, 1));
        im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = dm; im.name = 'walnut';
        im.computeBoundingSphere();
        this.walnut.push(im); this.group.add(im);
      }
    }

    // ================= сухи дървета
    const deadBarkP: THREE.MeshStandardMaterialParameters = { ...coniferBark, color: new THREE.Color(0.72, 0.7, 0.68) };
    const deadInsts: LodInstance[] = plan.deadTrees.map((t) => {
      const k = 0.85 + t.tint * 0.2;
      return { x: t.x, y: baseY(t, 0.2, 1.2), z: t.z, s: t.s, rot: t.rot, v: h01(t.x, t.z) < 0.5 ? 0 : 1, r: k, g: k, b: k };
    });
    this.dead = this.treeField('deadTrees', set.dead, deadInsts, [24, 320], 320, () => deadBarkP, 0.12);

    // ================= храсти (шипка / леска)
    const bushInsts: LodInstance[] = plan.bushes.map((t) => {
      const dry = t.tint > 0.85, forest = Math.abs(t.tint - 0.7) < 1e-6;
      const k = 0.85 + h01(t.x, t.z, 3) * 0.25;
      const c = dry ? [0.95, 0.78, 0.45] : forest ? [0.72 * k, 0.8 * k, 0.68 * k] : [0.9 * k, 0.96 * k, 0.82 * k];
      return { x: t.x, y: baseY(t, 0.1, 0.8), z: t.z, s: t.s, rot: t.rot, v: h01(t.x, t.z, 5) < 0.5 ? 0 : 1, r: c[0], g: c[1], b: c[2] };
    });
    this.bushes = this.treeField('bushes', set.bushes, bushInsts, q.bush, q.bush[1], () => broadBarkP, 0.06, [true, false], false);

    // ================= камъни: 0–1 горски (много мъх), 2–3 по поляните (малко лишеи), 4–5 голи (коритото, арената, кръгът)
    const rockShapes: [number, number, number][] = [[1.2, 0.72, 1.0], [1.0, 0.85, 0.9], [1.35, 0.6, 1.05], [0.95, 0.95, 1.0]];
    const rockWins = [new THREE.Vector4(), new THREE.Vector4()];
    const rockMats = [1.0, 0.3, 0.0].map((moss) => rockWins.map((w) => {
      const o: VegMatOpts = { lod: w, crownR: 1, top: 1, bend: 0, camFade: false };
      const mat = barkMaterial(u, o, { roughness: 0.88, metalness: 0 });
      addTriplanar(mat, { map: rockMap, nor: rockNor, moss: mossTex, scale: 0.42, moss01: moss });
      return { mat, depth: depthMaterial(u, o) };
    }));
    const rockVariants: LodVariant[] = [0, 1, 2, 3, 4, 5].map((i) => {
      const grp = i < 2 ? 0 : i < 4 ? 1 : 2, shape = rockShapes[i % 4];
      const lods = [rockGeometry(700 + i, 5, shape), rockGeometry(700 + i, 2, shape)];
      return { height: 1.2, radius: 1.4, lods: lods.map((g, l) => [{ geo: g, mat: rockMats[grp][l].mat, depth: rockMats[grp][l].depth, castShadow: true }]) };
    });
    const rockInsts: LodInstance[] = plan.rocks.map((t) => {
      const bare = t.tint < 0 || t.tint >= 2;
      const hv = h01(t.x, t.z, 7) < 0.5 ? 0 : 1;
      const v = bare ? 4 + hv : forestMask(t.x, t.z) > 0.15 ? hv : 2 + hv;
      const c = t.tint < 0 ? [0.42, 0.39, 0.37] : t.tint >= 3 ? [1.3, 1.28, 1.22] : t.tint >= 2 ? [1.08, 1.04, 0.96] : [0.82 + t.tint * 0.22, 0.82 + t.tint * 0.2, 0.8 + t.tint * 0.18];
      return { x: t.x, y: baseY(t, 0.25, 2.2), z: t.z, s: t.s, rot: t.rot, v, r: c[0], g: c[1], b: c[2] };
    });
    this.rocks = new LodField('rocks', rockVariants, rockInsts, { ends: q.rock, fade: FADE, windows: rockWins });
    this.rocks.keepNear = 12;
    this.fields.push(this.rocks); this.group.add(this.rocks.group);

    // ================= дребните: дънери, папрат, гъби, цветя — прости парчета 100×100 м
    const simpleOpts = (far: number): VegMatOpts => ({ lod: new THREE.Vector4(-2, -1, far - 10, far), crownR: 1, top: 1, bend: 0, camFade: false });
    const logMat = barkMaterial(u, simpleOpts(160), { ...coniferBark, color: new THREE.Color(0.7, 0.66, 0.6) });
    addMoss(logMat, mossTex);
    this.addSimple('logs', logGeometry(801, 0), logMat, plan.logs, { maxDist: 160, sink: 0.1, castShadow: true });
    const fernMat = leafMaterial(u, simpleOpts(110), { map: fernMap, alphaMap: fernAlpha, color: new THREE.Color(0.62, 0.72, 0.5), alphaTest: 0.45 });
    this.addSimple('ferns', fernGeometry(901, 0), fernMat, plan.ferns, { maxDist: 110, sink: 0.05, castShadow: false, scale: 1.1, tint: (t, c) => { const k = 0.85 + t.tint * 0.3; c.setRGB(k, k, k * 0.95); } });
    const mushMat = barkMaterial(u, simpleOpts(70), { roughness: 0.55, metalness: 0 });
    this.addSimple('mushrooms', mushroomGeometry(1001, 'amanita'), mushMat, plan.mushrooms.filter((t) => t.tint < 0.7), { maxDist: 70, sink: 0, castShadow: false, scale: 1.6 });
    this.addSimple('boletes', mushroomGeometry(1009, 'bolete'), mushMat, plan.mushrooms.filter((t) => t.tint >= 0.7), { maxDist: 70, sink: 0, castShadow: false, scale: 1.6 });
    const flowerMat = barkMaterial(u, simpleOpts(120), { roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    tintOnlyWhite(flowerMat);
    const flowerCols = [[1, 1, 1], [1, 0.85, 0.3], [0.95, 0.5, 0.72], [0.55, 0.62, 1]];
    this.addSimple('flowers', flowerGeometry(1101), flowerMat, plan.flowers, { maxDist: 120, sink: 0, castShadow: false, tint: (t, c) => { const f = flowerCols[Math.floor(t.tint * 4) % 4]; c.setRGB(f[0], f[1], f[2]); } });

    // --- какво ще снимаме за импосторите (иглолистни + широколистни, в този ред на редовете)
    this.bakeInputs = [...set.conifers.map((m, i) => ({ model: m, ...this.matsOf(this.trees, i) })), ...broadModels.map((m, i) => ({ model: m, ...this.matsOf(this.broad, i) }))];
  }

  private matsOf(f: LodField, v: number): { bark: THREE.MeshStandardMaterial; leaf: THREE.MeshStandardMaterial | null } {
    const parts = f.variants[v].lods[0];
    return { bark: parts[0].mat as THREE.MeshStandardMaterial, leaf: (parts[1]?.mat as THREE.MeshStandardMaterial) ?? null };
  }

  private addSimple(name: string, geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, list: TreeInst[], o: { maxDist: number; sink: number; castShadow: boolean; tint?: (t: TreeInst, c: THREE.Color) => void; scale?: number }): void {
    if (!list.length) return;
    const CH = 100;
    const buckets = new Map<string, TreeInst[]>();
    for (const t of list) { const k = `${Math.floor(t.x / CH)},${Math.floor(t.z / CH)}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t); }
    const meshes: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    for (const arr of buckets.values()) {
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach((t, i) => {
        const sc = t.s * (o.scale ?? 1);
        m.compose(v.set(t.x, baseY(t, o.sink, 0.6), t.z), q.setFromEuler(e.set(0, t.rot, 0)), s.set(sc, sc, sc));
        im.setMatrixAt(i, m);
        c.setRGB(1, 1, 1); o.tint?.(t, c); im.setColorAt(i, c);
      });
      im.computeBoundingSphere(); im.computeBoundingBox();
      im.castShadow = o.castShadow; im.receiveShadow = true; im.name = name;
      meshes.push(im); this.group.add(im);
    }
    const win = (mat.userData as { veg?: { uLod: { value: THREE.Vector4 } } }).veg?.uLod.value ?? new THREE.Vector4();
    this.simple.push({ meshes, maxDist: o.maxDist, win });
  }

  // ================================================================ всеки кадър
  /** time — секунди; wind — силата на вятъра (0..1.7). */
  update(dt: number, time: number, wind: number): void {
    this.u.uTime.value = time;
    this.u.uWind.value += (wind - this.u.uWind.value) * Math.min(1, dt * 0.5);
    if (!this.impostorReady && this.renderer && this.bakeTex.every((t) => !!t.image)) this.bake();
    if (!this.camera) return;
    // дребните неща: цели парчета по разстояние + плавно изчезване в края
    const cam = this.camera.position;
    for (const g of this.simple) {
      const md = g.maxDist * this.ds;
      g.win.set(-2, -1, md - 10, md);
      for (const m of g.meshes) {
        const bs = m.boundingSphere; if (!bs) continue;
        m.visible = this.tmp.copy(bs.center).distanceTo(cam) - bs.radius < md;
      }
    }
  }

  /** Кои екземпляри на какво ниво — с точната камера за кадъра (вика се от scene.onBeforeRender). */
  cull(cam: THREE.Camera): void {
    this.u.uCamPos.value.copy(cam.position);
    for (const f of this.fields) f.update(cam);
  }

  private bake(): void {
    this.impostorReady = true;
    const t0 = performance.now();
    const atlas = bakeImpostors(this.renderer!, this.bakeInputs);
    const geo = impostorGeometry();
    const nConifer = this.trees.variants.length;
    for (const [f, rowOff] of [[this.trees, 0], [this.broad, nConifer]] as [LodField, number][]) {
      f.addLevel(f.variants.map((_, v) => [{ geo, mat: impostorMaterial(this.u, atlas, this.impostorLod, rowOff + v), castShadow: false }]), this.impostorLod, false);
    }
    this.applyQuality();
    console.info(`Импостори: ${this.bakeInputs.length} вида за ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /** ds — множител на разстоянията (по-малко при по-ниско качество). */
  setQuality(q: VegQuality, ds: number): void {
    this.quality = q; this.ds = ds;
    this.applyQuality();
  }

  private applyQuality(): void {
    const q = Q[this.quality], ds = this.ds;
    const far = q.treeFar * ds;
    // без импостори средното ниво стига до края (докато се снимат при старта)
    const midEnd = this.impostorReady ? q.tree[1] : far;
    for (const f of [this.trees, this.broad]) { f.setEnds([q.tree[0], midEnd]); f.setShadows(1, q.midShadow); }
    this.impostorLod.set(q.tree[1], q.tree[1] + FADE, far - 12, far);
    this.dead.setEnds([24, 320 * ds]);
    this.bushes.setEnds([q.bush[0], q.bush[1] * ds]);
    this.rocks.setEnds([q.rock[0], q.rock[1] * ds]);
    this.rocks.setShadows(1, q.midShadow);
  }

  /** За доклада: колко екземпляра на кое ниво се рисуват. */
  stats(): Record<string, number[]> {
    const o: Record<string, number[]> = {};
    for (const f of this.fields) o[f.name] = f.counts();
    return o;
  }
}

/** Мъх отгоре по повърхностите, гледащи нагоре (дънери). */
function addMoss(mat: THREE.MeshStandardMaterial, moss: THREE.Texture): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uMossMap = { value: moss };
    sh.vertexShader = 'varying vec3 vMossW; varying float vMossUp;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      { vec4 mw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        mw = instanceMatrix * mw;
        vMossUp = normalize(mat3(instanceMatrix) * objectNormal).y;
        #else
        vMossUp = objectNormal.y;
        #endif
        vMossW = (modelMatrix * mw).xyz; }
      #include <project_vertex>`);
    sh.fragmentShader = 'uniform sampler2D uMossMap; varying vec3 vMossW; varying float vMossUp;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec4 mc = texture2D(uMossMap, vMossW.xz * 0.5);
        float mk = smoothstep(0.25, 0.75, vMossUp + (mc.g - 0.3) * 0.8);
        diffuseColor.rgb = mix(diffuseColor.rgb, mc.rgb * vec3(0.75, 0.95, 0.6), mk); }`);
  };
  const key = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => key + 'moss';
}

/** Цветът на екземпляра оцветява само белите върхове (венчелистчетата), не стъблата. */
function tintOnlyWhite(mat: THREE.MeshStandardMaterial): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `
      vColor = vec3(1.0);
      vColor *= color.xyz;
      #ifdef USE_INSTANCING_COLOR
      if (color.g > 0.95 && color.b > 0.95) vColor *= instanceColor.xyz;
      #endif`);
  };
  const key = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => key + 'petal';
}
