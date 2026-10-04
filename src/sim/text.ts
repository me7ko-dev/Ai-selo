// Помощни текстове на български: имена, места (с предлог), род, настроения, време.
import type { PlaceId } from '../data/layout';
import { VILLAGERS, type VillagerId } from '../data/villagers';
import type { Weather } from './types';

export const isVillager = (id: string): id is VillagerId => id in VILLAGERS;

/** „баба Гена“ / „странникът“ */
export function nameOf(id: string): string {
  if (id === 'player') return 'странникът';
  return isVillager(id) ? VILLAGERS[id].name : id;
}
/** Главна буква в началото на изречение. */
export function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
export function lowerFirst(s: string): string { return s ? s[0].toLowerCase() + s.slice(1) : s; }
/** Главна буква: „Баба Гена“. */
export const Name = (id: string) => cap(nameOf(id));

/** Женски / мъжки вариант според рода на жителя. */
export function g(id: string, f: string, m: string): string {
  return isVillager(id) && VILLAGERS[id].gender === 'f' ? f : m;
}

/** Списък с „и“: „Иван, Мария и Калин“. */
export function joinNames(ids: string[]): string {
  const n = ids.map(nameOf);
  if (n.length <= 1) return n.join('');
  return n.slice(0, -1).join(', ') + ' и ' + n[n.length - 1];
}

/** Къде (с предлог): „на мегдана“. */
export const LOC: Record<PlaceId, string> = {
  square: 'на мегдана', walnut: 'под стария орех', well: 'при чешмата', smithy: 'в ковачницата', inn: 'пред хана',
  coop: 'при кокошарника', sheepfold: 'при кошарата', field_ivan: 'в нивата на Иван', gate: 'на входа на селото',
  house_gena: 'пред къщата на баба Гена', house_peyu: 'пред къщата на дядо Пею', house_petko: 'пред къщата на Петко',
  house_ivan: 'пред къщата на Иван', house_maria: 'пред къщата на Мария', house_radka: 'пред къщата на Радка',
  house_kalin: 'пред къщата на Калин', workshop_kalin: 'в дърводелницата', loom_maria: 'при стана на Мария',
  forest_edge: 'в края на гората', forest: 'в Тъмната гора', glade: 'на Поляната на самодивите', pond: 'при езерцето',
  riverbed: 'в коритото на Бистрица', bridge: 'на каменния мост', lamia_plateau: 'край бърлогата на Ламята',
  lamia_peak: 'на Ламин връх', fortress: 'при Старата крепост', swamp: 'край Блатото на юдите', south_road: 'на пътя на юг',
  start: 'на пътя към селото',
};

export const WEATHER_TEXT: Record<Weather, string> = {
  clear: 'Ясно време.', cloudy: 'Облачно е.', rain: 'Вали дъжд.', storm: 'Бушува буря.', fog: 'Мъгла е паднала над селото.',
};

/** Настроения: [женски, мъжки]. */
export const MOODS = {
  happy: ['щастлива', 'щастлив'], cheerful: ['весела', 'весел'], content: ['доволна', 'доволен'], calm: ['спокойна', 'спокоен'],
  thoughtful: ['замислена', 'замислен'], sad: ['тъжна', 'тъжен'], angry: ['ядосана', 'ядосан'], afraid: ['уплашена', 'уплашен'],
  tired: ['уморена', 'уморен'], hungry: ['гладна', 'гладен'], lonely: ['самотна', 'самотен'], inlove: ['влюбена', 'влюбен'],
  grumpy: ['сърдита', 'сърдит'], ashamed: ['засрамена', 'засрамен'], proud: ['горда', 'горд'],
} as const;
export type MoodKey = keyof typeof MOODS;
export function moodWord(id: string, key: MoodKey): string { const [f, m] = MOODS[key]; return g(id, f, m); }

/** Груба оценка (−100..100) на дума за настроение (от мозъка/ИИ). */
export function moodScore(word: string): number {
  const w = word.toLowerCase();
  if (/щаст|радост|ликув|възторг/.test(w)) return 30;
  if (/весел|доволн|влюб|горд|спокой|мил|топл/.test(w)) return 15;
  if (/ядос|бесн|сърдит|гняв|зъл/.test(w)) return -30;
  if (/уплаш|страх|ужас/.test(w)) return -25;
  if (/тъж|нещаст|самот|обид|засрам/.test(w)) return -15;
  if (/замисл|умор|подозр|гладн/.test(w)) return -5;
  return 0;
}

/** Детерминиран хеш (за избор на текст, без да харчим генератора на случайни числа). */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
export function hpick<T>(arr: readonly T[], ...parts: (string | number)[]): T { return arr[hash(...parts) % arr.length]; }
