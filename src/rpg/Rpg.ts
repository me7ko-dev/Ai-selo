// RPG фасадата: героят, камерата, боят, враговете, Ламята, раницата, нивата и задачите.
// Играта (Game) я създава веднъж и вика update() всеки кадър. Интерфейсът чете hud()/inventory()/questLog()/markers()
// и слуша bus. Без DOM.
import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { WorldQuery } from '../core/world-query';
import { Emitter } from '../core/bus';
import { minuteOfDay, dayOf } from '../core/time';
import { PLACES, ROAD_NODES, ROSEN_SPOTS } from '../data/layout';
import { VILLAGERS, type VillagerId } from '../data/villagers';
import type { DialogueOption } from '../sim/types';
import { createHeroModel, type HeroModel } from '../models';
import type { QuestHost } from './host';
import { Inventory } from './inventory';
import { ITEMS, EQUIP_SLOTS, viewOf, type EquipSlot, type ItemId, type ItemStackView } from './items';
import { Stats, mitigate } from './stats';
import { Quests, type QuestCtx, type NotifyKind } from './quests';
import { FogGrid } from './fog';
import { Hero, CameraRig, NO_INPUT, type HeroInput } from './hero';
import { EnemyManager, TALASAM, FOX, type CombatCtx, type Enemy } from './enemies';
import { Lamia, LAMIA, type BossCtx } from './lamia';
import { PickupManager, type WorldItem } from './pickups';
import { Arrows } from './fx';
import type { HudState, InventoryState, PlayerSave, RpgEvents, HotbarCell } from './types';

export type { EquipSlot, ItemId, ItemStackView } from './items';
export type { HudState, InventoryState, PlayerSave, RpgEvents, HotbarCell, BossHead } from './types';

const CHESTS: { key: string; x: number; z: number; items: { id: ItemId; count: number }[] }[] = [
  { key: 'chest_forest', x: -156, z: -106, items: [{ id: 'gloves', count: 1 }, { id: 'coin', count: 20 }] },
  { key: 'chest_glade', x: -158, z: -166, items: [{ id: 'tea', count: 2 }, { id: 'rosen_potion', count: 1 }] },
];
// до оградата на нивата (отвън), за да се вижда и стига — оградата минава на z≈103
const BELL_POS = { x: PLACES.field_ivan.pos.x + 7, z: PLACES.field_ivan.pos.z - 7.5 };
const START = { x: PLACES.start.pos.x, z: PLACES.start.pos.z, yaw: Math.PI };

export class Rpg {
  readonly bus = new Emitter<RpgEvents>();
  readonly inv: Inventory;
  readonly stats = new Stats();
  readonly quests: Quests;
  private readonly hero: Hero;
  private readonly heroModel: HeroModel;
  private readonly cam: CameraRig;
  private readonly enemies: EnemyManager;
  private readonly lamia: Lamia;
  private readonly pickups: PickupManager;
  private readonly arrows: Arrows;
  private readonly fog = new FogGrid();
  private controls = true;
  private time = 0;
  private deadT = 0;
  private fogT = 0;
  private syncT = 0;
  private hurtT = 99;
  private regenAcc = 0;
  private rosenPicked = new Set<number>();
  private bellTaken = false;
  private chestsOpened = new Set<string>();
  private lastKillDeedDay = -1;
  private lastBossEmit = '';
  private readonly cctx: CombatCtx;
  private readonly bctx: BossCtx;
  private tmpV = new THREE.Vector3();

