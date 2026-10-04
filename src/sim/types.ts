// Договор за ЖИВОТО СЕЛО (чиста логика — без three.js и без браузъра).
// Агентът „село“ може да ДОБАВЯ полета, но не маха и не преименува съществуващите.
import type { VillagerId } from '../data/villagers';
import type { PlaceId, Vec2 } from '../data/layout';

export type Activity =
  | 'sleep' | 'walk' | 'work' | 'eat' | 'talk' | 'idle' | 'gossip' | 'argue' | 'dance' | 'flee' | 'sit' | 'vote' | 'mourn' | 'celebrate';

export interface Relation { affinity: number; trust: number }   // -100..100

export interface Memory {
  id: number;
  time: number;          // общо игрови минути
  text: string;          // на български, от първо лице или кратко описание
  importance: number;    // 1..10
  about: string[];       // id на жители, 'player', теми ('chickens', 'river', 'lamia'…)
  kind: 'event' | 'talk' | 'rumor' | 'belief' | 'player' | 'plan';
}

export interface Needs { hunger: number; energy: number; social: number; fun: number } // 0..100 (100 = добре)

export interface Speech { text: string; until: number; to?: string; ai?: boolean }

export interface VillagerState {
  id: VillagerId;
  pos: Vec2;
  facing: number;                 // rotation.y
  activity: Activity;
  place: PlaceId | null;          // къде е (ако е стигнал)
  target: PlaceId | null;         // накъде върви
  path: Vec2[];                   // оставащи точки по пътя
  needs: Needs;
  mood: string;                   // „весела“, „ядосан“…
  moodValue: number;              // -100..100
  relations: Record<string, Relation>; // ключове: id на жители + 'player'
  memories: Memory[];
  beliefs: string[];              // ≤ 5 убеждения (от вечерния размисъл)
  knownRumors: number[];
  speech: Speech | null;          // балонче над главата
  talkingWith: string | null;     // id на жител или 'player'
  plan: string;                   // какво смята да прави днес (кратко)
  flags: Record<string, number | string | boolean>;
}

export interface Rumor {
  id: number;
  topic: string;                  // 'chickens', 'love', 'debt', 'goats', 'stranger', 'lamia'…
  text: string;                   // „Казват, че Петко краде кокошките.“
  about: string[];
  truth: boolean;                 // вярно ли е
  origin: string;                 // кой го е пуснал
  time: number;
}

export type ChronicleType =
  | 'talk' | 'quarrel' | 'love' | 'theft' | 'rumor' | 'election' | 'work' | 'festival' | 'monster'
  | 'player' | 'quest' | 'weather' | 'live' | 'reflection' | 'mood' | 'system';

export interface ChronicleEntry {
  id: number;
  time: number;                   // общо игрови минути (ден = dayOf(time))
  type: ChronicleType;
  participants: string[];
  text: string;                   // на български, готово за летописа
  branchId: string;
  importance: number;             // 1..10 (за „Докато те нямаше…“ и точките на машината на времето)
  ai?: boolean;                   // текстът е от ИИ (при гледане назад се преиграва записаното)
}

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

/** Целият state на селото — JSON, влиза в записите на света. */
export interface WorldState {
  v: 1;
  seed: number;
  rng: number;                    // състоянието на Rng
  time: number;                   // общо игрови минути от началото (започва от Ден 1, 06:30)
  villagers: VillagerState[];
  rumors: Rumor[];
  mayor: VillagerId;
  nextElectionDay: number;        // избори на всеки 10 игрови дни
  weather: Weather;
  flags: Record<string, number | string | boolean>; // 'lamia_dead', 'river_flowing', 'sabor', 'fox_caught'…
  branchId: string;
  nextId: number;                 // за id на спомени/слухове/записи в летописа
}

/** Случки отвън (лайв режим, задачи, играчът). */
export type InjectedEvent =
  | { type: 'storm'; by?: string }
  | { type: 'karakondzhul'; by?: string }
  | { type: 'samodivi'; by?: string }
  | { type: 'sabor'; by?: string }
  | { type: 'theft'; by?: string }
  | { type: 'custom'; text: string; participants?: string[]; importance?: number; chronicleType?: ChronicleType };

/** Какво е направил играчът (за спомени и отношения). */
export interface PlayerDeed {
  kind: 'helped' | 'gift' | 'quest_done' | 'killed_monster' | 'insulted' | 'stole' | 'saved_village' | 'talked';
  villager?: VillagerId;          // към кого (ако е към някого)
  text: string;                   // „Странникът донесе три стръка росен на баба Гена.“
  importance: number;             // 1..10
  affinity?: number;              // промяна в отношението (към player)
  trust?: number;
  witnesses?: VillagerId[] | 'all';
}

export interface DialogueOption { id: string; text: string }

export interface DialogueReply {
  say: string;
  mood?: string;
  ai: boolean;
  options: DialogueOption[];      // следващите готови отговори (до 3)
  end?: boolean;                  // разговорът приключва
}

export interface SimEvents extends Record<string, unknown> {
  chronicle: ChronicleEntry;                         // нов запис в летописа
  say: { id: VillagerId; text: string; to?: string; ai?: boolean }; // балонче
  hour: { time: number };
  day: { day: number };
  election: { mayor: VillagerId; votes: Record<string, number> };
  ai: { connected: boolean; label: string };
}
