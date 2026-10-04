// Какво влиза в един запис на света (snapshot): селото + героят. За машината на времето и за „Продължи“.
import type { WorldState } from '../sim/types';

export interface GameState {
  v: 1;
  sim: WorldState;
  player: unknown;     // Rpg.serialize()
  realTime: number;    // Date.now() при записа
}

export function cloneJson<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }
