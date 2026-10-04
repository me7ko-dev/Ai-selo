// Лайв режим накуп: чат от Twitch (или демо чат) → гласуване → случка в селото (InjectedEvent).
// Играта прави: const live = new LiveSession({ channel, voteSeconds, onEvent: (e, text) => world.inject(e) }); live.start();
import type { InjectedEvent } from '../sim/types';
import { TwitchChat, type ChatStatus } from './TwitchChat';
import { LiveVote, type LiveEventType, type LiveVoteState, type VoteCounts } from './LiveVote';

export interface LiveSessionOptions {
  channel: string;                       // празно → демо чат
  voteSeconds?: number;
  cooldownSeconds?: number;
  demo?: boolean;                        // насила демо чат (без Twitch)
  now?: () => number;                    // часовник (за проби)
  onEvent: (e: InjectedEvent, announce: string, counts: VoteCounts) => void;
  onChange?: () => void;                 // за прерисуване на оверлея
}

export interface LiveSessionState {
  status: ChatStatus | 'demo';
  /** „Свързан с #канал“, „Демо чат (без Twitch)“… */
  statusLabel: string;
  channel: string;
  vote: LiveVoteState;
  recent: { user: string; text: string; at: number }[];  // последните съобщения (до 6)
}

export class LiveSession {
  readonly vote: LiveVote;
  private chat: TwitchChat | null = null;
  private status: ChatStatus | 'demo' = 'disconnected';
  private recent: LiveSessionState['recent'] = [];
  private running = false;

  constructor(private opts: LiveSessionOptions) {
    this.vote = new LiveVote({
      voteSeconds: opts.voteSeconds ?? 30,
      cooldownSeconds: opts.cooldownSeconds ?? 20,
      now: opts.now,
      onResult: (type: LiveEventType, by: string, counts: VoteCounts) => {
        const text = this.vote.state().last?.text ?? '';
        this.opts.onEvent({ type, by }, text, counts);
      },
      onChange: () => this.opts.onChange?.(),
    });
  }

  get isDemo(): boolean { return this.status === 'demo'; }

  start(): void {
    if (this.running) return;
    this.running = true;
    const channel = this.opts.channel.trim();
    if (this.opts.demo || !channel) {
      this.status = 'demo';
      this.vote.startDemo((m) => this.pushRecent(m.user, m.text));
      this.opts.onChange?.();
      return;
    }
    this.chat = new TwitchChat(channel);
    this.chat.on('status', (s) => { this.status = s; this.opts.onChange?.(); });
    this.chat.on('message', (m) => { this.pushRecent(m.user, m.text); this.vote.feed(m.user, m.text); });
    this.chat.connect();
  }

  stop(): void {
    this.running = false;
    this.vote.stopDemo();
    this.vote.cancel();
    this.chat?.disconnect();
    this.chat = null;
    this.status = 'disconnected';
    this.opts.onChange?.();
  }

  /** Викай всеки кадър (или поне няколко пъти в секунда) — приключва изтеклите гласувания. */
  tick(): void { this.vote.tick(); }

  private pushRecent(user: string, text: string) {
    this.recent.push({ user, text: text.slice(0, 120), at: Date.now() });
    if (this.recent.length > 6) this.recent.shift();
    this.opts.onChange?.();
  }

  state(): LiveSessionState {
    const ch = this.chat?.channel ?? this.opts.channel.trim().toLowerCase().replace(/^#/, '');
    const label =
      this.status === 'demo' ? 'Демо чат (без Twitch)'
      : this.status === 'connected' ? `Свързан с #${ch}`
      : this.status === 'connecting' ? `Свързване с #${ch}…`
      : this.status === 'error' ? `Няма връзка с #${ch} — нов опит след малко`
      : 'Изключен';
    return { status: this.status, statusLabel: label, channel: ch, vote: this.vote.state(), recent: [...this.recent] };
  }
}
