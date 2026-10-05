// Локален ИИ през Ollama (на компютъра на играча). Една заявка наведнъж, с приоритети.
// При КАКВАТО И ДА Е грешка (няма връзка, изтичане, лош JSON, английски, изтичане „като ИИ…“)
// се връща отговорът на мозъка по сценарий за същата заявка (ai: false).
import type {
  AiSettings, Brain, BrainReply, BrainStatus, ChatReply, ChatRequest, PlanReply, PlanRequest, ReactRequest, ReflectReply,
  ReflectRequest, RetellReply, RetellRequest, TalkRequest,
} from './Brain';
import { DEFAULT_AI } from './Brain';
import { BrainQueue, PRIORITY } from './queue';
import { chatPrompt, planPrompt, reactPrompt, reflectPrompt, retellPrompt, talkPrompt, type Prompt } from './prompt';
import type { ScriptedBrain } from './ScriptedBrain';
import { SCRIPTED_LABEL } from './ScriptedBrain';
import { cleanLine, cleanMood, parseJsonObject } from './validate';

export const RECONNECT_MS = 30_000;
const TAGS_TIMEOUT_MS = 3_000;

export const REASONS = {
  https: 'Версията в браузъра (GitHub Pages) не може да стигне до Ollama на твоя компютър — браузърът не позволява. Свали Windows версията, за да оживеят жителите.',
  down: (url: string) => `Ollama не отговаря на ${url}. Инсталирай Ollama от ollama.com и го пусни.`,
  model: (model: string) => `Моделът ${model} не е свален. Отвори терминал и напиши: ollama pull ${model}`,
  disabled: 'ИИ е изключен от настройките.',
};

export function connectedLabel(model: string): string { return `ИИ: свързан (${model})`; }

function trimUrl(u: string): string { return (u || DEFAULT_AI.url).trim().replace(/\/+$/, ''); }

/** Страницата е https, а Ollama — http: браузърът ще блокира заявката. */
export function blockedByHttps(url: string): boolean {
  const proto = (globalThis as { location?: { protocol?: string } }).location?.protocol;
  return proto === 'https:' && /^http:/i.test(url);
}

function sameModel(installed: string, wanted: string): boolean {
  const strip = (s: string) => s.trim().toLowerCase().replace(/:latest$/, '');
  return strip(installed) === strip(wanted);
}

type TimerHandle = ReturnType<typeof setTimeout>;

export class OllamaBrain implements Brain {
  private settings: AiSettings;
  private connected = false;
  private reason: string | undefined;
  private queue = new BrainQueue(6);
  private listeners = new Set<(s: BrainStatus) => void>();
  private timer: TimerHandle | null = null;
  private connecting: Promise<BrainStatus> | null = null;
  private disposed = false;

  constructor(settings: AiSettings, private fallback: ScriptedBrain) {
    this.settings = { ...DEFAULT_AI, ...settings };
    if (!this.settings.enabled) this.reason = REASONS.disabled;
    this.queue.onChange = () => this.emit();
  }

  status(): BrainStatus {
    const model = this.settings.model;
    return {
      connected: this.connected,
      model,
      label: this.connected ? connectedLabel(model) : SCRIPTED_LABEL,
      reason: this.connected ? undefined : this.reason,
      busy: this.queue.busy,
      queue: this.queue.length,
    };
  }

