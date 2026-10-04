// Общи помощници за мозъка по сценарий: разбор на ситуацията, отношение, пол, попълване на шаблони,
// избор без повторение, вплитане на спомени. Без three.js и без браузъра.
import { Rng } from '../../core/rng';
import { VILLAGERS, type VillagerId, type VillagerProfile } from '../../data/villagers';
import { dayOf } from '../../core/time';
import type { Memory, Relation } from '../types';
import type { Partner, Persona } from './Brain';

export type RelLevel = 'hostile' | 'neutral' | 'friendly' | 'loving';
export type Phase = 'dawn' | 'morning' | 'day' | 'evening' | 'night';
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'unknown';
export type MoodKind = 'angry' | 'sad' | 'scared' | 'happy' | 'calm';

export interface Situation {
  raw: string;
  day: number;
  hour: number;
  phase: Phase;
  weather: WeatherKind;
  riverFlowing: boolean;
  lamiaDead: boolean;
  festival: boolean;
  winter: boolean;
}

export function isVillagerId(id: string): id is VillagerId { return Object.prototype.hasOwnProperty.call(VILLAGERS, id); }
export function profileOf(id: string): VillagerProfile | undefined { return isVillagerId(id) ? VILLAGERS[id] : undefined; }

export function isFemale(p: { id: string; name?: string }): boolean {
  const prof = profileOf(p.id);
  if (prof) return prof.gender === 'f';
  if (p.id === 'player') return false;
  const n = (p.name ?? '').trim().split(/\s+/).pop() ?? '';
  return /[ая]$/.test(n) && !/^(дядо|чичо)/i.test(p.name ?? '');
}

export function parseSituation(raw: string): Situation {
  const s = (raw || '').toLowerCase();
  const dm = /ден\s*(\d+)/.exec(s);
  const tm = /(\d{1,2})[:.](\d{2})/.exec(s);
  const day = dm ? parseInt(dm[1], 10) : 1;
  const hour = tm ? Math.min(23, parseInt(tm[1], 10)) : 12;
  let phase: Phase;
  if (hour >= 5 && hour < 7) phase = 'dawn';
  else if (hour >= 7 && hour < 11) phase = 'morning';
  else if (hour >= 11 && hour < 18) phase = 'day';
  else if (hour >= 18 && hour < 22) phase = 'evening';
  else phase = 'night';
  if (/нощ|полунощ/.test(s) && !tm) phase = 'night';
  let weather: WeatherKind = 'unknown';
  if (/буря|гръм|гърм|светкав/.test(s)) weather = 'storm';
  else if (/дъжд|вали|ръми/.test(s)) weather = 'rain';
  else if (/мъгл/.test(s)) weather = 'fog';
  else if (/облач|сиво|навъсен/.test(s)) weather = 'cloudy';
  else if (/слънч|ясно|ясен|топло/.test(s)) weather = 'clear';
  const riverFlowing = /(река(та)?|бистрица|водата)[^.]{0,20}(тече|се върна|пълна|потече)|потече|тече отново/.test(s) && !/(суха|пресъхн|не тече)/.test(s);
  const lamiaDead = /лам(ята|я)[^.]{0,25}(мъртва|победен|убит|падна|няма я)/.test(s) || /победи(ха|л)? ламята/.test(s);
  const festival = /сбор|празник|хоро/.test(s);
  const winter = /зима|сняг|снеж|караконджул/.test(s);
  return { raw, day, hour, phase, weather, riverFlowing: riverFlowing || lamiaDead, lamiaDead, festival, winter };
}

export function relLevel(r?: Relation): RelLevel {
  if (!r) return 'neutral';
  if (r.affinity <= -30 || r.trust <= -45) return 'hostile';
  if (r.affinity >= 60) return 'loving';
  if (r.affinity >= 20 || r.trust >= 35) return 'friendly';
  return 'neutral';
}

