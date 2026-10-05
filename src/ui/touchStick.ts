// Сметките на виртуалния джойстик (без DOM — проби в Node).

/** Джойстик: радиус в пиксели, мъртва зона и прагът за бягане (0..1). */
export const STICK_RADIUS = 56;
export const DEAD = 0.14;
export const RUN_AT = 0.9;
/** Плъзгането по екрана върти камерата по-бързо от мишката (пръстът минава по-малко път). */
export const LOOK_GAIN = 1.7;

/** Вектор на джойстика от отместването на пръста (пиксели) → {fwd, right, mag}; без мъртвата зона, до 1. */
export function stickVector(dx: number, dy: number, radius = STICK_RADIUS): { fwd: number; right: number; mag: number } {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { fwd: 0, right: 0, mag: 0 };
  const raw = Math.min(1, len / radius);
  if (raw < DEAD) return { fwd: 0, right: 0, mag: 0 };
  const mag = (raw - DEAD) / (1 - DEAD);
  return { fwd: (-dy / len) * mag, right: (dx / len) * mag, mag };
}
