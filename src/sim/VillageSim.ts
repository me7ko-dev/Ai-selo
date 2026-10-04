// ЖИВОТОТО СЕЛО — чиста логика (без three.js и без браузъра). Детерминирано: всичко случайно идва от
// state.rng, обхождането е в стабилен ред → от един запис светът продължава еднакво (със ScriptedBrain).
import { Emitter } from '../core/bus';
import { Rng } from '../core/rng';
import { dayOf, isDarkish, minuteOfDay, formatClock } from '../core/time';
import { PLACES, dist, nearestPlace, roadPath, type PlaceId, type Vec2 } from '../data/layout';
import { VILLAGER_IDS, VILLAGERS, type VillagerId } from '../data/villagers';
import type { Brain, ChatReply, Persona, Partner } from './brain/Brain';
import { ScriptedBrain } from './brain/ScriptedBrain';
import { dialogueOptions } from './brain/options';
import type {
  Activity, ChronicleEntry, ChronicleType, DialogueReply, InjectedEvent, Memory, PlayerDeed, Relation, Rumor,
  SimEvents, VillagerState, WorldState,
} from './types';
import { scheduleFor, spotFor, horoSpot, gatherSpot, placeCenter, type Goal } from './schedules';
import { clueText, beliefIn, type ClueTopic } from './clues';
import { LOC, Name, WEATHER_TEXT, cap, g, hash, hpick, isVillager, moodScore, moodWord, nameOf, type MoodKey } from './text';
import { addMemory, pruneMemories, retrieve } from './memory';
import { worldTick, injectEvent, initialRumors, distortion } from './events';

/** Метра за игрова минута (= 1,3 м/с реално при 0,25 игрови минути в секунда). */
export const WALK_SPEED = 5.2;
const SPEED_MUL: Partial<Record<VillagerId, number>> = { gena: 0.8, peyu: 0.9 };
const MEET_DIST = 4;
const LINE_MIN = 0.4, LINE_MAX = 0.7;   // балонче: ~24–42 игрови секунди

/** Генератор, чието състояние живее в state.rng (за да се пази в записите). */
class StateRng extends Rng {
  constructor(private host: { rng: number }) { super(host.rng); }
  next(): number { this.state = this.host.rng >>> 0; const v = super.next(); this.host.rng = this.state; return v; }
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const r1 = (x: number) => Math.round(x * 1000) / 1000;

interface TalkSession { history: { who: string; text: string }[]; turn: number; lastOptionId?: string; lastAt: number }

export class VillageSim {
  readonly bus = new Emitter<SimEvents>();
  /** @internal */ s!: WorldState;
  /** @internal */ r!: StateRng;
  private scripted = new ScriptedBrain();
  private ai: Brain | null = null;
  private gen = 0;
  private player: Vec2 | null = null;
  private talks = new Map<VillagerId, TalkSession>();
  private aiChatBusy = false;
  private byId = new Map<string, VillagerState>();

  constructor(opts?: { state?: WorldState; seed?: number; brain?: Brain }) {
    this.setState(opts?.state ? clone(opts.state) : VillageSim.newState(opts?.seed ?? 12345));
    if (opts?.brain) this.setBrain(opts.brain);
  }

  // ───────────────────────── state ─────────────────────────

  static newState(seed: number): WorldState {
    const villagers: VillagerState[] = VILLAGER_IDS.map(id => {
      const p = VILLAGERS[id];
      const relations: Record<string, Relation> = {};
      for (const o of VILLAGER_IDS) if (o !== id) relations[o] = { ...(p.relations[o] ?? { affinity: 0, trust: 0 }) };
      relations.player = { ...PLAYER_START[id] };
      const pos = spotFor(p.home, id, true);
      return {
        id, pos, facing: PLACES[p.home].facing ?? 0, activity: 'sleep' as Activity, place: p.home, target: null, path: [],
        needs: { hunger: 70, energy: 85, social: 60, fun: 60 }, mood: moodWord(id, 'calm'), moodValue: 10,
        relations, memories: [], beliefs: [], knownRumors: [], speech: null, talkingWith: null, plan: '', flags: {},
        goal: { ...pos }, indoors: true, rumorBelief: {}, busyUntil: 0,
      };
    });
    const s: WorldState = {
      v: 1, seed: seed >>> 0, rng: seed >>> 0, time: 390, villagers, rumors: [], mayor: 'peyu', nextElectionDay: 10,
      weather: 'clear', flags: {}, branchId: 'main', nextId: 1, queue: [], pairCd: {}, counters: {},
    };
    initialRumors(s);
    // спомени за начало
    const mem = (id: VillagerId, text: string, imp: number, about: string[], kind: Memory['kind'] = 'event') => addMemory(s, s.villagers[VILLAGER_IDS.indexOf(id)], text, imp, about, kind);
    mem('radka', 'Пак ми изчезна кокошка. Видях нещо със светещи очи да бяга към гората, но кой ще ми повярва?', 6, ['chickens', 'fox']);
    mem('ivan', 'Козите на Петко пак тъпкаха нивата ми.', 5, ['petko', 'goats']);
    mem('peyu', 'Бистрица е суха вече трети месец. Нивите жълтеят.', 6, ['river', 'lamia']);
    mem('gena', 'Край кокошарника видях малки следи от лапи, които светеха на зазоряване.', 5, ['chickens', 'fox']);
    mem('maria', 'Написах още едно писмо и го скрих в стана.', 4, ['secret', 'world']);
    mem('petko', 'Радка пак ме гледаше накриво. Мисли, че аз ѝ крада кокошките.', 4, ['radka', 'chickens']);
    mem('kalin', 'Довърших рамото на лъка. Никой не попита какво правя.', 3, ['secret', 'bow']);
    return s;
  }

  get state(): WorldState { return this.s; }

  load(state: WorldState): void {
    this.setState(clone(state));
    this.talks.clear();
  }

  private setState(s: WorldState) {
    normalize(s);
    this.s = s; this.r = new StateRng(s);
    this.byId.clear(); for (const v of s.villagers) this.byId.set(v.id, v);
    this.gen++; this.aiChatBusy = false;
  }

  snapshot(): WorldState { return clone(this.s); }

  setBrain(brain: Brain | null): void { this.ai = brain; }
  /** Сегашният мозък (null = само по сценарий). */
  get brain(): Brain | null { return this.ai; }
  private aiOn(): Brain | null { try { return this.ai && this.ai.status().connected ? this.ai : null; } catch { return null; } }

  villager(id: VillagerId): VillagerState { return this.byId.get(id)!; }
  /** @internal */ v(id: string): VillagerState | undefined { return this.byId.get(id); }

  setPlayer(pos: Vec2 | null): void { this.player = pos ? { x: pos.x, z: pos.z } : null; }

  get day(): number { return dayOf(this.s.time); }
  get mod(): number { return minuteOfDay(Math.floor(this.s.time)); }

  // ───────────────────────── time ─────────────────────────

  advance(gameMinutes: number): void {
    if (!(gameMinutes > 0) || !Number.isFinite(gameMinutes)) return;
    let left = Math.min(gameMinutes, 2880 * 2);
    const q = this.s.queue!;
    while (left > 1e-9) {
      const t = this.s.time;
      const boundary = Math.floor(t + 1e-9) + 1;
      let step = Math.min(left, boundary - t);
      if (q.length && q[0].at > t && q[0].at - t < step) step = q[0].at - t;
      this.move(step);
      left -= step;
      if (t + step >= boundary - 1e-9) { this.s.time = boundary; this.flushQueue(); this.tick(); }
      else { this.s.time = t + step; this.flushQueue(); }
    }
  }

  private flushQueue() {
    const q = this.s.queue!, now = this.s.time + 1e-9;
    while (q.length && q[0].at <= now) {
      const l = q.shift()!;
      const v = this.v(l.id); if (!v) continue;
      v.speech = { text: l.text, until: r1(l.at + l.dur), to: l.to, ai: l.ai };
      this.bus.emit('say', { id: l.id, text: l.text, to: l.to, ai: l.ai });
    }
  }