  constructor(private engine: Engine, private world: WorldQuery, private host: QuestHost, save?: PlayerSave) {
    const scene = engine.scene;
    this.inv = Inventory.starting();
    this.heroModel = createHeroModel();
    scene.add(this.heroModel.root);
    this.hero = new Hero(this.heroModel);
    this.cam = new CameraRig(engine.camera);
    this.enemies = new EnemyManager(scene);
    this.lamia = new Lamia(scene, world);
    this.pickups = new PickupManager(scene);
    this.arrows = new Arrows(scene);

    const qctx: QuestCtx = {
      host,
      inv: this.inv,
      give: (id, n) => this.give(id, n),
      xp: (n) => this.addXp(n, true),
      equip: (id) => { const i = this.inv.find(id); if (i >= 0) { this.inv.equipFromSlot(i); this.refreshGear(); this.notify(`Екипира: ${ITEMS[id].name}`, 'item'); } },
      notify: (t, k) => this.notify(t, k),
      questChanged: (id, stage, title, text) => this.bus.emit('quest', { id, stage, title, text }),
      questDone: (id, title) => { this.bus.emit('questDone', { id, title }); this.sfx('quest'); },
      buy: (id, price) => this.buy(id, price),
      sellAll: (id, each) => {
        const n = this.inv.count(id); if (n <= 0) return 0;
        this.inv.remove(id, n);
        this.inv.gold += n * each;
        this.notify(`Продаде ${ITEMS[id].name} ×${n} за ${n * each} гроша`, 'item');
        this.sfx('coin');
        return n * each;
      },
    };
    this.quests = new Quests(qctx);

    this.cctx = {
      world, heroPos: this.hero.pos, heroDead: false, time: 0,
      damageHero: (a, x, z, k) => this.damageHero(a, x, z, k),
      sfx: (n) => this.sfx(n),
      onKilled: (e) => this.onKilled(e),
      onFoxCaught: (e) => this.onFoxCaught(e),
    };
    this.bctx = {
      world, heroPos: this.hero.pos, heroDead: false,
      damageHero: (a, x, z, k) => this.damageHero(a, x, z, k),
      sfx: (n) => this.sfx(n),
      shake: (a) => this.cam.shake(a),
      summon: (x, z) => { this.enemies.spawnTalasam(x, z, world, { x: this.lamia.center.x, z: this.lamia.center.z, r: 30 }); },
      summonedCount: () => this.enemies.summonedCount(),
      notify: (t) => this.notify(t, 'warn'),
      onWake: () => this.notify(this.quests.stages.lamia === 'none'
        ? 'Ламята се събуди! Още не си готов за нея… но тя няма да чака.'
        : 'Ламята се събуди! Удряй главите, когато захапят ниско.', 'warn'),
      onHeadKilled: () => { this.bus.emit('killed', { kind: 'lamia_head' }); this.addXp(80); },
      onDefeated: () => this.onLamiaDefeated(),
      onChange: () => this.emitBoss(),
      onHit: (a, x, y, z) => this.bus.emit('damage', { amount: Math.round(a), target: 'enemy', x, y, z }),
    };

    this.hero.onAttackHit = (idx, mult, reach) => this.onAttackHit(idx, mult, reach);
    this.hero.onShoot = () => this.shoot();
    this.hero.aim = () => this.aimTarget();
    this.hero.onLocked = (msg) => this.notify(msg, 'warn');
    this.hero.onSfx = (n) => this.sfx(n);

    if (save) this.load(save);
    else {
      this.teleport(START.x, START.z, START.yaw); this.refreshGear(); this.syncWorldItems();
      this.stats.hp = this.stats.maxHp; this.stats.stamina = this.stats.maxStamina;
    }
  }

  // ---------------- основни ----------------
  get heroPos(): THREE.Vector3 { return this.hero.pos; }
  get heroYaw(): number { return this.hero.yaw; }
  /** Посоката на камерата (за мини-картата). */
  get cameraYaw(): number { return this.cam.yaw; }
  get dead(): boolean { return this.hero.dead; }

  setControlsEnabled(on: boolean): void { this.controls = on; }

  update(dt: number, totalGameMinutes: number): void {
    this.time = totalGameMinutes;
    const input = this.engine.input;
    const active = this.controls && !this.hero.dead;
    let inp: HeroInput = NO_INPUT;
    if (active) {
      inp = {
        fwd: (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0),
        right: (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0),
        run: input.down('ShiftLeft') || input.down('ShiftRight'),
        jump: input.pressed('Space'),
        attack: input.mouseClicked(0),
        block: input.mouseDown(2),
      };
      for (let h = 0; h < 6; h++) if (input.pressed('Digit' + (h + 1))) this.useHotbar(h);
    }
    this.hero.update(dt, inp, this.cam.yaw, this.world, this.stats);

    // тялото на Ламята е препятствие
    if (!this.lamia.defeated || this.lamia.state === 'dying') {
      const dx = this.hero.pos.x - this.lamia.pos.x, dz = this.hero.pos.z - this.lamia.pos.z, d = Math.hypot(dx, dz);
      const r = LAMIA.bodyR + 0.4;
      if (d < r && d > 0.001) { this.hero.pos.x = this.lamia.pos.x + (dx / d) * r; this.hero.pos.z = this.lamia.pos.z + (dz / d) * r; }
    }

    // врагове и Ламята
    this.cctx.heroDead = this.bctx.heroDead = this.hero.dead;
    this.cctx.time = totalGameMinutes;
    this.enemies.update(dt, this.cctx, this.quests.foxActive());
    this.lamia.update(dt, this.bctx);
    this.arrows.update(dt, this.world, (a) => {
      if (this.enemies.hitSphere(a.pos, 0.3, a.damage, this.hero.pos.x, this.hero.pos.z, this.cctx)) {
        this.bus.emit('damage', { amount: Math.round(a.damage), target: 'enemy', x: a.pos.x, y: a.pos.y + 0.3, z: a.pos.z });
        this.sfx('hit'); return true;
      }
      return this.lamia.arrowHit(a.pos, a.damage, this.bctx);
    });
    if (this.lamia.active) {
      const key = this.lamia.heads.map(h => h.hp).join(',') + this.lamia.phase;
      if (key !== this.lastBossEmit) this.emitBoss();
    }

    // предмети на земята
    for (const it of this.pickups.update(dt, this.hero.pos.x, this.hero.pos.z)) this.take(it);
    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 0.5; this.syncWorldItems(); }

