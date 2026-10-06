// Вход: клавиатура (KeyboardEvent.code), мишка, pointer lock — и сензорен режим (телефон/таблет).
// enabled = false, докато е отворен прозорец (диалог, раница…) — тогава down()/pressed() връщат false,
// а *Raw() версиите работят винаги (за Tab, M, J, T, Esc).
export class Input {
  private keys = new Set<string>();
  private pressedSet = new Set<string>();
  private buttons = new Set<number>();
  private clicked = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  /** Обърната мишка по вертикала (от настройките). */
  invertY = false;
  wheel = 0;
  enabled = true;
  /** Чувствителност на мишката (от настройките). */
  sensitivity = 1;
  /** Сензорен режим: виртуален джойстик и бутони; без pointer lock — камерата се върти с плъзгане. */
  touch = false;
  /** Аналогов джойстик (-1..1) или null; събира се с WASD. */
  stick: { fwd: number; right: number } | null = null;

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
  /** Приема ли се оглеждане (мишка при заключена мишка или плъзгане в сензорен режим). */
  get lookActive(): boolean { return this.touch || this.locked; }
  lock(): void { if (this.touch) return; if (!this.locked) { try { const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* браузърът не дава */ } } }
  unlock(): void { if (this.locked) document.exitPointerLock(); }

  // ---- виртуален вход (сензорните бутони): същото като истински клавиш/бутон ----
  /** Натиска/пуска клавиш (KeyboardEvent.code). */
  virtualKey(code: string, isDown: boolean): void {
    if (isDown) { if (!this.keys.has(code)) this.pressedSet.add(code); this.keys.add(code); } else this.keys.delete(code);
  }
  /** Натиска/пуска бутон на мишката (0 = ляв, 2 = десен). */
  virtualButton(button: number, isDown: boolean): void {
    if (isDown) { this.buttons.add(button); this.clicked.add(button); } else this.buttons.delete(button);
  }
  /** Оглеждане с плъзгане (в пиксели, като движение на мишката). */
  addLook(dx: number, dy: number): void { this.mouseDX += dx; this.mouseDY += dy; }
  /** Щипване с два пръста (като колелцето на мишката). */
  addZoom(d: number): void { this.wheel += d; }
  /** Аналоговият джойстик (null — пуснат). */
  setStick(fwd: number, right: number): void { this.stick = fwd === 0 && right === 0 ? null : { fwd, right }; }

  /** Вика се в края на всеки кадър. */
  endFrame(): void {
    this.pressedSet.clear(); this.clicked.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
  }
}