  /** @internal Балонче веднага (или по-късно с delay). */
  say(id: VillagerId, text: string, to?: string, delay = 0, ai?: boolean): void {
    const dur = clamp(LINE_MIN + text.length / 220, LINE_MIN, LINE_MAX + 0.3);
    this.enqueue({ at: r1(this.s.time + delay), id, text, to, dur: r1(dur), ai });
    if (delay <= 0) this.flushQueue();
  }
  private enqueue(l: { at: number; id: VillagerId; text: string; to?: string; dur: number; ai?: boolean }) {
    const q = this.s.queue!;
    let i = q.length; while (i > 0 && q[i - 1].at > l.at) i--;
    const line: typeof l = { at: l.at, id: l.id, text: l.text, dur: l.dur };
    if (l.to) line.to = l.to; if (l.ai) line.ai = true;
    q.splice(i, 0, line);
  }

  private move(dt: number) {
    const t = this.s.time + dt;
    for (const v of this.s.villagers) {
      if (v.activity === 'dance' && v.place === 'square') {
        const h = horoSpot(v.id, t);
        const dx = h.pos.x - v.pos.x, dz = h.pos.z - v.pos.z, l = Math.hypot(dx, dz), step = WALK_SPEED * dt;
        if (l <= step) v.pos = h.pos; else v.pos = { x: v.pos.x + (dx / l) * step, z: v.pos.z + (dz / l) * step };
        v.facing = h.facing; continue;
      }
      if (!v.path.length || v.talkingWith) continue;
      let d = WALK_SPEED * (SPEED_MUL[v.id] ?? 1) * (v.flags.hurry ? 1.5 : 1) * dt;
      while (d > 1e-9 && v.path.length) {
        const p = v.path[0];
        const dx = p.x - v.pos.x, dz = p.z - v.pos.z, l = Math.hypot(dx, dz);
        if (l > 1e-6) v.facing = Math.atan2(dx, dz);
        if (l <= d) { v.pos = { x: p.x, z: p.z }; v.path.shift(); d -= l; }
        else { v.pos = { x: v.pos.x + (dx / l) * d, z: v.pos.z + (dz / l) * d }; d = 0; }
      }
      if (!v.path.length) this.arrive(v);
    }
  }

  private arrive(v: VillagerState) {
    const place = (v.target ?? null) as PlaceId | null;
    v.place = place;
    const act = (v.flags.gAct as Activity) || 'idle';
    v.activity = act;
    v.indoors = !!v.flags.gIn;
    delete v.flags.hurry;
    if (!place) return;
    const pl = PLACES[place], c = placeCenter(place);
    if (place === 'square' || place === 'walnut') v.facing = Math.atan2(c.x - v.pos.x, c.z - v.pos.z);
    else if (pl.facing !== undefined && !v.indoors) v.facing = act === 'work' ? Math.atan2(c.x - v.pos.x, c.z - v.pos.z) : pl.facing;
    this.onArrive(v, place);
  }

  /** Малки случки при пристигане (Мария на пътя на юг, Пею на моста…). */
  private onArrive(v: VillagerState, place: PlaceId) {
    const id = v.id;
    if (id === 'maria' && (place === 'south_road' || place === 'gate') && this.r.chance(0.5)) {
      this.chronicle('mood', hpick([
        'Мария пак стоя на пътя на юг и гледа към планините, докато сенките не се удължиха. Какво ли има отвъд?',
        'Мария излезе до края на селото и дълго гледа пътя на юг. „Някой ден…“, прошепна тя.',
        'Мария седна на камъка до пътя и гледаше облаците, които отиваха към морето, което никога не е виждала.',
      ], this.day, 'maria_gaze'), ['maria'], 2, 'maria_dreams');
      addMemory(this.s, v, 'Гледах пътя на юг и мечтаех за света отвъд планините.', 3, ['world', 'dream']);
    }
    if (id === 'peyu' && place === 'bridge' && this.r.chance(0.35)) {
      if (this.s.flags.river_flowing) {
        this.chronicle('mood', 'Дядо Пею стоя на каменния мост и се усмихваше на водата като на стар приятел.', ['peyu'], 3, 'peyu_river');
        this.say('peyu', 'Тече… Бистрица пак тече!');
      } else {
        this.chronicle('mood', hpick([
          'Дядо Пею пак стоя дълго на каменния мост и гледа сухото корито на Бистрица. „Без вода нивите ще умрат“, мърмореше си той.',
          'Дядо Пею хвърли камъче в коритото на Бистрица. Чу се сухо тракане, а не плясък. Кметът въздъхна и си тръгна.',
        ], this.day, 'peyu_bridge'), ['peyu'], 2, 'peyu_river');
        this.say('peyu', 'Едно време тук имаше вода до коляно…');
      }
      addMemory(this.s, v, 'Пак гледах сухото корито на Бистрица. Тревожа се за селото.', 3, ['river', 'lamia']);
    }
  }

  // ───────────────────────── tick (всяка игрова минута) ─────────────────────────

  private tick() {
    const s = this.s, time = s.time, mod = this.mod;
    if (mod % 60 === 0) this.bus.emit('hour', { time });
    if (mod === 0) { this.bus.emit('day', { day: this.day }); s.counters = {}; }
    worldTick(this);
    for (const v of s.villagers) this.tickVillager(v, time, mod);
    this.encounters();
    if (mod === 21 * 60) this.reflectAll();
    if (mod === 5 * 60) this.planAll();
  }

  private tickVillager(v: VillagerState, time: number, mod: number) {
    const n = v.needs, act = v.activity;
    // нужди
    const asleep = act === 'sleep';
    n.hunger -= asleep ? 0.03 : 0.06; n.energy -= act === 'work' ? 0.07 : 0.045;
    if (!asleep) { n.social -= 0.045; n.fun -= 0.03; }
    if (asleep) n.energy += 0.19;
    if (act === 'eat') { n.hunger += 3; n.fun += 0.05; }
    if (act === 'work') { n.fun += 0.012; if (v.place === 'inn') { n.hunger += 0.05; n.social += 0.04; } }
    if (act === 'talk' || act === 'gossip') { n.social += 0.9; n.fun += 0.6; }
    if (act === 'argue') { n.social += 0.3; }
    if (act === 'dance' || act === 'celebrate') { n.fun += 1.0; n.social += 0.6; n.energy -= 0.05; }
    if (act === 'vote') { n.social += 0.2; }
    if (act === 'sit' || act === 'idle') { n.fun += 0.06; n.energy += 0.02; }
    if ((act === 'sit' || act === 'idle') && (v.place === 'inn' || v.place === 'square' || v.place === 'walnut')) { n.fun += 0.08; n.social += 0.1; if (v.place === 'inn') n.hunger += 0.4; }
    n.hunger = clamp(n.hunger, 0, 100); n.energy = clamp(n.energy, 0, 100); n.social = clamp(n.social, 0, 100); n.fun = clamp(n.fun, 0, 100);
    // настроение
    let ev = Number(v.flags.moodEvent ?? 0) * 0.996; if (Math.abs(ev) < 0.05) ev = 0;
    v.flags.moodEvent = Math.round(ev * 100) / 100;
    const needScore = (n.hunger + n.energy + n.social + n.fun) / 4 - 50;
    v.moodValue = Math.round(clamp(needScore * 0.8 + ev, -100, 100));
    v.mood = this.moodOf(v, time);
    // балонче и разговор
    if (v.speech && v.speech.until <= time) v.speech = null;
    if (v.talkingWith && v.talkingWith !== 'player' && (v.busyUntil ?? 0) <= time) this.freeFromTalk(v);
    if (v.talkingWith === 'player') {
      const t = this.talks.get(v.id);
      if (!t || time - t.lastAt > 120 || (this.player && dist(this.player, v.pos) > 15)) this.endTalk(v.id);
      else { if (this.player) v.facing = Math.atan2(this.player.x - v.pos.x, this.player.z - v.pos.z); return; }
    }
    if (v.talkingWith) return;
    // накъде
    this.retarget(v, time, mod);
    this.noticePlayer(v, time);
  }