    // мъгла над картата
    this.fogT -= dt;
    if (this.fogT <= 0) { this.fogT = 0.25; this.fog.reveal(this.hero.pos.x, this.hero.pos.z, 36); }

    // бавно лекуване извън бой
    this.hurtT += dt;
    if (!this.hero.dead && this.hurtT > 8 && this.stats.hp < this.stats.maxHp) {
      this.regenAcc += dt * 1.5;
      if (this.regenAcc >= 1) { const k = Math.floor(this.regenAcc); this.regenAcc -= k; this.stats.heal(k); }
    }

    // смърт → събуждане в хана
    if (this.hero.dead) { this.deadT += dt; if (this.deadT > 5) this.respawn(); }

    // камера
    const look = {
      dx: this.controls && input.locked ? input.mouseDX : 0,
      dy: this.controls && input.locked ? input.mouseDY : 0,
      wheel: this.controls ? input.wheel : 0,
      keyYaw: this.controls ? (input.down('ArrowLeft') ? -1 : 0) + (input.down('ArrowRight') ? 1 : 0) : 0,
      sensitivity: input.sensitivity,
    };
    const L = this.lamia;
    const nearBoss = L.active && Math.hypot(L.pos.x - this.hero.pos.x, L.pos.z - this.hero.pos.z) < 22;
    this.cam.update(dt, this.hero.pos, this.world, look, L.state === 'dead' ? [] : [{ x: L.pos.x, z: L.pos.z, r: LAMIA.bodyR + 0.8, h: 7 }], nearBoss ? 1.6 : 0);
  }

  // ---------------- бой ----------------
  private weaponDamage(): number { const b = this.inv.bonuses(); return this.stats.damage(b.weaponDamage, b.damage); }

  private aimTarget(): { x: number; z: number } | null {
    const f = this.cam.forward(), fy = Math.atan2(f.x, f.z);
    if (this.hero.ranged) {
      const e = this.enemies.nearest(this.hero.pos.x, this.hero.pos.z, 35, fy, 0.45);
      if (e) return { x: e.pos.x, z: e.pos.z };
      const v = this.lamia.vuln;
      if (v && Math.hypot(v.x - this.hero.pos.x, v.z - this.hero.pos.z) < 35) return { x: v.x, z: v.z };
      return null;
    }
    const v = this.lamia.vuln;
    if (v && Math.hypot(v.x - this.hero.pos.x, v.z - this.hero.pos.z) < 4.5) return { x: v.x, z: v.z };
    const e = this.enemies.nearest(this.hero.pos.x, this.hero.pos.z, 3.6, fy, 2.1);
    return e ? { x: e.pos.x, z: e.pos.z } : null;
  }

  private onAttackHit(idx: number, mult: number, reach: number): void {
    const crit = Math.random() < 0.1;
    const dmg = this.weaponDamage() * mult * (0.9 + Math.random() * 0.2) * (crit ? 1.5 : 1);
    const h = this.hero;
    const hits = this.enemies.meleeHit(h.pos.x, h.pos.z, h.yaw, reach, 1.05, dmg, idx === 2 ? 1.5 : 0.8, this.cctx);
    for (const e of hits) {
      this.bus.emit('damage', { amount: e.kind === 'fox_talasam' ? 1 : Math.round(dmg), target: 'enemy', x: e.pos.x, y: e.pos.y + 1.4, z: e.pos.z, crit });
    }
    if (hits.length) { this.sfx('hit'); this.cam.shake(idx === 2 ? 0.12 : 0.06); }
    const lr = this.lamia.meleeHit(h.pos.x, h.pos.z, h.yaw, reach, dmg, this.bctx);
    if (lr === 'head') this.cam.shake(0.1);
  }

  private shoot(): void {
    const h = this.hero;
    const from = this.tmpV.set(h.pos.x + Math.sin(h.yaw) * 0.5, h.pos.y + 1.4, h.pos.z + Math.cos(h.yaw) * 0.5).clone();
    const t = this.aimTarget();
    let dir: THREE.Vector3;
    if (t) {
      const ty = this.world.heightAt(t.x, t.z) + 1.0;
      dir = new THREE.Vector3(t.x - from.x, ty - from.y, t.z - from.z);
      dir.y += dir.length() * 0.06; // малко нагоре заради падането
    } else {
      dir = new THREE.Vector3();
      this.engine.camera.getWorldDirection(dir);
      dir.y += 0.05;
    }
    const dmg = this.weaponDamage() * (0.9 + Math.random() * 0.2);
    this.arrows.shoot(from, dir, dmg);
  }

  private damageHero(amount: number, fx: number, fz: number, knock: number): void {
    const h = this.hero;
    if (h.dead || h.invuln > 0) return;
    const blocked = h.blocking && h.facingToward(fx, fz);
    let dmg = mitigate(amount, this.inv.bonuses().armor);
    if (blocked) {
      dmg *= 0.25;
      this.stats.stamina = Math.max(0, this.stats.stamina - 14);
      if (this.stats.stamina <= 0) { h.blocking = false; h.stagger = 0.6; this.notify('Блокът ти се пречупи!', 'warn'); }
    }
    dmg = Math.max(1, Math.round(dmg));
    this.stats.hp = Math.max(0, this.stats.hp - dmg);
    this.hurtT = 0;
    h.hurt(fx, fz, knock, blocked);
    this.bus.emit('damage', { amount: dmg, target: 'hero', x: h.pos.x, y: h.pos.y + 1.8, z: h.pos.z, blocked });
    this.sfx(blocked ? 'block' : 'hurt');
    this.cam.shake(blocked ? 0.08 : 0.22);
    if (this.stats.hp <= 0) this.die();
  }

  private die(): void {
    this.hero.die();
    this.deadT = 0;
    this.sfx('die');
    this.bus.emit('died', {});
    this.notify('Падна… Светът потъмня.', 'warn');
  }

  respawn(): void {
    const lost = Math.min(this.inv.gold, Math.max(3, Math.floor(this.inv.gold * 0.1)));
    this.inv.gold -= lost;
    const from = this.hero.pos.clone();
    this.enemies.clearNear(from.x, from.z, 45);
    if (this.lamia.active) { this.lamia.sleep(); this.emitBoss(); }
    this.stats.hp = this.stats.maxHp;
    this.stats.stamina = this.stats.maxStamina;
    this.hero.revive();
    const p = ROAD_NODES.inn;
    this.teleport(p.x, p.z, Math.PI / 2);
    this.deadT = 0;
    this.bus.emit('respawn', {});
    this.notify(lost > 0 ? `Събуди се в хана. Радка те е завила с одеяло. (Изгуби ${lost} гроша)` : 'Събуди се в хана. Радка те е завила с одеяло.', 'info');
  }

  private onKilled(e: Enemy): void {
    this.bus.emit('killed', { kind: e.kind });
    this.addXp(TALASAM.xp);
    const drops: { id: ItemId; count: number }[] = [];
    if (Math.random() < 0.6) drops.push({ id: 'claw', count: 1 });
    if (Math.random() < 0.45) drops.push({ id: 'coin', count: 2 + Math.floor(Math.random() * 6) });
    drops.forEach((d, k) => this.pickups.add('loot', null, e.pos.x + (k - 0.5) * 0.8, e.pos.z + 0.4, [d], this.world, { ttl: 150, auto: true }));
    const day = dayOf(this.time);
    if (!e.leash && day !== this.lastKillDeedDay) {
      this.lastKillDeedDay = day;
      this.host.deed({ kind: 'killed_monster', text: 'Странникът се би с таласъми в Тъмната гора.', importance: 3, affinity: 3, trust: 3, witnesses: [] });
    }
  }

  private onFoxCaught(e: Enemy): void {
    this.quests.onFoxCaught();
    this.bus.emit('killed', { kind: 'fox_talasam' });
    this.addXp(FOX.xp);
    this.notify('Хвана лисицата-таласъм! Тя избяга в мрака — без опашката си.', 'quest');
    // направо в раницата: на земята в тъмното лесно се изпуска (а задачата чака опашката)
    this.give('fox_tail', 1);
    void e;
  }

  private onLamiaDefeated(): void {
    const p = this.lamia.pos;
    this.bus.emit('killed', { kind: 'lamia' });
    this.bus.emit('lamiaDefeated', {});
    this.addXp(LAMIA.xp, true);
    this.pickups.add('loot', 'lamia_scale', p.x + 4, p.z + 2, [{ id: 'lamia_scale', count: 1 }], this.world, { auto: true });
    this.pickups.add('loot', 'lamia_gold', p.x + 2, p.z + 4.5, [{ id: 'coin', count: 150 }], this.world, { auto: true });
    const h = this.host;
    h.setFlag('lamia_dead', true);
    h.riverFlow(true);
    h.inject({ type: 'sabor' });
    h.festival(true);
    h.chronicle('Странникът Стоян уби триглавата Ламя на Ламин връх. Бистрица отново тече и селото вдига сбор!', ['player', 'peyu', 'gena', 'petko', 'ivan', 'maria', 'radka', 'kalin'], 10, 'monster');
    h.deed({ kind: 'saved_village', text: 'Странникът уби Ламята и върна водата на Бистрица.', importance: 10, affinity: 40, trust: 40, witnesses: 'all' });
    this.quests.onLamiaDefeated();
    this.notify('Ламята е мъртва! Бистрица отново тече.', 'quest');
  }

  private emitBoss(): void {
    const L = this.lamia;
    this.lastBossEmit = L.heads.map(h => h.hp).join(',') + L.phase;
    this.bus.emit('boss', { active: L.active, heads: L.heads.map(h => ({ hp: Math.ceil(h.hp), max: h.max })), phase: L.phase });
  }

  // ---------------- предмети ----------------
  private notify(text: string, kind: NotifyKind = 'info'): void { this.bus.emit('notify', { text, kind }); }
  private sfx(name: string): void { if (name) this.bus.emit('sfx', { name }); }

  private addXp(n: number, announce = false): void {
    if (announce) this.notify(`+${n} опит`, 'level');
    for (const lvl of this.stats.addXp(n)) {
      this.bus.emit('levelup', { level: lvl, title: this.stats.title });
      this.notify(`Ново ниво: ${lvl} · ${this.stats.title}`, 'level');
      this.sfx('levelup');
    }
  }

  /** Дава предмет (награда, плячка). Ако раницата е пълна — пада на земята. */
  give(id: ItemId, n: number): void {
    const left = this.inv.add(id, n);
    const got = n - left;
    if (got > 0) {
      const d = ITEMS[id];
      this.bus.emit('pickup', { item: id, count: got, name: d.name, icon: d.icon });
      this.notify(id === 'coin' ? `+${got} гроша` : `+ ${d.name}${got > 1 ? ` ×${got}` : ''}`, 'item');
      this.sfx(id === 'coin' ? 'coin' : 'pickup');
      this.quests.onItem(id);
    }
    if (left > 0) {
      this.pickups.add('loot', null, this.hero.pos.x + 1, this.hero.pos.z, [{ id, count: left }], this.world, { auto: false });
      this.notify('Раницата е пълна — оставих го на земята.', 'warn');
    }
  }

  private take(it: WorldItem): boolean {
    if (it.used) return false;
    for (const s of it.items) if (!this.inv.canAdd(s.id, s.count)) { this.notify('Раницата е пълна.', 'warn'); return false; }
    for (const s of it.items) this.give(s.id, s.count);
    if (it.kind === 'rosen') { const i = Number(it.key.split(':')[1]); this.rosenPicked.add(i); }
    if (it.kind === 'bell') this.bellTaken = true;
    if (it.kind === 'chest') { this.chestsOpened.add(it.key); it.used = true; this.sfx('chest'); return true; }
    this.pickups.remove(it);
    return true;
  }

  private syncWorldItems(): void {
    const P = this.pickups;
    const wantRosen = this.quests.wantsRosen();
    ROSEN_SPOTS.forEach((s, i) => {
      const key = 'rosen:' + i;
      const want = wantRosen && !this.rosenPicked.has(i);
      if (want && !P.has(key)) P.add('rosen', key, s.x, s.z, [{ id: 'rosen', count: 1 }], this.world, { label: 'Набери росен' });
      if (!want && P.has(key)) P.removeKey(key);
    });
    const wantBell = this.quests.wantsBell() && !this.bellTaken;
    if (wantBell && !P.has('bell')) P.add('bell', 'bell', BELL_POS.x, BELL_POS.z, [{ id: 'bell', count: 1 }], this.world, { label: 'Вземи звънчето' });
    if (!wantBell && P.has('bell')) P.removeKey('bell');
    for (const c of CHESTS) {
      if (!P.has(c.key)) { const it = P.add('chest', c.key, c.x, c.z, c.items, this.world); it.used = this.chestsOpened.has(c.key); }
    }
  }

  /** Купуване (напр. в хана): false, ако няма грошове или място. */
  buy(id: ItemId, price: number, count = 1): boolean {
    if (this.inv.gold < price || !this.inv.canAdd(id, count)) { this.notify(this.inv.gold < price ? 'Нямаш достатъчно грошове.' : 'Раницата е пълна.', 'warn'); return false; }
    this.inv.gold -= price;
    this.give(id, count);
    return true;
  }

  /** Продаване на всички нокти/люспи и т.н. от клетка i. Връща получените грошове. */
  sellSlot(i: number): number {
    const s = this.inv.slots[i]; if (!s) return 0;
    const d = ITEMS[s.id];
    if (!d.value || d.kind === 'quest') return 0;
    const got = Math.max(1, Math.floor(d.value / 2)) * s.count;
    this.inv.slots[i] = null;
    this.inv.gold += got;
    this.notify(`Продаде ${d.name} ×${s.count} за ${got} гроша`, 'item');
    this.sfx('coin');
    return got;
  }

  // ---------------- [E] ----------------
  private coopHint(): { label: string; dist: number; act: () => boolean } | null {
    if (this.quests.stages.chickens !== 'watch') return null;
    const c = PLACES.coop.pos, d = Math.hypot(c.x - this.hero.pos.x, c.z - this.hero.pos.z);
    if (d > 8) return null;
    const m = minuteOfDay(this.time);
    if (m >= 22 * 60 || m < 4 * 60) return null;
    if (this.host.waitUntil) {
      return { label: 'Изчакай нощта при кокошарника (22:00)', dist: d, act: () => { this.host.waitUntil!(22 * 60 + 5); this.notify('Скри се в сянката до кокошарника и зачака…', 'quest'); return true; } };
    }
    return { label: 'Лисицата идва нощем (22:00–04:00)', dist: d, act: () => { this.notify('Ела тук нощем — между 22:00 и 04:00.', 'info'); return true; } };
  }

  interactHint(): { label: string; dist: number } | null {
    if (this.hero.dead) return null;
    const p = this.pickups.nearest(this.hero.pos.x, this.hero.pos.z, 2.2);
    const c = this.coopHint();
    if (p && (!c || p.dist <= c.dist)) return { label: p.it.label, dist: p.dist };
    if (c) return { label: c.label, dist: c.dist };
    return null;
  }

  interact(): boolean {
    if (this.hero.dead || !this.controls) return false;
    const p = this.pickups.nearest(this.hero.pos.x, this.hero.pos.z, 2.2);
    const c = this.coopHint();
    if (p && (!c || p.dist <= c.dist)) return this.take(p.it);
    if (c) return c.act();
    return false;
  }

  // ---------------- разговори ----------------
  questOptions(villager: VillagerId): DialogueOption[] { return this.quests.options(villager); }
  questChoose(villager: VillagerId, optionId: string): { say: string; options?: DialogueOption[]; end?: boolean } | null {
    return this.quests.choose(villager, optionId);
  }
  onTalk(villager: VillagerId): void { this.quests.onTalk(villager); }

  // ---------------- интерфейс ----------------
  hud(): HudState {
    const s = this.stats, L = this.lamia;
    const hotbar = this.inv.hotbar.map((id): HotbarCell | null => {
      if (!id) return null;
      const d = ITEMS[id];
      return { id, icon: d.icon, name: d.name, count: this.inv.count(id) + (this.inv.isEquipped(id) ? 1 : 0) };
    });
    return {
      hp: Math.ceil(s.hp), maxHp: s.maxHp, stamina: Math.round(s.stamina), maxStamina: s.maxStamina,
      level: s.level, title: s.title, xp: s.xp, xpNext: s.xpNext, gold: this.inv.gold,
      hotbar,
      boss: L.active ? { heads: L.heads.map(h => ({ hp: Math.ceil(h.hp), max: h.max })), phase: L.phase, name: 'Ламята' } : null,
      dead: this.hero.dead,
      blocking: this.hero.blocking,
    };
  }

  inventory(): InventoryState {
    const b = this.inv.bonuses();
    const equipment = {} as Record<EquipSlot, ItemStackView | null>;
    for (const sl of EQUIP_SLOTS) { const id = this.inv.equipment[sl]; equipment[sl] = id ? viewOf(id, 1) : null; }
    return {
      slots: this.inv.slots.map(st => (st ? viewOf(st.id, st.count) : null)),
      equipment,
      stats: {
        damage: this.weaponDamage(), armor: b.armor, maxHp: this.stats.maxHp, maxStamina: this.stats.maxStamina,
        level: this.stats.level, title: this.stats.title, xp: this.stats.xp, xpNext: this.stats.xpNext, gold: this.inv.gold,
      },
      hotbar: [...this.inv.hotbar],
    };
  }

  useSlot(i: number): void {
    const st = this.inv.slots[i]; if (!st || this.hero.dead) return;
    const d = ITEMS[st.id];
    if (d.slot) { this.equipFromSlot(i); return; }
    if (d.kind !== 'consumable') { this.notify(d.desc, 'info'); return; }
    const s = this.stats;
    if ((d.heal ?? 0) > 0 && !d.stamina && s.hp >= s.maxHp) { this.notify('Не ти трябва сега — здрав си.', 'info'); return; }
    if (d.stamina && s.stamina >= s.maxStamina && s.hp >= s.maxHp) { this.notify('Не ти трябва сега.', 'info'); return; }
    this.inv.removeAt(i, 1);
    const healed = d.heal ? s.heal(d.heal) : 0;
    if (d.stamina) s.restoreStamina(d.stamina);
    this.sfx('heal');
    const parts: string[] = [];
    if (healed > 0) parts.push(`+${Math.round(healed)} живот`);
    if (d.stamina) parts.push('силата се върна');
    this.notify(`${st.id === 'banitsa' ? 'Изяде' : st.id === 'tea' ? 'Изпи' : 'Изпи'} ${d.name.toLowerCase()}${parts.length ? ` (${parts.join(', ')})` : ''}`, 'item');
  }

  equipFromSlot(i: number): void {
    const st = this.inv.slots[i]; if (!st) return;
    const slot = this.inv.equipFromSlot(i);
    if (slot) { this.refreshGear(); this.sfx('equip'); this.notify(`Екипира: ${ITEMS[st.id].name}`, 'item'); }
  }

  unequip(slot: EquipSlot): void {
    if (!this.inv.unequip(slot)) { if (this.inv.equipment[slot]) this.notify('Раницата е пълна.', 'warn'); return; }
    this.refreshGear();
  }

  moveSlot(from: number, to: number): void { this.inv.move(from, to); }
  assignHotbar(slot: number, hot: number): void { this.inv.assignHotbar(slot, hot); }

  useHotbar(hot: number): void {
    const id = this.inv.hotbar[hot]; if (!id) return;
    if (this.inv.isEquipped(id)) return;
    const i = this.inv.find(id);
    if (i < 0) { this.notify(`Нямаш повече: ${ITEMS[id].name}`, 'warn'); return; }
    this.useSlot(i);
  }

  private refreshGear(): void {
    const b = this.inv.bonuses();
    this.stats.bonusHp = b.maxHp;
    this.stats.bonusStamina = b.maxStamina;
    this.stats.clamp();
    this.hero.ranged = b.ranged;
    const w = this.inv.equipment.weapon;
    this.heroModel.setWeapon(w === 'saber' || w === 'ivan_saber' || w === 'bow' ? w : null);
  }

  questLog(): { id: string; title: string; step: string; done: boolean; main: boolean }[] { return this.quests.log(); }

  markers(): { x: number; z: number; label: string; kind: 'quest' | 'boss' | 'item' }[] {
    const out: { x: number; z: number; label: string; kind: 'quest' | 'boss' | 'item' }[] = [];
    for (const m of this.quests.markers()) {
      let p: { x: number; z: number } | null = null;
      if (m.villager) p = this.host.villagerPos?.(m.villager) ?? PLACES[VILLAGERS[m.villager].home].pos;
      else if (m.place) p = PLACES[m.place].pos;
      else if (m.x !== undefined && m.z !== undefined) p = { x: m.x, z: m.z };
      if (p) out.push({ x: p.x, z: p.z, label: m.label, kind: m.kind });
    }
    if (this.quests.wantsRosen()) ROSEN_SPOTS.forEach((s, i) => { if (!this.rosenPicked.has(i)) out.push({ x: s.x, z: s.z, label: 'Росен', kind: 'item' }); });
    if (this.quests.wantsBell() && !this.bellTaken) out.push({ x: BELL_POS.x, z: BELL_POS.z, label: 'Звънче', kind: 'item' });
    return out;
  }

  explored(): Uint8Array { return this.fog.grid; }

  // ---------------- запис ----------------
  serialize(): PlayerSave {
    return {
      v: 1,
      stats: this.stats.serialize(),
      inventory: this.inv.serialize(),
      quests: this.quests.serialize(),
      pos: { x: +this.hero.pos.x.toFixed(2), z: +this.hero.pos.z.toFixed(2), yaw: +this.hero.yaw.toFixed(3) },
      explored: this.fog.serialize(),
      lamia: { heads: this.lamia.heads.map(h => Math.ceil(h.hp)), dead: this.lamia.defeated },
      rosenPicked: [...this.rosenPicked],
      bellTaken: this.bellTaken,
      chestsOpened: [...this.chestsOpened],
    };
  }

  load(s: PlayerSave): void {
    this.inv.load(s.inventory);
    this.stats.load(s.stats);
    this.quests.load(s.quests);
    this.fog.load(s.explored);
    this.rosenPicked = new Set(s.rosenPicked ?? []);
    this.bellTaken = !!s.bellTaken;
    this.chestsOpened = new Set(s.chestsOpened ?? []);
    this.lamia.load(s.lamia?.heads, !!s.lamia?.dead || !!this.host.getFlag('lamia_dead'));
    this.enemies.clear();
    this.pickups.clear();
    this.refreshGear();
    this.stats.clamp();
    if (this.hero.dead) this.hero.revive();
    const p = s.pos ?? START;
    this.teleport(p.x, p.z, p.yaw);
    this.syncWorldItems();
    this.emitBoss();
  }

  teleport(x: number, z: number, yaw?: number): void {
    this.hero.setPosition(x, z, this.world, yaw ?? this.hero.yaw);
    this.cam.snap(this.hero.pos, this.hero.yaw);
    this.fog.reveal(x, z, 36);
  }

  dispose(): void {
    this.heroModel.root.removeFromParent(); this.heroModel.dispose();
    this.enemies.dispose(); this.lamia.dispose(); this.pickups.dispose(); this.arrows.dispose();
    this.bus.clear();
  }

  // ---------------- за проби (dev страницата) ----------------
  readonly debug = {
    spawnTalasam: (dist = 6) => {
      const h = this.hero; const x = h.pos.x + Math.sin(h.yaw) * dist, z = h.pos.z + Math.cos(h.yaw) * dist;
      const e = this.enemies.spawnTalasam(x, z, this.world, { x: h.pos.x, z: h.pos.z, r: 60 });
      return e;
    },
    enemies: () => this.enemies.list.map(e => ({ kind: e.kind, hp: e.hp, state: e.state, x: e.pos.x, z: e.pos.z })),
    killBoss: () => this.lamia.debugKill(this.bctx),
    lamia: () => ({ state: this.lamia.state, heads: this.lamia.heads.map(h => h.hp), phase: this.lamia.phase, vuln: !!this.lamia.vuln }),
    damageHead: (i: number, n: number) => { const L = this.lamia as unknown as { damageHead(i: number, d: number, c: BossCtx, x: number, z: number): void }; L.damageHead(i, n, this.bctx, this.lamia.pos.x, this.lamia.pos.z); },
    give: (id: ItemId, n = 1) => this.give(id, n),
    xp: (n: number) => this.addXp(n, true),
    heal: () => { this.stats.hp = this.stats.maxHp; this.stats.stamina = this.stats.maxStamina; },
    hurt: (n: number) => this.damageHero(n, this.hero.pos.x + Math.sin(this.hero.yaw), this.hero.pos.z + Math.cos(this.hero.yaw), 0.5),
    toLamia: (dist = 34) => { const a = Math.atan2(-30, 18), c = this.lamia.center; this.teleport(c.x + Math.sin(a) * dist, c.z + Math.cos(a) * dist, a + Math.PI); },
    attack: () => { (this.hero as unknown as { tryAttack(y: number, s: Stats): void }).tryAttack(this.cam.yaw, this.stats); },
  };
}