export function moodKind(mood: string | undefined): MoodKind {
  const m = (mood || '').toLowerCase();
  if (/ядос|сърд|гнев|бесн|обид|раздраз|намръщ/.test(m)) return 'angry';
  if (/тъж|мъка|оклюм|унил|скръб|самот/.test(m)) return 'sad';
  if (/уплаш|страх|тревож|притесн|неспок/.test(m)) return 'scared';
  if (/вес|радост|доволн|щаст|ведр|засмя|влюб/.test(m)) return 'happy';
  return 'calm';
}

/** Звателна форма на името на жител (за обръщение). */
const VOCATIVE: Record<VillagerId, string> = {
  gena: 'бабо Гено', peyu: 'дядо Пею', petko: 'Петко', ivan: 'Иване', maria: 'Марийо', radka: 'Радке', kalin: 'Калине',
};
/** Как всеки жител се обръща към странника според отношението. */
const PLAYER_ADDRESS: Record<VillagerId, Record<RelLevel, string>> = {
  gena: { hostile: 'момче', neutral: 'чедо', friendly: 'чедо', loving: 'чедо мое' },
  peyu: { hostile: 'чужденецо', neutral: 'странниче', friendly: 'странниче', loving: 'сине' },
  petko: { hostile: 'ей, ти', neutral: 'странник', friendly: 'приятел', loving: 'брат' },
  ivan: { hostile: 'странник', neutral: 'странник', friendly: 'приятелю', loving: 'братко' },
  maria: { hostile: 'странниче', neutral: 'странниче', friendly: 'Стояне', loving: 'Стояне' },
  radka: { hostile: 'драги', neutral: 'миличък', friendly: 'хубавецо', loving: 'сладур' },
  kalin: { hostile: 'странниче', neutral: 'странниче', friendly: 'Стояне', loving: 'приятелю' },
};

