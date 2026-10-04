// Сглобява всичко: свят, живо село, ИИ мозък, герой и задачи, интерфейс, записи, машина на времето, лайв.
import * as THREE from 'three';
import { Engine } from '../engine/Engine';
import { World3D } from '../world/World3D';
import { VillageSim } from '../sim/VillageSim';
import { Timeline } from '../sim/timeline';
import { catchUp, type AwayCard } from '../sim/away';
import { createBrain } from '../sim/brain';
import type { BrainStatus } from '../sim/brain/Brain';
import type { ChronicleEntry, SnapshotMeta, VillagerState } from '../sim/types';
import { Rpg } from '../rpg/Rpg';
import { SaveManager, type MainSave } from '../save/SaveManager';
import { loadSettings, saveSettings, type Settings } from '../save/settings';
import { TwitchChat } from '../live/TwitchChat';
import { LiveVote, liveAnnouncement } from '../live/LiveVote';
import { Audio } from '../audio/Sfx';
import { mountUi, type Ui } from '../ui';
import { VillagerViews } from './villagerViews';
import { Ambient } from './ambient';
import { createHost } from './host';
import { DialogueController } from './dialogue';
import { TimeMachine } from './timeMachine';
import { cloneJson, type GameState } from './state';
import { GAME_MINUTES_PER_REAL_SECOND, dayOf, dayPhase, formatDayClock, minuteOfDay } from '../core/time';
import { PLACES } from '../data/layout';
import { VILLAGERS, type VillagerId } from '../data/villagers';
import { heightAt } from '../world/height';
import type { IconKey } from '../data/icons';
import type { EquipSlot } from '../ui/InventoryView';
import { wireUi } from './uiWire';
import { buildSpotTable } from './spots';
import { setSpotTable } from '../sim/schedules';

export type Modal = null | 'dialogue' | 'inventory' | 'map' | 'chronicle' | 'time' | 'settings' | 'away' | 'dead' | 'watch';

export class Game {
  engine!: Engine;
  world!: World3D;
  sim!: VillageSim;
  timeline!: Timeline;
  rpg!: Rpg;
  ui!: Ui;
  save!: SaveManager;
  settings!: Settings;
  brainKit!: ReturnType<typeof createBrain>;
  audio!: Audio;
  villagers!: VillagerViews;
  ambient!: Ambient;
  dialogue!: DialogueController;
  timeMachine!: TimeMachine;
  twitch: TwitchChat | null = null;
  vote!: LiveVote;
  liveOn = false;

  mode: 'menu' | 'play' = 'menu';
  modal: Modal = null;
  aiStatus: BrainStatus = { connected: false, model: '', label: 'ИИ: няма връзка — жителите говорят по сценарий', busy: false, queue: 0 };
  private hudAcc = 0;
  private saveAcc = 0;
  private audioAcc = 0;
  private menuT = 0;
  private expectUnlock = false;
  private suppressKeysUntil = 0;
  private frameNo = 0;
  private closedFrame = -10;
  private snapshotSeq = 0;
  private flagsSeen = { river: false, festival: false, weather: '' };
  private unsubSim: (() => void)[] = [];
  private lastPhase = '';
  private tmpV = new THREE.Vector3();
  private projV = new THREE.Vector3();
  private shot: string | null = null;

  static async create(canvas: HTMLCanvasElement, uiRoot: HTMLElement, progress: (p: number, text?: string) => void): Promise<Game> {
    const g = new Game();
    await g.init(canvas, uiRoot, progress);
    return g;
  }

