// Нива, опит (XP), живот, сила. Чиста логика — без three.js.
export const MAX_LEVEL = 10;

/** Титли по нива (1 = „Странник“). */
export const LEVEL_TITLES = [
  'Странник', 'Странник', 'Пътник', 'Ловец на таласъми', 'Юнак',
  'Юнак', 'Закрилник', 'Закрилник', 'Змееборец', 'Легенда',
];

/** Колко опит трябва от ниво L до L+1. */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return 80 + 40 * (level - 1);
}

export function baseMaxHp(level: number): number { return 100 + (level - 1) * 15; }
export function baseMaxStamina(level: number): number { return 100 + (level - 1) * 8; }

export interface StatsSave { level: number; xp: number; hp: number; stamina: number }

export class Stats {
  level = 1;
  /** Опит в рамките на текущото ниво. */
  xp = 0;
  hp = 100;
  stamina = 100;
  /** Бонуси от екипировката (Rpg ги обновява). */
  bonusHp = 0;
  bonusStamina = 0;

  get maxHp(): number { return baseMaxHp(this.level) + this.bonusHp; }
  get maxStamina(): number { return baseMaxStamina(this.level) + this.bonusStamina; }
  get title(): string { return LEVEL_TITLES[Math.min(LEVEL_TITLES.length, this.level) - 1]; }
  get xpNext(): number { return xpToNext(this.level); }

  /** Добавя опит. Връща новите нива (може няколко наведнъж). При ново ниво животът и силата се пълнят. */
  addXp(n: number): number[] {
    const ups: number[] = [];
    if (n <= 0) return ups;
    this.xp += Math.round(n);
    while (this.level < MAX_LEVEL && this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      ups.push(this.level);
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
    if (ups.length) { this.hp = this.maxHp; this.stamina = this.maxStamina; }
    return ups;
  }

  /** Сила на удара: оръжие + ниво (+ бонуси). */
  damage(weaponDamage: number, bonus = 0): number { return weaponDamage + bonus + (this.level - 1) * 2; }

  heal(n: number): number { const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + n); return this.hp - before; }
  restoreStamina(n: number): void { this.stamina = Math.min(this.maxStamina, this.stamina + n); }
  clamp(): void { this.hp = Math.min(this.hp, this.maxHp); this.stamina = Math.min(this.stamina, this.maxStamina); }

  serialize(): StatsSave { return { level: this.level, xp: this.xp, hp: Math.round(this.hp), stamina: Math.round(this.stamina) }; }
  load(s: StatsSave): void {
    this.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(s.level ?? 1)));
    this.xp = Math.max(0, Math.floor(s.xp ?? 0));
    this.hp = s.hp ?? this.maxHp; this.stamina = s.stamina ?? this.maxStamina;
    if (this.hp <= 0) this.hp = this.maxHp;
  }
}

/** Колко щета остава след бронята (броня 50 → половината). */
export function mitigate(amount: number, armor: number): number {
  return amount * (50 / (50 + Math.max(0, armor)));
}
