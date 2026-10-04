// Поток от спомени: добавяне, подрязване (до ~60), извличане по скорошност + важност + ключови думи.
import type { Memory, VillagerState, WorldState } from './types';

export const MEMORY_CAP = 60;

export function addMemory(s: WorldState, v: VillagerState, text: string, importance: number, about: string[], kind: Memory['kind'] = 'event'): Memory {
  const m: Memory = { id: s.nextId++, time: Math.floor(s.time), text, importance: Math.max(1, Math.min(10, Math.round(importance))), about: [...new Set(about)], kind };
  // същият спомен в последния час → само вдигаме важността
  const last = v.memories[v.memories.length - 1];
  if (last && last.text === text && m.time - last.time < 60) { last.importance = Math.max(last.importance, m.importance); last.time = m.time; s.nextId--; return last; }
  v.memories.push(m);
  if (v.memories.length > MEMORY_CAP + 10) pruneMemories(v, s.time);
  return m;
}

function keepScore(m: Memory, now: number): number {
  const ageDays = (now - m.time) / 1440;
  return m.importance * 1.0 - ageDays * 1.2 + (m.kind === 'player' ? 2 : 0);
}

/** Трие старите маловажни спомени, докато останат ≤ MEMORY_CAP (важните ≥ 8 се пазят най-дълго). */
export function pruneMemories(v: VillagerState, now: number): void {
  // маловажните разговори изветряват след ден и половина
  v.memories = v.memories.filter(m => !(m.importance <= 2 && now - m.time > 2160));
  if (v.memories.length <= MEMORY_CAP) return;
  const ranked = v.memories.map((m, i) => ({ m, i, k: keepScore(m, now) })).sort((a, b) => b.k - a.k || b.m.id - a.m.id);
  const keep = new Set(ranked.slice(0, MEMORY_CAP).map(x => x.i));
  v.memories = v.memories.filter((_, i) => keep.has(i));
}

/** Най-подходящите k спомена: скорошност + важност + съвпадение с ключовите думи. */
export function retrieve(memories: Memory[], now: number, keywords: string[], k = 8): Memory[] {
  const kws = keywords.map(w => w.toLowerCase()).filter(Boolean);
  const scored = memories.map(m => {
    const rec = Math.exp(-(now - m.time) / 2160);
    const imp = m.importance / 10;
    let rel = 0;
    if (kws.length) {
      const t = m.text.toLowerCase();
      let hit = 0;
      for (const w of kws) if (m.about.includes(w) || t.includes(w)) hit++;
      rel = hit / kws.length;
    }
    return { m, sc: rec + imp + 1.5 * rel };
  });
  scored.sort((a, b) => b.sc - a.sc || b.m.id - a.m.id);
  return scored.slice(0, Math.max(0, k)).map(x => x.m);
}
