// Летописът през всички клонове на историята + клоновете + правилата за записите на света.
// Чисто и сериализуемо (JSON) — самите записи (state) се пазят в SnapshotStore.
import { formatDayClock } from '../core/time';
import type { Branch, ChronicleEntry, SnapshotMeta, SnapshotStore } from './types';

export interface TimelineData {
  entries: ChronicleEntry[];
  branches: Branch[];
  snapshots: SnapshotMeta[];
  currentBranch: string;
}

/** Колко игрови минути се пазят часовите записи (последните 3 игрови дни). */
export const HOURLY_KEEP_MINUTES = 3 * 1440;

const byTime = (a: { time: number; id: number }, b: { time: number; id: number }) => a.time - b.time || a.id - b.id;

export class Timeline {
  private d: TimelineData;

  constructor(data?: TimelineData) {
    this.d = data ? JSON.parse(JSON.stringify(data)) : Timeline.emptyData();
    if (!this.d.branches.length) this.d.branches.push(mainBranch());
    if (!this.d.branches.some(b => b.id === this.d.currentBranch)) this.d.currentBranch = this.d.branches[0].id;
  }

  static create(): Timeline { return new Timeline(); }
  private static emptyData(): TimelineData { return { entries: [], branches: [mainBranch()], snapshots: [], currentBranch: 'main' }; }

  data(): TimelineData { return JSON.parse(JSON.stringify(this.d)); }
  get currentBranch(): string { return this.d.currentBranch; }

  add(e: ChronicleEntry): void {
    const entry = { ...e, participants: [...e.participants], branchId: e.branchId || this.d.currentBranch };
    // същият запис (клон + id) да не влиза два пъти
    if (this.d.entries.some(x => x.branchId === entry.branchId && x.id === entry.id && x.time === entry.time)) return;
    this.d.entries.push(entry);
  }

  private branch(id: string): Branch | undefined { return this.d.branches.find(b => b.id === id); }

  /** Веригата от клона до основния: [{ branch, until }] — until е докъде важат записите на този клон. */
  private lineage(branchId: string): { id: string; until: number; untilId: number }[] {
    const out: { id: string; until: number; untilId: number }[] = [];
    let b = this.branch(branchId);
    let until = Infinity, untilId = Infinity;
    const seen = new Set<string>();
    while (b && !seen.has(b.id)) {
      seen.add(b.id);
      out.push({ id: b.id, until, untilId });
      if (!b.parentId) break;
      // родителят важи до разклонението (и не по-късно от собственото ограничение)
      if (b.forkTime < until) { until = b.forkTime; untilId = b.forkEntryId; }
      else if (b.forkTime === until) untilId = Math.min(untilId, b.forkEntryId);
      b = this.branch(b.parentId);
    }
    return out;
  }

  entriesFor(branchId: string): ChronicleEntry[] {
    const lin = this.lineage(branchId);
    const res: ChronicleEntry[] = [];
    for (const l of lin) {
      for (const e of this.d.entries) {
        if (e.branchId !== l.id) continue;
        if (e.time < l.until || (e.time === l.until && e.id <= l.untilId)) res.push(e);
      }
    }
    return res.sort(byTime);
  }

  branches(): Branch[] { return this.d.branches.map(b => ({ ...b })); }

  /** Нов клон от текущата история в момента fromTime; става текущ. */
  fork(fromTime: number, label?: string, now: number = Date.now()): Branch {
    const parent = this.d.currentBranch;
    const prior = this.entriesFor(parent).filter(e => e.time <= fromTime);
    let forkEntryId = 0; for (const e of prior) if (e.id > forkEntryId) forkEntryId = e.id;
    let n = this.d.branches.length + 1, id = `b${n}`;
    while (this.branch(id)) id = `b${++n}`;
    const b: Branch = { id, parentId: parent, forkTime: fromTime, forkEntryId, createdAt: now, label: label ?? `Клон ${n} (от ${formatDayClock(fromTime)})` };
    this.d.branches.push(b);
    this.d.currentBranch = id;
    return { ...b };
  }

  switchTo(branchId: string): void {
    if (!this.branch(branchId)) throw new Error(`Няма такъв клон: ${branchId}`);
    this.d.currentBranch = branchId;
  }

  /** Кои записи се дължат при преминаване от prevTime до nowTime: 'day' при нов ден (той важи и за часов), иначе 'hour' при нов час. */
  snapshotDue(prevTime: number, nowTime: number): ('hour' | 'day')[] {
    if (!(nowTime > prevTime)) return [];
    if (Math.floor(nowTime / 1440) > Math.floor(prevTime / 1440)) return ['day'];
    if (Math.floor(nowTime / 60) > Math.floor(prevTime / 60)) return ['hour'];
    return [];
  }

  /** Записва метаданните; връща id на записите за ТРИЕНЕ (часовите по-стари от 3 игрови дни в същия клон). */
  registerSnapshot(meta: SnapshotMeta): string[] {
    this.d.snapshots = this.d.snapshots.filter(s => s.id !== meta.id);
    this.d.snapshots.push({ ...meta });
    const latest = Math.max(...this.d.snapshots.filter(s => s.branchId === meta.branchId).map(s => s.time));
    const drop = this.d.snapshots.filter(s => s.branchId === meta.branchId && s.kind === 'hour' && s.time < latest - HOURLY_KEEP_MINUTES).map(s => s.id);
    if (drop.length) { const set = new Set(drop); this.d.snapshots = this.d.snapshots.filter(s => !set.has(s.id)); }
    return drop;
  }

  /** Записите, валидни за клона (вкл. тези на предците отпреди разклонението), по време. */
  snapshotsFor(branchId: string): SnapshotMeta[] {
    const lin = this.lineage(branchId);
    const res: SnapshotMeta[] = [];
    for (const l of lin) for (const s of this.d.snapshots) if (s.branchId === l.id && s.time <= l.until) res.push({ ...s });
    return res.sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Последният запис ≤ time в историята на клона. */
  nearestSnapshot(branchId: string, time: number): SnapshotMeta | undefined {
    const list = this.snapshotsFor(branchId).filter(s => s.time <= time);
    return list[list.length - 1];
  }
}

function mainBranch(): Branch {
  return { id: 'main', parentId: null, forkTime: 0, forkEntryId: 0, createdAt: 0, label: 'Основна история' };
}

/** Записи в паметта (за проби). */
export class MemorySnapshotStore implements SnapshotStore {
  private m = new Map<string, { meta: SnapshotMeta; state: string }>();
  async put(meta: SnapshotMeta, state: unknown): Promise<void> { this.m.set(meta.id, { meta: { ...meta }, state: JSON.stringify(state) }); }
  async get(id: string): Promise<{ meta: SnapshotMeta; state: unknown } | undefined> {
    const x = this.m.get(id); return x ? { meta: { ...x.meta }, state: JSON.parse(x.state) } : undefined;
  }
  async delete(id: string): Promise<void> { this.m.delete(id); }
  async list(): Promise<SnapshotMeta[]> { return [...this.m.values()].map(x => ({ ...x.meta })).sort((a, b) => a.time - b.time); }
}
