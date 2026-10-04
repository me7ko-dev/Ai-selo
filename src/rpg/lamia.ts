// Ламята — босът на Ламин връх: 3 глави (всяка със свой живот), 3 фази.
// Главите се удрят само когато захапят ниско (около 1 с след захапката) — отскочи, после удряй.
import * as THREE from 'three';
import type { WorldQuery } from '../core/world-query';
import { PLACES } from '../data/layout';
import { createLamiaModel, type LamiaModel } from '../models';
import { BurnPatches, FireParticles, GroundRing, Rockfall } from './fx';
import type { BossHead } from './types';

export const LAMIA = {
  headHp: 220,
  arena: 26,
  leave: 46,
  bodyR: 3.2,
  biteReach: 11,
  biteDmg: 22,
  fireDmg: 11,
  tailDmg: 20,
  rockDmg: 22,
  vuln: 1.15,
  xp: 600,
};

export interface BossCtx {
  world: WorldQuery;
  heroPos: THREE.Vector3;
  heroDead: boolean;
  damageHero(amount: number, fromX: number, fromZ: number, knockback: number): void;
  sfx(name: string): void;
  shake(amount: number): void;
  summon(x: number, z: number): void;
  summonedCount(): number;
  notify(text: string): void;
  onWake(): void;
  onHeadKilled(i: number): void;
  onDefeated(): void;
  onChange(): void;
  onHit(amount: number, x: number, y: number, z: number): void;
}

type AttackKind = 'bite' | 'fire' | 'tail' | 'rock';
interface Attack { kind: AttackKind; head: number; t: number; tele: number; act: number; tx: number; tz: number; dir: number; done: boolean }

export type LamiaState = 'sleep' | 'wake' | 'fight' | 'dying' | 'dead';