  private moodOf(v: VillagerState, time: number): string {
    const f = v.flags, id = v.id;
    if (f.moodWord && Number(f.moodUntil ?? 0) > time) return String(f.moodWord);
    const k: MoodKey =
      Number(f.fearUntil ?? 0) > time ? 'afraid'
      : Number(f.angryUntil ?? 0) > time ? 'angry'
      : Number(f.loveUntil ?? 0) > time && v.moodValue > -10 ? 'inlove'
      : v.needs.energy < 18 ? 'tired'
      : v.needs.hunger < 18 ? 'hungry'
      : v.moodValue >= 45 ? 'happy'
      : v.moodValue >= 22 ? 'cheerful'
      : v.moodValue >= 6 ? 'content'
      : v.needs.social < 20 ? 'lonely'
      : v.moodValue >= -10 ? 'calm'
      : v.moodValue >= -30 ? 'thoughtful'
      : v.moodValue >= -55 ? 'sad' : 'grumpy';
    return moodWord(id, k);
  }

  /** @internal Събитие, което вдига/сваля настроението. */
  feel(id: string, delta: number, key?: MoodKey, minutes = 0) {
    const v = this.v(id); if (!v) return;
    v.flags.moodEvent = Math.round(clamp(Number(v.flags.moodEvent ?? 0) + delta, -80, 80) * 100) / 100;
    if (key === 'afraid') v.flags.fearUntil = this.s.time + (minutes || 180);
    else if (key === 'angry') v.flags.angryUntil = this.s.time + (minutes || 120);
    else if (key === 'inlove') v.flags.loveUntil = this.s.time + (minutes || 360);
    else if (key) { v.flags.moodWord = moodWord(id, key); v.flags.moodUntil = this.s.time + (minutes || 120); }
    v.moodValue = Math.round(clamp(v.moodValue + delta, -100, 100));
    v.mood = this.moodOf(v, this.s.time);
  }

  /** Къде трябва да е жителят сега (с приоритети: страх, буря, сбор, избори, поръчка, график). */
  private desire(v: VillagerState, time: number, mod: number): { goal: Goal; spot: Vec2; hurry?: boolean } {
    const s = this.s, f = s.flags, id = v.id as VillagerId, day = this.day;
    const homeOf = VILLAGERS[id].home;
    const night = mod < 5 * 60 || mod >= 21 * 60;
    if (Number(f.karakondzhul_until ?? 0) > time) {
      const gl: Goal = { place: homeOf, act: night ? 'sleep' : 'sit', inside: true, why: 'крие се' };
      return { goal: gl, spot: spotFor(homeOf, id, true), hurry: true };
    }
    if (Number(f.storm_until ?? 0) > time) {
      const pl: PlaceId = id === 'radka' ? 'inn' : homeOf;
      const gl: Goal = { place: pl, act: night ? 'sleep' : id === 'radka' ? 'work' : 'sit', inside: true, why: 'пази се от бурята' };
      return { goal: gl, spot: spotFor(pl, id, true), hurry: true };
    }
    if (f.sabor === day && mod >= 18 * 60 && mod < 23 * 60 + 30) {
      return { goal: { place: 'square', act: 'dance', why: 'на сбора' }, spot: horoSpot(id, 0).pos };
    }
    if (s.nextElectionDay === day && mod >= 11 * 60 && mod < 12 * 60 + 30) {
      return { goal: { place: 'square', act: 'vote', why: 'избори' }, spot: gatherSpot(id) };
    }
    const dark = isDarkish(time);
    if (v.flags.seek && Number(v.flags.seekUntil ?? 0) > time && !(id === 'ivan' && dark)) {
      const o = this.v(String(v.flags.seek));
      if (o && !o.indoors && o.activity !== 'sleep') {
        const dx = v.pos.x - o.pos.x, dz = v.pos.z - o.pos.z, l = Math.hypot(dx, dz) || 1;
        return { goal: { place: o.place ?? nearestPlace(o.pos).id, act: 'idle', why: 'търси ' + nameOf(o.id) }, spot: { x: o.pos.x + (dx / l) * 1.8, z: o.pos.z + (dz / l) * 1.8 } };
      }
    } else if (v.flags.seek) { delete v.flags.seek; delete v.flags.seekUntil; delete v.flags.seekTopic; }
    if (v.flags.errand && Number(v.flags.errandUntil ?? 0) > time) {
      const pl = v.flags.errand as PlaceId;
      return { goal: { place: pl, act: 'idle', why: 'по работа' }, spot: spotFor(pl, id) };
    }
    const gl = scheduleFor(id, mod, { day, weather: s.weather, goatsToday: f.goats_day === day, mayor: s.mayor });
    const hurry = id === 'ivan' && dark && gl.place !== homeOf;
    if (id === 'ivan' && dark && gl.place !== homeOf) return { goal: atHomeGoal(id), spot: spotFor(homeOf, id, true), hurry: true };
    return { goal: gl, spot: spotFor(gl.place, id, !!gl.inside), hurry };
  }

  private retarget(v: VillagerState, time: number, mod: number) {
    const { goal, spot, hurry } = this.desire(v, time, mod);
    if (goal.act === 'dance' && v.activity === 'dance' && v.place === 'square') return; // вече е в хорото
    v.plan = v.plan || goal.why || '';
    const g0 = v.goal;
    const tol = v.flags.seek ? 3.5 : 0.5;
    const seekHold = !!v.flags.seek && v.path.length > 0 && time - Number(v.flags.seekPathT ?? -1e9) < 5;
    if (seekHold || (g0 && dist(g0, spot) <= tol && (v.path.length || v.target === goal.place))) {
      // вече върви натам / там е; само обнови дейността, ако е стигнал
      if (!v.path.length && v.activity !== goal.act && v.activity !== 'dance') { v.activity = goal.act; v.flags.gAct = goal.act; }
      if (hurry) v.flags.hurry = true;
      this.checkSeek(v);
      return;
    }
    v.goal = { x: spot.x, z: spot.z };
    v.target = goal.place;
    v.flags.gAct = goal.act;
    v.flags.gIn = !!goal.inside;
    if (hurry) v.flags.hurry = true; else delete v.flags.hurry;
    if (dist(v.pos, spot) < 0.3) { v.path = []; this.arrive(v); return; }
    v.path = roadPath(v.pos, spot).map(p => ({ x: p.x, z: p.z }));
    if (v.flags.seek) v.flags.seekPathT = time; else delete v.flags.seekPathT;
    v.place = null; v.indoors = false;
    v.activity = Number(this.s.flags.karakondzhul_until ?? 0) > time ? 'flee' : 'walk';
    this.checkSeek(v);
  }

  private checkSeek(v: VillagerState) {
    const sid = v.flags.seek; if (!sid) return;
    const o = this.v(String(sid)); if (!o) return;
    if (dist(v.pos, o.pos) <= MEET_DIST && !o.talkingWith && o.activity !== 'sleep') {
      const topic = String(v.flags.seekTopic ?? 'talk');
      delete v.flags.seek; delete v.flags.seekUntil; delete v.flags.seekTopic;
      this.startChat(v, o, topic);
    }
  }

  private freeFromTalk(v: VillagerState) {
    v.talkingWith = null; v.busyUntil = 0;
    v.goal = undefined; // ще си преизчисли пътя
    if (v.activity === 'talk' || v.activity === 'gossip' || v.activity === 'argue') v.activity = 'idle';
  }

  private noticePlayer(v: VillagerState, time: number) {
    const p = this.player; if (!p || v.activity === 'sleep' || v.indoors || v.speech) return;
    if (dist(v.pos, p) > 6) return;
    const last = Number(v.flags.greetT ?? -1e9);
    if (time - last < 240) return;
    v.flags.greetT = time;
    v.facing = Math.atan2(p.x - v.pos.x, p.z - v.pos.z);
    const rel = v.relations.player ?? { affinity: 0, trust: 0 };
    this.say(v.id as VillagerId, greetingFor(v.id as VillagerId, rel, this.s, time), 'player');
    if (!v.flags.metPlayer) {
      v.flags.metPlayer = time;
      addMemory(this.s, v, `Видях странника ${LOC[nearestPlace(v.pos).id]}. Някакъв чужденец с наметало и сабя.`, 3, ['player', 'stranger']);
    }
  }

