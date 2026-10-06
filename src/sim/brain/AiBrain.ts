// ИИ мозък на жителите — общ за двата вида ИИ: Ollama (локален модел) и Genesis (мост към облачни модели).
// Една заявка наведнъж, с приоритети. При КАКВАТО И ДА Е грешка (няма връзка, изтичане, лош JSON, английски,
// изтичане „като ИИ…“) се връща отговорът на мозъка по сценарий за същата заявка (ai: false).
// Видът ИИ (transport) се сменя от настройките, без да се сменя самият мозък (симулацията пази референция към него).
import type {
  AiProvider, AiSettings, Brain, BrainReply, BrainStatus, ChatReply, ChatRequest, PlanReply, PlanRequest, ReactRequest, ReflectReply,
  ReflectRequest, RetellReply, RetellRequest, TalkRequest,
} from './Brain';
import { DEFAULT_AI } from './Brain';
import { GENESIS } from './genesisApi';
import { blockedByHttps, HttpError, isAbort, type Transport } from './net';
import { OLLAMA, REASONS } from './ollamaApi';
import { BrainQueue, PRIORITY } from './queue';
import { chatPrompt, planPrompt, reactPrompt, reflectPrompt, retellPrompt, talkPrompt, type Prompt } from './prompt';
import type { ScriptedBrain } from './ScriptedBrain';
import { SCRIPTED_LABEL } from './ScriptedBrain';
import { cleanLine, cleanMood, parseJsonObject } from './validate';

export const RECONNECT_MS = 30_000;
/** След толкова грешки от сървъра подред (HTTP 5xx/429) — „няма връзка“ и нова проверка след RECONNECT_MS. */
export const FAIL_STREAK = 3;

const TRANSPORTS: Record<AiProvider, Transport> = { ollama: OLLAMA, genesis: GENESIS };
export function transportFor(provider: AiProvider | undefined): Transport { return TRANSPORTS[provider ?? 'ollama'] ?? OLLAMA; }

type TimerHandle = ReturnType<typeof setTimeout>;
type Kind = 'talk' | 'chat' | 'react' | 'plan' | 'reflect' | 'retell';

export interface AiBrainOptions {
  /** Часовник (милисекунди) за ограниченията на Genesis — в пробите се подменя. */
  now?: () => number;
}

export class AiBrain implements Brain {
  private settings: AiSettings;
  private transport: Transport;
  private connected = false;
  private reason: string | undefined;
  private lastModel = '';
  private failStreak = 0;
  private lastAt: Partial<Record<Kind, number>> = {};
  private queue = new BrainQueue(6);
  private listeners = new Set<(s: BrainStatus) => void>();
  private timer: TimerHandle | null = null;
  private connecting: Promise<BrainStatus> | null = null;
  /** Расте при всяка смяна на настройките — закъснели отговори от стария ИИ не пипат състоянието. */
  private epoch = 0;
  private connectingEpoch = -1;
  private disposed = false;
  private now: () => number;

  constructor(settings: AiSettings, private fallback: ScriptedBrain, opts: AiBrainOptions = {}) {
    this.settings = { ...DEFAULT_AI, ...settings };
    this.transport = transportFor(this.settings.provider);
    this.now = opts.now ?? (() => Date.now());
    if (!this.settings.enabled) this.reason = REASONS.disabled;
    this.queue.onChange = () => this.emit();
  }

  get provider(): AiProvider { return this.transport.provider; }

