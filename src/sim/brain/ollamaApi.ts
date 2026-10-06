// Транспорт към локалния Ollama (на компютъра на играча): /api/tags за проверка, /api/chat с JSON схема.
import { DEFAULT_AI } from './Brain';
import { HttpError, fetchWithTimeout, trimUrl, type Transport } from './net';

const TAGS_TIMEOUT_MS = 3_000;

export const REASONS = {
  https: 'Версията в браузъра (GitHub Pages) не може да стигне до Ollama на твоя компютър — браузърът не позволява. Свали Windows версията, за да оживеят жителите.',
  down: (url: string) => `Ollama не отговаря на ${url}. Инсталирай Ollama от ollama.com и го пусни.`,
  model: (model: string) => `Моделът ${model} не е свален. Отвори терминал и напиши: ollama pull ${model}`,
  failing: (status: number) => `Ollama връща грешка (HTTP ${status}). Жителите говорят по сценарий — опитвам пак след малко.`,
  disabled: 'ИИ е изключен от настройките.',
};

export function connectedLabel(model: string): string { return `ИИ: свързан (${model})`; }

function sameModel(installed: string, wanted: string): boolean {
  const strip = (s: string) => s.trim().toLowerCase().replace(/:latest$/, '');
  return strip(installed) === strip(wanted);
}

export const OLLAMA: Transport = {
  provider: 'ollama',
  // локалната видеокарта не струва нищо — без ограничения (освен опашката: една заявка наведнъж)
  limits: { chatGapMs: 0, reactGapMs: 0 },
  url: (s) => trimUrl(s.url, DEFAULT_AI.url),
  label: (s) => connectedLabel(s.model),
  model: (s) => s.model,
  reasons: { https: REASONS.https, down: REASONS.down, failing: REASONS.failing },

  /** Работи ли Ollama и свален ли е моделът. */
  async probe(s) {
    const url = OLLAMA.url(s);
    let names: string[] = [];
    try {
      const res = await fetchWithTimeout(`${url}/api/tags`, { method: 'GET' }, TAGS_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { models?: { name?: string; model?: string }[] };
      names = (data.models ?? []).flatMap((m) => [m.name ?? '', m.model ?? '']).filter(Boolean);
    } catch {
      return { ok: false, reason: REASONS.down(url) };
    }
    if (!names.some((n) => sameModel(n, s.model))) return { ok: false, reason: REASONS.model(s.model) };
    return { ok: true };
  },

  /** Една заявка към /api/chat (JSON схемата отива във „format“). */
  async ask(s, p, timeoutMs) {
    const body = {
      model: s.model,
      messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
      stream: false,
      think: false,
      format: p.format,
      options: { num_ctx: 4096, temperature: 0.8 },
      keep_alive: '30m',
    };
    const res = await fetchWithTimeout(`${OLLAMA.url(s)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!res.ok) throw new HttpError(res.status);
    const data = await res.json() as { message?: { content?: string } };
    return { content: typeof data?.message?.content === 'string' ? data.message.content : '' };
  },
};
