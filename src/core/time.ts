// Игрово време: 1 реална минута = 15 игрови минути → игровият ден е 96 реални минути.
export const GAME_MINUTES_PER_REAL_SECOND = 0.25;
export const MINUTES_PER_DAY = 1440;

/** Ден (от 1) по общото време в игрови минути. */
export function dayOf(totalMinutes: number): number { return Math.floor(totalMinutes / MINUTES_PER_DAY) + 1; }
/** Минута от деня 0..1439. */
export function minuteOfDay(totalMinutes: number): number { return ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY; }
/** „06:40“ */
export function formatClock(totalOrMinuteOfDay: number): string {
  const m = Math.floor(minuteOfDay(totalOrMinuteOfDay));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** „Ден 12 · 06:40“ */
export function formatDayClock(totalMinutes: number): string { return `Ден ${dayOf(totalMinutes)} · ${formatClock(totalMinutes)}`; }

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';
/** Зазоряване 05:00–07:00, ден 07:00–19:00, здрач 19:00–21:00, нощ 21:00–05:00. */
export function dayPhase(totalMinutes: number): DayPhase {
  const h = minuteOfDay(totalMinutes) / 60;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 19) return 'day';
  if (h >= 19 && h < 21) return 'dusk';
  return 'night';
}
export function isNight(totalMinutes: number): boolean { const p = dayPhase(totalMinutes); return p === 'night'; }
/** Таласъмите излизат по здрач и нощем. */
export function isDarkish(totalMinutes: number): boolean { const p = dayPhase(totalMinutes); return p === 'night' || p === 'dusk'; }
/** Височина на слънцето -1..1 (0 = хоризонт; изгрев 06:00, залез 20:00). */
export function sunElevation(totalMinutes: number): number {
  const h = minuteOfDay(totalMinutes) / 60;
  // ден от 6 до 20 часа → синус от 0 до π
  if (h >= 6 && h <= 20) return Math.sin(((h - 6) / 14) * Math.PI);
  const nh = h > 20 ? h - 20 : h + 4; // 0..10 нощни часа
  return -Math.sin((nh / 10) * Math.PI) * 0.6;
}
