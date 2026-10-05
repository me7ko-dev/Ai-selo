// Управление с пръсти (телефон/таблет): плаващ джойстик вляво, плъзгане вдясно — камера,
// бутони Удар/Блок/Скок/E вдясно долу, горе — Раница/Карта/Летопис/Време/Меню; клетките на бързата лента се натискат.
// Само в сензорен режим (грубо посочване или първо докосване) — на компютър нищо от това не се вижда и не слуша.
// Изгледът не знае за играта: подава „виртуални“ клавиши/бутони към приемник (Input).
import { h } from './dom';
import { icon } from './icons';
import { STICK_RADIUS, RUN_AT, LOOK_GAIN, stickVector } from './touchStick';
import './css/touch.css';

/** Какво приема натисканията (в играта — Input). */
export interface TouchSink {
  touch: boolean;
  virtualKey(code: string, down: boolean): void;
  virtualButton(button: number, down: boolean): void;
  addLook(dx: number, dy: number): void;
  setStick(fwd: number, right: number): void;
}

/** Телефон или таблет (основното посочване е с пръст). */
export function prefersTouch(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

/** Горните бутони: [клас, текст, клавиш]. */
const TOP_BUTTONS: [string, string, string][] = [
  ['inv', 'Раница', 'Tab'],
  ['map', 'Карта', 'KeyM'],
  ['chr', 'Летопис', 'KeyJ'],
  ['time', 'Време', 'KeyT'],
  ['menu', 'Меню', 'Escape'],
];

export class TouchControls {
  /** Слоят за джойстика и камерата (под HUD-а). */
  readonly zone: HTMLElement;
  /** Бутоните (над HUD-а). */
  readonly pad: HTMLElement;
  /** „Обърни телефона хоризонтално“ (над всичко). */
  readonly rotate: HTMLElement;
  /** Включен ли е сензорният режим. */
  enabled = false;
  /** Вика се при смяна на режима (true — пръсти, false — мишка). */
  onModeChange: (touch: boolean) => void = () => {};

  private sink: TouchSink | null = null;
  private active = false;
  private joy: HTMLElement; private knob: HTMLElement;
  private useBtn: HTMLElement; private useTxt: HTMLElement; private promptTxt: string | null = '';
  private stickId: number | null = null; private stickOrigin = { x: 0, y: 0 }; private running = false;
  private lookId: number | null = null; private lookLast = { x: 0, y: 0 };
  /** Задържани бутони: pointerId → пускане. */
  private held = new Map<number, () => void>();

  constructor(private root: HTMLElement) {
    this.zone = h('div.touch-zone.hidden');
    this.knob = h('div.touch-knob');
    this.joy = h('div.touch-joy.idle', null, h('div.touch-joy-ring'), this.knob);
    this.zone.append(this.joy);

    this.pad = h('div.touch-pad.hidden');
    const top = h('div.touch-top');
    for (const [cls, label, code] of TOP_BUTTONS) {
      const b = h(`button.touch-btn.touch-small.t-${cls}`, { text: label });
      this.holdKey(b, code);
      top.append(b);
    }
    const attack = h('button.touch-btn.touch-round.t-attack', { html: `${icon('sword', '46%')}<span>Удар</span>` });
    const block = h('button.touch-btn.touch-round.t-block', { html: `${icon('shield', '46%')}<span>Блок</span>` });
    const jump = h('button.touch-btn.touch-round.t-jump', { html: `<b class="t-arrow">▲</b><span>Скок</span>` });
    this.useTxt = h('span.t-use-txt', { text: 'Говори' });
    this.useBtn = h('button.touch-btn.t-use.dim', null, h('kbd', { text: 'E' }), this.useTxt);
    this.holdButton(attack, 0);
    this.holdButton(block, 2);
    this.holdKey(jump, 'Space');
    this.holdKey(this.useBtn, 'KeyE');
    this.pad.append(top, h('div.touch-actions', null, this.useBtn, block, jump, attack));

    this.rotate = h('div.touch-rotate', null, h('div.touch-rotate-box', null,
      h('div.touch-rotate-ic', { text: '⟳' }),
      h('div.touch-rotate-t', { text: 'Обърни телефона хоризонтално' }),
      h('div.hint', { text: 'Играта е по-удобна легнала. Докосни, за да продължиш така.' })));
    this.rotate.addEventListener('click', () => this.rotate.classList.add('dismissed'));

    this.wireZone();
    // първо докосване → сензорен режим; истинска мишка (без пръст преди това) → обратно
    window.addEventListener('touchstart', () => { if (!this.enabled) this.enable(); }, { capture: true, passive: true });
    window.addEventListener('pointerdown', (e) => {
      if (this.enabled && e.pointerType === 'mouse' && !prefersTouch()) this.disable();
    }, true);
    // приложението отиде във фона — пусни задържаното (иначе героят продължава да тича)
    window.addEventListener('blur', () => { if (this.enabled) this.releaseAll(); });
    // iOS: щипване = мащабиране на страницата
    document.addEventListener('gesturestart', (e) => { if (this.enabled) e.preventDefault(); });
  }

  /** Към кого отиват натисканията. */
  bind(sink: TouchSink): void { this.sink = sink; sink.touch = this.enabled; }

  /** Клетките на бързата лента (1–6) стават бутони. */
  bindHotbar(cells: HTMLElement[]): void {
    cells.forEach((c, i) => this.holdKey(c, `Digit${i + 1}`));
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.documentElement.classList.add('bl-touch');
    this.root.classList.add('bl-touch');
    if (this.sink) this.sink.touch = true;
    this.apply();
    this.onModeChange(true);
  }

  disable(): void {
    if (!this.enabled) return;
    this.releaseAll();
    this.enabled = false;
    document.documentElement.classList.remove('bl-touch');
    this.root.classList.remove('bl-touch');
    if (this.sink) this.sink.touch = false;
    this.apply();
    this.onModeChange(false);
  }

  /** Играе се (няма прозорец, героят е жив) — показва бутоните. Вика се всеки кадър. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) this.releaseAll();
    this.apply();
  }

  /** Текстът на подканата за E („Говори с баба Гена“) или null. */
  prompt(text: string | null): void {
    if (text === this.promptTxt) return;
    this.promptTxt = text;
    this.useTxt.textContent = text ?? 'Говори';
    this.useBtn.classList.toggle('dim', !text);
    this.useBtn.title = text ?? '';
  }

  private apply(): void {
    const show = this.enabled && this.active;
    this.zone.classList.toggle('hidden', !show);
    this.pad.classList.toggle('hidden', !show);
  }

  /** Пуска всичко задържано (прозорец, смяна на режим). */
  private releaseAll(): void {
    for (const off of this.held.values()) off();
    this.held.clear();
    this.endStick();
    this.lookId = null;
  }

  private holdKey(el: HTMLElement, code: string): void {
    this.hold(el, () => this.sink?.virtualKey(code, true), () => this.sink?.virtualKey(code, false));
  }
  private holdButton(el: HTMLElement, button: number): void {
    this.hold(el, () => this.sink?.virtualButton(button, true), () => this.sink?.virtualButton(button, false));
  }

  /** Бутон, който се държи с пръст (натиснат, докато пръстът е върху него). Само в сензорен режим. */
  private hold(el: HTMLElement, down: () => void, up: () => void): void {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* стар браузър */ }
      this.held.get(e.pointerId)?.();
      el.classList.add('down');
      down();
      this.held.set(e.pointerId, () => { el.classList.remove('down'); up(); });
    });
    const end = (e: PointerEvent) => {
      const off = this.held.get(e.pointerId);
      if (!off) return;
      this.held.delete(e.pointerId);
      off();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  private wireZone(): void {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const leftSide = e.clientX < window.innerWidth * 0.45;
      if (leftSide && this.stickId === null) {
        this.stickId = e.pointerId;
        const r = STICK_RADIUS + 10;
        this.stickOrigin = {
          x: Math.max(r, Math.min(window.innerWidth - r, e.clientX)),
          y: Math.max(r, Math.min(window.innerHeight - r, e.clientY)),
        };
        this.joy.classList.remove('idle');
        this.joy.style.left = `${this.stickOrigin.x}px`;
        this.joy.style.top = `${this.stickOrigin.y}px`;
        this.moveStick(e.clientX, e.clientY);
      } else if (!leftSide && this.lookId === null) {
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
      } else return;
      try { z.setPointerCapture(e.pointerId); } catch { /* стар браузър */ }
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
      else if (e.pointerId === this.lookId) {
        this.sink?.addLook((e.clientX - this.lookLast.x) * LOOK_GAIN, (e.clientY - this.lookLast.y) * LOOK_GAIN);
        this.lookLast = { x: e.clientX, y: e.clientY };
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) this.endStick();
      else if (e.pointerId === this.lookId) this.lookId = null;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
    z.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private moveStick(x: number, y: number): void {
    const dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy), k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    this.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    const v = stickVector(dx, dy);
    this.sink?.setStick(v.fwd, v.right);
    const run = v.mag >= RUN_AT;
    if (run !== this.running) { this.running = run; this.sink?.virtualKey('ShiftLeft', run); this.joy.classList.toggle('run', run); }
  }

  private endStick(): void {
    if (this.stickId === null && !this.running) return;
    this.stickId = null;
    this.sink?.setStick(0, 0);
    if (this.running) { this.running = false; this.sink?.virtualKey('ShiftLeft', false); }
    this.joy.classList.remove('run');
    this.joy.classList.add('idle');
    this.joy.style.left = ''; this.joy.style.top = '';
    this.knob.style.transform = '';
  }
}
