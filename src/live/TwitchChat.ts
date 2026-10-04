// Анонимно четене на Twitch чат (само четене, без ключове): WebSocket към IRC шлюза с ник justinfan<число>.

export interface ChatMessage { user: string; text: string; color?: string }
export type ChatStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface IrcLine {
  tags: Record<string, string>;
  prefix: string;          // „nick!nick@nick.tmi.twitch.tv“ или „tmi.twitch.tv“
  nick: string;            // от prefix (преди „!“)
  command: string;         // PRIVMSG, PING, 001, …
  params: string[];        // без последния (trailing)
  trailing: string;        // текстът след „ :“
}

function unescapeTag(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) => (c === 's' ? ' ' : c === ':' ? ';' : c === 'n' ? '\n' : c === 'r' ? '\r' : c === '\\' ? '\\' : c));
}

/** Разбира един ред от IRC (с IRCv3 тагове). Връща null за празен ред. */
export function parseIrcLine(raw: string): IrcLine | null {
  let line = raw.replace(/\r?\n$/, '');
  if (!line.trim()) return null;
  const tags: Record<string, string> = {};
  if (line.startsWith('@')) {
    const sp = line.indexOf(' ');
    if (sp < 0) return null;
    for (const kv of line.slice(1, sp).split(';')) {
      if (!kv) continue;
      const eq = kv.indexOf('=');
      if (eq < 0) tags[kv] = '';
      else tags[kv.slice(0, eq)] = unescapeTag(kv.slice(eq + 1));
    }
    line = line.slice(sp + 1).trimStart();
  }
  let prefix = '';
  if (line.startsWith(':')) {
    const sp = line.indexOf(' ');
    if (sp < 0) return null;
    prefix = line.slice(1, sp);
    line = line.slice(sp + 1).trimStart();
  }
  let trailing = '';
  const ti = line.indexOf(' :');
  if (ti >= 0) {
    trailing = line.slice(ti + 2);
    line = line.slice(0, ti);
  } else if (line.startsWith(':')) {
    trailing = line.slice(1);
    line = '';
  }
  const parts = line.split(' ').filter(Boolean);
  const command = (parts.shift() ?? '').toUpperCase();
  if (!command) return null;
  const bang = prefix.indexOf('!');
  const nick = bang >= 0 ? prefix.slice(0, bang) : prefix.includes('.') ? '' : prefix;
  return { tags, prefix, nick, command, params: parts, trailing };
}

/** Ако редът е съобщение в чата — { user, text }; иначе null. */
export function chatMessageFrom(l: IrcLine | null): ChatMessage | null {
  if (!l || l.command !== 'PRIVMSG') return null;
  let text = l.trailing;
  // /me съобщения: \x01ACTION ...\x01
  const m = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (m) text = m[1];
  const user = (l.tags['display-name'] || l.nick || '').trim();
  if (!user) return null;
  const msg: ChatMessage = { user, text };
  if (l.tags.color) msg.color = l.tags.color;
  return msg;
}

type Handlers = { message: (m: ChatMessage) => void; status: (s: ChatStatus) => void };

export class TwitchChat {
  readonly channel: string;
  status: ChatStatus = 'disconnected';
  private ws: WebSocket | null = null;
  private wanted = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: { [K in keyof Handlers]: Handlers[K][] } = { message: [], status: [] };

  constructor(channel: string) {
    this.channel = channel.trim().replace(/^#/, '').toLowerCase();
  }

  on<K extends keyof Handlers>(ev: K, fn: Handlers[K]): () => void {
    (this.listeners[ev] as Handlers[K][]).push(fn);
    return () => {
      const arr = this.listeners[ev] as Handlers[K][];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  private setStatus(s: ChatStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.listeners.status) try { fn(s); } catch (e) { console.warn(e); }
  }

  connect(): void {
    if (!this.channel) { this.setStatus('error'); return; }
    this.wanted = true;
    this.open();
  }

  disconnect(): void {
    this.wanted = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; try { ws.close(); } catch { /* */ } }
    this.setStatus('disconnected');
  }

  private open() {
    if (this.ws || !this.wanted) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      const nick = 'justinfan' + String(10000 + Math.floor(Math.random() * 90000));
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK ' + nick);
      ws.send('JOIN #' + this.channel);
    };
    ws.onmessage = (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : '';
      for (const raw of data.split('\r\n')) {
        const l = parseIrcLine(raw);
        if (!l) continue;
        if (l.command === 'PING') { ws.send('PONG :' + (l.trailing || 'tmi.twitch.tv')); continue; }
        if (l.command === 'RECONNECT') { try { ws.close(); } catch { /* */ } continue; }
        if (l.command === 'JOIN' || l.command === 'ROOMSTATE' || l.command === '001') {
          this.attempt = 0;
          this.setStatus('connected');
          continue;
        }
        const msg = chatMessageFrom(l);
        if (msg) for (const fn of this.listeners.message) try { fn(msg); } catch (e) { console.warn(e); }
      }
    };
    ws.onerror = () => { this.setStatus('error'); };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.wanted) return;
      if (this.status !== 'error') this.setStatus('disconnected');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (!this.wanted || this.retryTimer) return;
    const delay = Math.min(30000, 1000 * 2 ** this.attempt) + Math.random() * 500;
    this.attempt = Math.min(this.attempt + 1, 6);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.open(); }, delay);
  }
}
