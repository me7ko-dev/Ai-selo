// Врагове: таласъми (по здрач и нощем в Тъмната гора) и лисицата-таласъм (краде кокошките).
import * as THREE from 'three';
import type { WorldQuery } from '../core/world-query';
import { isDarkish, minuteOfDay } from '../core/time';
import { FOREST, PLACES, TALASAM_SPAWNS, type Vec2 } from '../data/layout';
import { createMonsterModel, type CharacterModel, type MonsterKind } from '../models';

export interface CombatCtx {
  world: WorldQuery;
  heroPos: THREE.Vector3;
  heroDead: boolean;
  time: number;
  damageHero(amount: number, fromX: number, fromZ: number, knockback: number): void;
  sfx(name: string): void;
  onKilled(e: Enemy): void;
  onFoxCaught(e: Enemy): void;
}

type State = 'rise' | 'wander' | 'chase' | 'windup' | 'recover' | 'return' | 'flee' | 'hurt' | 'dead' | 'sneak' | 'escape';

export const TALASAM = { hp: 45, damage: 12, aggro: 14, chase: 5.3, wander: 1.8, reach: 2.4, windup: 0.7, maxAlive: 5, xp: 25 };
export const FOX = { hits: 3, speed: 6.9, notice: 13, xp: 60 };

export class Enemy {
  readonly model: CharacterModel;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  hp: number;
  readonly maxHp: number;
  readonly radius: number;
  state: State = 'rise';
  t = 0;
  hits = 0;
  removed = false;
  /** Призован от Ламята (не се връща в гората и не бяга на зазоряване). */
  leash: { x: number; z: number; r: number } | null = null;
  private goal: Vec2 | null = null;
  private knock = new THREE.Vector2();
  private struck = false;
  private riseY = 0;

  constructor(readonly kind: MonsterKind, readonly home: Vec2, scene: THREE.Scene) {
    this.model = createMonsterModel(kind);
    this.maxHp = this.hp = kind === 'talasam' ? TALASAM.hp : FOX.hits;
    this.radius = kind === 'talasam' ? 0.6 : 0.4;
    scene.add(this.model.root);
    this.state = kind === 'talasam' ? 'rise' : 'sneak';
    this.riseY = kind === 'talasam' ? -1.6 : 0;
  }

  get alive(): boolean { return this.state !== 'dead' && !this.removed; }

  place(x: number, z: number, world: WorldQuery): void {
    this.pos.set(x, world.heightAt(x, z), z);
    this.sync();
  }

