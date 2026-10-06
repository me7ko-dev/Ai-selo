// Какво облича всеки човек: кои дрехи от телата в people.glb се виждат, в какви цветове, каква коса.
// Чиста логика (без three.js) — тества се в Node.
import type { VillagerLook } from '../../data/villagers';

/** Етикетите на дрехите (същите са в tools/build-characters.mjs → G). */
export const G = {
  KEEP: 0, SHIRT: 1, VEST: 2, SASH: 3, TROUSERS: 4, BOOTS: 5, CUFF: 6, SKIRT: 7, APRON: 8, SCARF: 9,
  HOOD: 10, KALPAK: 11, LEATHER: 12, TRIM: 13, BODICE: 14, LEGWRAP: 15, DRESS: 16, CLOAK: 17,
} as const;
export const N_GARMENTS = 20;

/** Частите на косата (tools/build-characters.mjs → HAIR_PIECES). */
export const HAIR = {
  long: 1, buns: 2, parted: 3, buzzed: 4, buzzedF: 5, beard: 6, mustache: 7, browsM: 8, browsF: 9, kalpak: 10, flowing: 11,
} as const;

export type BodyKind = 'M' | 'F' | 'H';
export type Role = 'villager' | 'hero' | 'samodiva' | 'talasam';
export type Tool = NonNullable<VillagerLook['tool']>;

export interface CharSpec {
  role: Role;
  body: BodyKind;
  /** Видими етикети в меша „cloth“ и „folk“ (останалите се скриват). */
  cloth: number[];
  folk: number[];
  /** Части на косата. */
  hair: number[];
  /** Цвят и сила на пребоядисването за всеки етикет (сила 0 = оригиналната текстура). */
  colors: Record<number, [string, number]>;
  /** Цвят на всяка част от косата. */
  hairColors: Record<number, string>;
  skin: [number, number, number];
  /** Височина (м) до темето. */
  height: number;
  /** Ширина на торса (1 = нормално). */
  build: number;
  /** Прегърбване 0..1. */
  stoop: number;
  old: boolean;
  female: boolean;
  tool?: Tool;
  /** Слабо сияние (самодивите). */
  glow?: string;
  /** Венец от цветя (вариант 0..2). */
  wreath?: number;
  /** Вариант (за разминаване на анимациите и лицата). */
  seed: number;
}

