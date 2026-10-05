// Машината на времето: гледане назад (селото се преиграва от запис) и „Зареди оттук“ (нов клон на историята).
import type { Game } from './Game';
import { VillageSim } from '../sim/VillageSim';
import type { ChronicleEntry, WorldState } from '../sim/types';
import type { GameState } from './state';
import { GAME_MINUTES_PER_REAL_SECOND, formatDayClock } from '../core/time';
import { heightAt } from '../world/height';

export class TimeMachine {
  private viewer: VillageSim | null = null;
  private speed = 1;
  private endTime = 0;
  private entries: ChronicleEntry[] = [];
  private nextEntry = 0;
  private camT = 0;
  private weather = '';

  constructor(private g: Game) {}

  data() {
    const g = this.g;
    const d = g.timeline.data();
    return { entries: d.entries, branches: g.timeline.branches(), snapshots: d.snapshots, currentBranch: g.timeline.currentBranch, now: g.sim.state.time };
  }

  open(): void {
    const g = this.g;
    g.openModal('time');
    g.ui.time.show(this.data());
    g.sfx('page');
  }

  refresh(): void { if (this.g.modal === 'time') this.g.ui.time.update(this.data()); }

  viewState(): WorldState { return this.viewer ? this.viewer.state : this.g.sim.state; }

  /** Гледай от даден момент със скорост ×1/×10/×100. */
  async watch(time: number, speed: number): Promise<void> {
    const g = this.g;
    const meta = g.timeline.nearestSnapshot(g.timeline.currentBranch, time);
    if (!meta) { g.toast('Няма запис на света преди този момент.', 'warn'); return; }
    const snap = await g.save.get(meta.id);
    if (!snap) { g.toast('Записът липсва.', 'warn'); return; }
    const st = (snap.state as GameState).sim;
    this.viewer = new VillageSim({ state: JSON.parse(JSON.stringify(st)) });
    this.viewer.setBrain(null);
    // превърти до избрания момент
    let left = Math.max(0, time - this.viewer.state.time);
    while (left > 0) { const s = Math.min(30, left); this.viewer.advance(s); left -= s; }
    this.speed = speed;
    this.endTime = g.sim.state.time;
    this.entries = g.timeline.entriesFor(g.timeline.currentBranch).filter((e) => e.time >= time);
    this.nextEntry = 0;
    g.modal = 'watch';
    // прозорецът остава като тънка лента долу (линията + сегашната случка)
    if (!g.ui.time.isOpen) g.ui.time.show(this.data());
    g.ui.time.setPlayhead(this.viewer.state.time);
    g.villagers.update(0.016, this.viewer.state, true);
    g.toast(`Гледаш историята от ${formatDayClock(time)} (×${speed}). Esc — назад в настоящето.`, 'info');
  }

  update(dt: number): void {
    const g = this.g;
    if (!this.viewer) { this.stopWatching(); return; }
    const v = this.viewer;
    const step = dt * GAME_MINUTES_PER_REAL_SECOND * this.speed;
    v.advance(step);
    const t = v.state.time;
    while (this.nextEntry < this.entries.length && this.entries[this.nextEntry].time <= t) {
      const e = this.entries[this.nextEntry++];
      if (e.importance >= 4 || e.ai) g.toast(`${formatDayClock(e.time)} — ${e.text}`, 'info');
    }
    g.ui.time.setPlayhead(t);
    // камерата бавно обикаля селото
    this.camT += dt * 0.04;
    const cam = g.engine.camera;
    const x = Math.sin(this.camT) * 60, z = 42 + Math.cos(this.camT) * 60;
    cam.position.set(x, heightAt(x, z) + 26, z);
    cam.lookAt(0, 3, 42);
    // времето (дъжд, буря…) — както е било тогава
    if (v.state.weather !== this.weather) { this.weather = v.state.weather; g.world.setWeather(v.state.weather); }
    g.world.update(dt, t, cam.position);
    g.villagers.update(dt, v.state);
    if (t >= this.endTime) { g.toast('Стигна настоящето.', 'info'); this.stopWatching(); }
  }

  stopWatching(): void {
    const g = this.g;
    if (this.viewer && this.weather !== g.sim.state.weather) g.world.setWeather(g.sim.state.weather);
    this.weather = '';
    this.viewer = null;
    g.ui.time.setPlayhead(null);
    g.villagers.update(0.016, g.sim.state, true);
    g.updateHud(); // часовникът долу пак показва настоящето
    g.modal = 'time';
    g.ui.time.show(this.data());
  }

  /** „Зареди оттук“ — нов клон на историята от най-близкия запис преди този момент. */
  async loadFrom(time: number): Promise<void> {
    const g = this.g;
    const meta = g.timeline.nearestSnapshot(g.timeline.currentBranch, time);
    if (!meta) { g.toast('Няма запис на света преди този момент.', 'warn'); return; }
    const snap = await g.save.get(meta.id);
    if (!snap) { g.toast('Записът липсва.', 'warn'); return; }
    // пази настоящето на стария клон
    await g.makeSnapshot('auto');
    const parent = g.timeline.currentBranch;
    const br = g.timeline.fork(meta.time);
    g.loadGameState(snap.state as GameState);
    g.sim.addChronicle('system', `Тук историята се разклони: „${br.label}“. (Ами ако…?)`, [], 6);
    await g.makeSnapshot('auto');
    void g.saveMain();
    g.toast(`Нов клон на историята от ${formatDayClock(meta.time)}. Старият е запазен.`, 'quest');
    void parent;
    g.closeModal(false);
  }

  async saveNow(): Promise<void> {
    const meta = await this.g.makeSnapshot('manual');
    this.g.toast(`Светът е записан (${meta.label}).`, 'info');
    this.refresh();
  }

  async switchBranch(id: string): Promise<void> {
    const g = this.g;
    if (id === g.timeline.currentBranch) return;
    const own = g.timeline.snapshotsFor(id).filter((s) => s.branchId === id).sort((a, b) => b.time - a.time)[0];
    if (!own) { g.toast('Този клон няма запис.', 'warn'); return; }
    const snap = await g.save.get(own.id);
    if (!snap) { g.toast('Записът липсва.', 'warn'); return; }
    await g.makeSnapshot('auto');
    g.timeline.switchTo(id);
    g.loadGameState(snap.state as GameState);
    void g.saveMain();
    g.toast(`Върна се в клон „${g.timeline.branches().find((b) => b.id === id)?.label ?? id}“.`, 'quest');
    g.closeModal(false);
  }
}
