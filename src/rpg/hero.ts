// Стоян: управление (ходене, тичане, скок, удари на комбо, блок) и камера от 3-то лице.
import * as THREE from 'three';
import type { WorldQuery } from '../core/world-query';
import type { HeroModel, AnimName } from '../models/types';

export interface HeroInput {
  fwd: number;      // -1..1 (W/S)
  right: number;    // -1..1 (D/A)
  run: boolean;
  jump: boolean;    // натиснат този кадър
  attack: boolean;  // натиснат този кадър
  block: boolean;   // задържан
}
export const NO_INPUT: HeroInput = { fwd: 0, right: 0, run: false, jump: false, attack: false, block: false };

export interface StaminaPool { stamina: number; readonly maxStamina: number }

interface AttackDef { dur: number; hitAt: number; mult: number; cost: number; anim: AnimName; reach: number }
export const ATTACKS: AttackDef[] = [
  { dur: 0.48, hitAt: 0.17, mult: 1.0, cost: 10, anim: 'attack', reach: 2.6 },
  { dur: 0.48, hitAt: 0.17, mult: 1.15, cost: 10, anim: 'attack2', reach: 2.6 },
  { dur: 0.72, hitAt: 0.3, mult: 1.75, cost: 16, anim: 'attack', reach: 3.0 },
];
export const BOW_COOLDOWN = 0.75;
export const BOW_COST = 8;

export const WALK_SPEED = 4.6;
export const RUN_SPEED = 8.2;
const GRAVITY = 22;
const JUMP_V = 7;
export const HERO_RADIUS = 0.4;

export class Hero {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  vy = 0;
  grounded = true;
  speed = 0;
  private vel = new THREE.Vector2();
  /** Текущ удар: индекс в ATTACKS или -1. */
  attackIdx = -1;
  attackT = 0;
  private hitDone = false;
  private queued = false;
  private comboWindow = 0;
  private lastCombo = -1;
  blocking = false;
  invuln = 0;
  stagger = 0;
  dead = false;
  ranged = false;
  /** Множител на скоростта (проклятието на самодивите го намалява). */
  speedMul = 1;
  private bowCd = 0;
  private restT = 0;
  private knock = new THREE.Vector2();
  private baseAnim: AnimName | '' = '';
  private lockCd = 0;

  /** Rpg задава: ударът стига целта (комбо индекс, множител, обхват). */
  onAttackHit: (idx: number, mult: number, reach: number) => void = () => {};
  /** Стрела от лъка. */
  onShoot: () => void = () => {};
  /** Накъде да се обърне при удар (най-близкия враг) или null → накъдето гледа камерата. */
  aim: () => { x: number; z: number } | null = () => null;
  onLocked: (msg: string) => void = () => {};
  onSfx: (name: string) => void = () => {};

  constructor(readonly model: HeroModel) {}

  get attacking(): boolean { return this.attackIdx >= 0; }

  setPosition(x: number, z: number, world: WorldQuery, yaw?: number): void {
    this.pos.set(x, world.heightAt(x, z), z);
    if (yaw !== undefined) this.yaw = yaw;
    this.vy = 0; this.grounded = true; this.vel.set(0, 0); this.knock.set(0, 0);
    this.syncModel();
  }

  /** Удар по героя: отблъскване и анимация. */
  hurt(fromX: number, fromZ: number, knockback: number, blocked: boolean): void {
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
    this.knock.set((dx / l) * knockback * (blocked ? 0.35 : 1), (dz / l) * knockback * (blocked ? 0.35 : 1));
    this.invuln = blocked ? 0.25 : 0.5;
    if (!blocked && knockback < 1) {
      // огън/горяща земя: без зашеметяване — иначе героят замръзва в пламъците и не може да излезе
      this.model.flash(0xff4433);
    } else if (!blocked) {
      this.stagger = 0.3;
      this.attackIdx = -1;
      this.model.play('hit');
      this.model.flash(0xff4433);
    } else this.model.flash(0xffe6a0);
  }

