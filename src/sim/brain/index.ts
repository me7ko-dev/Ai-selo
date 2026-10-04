// Входна точка на мозъка: мозък по сценарий + (по желание) локален ИИ през Ollama.
import type { AiSettings, Brain, BrainStatus } from './Brain';
import { DEFAULT_AI } from './Brain';
import { OllamaBrain } from './OllamaBrain';
import { ScriptedBrain } from './ScriptedBrain';

export * from './Brain';
export { ScriptedBrain, TALK_OPTION_IDS, SCRIPTED_LABEL } from './ScriptedBrain';
export { OllamaBrain, REASONS, connectedLabel } from './OllamaBrain';
export { dialogueOptions } from './options';
export type { OptionsRequest } from './options';
export { BrainQueue, PRIORITY } from './queue';

export interface BrainHandle {
  /** Мозъкът, който играта ползва (ИИ с резерв или само сценарий). */
  brain: Brain;
  /** Винаги наличен, синхронен, детерминиран (за симулацията). */
  scripted: ScriptedBrain;
  ollama: OllamaBrain | null;
  connect(): Promise<BrainStatus>;
  setSettings(s: AiSettings): void;
  onStatus(cb: (s: BrainStatus) => void): () => void;
}

/**
 * Създава мозъка. OllamaBrain винаги се създава (за да може ИИ да се включи по-късно от настройките),
 * но при enabled:false не прави никакви заявки и просто връща отговорите по сценарий;
 * статусът тогава казва „ИИ е изключен от настройките.“.
 */
export function createBrain(settings: AiSettings = DEFAULT_AI): BrainHandle {
  const scripted = new ScriptedBrain();
  const ollama = new OllamaBrain({ ...DEFAULT_AI, ...settings }, scripted);
  return {
    brain: ollama,
    scripted,
    ollama,
    connect: () => ollama.connect(),
    setSettings: (s: AiSettings) => ollama.setSettings(s),
    onStatus: (cb) => ollama.onStatus(cb),
  };
}
