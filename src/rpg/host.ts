// Какво дава играта (Game) на RPG частта и на задачите — връзка към живото село, света и интерфейса.
import type { VillagerId } from '../data/villagers';
import type { ChronicleType, InjectedEvent, PlayerDeed } from '../sim/types';

export interface QuestHost {
  /** Известие в ъгъла на екрана. */
  notify(text: string, kind?: 'quest' | 'item' | 'info' | 'warn' | 'level'): void;
  /** Какво мисли жителят за дадена тема (за „Кой краде кокошките?“ — от клюките в селото). */
  clue(villager: VillagerId, topic: 'chickens' | 'goats' | 'lamia'): string;
  /** Делото на играча → спомени и отношения в селото. */
  deed(d: PlayerDeed): void;
  /** Запис в летописа. */
  chronicle(text: string, participants: string[], importance: number, type?: ChronicleType): void;
  /** Промяна на отношенията между двама жители. */
  relation(a: VillagerId, b: VillagerId, dAffinity: number, dTrust: number): void;
  /** Флагове на света (влизат в записите): 'lamia_dead', 'river_flowing', 'fox_caught', … */
  getFlag(key: string): number | string | boolean | undefined;
  setFlag(key: string, value: number | string | boolean): void;
  /** Общо игрови минути. */
  time(): number;
  /** Реката тръгва (след Ламята). */
  riverFlow(on: boolean): void;
  /** Сборът (празник на мегдана). */
  festival(on: boolean): void;
  /** Случка в селото. */
  inject(ev: InjectedEvent): void;
  /** Името на жител („баба Гена“). */
  villagerName(id: VillagerId): string;
  /** Звук. */
  sfx(name: string): void;
}
