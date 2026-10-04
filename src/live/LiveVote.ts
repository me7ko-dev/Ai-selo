// Гласуване от чата: първата команда пуска гласуване с всичките 5 случки; един глас на зрител (последният важи);
// в края → onResult(тип, ник, гласове). Часовникът се подава отвън (now), за да се тества в Node.

export type LiveEventType = 'karakondzhul' | 'samodivi' | 'storm' | 'sabor' | 'theft';

export interface LiveOption { type: LiveEventType; cmd: string; label: string; aliases: string[] }

export const LIVE_OPTIONS: readonly LiveOption[] = [
  { type: 'karakondzhul', cmd: '!караконджул', label: 'Караконджул', aliases: ['!karakondzhul', '!karakondjul', '!karakonjul'] },
  { type: 'samodivi', cmd: '!самодиви', label: 'Самодиви', aliases: ['!samodivi', '!самодива', '!samodiva'] },
  { type: 'storm', cmd: '!буря', label: 'Буря', aliases: ['!burya', '!buria', '!storm'] },
  { type: 'sabor', cmd: '!сбор', label: 'Сбор', aliases: ['!sabor', '!sbor', '!събор'] },
  { type: 'theft', cmd: '!кражба', label: 'Кражба', aliases: ['!krazhba', '!krajba', '!kraja'] },
];

const CMD_MAP = new Map<string, LiveEventType>();
for (const o of LIVE_OPTIONS) {
  CMD_MAP.set(o.cmd, o.type);
  for (const a of o.aliases) CMD_MAP.set(a, o.type);
}

export const LIVE_LABELS: Record<LiveEventType, string> = Object.fromEntries(LIVE_OPTIONS.map((o) => [o.type, o.label])) as Record<LiveEventType, string>;

/** Командата в текста на съобщението (първата дума), или null. */
export function parseLiveCommand(text: string): LiveEventType | null {
  const w = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[.,!?;:…]+$/u, '') ?? '';
  if (!w.startsWith('!')) return null;
  return CMD_MAP.get(w) ?? null;
}

/** Съобщение за екрана: „Петьо_БГ извика буря над селото!“ */
export function liveAnnouncement(type: LiveEventType, by: string): string {
  switch (type) {
    case 'storm': return `${by} извика буря над селото!`;
    case 'karakondzhul': return `${by} пусна Караконджула в селото!`;
    case 'samodivi': return `${by} повика самодивите!`;
    case 'sabor': return `${by} свика сбор на мегдана!`;
    case 'theft': return `${by} прати крадец в селото!`;
  }
}

export type VoteCounts = Record<LiveEventType, number>;

export interface LiveVoteState {
  active: boolean;
  endsAt: number;                 // кога свършва гласуването (по часовника now()); 0 ако няма
  secondsLeft: number;
  cooldownUntil: number;          // до кога новите команди се пренебрегват
  starter?: string;
  total: number;
  options: { type: LiveEventType; cmd: string; label: string; votes: number }[];
  last?: { type: LiveEventType; by: string; label: string; text: string; at: number };
}

export interface LiveVoteOptions {
  voteSeconds?: number;           // по подразбиране 30
  cooldownSeconds?: number;       // по подразбиране 20
  now?: () => number;             // милисекунди; по подразбиране Date.now
  onResult?: (type: LiveEventType, by: string, counts: VoteCounts) => void;
  onChange?: () => void;          // нещо се промени (за оверлея)
}

const DEMO_NICKS = [
  'Петьо_от_Балкана', 'бабаЦоцка', 'Mitko_BG', 'Гошо92', 'КалинаСамодива', 'stoyan_hajduk', 'Тодорчо', 'Vanko_Kaval',
  'Деси_шевица', 'ivo_tapan', 'Стамен', 'Радо_от_Хана', 'NiaSmile', 'дядоВълчо', 'Zlatka_77', 'Bojko_gaida',
];
const DEMO_CHATTER = ['здравейте!', 'хаха', 'давай Стояне!', 'какво става в селото?', 'GG', 'еее', 'обичам това хоро', 'кой е кмет сега?'];

export class LiveVote {
  voteSeconds: number;
  cooldownSeconds: number;
  onResult?: LiveVoteOptions['onResult'];
  onChange?: LiveVoteOptions['onChange'];
  private now: () => number;
  private active = false;
  private endsAt = 0;
  private cooldownUntil = 0;
  private starter = '';
  private votes = new Map<string, { type: LiveEventType; at: number }>(); // ключ: ник в малки букви
  private firstBy = new Map<LiveEventType, string>();                     // първият, който е извикал всяка случка
  private last?: LiveVoteState['last'];
  private demoTimer: ReturnType<typeof setInterval> | null = null;
  private demoSeed = 1;