export function cap(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
export function lcFirst(s: string): string {
  if (!s) return s;
  const first = s.split(/[\s,.!?—]/)[0];
  if (PROPER.has(first.replace(/[„“"]/g, ''))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
const PROPER = new Set(['Гена', 'Пею', 'Петко', 'Иван', 'Мария', 'Радка', 'Калин', 'Стоян', 'Ламята', 'Бистрица', 'Самодивско', 'Караконджулът', 'Иване', 'Марийо', 'Петко', 'Радке', 'Калине']);

/** Пълно име за изречение („баба Гена“, „Петко“). */
export function nameOf(id: string, fallback?: string): string {
  if (id === 'player') return 'странникът';
  return profileOf(id)?.name ?? fallback ?? id;
}
export function shortOf(id: string, fallback?: string): string {
  if (id === 'player') return 'странникът';
  return profileOf(id)?.short ?? fallback ?? id;
}

export interface Ctx {
  rng: Rng;
  id: string;                 // говорещият
  vid?: VillagerId;
  prof?: VillagerProfile;
  female: boolean;
  persona: Persona;
  partner: Partner;
  partnerFemale: boolean;
  rel: RelLevel;
  trust: number;
  affinity: number;
  sit: Situation;
  mood: MoodKind;
  memories: Memory[];
  used: string;               // целият текст от историята (за да не се повтаряме)
}

export function makeCtx(speaker: Persona, partner: Partner, situation: string, memories: Memory[], history: { who: string; text: string }[], seed: number): Ctx {
  const prof = profileOf(speaker.id);
  return {
    rng: new Rng(seed ^ 0x5bd1e995),
    id: speaker.id,
    vid: prof?.id,
    prof,
    female: isFemale(speaker),
    persona: speaker,
    partner,
    partnerFemale: partner.isPlayer ? false : isFemale(partner),
    rel: relLevel(partner.relation),
    trust: partner.relation?.trust ?? 0,
    affinity: partner.relation?.affinity ?? 0,
    sit: parseSituation(situation),
    mood: moodKind(speaker.mood),
    memories: memories ?? [],
    used: (history ?? []).map((h) => h.text).join('\n'),
  };
}

export function address(c: Ctx): string {
  if (c.partner.isPlayer || c.partner.id === 'player') {
    if (c.vid) return PLAYER_ADDRESS[c.vid][c.rel];
    return 'странниче';
  }
  if (isVillagerId(c.partner.id)) return VOCATIVE[c.partner.id];
  return c.partner.name;
}

export function hello(sit: Situation): string {
  switch (sit.phase) {
    case 'dawn': case 'morning': return 'Добро утро';
    case 'day': return 'Добър ден';
    default: return 'Добър вечер';
  }
}
export function todWord(sit: Situation): string {
  switch (sit.phase) {
    case 'dawn': case 'morning': return 'тази сутрин';
    case 'day': return 'днес';
    case 'evening': return 'тази вечер';
    default: return 'тази нощ';
  }
}

/** Условия в началото на шаблона: „#dry Текст“, „#flow #night Текст“. */
export function condOk(cond: string, c: Ctx): boolean {
  const s = c.sit;
  switch (cond) {
    case 'dry': return !s.riverFlowing;
    case 'flow': return s.riverFlowing;
    case 'alive': return !s.lamiaDead;
    case 'dead': return s.lamiaDead;
    case 'night': return s.phase === 'night' || s.phase === 'evening';
    case 'day': return s.phase !== 'night';
    case 'morning': return s.phase === 'dawn' || s.phase === 'morning';
    case 'rain': return s.weather === 'rain' || s.weather === 'storm';
    case 'storm': return s.weather === 'storm';
    case 'fog': return s.weather === 'fog';
    case 'clear': return s.weather === 'clear';
    case 'fest': return s.festival;
    case 'player': return c.partner.isPlayer;
    case 'npc': return !c.partner.isPlayer;
    case 'trust': return c.trust >= 40;
    case 'hitrust': return c.trust >= 70;
    case 'friend': return c.rel === 'friendly' || c.rel === 'loving';
    case 'foe': return c.rel === 'hostile';
    case 'angry': return c.mood === 'angry';
    case 'sad': return c.mood === 'sad' || c.mood === 'scared';
    case 'happy': return c.mood === 'happy';
    case 'winter': return s.winter;
    default: return true;
  }
}

/** Разделя условията от текста. */
export function splitConds(tpl: string): { conds: string[]; text: string } {
  const conds: string[] = [];
  let t = tpl;
  while (t.startsWith('#')) {
    const sp = t.indexOf(' ');
    if (sp < 0) break;
    conds.push(t.slice(1, sp));
    t = t.slice(sp + 1);
  }
  return { conds, text: t };
}

export function eligible(list: readonly string[], c: Ctx): string[] {
  return list.filter((tpl) => splitConds(tpl).conds.every((k) => condOk(k, c)));
}

/** Попълва шаблона: {p} {P} {hello} {tod} {name} {Name}, [мъжки/женски] за говорещия, <мъжки/женски> за събеседника. */
export function fill(tpl: string, c: Ctx, extra?: Record<string, string>): string {
  let t = splitConds(tpl).text;
  t = t.replace(/\[([^\]/]*)\/([^\]]*)\]/g, (_m, a: string, b: string) => (c.female ? b : a));
  t = t.replace(/<([^>/]*)\/([^>]*)>/g, (_m, a: string, b: string) => (c.partnerFemale ? b : a));
  const adr = address(c);
  const pname = c.partner.isPlayer ? 'странникът' : nameOf(c.partner.id, c.partner.name);
  t = t.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (extra && k in extra) return extra[k];
    switch (k) {
      case 'p': return adr;
      case 'P': return cap(adr);
      case 'hello': return hello(c.sit);
      case 'tod': return todWord(c.sit);
      case 'name': return pname;
      case 'Name': return cap(pname);
      default: return m;
    }
  });
  return tidy(t);
}

/** Чисти двойни интервали, „, ,“ и празни обръщения. */
export function tidy(t: string): string {
  return t.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/\s+…(\s|$)/g, '…$1').replace(/,\s*,/g, ',').trim();
}

/** Избира шаблон, който не е казан вече в разговора. Връща попълнения текст. */
export function pickFresh(list: readonly string[], c: Ctx, extra?: Record<string, string>): string {
  const ok = eligible(list, c);
  const pool = ok.length ? ok : list.filter((t) => splitConds(t).conds.length === 0);
  if (!pool.length) return '';
  const filled = pool.map((t) => fill(t, c, extra));
  const fresh = filled.filter((f) => !c.used.includes(f));
  const from = fresh.length ? fresh : filled;
  return c.rng.pick(from);
}

export function sentences(t: string): number {
  const m = t.match(/[.!?…]+(\s|$)/g);
  return m ? m.length : 1;
}

/** Съединява части в реплика с най-много `max` изречения. */
export function join(parts: (string | undefined | null | false)[], max = 3): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    const next = out ? `${out} ${p}` : p;
    if (sentences(next) > max && out) continue;
    out = next;
  }
  return tidy(out);
}

