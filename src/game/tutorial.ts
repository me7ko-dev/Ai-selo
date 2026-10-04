// Обучение за нови играчи: малки подсказки една след друга, които минават, когато играчът направи нещото.
// TutorialMachine е чиста логика (тества се в Node); Tutorial я храни с факти от играта и показва табелката (ui.hint).
// Видяните съвети се пазят в localStorage, за да не се повтарят; от менюто (Esc → Управление) се изключват или пускат отначало.
import type { Game } from './Game';
import { dayPhase } from '../core/time';

export type TutorialStep = 'move' | 'run' | 'gena' | 'talk' | 'panels' | 'dusk' | 'heal';

/** Съветите по ред. „dusk“ и „heal“ идват, когато му дойде времето (първия здрач, първата рана). */
export const LINEAR_STEPS: TutorialStep[] = ['move', 'run', 'gena', 'talk', 'panels'];

export const STEP_TEXT: Record<TutorialStep, string> = {
  move: '[W] [A] [S] [D] — вървиш · мишката — оглеждаш се (кликни в играта)',
  run: '[Shift] — бягаш · [Space] — скачаш',
  gena: 'Иди при *баба Гена* в селото — следвай златния ◆ на картата горе вдясно',
  talk: '[E] — говориш с човека до теб',
  panels: '[Tab] раница · [M] карта · [J] летопис · [T] машина на времето',
  dusk: 'Здрачава се — в гората излизат таласъми. [ляв бутон] — удар · [десен бутон] — блок',
  heal: 'Ранен си! [1]–[6] ползват нещата от бързата лента (отвара, баница), а [Tab] отваря раницата',
};

export function stepLabel(s: TutorialStep): string {
  const i = LINEAR_STEPS.indexOf(s);
  if (i >= 0) return `Съвет ${i + 1} от ${LINEAR_STEPS.length}`;
  return s === 'dusk' ? 'Внимание' : 'Съвет';
}

/** Какво става в играта този кадър. */
export interface TutorialFacts {
  /** Играе се: няма отворен прозорец, героят е жив. */
  playing: boolean;
  /** Метри, изминати този кадър. */
  moved: number;
  running: boolean;
  jumped: boolean;
  /** До героя има жител, с когото може да се говори. */
  nearVillager: boolean;
  /** Задачата на баба Гена още не е взета (знакът ◆ сочи към нея). */
  genaQuest: boolean;
  /** Отворен е разговор. */
  dialogue: boolean;
  /** Отворена е раница / карта / летопис / машина на времето. */
  panel: boolean;
  /** Здрач или нощ. */
  dusk: boolean;
  attacked: boolean;
  blocked: boolean;
  /** Живот 0..1. */
  hp: number;
}

export interface TutorialSave { seen: TutorialStep[]; off: boolean }

export interface TutorialFrame {
  /** Съветът, който трябва да се вижда сега (null = нищо). */
  step: TutorialStep | null;
  /** Съветът, който току-що е изпълнен (за „✓“). */
  done: TutorialStep | null;
}

const ALL: TutorialStep[] = [...LINEAR_STEPS, 'dusk', 'heal'];

export class TutorialMachine {
  seen = new Set<TutorialStep>();
  off = false;
  current: TutorialStep | null = null;
  /** Колко секунди се вижда текущият съвет (само докато се играе). */
  shownFor = 0;
  private moved = 0; private ran = 0; private jumped = false; private attacked = false; private blocked = false;
  private talked = false; private panelSeen = false;
  /** Пауза след изпълнен съвет (да се види отметката). */
  private gap = 0;

  constructor(save?: Partial<TutorialSave> | null) { if (save) this.load(save); }

  load(s: Partial<TutorialSave>): void {
    this.seen = new Set((Array.isArray(s.seen) ? s.seen : []).filter((x): x is TutorialStep => ALL.includes(x as TutorialStep)));
    this.off = !!s.off;
  }
  save(): TutorialSave { return { seen: ALL.filter((s) => this.seen.has(s)), off: this.off }; }

  /** Всичко видяно? */
  get finished(): boolean { return ALL.every((s) => this.seen.has(s)); }

  reset(): void {
    this.seen.clear(); this.off = false; this.current = null; this.shownFor = 0; this.gap = 0;
    this.moved = 0; this.ran = 0; this.jumped = false; this.attacked = false; this.blocked = false; this.talked = false; this.panelSeen = false;
  }

  update(f: TutorialFacts, dt: number): TutorialFrame {
    if (this.off) { this.current = null; return { step: null, done: null }; }
    // това, което се брои и при отворен прозорец
    if (f.dialogue) this.talked = true;
    if (f.panel) this.panelSeen = true;
    if (this.talked) { this.seen.add('gena'); }
    if (!f.playing) return { step: null, done: null };

    this.moved += Math.min(f.moved, 2); // телепорт (събуждане в хана) не се брои
    if (f.running && f.moved > 0) this.ran += dt;
    if (f.jumped) this.jumped = true;
    if (f.attacked) this.attacked = true;
    if (f.blocked) this.blocked = true;

    // изпълнен ли е текущият?
    if (this.current) {
      this.shownFor += dt;
      if (this.isDone(this.current, f)) {
        const d = this.current;
        this.seen.add(d);
        this.current = null; this.shownFor = 0; this.gap = 1.4;
        return { step: null, done: d };
      }
    }
    if (this.gap > 0) { this.gap -= dt; return { step: null, done: null }; }

    const want = this.pick(f);
    if (want !== this.current) { this.current = want; this.shownFor = 0; }
    return { step: this.current, done: null };
  }

