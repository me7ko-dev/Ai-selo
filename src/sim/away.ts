// „Докато те нямаше…“ — светът превърта изминалото реално време и връща до 6 картички с най-интересното.
import type { ChronicleEntry, ChronicleType } from './types';
import type { VillageSim } from './VillageSim';
import type { Brain } from './brain/Brain';
import { dayOf, formatClock } from '../core/time';
import { WEATHER_TEXT } from './text';

export interface AwayCard {
  title: string; text: string; time: number; type: ChronicleType; participants: string[];
  /** Колко е важна случката (важност + вид) — по нея се избират картичките за ИИ. */
  score?: number;
  /** Текстът е преразказан от ИИ. */
  ai?: boolean;
}

/** Колко картички преразказва ИИ и колко най-много чака играчът. */
export const AWAY_AI_CARDS = 3;
export const AWAY_AI_TIMEOUT_MS = 15_000;

/** 1 реална минута = 15 игрови. */
export const AWAY_GAME_MIN_PER_REAL_MS = 15 / 60000;
export const AWAY_CAP_MINUTES = 2880;
export const AWAY_MIN_MINUTES = 5;

const TYPE_BONUS: Partial<Record<ChronicleType, number>> = {
  election: 4, monster: 3, festival: 3, love: 2, quarrel: 2, theft: 2, player: 1, quest: 1, live: 2, weather: 0,
  rumor: 0, work: -1, mood: -1, talk: -3, reflection: -4, system: -5,
};

/** Колко игрови минути ще се превъртят за дадено реално отсъствие. */
export function awayMinutes(realMsAway: number): number {
  if (!(realMsAway > 0)) return 0;
  const m = realMsAway * AWAY_GAME_MIN_PER_REAL_MS;
  return m < AWAY_MIN_MINUTES ? 0 : Math.min(AWAY_CAP_MINUTES, m);
}

export function catchUp(sim: VillageSim, realMsAway: number): AwayCard[] {
  const minutes = awayMinutes(realMsAway);
  if (!minutes) return [];
  const got: ChronicleEntry[] = [];
  const off = sim.bus.on('chronicle', e => { got.push(e); });
  const prevBrain = sim.brain;
  sim.setBrain(null);
  try {
    let left = minutes;
    while (left > 1e-9) { const step = Math.min(60, left); sim.advance(step); left -= step; }
  } finally {
    sim.setBrain(prevBrain);
    off();
  }
  return pickCards(got);
}

/** Избира до 6 най-важни и различни случки (не 6 разговора) и ги подрежда по време. */
export function pickCards(entries: ChronicleEntry[], max = 6): AwayCard[] {
  const pool = entries.map(e => ({ e, base: e.importance + (TYPE_BONUS[e.type] ?? 0) }));
  const chosen: ChronicleEntry[] = [];
  const typeCount = new Map<string, number>();
  const tagSeen = new Set<string>();
  while (chosen.length < max) {
    let best: { e: ChronicleEntry; sc: number } | null = null;
    for (const p of pool) {
      if (chosen.includes(p.e)) continue;
      let sc = p.base - 3 * (typeCount.get(p.e.type) ?? 0);
      if (p.e.tag && tagSeen.has(p.e.tag)) sc -= 3;
      if (!best || sc > best.sc || (sc === best.sc && p.e.time > best.e.time)) best = { e: p.e, sc };
    }
    if (!best || (chosen.length >= 3 && best.sc < 0)) break;
    chosen.push(best.e);
    typeCount.set(best.e.type, (typeCount.get(best.e.type) ?? 0) + 1);
    if (best.e.tag) tagSeen.add(best.e.tag);
  }
  return chosen.sort((a, b) => a.time - b.time || a.id - b.id).map(e => ({
    title: cardTitle(e), text: e.text, time: e.time, type: e.type, participants: [...e.participants], score: e.importance + (TYPE_BONUS[e.type] ?? 0),
  }));
}

export interface AwayAiOptions {
  /** Колко най-много да се чака ИИ (по подразбиране 15 с). */
  timeoutMs?: number;
  /** По желание: свързване с ИИ преди преразказа (напр. () => brainHandle.connect()); влиза в същия таван. */
  connect?: () => Promise<unknown>;
  /** „Сега: …“ за подканата. */
  situation?: string;
}

function connectedBrain(brain: Brain | null | undefined): Brain | null {
  try { return brain && typeof brain.retell === 'function' && brain.status().connected ? brain : null; } catch { return null; }
}

/**
 * „Докато те нямаше…“ с ИИ: първо светът се превърта детерминирано (както catchUp — по сценарий),
 * после, ако има връзка с ИИ, той преразказва трите най-важни картички (ai: true). Каквото не стигне
 * за timeoutMs или не мине проверката — остава с текста по сценарий. Никога не хвърля.
 * brain по подразбиране е мозъкът на симулацията (sim.brain).
 */