  // ───────────────────────── разговори между жители ─────────────────────────

  private encounters() {
    const vs = this.s.villagers, time = this.s.time;
    const free = vs.filter(v => !v.talkingWith && !v.indoors && v.activity !== 'sleep' && v.activity !== 'flee' && v.activity !== 'dance' && v.activity !== 'vote' && Number(v.flags.chatCd ?? 0) <= time);
    if (free.length < 2) {
      // по време на хорото и избора също си говорят, но по-рядко
    }
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      if (a.talkingWith || b.talkingWith) continue;
      const d = dist(a.pos, b.pos);
      // по пътя — до 4 м; на едно и също място (мегдан, хан…) — и малко по-далеч
      if (d > MEET_DIST && !(a.place && a.place === b.place && !a.path.length && !b.path.length && d <= 12)) continue;
      const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
      if ((this.s.pairCd![key] ?? -1e9) > time) continue;
      let p = 0.05 + 0.05 * (1 - Math.min(a.needs.social, b.needs.social) / 100);
      const has = (x: string) => a.id === x || b.id === x;
      if (has('kalin') && !has('gena')) p *= 0.3;          // никой не забелязва Калин
      if (has('radka')) p *= 1.5;                           // Радка заговаря всеки
      if (has('ivan') && has('petko')) p *= 0.4;            // избягват се
      if (has('ivan') && has('maria')) p *= 1.6;
      if (a.activity === 'walk' || b.activity === 'walk') p *= 0.5;
      if (!this.r.chance(p)) continue;
      this.startChat(a, b);
    }
  }

  private pickTopic(a: VillagerState, b: VillagerState): string {
    const s = this.s, f = s.flags, day = this.day;
    const has = (x: string) => a.id === x || b.id === x;
    const items: [string, number][] = [
      ['weather', s.weather === 'clear' ? 0.6 : 1.6],
      ['work', 1],
      ['river', f.river_flowing ? 2 : has('peyu') ? 2 : 0.8],
      ['gossip', has('radka') ? 2.5 : 0.8],
      ['lamia', f.lamia_dead ? 1.2 : 0.6],
    ];
    if (has('ivan') && has('maria')) items.push(['love', 3]);
    if (has('ivan') && has('petko') && !f.ivan_petko_peace && (a.relations[b.id]?.affinity ?? 0) < -30) items.push(['quarrel', 2]);
    if (s.villagers.some(v => v.flags.metPlayer) && (a.flags.metPlayer || b.flags.metPlayer)) items.push(['stranger', 1.5]);
    if (Number(f.last_theft_day ?? -9) >= day - 1) items.push(['chickens', 1.5]);
    if (f.sabor === day) items.push(['festival', 2]);
    if (s.nextElectionDay - day <= 2 && s.nextElectionDay >= day) items.push(['election', 2]);
    return this.r.weighted(items);
  }

  /** @internal Започва разговор между двама жители (по сценарий, детерминирано). */
  startChat(a: VillagerState, b: VillagerState, forced?: string): void {
    const s = this.s, time = s.time;
    const topic0 = forced && forced !== 'talk' ? forced : this.pickTopic(a, b);
    // кой говори пръв: Радка винаги; иначе a
    if (b.id === 'radka') [a, b] = [b, a];
    let rumor: Rumor | undefined;
    if (topic0 !== 'quarrel' && topic0 !== 'love') rumor = this.pickRumor(a, b);
    const topic = rumor ? 'gossip' : topic0;
    const seed = this.r.fork();
    const req = {
      a: this.persona(a.id as VillagerId), b: this.persona(b.id as VillagerId), topic: topic === 'chickens' ? 'gossip' : topic, situation: this.situation(a.id as VillagerId),
      memoriesA: this.retrieveMemories(a.id as VillagerId, [topic, b.id], 5), memoriesB: this.retrieveMemories(b.id as VillagerId, [topic, a.id], 5),
      relationAB: { ...a.relations[b.id] }, relationBA: { ...b.relations[a.id] }, rumor: rumor?.text, seed,
    };
    let reply: ChatReply;
    try { reply = this.scripted.chatNow(req); } catch { reply = { lines: [], summary: '', ai: false }; }
    const lines = (reply.lines ?? []).filter(l => l && typeof l.text === 'string' && l.text.trim()).slice(0, 4)
      .map((l, i) => ({ who: l.who === a.id || l.who === b.id ? l.who : (i % 2 ? b.id : a.id), text: l.text.trim() }));
    if (!lines.length) lines.push({ who: a.id, text: 'Добър ден.' }, { who: b.id, text: 'Добър ден и на теб.' });
    if (rumor && !lines.some(l => l.text.includes(rumor!.text.slice(0, 14)))) {
      lines.splice(Math.min(1, lines.length), 0, { who: a.id, text: (a.id === 'radka' ? 'Ама да си остане между нас… ' : 'Чу ли? ') + rumor.text });
    }
    // балончета
    const aiB = this.aiOn();
    const nearPlayer = !!this.player && dist(this.player, a.pos) < 35;
    const useAi = !!aiB && nearPlayer && !this.aiChatBusy;
    let at = time + 0.05, total = 0;
    const durs = lines.map(l => clamp(LINE_MIN + l.text.length / 220, LINE_MIN, LINE_MAX));
    lines.forEach((l, i) => {
      if (!useAi) this.enqueue({ at: r1(at), id: l.who as VillagerId, text: l.text, to: l.who === a.id ? b.id : a.id, dur: r1(durs[i]) });
      at += durs[i]; total += durs[i];
    });
    const until = r1(time + 0.05 + total + 0.3);
    const act: Activity = topic === 'quarrel' ? 'argue' : topic === 'gossip' ? 'gossip' : 'talk';
    for (const [x, y] of [[a, b], [b, a]] as const) {
      x.talkingWith = y.id; x.busyUntil = until; x.activity = act; x.path = []; x.goal = undefined;
      x.facing = Math.atan2(y.pos.x - x.pos.x, y.pos.z - x.pos.z);
      x.flags.chatCd = Math.ceil(until) + 15;
      x.needs.social = clamp(x.needs.social + 12, 0, 100);
    }
    const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
    s.pairCd![key] = Math.ceil(until) + (topic === 'love' ? 90 : 120);
    this.chatEffects(a, b, topic, rumor, reply);
    if (useAi) this.fireAiChat(aiB!, req, lines, durs, a, b);
  }

  private pickRumor(a: VillagerState, b: VillagerState): Rumor | undefined {
    const eager = a.id === 'radka' ? 0.85 : 0.3;
    if (!this.r.chance(eager)) return undefined;
    const cands: Rumor[] = [];
    const root = (r: Rumor) => r.parent ?? r.id;
    const bRoots = new Set<number>();
    for (const rid of b.knownRumors) { const r = this.s.rumors.find(x => x.id === rid); if (r) bRoots.add(root(r)); }
    for (const rid of a.knownRumors) {
      const r = this.s.rumors.find(x => x.id === rid); if (!r) continue;
      if (bRoots.has(root(r))) continue;           // вече е чувал (някакъв вариант на) този слух
      if ((a.rumorBelief?.[String(rid)] ?? 0) < 0.3) continue;
      if (r.about.includes(b.id) || r.about.includes(a.id)) continue; // не разказва слух за себе си / за самия слушател
      if (r.tag === 'fox' && a.id === 'radka' && !this.s.flags.radka_admitted) continue; // Радка мълчи за лисицата
      if (r.tag === 'debt' && a.id === 'radka' && (a.relations.peyu?.affinity ?? 0) > -10) continue;
      if (r.tag === 'lamia') continue;               // всички я знаят
      cands.push(r);
    }
    if (!cands.length) return undefined;
    cands.sort((x, y) => y.time - x.time || y.id - x.id);
    return cands[0];
  }