/** Спомен → изречение, готово за вплитане („Вчера … — Петко се скара с Иван.“). */
export function memoryDay(m: Memory): number { return dayOf(m.time); }

export function pickMemory(c: Ctx, opts: { avoidPlayer?: boolean; about?: string; kinds?: Memory['kind'][] } = {}): Memory | undefined {
  let ms = c.memories.filter((m) => m && typeof m.text === 'string' && m.text.trim().length > 3 && m.kind !== 'plan' && m.kind !== 'belief');
  if (opts.avoidPlayer) ms = ms.filter((m) => !m.about?.includes('player') && !/странник/i.test(m.text));
  if (opts.about) ms = ms.filter((m) => m.about?.includes(opts.about!) || m.text.toLowerCase().includes(opts.about!.toLowerCase()));
  if (opts.kinds) ms = ms.filter((m) => opts.kinds!.includes(m.kind));
  ms = ms.filter((m) => !c.used.includes(m.text.trim()));
  if (!ms.length) return undefined;
  // най-скорошните и най-важните
  const sorted = [...ms].sort((a, b) => (b.importance * 100 + b.time / 100) - (a.importance * 100 + a.time / 100));
  const top = sorted.slice(0, 3);
  return c.rng.pick(top);
}

export function ensurePeriod(t: string): string {
  const s = t.trim();
  if (!s) return s;
  return /[.!?…]$/.test(s) ? s : s + '.';
}

/** Как говорещият въвежда спомен в разказа. */
export function weaveMemory(m: Memory, c: Ctx, style: 'eager' | 'plain' | 'terse' = 'plain'): string {
  const text = ensurePeriod(m.text.trim());
  const already = /^(чух|казват|говори се|разправят|видях|вчера|днес|снощи)/i.test(text);
  const age = c.sit.day - memoryDay(m);
  let lead: string[];
  if (m.kind === 'rumor') {
    lead = style === 'eager'
      ? ['Ама да си остане между нас —', 'Чу ли какво се говори? —', 'Само на теб го казвам —', 'Ох, ще се пукна, ако не ти кажа —']
      : style === 'terse' ? ['Говорят разни.', 'Хората приказват —'] : ['Чух, че', 'Разправят, че', 'Хората говорят, че'];
  } else if (age <= 0) {
    lead = style === 'eager' ? ['Чу ли какво стана днес? —', 'Днес, представи си —'] : style === 'terse' ? ['Днес —'] : ['Днес стана нещо —', 'Още ми е пред очите от днес —'];
  } else if (age === 1) {
    lead = style === 'eager' ? ['Ох, вчера, да знаеш —', 'Вчера, представи си —'] : style === 'terse' ? ['Вчера —'] : ['Вчера —', 'Още мисля за вчера —'];
  } else {
    lead = style === 'terse' ? ['Беше преди време —'] : ['Не мога да забравя —', 'Отпреди няколко дни ми е на ума —'];
  }
  if (already) return text;
  const l = c.rng.pick(lead);
  if (/че$/.test(l)) {
    const body = text.replace(/^(казват|говори се|разправят|чух),?\s*че\s*/i, '');
    return `${l} ${lcFirst(body)}`;
  }
  if (l.endsWith('.')) return `${l} ${text}`;
  return `${l} ${lcFirst(text)}`;
}

/** Род на прилагателно за настроение. */
export function moodWord(c: Ctx, m: string, f: string): string { return c.female ? f : m; }
