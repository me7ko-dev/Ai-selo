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
  // ── добавено от симулацията (по желание за външни модули) ──
  /** Точката, към която върви в момента (крайната точка на path). */
  goal?: Vec2;
  /** Вътре в сграда (спи / яде у дома) — светът може да го скрие. */
  indoors?: boolean;
  /** Доколко вярва на всеки слух, който знае: id на слух → −1..1. */
  rumorBelief?: Record<string, number>;
  /** Зает (в разговор) до този момент. */
  busyUntil?: number;
}

/** Реплика на опашката (балончетата в разговор се показват една след друга). */
export interface QueuedLine { at: number; id: VillagerId; text: string; to?: string; dur: number; ai?: boolean }

export interface Rumor {
  id: number;
  topic: string;                  // 'chickens', 'love', 'debt', 'goats', 'stranger', 'lamia'…
  text: string;                   // „Казват, че Петко краде кокошките.“
  about: string[];
  truth: boolean;                 // вярно ли е
  origin: string;                 // кой го е пуснал
  time: number;
  /** Вид слух (за подсказките): 'petko_thief', 'fox', 'goats', 'debt', 'love', 'lamia', 'samodivi', 'theft', 'stranger'… */
  tag?: string;
  /** −1 (лошо за тези, за които се говори) .. 1 (хубаво). */
  sentiment?: number;
  /** От кой слух е изкривен. */
  parent?: number;
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
  /** Подвид на случката (за заглавия/икони): 'goats_quarrel', 'chicken_theft', 'new_mayor', 'confession', 'storm', 'karakondzhul', 'samodivi', 'sabor'… */
  tag?: string;
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
  // ── добавено от симулацията (попълва се автоматично при load/new) ──
  queue?: QueuedLine[];           // предстоящи реплики (балончета)
  pairCd?: Record<string, number>; // кога двама жители може пак да си говорят
  counters?: Record<string, number>; // броячи за деня (за да не се пълни летописът)
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

/** Записи на света (машината на времето). Самото съдържание (state) е целият GameState — за симулацията е непрозрачно. */
export interface SnapshotMeta {
  id: string;
  branchId: string;
  time: number;                   // игрови минути
  kind: 'hour' | 'day' | 'manual' | 'auto';
  label: string;                  // „Ден 3 · 14:00“
  realTime: number;               // Date.now() при записа
}
/** Къде се пазят записите (в паметта за проби; IndexedDB в играта — src/save/). */
export interface SnapshotStore {
  put(meta: SnapshotMeta, state: unknown): Promise<void>;
  get(id: string): Promise<{ meta: SnapshotMeta; state: unknown } | undefined>;
  delete(id: string): Promise<void>;
  list(): Promise<SnapshotMeta[]>;
}
/** Клон на историята. */
export interface Branch {
  id: string;
  parentId: string | null;
  forkTime: number;               // от кой игрови момент е разклонен
  forkEntryId: number;            // последният запис в летописа от родителя, който важи за този клон
  createdAt: number;              // Date.now()
  label: string;                  // „Основна история“, „Клон 2 (от Ден 3 · 14:00)“
}