  constructor(opts: LiveVoteOptions = {}) {
    this.voteSeconds = opts.voteSeconds ?? 30;
    this.cooldownSeconds = opts.cooldownSeconds ?? 20;
    this.now = opts.now ?? (() => Date.now());
    this.onResult = opts.onResult;
    this.onChange = opts.onChange;
  }

  /** Съобщение от чата. Връща true, ако е командата е приета (пусната/гласувана). */
  feed(user: string, text: string): boolean {
    this.tick();
    const type = parseLiveCommand(text);
    if (!type || !user) return false;
    const t = this.now();
    if (!this.active) {
      if (t < this.cooldownUntil) return false;
      this.active = true;
      this.endsAt = t + this.voteSeconds * 1000;
      this.starter = user;
      this.votes.clear();
      this.firstBy.clear();
    }
    this.votes.set(user.toLowerCase(), { type, at: t });
    if (!this.firstBy.has(type)) this.firstBy.set(type, user);
    this.onChange?.();
    return true;
  }

  /** Проверява дали гласуването е свършило. Викай го често (напр. всеки кадър) — евтино е. */
  tick(): void {
    if (this.active && this.now() >= this.endsAt) this.finish();
  }

  /** Прекъсва текущото гласуване без резултат. */
  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.votes.clear();
    this.onChange?.();
  }

  counts(): VoteCounts {
    const c: VoteCounts = { karakondzhul: 0, samodivi: 0, storm: 0, sabor: 0, theft: 0 };
    for (const v of this.votes.values()) c[v.type]++;
    return c;
  }

  private finish() {
    const counts = this.counts();
    const starterVote = this.votes.get(this.starter.toLowerCase())?.type;
    let best: LiveEventType = starterVote ?? 'storm';
    let bestN = -1;
    for (const o of LIVE_OPTIONS) {
      const n = counts[o.type];
      // при равенство печели изборът на този, който е пуснал гласуването
      if (n > bestN || (n === bestN && o.type === starterVote)) { best = o.type; bestN = n; }
    }
    const by = this.firstBy.get(best) ?? this.starter;
    const t = this.now();
    this.active = false;
    this.cooldownUntil = t + this.cooldownSeconds * 1000;
    this.last = { type: best, by, label: LIVE_LABELS[best], text: liveAnnouncement(best, by), at: t };
    this.votes.clear();
    try { this.onResult?.(best, by, counts); } catch (e) { console.warn(e); }
    this.onChange?.();
  }

  state(): LiveVoteState {
    this.tick();
    const counts = this.counts();
    const t = this.now();
    return {
      active: this.active,
      endsAt: this.active ? this.endsAt : 0,
      secondsLeft: this.active ? Math.max(0, Math.ceil((this.endsAt - t) / 1000)) : 0,
      cooldownUntil: this.cooldownUntil,
      starter: this.active ? this.starter : undefined,
      total: this.votes.size,
      options: LIVE_OPTIONS.map((o) => ({ type: o.type, cmd: o.cmd, label: o.label, votes: counts[o.type] })),
      last: this.last,
    };
  }

  // ---- демо: измислен чат за проба без Twitch ----

  private rand(): number {
    this.demoSeed = (this.demoSeed * 1103515245 + 12345) & 0x7fffffff;
    return this.demoSeed / 0x7fffffff;
  }

  /** Една стъпка от измисления чат (едно съобщение). Подава го на feed() и го връща (за показване в оверлея). */
  demoStep(): { user: string; text: string } {
    const user = DEMO_NICKS[Math.floor(this.rand() * DEMO_NICKS.length)];
    let text: string;
    const r = this.rand();
    if (this.active || r < 0.35) {
      // любимци: бурята и самодивите се гласуват по-често
      const weights = [0.18, 0.26, 0.28, 0.16, 0.12];
      let x = this.rand(), i = 0;
      while (i < weights.length - 1 && x > weights[i]) { x -= weights[i]; i++; }
      const o = LIVE_OPTIONS[i];
      text = this.rand() < 0.25 && o.aliases[0] ? o.aliases[0] : o.cmd;
    } else {
      text = DEMO_CHATTER[Math.floor(this.rand() * DEMO_CHATTER.length)];
    }
    this.feed(user, text);
    return { user, text };
  }

  /** Пуска измислен чат (за проба без Twitch). onMessage — за показване на съобщенията. */
  startDemo(onMessage?: (m: { user: string; text: string }) => void, intervalMs = 1200): void {
    this.stopDemo();
    this.demoSeed = (Date.now() & 0xffff) + 1;
    this.demoTimer = setInterval(() => {
      const m = this.demoStep();
      onMessage?.(m);
    }, intervalMs);
  }

  stopDemo(): void {
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = null; }
  }

  get demoRunning(): boolean { return this.demoTimer !== null; }
}
