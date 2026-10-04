// „Докато те нямаше…“ — светът превърта изминалото реално време и връща до 6 картички с най-интересното.
import type { ChronicleEntry, ChronicleType } from './types';
import type { VillageSim } from './VillageSim';

export interface AwayCard { title: string; text: string; time: number; type: ChronicleType; participants: string[] }

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
  return chosen.sort((a, b) => a.time - b.time || a.id - b.id).map(e => ({ title: cardTitle(e), text: e.text, time: e.time, type: e.type, participants: [...e.participants] }));
}

const TAG_TITLE: Record<string, string> = {
  goats_quarrel: 'Кавга заради козите', goats: 'Кози в нивата', chicken_theft: 'Изчезна кокошка', radka_blames: 'Радка търси виновен',
  new_mayor: 'Нов кмет!', election: 'Избори на мегдана', pre_election: 'Преди изборите', confession: 'Признание под ореха',
  gift: 'Подарък на прага', love_talk: 'Сърдечни работи', storm: 'Буря над селото', storm_end: 'След бурята', rain: 'Дъжд над Самодивско',
  fog: 'Мъгла от гората', karakondzhul: 'Караконджулът!', karakondzhul_end: 'Тропотът утихна', samodivi: 'Самодиви на поляната',
  sabor: 'Сбор в селото', sabor_dance: 'Хоро около ореха', lamia_news: 'Ламята е мъртва!', river_joy: 'Реката пее',
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
