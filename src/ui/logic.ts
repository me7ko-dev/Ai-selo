// Чиста логика на интерфейса (без DOM) — тества се в Node.
import type { Branch, ChronicleEntry } from '../sim/types';
import { dayOf, minuteOfDay, formatClock } from '../core/time';

export const WORLD_SIZE = 600;
export const WORLD_HALF_M = 300;

/** Свят (x, z) → пиксел в картата с размер size (север = -z = горе). */
export function worldToMap(x: number, z: number, size: number): { px: number; py: number } {
  return { px: ((x + WORLD_HALF_M) / WORLD_SIZE) * size, py: ((z + WORLD_HALF_M) / WORLD_SIZE) * size };
}

/** Ъгъл за завъртане на стрелка (рисувана сочеща нагоре) по yaw (rotation.y; 0 = гледа към +z/юг). */
export function yawToScreenAngle(yaw: number): number { return Math.PI - yaw; }

/** Групира записите по ден (подредени по време; newestFirst обръща и дните, и записите). */
export function groupByDay(entries: ChronicleEntry[], newestFirst = false): { day: number; entries: ChronicleEntry[] }[] {
  const sorted = [...entries].sort((a, b) => (a.time - b.time) || (a.id - b.id));
  if (newestFirst) sorted.reverse();
  const out: { day: number; entries: ChronicleEntry[] }[] = [];
  for (const e of sorted) {
    const d = dayOf(e.time);
    const last = out[out.length - 1];
    if (last && last.day === d) last.entries.push(e); else out.push({ day: d, entries: [e] });
  }
  return out;
}

/** „Ден 3 · 14:20“ */
export function dayTimeLabel(time: number): string { return `Ден ${dayOf(time)} · ${formatClock(time)}`; }

/** Записите, които важат за даден клон: собствените + на родителите до момента на разклоняване (forkEntryId). */
export function entriesForBranch(entries: ChronicleEntry[], branches: Branch[], branchId: string): ChronicleEntry[] {
  const byId = new Map(branches.map((b) => [b.id, b]));
  const out: ChronicleEntry[] = [];
  let cur = byId.get(branchId);
  let limit = Infinity;
  const seen = new Set<string>();
  let id: string | null = branchId;
  while (id && !seen.has(id)) {
    seen.add(id);
    for (const e of entries) if (e.branchId === id && e.id <= limit) out.push(e);
    cur = byId.get(id);
    if (!cur) break;
    limit = Math.min(limit, cur.forkEntryId);
    id = cur.parentId;
  }
  return out.sort((a, b) => (a.time - b.time) || (a.id - b.id));
}

/** Подрежда клоновете в ленти: основният (без родител) е лента 0, децата след родителя. */
export function branchLanes(branches: Branch[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const kids = new Map<string | null, Branch[]>();
  for (const b of branches) {
    const p = b.parentId && branches.some((x) => x.id === b.parentId) ? b.parentId : null;
    (kids.get(p) ?? kids.set(p, []).get(p)!).push(b);
  }
  for (const list of kids.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  let n = 0;
  const walk = (b: Branch) => { if (lanes.has(b.id)) return; lanes.set(b.id, n++); for (const k of kids.get(b.id) ?? []) walk(k); };
  for (const r of kids.get(null) ?? []) walk(r);
  for (const b of branches) if (!lanes.has(b.id)) lanes.set(b.id, n++);
  return lanes;
}

/** Записите около даден момент (± window минути), най-близките първи по време. */
export function entriesAround(entries: ChronicleEntry[], time: number, window = 180, max = 12): ChronicleEntry[] {
  return entries
    .filter((e) => Math.abs(e.time - time) <= window)
    .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))
    .slice(0, max)
    .sort((a, b) => a.time - b.time);
}

/** Последният запис до момента t (за „лентата“ при гледане). */
export function entryAt(entries: ChronicleEntry[], t: number): ChronicleEntry | null {
  let best: ChronicleEntry | null = null;
  for (const e of entries) if (e.time <= t && (!best || e.time >= best.time)) best = e;
  return best;
}

/** Разделя на страници по брой „редове“ (заглавие на ден = 1.4 реда, запис ≈ по дължината). */
export function paginate<T>(items: T[], weight: (x: T) => number, perPage: number): T[][] {
  const pages: T[][] = [];
  let cur: T[] = [], w = 0;
  for (const it of items) {
    const iw = weight(it);
    if (cur.length && w + iw > perPage) { pages.push(cur); cur = []; w = 0; }
    cur.push(it); w += iw;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/** Фаза за иконата: слънце денем, луна нощем. */
export function isSunUp(time: number): boolean { const h = minuteOfDay(time) / 60; return h >= 6 && h < 20; }