  takeHit(dmg: number, fromX: number, fromZ: number, knock: number, ctx: CombatCtx): boolean {
    if (!this.alive || this.state === 'rise' && this.riseY < -1.2) return false;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
    this.knock.set((dx / l) * knock, (dz / l) * knock);
    this.model.flash(0xffffff);
    if (this.kind === 'fox_talasam') {
      this.hits++;
      ctx.sfx('fox');
      if (this.hits >= FOX.hits) { this.state = 'dead'; this.t = 0; this.model.play('die'); ctx.onFoxCaught(this); return true; }
      this.state = 'hurt'; this.t = 0.8; this.model.play('hit');
      return true;
    }
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0; this.state = 'dead'; this.t = 0; this.model.play('die');
      ctx.sfx('die'); ctx.onKilled(this);
      return true;
    }
    this.state = 'hurt'; this.t = 0.4; this.model.play('hit');
    return true;
  }

  update(dt: number, ctx: CombatCtx, others: Enemy[]): void {
    const { world, heroPos } = ctx;
    const dx = heroPos.x - this.pos.x, dz = heroPos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    let speed = 0, tx = 0, tz = 0;
    const night = isDarkish(ctx.time);

    switch (this.state) {
      case 'dead':
        this.t += dt;
        if (this.t > 1.6) this.riseY -= dt * 0.8;
        if (this.t > 3.2) this.removed = true;
        break;
      case 'rise':
        this.riseY = Math.min(0, this.riseY + dt * 1.4);
        if (this.riseY >= 0) { this.state = 'wander'; this.model.play('idle', { loop: true }); }
        break;
      case 'hurt':
        this.t -= dt;
        if (this.t <= 0) this.state = this.kind === 'fox_talasam' ? 'flee' : 'chase';
        if (this.kind === 'fox_talasam') speed = 0;
        break;
      case 'wander': {
        if (!this.goal || Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) < 1 || Math.random() < dt * 0.15) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 10;
          const c = this.leash ?? this.home;
          this.goal = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
        }
        tx = this.goal.x; tz = this.goal.z; speed = TALASAM.wander;
        if (!ctx.heroDead && d < TALASAM.aggro && this.inLeash(heroPos.x, heroPos.z, 8)) { this.state = 'chase'; ctx.sfx('growl'); }
        break;
      }
      case 'chase':
        tx = heroPos.x; tz = heroPos.z; speed = TALASAM.chase;
        if (ctx.heroDead || d > TALASAM.aggro * 1.7) this.state = 'wander';
        else if (!this.inLeash(this.pos.x, this.pos.z, 0)) this.state = 'return';
        else if (d < TALASAM.reach * 0.85) {
          this.state = 'windup'; this.t = TALASAM.windup; this.struck = false;
          this.model.play('attack', { speed: 0.75 }); this.model.flash(0xffa040); ctx.sfx('growl');
        }
        break;
      case 'windup':
        this.t -= dt;
        this.faceTo(heroPos.x, heroPos.z, dt * 6);
        if (this.t <= 0 && !this.struck) {
          this.struck = true;
          const a = Math.atan2(dx, dz); let da = a - this.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
          if (d < TALASAM.reach + 0.4 && Math.abs(da) < 1.3 && !ctx.heroDead) ctx.damageHero(TALASAM.damage, this.pos.x, this.pos.z, 1.2);
          this.state = 'recover'; this.t = 0.6;
        }
        break;
      case 'recover':
        this.t -= dt;
        if (this.t <= 0) this.state = 'chase';
        break;
      case 'return': {
        const c = this.leash ?? this.home;
        tx = c.x; tz = c.z; speed = TALASAM.chase * 0.8;
        if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 6) this.state = 'wander';
        break;
      }
      case 'flee':
        if (this.kind === 'fox_talasam') {
          // бяга от героя към гората
          const edge = PLACES.forest_edge.pos;
          const ax = -dx / (d || 1), az = -dz / (d || 1);
          const ex = edge.x - this.pos.x, ez = edge.z - this.pos.z, el = Math.hypot(ex, ez) || 1;
          tx = this.pos.x + (ax * 0.55 + (ex / el) * 0.45) * 10; tz = this.pos.z + (az * 0.55 + (ez / el) * 0.45) * 10;
          speed = FOX.speed;
          if (d > 60 || Math.hypot(this.pos.x - FOREST.center.x, this.pos.z - FOREST.center.z) < FOREST.radius - 10) { this.state = 'escape'; this.t = 0; }
        } else {
          tx = this.home.x; tz = this.home.z; speed = TALASAM.chase;
          this.t += dt;
          if (this.t > 8 || Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z) < 2) { this.state = 'dead'; this.t = 1.6; }
        }
        break;
      case 'sneak': {
        // обикаля кокошарника
        const c = PLACES.coop.pos;
        this.t += dt;
        tx = c.x + Math.cos(this.t * 0.4) * 5; tz = c.z + Math.sin(this.t * 0.4) * 5; speed = 1.6;
        if (d < FOX.notice) { this.state = 'flee'; ctx.sfx('fox'); }
        break;
      }
      case 'escape':
        this.t += dt; this.riseY -= dt * 1.5;
        if (this.t > 1) this.removed = true;
        break;
    }

    // таласъмите бягат на зазоряване
    if (this.kind === 'talasam' && !this.leash && !night && this.alive && this.state !== 'flee' && this.state !== 'escape') { this.state = 'flee'; this.t = 0; }

    // движение
    let vx = 0, vz = 0;
    if (speed > 0) {
      const mx = tx - this.pos.x, mz = tz - this.pos.z, ml = Math.hypot(mx, mz);
      if (ml > 0.05) { vx = (mx / ml) * speed; vz = (mz / ml) * speed; this.faceTo(tx, tz, dt * 8); }
    }
    // да не се трупат един в друг
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, ol = Math.hypot(ox, oz);
      if (ol < 1.4 && ol > 0.001) { vx += (ox / ol) * 2; vz += (oz / ol) * 2; }
    }
    vx += this.knock.x * 7; vz += this.knock.y * 7;
    this.knock.multiplyScalar(Math.exp(-dt * 9));
    if (this.alive) {
      const c = world.collide(this.pos.x + vx * dt, this.pos.z + vz * dt, this.radius);
      if (!world.lockedAt(c.x, c.z)) { this.pos.x = c.x; this.pos.z = c.z; }
    }
    this.pos.y = world.heightAt(this.pos.x, this.pos.z);
    const sp = Math.hypot(vx, vz);
    if (this.alive && this.state !== 'windup' && this.state !== 'hurt' && this.state !== 'rise') {
      const want = sp > 4 ? 'run' : sp > 0.3 ? 'walk' : 'idle';
      if (this.model.current !== want && ['idle', 'walk', 'run'].includes(this.model.current)) this.model.play(want, { loop: true });
    }
    this.model.update(dt, sp);
    this.sync();
  }

  private inLeash(x: number, z: number, extra: number): boolean {
    if (this.leash) return Math.hypot(x - this.leash.x, z - this.leash.z) < this.leash.r + extra;
    return Math.hypot(x - FOREST.center.x, z - FOREST.center.z) < FOREST.radius + 12 + extra;
  }

  private faceTo(x: number, z: number, k: number): void {
    const a = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = a - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, k);
  }

  private sync(): void {
    this.model.root.position.set(this.pos.x, this.pos.y + this.riseY, this.pos.z);
    this.model.root.rotation.y = this.yaw;
  }

  dispose(): void { this.model.root.removeFromParent(); this.model.dispose(); }
}

