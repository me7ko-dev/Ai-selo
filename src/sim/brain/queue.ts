// Опашка към ИИ: само една заявка наведнъж (видеокартата е 4 GB), с приоритет.
// 0 — разговор с играча, 1 — реакция/разговор между жители, 2 — план за деня, 3 — вечерен размисъл.
// Ако опашката стане по-дълга от maxLen, най-старите заявки с най-нисък приоритет се махат
// и веднага получават резервния отговор (по сценарий).

export const PRIORITY = { talk: 0, react: 1, chat: 1, plan: 2, reflect: 3 } as const;

interface Item {
  priority: number;
  seq: number;
  run: () => Promise<unknown>;
  fallback: () => unknown;
  resolve: (v: unknown) => void;
}

export class BrainQueue {
  private items: Item[] = [];
  private running = false;
  private seq = 0;
  /** Вика се при всяка промяна (за индикатора в HUD). */
  onChange: (() => void) | null = null;

  constructor(public maxLen = 6) {}

  /** Чакащи заявки (без текущата). */
  get length(): number { return this.items.length; }
  /** Има ли заявка в момента. */
  get busy(): boolean { return this.running; }

  push<T>(priority: number, run: () => Promise<T>, fallback: () => T): Promise<T> {
    return new Promise<T>((resolve) => {
      this.items.push({ priority, seq: this.seq++, run, fallback, resolve: resolve as (v: unknown) => void });
      this.trim();
      this.changed();
      this.pump();
    });
  }

  /** Маха всичко чакащо (връща резервните отговори). */
  clear(): void {
    const all = this.items.splice(0);
    for (const it of all) it.resolve(safeFallback(it));
    this.changed();
  }

  private trim(): void {
    while (this.items.length > this.maxLen) {
      let worst = 0;
      for (let i = 1; i < this.items.length; i++) {
        const a = this.items[i], w = this.items[worst];
        if (a.priority > w.priority || (a.priority === w.priority && a.seq < w.seq)) worst = i;
      }
      const [it] = this.items.splice(worst, 1);
      it.resolve(safeFallback(it));
    }
  }

  private pump(): void {
    if (this.running || !this.items.length) return;
    let best = 0;
    for (let i = 1; i < this.items.length; i++) {
      const a = this.items[i], b = this.items[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    const [it] = this.items.splice(best, 1);
    this.running = true;
    this.changed();
    Promise.resolve()
      .then(() => it.run())
      .then((v) => it.resolve(v), () => it.resolve(safeFallback(it)))
      .finally(() => {
        this.running = false;
        this.changed();
        this.pump();
      });
  }

  private changed(): void { try { this.onChange?.(); } catch { /* индикаторът не бива да чупи опашката */ } }
}

function safeFallback(it: Item): unknown {
  try { return it.fallback(); } catch { return undefined; }
}
