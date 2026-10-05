// Самодивите на поляната — не са врагове: поклониш ли се, благославят; развалиш ли хорото им — проклинат.
// Чиста логика (без three.js) — тества се в Node. Rpg вика update()/bow()/attacked() и чете множителите.
import { PLACES } from '../data/layout';
import { MINUTES_PER_DAY, minuteOfDay } from '../core/time';
import type { VillagerId } from '../data/villagers';
import type { DialogueOption } from '../sim/types';
import type { QuestHost } from './host';

/** Кръгът на хорото (същият като в ambient.ts). */
export const RING = { x: PLACES.glade.pos.x + 6, z: PLACES.glade.pos.z + 10, r: 5.5 };
/** Нощта на самодивите: 21:30–04:30. */
export const NIGHT_START = 21 * 60 + 30;
export const NIGHT_END = 4 * 60 + 30;
/** Докъде стига поканата „Поклони се“ (от центъра на хорото). */
export const BOW_RANGE = RING.r + 6;
/** По-близо от това до центъра — „влезе в хорото“ (предупреждение, после проклятие). */
export const WARN_R = 4.2;
export const TRESPASS_R = 2.8;
/** Проклятието трае до 20:00 на следващия ден (ако баба Гена не го махне по-рано). */
export const CURSE_UNTIL_MIN = 20 * 60;

export const BLESS = { damage: 1.25, regen: 2.5 };
export const CURSE = { damage: 0.7, speed: 0.75 };

export function isSamodiviNight(time: number): boolean {
  const m = minuteOfDay(time);
  return m > NIGHT_START || m < NIGHT_END;
}

/** Играят ли самодивите сега (нощем или когато е извикана случката „самодиви“). */
export function samodiviDancing(time: number, calledUntil?: unknown): boolean {
  return isSamodiviNight(time) || (typeof calledUntil === 'number' && calledUntil > time);
}

/** Коя нощ е: денят (от 0), в чиято вечер е започнала. Денем — текущият ден. */
export function nightKey(time: number): number {
  const d = Math.floor(time / MINUTES_PER_DAY);
  return minuteOfDay(time) < NIGHT_END ? d - 1 : d;
}

/** Зазоряването, с което свършва тази нощ (общи минути). */
export function nightEnd(time: number): number { return (nightKey(time) + 1) * MINUTES_PER_DAY + NIGHT_END; }

export interface SamodiviSave {
  blessUntil: number;
  curseUntil: number;
  /** nightKey на последната благословия (само веднъж на нощ). */
  blessNight: number;
  /** nightKey на нощта, в която са проклели героя (тогава изчезват до сутринта). */
  goneNight: number;
  /** Предупредени ли сме тази нощ да не влизаме в хорото. */
  warnNight: number;
  blessedEver: boolean;
  cursedEver: boolean;
  secretTold: boolean;
}

export type SamodiviZone = 'none' | 'near' | 'warn' | 'inside';
export type SamodiviCause = 'attack' | 'trespass';

const BLESS_LINES = [
  'Поклони се, юначе, и не ни пречи — затова и ние ще ти помогнем. Лека да ти е ръката и здраво сърцето до зори!',
  'Рядко идва човек с почит при хорото ни. Вземи от нашата сила — докато звездите гаснат, никоя рана няма да те повали.',
  'Ти не ни гледаш с алчни очи, странниче. Върви с благословията ни — до първи петли сабята ти ще е като мълния.',
];
const CURSE_LINES: Record<SamodiviCause, string[]> = {
  attack: [
    'Посегна на самодива?! Тежки да са ти нозете, слаба да ти е ръката, докато някой мъдър не те отърве!',
    'Желязо срещу самодива! Ще носиш гнева ни, странниче — нозете ти ще са като от олово!',
  ],
  trespass: [
    'Кой смее да тъпче самодивско хоро?! Тежки да са ти нозете, слаба да ти е ръката!',
    'Влезе в кръга ни без покана — сега ще носиш проклятието ни, докато някой мъдър не го снеме!',
  ],
};

const o = (id: string, text: string): DialogueOption => ({ id: 'q:' + id, text });

export class Samodivi {
  blessUntil = 0;
  curseUntil = 0;
  blessNight = -99;
  goneNight = -99;
  warnNight = -99;
  blessedEver = false;
  cursedEver = false;
  secretTold = false;

  blessed(time: number): boolean { return this.blessUntil > time && !this.cursed(time); }
  cursed(time: number): boolean { return this.curseUntil > time; }
  /** Изчезнали ли са тази нощ (след проклятие). */
  gone(time: number): boolean { return this.goneNight === nightKey(time); }

  damageMul(time: number): number { return this.cursed(time) ? CURSE.damage : this.blessed(time) ? BLESS.damage : 1; }
  speedMul(time: number): number { return this.cursed(time) ? CURSE.speed : 1; }
  /** Живот в секунда отгоре (и в бой). */
  regen(time: number): number { return this.blessed(time) ? BLESS.regen : 0; }

  /** Кратко за заглавието в HUD: „благословен“ / „прокълнат“ / ''. */
  label(time: number): string { return this.cursed(time) ? 'прокълнат' : this.blessed(time) ? 'благословен' : ''; }

  /** Къде е героят спрямо хорото (само докато самодивите играят и не са изчезнали). */
  zone(x: number, z: number, time: number, dancing: boolean): SamodiviZone {
    if (!dancing || this.gone(time)) return 'none';
    const d = Math.hypot(x - RING.x, z - RING.z);
    if (d < TRESPASS_R) return 'inside';
    if (d < WARN_R) return 'warn';
    if (d < BOW_RANGE) return 'near';
    return 'none';
  }

