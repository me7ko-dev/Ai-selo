// Общо за връзката с ИИ: „транспорт“ (Ollama или Genesis), заявки с изтичане, препращане в .exe.
import type { AiProvider, AiSettings } from './Brain';
import type { Prompt } from './prompt';

/** Резултат от проверката на връзката. */
export interface ProbeResult { ok: boolean; reason?: string }
/** Суровият отговор на модела: текстът (в него трябва да има JSON) и кой модел го е написал (ако се знае). */
export interface AskResult { content: string; model?: string }

/** Пестене на заявки: най-малко колко милисекунди между две заявки от този вид (0 = без ограничение). */
export interface AiLimits { chatGapMs: number; reactGapMs: number }

/** Как се говори с един вид ИИ. Мозъкът (AiBrain) е общ — опашка, проверки, резерв по сценарий. */
export interface Transport {
  readonly provider: AiProvider;
  readonly limits: AiLimits;
  /** Адресът от настройките (без наклонена черта накрая). */
  url(s: AiSettings): string;
  /** Работи ли (и има ли нужния модел)? Не хвърля. */
  probe(s: AiSettings): Promise<ProbeResult>;
  /** Една заявка. Хвърля при грешка (HttpError, изтичане, няма връзка). */
  ask(s: AiSettings, p: Prompt, timeoutMs: number): Promise<AskResult>;
  /** Надписът при връзка: „ИИ: свързан (qwen3.5:4b)“ / „ИИ: Genesis (groq/llama-3.1-8b)“. */
  label(s: AiSettings, lastModel: string): string;
  /** Името на модела за BrainStatus.model. */
  model(s: AiSettings, lastModel: string): string;
  reasons: {
    https: string;
    down: (url: string) => string;
    /** Няколко грешки подред от сървъра (HTTP 5xx/429). */
    failing: (status: number) => string;
  };
}

/** HTTP отговор с грешка (status ≠ 2xx). */
export class HttpError extends Error {
  constructor(public status: number, message = `HTTP ${status}`) { super(message); this.name = 'HttpError'; }
}

export function trimUrl(u: string, def: string): string { return (u || def).trim().replace(/\/+$/, ''); }

/** Страницата е https, а локалният ИИ — http: браузърът ще блокира заявката. */
export function blockedByHttps(url: string): boolean {
  const proto = (globalThis as { location?: { protocol?: string } }).location?.protocol;
  return proto === 'https:' && /^http:/i.test(url);
}

export function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && ((e as { name?: string }).name === 'AbortError' || (e as { name?: string }).name === 'TimeoutError');
}

/** Портове на локалните програми → пътя във вътрешния сървър на .exe (desktop/main.cjs). */
const DESKTOP_PROXY: Record<string, string> = { '11434': '/__ollama', '8770': '/__genesis' };

/**
 * В Windows версията (.exe) заявките към локалния Ollama (11434) и Genesis (8770) минават през вътрешния
 * сървър на играта (/__ollama, /__genesis) — без CORS грижи и без заглавие Origin.
 */
export function routeUrl(url: string): string {
  const loc = (globalThis as { location?: { search?: string; origin?: string } }).location;
  if (!loc?.search || !/[?&]app=desktop\b/.test(loc.search) || !loc.origin) return url;
  const m = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d+)(\/.*)?$/i.exec(url);
  const via = m ? DESKTOP_PROXY[m[1]] : undefined;
  return m && via ? `${loc.origin}${via}${m[2] ?? ''}` : url;
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  url = routeUrl(url);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    // тялото също трябва да дойде навреме — четем го тук, докато таймерът още тече
    const text = await res.text();
    return new Response(text, { status: res.status, headers: res.headers });
  } finally {
    clearTimeout(t);
  }
}