  private chatEffects(a: VillagerState, b: VillagerState, topic: string, rumor: Rumor | undefined, reply: ChatReply) {
    const s = this.s, here = LOC[nearestPlace(a.pos).id];
    const A = a.id as VillagerId, B = b.id as VillagerId;
    const ad = clamp(Number(reply.affinityDelta ?? 0), -5, 5);
    const phrase = TOPIC_PHRASE(topic, s);
    const cnt = (k: string) => (s.counters![k] = (s.counters![k] ?? 0) + 1);
    if (topic === 'quarrel') {
      this.adjustRelation(A, B, -8 + ad, -4); this.adjustRelation(B, A, -8 + ad, -4);
      this.feel(A, -15, 'angry'); this.feel(B, -15, 'angry');
      const goats = A === 'ivan' && B === 'petko' || A === 'petko' && B === 'ivan';
      const text = goats ? hpick([
        `${cap(here)} Иван и Петко пак се скараха за козите. Иван стискаше юмруци, Петко викаше, че козите сами си ходят. Разтърваха ги чак когато дядо Пею повиши глас.`,
        `Иван и Петко се сдърпаха ${here}. „Козите ти пак ми изядоха ечемика!“ — „Абе кво ми викаш, да не съм ги вързал за нивата ти?!“ Половин час селото не говори за друго.`,
        `${cap(here)} се чуха викове — Иван и Петко пак не можаха да се разберат за нивата. Накрая Петко плю на земята и си тръгна, а Иван дълго гледа след него.`,
      ], s.time, 'quarrel') : `${Name(A)} и ${nameOf(B)} се скараха ${here}. Думите им се чуваха чак до чешмата.`;
      this.chronicle('quarrel', text, [A, B], 5, goats ? 'goats_quarrel' : 'quarrel');
      for (const x of [a, b]) addMemory(s, x, `Скарах се с ${nameOf(x.id === A ? B : A)}${goats ? ' за козите и нивата' : ''}.`, 6, [x.id === A ? B : A, 'quarrel', goats ? 'goats' : 'quarrel']);
      this.witness([a, b], text, 4, [A, B, 'quarrel']);
      return;
    }
    if (topic === 'love') {
      this.adjustRelation(A, B, 3 + ad, 2); this.adjustRelation(B, A, 3 + ad, 2);
      const ivan = A === 'ivan' ? a : b, maria = A === 'ivan' ? b : a;
      this.feel('ivan', 10, 'inlove'); this.feel('maria', 6);
      addMemory(s, ivan, 'Говорих с Мария. Сърцето ми биеше като чук върху наковалня.', 5, ['maria', 'love']);
      addMemory(s, maria, 'Иван пак се изчерви, докато ми говореше. Мил е.', 4, ['ivan', 'love']);
      const iv = ivan.relations.maria?.affinity ?? 0, mv = maria.relations.ivan?.affinity ?? 0;
      if (!s.flags.ivan_confessed && iv >= 85 && mv >= 55) { this.confession(ivan, maria, here); return; }
      if (cnt('love_log') <= 2) this.chronicle('love', hpick([
        `Иван и Мария дълго стояха ${here}. Той почти нищо не каза, но тя се смееше на всяка негова дума.`,
        `${cap(here)} Мария разказваше на Иван за морето, което никога не е виждала. Иван слушаше и забрави, че е гладен.`,
        `Иван и Мария си говориха ${here}. Когато тя го докосна по ръката, ковачът се изчерви като желязо в огнището.`,
      ], s.time, 'love'), ['ivan', 'maria'], 3, 'love_talk');
      return;
    }
    this.adjustRelation(A, B, 1 + ad, 0.5); this.adjustRelation(B, A, 1 + ad, 0.5);
    if (rumor) { this.passRumor(a, b, rumor, here); return; }
    // обикновен разговор
    const memText = `Говорих с ${nameOf(B)} ${phrase}.`;
    addMemory(s, a, memText, 2, [B, topic], 'talk');
    addMemory(s, b, `Говорих с ${nameOf(A)} ${phrase}.`, 2, [A, topic], 'talk');
    const kalinNoticed = (A === 'kalin' || B === 'kalin') && A !== 'gena' && B !== 'gena';
    if (kalinNoticed) {
      const other = A === 'kalin' ? B : A;
      addMemory(s, this.v('kalin')!, `${Name(other)} ме заговори! Рядко някой ме забелязва.`, 4, [other, 'kalin']);
      this.feel('kalin', 12);
      if (cnt('talk_log') <= 10) {
        this.chronicle('talk', `${Name(other)} заговори Калин ${here} — ${phrase}. Калин се усмихваше чак до вечерта.`, [other, 'kalin'], 3, 'kalin_noticed');
      }
      return;
    }
    if (this.r.chance(0.6) && cnt('talk_log') <= 12) {
      const t = hpick([
        `${Name(A)} и ${nameOf(B)} си поговориха ${phrase} ${here}.`,
        `${cap(here)} ${nameOf(A)} и ${nameOf(B)} дълго си говориха ${phrase}.`,
        `${Name(A)} се спря при ${nameOf(B)} ${here} да си поговорят ${phrase}.`,
      ], s.time, A, B);
      this.chronicle('talk', t, [A, B], 2, 'chat_' + topic);
    }
  }

  private passRumor(a: VillagerState, b: VillagerState, rumor: Rumor, here: string) {
    const s = this.s;
    let r = rumor;
    // понякога слухът се изкривява
    if (this.r.chance(a.id === 'radka' ? 0.18 : 0.1)) {
      const d = distortion(s, rumor, a.id);
      if (d) r = d;
    }
    const sb = a.rumorBelief?.[String(rumor.id)] ?? 0.5;
    const trust = b.relations[a.id]?.trust ?? 0;
    let belief = sb * (0.4 + (trust / 100) * 0.6);
    for (const who of r.about) {
      const aff = b.relations[who]?.affinity; if (aff === undefined) continue;
      if ((r.sentiment ?? 0) < 0) belief += aff < -20 ? 0.25 : aff > 40 ? -0.25 : 0;
    }
    belief = Math.round(clamp(belief, -1, 1) * 100) / 100;
    this.learnRumor(b, r, belief);
    if (r !== rumor && !a.knownRumors.includes(r.id)) this.learnRumor(a, r, sb);
    addMemory(s, b, `${Name(a.id)} ми каза: „${r.text}“`, belief > 0.5 ? 4 : 3, [a.id, ...r.about, r.tag ?? 'rumor'], 'rumor');
    if (belief > 0.4 && (r.sentiment ?? 0) < 0) for (const who of r.about) if (who !== b.id && b.relations[who]) this.adjustRelation(b.id, who, -3, -2);
    const verbFixed = hpick(a.id === 'radka' ? ['пошепна', 'разказа', 'каза под секрет'] : ['каза', 'разказа', 'пошепна'], r.id, b.id);
    const doubt = belief < 0.25 ? ` ${Name(b.id)} само поклати глава — не повярва.` : '';
    const n = (s.counters!.rumor_log = (s.counters!.rumor_log ?? 0) + 1);
    if (n <= 8) this.chronicle('rumor', `${Name(a.id)} ${verbFixed} на ${nameOf(b.id)} ${here}: „${r.text}“${doubt}`, [a.id, b.id], r.parent ? 4 : 3, 'rumor_' + (r.tag ?? 'x'));
  }

  /** @internal Жителят научава слух с дадена вяра. */
  learnRumor(v: VillagerState, r: Rumor, belief: number) {
    if (!v.knownRumors.includes(r.id)) v.knownRumors.push(r.id);
    if (!v.rumorBelief) v.rumorBelief = {};
    const prev = v.rumorBelief[String(r.id)];
    v.rumorBelief[String(r.id)] = Math.round(clamp(prev === undefined ? belief : (prev + belief) / 2 + 0.05 * Math.sign(belief), -1, 1) * 100) / 100;
  }

