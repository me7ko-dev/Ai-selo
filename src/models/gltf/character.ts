// Човек от people.glb: клонира скелета и мешовете, облича го (етикети + палитра), закача коса, сечиво/оръжие,
// и го анимира с AnimationMixer по договора на CharacterModel/HeroModel.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimName, HeroModel } from '../types';
import { charAssets, recolorMaterial, skinShader, type BodyTemplate, type CharAssets } from './assets';
import { type CharSpec, BODY_HEIGHT, G, HAIR, paletteArray, hexToLinear } from './looks';
import { chooseClip, locomotionClip, ONE_SHOTS, type AnimContext, type ClipChoice, type Overlay } from './animmap';
import { buildSaber, buildScabbard, buildBow, buildTool } from '../items';
import { mergeStatic, cachedGeo, mat, part, sphGeo, haloSprite } from '../shared';

/** Призрачно сияние по контура (ръбовете към камерата) — таласъмът се вижда в нощната гора, без да свети целият. */
function addRim(m: THREE.MeshStandardMaterial, color: string, strength: number): void {
  const prev = m.onBeforeCompile;
  const uRim = { value: new THREE.Color(color).multiplyScalar(strength) };
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uRim = uRim;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uRim * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );');
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => key + '|rim';
}

let clawMat: THREE.MeshStandardMaterial | null = null;
function pmatClaw(): THREE.MeshStandardMaterial { return clawMat ??= new THREE.MeshStandardMaterial({ color: '#cfc4a2', roughness: 0.35, metalness: 0 }); }

const FLOWERS = [['#ffffff', '#f2d64a', '#e86a8a'], ['#f2d64a', '#ffffff', '#7aa0e8'], ['#e86a8a', '#ffffff', '#f2d64a']];

type Weapon = 'saber' | 'ivan_saber' | 'bow' | null;

// ───────── подмножества на индекса (видими дрехи) — общи за всички копия с един и същи избор ─────────
const subsetCache = new Map<string, THREE.BufferGeometry>();
function subset(geo: THREE.BufferGeometry, labels: number[], key: string): THREE.BufferGeometry {
  const k = geo.uuid + '|' + key + '|' + labels.slice().sort((a, b) => a - b).join(',');
  const hit = subsetCache.get(k);
  if (hit) return hit;
  const gar = geo.getAttribute('_garment');
  const index = geo.getIndex();
  const out = new THREE.BufferGeometry();
  for (const name in geo.attributes) out.setAttribute(name, geo.attributes[name]);
  if (index && gar) {
    const keep = new Set(labels);
    const src = index.array;
    const idx: number[] = [];
    for (let t = 0; t < src.length; t += 3) if (keep.has(Math.round(gar.getX(src[t])))) idx.push(src[t], src[t + 1], src[t + 2]);
    out.setIndex(new THREE.BufferAttribute(geo.attributes.position.count < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), 1));
  } else if (index) out.setIndex(index);
  out.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
  subsetCache.set(k, out);
  return out;
}

/** Еднакви ли са обратните матрици на два скелета (т.е. мешовете могат да делят един). */
function sameInverses(a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  for (let i = 0; i < a.boneInverses.length; i++) {
    const x = a.boneInverses[i].elements, y = b.boneInverses[i]?.elements;
    if (!y) return false;
    for (let k = 0; k < 16; k++) if (Math.abs(x[k] - y[k]) > 1e-5) return false;
  }
  return true;
}

/** Сегментите на наметалото: дължина (м) и наклон назад в покой (z/y). */
const CAPE_SEGS = [{ len: 0.3, k: 0.55 }, { len: 0.3, k: 0.2 }, { len: 0.3, k: 0.12 }];

/**
 * Геометрията на наметалото (в пространството на тялото в покой) по точките на веригата pts (горе → подгъв).
 * Дъга около гърба (краищата идат напред към раменете), разширява се надолу, с леки гънки.
 * Тегла: горният ръб — spine_03 (индекс 0), надолу — костите на веригата (1..3) с плавен преход на ставите.
 */
