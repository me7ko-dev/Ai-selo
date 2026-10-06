// Транспорт към Genesis — ИИ мостът на автора (`genesis api` в терминал → http://127.0.0.1:8770).
// Само текст, OpenAI-съвместим: GET /v1/health, POST /v1/chat/completions. Зад него Genesis сам избира безплатен
// облачен модел и сменя на друг, когато квотата свърши. Облачните модели не винаги спазват JSON схема,
// затова формата на отговора е и в самата подкана, а отговорът се чете снизходително (parseJsonObject).
import { DEFAULT_GENESIS_URL } from './Brain';
import { HttpError, fetchWithTimeout, trimUrl, type AiLimits, type Transport } from './net';
import { withJsonShape } from './prompt';

const HEALTH_TIMEOUT_MS = 3_000;
/** Таван на дължината на отговора (най-дългият е преразказът за „Докато те нямаше…“). */
const MAX_TOKENS = 700;

/**
 * Genesis ползва безплатни облачни квоти — пестим ги. Разговорът с играча винаги е с ИИ;
 * жителите помежду си — само близо до играча (VillageSim) и не по-често от веднъж на chatGapMs;
 * реакциите на случки — не по-често от веднъж на reactGapMs. Иначе — по сценарий.
 */
export const GENESIS_LIMITS: AiLimits = { chatGapMs: 25_000, reactGapMs: 15_000 };

/** „http://127.0.0.1:8770“ → „127.0.0.1:8770“ */
function hostPort(url: string): string { return url.replace(/^https?:\/\//i, ''); }

export const GENESIS_REASONS = {
  https: 'Версията в браузъра (GitHub Pages) не може да стигне до Genesis на твоя компютър — браузърът не позволява. Свали Windows версията и пусни в терминал: genesis api',
  down: (url: string) => `Genesis не отговаря на ${hostPort(url)}. Пусни в терминал: genesis api`,
  notGenesis: (url: string) => `На ${hostPort(url)} отговаря друга програма, не Genesis. Провери адреса или пусни в терминал: genesis api`,
  notReady: 'Genesis работи, но още не е готов (няма свободен модел). Жителите говорят по сценарий — опитвам пак след малко.',
  failing: (status: number) => `Genesis връща грешка (HTTP ${status}) — може би безплатните модели са изчерпани за момента. Жителите говорят по сценарий — опитвам пак след малко.`,
};

/** „openrouter/meta-llama/llama-3.3-70b-instruct:free“ → „openrouter/llama-3.3-70b-instruct…“ (за HUD). */
export function shortModel(model: string): string {
  const parts = model.trim().split('/').filter(Boolean);
  let s = parts.length > 2 ? `${parts[0]}/${parts[parts.length - 1]}` : parts.join('/');
  s = s.replace(/:free$/i, '');
  // „ИИ: няма връзка — жителите говорят по сценарий“ е 46 знака — надписът с Genesis да не е по-дълъг в HUD
  return s.length > 34 ? `${s.slice(0, 33)}…` : s;
}

/** „ИИ: Genesis (groq/llama-3.1-8b-instant)“; преди първия отговор моделът не се знае. */
export function genesisLabel(model?: string): string {
  const m = model ? shortModel(model) : '';
  return m ? `ИИ: Genesis (${m})` : 'ИИ: Genesis (свързан)';
}

/** Някои облачни модели „мислят на глас“ в <think>…</think> — махаме го преди да търсим JSON. */
export function stripThinking(t: string): string {
  return t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
}

/** Съобщението от {"error":{"message"}} (ако има). */
function errorMessage(text: string): string | undefined {
  try {
    const e = (JSON.parse(text) as { error?: { message?: unknown } })?.error?.message;
    return typeof e === 'string' ? e : undefined;
  } catch { return undefined; }
}

export const GENESIS: Transport = {
  provider: 'genesis',
  limits: GENESIS_LIMITS,
  url: (s) => trimUrl(s.genesisUrl, DEFAULT_GENESIS_URL),
  label: (_s, lastModel) => genesisLabel(lastModel),
  model: (_s, lastModel) => lastModel || 'Genesis',
  reasons: { https: GENESIS_REASONS.https, down: GENESIS_REASONS.down, failing: GENESIS_REASONS.failing },

  /** GET /v1/health → {"app":"genesis","api":1,"ok":true} */
  async probe(s) {
    const url = GENESIS.url(s);
    let data: { app?: unknown; ok?: unknown };
    try {
      const res = await fetchWithTimeout(`${url}/v1/health`, { method: 'GET' }, HEALTH_TIMEOUT_MS);
      const text = await res.text();
      try { data = JSON.parse(text) as typeof data; } catch { data = {}; }
      if (!res.ok && data?.app !== 'genesis') return { ok: false, reason: GENESIS_REASONS.notGenesis(url) };
    } catch {
      return { ok: false, reason: GENESIS_REASONS.down(url) };
    }
    if (!data || data.app !== 'genesis') return { ok: false, reason: GENESIS_REASONS.notGenesis(url) };
    if (data.ok !== true) return { ok: false, reason: GENESIS_REASONS.notReady };
    return { ok: true };
  },

  /** POST /v1/chat/completions (OpenAI-съвместимо), с response_format json_object и формата в подканата. */
  async ask(s, prompt, timeoutMs) {
    const p = withJsonShape(prompt);
    const body = {
      messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
      temperature: 0.8,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
    };
    const res = await fetchWithTimeout(`${GENESIS.url(s)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, errorMessage(text) ?? `HTTP ${res.status}`);
    let data: { model?: unknown; choices?: { message?: { content?: unknown } }[] };
    try { data = JSON.parse(text) as typeof data; } catch { throw new Error('bad response'); }
    const content = data?.choices?.[0]?.message?.content;
    return {
      content: typeof content === 'string' ? stripThinking(content) : '',
      model: typeof data?.model === 'string' && data.model.trim() ? data.model.trim().slice(0, 120) : undefined,
    };
  },
};