  /** @internal Свидетели наблизо запомнят случката. */
  witness(skip: VillagerState[], text: string, importance: number, about: string[], radius = 18) {
    const c = skip[0]?.pos; if (!c) return [] as VillagerState[];
    const out: VillagerState[] = [];
    for (const v of this.s.villagers) {
      if (skip.includes(v) || v.indoors || v.activity === 'sleep' || dist(v.pos, c) > radius) continue;
      addMemory(this.s, v, text, importance, about); out.push(v);
    }
    return out;
  }

  private confession(ivan: VillagerState, maria: VillagerState, here: string) {
    const s = this.s, mv = maria.relations.ivan?.affinity ?? 0;
    s.flags.ivan_confessed = this.day;
    const yes = mv >= 70;
    if (yes) s.flags.ivan_maria_together = this.day;
    const text = yes
      ? `${cap(here)} Иван най-сетне събра смелост и каза на Мария, че я обича. Тя мълча дълго, после се усмихна: „И аз мисля за теб, глупчо.“ Селото ще говори за това цяла зима.`
      : `${cap(here)} Иван най-сетне събра смелост и каза на Мария, че я обича. Тя се изчерви и не каза нищо — но не си тръгна. После дълго гледа към пътя на юг.`;
    this.chronicle('love', text, ['ivan', 'maria'], 7, 'confession');
    addMemory(s, ivan, 'Казах на Мария, че я обичам. Никога не съм се плашил толкова — дори от тъмното.', 9, ['maria', 'love']);
    addMemory(s, maria, yes ? 'Иван ми каза, че ме обича. И аз му казах.' : 'Иван ми каза, че ме обича. А светът отвъд планините? Не знам какво искам.', 9, ['ivan', 'love', 'world']);
    this.feel('ivan', 30, 'inlove', 720); this.feel('maria', yes ? 25 : 5, yes ? 'inlove' : 'thoughtful', 600);
    this.say('ivan', 'Мария… аз… обичам те.', 'maria', 0.1);
    this.say('maria', yes ? 'И аз теб, Иване.' : '…Трябва ми време.', 'ivan', 0.8);
    if (yes) this.addRumor({ topic: 'love', tag: 'love', text: 'Иван и Мария се обичат — видели са ги да се държат за ръце под ореха.', about: ['ivan', 'maria'], truth: true, origin: 'radka', sentiment: 1 }, [['radka', 0.9]]);
  }

  private fireAiChat(b: Brain, req: Parameters<Brain['chat']>[0], fallback: { who: string; text: string }[], durs: number[], A: VillagerState, B: VillagerState) {
    const gen = this.gen; this.aiChatBusy = true;
    const fall = () => {
      if (gen !== this.gen) return;
      let at = this.s.time + 0.05;
      fallback.forEach((l, i) => { this.enqueue({ at: r1(at), id: l.who as VillagerId, text: l.text, to: l.who === A.id ? B.id : A.id, dur: r1(durs[i]) }); at += durs[i]; });
    };
    b.chat({ ...req, situation: this.situation(A.id as VillagerId) }).then(rep => {
      if (gen !== this.gen) return;
      this.aiChatBusy = false;
      const lines = (rep.lines ?? []).filter(l => l && typeof l.text === 'string' && l.text.trim()).slice(0, 4);
      if (!lines.length) { fall(); return; }
      let at = this.s.time + 0.05;
      for (const l of lines) {
        const who = (l.who === A.id || l.who === B.id ? l.who : A.id) as VillagerId;
        const d = clamp(LINE_MIN + l.text.length / 220, LINE_MIN, LINE_MAX + 0.3);
        this.enqueue({ at: r1(at), id: who, text: l.text.trim(), to: who === A.id ? B.id : A.id, dur: r1(d), ai: true });
        at += d;
      }
      if (rep.summary && rep.ai) this.addChronicle('talk', rep.summary, [A.id, B.id], 2, true);
    }).catch(() => { if (gen === this.gen) { this.aiChatBusy = false; fall(); } });
  }

  /** @internal Реакция на случка: до n будни жители (най-близките до играча) казват нещо; ИИ — допълнително балонче. */
  react(event: string, fallback: string, n = 2): void {
    const p = this.player;
    const awake = this.s.villagers.filter(v => v.activity !== 'sleep' && !v.talkingWith);
    const pool = awake.length ? awake : [...this.s.villagers];
    const sorted = p ? [...pool].sort((a, b) => dist(a.pos, p) - dist(b.pos, p) || VILLAGER_IDS.indexOf(a.id) - VILLAGER_IDS.indexOf(b.id)) : pool;
    const ai = this.aiOn(), gen = this.gen;
    sorted.slice(0, n).forEach((v, i) => {
      const id = v.id as VillagerId, seed = this.r.fork();
      const req = { speaker: this.persona(id), event, memories: this.retrieveMemories(id, [event.split(' ')[0]], 5), situation: this.situation(id), seed };
      let say = '';
      try { say = this.scripted.reactNow(req).say; } catch { say = ''; }
      if (v.activity !== 'sleep') this.say(id, say || fallback, undefined, i * 0.6);
      if (ai) ai.react(req).then(rep => { if (gen === this.gen && rep?.ai && rep.say) this.say(id, rep.say, undefined, 0, true); }).catch(() => {});
    });
  }

  // ───────────────────────── памет, размисъл, план ─────────────────────────

  retrieveMemories(id: VillagerId, keywords: string[], k = 8): Memory[] {
    const v = this.v(id); if (!v) return [];
    return retrieve(v.memories, this.s.time, keywords, k);
  }

  private reflectAll() {
    const ai = this.aiOn(), gen = this.gen;
    let told = false;
    for (const v of this.s.villagers) {
      const id = v.id as VillagerId;
      const mems = [...v.memories].sort((a, b) => b.importance - a.importance || b.time - a.time).slice(0, 12);
      const seed = this.r.fork();
      let beliefs: string[] = [];
      try { beliefs = this.scripted.reflectNow({ speaker: this.persona(id), memories: mems, beliefs: v.beliefs, seed }).beliefs ?? []; } catch { beliefs = []; }
      beliefs = beliefs.filter(b => typeof b === 'string' && b.trim()).slice(0, 5);
      if (!beliefs.length) beliefs = deriveBeliefs(v);
      v.beliefs = beliefs;
      pruneMemories(v, this.s.time);
      if (!told && beliefs.length && this.r.chance(0.12)) {
        told = true;
        this.chronicle('reflection', `${hpick(['Вечерта', 'Преди сън', 'Късно вечерта'], this.day, id)} ${nameOf(id)} дълго седя ${moodWord(id, 'thoughtful')} и си мислеше: „${/[.!?…]$/.test(beliefs[0].trim()) ? beliefs[0].trim() : beliefs[0].trim() + '.'}“`, [id], 1, 'reflection');
      }
      if (ai) {
        ai.reflect({ speaker: this.persona(id), memories: mems, beliefs: v.beliefs, seed }).then(rep => {
          if (gen !== this.gen || !rep?.ai) return;
          const b = (rep.beliefs ?? []).filter(x => typeof x === 'string' && x.trim()).slice(0, 5);
          if (b.length) { const vv = this.v(id); if (vv) vv.beliefs = b; }
        }).catch(() => {});
      }
    }
  }

  private planAll() {
    for (const v of this.s.villagers) {
      const id = v.id as VillagerId, seed = this.r.fork();
      try { v.plan = this.scripted.planNow({ speaker: this.persona(id), situation: this.situation(id), memories: this.retrieveMemories(id, ['plan'], 5), seed }).plan || ''; }
      catch { v.plan = ''; }
    }
  }

  // ───────────────────────── играчът ─────────────────────────