  canBow(time: number, dancing: boolean): boolean {
    return dancing && !this.gone(time) && !this.cursed(time) && this.blessNight !== nightKey(time);
  }

  /** Поклон. Връща репликата на самодивата или null (вече благословен тази нощ / прокълнат / не играят). */
  bow(time: number, dancing: boolean): string | null {
    if (!this.canBow(time, dancing)) return null;
    const key = nightKey(time);
    this.blessNight = key;
    this.blessUntil = isSamodiviNight(time) ? nightEnd(time) : time + 240;
    this.blessedEver = true;
    return BLESS_LINES[((key % BLESS_LINES.length) + BLESS_LINES.length) % BLESS_LINES.length];
  }

  /** Предупреждение веднъж на нощ, когато героят доближи средата на хорото. */
  warn(time: number): boolean {
    const key = nightKey(time);
    if (this.warnNight === key) return false;
    this.warnNight = key;
    return true;
  }

  /** Обида (удар или тъпкане на хорото). Връща репликата или null, ако вече са проклели. */
  offend(time: number, dancing: boolean, cause: SamodiviCause): string | null {
    if (!dancing || this.gone(time)) return null;
    const key = nightKey(time);
    this.goneNight = key;
    this.blessUntil = 0;
    this.curseUntil = (key + 1) * MINUTES_PER_DAY + CURSE_UNTIL_MIN;
    this.cursedEver = true;
    const lines = CURSE_LINES[cause];
    return lines[((key % lines.length) + lines.length) % lines.length];
  }

  /** Сваля проклятието (баба Гена). */
  lift(): void { this.curseUntil = 0; }

  /** Изтекло ли е нещо от последния път (за известие). */
  expired(prev: number, time: number): 'bless' | 'curse' | null {
    if (this.blessUntil > prev && this.blessUntil <= time && this.curseUntil <= prev) return 'bless';
    if (this.curseUntil > prev && this.curseUntil <= time) return 'curse';
    return null;
  }

  // ---------- разговор с баба Гена ----------
  options(v: VillagerId, time: number): DialogueOption[] {
    if (v !== 'gena') return [];
    if (this.cursed(time)) return [o('sam_lift', 'Бабо Гено, самодивите ме проклеха…')];
    if (this.blessedEver && !this.secretTold) return [o('sam_secret', 'Бабо, самодивите на поляната ме благословиха.')];
    return [];
  }

  choose(v: VillagerId, id: string, time: number, host: QuestHost): { say: string } | null {
    if (v !== 'gena') return null;
    if (id === 'q:sam_lift') {
      if (!this.cursed(time)) return null;
      this.lift();
      // делото → спомен у баба Гена, доверие и запис в летописа
      host.deed({ kind: 'helped', villager: 'gena', text: 'Баба Гена сне от странника проклятието на самодивите — с паница вода и червен конец.', importance: 5, affinity: 10, trust: 15, witnesses: [] });
      host.sfx('quest');
      host.notify('Проклятието на самодивите е снето.', 'quest');
      return {
        say: 'Ох, чедо, чедо… Що си ходил да им пречиш на хорото? Самодивите не прощават лесно. Седни. Дай ръката. (Тя шепне нещо над паница вода и ти завързва червен конец на китката.) Така. Махнах го. И не ме питай откъде знам как се маха — една самодива ме научи, много отдавна… Хайде, стига съм приказвала. И следващия път се поклони, като ги видиш.',
      };
    }
    if (id === 'q:sam_secret') {
      if (!this.blessedEver || this.secretTold) return null;
      this.secretTold = true;
      // важност 3: под прага за слух — тайната не тръгва из селото
      host.deed({ kind: 'talked', villager: 'gena', text: 'Баба Гена сподели със странника тайна, която пазила цял живот: като млада видяла самодива на поляната.', importance: 3, affinity: 15, trust: 25, witnesses: [] });
      host.notify('Баба Гена ти вярва повече.', 'quest');
      return {
        say: 'Благословиха ли те? …Значи си добро чедо. (Дълго мълчи.) Слушай тогава нещо, дето никому не съм казвала. Като бях мома, ей толкова, тръгнах по тъмно за билки и се загубих към поляната. И я видях — самодива, бяла като месечина, косите ѝ до земята. Не избягах. Тя ми се усмихна и ми показа кой стрък лекува и кой трови. Оттогава съм билкарка. Шейсет години го пазя… Сега го знаеш и ти. Пази го и ти, а?',
      };
    }
    return null;
  }

  serialize(): SamodiviSave {
    return {
      blessUntil: this.blessUntil, curseUntil: this.curseUntil, blessNight: this.blessNight, goneNight: this.goneNight,
      warnNight: this.warnNight, blessedEver: this.blessedEver, cursedEver: this.cursedEver, secretTold: this.secretTold,
    };
  }

  load(s?: Partial<SamodiviSave>): void {
    const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    this.blessUntil = n(s?.blessUntil, 0);
    this.curseUntil = n(s?.curseUntil, 0);
    this.blessNight = n(s?.blessNight, -99);
    this.goneNight = n(s?.goneNight, -99);
    this.warnNight = n(s?.warnNight, -99);
    this.blessedEver = !!s?.blessedEver;
    this.cursedEver = !!s?.cursedEver;
    this.secretTold = !!s?.secretTold;
  }
}
