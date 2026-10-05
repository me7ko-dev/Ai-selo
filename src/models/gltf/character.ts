// Човек от people.glb: клонира скелета и мешовете, облича го (етикети + палитра), закача коса, сечиво/оръжие,
// и го анимира с AnimationMixer по договора на CharacterModel/HeroModel.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimName, HeroModel } from '../types';
import { charAssets, recolorMaterial, type BodyTemplate, type CharAssets } from './assets';
import { type CharSpec, BODY_HEIGHT, G, HAIR, paletteArray, hexToLinear } from './looks';
import { chooseClip, locomotionClip, ONE_SHOTS, type AnimContext, type ClipChoice, type Overlay } from './animmap';
import { buildSaber, buildScabbard, buildBow, buildTool } from '../items';
import { mergeStatic } from '../shared';

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
    const extra = spec.hair.includes(HAIR.kalpak) ? 0.1 : spec.folk.includes(G.SCARF) ? 0.03 : 0;
    this.height = spec.height + extra;
    this.seatHeight = 0.45 * this.scale;
    for (const n of ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r']) {
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
        this.ownMats.push(mat);
      } else mat = A.materials.eyes;
      if (glow && part !== 'eyes') { mat.emissive.copy(glow); mat.emissiveIntensity = part === 'skin' ? 0.08 : 0.22; }
      m.material = mat;
      m.frustumCulled = true;
      m.boundingSphere = sphere;
      if (part !== 'eyes') this.flashMats.push(mat);
      this.skeletons.push(m.skeleton);
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
      this.bow.rotation.set(1.2, 0, 0);
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
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    if (moveSpeed !== undefined) this.moveSpeed = moveSpeed;
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
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash(null as unknown as number); }
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
    for (const m of this.flashMats) { m.emissive.copy(c); m.emissiveIntensity = 0.55; }
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