  beginTalk(id: VillagerId): DialogueReply {
    const v = this.villager(id);
    if (v.talkingWith && v.talkingWith !== 'player') { const o = this.v(v.talkingWith); if (o) this.freeFromTalk(o); }
    v.talkingWith = 'player'; v.activity = 'talk'; v.path = []; v.goal = undefined; v.busyUntil = 0;
    if (this.player) v.facing = Math.atan2(this.player.x - v.pos.x, this.player.z - v.pos.z);
    const sess: TalkSession = { history: [], turn: 0, lastAt: this.s.time };
    this.talks.set(id, sess);
    const seed = this.r.fork();
    let say = '', mood: string | undefined;
    try {
      const rep = this.scripted.talkNow({ speaker: this.persona(id), partner: this.partnerPlayer(v), situation: this.situation(id), memories: this.retrieveMemories(id, ['player', 'stranger'], 8), history: [], input: '', optionId: 'greet', seed });
      say = rep.say; mood = rep.mood;
    } catch { /* резерв долу */ }
    if (!say) say = greetingFor(id, v.relations.player ?? { affinity: 0, trust: 0 }, this.s, this.s.time);
    sess.history.push({ who: id, text: say });
    if (!v.flags.metPlayer) { v.flags.metPlayer = this.s.time; addMemory(this.s, v, 'Заговорих се със странника. Някакъв чужденец с наметало и сабя.', 3, ['player', 'stranger'], 'player'); }
    this.say(id, say, 'player');
    return { say, mood: mood ?? v.mood, ai: false, options: this.options(v, sess, this.r.fork()) };
  }

  async playerSay(id: VillagerId, input: { optionId?: string; text: string }): Promise<DialogueReply> {
    const v = this.villager(id), gen = this.gen;
    let sess = this.talks.get(id);
    if (!sess || v.talkingWith !== 'player') { this.beginTalk(id); sess = this.talks.get(id)!; }
    sess.turn++; sess.lastOptionId = input.optionId; sess.lastAt = this.s.time;
    sess.history.push({ who: 'player', text: input.text });
    const seed = this.r.fork();
    const req = {
      speaker: this.persona(id), partner: this.partnerPlayer(v), situation: this.situation(id),
      memories: this.retrieveMemories(id, ['player', ...input.text.toLowerCase().split(/[^\p{L}]+/u).filter(w => w.length > 3)], 8),
      history: sess.history.slice(-8), input: input.text, optionId: input.optionId, seed,
    };
    let rep: { say: string; mood?: string; remember?: string; action?: string; ai: boolean } | undefined;
    const ai = this.aiOn();
    if (ai) { try { rep = await ai.talk(req); } catch { rep = undefined; } }
    if (!rep || !rep.say) { try { rep = this.scripted.talkNow(req); } catch { rep = { say: 'Хм…', ai: false }; } }
    const optSeed = gen === this.gen ? this.r.fork() : seed + 1;
    if (gen === this.gen && this.talks.get(id) === sess) {
      sess.history.push({ who: id, text: rep.say });
      if (rep.mood) { v.flags.moodWord = rep.mood; v.flags.moodUntil = this.s.time + 90; this.feel(id, moodScore(rep.mood) * 0.5); v.mood = rep.mood; }
      if (rep.remember) addMemory(this.s, v, rep.remember, 4, ['player'], 'player');
      // да те изслушат — малко сближава (веднъж на ден)
      if (v.flags.lastPlayerTalkDay !== this.day) {
        v.flags.lastPlayerTalkDay = this.day;
        this.adjustRelation(id, 'player', id === 'kalin' ? 4 : 1.5, id === 'kalin' ? 3 : 1);
        v.needs.social = clamp(v.needs.social + 10, 0, 100);
        if (id === 'kalin' && !v.flags.kalinThanked) { v.flags.kalinThanked = true; addMemory(this.s, v, 'Странникът ме забеляза и поговори с мен. Ще го запомня.', 7, ['player']); this.feel('kalin', 15, 'happy', 180); }
      }
      this.say(id, rep.say, 'player', 0, rep.ai);
    }
    const end = rep.action === 'walk_away' || rep.action === 'end';
    return { say: rep.say, mood: rep.mood ?? v.mood, ai: !!rep.ai, options: end ? [] : this.options(v, sess, optSeed), end: end || undefined };
  }

  endTalk(id: VillagerId): void {
    const v = this.v(id); if (!v) return;
    this.talks.delete(id);
    if (v.talkingWith === 'player') { v.talkingWith = null; v.activity = 'idle'; v.goal = undefined; }
  }

  private partnerPlayer(v: VillagerState): Partner {
    return { id: 'player', name: 'Стоян', isPlayer: true, relation: { ...(v.relations.player ?? { affinity: 0, trust: 0 }) } };
  }
  private options(v: VillagerState, sess: TalkSession, seed: number) {
    try {
      return dialogueOptions({ speaker: this.persona(v.id as VillagerId), partner: this.partnerPlayer(v), turn: sess.turn, lastOptionId: sess.lastOptionId, seed, situation: this.situation(v.id as VillagerId) }).slice(0, 3);
    } catch { return [{ id: 'bye', text: 'Довиждане.' }]; }
  }

  recordDeed(d: PlayerDeed): void {
    const s = this.s, imp = clamp(Math.round(d.importance || 3), 1, 10);
    const dA = d.affinity ?? 0, dT = d.trust ?? 0;
    let witnesses: VillagerState[];
    if (d.witnesses === 'all') witnesses = [...s.villagers];
    else if (Array.isArray(d.witnesses)) witnesses = d.witnesses.map(w => this.v(w)).filter((x): x is VillagerState => !!x);
    else witnesses = this.player ? s.villagers.filter(v => !v.indoors && v.activity !== 'sleep' && dist(v.pos, this.player!) <= 25) : [];
    const target = d.villager ? this.v(d.villager) : undefined;
    if (target) {
      addMemory(s, target, d.text, imp, ['player', d.kind], 'player');
      this.adjustRelation(target.id, 'player', dA, dT);
      this.feel(target.id, clamp(dA, -30, 30) * 0.6);
    }
    for (const w of witnesses) {
      if (w === target) continue;
      addMemory(s, w, d.text, Math.max(1, imp - 1), ['player', d.kind, ...(d.villager ? [d.villager] : [])], 'player');
      this.adjustRelation(w.id, 'player', dA * 0.5, dT * 0.5);
    }
    this.chronicle('player', d.text, ['player', ...(d.villager ? [d.villager] : [])], imp, 'deed_' + d.kind);
    if (imp >= 4 && d.witnesses !== 'all') {
      const origin = target ?? witnesses[0];
      if (origin) {
        const text = 'Чух, че ' + d.text.charAt(0).toLowerCase() + d.text.slice(1);
        const knowers: [string, number][] = [[origin.id, 1], ...witnesses.filter(w => w !== origin).map(w => [w.id, 0.9] as [string, number])];
        this.addRumor({ topic: 'stranger', tag: 'stranger', text, about: ['player'], truth: true, origin: origin.id, sentiment: dA >= 0 ? 1 : -1 }, knowers);
      }
    }
  }

  inject(ev: InjectedEvent): void { injectEvent(this, ev); }

  // ───────────────────────── летопис, отношения, слухове ─────────────────────────

  addChronicle(type: ChronicleType, text: string, participants: string[], importance: number, ai?: boolean): ChronicleEntry {
    const e: ChronicleEntry = { id: this.s.nextId++, time: Math.floor(this.s.time), type, participants: [...participants], text, branchId: this.s.branchId, importance: clamp(Math.round(importance), 1, 10) };
    if (ai) e.ai = true;
    this.bus.emit('chronicle', e);
    return e;
  }
  /** @internal Запис с подвид. */
  chronicle(type: ChronicleType, text: string, participants: string[], importance: number, tag?: string): ChronicleEntry {
    const e: ChronicleEntry = { id: this.s.nextId++, time: Math.floor(this.s.time), type, participants: [...participants], text, branchId: this.s.branchId, importance: clamp(Math.round(importance), 1, 10) };
    if (tag) e.tag = tag;
    this.bus.emit('chronicle', e);
    return e;
  }