  die(): void {
    this.dead = true; this.attackIdx = -1; this.blocking = false;
    this.model.play('die');
    this.baseAnim = 'die';
  }

  revive(): void {
    this.dead = false; this.stagger = 0; this.invuln = 2; this.baseAnim = '';
    this.model.play('idle');
  }

  /** Блокът: гледа ли героят към нападателя (±100°). */
  facingToward(x: number, z: number): boolean {
    const a = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = a - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d) < (100 * Math.PI) / 180;
  }

  update(dt: number, inp: HeroInput, camYaw: number, world: WorldQuery, sp: StaminaPool, groundBias = 0): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    this.bowCd = Math.max(0, this.bowCd - dt);
    this.lockCd = Math.max(0, this.lockCd - dt);
    if (this.dead) { this.applyPhysics(dt, 0, 0, world); this.model.update(dt, 0); this.syncModel(); return; }

    // посока спрямо камерата
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * inp.fwd + rx * inp.right, dz = fz * inp.fwd + rz * inp.right;
    const dl = Math.hypot(dx, dz);
    if (dl > 1) { dx /= dl; dz /= dl; }
    const moving = dl > 0.05;

    // блок
    this.blocking = inp.block && !this.attacking && this.stagger <= 0 && sp.stamina > 1 && this.grounded;

    // удар / стрела
    if (inp.attack && this.stagger <= 0) this.tryAttack(camYaw, sp);
    if (this.attacking) {
      const a = ATTACKS[this.attackIdx];
      this.attackT += dt;
      if (!this.hitDone && this.attackT >= a.hitAt) { this.hitDone = true; this.onAttackHit(this.attackIdx, a.mult, a.reach); }
      if (this.attackT >= a.dur) {
        const next = this.attackIdx + 1;
        this.lastCombo = this.attackIdx;
        this.attackIdx = -1;
        if (this.queued && next < ATTACKS.length && sp.stamina >= ATTACKS[next].cost) this.startAttack(next, camYaw, sp);
        else this.comboWindow = 0.35;
      }
    } else this.comboWindow = Math.max(0, this.comboWindow - dt);

    // скорост
    const canRun = inp.run && moving && !this.blocking && !this.attacking && sp.stamina > 0.5;
    let target = moving ? (canRun ? RUN_SPEED : WALK_SPEED) * this.speedMul : 0;
    if (this.blocking) target *= 0.4;
    if (this.attacking) target *= 0.25;
    if (this.stagger > 0) target = 0;
    if (world.waterAt(this.pos.x, this.pos.z)) target *= 0.6;
    const k = 1 - Math.exp(-dt * (moving ? 12 : 16));
    this.vel.x += (dx * target - this.vel.x) * k;
    this.vel.y += (dz * target - this.vel.y) * k;
    // лек напън напред при удар
    let lx = 0, lz = 0;
    if (this.attacking && this.attackT < ATTACKS[this.attackIdx].hitAt) { lx = Math.sin(this.yaw) * 2; lz = Math.cos(this.yaw) * 2; }

    // сила
    if (canRun) { sp.stamina = Math.max(0, sp.stamina - 20 * dt); this.restT = 0; }
    else if (this.attacking || this.blocking) this.restT = 0;
    else { this.restT += dt; if (this.restT > 0.6) sp.stamina = Math.min(sp.maxStamina, sp.stamina + 26 * dt); }

    // скок
    if (inp.jump && this.grounded && !this.attacking && !this.blocking && this.stagger <= 0) {
      this.vy = JUMP_V; this.grounded = false; this.model.play('jump'); this.onSfx('jump');
    }

    // обръщане
    if (moving && !this.attacking && !this.blocking) {
      const want = Math.atan2(dx, dz);
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 14);
    } else if (this.blocking) {
      let d = Math.atan2(fx, fz) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 10);
    }

    this.applyPhysics(dt, this.vel.x + lx, this.vel.y + lz, world, groundBias);
    this.speed = Math.hypot(this.vel.x, this.vel.y);

    // анимация
    let base: AnimName = 'idle';
    if (this.blocking) base = 'block';
    else if (this.speed > 6) base = 'run';
    else if (this.speed > 0.4) base = 'walk';
    const busy = this.attacking || this.stagger > 0 || !this.grounded;
    if (!busy && base !== this.baseAnim) { this.model.play(base, { loop: true }); this.baseAnim = base; }
    if (busy) this.baseAnim = '';
    this.model.update(dt, this.speed);
    this.syncModel();
  }

  private tryAttack(camYaw: number, sp: StaminaPool): void {
    if (this.ranged) {
      if (this.bowCd > 0 || sp.stamina < BOW_COST) return;
      sp.stamina -= BOW_COST; this.bowCd = BOW_COOLDOWN; this.restT = 0;
      this.faceAim(camYaw);
      this.model.play('attack');
      this.onSfx('bow');
      this.onShoot();
      return;
    }
    if (this.attacking) {
      if (this.attackT > ATTACKS[this.attackIdx].dur * 0.35) this.queued = true;
      return;
    }
    const idx = this.comboWindow > 0 && this.lastCombo >= 0 && this.lastCombo + 1 < ATTACKS.length ? this.lastCombo + 1 : 0;
    if (sp.stamina < ATTACKS[idx].cost) { if (sp.stamina >= 4 && idx === 0) { /* слаб удар без сила */ } else return; }
    this.startAttack(idx, camYaw, sp);
  }

  private startAttack(idx: number, camYaw: number, sp: StaminaPool): void {
    const a = ATTACKS[idx];
    sp.stamina = Math.max(0, sp.stamina - a.cost);
    this.attackIdx = idx; this.attackT = 0; this.hitDone = false; this.queued = false; this.comboWindow = 0;
    this.blocking = false;
    this.faceAim(camYaw);
    this.model.play(a.anim);
    this.onSfx('swing');
  }

  private faceAim(camYaw: number): void {
    const t = this.aim();
    if (t) this.yaw = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
    else this.yaw = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
  }

  private applyPhysics(dt: number, vx: number, vz: number, world: WorldQuery, groundBias = 0): void {
    // отблъскване
    vx += this.knock.x * 6; vz += this.knock.y * 6;
    this.knock.multiplyScalar(Math.exp(-dt * 8));
    if (this.knock.lengthSq() < 0.0004) this.knock.set(0, 0);

    let nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
    const msg = world.lockedAt(nx, nz);
    if (msg) {
      nx = this.pos.x; nz = this.pos.z; this.vel.set(0, 0);
      if (this.lockCd <= 0) { this.onLocked(msg); this.lockCd = 4; }
    }
    const c = world.collide(nx, nz, HERO_RADIUS);
    this.pos.x = c.x; this.pos.z = c.z;
    const g = world.heightAt(this.pos.x, this.pos.z) + groundBias;
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= g) { this.pos.y = g; this.vy = 0; if (!this.grounded) { this.grounded = true; this.baseAnim = ''; } }
    else if (this.grounded && this.pos.y - g < 0.35 && this.vy <= 0) { this.pos.y = g; this.vy = 0; } // по нанадолнище
    else this.grounded = false;
  }

  private syncModel(): void {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
  }
}