export class EnemyManager {
  list: Enemy[] = [];
  private spawnT = 3;
  private foxCd = 0;

  constructor(private scene: THREE.Scene) {}

  spawnTalasam(x: number, z: number, world: WorldQuery, leash?: { x: number; z: number; r: number }): Enemy {
    const e = new Enemy('talasam', { x, z }, this.scene);
    if (leash) e.leash = leash;
    e.place(x, z, world);
    this.list.push(e);
    return e;
  }

  spawnFox(world: WorldQuery): Enemy {
    const c = PLACES.coop.pos;
    const e = new Enemy('fox_talasam', { ...c }, this.scene);
    e.place(c.x + 5, c.z, world);
    this.list.push(e);
    return e;
  }

  /** Живи таласъми от гората (без призованите). */
  forestCount(): number { return this.list.filter(e => e.kind === 'talasam' && e.alive && !e.leash).length; }
  summonedCount(): number { return this.list.filter(e => e.kind === 'talasam' && e.alive && !!e.leash).length; }
  fox(): Enemy | undefined { return this.list.find(e => e.kind === 'fox_talasam' && !e.removed); }

  update(dt: number, ctx: CombatCtx, foxActive: boolean): void {
    const { world, heroPos, time } = ctx;
    // поява в гората по здрач/нощем, само ако героят е наблизо
    const nearForest = Math.hypot(heroPos.x - FOREST.center.x, heroPos.z - FOREST.center.z) < FOREST.radius + 70;
    if (isDarkish(time) && nearForest) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 6 + Math.random() * 6;
        if (this.forestCount() < TALASAM.maxAlive) {
          const ok = TALASAM_SPAWNS.filter(s => { const dd = Math.hypot(s.x - heroPos.x, s.z - heroPos.z); return dd > 18 && dd < 130; });
          if (ok.length) { const s = ok[Math.floor(Math.random() * ok.length)]; this.spawnTalasam(s.x + (Math.random() - 0.5) * 6, s.z + (Math.random() - 0.5) * 6, world); }
        }
      }
    } else this.spawnT = Math.min(this.spawnT, 2);

    // лисицата: нощем 22:00–04:00 при кокошарника
    const m = minuteOfDay(time);
    const foxTime = m >= 22 * 60 || m < 4 * 60;
    this.foxCd = Math.max(0, this.foxCd - dt);
    const fox = this.fox();
    const nearCoop = Math.hypot(heroPos.x - PLACES.coop.pos.x, heroPos.z - PLACES.coop.pos.z) < 70;
    if (foxActive && foxTime && nearCoop && !fox && this.foxCd <= 0) { this.spawnFox(world); ctx.sfx('fox'); }
    if (fox && fox.alive && (!foxActive || !foxTime)) { fox.state = 'escape'; fox.t = 0; }

    for (const e of this.list) e.update(dt, ctx, this.list);
    for (const e of this.list.filter(q => q.removed)) {
      if (e.kind === 'fox_talasam' && e.state === 'escape') this.foxCd = 25;
      e.dispose();
    }
    this.list = this.list.filter(e => !e.removed);
    // далеч от героя — махни (освен призованите)
    for (const e of this.list) if (!e.leash && e.alive && Math.hypot(e.pos.x - heroPos.x, e.pos.z - heroPos.z) > 200) e.removed = true;
  }

  /** Удар отблизо: всички живи в обхвата и в конуса пред героя. Връща ударените. */
  meleeHit(x: number, z: number, yaw: number, reach: number, halfCone: number, damage: number, knock: number, ctx: CombatCtx): Enemy[] {
    const hit: Enemy[] = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      const dx = e.pos.x - x, dz = e.pos.z - z, d = Math.hypot(dx, dz);
      if (d > reach + e.radius) continue;
      let da = Math.atan2(dx, dz) - yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (d > 0.8 && Math.abs(da) > halfCone) continue;
      if (e.takeHit(damage, x, z, knock, ctx)) hit.push(e);
    }
    return hit;
  }

  /** Стрела: първият враг в сферата. */
  hitSphere(p: THREE.Vector3, r: number, damage: number, fromX: number, fromZ: number, ctx: CombatCtx): Enemy | null {
    for (const e of this.list) {
      if (!e.alive) continue;
      const h = e.kind === 'talasam' ? 1.5 : 0.7;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < e.radius + r && p.y > e.pos.y - 0.2 && p.y < e.pos.y + h + 0.3) {
        if (e.takeHit(damage, fromX, fromZ, 0.6, ctx)) return e;
      }
    }
    return null;
  }

  /** Най-близкият жив враг пред героя (за насочване на удара). */
  nearest(x: number, z: number, maxD: number, yaw?: number, halfCone = Math.PI): Enemy | null {
    let best: Enemy | null = null, bd = maxD;
    for (const e of this.list) {
      if (!e.alive || e.state === 'rise') continue;
      const dx = e.pos.x - x, dz = e.pos.z - z, d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if (yaw !== undefined) { let da = Math.atan2(dx, dz) - yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); if (Math.abs(da) > halfCone) continue; }
      bd = d; best = e;
    }
    return best;
  }

  /** Маха враговете около точка (след смърт на героя). */
  clearNear(x: number, z: number, r: number): void {
    for (const e of this.list) if (Math.hypot(e.pos.x - x, e.pos.z - z) < r && e.alive) { e.state = 'escape'; e.t = 0; }
  }

  clear(): void { for (const e of this.list) e.dispose(); this.list = []; }
  dispose(): void { this.clear(); }
}