export class Lamia {
  readonly model: LamiaModel;
  readonly center = { ...PLACES.lamia_plateau.pos };
  readonly pos = new THREE.Vector3();
  yaw = 0;
  heads: BossHead[] = [0, 1, 2].map(() => ({ hp: LAMIA.headHp, max: LAMIA.headHp }));
  state: LamiaState = 'sleep';
  private t = 0;
  private attack: Attack | null = null;
  private cooldown = 1.5;
  private nextHead = 0;
  private ring: GroundRing;
  private vulnRing: GroundRing;
  /** Глава, която в момента е ниско и може да се удари. */
  vuln: { head: number; x: number; z: number; t: number } | null = null;
  private leaveT = 0;
  private summonT = 0;
  private armorMsgT = 0;
  readonly fire: FireParticles;
  readonly burns: BurnPatches;
  readonly rocks: Rockfall;
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, world: WorldQuery) {
    this.model = createLamiaModel();
    this.pos.set(this.center.x, world.heightAt(this.center.x, this.center.z), this.center.z);
    this.yaw = Math.atan2(PLACES.riverbed.pos.x - this.center.x, PLACES.riverbed.pos.z - this.center.z); // гледа надолу по коритото
    scene.add(this.model.root);
    this.model.play('sleep', { loop: true });
    this.ring = new GroundRing(scene, 2.3, 0xff4422); this.ring.mesh.visible = false;
    this.vulnRing = new GroundRing(scene, 1.6, 0xffe08a); this.vulnRing.mesh.visible = false;
    this.fire = new FireParticles(scene);
    this.burns = new BurnPatches(scene, this.fire);
    this.rocks = new Rockfall(scene);
    this.sync();
  }

  get alive(): number { return this.heads.filter(h => h.hp > 0).length; }
  get phase(): number { return Math.max(1, Math.min(3, 4 - this.alive)); }
  get active(): boolean { return this.state === 'wake' || this.state === 'fight'; }
  get defeated(): boolean { return this.state === 'dying' || this.state === 'dead'; }

  /** От записа: мъртвите глави остават мъртви, живите са с пълен живот. */
  load(heads: number[] | undefined, dead: boolean): void {
    this.heads.forEach((h, i) => { h.hp = heads && heads[i] !== undefined && heads[i] <= 0 ? 0 : h.max; this.model.setHeadAlive(i, h.hp > 0); });
    this.resetFight();
    if (dead) { this.state = 'dead'; this.heads.forEach((h, i) => { h.hp = 0; this.model.setHeadAlive(i, false); }); this.model.root.visible = false; }
    else { this.state = 'sleep'; this.model.root.visible = true; this.model.play('sleep', { loop: true }); }
  }

  /** Връща се да спи (героят падна или избяга); живите глави се лекуват. */
  sleep(): void {
    if (this.defeated) return;
    this.state = 'sleep';
    for (const h of this.heads) if (h.hp > 0) h.hp = h.max;
    this.resetFight();
    this.model.play('sleep', { loop: true });
  }

  private resetFight(): void {
    this.attack = null; this.vuln = null; this.cooldown = 1.5; this.leaveT = 0;
    this.ring.mesh.visible = false; this.vulnRing.mesh.visible = false;
    this.burns.clear(); this.rocks.clear();
  }

  private heroAngle(ctx: BossCtx): number {
    const a = Math.atan2(ctx.heroPos.x - this.pos.x, ctx.heroPos.z - this.pos.z);
    let d = a - this.yaw; return Math.atan2(Math.sin(d), Math.cos(d));
  }

  private pickHead(): number {
    // най-често напада най-ранената глава — иначе щетата се разпределя по трите и фазите 2–3 идват накрая наведнъж
    if (Math.random() < 0.75) {
      let best = -1;
      for (let i = 0; i < 3; i++) if (this.heads[i].hp > 0 && (best < 0 || this.heads[i].hp < this.heads[best].hp)) best = i;
      if (best >= 0) return best;
    }
    for (let k = 0; k < 3; k++) { const i = (this.nextHead + k) % 3; if (this.heads[i].hp > 0) { this.nextHead = i + 1; return i; } }
    return 0;
  }

  /** Позиция на глава в света (от модела). */
  headWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    const h = this.model.heads[i];
    if (h) return h.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + 6, this.pos.z);
  }

  update(dt: number, ctx: BossCtx): void {
    const { world, heroPos } = ctx;
    const dHero = Math.hypot(heroPos.x - this.pos.x, heroPos.z - this.pos.z);
    const dCenter = Math.hypot(heroPos.x - this.center.x, heroPos.z - this.center.z);
    this.armorMsgT = Math.max(0, this.armorMsgT - dt);
    this.fire.update(dt);
    this.burns.update(dt);

    switch (this.state) {
      case 'sleep':
        if (!ctx.heroDead && dCenter < LAMIA.arena) this.wake(ctx);
        break;
      case 'wake':
        this.t -= dt;
        this.turnTo(heroPos.x, heroPos.z, dt * 1.5);
        if (this.t <= 0) { this.state = 'fight'; this.cooldown = 0.8; ctx.onChange(); }
        break;
      case 'fight':
        if (ctx.heroDead || dCenter > LAMIA.leave) {
          this.leaveT += dt;
          if (this.leaveT > (ctx.heroDead ? 1.5 : 4)) { this.sleep(); ctx.onChange(); ctx.notify('Ламята се сви обратно в бърлогата си.'); }
        } else this.leaveT = 0;
        this.fight(dt, ctx, dHero);
        break;
      case 'dying':
        this.t += dt;
        if (this.t > 4) this.state = 'dead';
        break;
      case 'dead': break;
    }

    // падащи камъни
    for (const r of this.rocks.update(dt, world)) {
      ctx.shake(0.25); ctx.sfx('rock');
      if (!ctx.heroDead && Math.hypot(heroPos.x - r.x, heroPos.z - r.z) < 2.1) ctx.damageHero(LAMIA.rockDmg, r.x, r.z, 2.5);
    }
    // горяща земя
    if (!ctx.heroDead && this.burns.inside(heroPos.x, heroPos.z)) ctx.damageHero(6, heroPos.x + 0.01, heroPos.z, 0);

    this.model.update(dt, 0);
    this.sync();
  }

  private wake(ctx: BossCtx): void {
    this.state = 'wake'; this.t = 2.2;
    this.model.play('idle', { loop: true });
    this.model.play('cast');
    ctx.sfx('roar'); ctx.shake(0.4);
    ctx.onWake();
    ctx.onChange();
  }

  private fight(dt: number, ctx: BossCtx, dHero: number): void {
    const { world, heroPos } = ctx;
    const ph = this.phase;
    const fast = ph === 3 ? 0.68 : ph === 2 ? 0.85 : 1;

    // уязвима глава
    if (this.vuln) {
      this.vuln.t -= dt;
      this.vulnRing.progress(Math.max(0, this.vuln.t / LAMIA.vuln));
      if (this.vuln.t <= 0) { this.vuln = null; this.vulnRing.mesh.visible = false; }
    }

    // към героя
    if (!this.attack || this.attack.kind !== 'fire' || this.attack.t < this.attack.tele) this.turnTo(heroPos.x, heroPos.z, dt * (ph === 3 ? 2 : 1.2));
    if (!this.attack && dHero > LAMIA.biteReach - 1) {
      // приближава се, но не напуска бърлогата
      const dx = heroPos.x - this.pos.x, dz = heroPos.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
      const nx = this.pos.x + (dx / l) * 1.6 * dt, nz = this.pos.z + (dz / l) * 1.6 * dt;
      if (Math.hypot(nx - this.center.x, nz - this.center.z) < 11) { this.pos.x = nx; this.pos.z = nz; this.pos.y = world.heightAt(nx, nz); }
    }

    // призоваване във фаза 3
    if (ph === 3) {
      this.summonT -= dt;
      if (this.summonT <= 0 && ctx.summonedCount() < 2) {
        this.summonT = 30;
        for (let k = ctx.summonedCount(); k < 2; k++) {
          const a = Math.random() * Math.PI * 2;
          ctx.summon(this.center.x + Math.cos(a) * 16, this.center.z + Math.sin(a) * 16);
        }
        ctx.notify('Ламята изрева — от скалите изпълзяха таласъми!');
      }
    }

    if (!this.attack) {
      this.cooldown -= dt;
      if (this.cooldown > 0) return;
      const ang = Math.abs(this.heroAngle(ctx));
      let kind: AttackKind;
      if (ph >= 2 && ang > 1.9 && dHero < 9) kind = 'tail';
      else if (ph === 3 && Math.random() < 0.25) kind = 'rock';
      else if (ph >= 2 && (dHero > LAMIA.biteReach || Math.random() < 0.3)) kind = 'fire';
      else if (dHero <= LAMIA.biteReach + 2) kind = 'bite';
      else if (dHero < LAMIA.leave) kind = ph >= 2 ? 'fire' : 'rock'; // далеч е — камъни/огън
      else { this.cooldown = 0.4; return; }
      const tele = { bite: 1.05, fire: 1.1, tail: 0.8, rock: 0.5 }[kind] * fast;
      const act = { bite: 0.15, fire: 1.6, tail: 0.3, rock: 0.2 }[kind];
      this.attack = { kind, head: this.pickHead(), t: 0, tele, act, tx: heroPos.x, tz: heroPos.z, dir: 0, done: false };
      if (kind === 'bite') { this.ring.mesh.visible = true; this.ring.place(heroPos.x, heroPos.z, world); ctx.sfx('hiss'); }
      if (kind === 'fire') { ctx.sfx('inhale'); this.model.play('cast'); }
      if (kind === 'tail') { this.model.flash(0xffaa55); ctx.sfx('hiss'); }
      if (kind === 'rock') {
        this.model.play('cast'); ctx.sfx('roar'); ctx.shake(0.3);
        this.rocks.add(heroPos.x, heroPos.z, 1.3, world);
        for (let k = 0; k < 4; k++) { const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6; this.rocks.add(heroPos.x + Math.cos(a) * r, heroPos.z + Math.sin(a) * r, 1.4 + k * 0.15, world); }
      }
      return;
    }

    const at = this.attack;
    at.t += dt;
    if (at.kind === 'bite') {
      if (at.t < at.tele) {
        // целта следи героя до половината от предупреждението, после се заковава (и пеша се смогва да отскочиш)
        if (at.t < at.tele * 0.5) {
          let tx = heroPos.x, tz = heroPos.z;
          const dx = tx - this.pos.x, dz = tz - this.pos.z, l = Math.hypot(dx, dz);
          if (l > LAMIA.biteReach) { tx = this.pos.x + (dx / l) * LAMIA.biteReach; tz = this.pos.z + (dz / l) * LAMIA.biteReach; }
          at.tx = tx; at.tz = tz; this.ring.place(tx, tz, world);
        }
        this.ring.progress(at.t / at.tele);
        if (at.t > at.tele * 0.5 && at.t - dt <= at.tele * 0.5) this.model.flash(0xff6644);
      } else if (!at.done) {
        at.done = true;
        this.ring.mesh.visible = false;
        this.model.headAttack(at.head, 'bite');
        ctx.sfx('bite'); ctx.shake(0.18);
        if (!ctx.heroDead && Math.hypot(heroPos.x - at.tx, heroPos.z - at.tz) < 2.05) ctx.damageHero(LAMIA.biteDmg * (ph === 3 ? 1.25 : 1), at.tx, at.tz - 0.01, 2);
        this.setVuln(at.head, at.tx, at.tz, world);
      }
    } else if (at.kind === 'fire') {
      const hp = this.headWorld(at.head, this.tmp);
      if (at.t < at.tele) {
        at.dir = Math.atan2(heroPos.x - this.pos.x, heroPos.z - this.pos.z);
        this.fire.emit(hp.x, hp.y, hp.z, (Math.random() - 0.5), 0.5, (Math.random() - 0.5), 0.3);
      } else if (at.t < at.tele + at.act) {
        if (!at.done) { at.done = true; this.model.headAttack(at.head, 'fire'); ctx.sfx('fire'); }
        // бавно завъртане към героя
        const want = Math.atan2(heroPos.x - this.pos.x, heroPos.z - this.pos.z);
        let d = want - at.dir; d = Math.atan2(Math.sin(d), Math.cos(d));
        at.dir += Math.sign(d) * Math.min(Math.abs(d), 0.55 * dt);
        for (let k = 0; k < 7; k++) {
          const spread = (Math.random() - 0.5) * 0.6, sp = 13 + Math.random() * 6;
          this.fire.emit(hp.x, hp.y - 0.5, hp.z, Math.sin(at.dir + spread) * sp, -2.5 - Math.random() * 2, Math.cos(at.dir + spread) * sp, 0.75);
        }
        // в конуса ли е героят
        const dx = heroPos.x - this.pos.x, dz = heroPos.z - this.pos.z, l = Math.hypot(dx, dz);
        let da = Math.atan2(dx, dz) - at.dir; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (!ctx.heroDead && l < 15 && l > 1 && Math.abs(da) < 0.4) ctx.damageHero(LAMIA.fireDmg, this.pos.x, this.pos.z, 0.6);
      } else {
        // горящата земя започва след главата (тя пада на 4,5 м), за да може да се удари, без да стоиш в огъня
        for (const r of [7.5, 11, 14.5]) this.burns.add(this.pos.x + Math.sin(at.dir) * r, this.pos.z + Math.cos(at.dir) * r, 2, 8, world);
        this.setVuln(at.head, this.pos.x + Math.sin(at.dir) * 4.5, this.pos.z + Math.cos(at.dir) * 4.5, world, 0.85);
        this.endAttack(fast);
        return;
      }
    } else if (at.kind === 'tail') {
      if (at.t >= at.tele && !at.done) {
        at.done = true;
        ctx.sfx('swing'); ctx.shake(0.2);
        const ang = Math.abs(this.heroAngle(ctx));
        if (!ctx.heroDead && dHero < 8.5 && ang > 1.4) ctx.damageHero(LAMIA.tailDmg, this.pos.x, this.pos.z, 5);
      }
    }
    if (at.t >= at.tele + at.act && at.kind !== 'fire') this.endAttack(fast);
  }

  private endAttack(fast: number): void {
    this.attack = null;
    this.cooldown = (1.1 + Math.random() * 0.6) * fast;
  }

  private setVuln(head: number, x: number, z: number, world: WorldQuery, dur = LAMIA.vuln): void {
    if (this.heads[head].hp <= 0) return;
    this.vuln = { head, x, z, t: dur };
    this.vulnRing.mesh.visible = true;
    this.vulnRing.place(x, z, world);
    this.vulnRing.progress(1);
  }

  /** Удар отблизо. 'head' — ударена глава; 'armor' — удари люспите (без щета); null — нищо. */
  meleeHit(x: number, z: number, yaw: number, reach: number, damage: number, ctx: BossCtx): 'head' | 'armor' | null {
    if (this.state === 'dead' || this.state === 'dying') return null;
    if (this.vuln && this.state === 'fight') {
      const dx = this.vuln.x - x, dz = this.vuln.z - z, d = Math.hypot(dx, dz);
      let da = Math.atan2(dx, dz) - yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (d < reach + 1.4 && (d < 1.6 || Math.abs(da) < 1.2)) { this.damageHead(this.vuln.head, damage, ctx, this.vuln.x, this.vuln.z); return 'head'; }
    }
    const db = Math.hypot(this.pos.x - x, this.pos.z - z);
    if (db < reach + LAMIA.bodyR) {
      if (this.state === 'sleep') this.wake(ctx);
      if (this.armorMsgT <= 0) { ctx.notify('Люспите ѝ са като желязо! Удряй главите, когато захапят ниско.'); this.armorMsgT = 8; }
      ctx.sfx('block');
      return 'armor';
    }
    return null;
  }

  /** Стрела. */
  arrowHit(p: THREE.Vector3, damage: number, ctx: BossCtx): boolean {
    if (this.defeated) return false;
    if (this.vuln && this.state === 'fight' && Math.hypot(p.x - this.vuln.x, p.z - this.vuln.z) < 1.8 && p.y < this.pos.y + 3.5) {
      this.damageHead(this.vuln.head, damage, ctx, this.vuln.x, this.vuln.z); return true;
    }
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < LAMIA.bodyR && p.y < this.pos.y + 7) {
      if (this.state === 'sleep') this.wake(ctx);
      ctx.sfx('block'); return true;
    }
    return false;
  }

  private damageHead(i: number, dmg: number, ctx: BossCtx, x: number, z: number): void {
    const h = this.heads[i]; if (h.hp <= 0) return;
    h.hp = Math.max(0, h.hp - dmg);
    this.model.flash(0xffffff);
    ctx.onHit(dmg, x, this.pos.y + 1.5, z);
    ctx.sfx('hit');
    if (h.hp <= 0) {
      this.model.setHeadAlive(i, false);
      this.vuln = null; this.vulnRing.mesh.visible = false;
      ctx.sfx('roar'); ctx.shake(0.5);
      ctx.onHeadKilled(i);
      const left = this.alive;
      if (left === 0) { this.defeat(ctx); return; }
      ctx.notify(left === 2 ? 'Една глава падна! Ламята бълва огън — пази се от пламъците!' : 'Втора глава падна! Ламята побесня!');
      if (left === 1) this.summonT = 1.5;
      this.attack = null; this.cooldown = 1.6;
    }
    ctx.onChange();
  }

  private defeat(ctx: BossCtx): void {
    this.state = 'dying'; this.t = 0;
    this.resetFight();
    this.model.play('die');
    ctx.onDefeated();
    ctx.onChange();
  }

  /** За проби: убива я веднага. */
  debugKill(ctx: BossCtx): void {
    if (this.defeated) return;
    for (let i = 0; i < 3; i++) if (this.heads[i].hp > 0) { this.heads[i].hp = 1; this.damageHead(i, 9999, ctx, this.pos.x, this.pos.z); }
  }

  private turnTo(x: number, z: number, k: number): void {
    const a = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = a - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), k);
  }

  private sync(): void {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
  }

  dispose(): void {
    this.model.root.removeFromParent(); this.model.dispose();
    this.ring.dispose(); this.vulnRing.dispose();
    this.fire.dispose(); this.burns.dispose(); this.rocks.dispose();
  }
}
