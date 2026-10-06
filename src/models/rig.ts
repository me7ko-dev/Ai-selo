// Малка система за скелет: стави (THREE.Group), пози като масиви от ъгли, плавно смесване между анимации.
import * as THREE from 'three';
import type { AnimName, CharacterModel } from './types';
import { flashMat, bakeGeometry, mergeList } from './shared';
import { realify } from './realify';

/** Еднократни анимации — след края се връщат към предишната повтаряща се. 'die' остава. */
export const ONE_SHOT: ReadonlySet<AnimName> = new Set<AnimName>(['attack', 'attack2', 'hit', 'die', 'jump', 'cast', 'wave']);

export interface KeyFrame { t: number; p: Float32Array; }

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Взима поза между ключовите кадри (време в секунди). */
export function sampleKeys(out: Float32Array, keys: KeyFrame[], time: number): void {
  if (time <= keys[0].t) { out.set(keys[0].p); return; }
  const last = keys[keys.length - 1];
  if (time >= last.t) { out.set(last.p); return; }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (time <= b.t) {
      const w = smooth((time - a.t) / Math.max(1e-6, b.t - a.t));
      const pa = a.p, pb = b.p;
      for (let k = 0; k < out.length; k++) out[k] = pa[k] + (pb[k] - pa[k]) * w;
      return;
    }
  }
}

/** Прави поза от описание {индекс на става: [x, y, z]} + отместване на корена. */
export function makePose(nJoints: number, spec: Record<number, [number, number, number]>, pos?: [number, number, number]): Float32Array {
  const p = new Float32Array(nJoints * 3 + 3);
  for (const k in spec) { const v = spec[k]; const i = +k * 3; p[i] = v[0]; p[i + 1] = v[1]; p[i + 2] = v[2]; }
  if (pos) { p[nJoints * 3] = pos[0]; p[nJoints * 3 + 1] = pos[1]; p[nJoints * 3 + 2] = pos[2]; }
  return p;
}

export abstract class RigModel implements CharacterModel {
  readonly root = new THREE.Group();
  abstract readonly height: number;
  hand?: THREE.Object3D;
  /** Стави; joints[0] получава и отместване на позицията (последните 3 канала). */
  protected joints: THREE.Object3D[] = [];
  private restRot = new Float32Array(0);
  private restPos = new THREE.Vector3();
  protected nJ = 0;
  protected target = new Float32Array(0);
  protected cur = new Float32Array(0);
  private from = new Float32Array(0);
  /** Постоянна добавка (напр. прегърбен старец); позите могат да я изключат с biasW = 0. */
  protected bias: Float32Array | null = null;
  protected biasW = 1;

  current: AnimName = 'idle';
  /** Анимацията, която реално се играе (след замяна на неподдържаните). */
  protected active: AnimName = 'idle';
  protected loopAnim: AnimName = 'idle';
  protected loopReq: AnimName = 'idle';
  protected isLoop = true;
  /** Време в текущата анимация (с) и обща фаза на стъпките. */
  protected t = 0;
  protected time = Math.random() * 100;
  protected phase = 0;
  protected speedMul = 1;
  protected moveSpeed = 0;
  private blend = 1;
  private blendDur = 0.2;
  private meshes: THREE.Mesh[] = [];
  private mats: (THREE.Material | THREE.Material[])[] = [];
  private flashT = 0;
  private flashing = false;
  /** Обекти (мешове или групи), които НЕ се сливат в общия скелетен меш (мигащи очи, сменяеми оръжия…). */
  protected noMerge = new Set<THREE.Object3D>();
  /** Допълнителни подвижни стави (вторично движение), които стават кости. */
  protected extraBones: THREE.Object3D[] = [];
  private skinned: THREE.SkinnedMesh[] = [];

  /** Регистрира става и връща индекса ѝ. */
  protected addJoint(o: THREE.Object3D): number { this.joints.push(o); return this.joints.length - 1; }