function capeGeometry(pts: THREE.Vector3[]): THREE.BufferGeometry {
  const segs = CAPE_SEGS;
  const rows = 14, cols = 12, total = segs.reduce((a, s) => a + s.len, 0);
  const n = (rows + 1) * (cols + 1);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const c = new THREE.Vector3();
  for (let r = 0; r <= rows; r++) {
    const t = r / rows, s = t * total;
    let seg = 0, acc = 0;
    while (seg < segs.length - 1 && s > acc + segs[seg].len) { acc += segs[seg].len; seg++; }
    const f = Math.min(1, (s - acc) / segs[seg].len);
    c.copy(pts[seg]).lerp(pts[seg + 1], f);
    const hw = 0.14 + 0.13 * Math.pow(t, 0.8), A = 1.05 - 0.45 * Math.pow(t, 0.6);
    const R = hw / Math.sin(A);
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * 2 - 1, a = u * A;
      const fold = 1 + 0.035 * t * Math.sin(u * Math.PI * 3);
      const k = r * (cols + 1) + j;
      pos[k * 3] = c.x + Math.sin(a) * R * fold;
      pos[k * 3 + 1] = c.y + (r === 0 ? 0.015 * Math.cos((u * Math.PI) / 2) : 0);
      pos[k * 3 + 2] = c.z + (1 - Math.cos(a)) * R * fold;
      uv[k * 2] = (j / cols) * 0.5; uv[k * 2 + 1] = t * 0.5;
      let w: [number, number][];
      if (s < 0.06) w = [[0, 1 - s / 0.06], [1, s / 0.06]];
      else { const g = THREE.MathUtils.smoothstep(f, 0.6, 1) * 0.5; w = [[seg + 1, 1 - g], [Math.min(seg + 2, segs.length), g]]; }
      for (let q = 0; q < 2; q++) { si[k * 4 + q] = w[q][0]; sw[k * 4 + q] = w[q][1]; }
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) for (let j = 0; j < cols; j++) {
    const a = r * (cols + 1) + j, b = a + 1, cc = a + cols + 1, d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('_garment', new THREE.BufferAttribute(new Float32Array(n).fill(G.CLOAK), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpQ3 = new THREE.Quaternion();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export class GltfCharacter implements HeroModel {
  readonly root = new THREE.Group();
  readonly height: number;
  hand?: THREE.Object3D;
  /** Височина на седалката за 'sit' (м). */
  seatHeight: number;
  current: AnimName = 'idle';

  private A: CharAssets;
  private body: BodyTemplate;
  private pivot = new THREE.Group();
  private armature: THREE.Object3D;
  private bones = new Map<string, THREE.Bone>();
  private mixer: THREE.AnimationMixer;
  private ctx: AnimContext;
  private scale: number;
  private ownMats: THREE.MeshStandardMaterial[] = [];
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: { c: THREE.Color; i: number }[] = [];
  private skeletons: THREE.Skeleton[] = [];
  private flashT = 0;

  private action: THREE.AnimationAction | null = null;
  private choice: ClipChoice | null = null;
  private loopReq: AnimName = 'idle';
  private isLoop = true;
  private shotT = 0;
  private shotDur = 0;
  private speedMul = 1;
  private moveSpeed = 0;
  private locoClip: string | null = null;
  private overlay: Overlay = 'none';
  private overlayNext: Overlay = 'none';
  private overlayW = 0;
  private time = Math.random() * 10;
  private alt = new Map<string, boolean>();
  private socketR: THREE.Object3D;
  private socketL: THREE.Object3D;
  private backSlot: THREE.Object3D | null = null;
  private saber?: THREE.Group;
  private ivan?: THREE.Group;
  private bow?: THREE.Group;
  private weapon: Weapon = null;
  /** Костите, които добавките пипат, и тяхната „чиста“ поза от анимацията (виж update). */
  private ovBones: THREE.Bone[] = [];
  private ovBase: THREE.Quaternion[] = [];
  // ── отдалеченост (LOD): далечните хора — без сенки, без очи, анимацията по-рядко ──
  private skinMesh: THREE.SkinnedMesh | null = null;
  private eyes: THREE.SkinnedMesh | null = null;
  private hairMesh: THREE.Mesh | null = null;
  private lodMeshes: THREE.Mesh[] = [];
  private seen = false;
  private everSeen = false;
  private unseen = 0;
  private camDist2 = 0;
  private lodLevel = 0;
  private lodFrame = Math.floor(Math.random() * 4);
  private lodAcc = 0;
  // ── наметалото на Стоян (верига от 3 кости, люлее се процедурно) ──
  private cape: THREE.Bone[] = [];
  private capeLift = 0;

  constructor(readonly spec: CharSpec) {
    const A = charAssets();
    if (!A) throw new Error('хората не са заредени');
    this.A = A;
    this.body = A.bodies[spec.body];
    this.scale = spec.height / BODY_HEIGHT[spec.body];
    this.ctx = { role: spec.role, tool: spec.tool, old: spec.old, weapon: null };
    this.root.name = 'gltf-' + spec.role;
    this.pivot.scale.setScalar(this.scale);
    this.root.add(this.pivot);
    this.armature = SkeletonUtils.clone(this.body.armature);
    this.pivot.add(this.armature);
    this.armature.traverse((o) => { if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone); });
    this.dress();
    this.attachHair();
    this.shape();
    this.socketR = this.makeHandSocket('r');
    this.socketL = this.makeHandSocket('l');
    this.hand = this.socketR;
    this.attachTool();
    if (spec.wreath !== undefined) this.attachWreath(spec.wreath);
    if (spec.role === 'talasam') this.attachTalasam();
    if (spec.cape) this.attachCape(spec.cape);
    this.watchCamera();
    const extra = spec.hair.includes(HAIR.kalpak) ? 0.1 : spec.folk.includes(G.SCARF) ? 0.03 : 0;
    this.height = spec.height + extra;
    this.seatHeight = 0.45 * this.scale;
    for (const n of ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r']) {
      const b = this.bones.get(n);
      if (b) { this.ovBones.push(b); this.ovBase.push(b.quaternion.clone()); }
    }
    this.mixer = new THREE.AnimationMixer(this.armature);
    this.start('idle', true);
    this.update(0);
  }

  // ───────────────────────────── облекло ─────────────────────────────
  private dress(): void {
    const { spec, A } = this;
    const pal = paletteArray(spec.colors);
    const glow = spec.glow ? new THREE.Color().setRGB(...hexToLinear(spec.glow)) : null;
    const meshes: THREE.SkinnedMesh[] = [];
    this.armature.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
    // SkeletonUtils.clone дава на всеки меш свое копие на скелета — връщаме един общ (шаблонът е с общ скелет)
    const shared = meshes[0]?.skeleton;
    for (const m of meshes) {
      if (m.skeleton !== shared && m.skeleton.bones.every((b, i) => b === shared.bones[i]) && sameInverses(m.skeleton, shared)) m.bind(shared, m.bindMatrix);
    }
    for (const m of meshes) {
      const part = m.name.split('_').pop();
      let mat: THREE.MeshStandardMaterial;
      if (part === 'cloth' || part === 'folk') {
        const labels = part === 'cloth' ? spec.cloth : spec.folk;
        if (!labels.length) { m.removeFromParent(); continue; }
        m.geometry = subset(m.geometry, labels, part);
        mat = recolorMaterial(part === 'folk' ? A.materials.folk : spec.body === 'H' ? A.materials.ranger : A.materials.peasant, pal);
        this.ownMats.push(mat);
      } else if (part === 'skin') {
        mat = (spec.female ? A.materials.skinF : A.materials.skinM).clone();
        mat.color.setRGB(spec.skin[0], spec.skin[1], spec.skin[2], THREE.LinearSRGBColorSpace);
        mat.onBeforeCompile = skinShader;
        mat.customProgramCacheKey = () => 'skin-wrap-v1';
        this.ownMats.push(mat);
        this.skinMesh = m;
      } else mat = A.materials.eyes;
      // самодивите светят леко; таласъмът — едва-едва (само силуетът в нощната гора)
      if (glow && part !== 'eyes') { mat.emissive.copy(glow); mat.emissiveIntensity = (part === 'skin' ? 0.08 : 0.22) * (spec.role === 'talasam' ? 0.35 : 1); }
      m.material = mat;
      // очите са мънички — без сянка (един draw call по-малко в картата на сенките)
      if (part === 'eyes') { m.castShadow = false; m.receiveShadow = false; }
      m.frustumCulled = true;
      m.boundingSphere = sphere;
      if (part !== 'eyes') this.flashMats.push(mat);
      else this.eyes = m;
      if (!this.skeletons.includes(m.skeleton)) this.skeletons.push(m.skeleton);
      this.lodMeshes.push(m);
    }
  }

  private attachHair(): void {
    const { spec, A } = this;
    const head = this.bones.get('Head');
    if (!head || !spec.hair.length) return;
    const tpl = A.hair;
    const colors: Record<number, [string, number]> = {};
    for (const k in spec.hairColors) colors[+k] = [spec.hairColors[+k], 1];
    const mat = recolorMaterial(A.materials.hair, paletteArray(colors));
    if (spec.glow) { mat.emissive.setRGB(...hexToLinear(spec.glow)); mat.emissiveIntensity = 0.12; }
    this.ownMats.push(mat); this.flashMats.push(mat);
    const h = new THREE.Mesh(subset(tpl.geometry, spec.hair, 'hair'), mat);
    h.position.copy(tpl.position); h.quaternion.copy(tpl.quaternion); h.scale.copy(tpl.scale);
    h.castShadow = true; h.receiveShadow = true;
    h.name = 'hair';
    head.add(h);
    this.hairMesh = h;
    this.lodMeshes.push(h);
  }

  /** Ширина на торса (пълен/слаб). */
  private shape(): void {
    const b = this.spec.build;
    if (Math.abs(b - 1) < 0.01) return;
    const sp = this.bones.get('spine_01');
    if (sp) sp.scale.set(b, 1, b);
    for (const n of ['neck_01', 'clavicle_l', 'clavicle_r']) this.bones.get(n)?.scale.set(1 / b, 1, 1 / b);
  }

  /** Точка в ръката: при спусната ръка осите съвпадат с тези на тялото (X наляво, Y нагоре, Z напред). */
  private makeHandSocket(side: 'r' | 'l'): THREE.Object3D {
    const s = new THREE.Object3D();
    s.name = 'hand_socket_' + side;
    const bone = this.bones.get('hand_' + side);
    if (!bone) { this.pivot.add(s); return s; }
    const bw = this.body.bindWorld.get('hand_' + side)!;
    // ръката в покой е хоризонтална (T-поза); спусната = завъртяна около Z с ±90°
    const lower = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side === 'r' ? Math.PI / 2 : -Math.PI / 2);
    s.quaternion.copy(lower.multiply(bw)).invert();
    // дланта е ~7 см от китката по посоката на пръстите
    s.position.set(0, 0.075, 0);
    bone.add(s);
    return s;
  }

  /** Венец от полски цветя на главата (самодивите) + слабо сияние около тях. */
  private attachWreath(v: number): void {
    const head = this.bones.get('Head');
    if (!head) return;
    const s = new THREE.Object3D();
    // осите на тялото в покой; венецът е над челото, леко наклонен назад
    s.quaternion.copy(this.body.bindWorld.get('Head')!).invert();
    const hp = this.body.bindPos.get('Head')!;
    s.position.copy(new THREE.Vector3(0, hp.y + 0.15, hp.z + 0.005).sub(hp).applyQuaternion(s.quaternion));
    head.add(s);
    const wr = new THREE.Group();
    wr.rotation.x = -0.32;
    s.add(wr);
    const R = 0.098;
    part(wr, cachedGeo('wreath', () => new THREE.TorusGeometry(1, 0.11, 4, 14)), mat('#4f7a3a'), R, R, R, 0, 0, 0, Math.PI / 2, 0, 0, false);
    const fl = FLOWERS[v % FLOWERS.length];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const c = fl[i % 3];
      part(wr, sphGeo(0), mat(c, { emissive: c, emissiveIntensity: 0.3 }), R * 0.2, R * 0.13, R * 0.2, Math.sin(a) * R, R * 0.06, Math.cos(a) * R, 0, a, 0, false);
    }
    mergeStatic(wr);
    const halo = haloSprite('#cfe0ff', 1.6, 0.12);
    halo.position.set(0, -0.35, 0);
    s.add(halo);
  }

  /** Точка на главата с осите на тялото в покой (X наляво, Y нагоре, Z напред), на (dx, dy, dz) от костта Head. */
  private headPoint(dx: number, dy: number, dz: number): THREE.Object3D | null {
    const head = this.bones.get('Head');
    if (!head) return null;
    const s = new THREE.Object3D();
    s.quaternion.copy(this.body.bindWorld.get('Head')!).invert();
    s.position.set(dx, dy, dz).applyQuaternion(s.quaternion);
    head.add(s);
    return s;
  }

  /** Таласъм: светещи очи (+ ореол), островърхи уши, дълги нокти, сияние по контура. */
  private attachTalasam(): void {
    for (const m of this.ownMats) addRim(m, '#5f9a52', 0.45);
    const eyes: THREE.SkinnedMesh[] = [];
    this.armature.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.name.endsWith('_eyes')) eyes.push(o as THREE.SkinnedMesh); });
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#c8e05a', emissive: '#d8ff5a', emissiveIntensity: 2.2, roughness: 0.3 });
    this.ownMats.push(eyeMat);
    for (const e of eyes) e.material = eyeMat;
    const glowAt = this.headPoint(0, 0.075, 0.1);
    if (glowAt) { const h = haloSprite('#d8ff5a', 0.11, 0.35); glowAt.add(h); }
    // цветът на кожата от talasamSpec (#7c8a70), малко по-тъмен — ушите нямат текстура
    const skin = new THREE.MeshStandardMaterial({ color: '#6c785f', roughness: 0.9, metalness: 0 });
    if (this.spec.glow) { skin.emissive.set(this.spec.glow); skin.emissiveIntensity = 0.08; }
    addRim(skin, '#5f9a52', 0.45);
    this.ownMats.push(skin); this.flashMats.push(skin);
    const ears = this.headPoint(0, 0.065, -0.005);
    if (ears) {
      for (const sx of [1, -1]) {
        // лист, изтеглен назад и нагоре
        const ear = new THREE.Mesh(cachedGeo('talasamEar', () => { const g = new THREE.ConeGeometry(0.022, 0.11, 6); g.scale(1, 1, 0.45); g.translate(0, 0.055, 0); return g; }), skin);
        ear.position.set(sx * 0.072, 0, -0.005);
        ear.rotation.set(-0.75, 0, -sx * 1.05);
        ear.castShadow = true;
        ears.add(ear);
      }
    }
    const nail = pmatClaw();
    for (const side of [this.socketR, this.socketL]) {
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(cachedGeo('talasamClaw', () => { const g = new THREE.ConeGeometry(0.006, 0.05, 5); g.translate(0, 0.025, 0); return g; }), nail);
        c.position.set((i - 1.5) * 0.018, 0.035, 0.012);
        c.rotation.set(0.5, 0, 0);
        side.add(c);
      }
    }
  }

  // ───────────────────────────── сечива и оръжия ─────────────────────────────
  private attachTool(): void {
    const tool = this.spec.tool;
    if (!tool) return;
    const t = buildTool(tool);
    mergeStatic(t);
    switch (tool) {
      case 'staff': case 'crook':
        t.position.set(0, tool === 'staff' ? 0.62 : 0.68, 0.0); t.rotation.set(0.05, 0, 0);
        this.socketR.add(t); break;
      case 'hammer': t.rotation.set(-1.3, 0, 0); this.socketR.add(t); break;
      case 'saw': t.rotation.set(1.25, 0, 0); this.socketR.add(t); break;
      case 'pipe': this.socketR.add(t); break;
      case 'basket': t.position.set(0, 0.08, 0.02); t.rotation.set(0.0, 0, 0); this.socketL.add(t); break;
      case 'spindle': t.position.set(0, 0.05, 0); t.rotation.set(0.35, 0, 0.1); this.socketL.add(t); break;
      case 'tray': t.rotation.set(1.5, 0, 0); t.position.set(0, 0.02, 0); this.socketR.add(t); break;
    }
    t.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  setWeapon(kind: Weapon): void {
    this.weapon = kind;
    this.ctx.weapon = kind;
    if (!this.saber) {
      this.saber = buildSaber(false); mergeStatic(this.saber);
      // ножница на гърба (по диагонал), сабята стои в нея, когато не е в ръката
      const sp = this.bones.get('spine_03');
      if (sp) {
        const slot = new THREE.Object3D();
        const bw = this.body.bindWorld.get('spine_03')!, bp = this.body.bindPos.get('spine_03')!;
        const inv = bw.clone().invert();
        // дръжката над дясното рамо, острието надолу към лявото бедро (в пространството на тялото)
        slot.quaternion.copy(inv).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, Math.PI + 0.6)));
        slot.position.copy(new THREE.Vector3(-0.12, 1.5, -0.17).sub(bp).applyQuaternion(inv));
        sp.add(slot);
        slot.add(buildScabbard());
        this.backSlot = slot;
      }
    }
    const inHand = (g: THREE.Group) => { this.socketR.add(g); g.position.set(0, -0.005, 0.01); g.rotation.set(Math.PI / 2, -Math.PI / 2, 0); g.visible = true; };
    if (kind === 'saber') inHand(this.saber);
    else if (this.backSlot) { this.backSlot.add(this.saber); this.saber.position.set(0, 0, 0); this.saber.rotation.set(0, 0, 0); this.saber.visible = true; }
    else this.saber.visible = false;
    if (kind === 'ivan_saber') {
      if (!this.ivan) { this.ivan = buildSaber(true); mergeStatic(this.ivan); }
      inHand(this.ivan);
    } else if (this.ivan) this.ivan.visible = false;
    if (kind === 'bow' && !this.bow) {
      this.bow = buildBow(); mergeStatic(this.bow);
      this.socketL.add(this.bow);
      this.bow.position.set(0, 0, 0.01);
      this.bow.rotation.set(0, Math.PI / 2, 0); // изправен, дъгата напред
    }
    if (this.bow) this.bow.visible = kind === 'bow';
    for (const g of [this.saber, this.ivan, this.bow]) g?.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  // ───────────────────────────── анимации ─────────────────────────────
  private clip(name: string): THREE.AnimationClip | undefined { return this.body.clips.get(name); }

  /** Действие за клипа; ако същото още играе (напр. удар след удар) — второ копие, за да се смесят. */
  private actionFor(name: string): THREE.AnimationAction | null {
    const c = this.clip(name);
    if (!c) return null;
    let a = this.mixer.clipAction(c);
    if (a === this.action && a.isRunning()) {
      const flip = !this.alt.get(name);
      this.alt.set(name, flip);
      if (flip) {
        let c2 = this.body.clips.get(name + '#2');
        if (!c2) { c2 = c.clone(); c2.name = name + '#2'; this.body.clips.set(c2.name, c2); }
        a = this.mixer.clipAction(c2);
      }
    }
    return a;
  }

  play(anim: AnimName, opts?: { loop?: boolean; speed?: number }): void {
    const loop = opts?.loop ?? !ONE_SHOTS.has(anim);
    if (opts?.speed !== undefined) this.speedMul = opts.speed;
    else if (loop) this.speedMul = 1;
    if (loop) {
      this.loopReq = anim;
      if (!this.isLoop && this.current !== 'die') return; // еднократната довършва и после се връща
      if (this.isLoop && anim === this.current) return;
    }
    this.start(anim, loop);
  }

  private start(anim: AnimName, loop: boolean): void {
    const ch = chooseClip(anim, this.ctx);
    let name = ch.clip;
    const loco = loop && (anim === 'walk' || anim === 'run');
    if (loco) { name = locomotionClip(this.locoSpeed(anim), null, this.spec.old); this.locoClip = name; } else this.locoClip = null;
    const a = this.actionFor(name);
    if (!a) return;
    const clip = a.getClip();
    a.reset();
    a.enabled = true;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.timeScale = ch.speed * this.speedMul;
    if (ch.hold !== undefined) { a.time = clip.duration * ch.hold - 1e-3; a.timeScale = 0; }
    else if (!loop) a.time = ch.from ?? 0;
    else a.time = (this.spec.seed * 7.3 + this.time) % clip.duration; // разминаване между хората
    a.setEffectiveWeight(1);
    if (this.action && this.action !== a) a.crossFadeFrom(this.action, ch.fade, false);
    else a.fadeIn(ch.fade);
    a.play();
    this.action = a;
    this.choice = ch;
    this.current = anim;
    this.isLoop = loop;
    this.shotT = 0;
    const to = ch.to ?? clip.duration;
    this.shotDur = loop ? 0 : Math.max(0.1, (to - (ch.from ?? 0)) / Math.max(0.05, ch.speed * this.speedMul));
    this.overlayNext = ch.overlay;
  }

  /** Скорост за ходенето: истинската, или обичайната, ако моделът стои на място. */
  private locoSpeed(anim: AnimName): number {
    if (this.moveSpeed > 0.05) return this.moveSpeed;
    return anim === 'run' ? 4.5 : 1.3;
  }

  update(dt: number, moveSpeed?: number): void {
    if (moveSpeed !== undefined) this.moveSpeed = moveSpeed;
    // далечните/невидимите — по-рядко (времето се трупа, нищо не се губи)
    const step = this.lodStep();
    this.lodAcc += dt;
    if (step > 1 && (++this.lodFrame % step) !== 0) return;
    dt = Math.min(this.lodAcc, step > 1 ? 0.25 : 0.1);
    this.lodAcc = 0;
    this.time += dt;
    if (this.isLoop && this.locoClip && this.action) {
      const v = this.locoSpeed(this.current);
      const want = locomotionClip(v, this.locoClip, this.spec.old);
      if (want !== this.locoClip) {
        // смяна ходене ↔ тичане: същата фаза на стъпката
        const prev = this.action;
        const phase = prev.time / prev.getClip().duration;
        const a = this.actionFor(want);
        if (a) {
          a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.time = phase * a.getClip().duration;
          a.crossFadeFrom(prev, 0.25, false); a.play();
          this.action = a; this.locoClip = want;
        }
      }
      // крачката според ръста: по-висок → по-дълга крачка → по-бавно темпо
      const native = (this.A.speeds[this.locoClip] ?? 1) * (this.body.pelvisHeight * this.scale) / this.A.animPelvis;
      this.action.timeScale = THREE.MathUtils.clamp(v / native, 0.45, 2.2) * this.speedMul;
    }
    if (!this.isLoop) {
      this.shotT += dt;
      if (this.current !== 'die' && this.shotT >= this.shotDur) this.start(this.loopReq, true);
    }
    // AnimationMixer не пише стойност, която не се е сменила от миналия кадър — затова преди него връщаме
    // „чистата“ поза; иначе добавките (прегърбване, ръце за хоро…) биха се трупали кадър след кадър
    for (let i = 0; i < this.ovBones.length; i++) this.ovBones[i].quaternion.copy(this.ovBase[i]);
    this.mixer.update(dt);
    for (let i = 0; i < this.ovBones.length; i++) this.ovBase[i].copy(this.ovBones[i].quaternion);
    this.applyOverlays(dt);
    if (this.cape.length) this.swayCape(dt);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash(null as unknown as number); }
  }

  // ───────────────────────────── отдалеченост (LOD) ─────────────────────────────
  /** Разстоянието до камерата се разбира при рисуването (само перспективната камера, не сенките). */
  private watchCamera(): void {
    const m = this.skinMesh ?? this.lodMeshes[0];
    if (!m) return;
    m.onBeforeRender = (_r, _s, cam) => {
      if (!(cam as THREE.PerspectiveCamera).isPerspectiveCamera) return;
      const a = cam.matrixWorld.elements, b = this.root.matrixWorld.elements;
      this.camDist2 = (a[12] - b[12]) ** 2 + (a[13] - b[13]) ** 2 + (a[14] - b[14]) ** 2;
      this.seen = true; this.everSeen = true;
    };
  }

  /** През колко кадъра се анимира: 1 близо, 2 над ~22 м, 3 над ~45 м, 4 извън кадъра. Сенки и очи — по разстояние. */
  private lodStep(): number {
    if (!this.everSeen) return 1;
    if (this.seen) this.unseen = 0; else this.unseen++;
    this.seen = false;
    const d2 = this.camDist2;
    // нива с хистерезис: 0 близо, 1 без очи (> 12 м), 2 и без сенки (> 25 м)
    const lvl = this.lodLevel;
    const want = d2 > (lvl >= 2 ? 23 * 23 : 25 * 25) ? 2 : d2 > (lvl >= 1 ? 11 * 11 : 12 * 12) ? 1 : 0;
    if (want !== lvl) {
      this.lodLevel = want;
      if (this.eyes) this.eyes.visible = want === 0;
      for (const m of this.lodMeshes) m.castShadow = want < 2;
    }
    if (this.spec.role === 'hero') return 1;
    if (this.unseen > 2) return 4;
    return d2 > 45 * 45 ? 3 : d2 > 22 * 22 ? 2 : 1;
  }

  // ───────────────────────────── наметало ─────────────────────────────
  /**
   * Наметало от раменете до под коленете: решетка, скинната към spine_03 (горният ръб) и към верига от 3 кости,
   * които всеки кадър се насочват „надолу и назад“ — повече при тичане, с леко полюшване. Отстои от гърба и от
   * ножницата на сабята.
   */
  private attachCape(color: string): void {
    const sp = this.bones.get('spine_03'), neck = this.body.bindPos.get('neck_01');
    if (!sp || !neck) return;
    const bw = this.body.bindWorld.get('spine_03')!, bp = this.body.bindPos.get('spine_03')!;
    const inv = bw.clone().invert();
    const top = new THREE.Vector3(0, neck.y - 0.05, neck.z - 0.1);
    const segs = CAPE_SEGS;
    // кости: cape0 на горния ръб (дете на spine_03), cape1..cape3 по веригата; оста +Y на всяка сочи по сегмента
    const bones: THREE.Bone[] = [];
    let parent: THREE.Object3D = sp;
    const pts = [top.clone()];
    const dirOf = (i: number) => new THREE.Vector3(0, -1, -segs[i].k).normalize();
    for (let i = 0; i <= segs.length; i++) {
      const b = new THREE.Bone();
      b.name = 'cape' + i;
      if (i === 0) {
        b.position.copy(top).sub(bp).applyQuaternion(inv);
        b.quaternion.copy(inv).multiply(new THREE.Quaternion().setFromUnitVectors(Y, dirOf(0)));
      } else {
        b.position.set(0, segs[i - 1].len, 0);
        // в покой всеки сегмент е със своя наклон
        if (i < segs.length) b.quaternion.setFromUnitVectors(dirOf(i - 1), dirOf(i));
        pts.push(pts[i - 1].clone().addScaledVector(dirOf(i - 1), segs[i - 1].len));
      }
      parent.add(b);
      parent = b;
      bones.push(b);
      this.bones.set(b.name, b);
    }
    this.cape = bones;
    const geo = cachedGeo('cape-' + this.spec.body, () => capeGeometry(pts));
    const pal = paletteArray({ ...this.spec.colors, [G.CLOAK]: [color, 1] });
    const m = recolorMaterial(this.A.materials.folk, pal);
    this.ownMats.push(m); this.flashMats.push(m);
    const mesh = new THREE.SkinnedMesh(geo, m);
    mesh.name = 'cape';
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.armature.add(mesh);
    this.root.updateMatrixWorld(true);
    const skel = new THREE.Skeleton([sp, ...bones]);
    mesh.bind(skel, mesh.matrixWorld);
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
    this.skeletons.push(skel);
    this.lodMeshes.push(mesh);
  }

  private swayCape(dt: number): void {
    const moving = this.current === 'walk' || this.current === 'run' ? this.moveSpeed : 0;
    const seated = this.current === 'sit' || this.current === 'ride';
    const want = Math.min(0.95, moving * 0.14) + (seated ? 0.6 : 0) + (this.current === 'attack' || this.current === 'attack2' ? 0.25 : 0);
    this.capeLift += (want - this.capeLift) * (1 - Math.exp(-dt * 3.5));
    const L = this.capeLift, t = this.time;
    const flap = Math.sin(t * 7.5) * 0.06 * Math.min(1, moving / 3);
    const sway = Math.sin(t * 1.3) * 0.03;
    const k = CAPE_SEGS;
    this.aim('cape0', tmpV2.set(sway * 0.5, -1, -(k[0].k + L * 0.5)), 1);
    this.aim('cape1', tmpV2.set(sway, -1, -(k[1].k + L * 1.0 + flap * 0.5)), 1);
    this.aim('cape2', tmpV2.set(sway * 1.5, -1, -(k[2].k + L * 1.25 + flap)), 1);
  }

  // ───────────────────────────── процедурни добавки ─────────────────────────────
  /** Завъртане на кост в пространството на тялото (от корена на скелета до нея). */
  private worldQ(bone: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    const chain: THREE.Object3D[] = [];
    for (let o: THREE.Object3D | null = bone; o && o !== this.armature; o = o.parent) chain.push(o);
    for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
    return out;
  }

  /** Насочва костта (оста ѝ Y) към посока dir в пространството на тялото, с тегло w. */
  private aim(name: string, dir: THREE.Vector3, w: number): void {
    const b = this.bones.get(name);
    if (!b || w <= 0) return;
    const wq = this.worldQ(b, tmpQ);
    const cur = tmpV.copy(Y).applyQuaternion(wq);
    tmpQ2.setFromUnitVectors(cur, tmpV2.copy(dir).normalize());
    const target = tmpQ2.multiply(wq);                                   // ново световно
    const parentW = b.parent ? this.worldQ(b.parent, tmpQ3) : tmpQ3.identity();
    const local = parentW.invert().multiply(target);
    b.quaternion.slerp(local, w);
  }

  /** Наклон на кост около оста X на тялото (напред > 0). */
  private bend(name: string, angle: number): void {
    const b = this.bones.get(name);
    if (!b || !angle) return;
    const bw = this.body.bindWorld.get(name)!;
    const axis = tmpV.set(1, 0, 0).applyQuaternion(tmpQ.copy(bw).invert());
    b.quaternion.multiply(tmpQ2.setFromAxisAngle(axis, angle));
  }

  private applyOverlays(dt: number): void {
    const st = this.spec.stoop;
    if (st > 0 && this.current !== 'die' && this.current !== 'sleep') {
      const s = st * (this.current === 'walk' ? 1.1 : 1);
      this.bend('spine_01', 0.1 * s); this.bend('spine_02', 0.12 * s); this.bend('spine_03', 0.1 * s);
      this.bend('neck_01', -0.12 * s); this.bend('Head', -0.1 * s);
    }
    if (this.overlay !== 'breathe') this.bones.get('spine_03')?.scale.setScalar(1);
    // добавката се сменя плавно: старата изчезва, после идва новата
    if (this.overlayNext !== this.overlay) {
      this.overlayW -= dt * 6;
      if (this.overlayW <= 0 || this.overlay === 'none') { this.overlay = this.overlayNext; this.overlayW = 0; }
    } else if (this.overlay !== 'none') this.overlayW = Math.min(1, this.overlayW + dt * 5);
    const w = this.overlayW;
    if (w < 0.01) return;
    const t = this.time;
    switch (this.overlay) {
      case 'horo': {
        // хоро: ръцете встрани и малко напред — хванати за съседите; леко поклащане
        const sw = Math.sin(t * 3.2) * 0.08;
        this.aim('upperarm_l', tmpV2.set(0.75, -0.6 + sw, 0.3), w * 0.9);
        this.aim('lowerarm_l', tmpV2.set(0.7, -0.45 + sw, 0.45), w * 0.9);
        this.aim('upperarm_r', tmpV2.set(-0.75, -0.6 - sw, 0.3), w * 0.9);
        this.aim('lowerarm_r', tmpV2.set(-0.7, -0.45 - sw, 0.45), w * 0.9);
        break;
      }
      case 'wave': {
        const k = Math.min(1, this.shotT * 4) * Math.min(1, Math.max(0, (this.shotDur - this.shotT) * 4));
        this.aim('upperarm_r', tmpV2.set(-0.55, 0.75, 0.25), w * k);
        this.aim('lowerarm_r', tmpV2.set(-0.15 + 0.35 * Math.sin(t * 9), 0.95, 0.2), w * k);
        break;
      }
      case 'hammer': {
        // удар на ~1.2 с: бързо надолу, бавно нагоре
        const ph = (t % 1.2) / 1.2;
        const r = ph < 0.12 ? 1 - ph / 0.12 : Math.min(1, (ph - 0.12) / 0.6);
        this.bend('spine_02', 0.12 * w);
        this.aim('upperarm_r', tmpV2.set(-0.25, -0.55 + 0.75 * r, 0.75), w);
        this.aim('lowerarm_r', tmpV2.set(-0.05, -0.75 + 1.45 * r, 0.65 - 0.25 * r), w);
        this.aim('upperarm_l', tmpV2.set(0.2, -0.75, 0.55), w * 0.8);
        this.aim('lowerarm_l', tmpV2.set(-0.05, -0.35, 0.9), w * 0.8);
        break;
      }
      case 'block': {
        // сабята напряко пред лицето
        this.aim('upperarm_r', tmpV2.set(-0.45, 0.1, 0.85), w);
        this.aim('lowerarm_r', tmpV2.set(0.5, 0.55, 0.65), w);
        break;
      }
      case 'carry': {
        this.aim('upperarm_r', tmpV2.set(-0.12, -0.95, 0.2), w);
        this.aim('lowerarm_r', tmpV2.set(0.1, 0.05, 1), w);
        break;
      }
      case 'ride': {
        // на седлото: бедрата напред-встрани около коня, прасците надолу; ръцете напред към юздите
        this.aim('thigh_l', tmpV2.set(0.42, -0.5, 0.75), w);
        this.aim('calf_l', tmpV2.set(0.18, -1, -0.12), w);
        this.aim('thigh_r', tmpV2.set(-0.42, -0.5, 0.75), w);
        this.aim('calf_r', tmpV2.set(-0.18, -1, -0.12), w);
        this.aim('upperarm_l', tmpV2.set(0.22, -0.85, 0.35), w);
        this.aim('lowerarm_l', tmpV2.set(-0.2, -0.35, 1), w);
        this.aim('upperarm_r', tmpV2.set(-0.22, -0.85, 0.35), w);
        this.aim('lowerarm_r', tmpV2.set(0.2, -0.35, 1), w);
        break;
      }
      case 'breathe': {
        const c = this.bones.get('spine_03');
        if (c) c.scale.setScalar(1 + 0.015 * Math.sin(t * 1.6) * w);
        break;
      }
      default: break;
    }
  }

  flash(color?: number): void {
    if (color === null) {
      this.flashMats.forEach((m, i) => { const b = this.baseEmissive[i]; if (b) { m.emissive.copy(b.c); m.emissiveIntensity = b.i; } });
      this.baseEmissive = [];
      this.flashT = 0;
      return;
    }
    if (!this.baseEmissive.length) this.baseEmissive = this.flashMats.map((m) => ({ c: m.emissive.clone(), i: m.emissiveIntensity }));
    const c = new THREE.Color(color ?? 0xff5040);
    for (const m of this.flashMats) { m.emissive.copy(c); m.emissiveIntensity = 0.22; } // лек оттенък, не плътен цвят
    this.flashT = 0.16;
  }

  dispose(): void {
    this.flash(null as unknown as number);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.armature);
    this.root.removeFromParent();
    for (const m of this.ownMats) m.dispose();
    for (const s of this.skeletons) s.dispose();
  }
}
