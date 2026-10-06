// Входна точка на мозъка: мозък по сценарий + (по желание) ИИ през Ollama (локален) или Genesis (мост към облачни модели).
import type { AiSettings, Brain, BrainStatus } from './Brain';
import { DEFAULT_AI } from './Brain';
import { AiBrain } from './AiBrain';
import { ScriptedBrain } from './ScriptedBrain';

export * from './Brain';
export { ScriptedBrain, TALK_OPTION_IDS, SCRIPTED_LABEL } from './ScriptedBrain';
export { AiBrain, OllamaBrain, GenesisBrain } from './AiBrain';
export { REASONS, connectedLabel } from './ollamaApi';
export { GENESIS_REASONS, GENESIS_LIMITS, genesisLabel } from './genesisApi';
export { dialogueOptions } from './options';
export type { OptionsRequest } from './options';
export { BrainQueue, PRIORITY } from './queue';

export interface BrainHandle {
  /** Мозъкът, който играта ползва (ИИ с резерв или само сценарий). */
  brain: Brain;
  /** Винаги наличен, синхронен, детерминиран (за симулацията). */
  scripted: ScriptedBrain;
  /** ИИ мозъкът (Ollama или Genesis — според настройките; видът се сменя в движение). */
  ai: AiBrain;
  connect(): Promise<BrainStatus>;
  setSettings(s: AiSettings): void;
  onStatus(cb: (s: BrainStatus) => void): () => void;
}

/**
 * Създава мозъка. AiBrain винаги се създава (за да може ИИ да се включи по-късно от настройките),
 * но при enabled:false не прави никакви заявки и просто връща отговорите по сценарий;
 * статусът тогава казва „ИИ е изключен от настройките.“.
 */
export function createBrain(settings: AiSettings = DEFAULT_AI): BrainHandle {
  const scripted = new ScriptedBrain();
  const ai = new AiBrain({ ...DEFAULT_AI, ...settings }, scripted);
  return {
    brain: ai,
    scripted,
    ai,
    connect: () => ai.connect(),
    setSettings: (s: AiSettings) => ai.setSettings(s),
    onStatus: (cb) => ai.onStatus(cb),
  };
}