  /** Гладки форми и PBR материали (козина, вълна…) вместо плоския low-poly вид — виж realify.ts. */
  protected realistic = false;
  /** Материал за даден плосък цвят на модела (козина, вълна…); undefined → обикновен гладък PBR. */
  protected skinFor(_m: THREE.MeshLambertMaterial): THREE.Material | undefined { return undefined; }

  /** Вика се накрая на конструктора — запомня покоя и мешовете. */
  protected finish(): void {
    if (this.realistic) realify(this.root, (m) => this.skinFor(m));
    this.nJ = this.joints.length;
    const n = this.nJ * 3 + 3;
    this.restRot = new Float32Array(n);
    this.joints.forEach((j, i) => { this.restRot[i * 3] = j.rotation.x; this.restRot[i * 3 + 1] = j.rotation.y; this.restRot[i * 3 + 2] = j.rotation.z; });
    this.restPos.copy(this.joints[0].position);
    this.skinify();
    this.target = new Float32Array(n);
    this.cur = new Float32Array(n);
    this.from = new Float32Array(n);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { this.meshes.push(m); this.mats.push(m.material); }
    });
    this.computePose(0);
    this.cur.set(this.target);
    this.apply();
  }

  /** Слива всички статични мешове в един SkinnedMesh на материал: всяка част следва ставата си (тегло 1). */
  private skinify(): void {
    const bones = [...this.joints, ...this.extraBones];
    const boneIdx = new Map<THREE.Object3D, number>();
    bones.forEach((b, i) => boneIdx.set(b, i));
    this.root.updateMatrixWorld(true);
    const inv = this.root.matrixWorld.clone().invert();
    const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
    const remove: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      for (let p: THREE.Object3D | null = m; p && p !== this.root; p = p.parent) if (this.noMerge.has(p)) return;
      let a: THREE.Object3D | null = m.parent;
      while (a && !boneIdx.has(a)) a = a.parent;
      if (!a) return;
      const bi = boneIdx.get(a)!;
      const g = bakeGeometry(m, inv);
      const n = g.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      let gr = groups.get(m.material);
      if (!gr) { gr = { geos: [], cast: false }; groups.set(m.material, gr); }
      gr.geos.push(g);
      gr.cast ||= m.castShadow;
      remove.push(m);
    });
    if (!remove.length) return;
    for (const m of remove) m.removeFromParent();
    const skeleton = new THREE.Skeleton(bones as THREE.Bone[]);
    for (const [material, gr] of groups) {
      const geo = mergeList(gr.geos);
      const sm = new THREE.SkinnedMesh(geo, material);
      sm.castShadow = gr.cast;
      this.root.add(sm);
      sm.bind(skeleton, new THREE.Matrix4());
      // широка сфера — позата може да е легнала/протегната, без да се изрязва от камерата
      geo.computeBoundingSphere();
      const bs = geo.boundingSphere!.clone();
      bs.radius = bs.radius * 1.6 + 0.3;
      sm.boundingSphere = bs;
      this.skinned.push(sm);
    }
  }

  /** Поза за анимацията в момент t (записва делти спрямо покоя в out, out е нулиран). */
  protected abstract pose(anim: AnimName, t: number, out: Float32Array): void;
  /** Продължителност на еднократна анимация (с). */
  protected duration(anim: AnimName): number { return anim === 'die' ? 1.2 : anim === 'wave' ? 1.6 : anim === 'cast' ? 1.0 : anim === 'jump' ? 0.75 : anim === 'hit' ? 0.4 : 0.6; }
  /** Замяна на неподдържани анимации. */
  protected mapAnim(anim: AnimName): AnimName { return anim === 'ride' ? 'sit' : anim; }
  /** Дължина на една двойна крачка (м) за ходене/тичане. */
  protected stride(run: boolean): number { return run ? 2.2 : 1.3; }
  /** Вторично движение (наметало, коса, мигане) — след позата. */
  protected secondary(dt: number): void {}

  play(anim: AnimName, opts?: { loop?: boolean; speed?: number }): void {
    const loop = opts?.loop ?? !ONE_SHOT.has(anim);
    const mapped = this.mapAnim(anim);
    if (opts?.speed !== undefined) this.speedMul = opts.speed;
    else if (loop) this.speedMul = 1;
    if (loop) {
      this.loopReq = anim;
      // докато тече еднократна анимация (без 'die'), само запомняме към какво да се върнем
      if (!this.isLoop && this.active !== 'die') { this.loopAnim = mapped; return; }
      if (this.isLoop && anim === this.current) return;
      this.loopAnim = mapped;
    }
    this.start(anim, mapped, loop);
  }

  private start(name: AnimName, mapped: AnimName, loop: boolean): void {
    this.from.set(this.cur);
    this.blend = 0;
    this.blendDur = mapped === 'die' || mapped === 'hit' ? 0.1 : mapped.startsWith('attack') ? 0.08 : 0.22;
    this.current = name;
    this.active = mapped;
    this.isLoop = loop;
    this.t = 0;
  }

  update(dt: number, moveSpeed?: number): void {
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.t += dt * this.speedMul;
    if (moveSpeed !== undefined) this.moveSpeed = moveSpeed;
    if (this.active === 'walk' || this.active === 'run') {
      const run = this.active === 'run';
      const v = this.moveSpeed > 0.05 ? this.moveSpeed : (run ? 4.5 : 1.4);
      this.phase += dt * Math.PI * 2 * (v / this.stride(run)) * (this.moveSpeed > 0.05 ? 1 : this.speedMul);
    }
    if (!this.isLoop) {
      const d = this.duration(this.active);
      if (this.t >= d) {
        if (this.active === 'die') this.t = d;
        else this.start(this.loopReq, this.loopAnim, true);
      }
    }
    this.computePose(dt);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const w = smooth(this.blend);
      const f = this.from, tg = this.target, c = this.cur;
      for (let i = 0; i < c.length; i++) c[i] = f[i] + (tg[i] - f[i]) * w;
    } else this.cur.set(this.target);
    this.apply();
    this.secondary(dt);
    if (this.flashing) { this.flashT -= dt; if (this.flashT <= 0) this.flash(null as unknown as number); }
  }

  private computePose(dt: number): void {
    this.target.fill(0);
    this.biasW = 1;
    this.pose(this.active, this.t, this.target);
    if (this.bias && this.biasW > 0) { const b = this.bias, w = this.biasW, tg = this.target; for (let i = 0; i < tg.length; i++) tg[i] += b[i] * w; }
  }

  protected apply(): void {
    const c = this.cur, r = this.restRot, J = this.joints;
    for (let i = 0; i < this.nJ; i++) J[i].rotation.set(r[i * 3] + c[i * 3], r[i * 3 + 1] + c[i * 3 + 1], r[i * 3 + 2] + c[i * 3 + 2]);
    const k = this.nJ * 3;
    J[0].position.set(this.restPos.x + c[k], this.restPos.y + c[k + 1], this.restPos.z + c[k + 2]);
  }

  flash(color?: number): void {
    if (color === null) {
      if (this.flashing) { for (let i = 0; i < this.meshes.length; i++) this.meshes[i].material = this.mats[i]; }
      this.flashing = false; return;
    }
    const c = color ?? 0xff5040;
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.mats[i];
      if (!Array.isArray(m)) this.meshes[i].material = flashMat(m, c);
    }
    this.flashing = true; this.flashT = 0.16;
  }

  /** Подменя запомнения материал на меш (за смяна на оръжие/очи), за да не се развали flash. */
  protected setMeshMat(mesh: THREE.Mesh, m: THREE.Material): void {
    const i = this.meshes.indexOf(mesh);
    if (i >= 0) this.mats[i] = m;
    if (!this.flashing || i < 0) mesh.material = m;
  }
  protected trackMesh(o: THREE.Object3D): void {
    o.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh && !this.meshes.includes(m)) { this.meshes.push(m); this.mats.push(m.material); } });
  }

  dispose(): void {
    this.flash(null as unknown as number);
    this.root.removeFromParent();
    // материалите са споделени (кеш); слетите геометрии и скелетът са на това копие
    for (const sm of this.skinned) sm.geometry.dispose();
    if (this.skinned.length) this.skinned[0].skeleton.dispose();
  }
}