  private pick(f: TutorialFacts): TutorialStep | null {
    // каквото е спешно — първо
    if (!this.seen.has('heal') && f.hp > 0 && f.hp < 0.5) return 'heal';
    if (!this.seen.has('dusk') && f.dusk && this.seen.has('move')) return 'dusk';
    for (const s of LINEAR_STEPS) {
      if (this.seen.has(s)) continue;
      switch (s) {
        case 'gena':
          if (!f.genaQuest) { this.seen.add('gena'); continue; } // вече е при нея / задачата е взета
          if (f.nearVillager) { this.seen.add('gena'); continue; }
          return 'gena';
        case 'talk':
          if (this.talked) { this.seen.add('talk'); continue; }
          return f.nearVillager ? 'talk' : null; // само когато има с кого
        case 'panels':
          if (this.panelSeen && this.talked) { this.seen.add('panels'); continue; }
          return this.talked ? 'panels' : null;
        default:
          return s;
      }
    }
    return null;
  }

  private isDone(s: TutorialStep, f: TutorialFacts): boolean {
    const t = this.shownFor;
    switch (s) {
      case 'move': return this.moved >= 6 && t > 1.5;
      case 'run': return (this.ran >= 0.8 && this.jumped && t > 1.5) || (t > 25 && (this.ran > 0 || this.jumped)) || t > 45;
      case 'gena': return f.nearVillager || this.talked;
      case 'talk': return this.talked;
      case 'panels': return this.panelSeen || t > 40;
      case 'dusk': return (this.attacked && this.blocked && t > 2) || t > 30;
      case 'heal': return f.hp >= 0.75 || t > 18;
    }
  }
}

// ───────────────────────── връзка с играта ─────────────────────────

const KEY = 'balkanski-legendi:tutorial';

function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }

export function loadTutorial(): Partial<TutorialSave> | null {
  try { const s = storage()?.getItem(KEY); return s ? (JSON.parse(s) as Partial<TutorialSave>) : null; } catch { return null; }
}
export function saveTutorial(s: TutorialSave): void {
  try { storage()?.setItem(KEY, JSON.stringify(s)); } catch { /* блокирано хранилище — няма как да се запомни */ }
}

export class Tutorial {
  readonly m: TutorialMachine;
  private lastX = NaN; private lastZ = NaN;
  private slowAcc = 1;
  private slow = { near: false, gena: false, dusk: false, hp: 1 };
  private shownKey = '';

  constructor(private g: Game) {
    this.m = new TutorialMachine(loadTutorial());
    // снимките на робота (?shot=…) — без подсказки (и без да се пипа записаното)
    try { if (new URLSearchParams(location.search).has('shot')) this.quiet = true; } catch { /* без location */ }
  }
  private quiet = false;

  get enabled(): boolean { return !this.m.off; }

  setEnabled(on: boolean): void {
    this.m.off = !on;
    if (!on) this.g.ui.hint.hide();
    this.shownKey = '';
    saveTutorial(this.m.save());
  }

  /** „Покажи съветите отначало“. */
  reset(): void {
    this.m.reset();
    this.shownKey = '';
    saveTutorial(this.m.save());
  }

  /** Всеки кадър (от Game.update). */
  update(dt: number): void {
    const g = this.g, hint = g.ui.hint;
    if (this.quiet) return;
    if (this.m.off || (this.m.finished && !this.m.current)) { if (hint.isOpen && this.shownKey) { hint.hide(); this.shownKey = ''; } return; }
    const input = g.engine.input;
    const play = g.mode === 'play';
    const playing = play && g.modal === null && !g.rpg.dead && !g.ui.intro.isOpen;
    const p = g.rpg.heroPos;
    const moved = play && Number.isFinite(this.lastX) ? Math.hypot(p.x - this.lastX, p.z - this.lastZ) : 0;
    this.lastX = p.x; this.lastZ = p.z;
    this.slowAcc += dt;
    if (play && this.slowAcc > 0.2) {
      this.slowAcc = 0;
      this.slow.near = g.modal === null && g.nearVillager() !== null;
      this.slow.gena = g.rpg.markers().some((mk) => mk.label === 'Баба Гена');
      const ph = dayPhase(g.sim.state.time);
      this.slow.dusk = ph === 'dusk' || ph === 'night';
      const h = g.rpg.hud();
      this.slow.hp = h.maxHp > 0 ? h.hp / h.maxHp : 1;
    }
    const m = g.modal;
    const fr = this.m.update({
      playing,
      moved,
      running: input.down('ShiftLeft') || input.down('ShiftRight'),
      jumped: input.pressed('Space'),
      nearVillager: this.slow.near,
      genaQuest: this.slow.gena,
      dialogue: m === 'dialogue',
      panel: m === 'inventory' || m === 'map' || m === 'chronicle' || m === 'time',
      dusk: this.slow.dusk,
      attacked: input.mouseClicked(0),
      blocked: input.mouseDown(2),
      hp: this.slow.hp,
    }, dt);
    if (fr.done) {
      hint.done();
      this.shownKey = '';
      saveTutorial(this.m.save());
      return;
    }
    if (fr.step) {
      const key = fr.step;
      if (key !== this.shownKey) { this.shownKey = key; hint.show(STEP_TEXT[fr.step], stepLabel(fr.step)); }
    } else if (this.shownKey) {
      // прозорец, смърт, отдалечи се от жителя… — скрий, без „✓“
      this.shownKey = '';
      hint.hide();
    }
  }
}
