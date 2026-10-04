// Дневни графици на жителите: къде трябва да е всеки и какво прави в даден час.
// Всичко тук е чисто и детерминирано (изборът ден за ден е по хеш, не харчи генератора).
import { PLACES, type PlaceId, type Vec2 } from '../data/layout';
import { VILLAGER_IDS, VILLAGERS, type VillagerId } from '../data/villagers';
import type { Activity, Weather } from './types';
import { hash } from './text';

export interface Goal {
  place: PlaceId;
  act: Activity;
  /** вътре в сградата (спи, яде у дома) */
  inside?: boolean;
  /** етикет за „плана“ */
  why?: string;
}

export interface SchedCtx {
  day: number;
  weather: Weather;
  goatsToday: boolean;   // днес Петко пусна козите в нивата на Иван
  mayor: VillagerId;
}

const H = (h: number, m = 0) => h * 60 + m;
const home = (id: VillagerId) => VILLAGERS[id].home;
const sleep = (id: VillagerId): Goal => ({ place: home(id), act: 'sleep', inside: true, why: 'спи' });
const atHome = (id: VillagerId, act: Activity = 'sit', inside = true): Goal => ({ place: home(id), act, inside, why: 'у дома' });

/** Вечерно място за събиране: ханът или мегданът (дъжд → ханът). */
function social(id: VillagerId, ctx: SchedCtx): Goal {
  if (ctx.weather === 'rain' || ctx.weather === 'fog') return { place: 'inn', act: 'sit', why: 'вечер в хана' };
  return hash(id, ctx.day, 'social') % 3 === 0 ? { place: 'inn', act: 'sit', why: 'вечер в хана' } : { place: 'square', act: 'idle', why: 'вечер на мегдана' };
}

const PEYU_ROUNDS: PlaceId[] = ['square', 'well', 'gate', 'smithy', 'inn', 'coop', 'square', 'walnut'];

export function scheduleFor(id: VillagerId, mod: number, ctx: SchedCtx): Goal {
  const d = ctx.day;
  switch (id) {
    case 'gena':
      if (mod < H(4, 50) || mod >= H(21, 15)) return sleep(id);
      if (mod < H(5, 20)) return atHome(id, 'eat');
      if (mod < H(8, 30)) return { place: 'forest_edge', act: 'work', why: 'бере билки' };
      if (mod < H(12)) return atHome(id, 'work', false);
      if (mod < H(13)) return atHome(id, 'eat');
      if (mod < H(17)) return hash(id, d, 'aft') % 2 === 0 ? { place: 'workshop_kalin', act: 'sit', why: 'на гости на Калин' } : atHome(id, 'work', false);
      if (mod < H(18)) return { place: 'walnut', act: 'sit', why: 'под ореха' };
      return social(id, ctx);
    case 'peyu':
      if (mod < H(6) || mod >= H(21, 50)) return sleep(id);
      if (mod < H(7)) return atHome(id, 'eat');
      if (mod < H(12) || (mod >= H(13) && mod < H(16))) {
        const slot = Math.floor(mod / 45);
        return { place: PEYU_ROUNDS[hash(id, d, slot) % PEYU_ROUNDS.length], act: 'idle', why: 'обикаля селото' };
      }
      if (mod < H(13)) return hash(id, d, 'lunch') % 3 === 0 ? { place: 'inn', act: 'eat', why: 'обяд в хана' } : atHome(id, 'eat');
      if (mod < H(17)) return { place: 'bridge', act: 'idle', why: 'гледа реката' };
      if (mod < H(18)) return { place: 'square', act: 'idle', why: 'на мегдана' };
      return social(id, ctx);
    case 'petko':
      if (mod < H(5, 30) || mod >= H(21, 30)) return sleep(id);
      if (mod < H(6, 30)) return atHome(id, 'eat');
      if (mod < H(9)) return { place: 'sheepfold', act: 'work', why: 'дои овцете' };
      if (mod < H(15)) {
        if (ctx.goatsToday && mod >= H(10) && mod < H(11, 30)) return { place: 'field_ivan', act: 'work', why: 'пасе козите' };
        return hash(id, d, 'graze', mod >= H(12) ? 1 : 0) % 2 === 0
          ? { place: 'forest_edge', act: 'work', why: 'пасе стадото край гората' }
          : { place: 'sheepfold', act: 'work', why: 'пасе стадото' };
      }
      if (mod < H(17, 30)) return { place: 'sheepfold', act: 'work', why: 'прибира стадото' };
      if (mod < H(18, 30)) return atHome(id, 'eat');
      return hash(id, d, 'evening') % 3 === 0 ? social(id, ctx) : atHome(id, 'sit', false);
    case 'ivan':
      // Иван не излиза след мръкване (страх го е от тъмното): прибира се преди 19:00.
      if (mod < H(6) || mod >= H(21)) return sleep(id);
      if (mod < H(7)) return atHome(id, 'eat');
      if (mod < H(12)) return { place: 'smithy', act: 'work', why: 'кове' };
      if (mod < H(13)) return { place: 'inn', act: 'eat', why: 'обяд в хана' };
      if (mod < H(17, 30)) return { place: 'smithy', act: 'work', why: 'кове' };
      if (mod < H(18, 40)) return social(id, ctx);
      return atHome(id, 'sit', true);
    case 'maria':
      if (mod < H(6, 30) || mod >= H(21, 50)) return sleep(id);
      if (mod < H(7, 30)) return atHome(id, 'eat');
      if (mod < H(12)) return { place: 'loom_maria', act: 'work', why: 'тъче' };
      if (mod < H(13)) return atHome(id, 'eat');
      if (mod < H(16)) return { place: 'loom_maria', act: 'work', why: 'тъче' };
      if (mod < H(17, 40)) {
        const k = hash(id, d, 'gaze') % 4;
        if (k === 0) return { place: 'south_road', act: 'idle', why: 'гледа пътя на юг' };
        if (k === 1) return { place: 'gate', act: 'idle', why: 'гледа към света' };
        if (k === 2) return { place: 'well', act: 'work', why: 'носи вода' };
        return { place: 'loom_maria', act: 'work', why: 'тъче' };
      }
      if (mod < H(18)) return atHome(id, 'sit', false);
      return social(id, ctx);
    case 'radka':
      if (mod < H(5, 30) || mod >= H(23)) return sleep(id);
      if (mod < H(6)) return { place: 'coop', act: 'work', why: 'храни кокошките' };
      if (mod >= H(12, 30) && mod < H(13)) return { place: 'inn', act: 'eat', why: 'обядва' };
      if (mod >= H(22, 30)) return atHome(id, 'sit', true);
      return { place: 'inn', act: 'work', why: 'държи хана' };
    case 'kalin':
      if (mod < H(6) || mod >= H(22)) return sleep(id);
      if (mod < H(7)) return atHome(id, 'eat');
      if (mod < H(12)) return { place: 'workshop_kalin', act: 'work', why: 'дяла' };
      if (mod < H(13)) return atHome(id, 'eat');
      if (mod < H(18)) return { place: 'workshop_kalin', act: 'work', why: 'дяла' };
      if (mod < H(21)) return hash(id, d, 'evening') % 3 === 0 ? { place: 'house_gena', act: 'sit', why: 'при баба Гена' } : social(id, ctx);
      return { place: 'workshop_kalin', act: 'work', why: 'работи нещо тайно' };
  }
}