/** Камера от 3-то лице: орбита около Стоян, колелото приближава 3–12 м, рамо вдясно. */
export class CameraRig {
  yaw = 0;
  pitch = 0.32;
  dist = 7;
  targetDist = 7;
  /** Разстоянието, до което лъчът е свободен от дървета/къщи. */
  private occl = 7;
  private focus = new THREE.Vector3();
  private shakeAmp = 0;
  private shakeT = 0;
  private inited = false;
  private tmp = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  shake(amount: number): void { this.shakeAmp = Math.min(0.6, Math.max(this.shakeAmp, amount)); this.shakeT = 0; }

  /** Веднага зад героя (след телепорт/зареждане). */
  snap(heroPos: THREE.Vector3, heroYaw: number): void {
    this.yaw = heroYaw + Math.PI;
    this.inited = false;
    this.focus.set(heroPos.x, heroPos.y + 1.6, heroPos.z);
  }

  /** Колко над героя гледа камерата (при Ламята — нагоре, за да се виждат главите). */
  private lift = 0;

  update(dt: number, heroPos: THREE.Vector3, world: WorldQuery, look: { dx: number; dy: number; wheel: number; keyYaw: number; sensitivity: number }, blockers: { x: number; z: number; r: number; h: number }[] = [], lookLift = 0): void {
    this.lift += (lookLift - this.lift) * (1 - Math.exp(-dt * 2));
    const k = 0.0025 * look.sensitivity;
    this.yaw -= look.dx * k + look.keyYaw * dt * 2.2;
    this.pitch = Math.max(-0.3, Math.min(1.25, this.pitch + look.dy * k));
    if (look.wheel) this.targetDist = Math.max(3, Math.min(12, this.targetDist + look.wheel * 0.9));
    this.dist += (this.targetDist - this.dist) * (1 - Math.exp(-dt * 10));

    const want = this.tmp.set(heroPos.x, heroPos.y + 1.6, heroPos.z);
    if (!this.inited) { this.focus.copy(want); this.inited = true; }
    else this.focus.lerp(want, 1 - Math.exp(-dt * 14));

    const sh = 0.55 * Math.min(1, this.dist / 6);
    const rx = Math.cos(this.yaw) * sh, rz = -Math.sin(this.yaw) * sh;
    const cp = Math.cos(this.pitch);
    // дървета и къщи между героя и камерата → камерата се приближава (бързо), после бавно се връща
    let free = this.dist;
    if (world.cameraHit) {
      const ux = rx / Math.max(this.dist, 0.01) + Math.sin(this.yaw) * cp, uy = Math.sin(this.pitch), uz = rz / Math.max(this.dist, 0.01) + Math.cos(this.yaw) * cp;
      for (let s = 2.2; s <= this.dist; s += 0.3) {
        if (world.cameraHit(this.focus.x + ux * s, this.focus.y + uy * s, this.focus.z + uz * s)) { free = Math.max(2.2, s - 0.4); break; }
      }
    }
    this.occl = free < this.occl ? free : this.occl + (free - this.occl) * (1 - Math.exp(-dt * 2.5));
    const d = Math.min(this.dist, this.occl);
    const cam = this.camera.position;
    cam.set(
      this.focus.x + rx + Math.sin(this.yaw) * cp * d,
      this.focus.y + Math.sin(this.pitch) * d,
      this.focus.z + rz + Math.cos(this.yaw) * cp * d,
    );
    // не влиза в големи тела (Ламята)
    for (const b of blockers) {
      for (let k = 0; k < 12; k++) {
        if (Math.hypot(cam.x - b.x, cam.z - b.z) > b.r || cam.y > world.heightAt(b.x, b.z) + b.h) break;
        cam.lerp(this.focus, 0.15);
      }
    }
    // никога под терена (и по средата на лъча)
    const minY = world.heightAt(cam.x, cam.z) + 0.5;
    if (cam.y < minY) cam.y = minY;
    const mx = (cam.x + this.focus.x) / 2, mz = (cam.z + this.focus.z) / 2;
    const mid = world.heightAt(mx, mz) + 0.4;
    if ((cam.y + this.focus.y) / 2 < mid) cam.y += (mid - (cam.y + this.focus.y) / 2) * 2;

    // трусене
    if (this.shakeAmp > 0.001) {
      this.shakeT += dt;
      cam.x += (Math.random() - 0.5) * this.shakeAmp;
      cam.y += (Math.random() - 0.5) * this.shakeAmp;
      cam.z += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.focus.x + rx, this.focus.y + this.lift, this.focus.z + rz);
  }

  /** Посоката напред по земята (накъдето гледа камерата). */
  forward(): { x: number; z: number } { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
}
