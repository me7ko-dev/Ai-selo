// Вход: клавиатура (KeyboardEvent.code), мишка, pointer lock.
// enabled = false, докато е отворен прозорец (диалог, раница…) — тогава down()/pressed() връщат false,
// а *Raw() версиите работят винаги (за Tab, M, J, T, Esc).
export class Input {
  private keys = new Set<string>();
  private pressedSet = new Set<string>();
  private buttons = new Set<number>();
  private clicked = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  enabled = true;
  /** Чувствителност на мишката (от настройките). */
  sensitivity = 1;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // пише в поле
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedSet.add(e.code);
      this.keys.add(e.code);
    });
    // capture: полетата за писане спират keyup (isolateInput) — иначе задържан клавиш остава „натиснат“ завинаги
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), true);
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    el.addEventListener('mousedown', (e) => { this.buttons.add(e.button); this.clicked.add(e.button); });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.el) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(code: string): boolean { return this.enabled && this.keys.has(code); }
  pressed(code: string): boolean { return this.enabled && this.pressedSet.has(code); }
  downRaw(code: string): boolean { return this.keys.has(code); }
  pressedRaw(code: string): boolean { return this.pressedSet.has(code); }
  mouseDown(button = 0): boolean { return this.enabled && this.buttons.has(button); }
  mouseClicked(button = 0): boolean { return this.enabled && this.clicked.has(button); }

  get locked(): boolean { return document.pointerLockElement === this.el; }
  lock(): void { if (!this.locked) { try { const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* браузърът не дава */ } } }
  unlock(): void { if (this.locked) document.exitPointerLock(); }

  /** Вика се в края на всеки кадър. */
  endFrame(): void {
    this.pressedSet.clear(); this.clicked.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
  }
}
