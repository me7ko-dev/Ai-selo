// Настройки на играча (localStorage). Зареждането търпи боклук и стари версии — сливане със стойностите по подразбиране.
import { DEFAULT_AI, type AiSettings } from '../sim/brain/Brain';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface Settings {
  ai: AiSettings;
  graphics: { quality: GraphicsQuality; shadows: boolean; pixelRatioCap: number };
  audio: { master: number; music: number; sfx: number };       // 0..1
  controls: { sensitivity: number; invertY: boolean };          // sensitivity 0.1..3
  live: { channel: string; voteSeconds: number };
}

export const SETTINGS_KEY = 'balkanski-legendi:settings';

export const DEFAULT_SETTINGS: Settings = {
  ai: { ...DEFAULT_AI },
  graphics: { quality: 'high', shadows: true, pixelRatioCap: 1.5 },
  audio: { master: 0.8, music: 0.6, sfx: 0.8 },
  controls: { sensitivity: 1, invertY: false },
  live: { channel: '', voteSeconds: 30 },
};

function storage(): Storage | undefined {
  try { return (globalThis as { localStorage?: Storage }).localStorage; } catch { return undefined; }
}

const num = (v: unknown, def: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const str = (v: unknown, def: string, maxLen = 200) => (typeof v === 'string' ? v.slice(0, maxLen) : def);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Слива частични/повредени данни със стойностите по подразбиране. */
export function mergeSettings(raw: unknown): Settings {
  const r = obj(raw);
  const d = DEFAULT_SETTINGS;
  const ai = obj(r.ai), g = obj(r.graphics), a = obj(r.audio), c = obj(r.controls), l = obj(r.live);
  const q = g.quality;
  return {
    ai: {
      enabled: bool(ai.enabled, d.ai.enabled),
      url: str(ai.url, d.ai.url) || d.ai.url,
      model: str(ai.model, d.ai.model) || d.ai.model,
      timeoutMs: num(ai.timeoutMs, d.ai.timeoutMs, 1000, 600000),
    },
    graphics: {
      quality: q === 'low' || q === 'medium' || q === 'high' ? q : d.graphics.quality,
      shadows: bool(g.shadows, d.graphics.shadows),
      pixelRatioCap: num(g.pixelRatioCap, d.graphics.pixelRatioCap, 0.5, 3),
    },
    audio: {
      master: num(a.master, d.audio.master, 0, 1),
      music: num(a.music, d.audio.music, 0, 1),
      sfx: num(a.sfx, d.audio.sfx, 0, 1),
    },
    controls: {
      sensitivity: num(c.sensitivity, d.controls.sensitivity, 0.1, 3),
      invertY: bool(c.invertY, d.controls.invertY),
    },
    live: {
      channel: str(l.channel, d.live.channel, 60).trim().replace(/^#/, ''),
      voteSeconds: Math.round(num(l.voteSeconds, d.live.voteSeconds, 5, 300)),
    },
  };
}

/** Телефон/таблет: по-лека графика, докато играчът сам не избере друга. */
export const TOUCH_GRAPHICS: Settings['graphics'] = { quality: 'low', shadows: true, pixelRatioCap: 1 };

/** Слива и попълва стойностите по подразбиране за телефон (само това, което играчът не е запазил). */
export function mergeSettingsFor(raw: unknown, opts: { touch?: boolean } = {}): Settings {
  if (!opts.touch) return mergeSettings(raw);
  const r = obj(raw), g = obj(r.graphics);
  return mergeSettings({ ...r, graphics: { ...TOUCH_GRAPHICS, ...g } });
}

export function loadSettings(opts: { touch?: boolean } = {}): Settings {
  try {
    const s = storage()?.getItem(SETTINGS_KEY);
    if (!s) return mergeSettingsFor({}, opts);
    return mergeSettingsFor(JSON.parse(s), opts);
  } catch {
    return mergeSettingsFor({}, opts);
  }
}

export function saveSettings(s: Settings): void {
  try { storage()?.setItem(SETTINGS_KEY, JSON.stringify(mergeSettings(s))); } catch { /* пълно/блокирано хранилище — пропускаме */ }
}