  private async init(canvas: HTMLCanvasElement, uiRoot: HTMLElement, progress: (p: number, text?: string) => void): Promise<void> {
    const tick = () => new Promise<void>((r) => setTimeout(r, 0));
    this.shot = new URLSearchParams(location.search).get('shot');
    this.settings = loadSettings();
    progress(0.05, 'Пали се огнището…');
    this.engine = new Engine(canvas);
    this.engine.setPixelRatioCap(this.settings.graphics.pixelRatioCap);
    this.engine.input.sensitivity = this.settings.controls.sensitivity;
    await tick();
    progress(0.15, 'Расте гората…');
    await tick();
    this.world = new World3D(this.engine, { quality: this.settings.graphics.quality });
    progress(0.55, 'Жителите се събуждат…');
    await tick();
    this.ui = mountUi(uiRoot);
    this.save = await SaveManager.open();
    this.audio = new Audio();
    this.audio.setVolumes(this.settings.audio);
    this.brainKit = createBrain(this.settings.ai);
    this.brainKit.onStatus((s: BrainStatus) => this.onAiStatus(s));
    this.villagers = new VillagerViews(this.engine.scene);
    this.ambient = new Ambient(this.engine.scene);
    this.dialogue = new DialogueController(this);
    this.timeMachine = new TimeMachine(this);
    this.vote = new LiveVote({ voteSeconds: this.settings.live.voteSeconds, onResult: (type, by) => this.onLiveResult(type, by) });
    progress(0.8, 'Летописецът точи перото…');
    await tick();
    // жителите стоят пред истинските сгради (светът ги мести встрани от пътищата)
    setSpotTable(buildSpotTable(this.world.plan));
    // меню: селото живее зад заглавието
    this.sim = new VillageSim({ seed: 7 });
    this.timeline = Timeline.create();
    this.rpg = this.makeRpg();
    this.rpg.setControlsEnabled(false);
    this.ambient.followPetko(() => this.sim.villager('petko').pos);
    this.wireUi();
    this.wirePointerLock();
    this.engine.onUpdate((dt) => this.update(dt));
    this.engine.onLateUpdate((dt) => this.lateUpdate(dt));
    this.brainKit.connect().catch(() => {});
    progress(1, 'Готово');
    this.engine.start();
    const canContinue = await this.save.hasSave();
    this.showMenu(canContinue);
    if (this.shot) void import('./shots').then((m) => m.runShot(this, this.shot!));
    window.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play') void this.saveMain(); });
    window.addEventListener('beforeunload', () => { if (this.mode === 'play') void this.saveMain(); });
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });
  }

  // ───────────────────────── меню / старт ─────────────────────────

  showMenu(canContinue: boolean): void {
    this.mode = 'menu';
    this.modal = null;
    this.rpg.setControlsEnabled(false);
    this.ui.hud.hide();
    this.ui.start.show({ hasSave: canContinue, ai: { connected: this.aiStatus.connected, label: this.aiStatus.label } });
    this.audio.setMusic('village');
  }

  private attachSim(sim: VillageSim): void {
    for (const u of this.unsubSim) u();
    this.unsubSim = [];
    this.sim = sim;
    sim.setBrain(this.brainKit.brain);
    this.unsubSim.push(sim.bus.on('chronicle', (e) => this.onChronicle(e)));
    this.unsubSim.push(sim.bus.on('election', (e) => {
      const name = VILLAGERS[e.mayor].name;
      this.ui.banner.show(`Избори в Самодивско`, `Новият кмет е ${name}.`);
      this.sfx('vote');
    }));
    this.unsubSim.push(sim.bus.on('day', (e) => this.toast(`Ден ${e.day} в Самодивско`, 'info')));
    this.unsubSim.push(sim.bus.on('say', (e) => {
      if (this.mode !== 'play') return;
      const p = sim.villager(e.id).pos;
      if (Math.hypot(p.x - this.rpg.heroPos.x, p.z - this.rpg.heroPos.z) < 18) this.sfx('bubble');
    }));
    this.flagsSeen = { river: !!sim.state.flags['river_flowing'], festival: false, weather: '' };
    this.world.setRiverFlowing(!!sim.state.flags['river_flowing'], false);
    this.ambient.followPetko(() => this.sim.villager('petko').pos);
  }

  async newGame(live = false): Promise<void> {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const sim = new VillageSim({ seed });
    this.timeline = Timeline.create();
    this.attachSim(sim);
    this.rpg.dispose();
    this.rpg = this.makeRpg();
    const st = PLACES.start;
    this.rpg.teleport(st.pos.x, st.pos.z, st.facing ?? Math.PI);
    await this.save.wipe();
    this.startPlaying();
    this.ui.banner.show('Балкански легенди', 'Ламята пресуши Бистрица. Селото Самодивско чака странник.');
    void this.makeSnapshot('day');
    void this.saveMain();
    if (live) this.startLive();
  }

  async continueGame(live = false): Promise<void> {
    const main = await this.save.loadMain();
    if (!main) return this.newGame(live);
    const g = main.game as GameState;
    this.timeline = new Timeline(main.timeline as ConstructorParameters<typeof Timeline>[0]);
    const sim = new VillageSim({ state: g.sim });
    this.attachSim(sim);
    this.rpg.dispose();
    this.rpg = this.makeRpg(g.player as Parameters<Rpg['load']>[0]);
    this.startPlaying();
    // „Докато те нямаше…“
    const away = Date.now() - main.savedAt;
    const cards: AwayCard[] = catchUp(this.sim, away);
    this.villagers.update(0.016, this.sim.state, true);
    if (cards.length) this.openAway(cards);
    if (live) this.startLive();
  }

  private startPlaying(): void {
    this.mode = 'play';
    this.modal = null;
    this.ui.start.hide();
    this.ui.hud.show();
    this.ui.hud.setMinimap(this.world.mapCanvas());
    this.rpg.setControlsEnabled(true);
    this.villagers.update(0.016, this.sim.state, true);
    this.hudAcc = 1;
    this.audio.setMusic('village');
    this.lockPointer();
  }

  private makeRpg(save?: Parameters<Rpg['load']>[0]): Rpg {
    const rpg = new Rpg(this.engine, this.world, createHost(this), save);
    rpg.bus.on('notify', (e) => this.toast(e.text, e.kind));
    rpg.bus.on('sfx', (e) => this.sfx(e.name));
    rpg.bus.on('damage', (e) => { if (e.target === 'hero' && !e.blocked) this.ui.hud.flashDamage(); });
    rpg.bus.on('levelup', (e) => { this.ui.banner.show(`Ниво ${e.level}`, e.title); this.sfx('levelup'); });
    rpg.bus.on('questDone', (e) => { this.ui.banner.show('Задачата е изпълнена', e.title); this.sfx('quest'); });
    rpg.bus.on('lamiaDefeated', () => { this.ui.banner.show('Ламята е победена!', 'Бистрица тече отново. Тази вечер селото вдига сбор.'); this.sfx('victory'); });
    rpg.bus.on('died', () => { this.sfx('death'); this.ui.death.show(); });
    rpg.bus.on('respawn', () => { this.ui.death.hide(); });
    rpg.bus.on('pickup', () => this.refreshInventory());
    return rpg;
  }

  /** Превърта времето до даден час (напр. „Изчакай нощта“ при кокошарника). */
  skipTo(minute: number): void {
    const now = minuteOfDay(this.sim.state.time);
    let delta = minute - now; if (delta <= 0) delta += 1440;
    let left = delta;
    while (left > 0) {
      const s = Math.min(15, left);
      const prev = this.sim.state.time;
      this.sim.advance(s);
      for (const kind of this.timeline.snapshotDue(prev, this.sim.state.time)) void this.makeSnapshot(kind);
      left -= s;
    }
    this.villagers.update(0.016, this.sim.state, true);
    this.toast(`Времето минава… ${formatDayClock(this.sim.state.time)}`, 'info');
  }

  // ───────────────────────── цикъл ─────────────────────────

  private update(dt: number): void {
    const input = this.engine.input;
    this.frameNo++;
    this.handleKeys();
    if (this.mode === 'menu') {
      this.sim.advance(dt * GAME_MINUTES_PER_REAL_SECOND * 4);
      this.menuCamera(dt);
      this.world.update(dt, this.sim.state.time, this.tmpV.set(0, 2, 40));
      this.villagers.update(dt, this.sim.state);
      this.ambient.update(dt, this.sim.state);
      return;
    }
    if (this.modal === 'watch') {
      this.timeMachine.update(dt);
      return;
    }
    const living = this.modal === null || this.modal === 'dialogue';
    if (living) {
      const prev = this.sim.state.time;
      this.sim.setPlayer({ x: this.rpg.heroPos.x, z: this.rpg.heroPos.z });
      this.sim.advance(dt * GAME_MINUTES_PER_REAL_SECOND);
      const due = this.timeline.snapshotDue(prev, this.sim.state.time);
      for (const kind of due) void this.makeSnapshot(kind);
      this.rpg.update(dt, this.sim.state.time);
    }
    this.world.update(dt, this.sim.state.time, this.rpg.heroPos);
    this.villagers.update(dt, this.sim.state, false, this.rpg.heroPos);
    this.ambient.update(dt, this.sim.state);
    this.syncWorldFlags();
    this.saveAcc += dt;
    if (this.saveAcc > 30) { this.saveAcc = 0; void this.saveMain(); }
    if (this.liveOn) this.vote.tick();
    this.audioAcc += dt;
    if (this.audioAcc > 1) { this.audioAcc = 0; this.updateAudio(); }
    void input;
  }

  private lateUpdate(dt: number): void {
    // имената над главите — само в света (не върху летописа, картата, раницата…)
    if (this.mode !== 'play' || (this.modal !== null && this.modal !== 'dialogue' && this.modal !== 'watch')) { this.ui.tags.update([]); return; }
    const state = this.modal === 'watch' ? this.timeMachine.viewState() : this.sim.state;
    // камерата за разговора — преди етикетите, за да са над главите в същия кадър
    if (this.modal === 'dialogue' && this.dialogue.active) this.dialogueCamera(dt, this.dialogue.active);
    this.updateTags(state.villagers, state.time);
    if (this.modal === 'watch') return;
    this.ui.hud.minimap(this.rpg.heroPos.x, this.rpg.heroPos.z, this.rpg.heroYaw, this.mapMarkers(), this.villagerDots());
    this.hudAcc += dt;
    if (this.hudAcc > 0.1) { this.hudAcc = 0; this.updateHud(); }
  }

  private dlgCam = new THREE.Vector3();
  private dlgLook = new THREE.Vector3();
  resetDialogueCamera(): void { this.dlgCam.copy(this.engine.camera.position); this.dlgLook.set(0, 0, 0); }
  private dialogueCamera(dt: number, id: VillagerId): void {
    const hero = this.rpg.heroPos;
    const vp = this.villagers.position(id);
    const dx = vp.x - hero.x, dz = vp.z - hero.z, d = Math.max(0.5, Math.hypot(dx, dz));
    const nx = dx / d, nz = dz / d;
    // през рамото на героя, към лицето на жителя
    const cx = hero.x - nx * 2.2 + nz * 1.55, cz = hero.z - nz * 2.2 - nx * 1.55;
    const target = this.tmpV.set(cx, Math.max(heightAt(cx, cz), hero.y) + 1.9, cz);
    const k = 1 - Math.exp(-dt * 4);
    if (this.dlgCam.lengthSq() === 0) this.dlgCam.copy(this.engine.camera.position);
    this.dlgCam.lerp(target, k);
    // гледа малко под лицето: лицето остава в горната половина, над прозореца на разговора
    this.dlgLook.lerp(new THREE.Vector3(vp.x, vp.y + 0.55, vp.z), this.dlgLook.lengthSq() === 0 ? 1 : k);
    this.engine.camera.position.copy(this.dlgCam);
    this.engine.camera.lookAt(this.dlgLook);
  }

  private menuCamera(dt: number): void {
    this.menuT += dt * 0.03;
    const r = 70, cx = 0, cz = 42;
    const x = cx + Math.sin(this.menuT) * r, z = cz + Math.cos(this.menuT) * r;
    const cam = this.engine.camera;
    cam.position.set(x, Math.max(heightAt(x, z) + 22, 24), z);
    cam.lookAt(cx, 4, cz);
  }

  private syncWorldFlags(): void {
    const f = this.sim.state.flags;
    const river = !!f['river_flowing'];
    if (river !== this.flagsSeen.river) { this.flagsSeen.river = river; this.world.setRiverFlowing(river, true); }
    const fest = typeof f['sabor'] === 'number' && dayOf(this.sim.state.time) - (f['sabor'] as number) <= 1 && minuteOfDay(this.sim.state.time) > 17 * 60;
    if (fest !== this.flagsSeen.festival) { this.flagsSeen.festival = fest; this.world.setFestival(fest); }
    const w = this.sim.state.weather;
    if (w !== this.flagsSeen.weather) { this.flagsSeen.weather = w; this.world.setWeather(w); }
  }

  private updateAudio(): void {
    const t = this.sim.state.time;
    const ph = dayPhase(t);
    const p = this.rpg.heroPos;
    const inForest = Math.hypot(p.x + 150, p.z + 60) < 100;
    const w = this.sim.state.weather;
    this.audio.ambient('day', ph === 'day' || ph === 'dawn');
    this.audio.ambient('night', ph === 'night' || ph === 'dusk');
    this.audio.ambient('forest', inForest);
    this.audio.ambient('rain', w === 'rain');
    this.audio.ambient('storm', w === 'storm');
    this.audio.ambient('river', !!this.sim.state.flags['river_flowing'] && Math.abs(p.x - 90) < 40);
    const boss = this.rpg.hud().boss;
    const music = boss ? 'battle' : this.flagsSeen.festival ? 'festival' : ph === 'night' ? 'night' : 'village';
    this.audio.setMusic(music);
    if (ph !== this.lastPhase) {
      if (this.lastPhase && ph === 'dusk') this.toast('Здрачава се. В Тъмната гора излизат таласъми.', 'warn');
      this.lastPhase = ph;
    }
  }

  // ───────────────────────── етикети, HUD ─────────────────────────

  private updateTags(villagers: VillagerState[], time: number): void {
    const cam = this.engine.camera;
    cam.updateMatrixWorld(); // камерата е местена в този кадър — иначе етикетите изостават с кадър
    const w = window.innerWidth, h = window.innerHeight;
    const tags = [];
    for (const v of villagers) {
      const prof = VILLAGERS[v.id];
      const visible3d = this.villagers.isVisible(v.id);
      const head = this.villagers.head(v.id, this.projV);
      const dist = head.distanceTo(cam.position);
      head.project(cam);
      // събеседникът в разговора: името и думите му са в прозореца долу
      const talking = this.modal === 'dialogue' && this.dialogue.active === v.id;
      const onScreen = !talking && visible3d && head.z < 1 && head.z > -1 && Math.abs(head.x) < 1.1 && Math.abs(head.y) < 1.1 && dist < 45;
      const bubble = v.speech && v.speech.until > time ? { text: v.speech.text, ai: v.speech.ai } : null;
      tags.push({
        id: v.id, name: prof.name, job: v.id === this.sim.state.mayor && v.id !== 'peyu' ? `${prof.job} · кмет` : prof.job,
        x: (head.x * 0.5 + 0.5) * w, y: (-head.y * 0.5 + 0.5) * h, dist, visible: onScreen, bubble,
      });
    }
    this.ui.tags.update(tags);
  }

  private villagerDots(): { x: number; z: number }[] {
    return this.sim.state.villagers.filter((v) => this.villagers.isVisible(v.id)).map((v) => ({ x: v.pos.x, z: v.pos.z }));
  }

  private updateHud(): void {
    const h = this.rpg.hud();
    const t = this.sim.state.time;
    this.ui.hud.update({
      name: 'Стоян', level: h.level, title: h.title,
      hp: h.hp, hpMax: h.maxHp, stamina: h.stamina, staminaMax: h.maxStamina, xp: h.xp, xpMax: h.xpNext,
      time: t, phase: dayPhase(t),
      ai: { connected: this.aiStatus.connected, label: this.aiStatus.label, busy: this.aiStatus.busy },
      quests: this.rpg.questLog(),
      hotbar: h.hotbar.map((c) => (c ? { icon: c.icon, count: c.count, name: c.name } : null)),
      selected: -1,
    });
    this.ui.hud.boss(h.boss ? { name: h.boss.name, heads: h.boss.heads, phase: ['', 'Фаза 1 — Трите глави', 'Фаза 2 — Огнен дъх', 'Фаза 3 — Яростта'][h.boss.phase] ?? `Фаза ${h.boss.phase}` } : null);
    // подсказка за [E]
    let prompt: string | null = null;
    if (this.modal === null && !this.rpg.dead) {
      const nv = this.nearVillager();
      if (nv) prompt = `Говори с ${VILLAGERS[nv].name}`;
      else { const hint = this.rpg.interactHint(); if (hint) prompt = hint.label; }
    }
    this.ui.hud.prompt(prompt);
    if (this.liveOn) this.updateLive();
  }

  mapMarkers(): { x: number; z: number; kind: 'quest' | 'boss' | 'place' }[] {
    return this.rpg.markers().map((m) => ({ x: m.x, z: m.z, kind: m.kind === 'boss' ? 'boss' : 'quest' }));
  }

  nearVillager(): VillagerId | null {
    const n = this.villagers.nearest(this.rpg.heroPos, 3.2);
    if (!n) return null;
    const v = this.sim.villager(n.id);
    if (v.activity === 'sleep') return null;
    return n.id;
  }

  // ───────────────────────── клавиши, мишка ─────────────────────────

  private handleKeys(): void {
    const inp = this.engine.input;
    if (this.mode !== 'play') return;
    if (this.modal === 'watch') {
      if (inp.pressedRaw('Escape') || inp.pressedRaw('KeyT')) this.timeMachine.stopWatching();
      return;
    }
    // прозорците сами се затварят със своя клавиш/Esc; тук само ги отваряме
    if (this.modal !== null || this.frameNo - this.closedFrame <= 1 || this.rpg.dead) return;
    if (inp.pressedRaw('Tab')) this.openInventory();
    else if (inp.pressedRaw('KeyM')) this.openMap();
    else if (inp.pressedRaw('KeyJ')) this.openChronicle();
    else if (inp.pressedRaw('KeyT')) this.timeMachine.open();
    else if (inp.pressedRaw('Escape')) this.openSettings();
    else if (inp.pressed('KeyE')) {
      const nv = this.nearVillager();
      if (nv) this.dialogue.open(nv);
      else this.rpg.interact();
    }
  }

  private wirePointerLock(): void {
    const canvas = this.engine.canvas;
    canvas.addEventListener('click', () => { if (this.mode === 'play' && this.modal === null) this.lockPointer(); });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      this.ui.hud.setPaused(!locked && this.mode === 'play' && this.modal === null);
      if (!locked && !this.expectUnlock && this.mode === 'play' && this.modal === null && performance.now() >= this.suppressKeysUntil) {
        // Esc освободи мишката → менюто
        this.openSettings();
      }
      this.expectUnlock = false;
    });
  }

  lockPointer(): void { this.engine.input.lock(); }
  private unlockPointer(): void {
    if (document.pointerLockElement) { this.expectUnlock = true; this.engine.input.unlock(); }
  }

  openModal(m: Exclude<Modal, null>): void {
    this.modal = m;
    this.unlockPointer();
    this.rpg.setControlsEnabled(false);
    this.engine.input.enabled = false;
    this.ui.hud.prompt(null);
  }

  /** Прозорецът е затворен (от играча чрез самия прозорец или от играта). */
  onModalClosed(m: Exclude<Modal, null>): void {
    if (this.modal !== m) return;
    this.modal = null;
    if (m === 'dialogue') this.dialogue.close();
    this.suppressKeysUntil = performance.now() + 150;
    this.closedFrame = this.frameNo;
    this.rpg.setControlsEnabled(true);
    this.engine.input.enabled = true;
    if (this.mode === 'play') {
      this.lockPointer(); // с Tab/M/J/T успява веднага; след Esc — „Кликни, за да играеш“
      setTimeout(() => this.ui.hud.setPaused(this.mode === 'play' && this.modal === null && document.pointerLockElement !== this.engine.canvas), 120);
    }
  }

  /** Играта затваря текущия прозорец (без onClose на изгледа). */
  closeModal(relock = true): void {
    const m = this.modal;
    if (!m) return;
    switch (m) {
      case 'dialogue': this.ui.dialogue.close(); break;
      case 'inventory': this.ui.inventory.hide(); break;
      case 'map': this.ui.map.hide(); break;
      case 'chronicle': this.ui.chronicle.hide(); break;
      case 'time': this.ui.time.hide(); break;
      case 'settings': this.ui.settings.hide(); break;
      case 'away': this.ui.away.hide(); break;
      default: break;
    }
    this.onModalClosed(m);
    void relock;
  }

  // ───────────────────────── прозорци ─────────────────────────

  openInventory(): void {
    this.openModal('inventory');
    this.ui.inventory.open(this.inventoryData());
    this.sfx('page');
  }
  inventoryData() {
    const inv = this.rpg.inventory();
    const h = this.rpg.hud();
    const view = (it: { id: string; name: string; icon: IconKey; count: number; desc: string; kind: string; slot?: string; stats?: string } | null) =>
      it ? { id: it.id, name: it.name, icon: it.icon, count: it.count, desc: it.desc, kind: it.kind, equip: it.slot as EquipSlot | undefined, stats: it.stats ? [{ label: it.stats, value: '' }] : undefined } : null;
    const equipment = {} as Record<EquipSlot, ReturnType<typeof view>>;
    for (const k of Object.keys(inv.equipment) as EquipSlot[]) equipment[k] = view(inv.equipment[k]);
    return {
      slots: inv.slots.map(view), equipment,
      hotbar: h.hotbar.map((c) => (c ? { id: c.id, name: c.name, icon: c.icon, count: c.count, desc: '', kind: 'misc' } : null)),
      stats: { level: inv.stats.level, title: inv.stats.title, xp: inv.stats.xp, xpMax: inv.stats.xpNext, hp: h.hp, hpMax: h.maxHp, stamina: h.stamina, staminaMax: h.maxStamina, damage: inv.stats.damage, armor: inv.stats.armor, gold: inv.stats.gold },
    };
  }
  refreshInventory(): void { if (this.modal === 'inventory') this.ui.inventory.update(this.inventoryData()); }

  openMap(): void {
    this.openModal('map');
    this.ui.map.open({
      base: this.world.mapCanvas(), explored: this.rpg.explored(),
      player: { x: this.rpg.heroPos.x, z: this.rpg.heroPos.z, yaw: this.rpg.heroYaw }, markers: this.mapMarkers(), dots: this.villagerDots(),
    });
    this.sfx('page');
  }

  openChronicle(): void {
    this.openModal('chronicle');
    this.ui.chronicle.open({ entries: this.timeline.entriesFor(this.timeline.currentBranch) });
    this.sfx('page');
  }

  settingsStatus() {
    return {
      ai: { connected: this.aiStatus.connected, label: this.aiStatus.label, reason: this.aiStatus.reason },
      browser: location.protocol === 'https:',
      inGame: this.mode === 'play',
      live: { running: this.liveOn, label: this.liveOn ? (this.twitch ? `Канал: ${this.settings.live.channel}` : 'Пробен чат') : undefined },
    };
  }

  openSettings(): void {
    if (this.modal) this.closeModal(false);
    this.openModal('settings');
    this.ui.settings.open(this.settings, this.settingsStatus());
  }

  openAway(cards: AwayCard[]): void {
    this.openModal('away');
    this.ui.away.show(cards, () => this.onModalClosed('away'));
  }

  // ───────────────────────── летопис, записи ─────────────────────────

  private onChronicle(e: ChronicleEntry): void {
    this.timeline.add(e);
    if (this.mode !== 'play') return;
    if (e.importance >= 7 && e.type !== 'player' && e.type !== 'quest') this.toast(e.text, 'info');
    if (this.modal === 'chronicle') this.ui.chronicle.update({ entries: this.timeline.entriesFor(this.timeline.currentBranch) });
    this.timeMachine.refresh();
  }

  gameState(): GameState {
    return { v: 1, sim: this.sim.snapshot(), player: cloneJson(this.rpg.serialize()), realTime: Date.now() };
  }

  async makeSnapshot(kind: SnapshotMeta['kind']): Promise<SnapshotMeta> {
    const time = this.sim.state.time;
    const meta: SnapshotMeta = {
      id: `${this.timeline.currentBranch}:${kind}:${Math.floor(time)}:${Date.now().toString(36)}${(this.snapshotSeq++).toString(36)}`,
      branchId: this.timeline.currentBranch, time, kind, label: formatDayClock(time), realTime: Date.now(),
    };
    await this.save.put(meta, this.gameState());
    const del = this.timeline.registerSnapshot(meta);
    for (const id of del) await this.save.delete(id);
    return meta;
  }

  async saveMain(): Promise<void> {
    if (this.mode !== 'play') return;
    const data: MainSave = { version: 1, savedAt: Date.now(), game: this.gameState(), timeline: this.timeline.data() };
    try { await this.save.saveMain(data); } catch (e) { console.warn('save failed', e); }
  }

  /** Зарежда GameState (от машината на времето). */
  loadGameState(g: GameState): void {
    this.sim.load(cloneJson(g.sim));
    this.sim.state.branchId = this.timeline.currentBranch;
    this.rpg.load(cloneJson(g.player) as Parameters<Rpg['load']>[0]);
    this.flagsSeen.river = !this.sim.state.flags['river_flowing'];
    this.villagers.update(0.016, this.sim.state, true);
  }

  // ───────────────────────── ИИ, лайв, звук, известия ─────────────────────────

  private onAiStatus(s: BrainStatus): void {
    this.aiStatus = s;
    if (this.mode === 'menu') this.ui.start.update({ ai: { connected: s.connected, label: s.label } });
    if (this.modal === 'settings') this.ui.settings.setStatus(this.settingsStatus());
  }

  applySettings(s: Settings): void {
    const prev = this.settings;
    this.settings = s;
    saveSettings(s);
    this.engine.input.sensitivity = s.controls.sensitivity;
    if (s.graphics.quality !== prev.graphics.quality) this.world.setQuality(s.graphics.quality);
    if (s.graphics.pixelRatioCap !== prev.graphics.pixelRatioCap) this.engine.setPixelRatioCap(s.graphics.pixelRatioCap);
    this.engine.renderer.shadowMap.enabled = s.graphics.shadows;
    this.audio.setVolumes(s.audio);
    if (JSON.stringify(s.ai) !== JSON.stringify(prev.ai)) { this.brainKit.setSettings(s.ai); void this.brainKit.connect(); }
    (this.vote as unknown as { voteSeconds: number }).voteSeconds = s.live.voteSeconds;
  }

  startLive(): void {
    this.liveOn = true;
    const ch = this.settings.live.channel.trim();
    this.ui.live.setLive(true, ch);
    this.twitch?.disconnect(); this.twitch = null;
    this.vote.stopDemo();
    if (ch) {
      this.twitch = new TwitchChat(ch);
      this.twitch.on('message', (m) => { this.vote.feed(m.user, m.text); this.ui.live.chat(m.user, m.text, m.color); });
      this.twitch.on('status', (st) => { if (st === 'connected') this.toast(`Лайв: свързан с канала ${ch}`, 'info'); if (st === 'error') this.toast('Лайв: няма връзка с чата.', 'warn'); });
      this.twitch.connect();
    } else {
      this.toast('Лайв режим: няма канал в настройките — пускам пробен чат.', 'warn');
      this.vote.startDemo((m) => this.ui.live.chat(m.user, m.text));
    }
  }
  stopLive(): void {
    this.liveOn = false;
    this.twitch?.disconnect(); this.twitch = null;
    this.vote.stopDemo();
    this.ui.live.setLive(false);
    this.ui.live.setVote(null);
  }
  private liveSig = '';
  private updateLive(): void {
    const st = this.vote.state();
    if (!st.active) { if (this.liveSig !== '') { this.liveSig = ''; this.ui.live.setVote(null); } return; }
    const sig = st.endsAt + ':' + st.options.map((o) => o.votes).join(',');
    if (sig === this.liveSig) return;
    this.liveSig = sig;
    this.ui.live.setVote({ options: st.options.map((o) => ({ cmd: o.cmd, label: o.label, count: o.votes })), endsAt: st.endsAt, duration: this.settings.live.voteSeconds * 1000 });
  }
  private onLiveResult(type: 'karakondzhul' | 'samodivi' | 'storm' | 'sabor' | 'theft', by: string): void {
    this.sim.inject({ type, by } as Parameters<VillageSim['inject']>[0]);
    this.ui.live.result(liveAnnouncement(type, by));
    this.sfx(type === 'storm' ? 'thunder' : 'vote');
  }

  toast(text: string, kind: string = 'info'): void { this.ui.hud.toast(text, kind as never); }
  sfx(name: string): void { try { this.audio.play(name as never); } catch { /* без звук */ } }

  private wireUi(): void { wireUi(this); }
}
