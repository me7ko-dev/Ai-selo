// Коя анимация от библиотеката (Universal Animation Library) играе за всяко AnimName на играта.
// Чиста логика (без three.js) — тества се в Node.
import type { AnimName } from '../types';
import type { Role, Tool } from './looks';

/** Процедурна добавка върху клипа (ръце за хоро, махане, ковашки чук, блок…). */
export type Overlay = 'none' | 'horo' | 'wave' | 'hammer' | 'block' | 'bow' | 'breathe' | 'carry';

export interface ClipChoice {
  clip: string;
  loop: boolean;
  /** Скорост на клипа. */
  speed: number;
  /** Откъс от клипа (с) — само за еднократните. */
  from?: number;
  to?: number;
  /** Задръж на кадър (сън — последният кадър от падането). */
  hold?: number;
  /** Време за смесване (с). */
  fade: number;
  overlay: Overlay;
}

export interface AnimContext {
  role: Role;
  tool?: Tool;
  old?: boolean;
  weapon?: 'saber' | 'ivan_saber' | 'bow' | null;
}

/** Клиповете, които трябва да ги има в anims.glb. */
export const CLIPS = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', walkOld: 'Walk_Formal_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop',
  talk: 'Idle_Talking_Loop', sword: 'Sword_Attack', swordIdle: 'Sword_Idle', cross: 'Punch_Cross',
  hit: 'Hit_Chest', hitHead: 'Hit_Head', death: 'Death01', dance: 'Dance_Loop', kneel: 'Fixing_Kneeling', push: 'Push_Loop',
  interact: 'Interact', pickup: 'PickUp_Table', torch: 'Idle_Torch_Loop', sit: 'Sitting_Idle_Loop', sitTalk: 'Sitting_Talking_Loop',
  jump: 'Jump_Loop', spell: 'Spell_Simple_Shoot', spellIdle: 'Spell_Simple_Idle_Loop', shoot: 'Pistol_Shoot',
} as const;

/** Еднократни (връщат се към предишната повтаряща се); 'die' остава на последния кадър. */
export const ONE_SHOTS: ReadonlySet<AnimName> = new Set<AnimName>(['attack', 'attack2', 'hit', 'die', 'jump', 'cast', 'wave']);

const loop = (clip: string, overlay: Overlay = 'none', speed = 1, fade = 0.3): ClipChoice => ({ clip, loop: true, speed, fade, overlay });
const once = (clip: string, speed: number, fade: number, from?: number, to?: number, overlay: Overlay = 'none'): ClipChoice => ({ clip, loop: false, speed, fade, from, to, overlay });

/** Работата според сечивото. */
function workClip(tool?: Tool): ClipChoice {
  switch (tool) {
    case 'hammer': return loop(CLIPS.idle, 'hammer');            // ковачът бие с чука по наковалнята
    case 'saw': return loop(CLIPS.push, 'none', 0.9);              // трион напред-назад
    case 'basket': return loop(CLIPS.kneel, 'none', 0.8);          // бере билки на колене
    case 'spindle': return loop(CLIPS.interact, 'none', 0.7);      // при стана
    case 'tray': return loop(CLIPS.pickup, 'none', 0.6);           // подрежда масата
    case 'crook': case 'staff': return loop(CLIPS.torch, 'none', 0.8); // подпрян на гегата
    default: return loop(CLIPS.interact, 'none', 0.8);
  }
}

export function chooseClip(anim: AnimName, ctx: AnimContext): ClipChoice {
  // поднос в ръката — лакътят свит напред (иначе подносът виси до крака)
  const carry: Overlay = ctx.tool === 'tray' ? 'carry' : 'none';
  switch (anim) {
    case 'idle': return loop(CLIPS.idle, carry, ctx.old || ctx.role === 'samodiva' ? 0.8 : ctx.role === 'talasam' ? 0.7 : 1);
    case 'walk': return loop(ctx.old ? CLIPS.walkOld : CLIPS.walk, carry, 1, 0.25);
    case 'run': return loop(CLIPS.jog, 'none', 1, 0.2);
    case 'talk': return loop(CLIPS.talk, carry, ctx.old ? 0.85 : 1);
    case 'work': return workClip(ctx.tool);
    case 'sit': return loop(CLIPS.sit);
    case 'sleep': return { clip: CLIPS.death, loop: true, speed: 0, fade: 0.6, hold: 1, overlay: 'breathe' };
    case 'dance': return loop(CLIPS.dance, 'horo', ctx.role === 'samodiva' ? 0.8 : 0.9, 0.4);
    case 'block': return loop(CLIPS.swordIdle, 'none', 1, 0.12);
    case 'attack':
      if (ctx.role === 'talasam') return once(CLIPS.cross, 0.95, 0.1, 0.0, 0.72); // замах с нокти
      if (ctx.weapon === 'bow') return once(CLIPS.shoot, 1.1, 0.08, 0, 0.6, 'bow');
      return once(CLIPS.sword, 1.55, 0.08, 0.28, 1.12);
    case 'attack2':
      if (ctx.weapon === 'bow') return once(CLIPS.shoot, 1.1, 0.08, 0, 0.6, 'bow');
      return once(CLIPS.cross, 1.25, 0.08, 0.12, 0.72);
    case 'hit': return once(CLIPS.hit, 1, 0.06);
    case 'die': return once(CLIPS.death, 1, 0.1);
    case 'jump': return once(CLIPS.jump, 1, 0.1, 0, 0.7);
    case 'cast': return once(CLIPS.spell, 0.8, 0.15);
    case 'wave': return once(CLIPS.idle, 1, 0.2, 0, 1.6, 'wave');
  }
}

/** Ходене/тичане: кой клип за дадена скорост (м/с), с хистерезис спрямо сегашния. */
export function locomotionClip(speed: number, current: string | null, old = false): string {
  const walk = old ? CLIPS.walkOld : CLIPS.walk;
  const up1 = current === CLIPS.jog || current === CLIPS.sprint ? 2.3 : 2.8;
  const up2 = current === CLIPS.sprint ? 6.2 : 6.8;
  if (speed < up1) return walk;
  if (speed < up2) return CLIPS.jog;
  return CLIPS.sprint;
}