  onStatus(cb: (s: BrainStatus) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  getSettings(): AiSettings { return { ...this.settings }; }

  setSettings(s: AiSettings): void {
    const prev = this.settings;
    this.settings = { ...DEFAULT_AI, ...s };
    const changed = prev.enabled !== this.settings.enabled || trimUrl(prev.url) !== trimUrl(this.settings.url) || prev.model !== this.settings.model;
    if (!changed) { this.emit(); return; }
    this.connected = false;
    this.stopTimer();
    if (!this.settings.enabled) {
      this.reason = REASONS.disabled;
      this.queue.clear();
      this.emit();
      return;
    }
    this.emit();
    void this.connect();
  }

  /** Проверява дали Ollama работи и дали моделът е свален. */
  connect(): Promise<BrainStatus> {
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async doConnect(): Promise<BrainStatus> {
    this.stopTimer();
    const { enabled, model } = this.settings;
    const url = trimUrl(this.settings.url);
    if (!enabled) { this.setState(false, REASONS.disabled); return this.status(); }
    if (blockedByHttps(url)) { this.setState(false, REASONS.https); return this.status(); }
    let names: string[] = [];
    try {
      const res = await fetchWithTimeout(`${url}/api/tags`, { method: 'GET' }, TAGS_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { models?: { name?: string; model?: string }[] };
      names = (data.models ?? []).flatMap((m) => [m.name ?? '', m.model ?? '']).filter(Boolean);
    } catch {
      this.setState(false, REASONS.down(url));
      this.scheduleReconnect();
      return this.status();
    }
    if (!names.some((n) => sameModel(n, model))) {
      this.setState(false, REASONS.model(model));
      this.scheduleReconnect();
      return this.status();
    }
    this.setState(true, undefined);
    return this.status();
  }

  /** Спира повторните опити (при затваряне на играта / в пробите). */
  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.queue.clear();
    this.listeners.clear();
  }

  private setState(connected: boolean, reason: string | undefined): void {
    this.connected = connected;
    this.reason = reason;
    this.emit();
  }

  private emit(): void {
    const s = this.status();
    for (const cb of [...this.listeners]) { try { cb(s); } catch { /* слушателят не бива да чупи мозъка */ } }
  }

  private stopTimer(): void { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }

  private scheduleReconnect(): void {
    if (this.disposed || !this.settings.enabled || this.connected) return;
    if (blockedByHttps(trimUrl(this.settings.url))) return;
    this.stopTimer();
    const t = setTimeout(() => { this.timer = null; void this.connect(); }, RECONNECT_MS);
    (t as unknown as { unref?: () => void }).unref?.();
    this.timer = t;
  }

  /** Една заявка към /api/chat. Връща JSON обекта от отговора или хвърля. */
  private async ask(p: Prompt): Promise<Record<string, unknown>> {
    const url = trimUrl(this.settings.url);
    const body = {
      model: this.settings.model,
      messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
      stream: false,
      think: false,
      format: p.format,
      options: { num_ctx: 4096, temperature: 0.8 },
      keep_alive: '30m',
    };
    let res: Response;
    try {
      res = await fetchWithTimeout(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, this.settings.timeoutMs > 0 ? this.settings.timeoutMs : DEFAULT_AI.timeoutMs);
    } catch (e) {
      if (!isAbort(e)) {
        // връзката падна — към сценария, и опитваме пак след малко
        this.setState(false, REASONS.down(url));
        this.scheduleReconnect();
      }
      throw e;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { message?: { content?: string } };
    const obj = parseJsonObject(data?.message?.content);
    if (!obj) throw new Error('bad json');
    return obj;
  }

  private run<T>(priority: number, build: () => Prompt, parse: (o: Record<string, unknown>) => T | null, fallback: () => T): Promise<T> {
    if (!this.settings.enabled || !this.connected) return Promise.resolve(fallback());
    return this.queue.push(priority, async () => {
      if (!this.connected) return fallback();
      const obj = await this.ask(build());
      const v = parse(obj);
      return v ?? fallback();
    }, fallback);
  }

  talk(req: TalkRequest): Promise<BrainReply> {
    return this.run(PRIORITY.talk, () => talkPrompt(req), (o) => {
      const say = cleanLine(o.say);
      if (!say) return null;
      const r: BrainReply = { say, ai: true };
      // задачите се дават по правилата на сценария (за да е предвидима играта); ИИ може само да приключи разговора
      const scriptedAction = this.fallback.talkNow(req).action;
      const action = typeof o.action === 'string' ? o.action : 'none';
      if (action === 'end' || action === 'walk_away') r.action = action;
      if (scriptedAction === 'give_quest' || scriptedAction === 'end') r.action = scriptedAction;
      const mood = cleanMood(o.mood);
      if (mood) r.mood = mood;
      const rem = cleanLine(o.remember, { maxSentences: 2, maxLen: 160 });
      if (rem) r.remember = rem;
      return r;
    }, () => this.fallback.talkNow(req));
  }

  react(req: ReactRequest): Promise<BrainReply> {
    return this.run(PRIORITY.react, () => reactPrompt(req), (o) => {
      const say = cleanLine(o.say, { maxSentences: 2 });
      if (!say) return null;
      const r: BrainReply = { say, ai: true };
      const mood = cleanMood(o.mood);
      if (mood) r.mood = mood;
      const rem = cleanLine(o.remember, { maxSentences: 2, maxLen: 160 });
      if (rem) r.remember = rem;
      return r;
    }, () => this.fallback.reactNow(req));
  }

  chat(req: ChatRequest): Promise<ChatReply> {
    return this.run(PRIORITY.chat, () => chatPrompt(req), (o) => {
      if (!Array.isArray(o.lines)) return null;
      const ids = new Map<string, string>([
        [req.a.id, req.a.id], [req.b.id, req.b.id],
        [req.a.name.toLowerCase(), req.a.id], [req.b.name.toLowerCase(), req.b.id],
      ]);
      const lines: { who: string; text: string }[] = [];
      for (const l of o.lines.slice(0, 4)) {
        if (!l || typeof l !== 'object') continue;
        const rec = l as Record<string, unknown>;
        const who = typeof rec.who === 'string' ? ids.get(rec.who.trim()) ?? ids.get(rec.who.trim().toLowerCase()) : undefined;
        const text = cleanLine(rec.text, { maxSentences: 2, maxLen: 200 });
        if (who && text) lines.push({ who, text });
      }
      if (lines.length < 2) return null;
      const summary = cleanLine(o.summary, { maxSentences: 2, maxLen: 240 }) ?? this.fallback.chatNow(req).summary;
      const d = typeof o.affinityDelta === 'number' && Number.isFinite(o.affinityDelta) ? Math.max(-10, Math.min(10, Math.round(o.affinityDelta))) : 0;
      return { lines, summary, affinityDelta: d, ai: true };
    }, () => this.fallback.chatNow(req));
  }

  plan(req: PlanRequest): Promise<PlanReply> {
    return this.run(PRIORITY.plan, () => planPrompt(req), (o) => {
      const plan = cleanLine(o.plan, { maxSentences: 2, maxLen: 220 });
      return plan ? { plan, ai: true } : null;
    }, () => this.fallback.planNow(req));
  }

  retell(req: RetellRequest): Promise<RetellReply> {
    if (!req.events.length) return Promise.resolve(this.fallback.retellNow(req));
    return this.run(PRIORITY.retell, () => retellPrompt(req), (o) => parseRetell(o, req), () => this.fallback.retellNow(req));
  }

  reflect(req: ReflectRequest): Promise<ReflectReply> {
    return this.run(PRIORITY.reflect, () => reflectPrompt(req), (o) => {
      if (!Array.isArray(o.beliefs)) return null;
      const out: string[] = [];
      for (const b of o.beliefs) {
        const t = cleanLine(b, { maxSentences: 2, maxLen: 160 });
        if (t && !out.includes(t)) out.push(t);
        if (out.length >= 5) break;
      }
      return out.length ? { beliefs: out, ai: true } : null;
    }, () => this.fallback.reflectNow(req));
  }
}

/** Проверява преразказа: всеки текст поотделно (лошият остава null → текстът по сценарий). */
export function parseRetell(o: Record<string, unknown>, req: RetellRequest): RetellReply | null {
  const arr = o.texts;
  if (!Array.isArray(arr)) return null;
  const texts = req.events.map((e, i) => {
    const t = cleanLine(arr[i], { maxSentences: 3, maxLen: 280, minCyr: 12 });
    if (!t || t.length < 25) return null;
    // да не е просто преписан текстът по сценарий
    if (t.replace(/\s+/g, ' ') === e.text.replace(/\s+/g, ' ')) return null;
    return t;
  });
  return texts.some(Boolean) ? { texts, ai: true } : null;
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && ((e as { name?: string }).name === 'AbortError' || (e as { name?: string }).name === 'TimeoutError');
}

/** В Windows версията (.exe) заявките към локалния Ollama минават през вътрешния сървър на играта (/__ollama) — без CORS грижи. */
export function routeUrl(url: string): string {
  const loc = (globalThis as { location?: { search?: string; origin?: string } }).location;
  if (!loc?.search || !/[?&]app=desktop\b/.test(loc.search) || !loc.origin) return url;
  const m = /^http:\/\/(127\.0\.0\.1|localhost):11434(\/.*)?$/i.exec(url);
  return m ? `${loc.origin}/__ollama${m[2] ?? ''}` : url;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
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