const idx = (id: VillagerId) => VILLAGER_IDS.indexOf(id);
const front = (pl: PlaceId) => { const f = PLACES[pl].facing ?? 0; return { x: Math.sin(f), z: Math.cos(f) }; };

/** Точно място за стоене на даден жител (различно за всеки, за да не стоят един в друг). */
export function spotFor(place: PlaceId, id: VillagerId, inside = false): Vec2 {
  const pl = PLACES[place];
  const i = idx(id);
  if (inside) return { x: pl.pos.x, z: pl.pos.z };
  if (place === 'square' || place === 'walnut') {
    const r = place === 'walnut' ? 3.2 : 4.6;
    const a = (i / VILLAGER_IDS.length) * Math.PI * 2 + 0.35;
    return { x: pl.pos.x + Math.sin(a) * r, z: pl.pos.z + Math.cos(a) * r };
  }
  if (pl.facing !== undefined) {
    const f = front(place); const lat = { x: f.z, z: -f.x };
    const out = place === 'loom_maria' ? 1.2 : pl.radius + 1.6;
    const side = (i - 3) * (place === 'inn' ? 1.9 : 1.4);
    return { x: pl.pos.x + f.x * out + lat.x * side, z: pl.pos.z + f.z * out + lat.z * side };
  }
  // открити места: разпръснати в кръг
  const a = i * 2.4 + 0.5, r = Math.min(pl.radius * 0.55, 6);
  return { x: pl.pos.x + Math.sin(a) * r, z: pl.pos.z + Math.cos(a) * r };
}

/** Позиция в хорото около ореха (въртим се бавно). */
export function horoSpot(id: VillagerId, time: number): { pos: Vec2; facing: number } {
  const c = PLACES.walnut.pos, r = 7;
  const a = (idx(id) / VILLAGER_IDS.length) * Math.PI * 2 + time * 0.15;
  const pos = { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
  return { pos, facing: Math.atan2(c.x - pos.x, c.z - pos.z) };
}

/** Позиция на мегдана за гласуване/събрание. */
export function gatherSpot(id: VillagerId): Vec2 {
  const c = PLACES.walnut.pos, a = (idx(id) / VILLAGER_IDS.length) * Math.PI * 2;
  return { x: c.x + Math.sin(a) * 6, z: c.z + Math.cos(a) * 6 };
}