/** Височина на темето на телата в people.glb (в покой). */
export const BODY_HEIGHT: Record<BodyKind, number> = { M: 1.81, F: 1.767, H: 1.81 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/** Средният цвят на кожата в текстурата (лицето). */
export const SKIN_BASE = '#c8916f';

/**
 * Кожата в текстурата е светло-загоряла; оттенъкът на човека е линеен множител спрямо нея
 * (look.skin / средния цвят на текстурата, ограничен, за да не стане неестествено).
 */
export function skinTint(hex: string): [number, number, number] {
  const want = hexToLinear(hex), base = hexToLinear(SKIN_BASE);
  return [0, 1, 2].map((i) => Math.max(0.6, Math.min(1.45, want[i] / base[i]))) as [number, number, number];
}

export function villagerSpec(look: VillagerLook): CharSpec {
  const female = look.gender === 'f';
  const old = look.age === 'old';
  const key = [look.skin, look.hair, look.shirt, look.vest, look.legs, look.height].join('|');
  const seed = hash(key);
  const colors: Record<number, [string, number]> = {
    [G.KEEP]: ['#ffffff', 0],
    [G.SHIRT]: [look.shirt, 1],
    [G.VEST]: [look.vest, 1],
    [G.BODICE]: [look.vest, 1],
    [G.SASH]: [look.belt, 1],
    [G.TROUSERS]: [look.legs, 1],
    [G.SKIRT]: [look.legs, 1],
    [G.BOOTS]: [female ? '#2c1d15' : '#4a3020', 0.85],
    [G.LEGWRAP]: [female ? '#2a1f22' : (old ? '#2a2420' : '#e6dfcf'), 1],
    [G.CUFF]: ['#3a2a20', 0.7],
    [G.TRIM]: ['#b3262b', 1],
    [G.APRON]: [look.apron ?? '#3a2a2a', 1],
    [G.SCARF]: [look.scarf ?? '#2a2a3a', 1],
    [G.LEATHER]: ['#5a3a22', 1],
  };
  const hairColors: Record<number, string> = {};
  const hair: number[] = [];
  const add = (piece: number, color = look.hair) => { hair.push(piece); hairColors[piece] = color; };
  if (female) {
    // под забрадката: дългата коса се вижда край лицето; кокът стърчи — затова къса коса под нея
    add(look.age === 'young' ? HAIR.long : look.scarf ? HAIR.buzzedF : HAIR.buns);
    add(HAIR.browsF, old ? '#bdb8ae' : mixHex(look.hair, look.skin, 0.35)); // по-меки вежди
  } else {
    if (look.hat === 'kalpak') add(HAIR.kalpak, '#1c1814');
    add(look.hat === 'kalpak' || old ? HAIR.buzzed : HAIR.parted);
    add(HAIR.browsM, old ? '#c8c3b8' : look.hair);
    if (look.beard === 'full') add(HAIR.beard);
    else if (look.beard === 'mustache') add(HAIR.mustache);
  }
  const cloth = female
    ? [G.SHIRT, G.BODICE, G.SASH, G.TRIM, G.BOOTS, G.LEGWRAP]
    : [G.SHIRT, G.TROUSERS, G.BOOTS, G.LEGWRAP, G.CUFF];
  const folk = female
    ? [G.SKIRT, ...(look.apron ? [G.APRON] : []), ...(look.scarf ? [G.SCARF] : [])]
    : [G.VEST, G.SASH, ...(look.tool === 'hammer' ? [G.LEATHER] : [])];
  return {
    role: 'villager', body: female ? 'F' : 'M', cloth, folk, hair, colors, hairColors,
    skin: skinTint(look.skin), height: look.height,
    build: look.build === 'stout' ? 1.09 : look.build === 'thin' ? 0.95 : 1,
    stoop: old ? (female ? 1 : 0.55) : 0, old, female, tool: look.tool, seed,
  };
}

export function heroSpec(): CharSpec {
  return {
    role: 'hero', body: 'H',
    cloth: [G.KEEP, G.SHIRT, G.TROUSERS, G.HOOD],
    folk: [],
    hair: [HAIR.buzzed, HAIR.browsM, HAIR.beard],
    colors: {
      [G.KEEP]: ['#ffffff', 0],
      [G.SHIRT]: ['#d9ccb2', 0.55],
      [G.TROUSERS]: ['#3b3129', 0.9],
      [G.HOOD]: ['#6b4a2f', 1],
    },
    hairColors: { [HAIR.buzzed]: '#3a2414', [HAIR.browsM]: '#3a2414', [HAIR.beard]: '#4a2c18' },
    skin: skinTint('#d9ab84'), height: 1.8, build: 1, stoop: 0, old: false, female: false, seed: 0.37,
  };
}

const SAMODIVA_HAIR = ['#e8d49a', '#3a2418', '#b8642e', '#ece6da', '#7a4a2a', '#d8b070'];
const SAMODIVA_TRIM = ['#c8a24a', '#9fb8e8', '#d88aa0'];

export function samodivaSpec(index: number): CharSpec {
  const hair = SAMODIVA_HAIR[index % SAMODIVA_HAIR.length];
  const trim = SAMODIVA_TRIM[index % SAMODIVA_TRIM.length];
  return {
    role: 'samodiva', body: 'F',
    cloth: [G.SHIRT, G.BODICE, G.SASH, G.TRIM],
    folk: [G.DRESS],
    hair: [HAIR.flowing, HAIR.browsF],
    colors: {
      [G.SHIRT]: ['#fbfbff', 1],
      [G.BODICE]: ['#f2f3ff', 1],
      [G.SASH]: [trim, 1],
      [G.TRIM]: [trim, 1],
      [G.DRESS]: ['#f6f7ff', 1],
    },
    hairColors: { [HAIR.flowing]: hair, [HAIR.browsF]: mixHex(hair, '#3a2418', 0.25) },
    wreath: index % 3,
    skin: skinTint(['#f4e4d8', '#f0dccb', '#f6e8de'][index % 3]),
    height: 1.72 + (index % 3) * 0.03, build: 0.95, stoop: 0, old: false, female: true,
    glow: '#a9c4ff', seed: (index * 0.618) % 1,
  };
}

/**
 * Таласъмът — неспокоен дух на умрял: прегърбен, сиво-зелена кожа, сплъстена коса и брада, изгнили селски дрехи
 * (риза, елек, избелял пояс), светещи очи, островърхи уши и нокти (добавят се в character.ts).
 */
export function talasamSpec(): CharSpec {
  return {
    role: 'talasam', body: 'M',
    cloth: [G.SHIRT, G.TROUSERS, G.BOOTS, G.LEGWRAP, G.CUFF],
    folk: [G.VEST, G.SASH],
    hair: [HAIR.long, HAIR.browsM, HAIR.beard],
    colors: {
      [G.SHIRT]: ['#4a4c3c', 1],
      [G.TROUSERS]: ['#2a2b22', 1],
      [G.BOOTS]: ['#1c1914', 0.9],
      [G.LEGWRAP]: ['#3a3a2e', 1],
      [G.CUFF]: ['#2a2620', 0.8],
      [G.VEST]: ['#2c3326', 1],
      [G.SASH]: ['#4e2e26', 1],
    },
    hairColors: { [HAIR.long]: '#16180f', [HAIR.browsM]: '#16180f', [HAIR.beard]: '#1a1c12' },
    skin: rawTint('#6e7562'),
    height: 1.74, build: 0.9, stoop: 0.85, old: false, female: false,
    seed: 0.71,
  };
}

/** Като skinTint, но без ограничението за „естествен“ цвят (за създанията). */
export function rawTint(hex: string): [number, number, number] {
  const want = hexToLinear(hex), base = hexToLinear(SKIN_BASE);
  return [0, 1, 2].map((i) => Math.max(0.05, Math.min(3, want[i] / base[i]))) as [number, number, number];
}

/** Смес на два цвята „#rrggbb“ (t = 0 → a). */
export function mixHex(a: string, b: string, t: number): string {
  const c = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(c(a, i) * (1 - t) + c(b, i) * t).toString(16).padStart(2, '0')).join('');
}

/** Цвят „#rrggbb“ → линейни RGB (за униформите на шейдъра). */
export function hexToLinear(hex: string): [number, number, number] {
  const f = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f(1), f(3), f(5)];
}

/** Палитрата като плосък масив vec4 × N_GARMENTS (rgb линейно, a = сила). */
export function paletteArray(colors: Record<number, [string, number]>, n = N_GARMENTS): Float32Array {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) out.set([1, 1, 1, 0], i * 4);
  for (const k in colors) {
    const [hex, a] = colors[k];
    const [r, g, b] = hexToLinear(hex);
    out.set([r, g, b, a], +k * 4);
  }
  return out;
}