  adjustRelation(a: string, b: string, dAffinity: number, dTrust: number): void {
    const v = this.v(a); if (!v || a === b) return;
    const r = v.relations[b] ?? (v.relations[b] = { affinity: 0, trust: 0 });
    r.affinity = Math.round(clamp(r.affinity + dAffinity, -100, 100) * 10) / 10;
    r.trust = Math.round(clamp(r.trust + dTrust, -100, 100) * 10) / 10;
  }

  /** @internal Нов слух; knowers: [id, вяра]. */
  addRumor(r: Omit<Rumor, 'id' | 'time'>, knowers: [string, number][]): Rumor {
    const rumor: Rumor = { id: this.s.nextId++, time: Math.floor(this.s.time), ...r };
    this.s.rumors.push(rumor);
    if (this.s.rumors.length > 40) {
      // най-старите изкривени/маловажни слухове се забравят
      const drop = this.s.rumors.findIndex(x => x.tag !== 'fox' && x.tag !== 'petko_thief' && x.tag !== 'goats' && x.tag !== 'debt' && x.tag !== 'lamia');
      if (drop >= 0) { const [gone] = this.s.rumors.splice(drop, 1); for (const v of this.s.villagers) { v.knownRumors = v.knownRumors.filter(x => x !== gone.id); if (v.rumorBelief) delete v.rumorBelief[String(gone.id)]; } }
    }
    for (const [id, b] of knowers) { const v = this.v(id); if (v) this.learnRumor(v, rumor, b); }
    return rumor;
  }

  clueFor(id: VillagerId, topic: ClueTopic): string { return clueText(this.s, this.villager(id), topic); }
  /** Вяра на жител в слух с етикет (за отладка/интерфейс). */
  beliefIn(id: VillagerId, tag: string): number { return beliefIn(this.s, this.villager(id), tag); }

  persona(id: VillagerId): Persona {
    const p = VILLAGERS[id], v = this.villager(id);
    return { id, name: p.name, job: p.job, card: p.card, speech: p.speech, mood: v.mood, beliefs: [...v.beliefs], secret: p.secret };
  }

  situation(id: VillagerId): string {
    const s = this.s, v = this.villager(id), t = s.time, day = this.day;
    const home = VILLAGERS[id].home;
    const where = v.place === home || (v.indoors && nearestPlace(v.pos).id === home) ? 'у дома' : LOC[v.place ?? nearestPlace(v.pos).id];
    const parts = [`Ден ${day}, ${formatClock(t)}, ${where}.`];
    const ph = this.mod < 5 * 60 || this.mod >= 21 * 60 ? 'Нощ е.' : this.mod >= 19 * 60 ? 'Здрачава се.' : this.mod < 7 * 60 ? 'Зазорява се.' : '';
    if (ph) parts.push(ph);
    parts.push(WEATHER_TEXT[s.weather]);
    parts.push(s.flags.river_flowing || s.flags.lamia_dead ? 'Реката Бистрица отново тече.' : 'Реката Бистрица е пресъхнала.');
    if (s.flags.lamia_dead) parts.push('Ламята е мъртва — селото ликува.');
    if (s.flags.sabor === day) parts.push('Днес е сбор — на мегдана свири гайда и се играе хоро.');
    if (Number(s.flags.karakondzhul_until ?? 0) > t) parts.push('Караконджулът броди из селото!');
    if (s.mayor !== 'peyu') parts.push(`Кмет е ${nameOf(s.mayor)}.`);
    const toEl = s.nextElectionDay - day;
    if (toEl === 0 && this.mod < 12 * 60 + 30) parts.push('Днес по обед има избори за кмет.');
    else if (toEl > 0 && toEl <= 2) parts.push(toEl === 1 ? 'Утре има избори за кмет.' : `След ${toEl} дни има избори за кмет.`);
    if (!s.flags.fox_caught && Number(s.flags.last_theft_day ?? -9) >= day - 1) parts.push('Пак изчезна кокошка от кокошарника на Радка.');
    return parts.join(' ');
  }
}

// ───────────────────────── помощни ─────────────────────────

const PLAYER_START: Record<VillagerId, Relation> = {
  gena: { affinity: 5, trust: 5 }, peyu: { affinity: -10, trust: -20 }, petko: { affinity: -15, trust: -25 },
  ivan: { affinity: 0, trust: 0 }, maria: { affinity: 12, trust: 5 }, radka: { affinity: 5, trust: -5 }, kalin: { affinity: 5, trust: 5 },
};

function atHomeGoal(id: VillagerId): Goal { return { place: VILLAGERS[id].home, act: 'sit', inside: true, why: 'у дома' }; }

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** Попълва липсващи полета (за стари записи). */
function normalize(s: WorldState) {
  s.queue ??= []; s.pairCd ??= {}; s.counters ??= {}; s.flags ??= {}; s.rumors ??= [];
  for (const v of s.villagers) {
    v.rumorBelief ??= {}; v.busyUntil ??= 0; v.flags ??= {}; v.memories ??= []; v.beliefs ??= []; v.knownRumors ??= []; v.path ??= [];
    if (v.indoors === undefined) v.indoors = v.activity === 'sleep';
  }
}

export function TOPIC_PHRASE(topic: string, s: WorldState): string {
  switch (topic) {
    case 'weather': return s.weather === 'rain' ? 'за дъжда' : s.weather === 'fog' ? 'за мъглата' : 'за времето';
    case 'river': return s.flags.river_flowing ? 'за реката, която пак тече' : 'за пресъхналата Бистрица';
    case 'gossip': return 'за последните клюки';
    case 'work': return 'за работата';
    case 'stranger': return 'за странника';
    case 'lamia': return s.flags.lamia_dead ? 'за победата над Ламята' : 'за Ламята';
    case 'chickens': return 'за изчезналите кокошки';
    case 'festival': return 'за сбора';
    case 'election': return 'за изборите';
    case 'love': return 'за сърдечни работи';
    case 'quarrel': return 'на висок глас';
    default: return 'за това-онова';
  }
}

function greetingFor(id: VillagerId, rel: Relation, s: WorldState, time: number): string {
  const good = rel.affinity >= 30, bad = rel.affinity <= -10 || rel.trust <= -15;
  const L: Record<VillagerId, [string[], string[], string[]]> = {
    gena: [['Ела, чедо, ела!', 'Ей го на нашия юнак!'], ['Добър ден, чедо.', 'Здравей, странниче.'], ['Хм, пак ти ли, чедо?']],
    peyu: [['Добре дошъл, приятелю на селото!', 'Аз като кмет те поздравявам!'], ['Добър ден.', 'Редът си е ред — добър ден.'], ['Хм. Странникът…', 'Гледай да не правиш безредие.']],
    petko: [['Абе, здрасти.', 'А, ти ли си. Добре.'], ['Кво?', 'Хм.'], ['Кво зяпаш?', 'Абе, разкарай се.']],
    ivan: [['Здравей.', 'Хм. Добре дошъл.'], ['Хм.', 'Добър ден.'], ['…', 'Хм.']],
    maria: [['Странниче! Пак ли ще ми разказваш за света?', 'Ей, ела насам!'], ['Ей, странниче! Откъде идваш?', 'Добър ден! Ти виждал ли си морето?'], ['Добър ден…']],
    radka: [['Ох, кого виждам! Ела в хана!', 'Чу ли какво стана? Ела, ела!'], ['Заповядай в хана, има топъл боб!', 'Добре дошъл, странниче!'], ['Хм, гледай си работата.']],
    kalin: [['О, здравей! Радвам се да те видя.', 'Здравей, приятелю.'], ['Ако не ти преча… добър ден.', 'Здравей.'], ['…добър ден.']],
  };
  const [g1, g0, gb] = L[id];
  return hpick(good ? g1 : bad ? gb : g0, id, Math.floor(time));
}

/** Резервни убеждения от най-важните спомени (ако мозъкът не върне нищо). */
function deriveBeliefs(v: VillagerState): string[] {
  const top = [...v.memories].sort((a, b) => b.importance - a.importance || b.time - a.time).slice(0, 4).map(m => m.text);
  const out: string[] = [];
  for (const t of top) if (!out.includes(t)) out.push(t);
  return out.slice(0, 5);
}

void hash;
