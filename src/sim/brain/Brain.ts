// Договор за „мозъка“ на жителите. Две реализации: ScriptedBrain (без ИИ, винаги работи, детерминиран по seed)
// и AiBrain (ИИ през Ollama или Genesis; при грешка/изтичане → ScriptedBrain за тази заявка).
import type { Memory, Relation } from '../types';

export interface BrainStatus {
  connected: boolean;
  model: string;
  /** „ИИ: свързан (qwen3.5:4b)“ / „ИИ: няма връзка — жителите говорят по сценарий“ */
  label: string;
  /** Защо няма връзка (за настройките), напр. „Версията в браузъра не може да стигне до Ollama…“ */
  reason?: string;
  busy: boolean;
  queue: number;
}

/** Кой говори (кратко описание за подканата). */
export interface Persona {
  id: string;
  name: string;
  job: string;
  card: string;          // карта на характера (≤120 думи)
  speech: string;        // как говори
  mood: string;
  beliefs: string[];
  secret?: string;       // само за ScriptedBrain/ИИ — да не я издава лесно
}

export interface Partner {
  id: string;            // id на жител или 'player'
  name: string;
  isPlayer: boolean;
  relation?: Relation;   // как говорещият гледа на него
}

/** Разговор с играча (приоритет 0 — най-висок). */
export interface TalkRequest {
  speaker: Persona;
  partner: Partner;
  situation: string;     // „Ден 3, 14:20, на мегдана. Слънчево. Реката е суха.“
  memories: Memory[];    // до 8 най-подходящи
  history: { who: string; text: string }[]; // последните реплики в този разговор
  input: string;         // какво каза играчът (избран отговор или свободен текст)
  optionId?: string;     // ако е избран готов отговор — неговото id
  seed: number;
}

export interface BrainReply {
  say: string;           // репликата (1–3 изречения)
  action?: string;       // по желание: 'none' | 'give_quest' | 'walk_away' | 'trade' | …
  mood?: string;         // ново настроение
  remember?: string;     // какво да запомни (от първо лице)
  ai: boolean;
}

/** Двама жители си говорят (приоритет 1). */
export interface ChatRequest {
  a: Persona; b: Persona;
  topic: string;         // 'weather' | 'river' | 'gossip' | 'love' | 'quarrel' | 'work' | 'stranger' | …
  situation: string;
  memoriesA: Memory[]; memoriesB: Memory[];
  relationAB: Relation; relationBA: Relation;
  rumor?: string;        // ако си предават слух
  seed: number;
}
export interface ChatReply {
  lines: { who: string; text: string }[]; // 2–4 реплики, who = id
  summary: string;       // едно изречение за летописа: „Иван и Мария си говориха за звездите.“
  affinityDelta?: number; // как се промени отношението (−10..10)
  ai: boolean;
}

/** Реакция на случка (приоритет 1). */
export interface ReactRequest { speaker: Persona; event: string; memories: Memory[]; situation: string; seed: number }

/** План за деня (приоритет 2). */
export interface PlanRequest { speaker: Persona; situation: string; memories: Memory[]; seed: number }
export interface PlanReply { plan: string; ai: boolean }

/** Вечерен размисъл: свива спомените до ≤5 убеждения (приоритет 3). */
export interface ReflectRequest { speaker: Persona; memories: Memory[]; beliefs: string[]; seed: number }
export interface ReflectReply { beliefs: string[]; ai: boolean }

/** „Докато те нямаше…“: ИИ преразказва най-важните случки като в книжка с приказки (приоритет 0 — играчът чака). */
export interface RetellRequest {
  events: { title: string; text: string; time: number; participants: string[] }[];
  situation: string;     // „Сега е Ден 4, 08:10. Ясно време. Реката Бистрица е пресъхнала.“
  seed: number;
}
/** texts[i] е новият разказ за events[i] или null (тогава остава текстът по сценарий). */
export interface RetellReply { texts: (string | null)[]; ai: boolean }

export interface Brain {
  status(): BrainStatus;
  talk(req: TalkRequest): Promise<BrainReply>;
  chat(req: ChatRequest): Promise<ChatReply>;
  react(req: ReactRequest): Promise<BrainReply>;
  plan(req: PlanRequest): Promise<PlanReply>;
  reflect(req: ReflectRequest): Promise<ReflectReply>;
  /** По желание (старите мозъци го нямат): преразказ на случки за „Докато те нямаше…“. */
  retell?(req: RetellRequest): Promise<RetellReply>;
}

/** Синхронни (детерминирани) версии — има ги само ScriptedBrain. Симулацията ги ползва, за да е повторима. */
export interface SyncBrain {
  talkNow(req: TalkRequest): BrainReply;
  chatNow(req: ChatRequest): ChatReply;
  reactNow(req: ReactRequest): BrainReply;
  planNow(req: PlanRequest): PlanReply;
  reflectNow(req: ReflectRequest): ReflectReply;
}

/** Откъде мислят жителите: 'ollama' — локален модел на компютъра; 'genesis' — мостът Genesis (`genesis api`) към безплатни облачни модели. */
export type AiProvider = 'ollama' | 'genesis';
export const AI_PROVIDERS: readonly AiProvider[] = ['ollama', 'genesis'];
export const DEFAULT_GENESIS_URL = 'http://127.0.0.1:8770';

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;  // 'ollama'
  url: string;           // адресът на Ollama: 'http://127.0.0.1:11434'
  model: string;         // моделът в Ollama: 'qwen3.5:4b' (Genesis сам избира модела)
  genesisUrl: string;    // адресът на Genesis: 'http://127.0.0.1:8770'
  timeoutMs: number;     // 20000
}
export const DEFAULT_AI: AiSettings = { enabled: true, provider: 'ollama', url: 'http://127.0.0.1:11434', model: 'qwen3.5:4b', genesisUrl: DEFAULT_GENESIS_URL, timeoutMs: 20000 };
export const MODEL_CHOICES = ['qwen3.5:4b', 'gemma4:e2b', 'qwen3:4b', 'gemma3:4b', 'llama3.2:3b'];