export async function catchUpAsync(sim: VillageSim, realMsAway: number, brain?: Brain | null, opts: AwayAiOptions = {}): Promise<AwayCard[]> {
  const b = brain === undefined ? sim.brain : brain;
  const cards = catchUp(sim, realMsAway);
  if (!cards.length || !b) return cards;
  const s = sim.state;
  const situation = opts.situation ?? `Ден ${dayOf(s.time)}, ${formatClock(s.time)}. ${WEATHER_TEXT[s.weather]} ${s.flags.river_flowing || s.flags.lamia_dead ? 'Реката Бистрица отново тече.' : 'Реката Бистрица е пресъхнала.'}`;
  return retellCards(cards, b, { ...opts, situation, seed: s.rng });
}

/**
 * Само преразказът (ако картичките вече са показани по сценарий и искаш да ги смениш после).
 * Връща нов масив; картичките без ИИ текст са непроменени.
 */
export async function retellCards(cards: AwayCard[], brain: Brain | null | undefined, opts: AwayAiOptions & { seed?: number } = {}): Promise<AwayCard[]> {
  const out = cards.map(c => ({ ...c, participants: [...c.participants] }));
  if (!out.length || !brain) return out;
  const limit = Math.max(0, opts.timeoutMs ?? AWAY_AI_TIMEOUT_MS);
  const deadline = Date.now() + limit;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // таймерът не е unref — винаги се чисти във finally
  const timeout = new Promise<null>(res => { timer = setTimeout(() => res(null), limit); });
  try {
    if (opts.connect && !connectedBrain(brain)) await Promise.race([opts.connect().catch(() => null), timeout]);
    const b = connectedBrain(brain);
    if (!b || Date.now() >= deadline) return out;
    const top = out.map((c, i) => ({ c, i })).sort((x, y) => (y.c.score ?? 0) - (x.c.score ?? 0) || y.c.time - x.c.time).slice(0, AWAY_AI_CARDS).sort((x, y) => x.i - y.i);
    const req = {
      events: top.map(({ c }) => ({ title: c.title, text: c.text, time: c.time, participants: [...c.participants] })),
      situation: opts.situation ?? '',
      seed: opts.seed ?? 1,
    };
    const rep = await Promise.race([b.retell!(req).catch(() => null), timeout]);
    if (!rep || !rep.ai || !Array.isArray(rep.texts)) return out;
    top.forEach(({ i }, k) => {
      const t = rep.texts[k];
      if (typeof t === 'string' && t.trim()) { out[i].text = t.trim(); out[i].ai = true; }
    });
    return out;
  } catch {
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TAG_TITLE: Record<string, string> = {
  goats_quarrel: 'Кавга заради козите', goats: 'Кози в нивата', chicken_theft: 'Изчезна кокошка', radka_blames: 'Радка търси виновен',
  new_mayor: 'Нов кмет!', election: 'Избори на мегдана', pre_election: 'Преди изборите', confession: 'Признание под ореха',
  gift: 'Подарък на прага', love_talk: 'Сърдечни работи', storm: 'Буря над селото', storm_end: 'След бурята', rain: 'Дъжд над Самодивско',
  fog: 'Мъгла от гората', karakondzhul: 'Караконджулът!', karakondzhul_end: 'Тропотът утихна', samodivi: 'Самодиви на поляната',
  sabor: 'Сбор в селото', sabor_dance: 'Хоро около огъня', lamia_news: 'Ламята е мъртва!', river_joy: 'Реката пее',
  theft: 'Кражба в селото', gena_tracks: 'Странни следи', kalin_light: 'Синкава светлина', kalin_noticed: 'Някой забеляза Калин',
  maria_dreams: 'Мария мечтае', peyu_river: 'Кметът и реката', evening: 'Вечер в селото', reflection: 'Вечерни мисли',
};
const TYPE_TITLE: Record<ChronicleType, string> = {
  talk: 'Приказки на мегдана', quarrel: 'Кавга на мегдана', love: 'Любов в селото', theft: 'Кражба!', rumor: 'Слухове от хана',
  election: 'Избори', work: 'Майсторска работа', festival: 'Празник', monster: 'Ужас в нощта', player: 'Говори се за странника',
  quest: 'Задача', weather: 'Времето се развали', live: 'Чудо в селото', reflection: 'Вечерни мисли', mood: 'Из селото', system: 'Вест',
};

export function cardTitle(e: ChronicleEntry): string {
  if (e.tag && TAG_TITLE[e.tag]) return TAG_TITLE[e.tag];
  if (e.tag?.startsWith('work_')) return 'Майсторска работа';
  if (e.tag?.startsWith('rumor_')) return 'Слухове от хана';
  return TYPE_TITLE[e.type] ?? 'Случка';
}