  status(): BrainStatus {
    const t = this.transport;
    return {
      connected: this.connected,
      model: t.model(this.settings, this.lastModel),
      label: this.connected ? t.label(this.settings, this.lastModel) : SCRIPTED_LABEL,
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
    const prev = this.settings, prevT = this.transport;
    this.settings = { ...DEFAULT_AI, ...s };
    this.transport = transportFor(this.settings.provider);
    const changed = prev.enabled !== this.settings.enabled || prevT !== this.transport
      || prevT.url(prev) !== this.transport.url(this.settings) || (this.transport.provider === 'ollama' && prev.model !== this.settings.model);
    if (!changed) { this.emit(); return; }
    this.epoch++;
    this.connected = false;
    this.failStreak = 0;
    if (prevT !== this.transport) { this.lastModel = ''; this.lastAt = {}; this.queue.clear(); }
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

  /** Проверява дали ИИ работи (Ollama: и дали моделът е свален; Genesis: /v1/health). */
  connect(): Promise<BrainStatus> {
    if (this.connecting && this.connectingEpoch === this.epoch) return this.connecting;
    const p = this.doConnect().finally(() => { if (this.connecting === p) this.connecting = null; });
    this.connecting = p;
    this.connectingEpoch = this.epoch;
    return p;
  }

  private async doConnect(): Promise<BrainStatus> {
    this.stopTimer();
    const epoch = this.epoch, t = this.transport, s = this.settings;
    if (!s.enabled) { this.setState(false, REASONS.disabled); return this.status(); }
    const url = t.url(s);
    if (blockedByHttps(url)) { this.setState(false, t.reasons.https); return this.status(); }
    const r = await t.probe(s);
    if (epoch !== this.epoch) return this.status(); // настройките се смениха междувременно
    if (!r.ok) {
      this.setState(false, r.reason ?? t.reasons.down(url));
      this.scheduleReconnect();
      return this.status();
    }
    this.failStreak = 0;
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
    if (blockedByHttps(this.transport.url(this.settings))) return;
    this.stopTimer();
    const t = setTimeout(() => { this.timer = null; void this.connect(); }, RECONNECT_MS);
    (t as unknown as { unref?: () => void }).unref?.();
    this.timer = t;
  }

  /** Една заявка към ИИ. Връща JSON обекта от отговора или хвърля. */
  private async ask(p: Prompt): Promise<Record<string, unknown>> {
    const epoch = this.epoch, t = this.transport, s = this.settings;
    const timeoutMs = s.timeoutMs > 0 ? s.timeoutMs : DEFAULT_AI.timeoutMs;
    let content: string;
    try {
      const r = await t.ask(s, p, timeoutMs);
      content = r.content;
      if (epoch === this.epoch) {
        this.failStreak = 0;
        if (r.model && r.model !== this.lastModel) { this.lastModel = r.model; this.emit(); }
      }
    } catch (e) {
      if (epoch === this.epoch && !isAbort(e)) {
        if (e instanceof HttpError) {
          // сървърът е жив, но връща грешки (напр. квотите на Genesis са свършили) — след няколко подред спираме за малко
          if (e.status >= 500 || e.status === 429) {
            if (++this.failStreak >= FAIL_STREAK) { this.failStreak = 0; this.setState(false, t.reasons.failing(e.status)); this.scheduleReconnect(); }
          }
        } else {
          // връзката падна — към сценария, и опитваме пак след малко
          this.setState(false, t.reasons.down(t.url(s)));
          this.scheduleReconnect();
        }
      }
      throw e;
    }
    const obj = parseJsonObject(content);
    if (!obj) throw new Error('bad json');
    return obj;
  }

  /** Пестене (Genesis): твърде скоро след предишната заявка от този вид → по сценарий, без заявка. */
  private throttled(kind: Kind): boolean {
    const gap = kind === 'chat' ? this.transport.limits.chatGapMs : kind === 'react' ? this.transport.limits.reactGapMs : 0;
    if (gap <= 0) return false;
    const now = this.now(), last = this.lastAt[kind];
    if (last !== undefined && now - last < gap) return true;
    this.lastAt[kind] = now;
    return false;
  }

  private run<T>(kind: Kind, build: () => Prompt, parse: (o: Record<string, unknown>) => T | null, fallback: () => T): Promise<T> {
    if (!this.settings.enabled || !this.connected) return Promise.resolve(fallback());
    if (this.throttled(kind)) return Promise.resolve(fallback());
    return this.queue.push(PRIORITY[kind], async () => {
      if (!this.connected) return fallback();
      const obj = await this.ask(build());
      const v = parse(obj);
      return v ?? fallback();
    }, fallback);
  }

  talk(req: TalkRequest): Promise<BrainReply> {
    return this.run('talk', () => talkPrompt(req), (o) => {
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
    return this.run('react', () => reactPrompt(req), (o) => {
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
    return this.run('chat', () => chatPrompt(req), (o) => {
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
    return this.run('plan', () => planPrompt(req), (o) => {
      const plan = cleanLine(o.plan, { maxSentences: 2, maxLen: 220 });
      return plan ? { plan, ai: true } : null;
    }, () => this.fallback.planNow(req));
  }

  retell(req: RetellRequest): Promise<RetellReply> {
    if (!req.events.length) return Promise.resolve(this.fallback.retellNow(req));
    return this.run('retell', () => retellPrompt(req), (o) => parseRetell(o, req), () => this.fallback.retellNow(req));
  }

  reflect(req: ReflectRequest): Promise<ReflectReply> {
    return this.run('reflect', () => reflectPrompt(req), (o) => {
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

/** Мозък с Ollama по подразбиране (видът може да се смени от настройките). */
export class OllamaBrain extends AiBrain {
  constructor(settings: AiSettings, fallback: ScriptedBrain, opts: AiBrainOptions = {}) {
    super({ ...settings, provider: settings.provider ?? 'ollama' }, fallback, opts);
  }
}

/** Мозък с Genesis (`genesis api` → http://127.0.0.1:8770). */
export class GenesisBrain extends AiBrain {
  constructor(settings: AiSettings, fallback: ScriptedBrain, opts: AiBrainOptions = {}) {
    super({ ...settings, provider: 'genesis' }, fallback, opts);
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
