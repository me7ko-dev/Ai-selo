// Мозък по сценарий: без ИИ, винаги работи, напълно детерминиран по req.seed.
// Богати шаблони на български по характер, отношение, настроение, спомени и ситуация.
import { Rng } from '../../core/rng';
import { VILLAGERS, type VillagerId } from '../../data/villagers';
import type { Memory, Relation } from '../types';
import type {
  Brain, BrainReply, BrainStatus, ChatReply, ChatRequest, Partner, Persona, PlanReply, PlanRequest, ReactRequest,
  ReflectReply, ReflectRequest, RetellReply, RetellRequest, SyncBrain, TalkRequest,
} from './Brain';
import {
  cap, ensurePeriod, eligible, fill, hasFresh, isFemale, isVillagerId, join, lcFirst, makeCtx, nameOf, parseSituation,
  pickFresh, pickMemory, relLevel, sentences, shortOf, tidy, weaveMemory, type Ctx, type RelLevel,
} from './context';
import { detectIntent, type Intent } from './intent';
import { GENERIC, TALK, WEATHER_LINES, type Bank, type TalkCat } from './lines';
import { CHAT_EXTRA, EXTRA } from './lines-extra';
import {
  ABOUT, ABOUT_KALIN_FORGET, ABOUT_OPEN, CHAT, CHAT_PREFIX, FACTS, JOB_LINES, LAMIA_WHERE, LOVE_OTHER, LOVE_SELF, MARIA_LOVES_IVAN,
  MAYOR_SELF, PAIR_CHAT, PLANS, REACT, REACT_GENERIC, ROSEN, VOICE_PREFIX, VOTE_LINES, WORLD_TALK, type ChatDialog, type EventKind,
} from './lines-world';

export const SCRIPTED_LABEL = 'ИИ: няма връзка — жителите говорят по сценарий';

/** Готовите отговори (id), които talkNow разбира. */
export const TALK_OPTION_IDS = [
  'greet', 'news', 'self', 'help', 'lamia', 'river', 'village', 'bye',
  'chickens', 'forest', 'people', 'secret', 'samodivi', 'election', 'weapon', 'world', 'notice',
] as const;
export type TalkOptionId = (typeof TALK_OPTION_IDS)[number];

const STOCK_RUMORS = [
  'Казват, че Петко краде кокошките на Радка.',
  'Казват, че Иван е влюбен в Мария до уши.',
  'Говори се, че кметът дължи пари на някого.',
  'Казват, че Мария крие нещо в стана си.',
  'Разправят, че нощем край кокошарника се мярка нещо с червени очи.',
  'Казват, че Калин майстори нещо тайно по нощите.',
];

/** Кого „предпочита“ да обсъжда всеки, когато го питат за хората. */
const PEOPLE_FAV: Record<VillagerId, VillagerId[]> = {
  gena: ['kalin', 'radka', 'ivan'], peyu: ['radka', 'petko', 'ivan'], petko: ['ivan', 'radka', 'gena'],
  ivan: ['maria', 'petko', 'kalin'], maria: ['ivan', 'radka', 'kalin'], radka: ['petko', 'peyu', 'maria'], kalin: ['gena', 'ivan', 'petko'],
};

const POS = ['помог', 'подар', 'благодар', 'спаси', 'добър', 'добра', 'добре', 'мил', 'харес', 'обич', 'прегърн', 'сдобр', 'похвал', 'донесе', 'усмихн', 'весел', 'радва', 'победи', 'юнак', 'черпи', 'хубав'];
const NEG = ['обид', 'кара', 'скара', 'краде', 'открадн', 'лъж', 'излъга', 'глупа', 'ядос', 'мраз', 'удари', 'обвин', 'вика', 'тъпч', 'сърд', 'заплаш', 'груб', 'нахока', 'подигра'];
export function sentiment(text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of POS) if (t.includes(w)) s += 1;
  for (const w of NEG) if (t.includes(w)) s -= 1;
  if (/не (ми )?помог/.test(t)) s -= 2;
  return s;
}

/** Основните банки + допълнителните реплики, слети веднъж. */
const BANKS: Record<VillagerId, Bank> = Object.fromEntries(Object.entries(TALK).map(([id, bank]) => {
  const extra = EXTRA[id as VillagerId] ?? {};
  const merged: Bank = { ...bank };
  for (const [k, v] of Object.entries(extra) as [TalkCat, string[]][]) merged[k] = [...(merged[k] ?? []), ...v];
  return [id, merged];
})) as Record<VillagerId, Bank>;

const CHATS: Record<string, ChatDialog[]> = { ...CHAT };
for (const [k, v] of Object.entries(CHAT_EXTRA)) CHATS[k] = [...(CHATS[k] ?? []), ...v];

function bankOf(c: Ctx): Bank { return c.vid ? BANKS[c.vid] : GENERIC; }
function lines(c: Ctx, cat: TalkCat): string[] {
  const own = bankOf(c)[cat];
  if (own && eligible(own, c).length) return own;
  return GENERIC[cat] ?? [];
}
function say(c: Ctx, cat: TalkCat, extra?: Record<string, string>): string { return pickFresh(lines(c, cat), c, extra); }

function weatherBit(c: Ctx): string | undefined {
  if (!c.vid) return undefined;
  const ok = eligible(WEATHER_LINES[c.vid], c);
  if (!ok.length) return undefined;
  const t = fill(c.rng.pick(ok), c);
  return c.used.includes(t) ? undefined : t;
}
function moodBit(c: Ctx): string | undefined {
  if (c.mood === 'calm') return undefined;
  const ok = eligible(lines(c, 'mood'), c);
  if (!ok.length) return undefined;
  const t = fill(c.rng.pick(ok), c);
  return c.used.includes(t) ? undefined : t;
}
function closeBit(c: Ctx): string | undefined {
  const l = lines(c, 'close');
  if (!l.length) return undefined;
  const t = fill(c.rng.pick(l), c);
  return c.used.includes(t) ? undefined : t;
}
function voice(c: Ctx | { vid?: VillagerId }, rng: Rng, text: string, p = 0.35, table: Record<VillagerId, string[]> = VOICE_PREFIX): string {
  const vid = c.vid;
  if (!vid || !rng.chance(p)) return text;
  const pre = rng.pick(table[vid]);
  const head = pre.replace(/[,—….\s]+$/, '').toLowerCase();
  if (text.toLowerCase().startsWith(head)) return text;
  if (pre.endsWith('.') || pre.endsWith('…')) return `${pre} ${text}`;
  return `${pre} ${lcFirst(text)}`;
}

/** Студено или топло начало според отношението (понякога). */
function attitude(c: Ctx, core: string): string | undefined {
  if (sentences(core) >= 3) return undefined;
  if (c.rel === 'hostile' && c.rng.chance(0.5)) return say(c, 'cold') || undefined;
  if (c.rel === 'loving' && c.rng.chance(0.3)) return say(c, 'warm') || undefined;
  return undefined;
}

function partnerWho(p: Partner): string { return p.isPlayer || p.id === 'player' ? 'Странникът' : cap(nameOf(p.id, p.name)); }
function g(c: Ctx, m: string, f: string): string { return c.female ? f : m; }

interface Out { say: string; action?: string; mood?: string; remember?: string }

export class ScriptedBrain implements Brain, SyncBrain {
  status(): BrainStatus { return { connected: false, model: '', label: SCRIPTED_LABEL, busy: false, queue: 0 }; }

  /** Без ИИ преразказът е самият текст от летописа (null = остави го). */
  retellNow(req: RetellRequest): RetellReply { return { texts: req.events.map(() => null), ai: false }; }
  retell(req: RetellRequest): Promise<RetellReply> { return Promise.resolve(this.retellNow(req)); }

  // ——————————————— Разговор с играча ———————————————
  talkNow(req: TalkRequest): BrainReply {
    const c = makeCtx(req.speaker, req.partner, req.situation, req.memories, req.history, req.seed);
    let out: Out;
    try {
      out = this.route(c, req);
    } catch {
      out = { say: '' };
    }
    let text = capSentences(tidy(out.say || ''));
    if (!text) text = fill('{hello}, {p}.', c);
    const reply: BrainReply = { say: text, ai: false };
    if (out.action) reply.action = out.action;
    if (out.mood) reply.mood = out.mood;
    if (out.remember) reply.remember = out.remember;
    return reply;
  }

  private route(c: Ctx, req: TalkRequest): Out {
    const opt = req.optionId && (TALK_OPTION_IDS as readonly string[]).includes(req.optionId) ? req.optionId as TalkOptionId : undefined;
    const who = partnerWho(c.partner);
    if (opt) return this.byOption(c, opt, who);
    const it = detectIntent(req.input ?? '', c.id);
    if (it.intent === 'mayor') return this.mayor(c, who);
    if (it.intent === 'love' && it.target && !(c.vid === 'ivan' && it.target === 'maria')) return this.loveAbout(c, it.target, who);
    if (it.intent === 'lamia' && it.word === 'where' && c.vid && !c.sit.lamiaDead) {
      return { say: pickFresh(LAMIA_WHERE[c.vid], c), remember: `${who} ме пита къде е Ламята.` };
    }
    return this.byIntent(c, it.intent, who, it.question, it.target);
  }

  private byOption(c: Ctx, id: TalkOptionId, who: string): Out {
    switch (id) {
      case 'greet': return this.greet(c);
      case 'news': return this.news(c);
      case 'self': return this.self(c, who);
      case 'help': return this.help(c, who);
      case 'lamia': return this.topic(c, 'lamia', who, 'lamia', `${who} ме разпита за Ламята.`);
      case 'river': return this.topic(c, 'river', who, 'river');
      case 'village': return this.topic(c, 'village', who);
      case 'bye': return { say: join([say(c, 'bye')]), action: 'end' };
      case 'chickens': return this.chickens(c, who);
      case 'forest': return this.topic(c, 'forest', who);
      case 'samodivi': return this.topic(c, 'samodivi', who, undefined, c.vid === 'gena' ? `${who} ме пита за самодивите.` : undefined);
      case 'election': return this.topic(c, 'election', who);
      case 'weapon': return this.topic(c, 'weapon', who, undefined, c.vid === 'ivan' || c.vid === 'kalin' ? `${who} пита за оръжие.` : undefined);
      case 'people': {
        const fav = c.vid ? PEOPLE_FAV[c.vid] : (['gena', 'radka'] as VillagerId[]);
        const fresh = fav.filter((t) => !c.used.includes(nameOf(t).split(' ').pop()!));
        return this.person(c, c.rng.pick(fresh.length ? fresh : fav), who);
      }
      case 'secret': return this.secret(c, who);
      case 'world': return this.world(c, who);
      case 'notice': return this.byIntent(c, 'compliment', who, false);
    }
  }

  private byIntent(c: Ctx, intent: Intent, who: string, question: boolean, target?: VillagerId): Out {
    switch (intent) {
      case 'insult': {
        const hostileWalk = c.vid === 'petko' || c.rel === 'hostile';
        return {
          say: join([say(c, 'insulted')]),
          mood: g(c, 'обиден', 'обидена'),
          remember: `${who} ме обиди. Няма да го забравя.`,
          action: hostileWalk ? 'walk_away' : undefined,
        };
      }
      case 'bye': return { say: say(c, 'bye'), action: 'end' };
      case 'thanks': return { say: join([say(c, 'thanks')]), mood: c.mood === 'angry' ? undefined : g(c, 'доволен', 'доволна') };
      case 'compliment': return { say: join([say(c, 'compliment')]), mood: g(c, 'доволен', 'доволна'), remember: `${who} ми каза добра дума.` };
      case 'greet': return this.greet(c);
      case 'secret': return this.secret(c, who);
      case 'person': return target ? this.person(c, target, who) : this.unknown(c, question);
      case 'chickens': {
        if (target && target !== c.id && c.vid !== 'radka' && !(c.vid === 'petko' && target === 'petko')) {
          // „Петко ли краде кокошките?“ — отговор за кокошките + мнение
          return this.chickens(c, who);
        }
        return this.chickens(c, who);
      }
      case 'lamia': return this.topic(c, 'lamia', who, 'lamia', `${who} ме разпита за Ламята.`);
      case 'river': return this.topic(c, 'river', who, 'river');
      case 'samodivi': return this.topic(c, 'samodivi', who);
      case 'talasam': return this.topic(c, 'talasam', who);
      case 'karakondzhul': return this.topic(c, 'karakondzhul', who);
      case 'election': return this.topic(c, 'election', who);
      case 'forest': return this.topic(c, 'forest', who);
      case 'rosen': {
        if (c.vid === 'gena') return this.help(c, who);
        const own = c.vid ? ROSEN[c.vid] : undefined;
        if (own) return { say: pickFresh(own, c) };
        const t = voice(c, c.rng, c.rng.pick(['За росен и билки питай баба Гена. Тя знае всяка трева.', 'Росен ли? Баба Гена знае къде расте. Аз не разбирам от билки.']), 0.6);
        return { say: t };
      }
      case 'love': {
        const r: Out = { say: join([say(c, 'love')]) };
        if (c.vid === 'ivan' || c.vid === 'maria') r.mood = g(c, 'смутен', 'смутена');
        r.remember = `${who} ме пита за любовта.`;
        return r;
      }
      case 'money': {
        const r: Out = { say: join([say(c, 'money')]) };
        if (c.vid === 'peyu') { r.mood = 'смутен'; r.remember = `${who} заговори за пари. Дали знае за дълга ми?`; }
        return r;
      }
      case 'weapon': return this.topic(c, 'weapon', who);
      case 'inn': return this.topic(c, 'inn', who);
      case 'howareyou': return { say: join([say(c, 'howareyou'), c.rng.chance(0.3) ? weatherBit(c) : undefined]) };
      case 'doing': return { say: join([say(c, 'doing')]) };
      case 'whoareyou': return { say: join([say(c, 'whoareyou')]) };
      case 'self': return this.self(c, who);
      case 'village': return this.topic(c, 'village', who);
      case 'news': return this.news(c);
      case 'help': return this.help(c, who);
      case 'weather': {
        const w = weatherBit(c);
        return { say: w ? join([w, c.rng.chance(0.4) ? closeBit(c) : undefined]) : this.unknown(c, question).say };
      }
      case 'introduce': {
        const t = voice(c, c.rng, c.rng.pick(['Стоян, значи. Хубаво име — ще го запомня.', 'Стоян ли? Добре, Стояне. Добре дошъл в Самодивско.', 'Приятно ми е, Стояне.']), 0.7);
        return { say: t, remember: 'Странникът се казва Стоян.' };
      }
      default: return this.unknown(c, question);
    }
  }

  private greet(c: Ctx): Out {
    const cat: TalkCat = c.rel === 'hostile' ? 'greet_foe' : c.rel === 'loving' ? 'greet_love' : c.rel === 'friendly' ? 'greet_friend' : 'greet_neu';
    const core = say(c, cat);
    const extra = c.rng.chance(0.3) ? weatherBit(c) : c.rng.chance(0.35) ? moodBit(c) : undefined;
    return { say: join([core, extra]) };
  }

  private news(c: Ctx): Out {
    const style = c.vid === 'radka' ? 'eager' : c.vid === 'ivan' || c.vid === 'petko' ? 'terse' : 'plain';
    const m = pickMemory(c, { avoidPlayer: c.partner.isPlayer });
    const pMem = c.vid === 'radka' ? 0.8 : c.vid === 'ivan' ? 0.35 : 0.55;
    if (m && c.rng.chance(pMem)) {
      const woven = weaveMemory(m, c, style);
      if (c.vid === 'ivan') return { say: join([woven, 'Хм.'], 2) };
      const tail = c.vid === 'radka' ? c.rng.pick(['Ох, ще видиш!', 'Само на теб го казвам!', 'Цялото село ще говори!']) : c.rng.chance(0.3) ? closeBit(c) : undefined;
      return { say: join([woven, tail]) };
    }
    const core = say(c, 'news');
    const extra = c.vid === 'radka' && c.rng.chance(0.5) ? say(c, 'close') : undefined;
    return { say: join([attitude(c, core), core, extra]) };
  }

  private self(c: Ctx, who: string): Out {
    const revealed = this.revealedBefore(c);
    if (c.trust >= 70 && !revealed && c.rng.chance(0.6)) {
      return { say: say(c, 'reveal'), remember: `Казах на ${who === 'Странникът' ? 'странника' : who} тайната си. Дано не съм сбъркал${c.female ? 'а' : ''}.`, mood: g(c, 'облекчен', 'облекчена') };
    }
    const core = say(c, 'self');
    const hint = c.trust >= 40 && c.rng.chance(0.5) ? say(c, 'hint') : undefined;
    return { say: join([hint ? undefined : attitude(c, core), core, hint]) };
  }

  private secret(c: Ctx, who: string): Out {
    if (c.trust >= 70) {
      return { say: say(c, 'reveal'), remember: `Казах на ${who === 'Странникът' ? 'странника' : who} тайната си.`, mood: g(c, 'облекчен', 'облекчена') };
    }
    if (c.trust >= 40) return { say: say(c, 'hint') };
    return { say: join([say(c, 'nosecret')]) };
  }

  private revealedBefore(c: Ctx): boolean {
    const rev = lines(c, 'reveal').map((t) => fill(t, c));
    return rev.some((r) => c.used.includes(r));
  }

  private help(c: Ctx, who: string): Out {
    const core = say(c, 'help');
    const out: Out = { say: join([attitude(c, core), core]), remember: `${who} предложи да ми помогне.` };
    if ((c.vid === 'gena' && !c.sit.lamiaDead && /росен/.test(core)) || (c.vid === 'radka' && /кокош/.test(core))) out.action = 'give_quest';
    return out;
  }

  private chickens(c: Ctx, who: string): Out {
    let core: string;
    if (c.vid === 'radka' && c.trust >= 70 && hasFresh(lines(c, 'reveal'), c) && c.rng.chance(0.6)) core = say(c, 'reveal');
    else core = say(c, 'chickens');
    return { say: join([core]), remember: `${who} ме пита за кокошките на Радка.` };
  }

  private world(c: Ctx, who: string): Out {
    if (c.vid === 'maria') {
      const t = c.rng.pick([
        'Наистина ли ще ми разкажеш?! Морето — какво е? Синьо ли е като шевиците ми или зелено като гората?',
        'Ох, да! Разкажи ми за големите градове. Вярно ли е, че къщите там са една върху друга?',
        'Слушам те с цялото си сърце, {p}. Откъде идваш? Колко планини си минал?',
      ]);
      return { say: fill(t, c), mood: 'щастлива', remember: `${who} ми разказа за света отвъд планините.` };
    }
    const own = c.vid ? WORLD_TALK[c.vid] : undefined;
    if (own) return { say: pickFresh(own, c) };
    return { say: voice(c, c.rng, c.rng.pick(['За света ли? Разкажи го на Мария — тя ще те слуша с отворена уста.', 'Светът си е свят. На мен ми стига Самодивско.']), 0.6) };
  }

  /** „Какво мислиш за кмета?“ — истинският кмет е в ситуацията („Кмет е Радка.“); иначе е дядо Пею. */
  private mayor(c: Ctx, who: string): Out {
    const m = /кмет е ([^.]+)\./iu.exec(c.sit.raw);
    const name = m ? m[1].trim().toLowerCase() : '';
    const mayor = (Object.keys(VILLAGERS) as VillagerId[]).find((id) => VILLAGERS[id].name.toLowerCase() === name) ?? 'peyu';
    if (mayor === c.id && c.vid) return { say: pickFresh(MAYOR_SELF[c.vid], c), remember: `${who} ме пита какъв кмет съм.` };
    return this.person(c, mayor, who);
  }

  /** „Обичаш ли {T}?“ */
  private loveAbout(c: Ctx, target: VillagerId, who: string): Out {
    const remember = `${who} ме пита обичам ли ${target === c.id ? 'себе си' : nameOf(target)}.`;
    if (!c.vid) return this.person(c, target, who);
    if (target === c.id) return { say: pickFresh(LOVE_SELF[c.vid], c), remember };
    if (c.vid === 'maria' && target === 'ivan') return { say: pickFresh(MARIA_LOVES_IVAN, c), mood: 'смутена', remember };
    const tProf = VILLAGERS[target];
    const sub: Ctx = { ...c, partnerFemale: tProf.gender === 'f' };
    let core = pickFresh(LOVE_OTHER[c.vid], sub, { T: tProf.name });
    core = cap(core);
    let tail: string | undefined;
    if (target === 'maria' && c.vid !== 'ivan' && c.rng.chance(0.6)) tail = c.vid === 'radka' ? 'Ама Иван — Иван я обича до уши! Цялото село знае.' : 'А Иван — той я обича истински. Ама шшт.';
    else if (target === 'ivan' && c.vid !== 'maria' && c.rng.chance(0.6)) tail = 'Ама ако питаш за сърдечни работи — питай Мария. Тя знае най-добре.';
    return { say: join([core, tail]), remember };
  }

  private topic(c: Ctx, cat: TalkCat, who: string, memAbout?: string, remember?: string): Out {
    const core = say(c, cat);
    let extra: string | undefined;
    if (memAbout) {
      const m = pickMemory(c, { about: memAbout, avoidPlayer: c.partner.isPlayer });
      if (m && c.rng.chance(0.4)) extra = weaveMemory(m, c, c.vid === 'radka' ? 'eager' : c.vid === 'ivan' ? 'terse' : 'plain');
    }
    if (!extra && c.rng.chance(0.15)) extra = closeBit(c);
    const out: Out = { say: join([extra ? undefined : attitude(c, core), core, extra]) };
    if (remember) out.remember = remember;
    return out;
  }

  private person(c: Ctx, target: VillagerId, who: string): Out {
    const tProf = VILLAGERS[target];
    const remember = `${who} ме пита за ${nameOf(target)}.`;
    if (target === c.id) return { say: say(c, 'whoareyou') };
    const special = c.vid ? ABOUT[c.vid]?.[target] : undefined;
    let core: string | undefined;
    if (special && c.rng.chance(0.85)) {
      core = pickFresh(special, c);
    } else if (target === 'kalin' && c.vid !== 'gena' && c.vid !== 'maria' && c.vid !== 'kalin' && c.rng.chance(0.6)) {
      core = c.rng.pick(ABOUT_KALIN_FORGET);
    }
    if (!core) {
      const base = c.vid ? VILLAGERS[c.vid].relations[target] : undefined;
      const lvl: RelLevel = relLevel(base);
      const sub: Ctx = { ...c, partnerFemale: tProf.gender === 'f' };
      const open = fill(c.rng.pick(ABOUT_OPEN[lvl]), sub, { T: tProf.name.split(' ').length > 1 ? tProf.name : tProf.short });
      const fact = c.rng.pick(FACTS[target]);
      core = c.vid === 'ivan' ? `${tProf.short}. Хм. ${fact}` : `${cap(open)} ${fact}`;
    }
    // клюка/спомен за този човек
    const m = pickMemory(c, { about: target, avoidPlayer: c.partner.isPlayer });
    let extra: string | undefined;
    if (m && c.rng.chance(c.vid === 'radka' ? 0.7 : 0.4)) extra = weaveMemory(m, c, c.vid === 'radka' ? 'eager' : c.vid === 'ivan' ? 'terse' : 'plain');
    else if (c.rng.chance(0.2)) extra = closeBit(c);
    return { say: join([core, extra]), remember };
  }

  private unknown(c: Ctx, question: boolean): Out {
    const core = say(c, question ? 'deflect_q' : 'deflect_s');
    const extra = c.rng.chance(0.4) ? weatherBit(c) ?? moodBit(c) : undefined;
    return { say: join([core, extra]) };
  }

  // ——————————————— Двама жители си говорят ———————————————
  chatNow(req: ChatRequest): ChatReply {
    try { return this.chatImpl(req); } catch {
      return { lines: [{ who: req.a.id, text: 'Как си?' }, { who: req.b.id, text: 'Горе-долу. Ти?' }], summary: `${cap(nameOf(req.a.id, req.a.name))} и ${nameOf(req.b.id, req.b.name)} си размениха по някоя дума.`, affinityDelta: 0, ai: false };
    }
  }

  private chatImpl(req: ChatRequest): ChatReply {
    const rng = new Rng((req.seed ^ 0x2c1b3c6d) >>> 0);
    const sit = parseSituation(req.situation);
    const a = req.a, b = req.b;
    const topic = CHATS[req.topic] || PAIR_CHAT[`${req.topic}:${[a.id, b.id].sort().join(':')}`] ? req.topic : 'greeting';
    const ctxA = this.chatCtx(a, b, req.relationAB, req, rng);
    const ctxB = this.chatCtx(b, a, req.relationBA, req, rng);
    const bothF = isFemale(a) && isFemale(b);
    const names = { A: nameOf(a.id, a.name), B: nameOf(b.id, b.name), Both: bothF ? 'И двете' : 'И двамата' };

    // 1) особени двойки
    const key = `${topic}:${[a.id, b.id].sort().join(':')}`;
    const pairs = (PAIR_CHAT[key] ?? []).filter((d) => !d.cond || ctxOk(d.cond, ctxA));
    if (pairs.length && (topic === 'love' || topic === 'quarrel' || rng.chance(0.85))) {
      const d = rng.pick(pairs);
      const out = d.lines.map(([vid, tpl]) => {
        const sc = vid === a.id ? ctxA : ctxB;
        return { who: vid as string, text: fill(tpl, sc) };
      });
      const summary = fill(rng.pick(d.summary), ctxA, names);
      return { lines: out, summary: capSentences(ensurePeriod(summary)), affinityDelta: rng.int(d.delta[0], d.delta[1]), ai: false };
    }

    // 2) любов, когато единият е Иван или Мария — закачка
    if (topic === 'love' && (a.id === 'ivan' || a.id === 'maria' || b.id === 'ivan' || b.id === 'maria')) {
      const lover = a.id === 'ivan' || a.id === 'maria' ? b : a; // който закача
      const target = lover === a ? b : a;
      const lc = lover === a ? ctxA : ctxB, tc = lover === a ? ctxB : ctxA;
      const other = target.id === 'ivan' ? 'Мария' : 'Иван';
      const l1 = target.id === 'ivan' ? fill(`Кога ще събереш смелост, {p}? ${other} няма да чака вечно.`, lc) : fill('Иван пак те гледаше, {p}. Цял ден не откъсна очи от стана ти.', lc);
      const l2 = target.id === 'ivan' ? fill('Хм… Не знам за какво говориш.', tc) : fill('Ох, стига! …Наистина ли?', tc);
      const lines = [{ who: lover.id, text: voice(lc, rng, l1) }, { who: target.id, text: l2 }];
      const summary = `${cap(nameOf(lover.id, lover.name))} подкачи ${nameOf(target.id, target.name)} за ${target.id === 'ivan' ? 'Мария' : 'Иван'}. ${target.id === 'ivan' ? 'Иван се изчерви и замълча.' : 'Мария се изчерви.'}`;
      return { lines, summary, affinityDelta: rng.int(1, 4), ai: false };
    }

    // 3) общ диалог по темата
    let t = topic;
    if (relLevel(req.relationAB) === 'hostile' && (t === 'greeting' || t === 'weather' || t === 'work') && rng.chance(0.6)) t = 'cold';
    const pool = (CHATS[t] ?? CHATS.greeting).filter((d: ChatDialog) => !d.cond || ctxOk(d.cond, ctxA));
    const dialog = rng.pick(pool.length ? pool : CHATS.greeting);
    const shortA = shortOf(a.id, a.name), shortB = shortOf(b.id, b.name);
    const stock = STOCK_RUMORS.filter((r) => !r.includes(shortA) && !r.includes(shortB));
    const rumorText = ensurePeriod((req.rumor && req.rumor.trim()) || rng.pick(stock.length ? stock : STOCK_RUMORS));
    const opA = this.opinionOfPlayer(ctxA, req.memoriesA, rng);
    const opB = this.opinionOfPlayer(ctxB, req.memoriesB, rng);
    const extra = (sc: Ctx): Record<string, string> => ({
      rumor: rumorText,
      rumorq: rumorText.replace(/[.!]+$/, ''),
      job: sc.vid ? rng.pick(JOB_LINES[sc.vid]) : 'Върви си.',
      vote: sc.vid ? rng.pick(VOTE_LINES[sc.vid]) : 'Тайна е.',
      opinionA: opA.text, opinionB: opB.text,
    });
    const used = new Set<string>();
    const voiced = new Set<string>();
    const out = dialog.lines.map(([role, tpl]) => {
      const sc = role === 'a' ? ctxA : ctxB;
      let text = fill(tpl, sc, extra(sc));
      const plain = !/\{(job|vote|opinion|rumor)/.test(tpl);
      if (plain && role === 'a' && !voiced.has(role) && /\.$/.test(text) && text.split(/\s+/).length >= 4) {
        const v = voice(sc, rng, text, 0.3, CHAT_PREFIX);
        if (v !== text) voiced.add(role);
        text = v;
      }
      if (plain && sc.vid === 'ivan' && text.split(/\s+/).length > 10) text = text.split(/(?<=[.!?])\s/)[0];
      if (used.has(text)) text = text + ' ' + (role === 'a' ? 'Да.' : 'Така е.');
      used.add(text);
      return { who: role === 'a' ? a.id : b.id, text: tidy(text) };
    });
    let summary = fill(rng.pick(dialog.summary), ctxA, { ...names, rumorq: rumorText.replace(/[.!]+$/, '') });
    if (t === 'stranger') {
      const s = opB.score;
      summary += s > 0 ? ` ${cap(names.B)} го хвали.` : s < 0 ? ` ${cap(names.B)} не му вярва.` : ' Никой още не знае какъв човек е.';
    }
    const delta: Record<string, [number, number]> = {
      quarrel: [-8, -3], cold: [-2, 0], love: [2, 5], gossip: [1, 3], fear: [1, 3], festival: [2, 5], stranger: [0, 2],
      greeting: [0, 2], weather: [0, 2], river: [1, 2], work: [0, 2], lamia: [1, 2], election: [-2, 2],
    };
    const [lo, hi] = delta[t] ?? [0, 2];
    void sit;
    return { lines: out, summary: capSentences(ensurePeriod(tidy(summary))), affinityDelta: rng.int(lo, hi), ai: false };
  }

  private chatCtx(sp: Persona, other: Persona, rel: Relation, req: ChatRequest, rng: Rng): Ctx {
    const partner: Partner = { id: other.id, name: other.name, isPlayer: false, relation: rel };
    const c = makeCtx(sp, partner, req.situation, sp === req.a ? req.memoriesA : req.memoriesB, [], rng.fork());
    return c;
  }

  private opinionOfPlayer(c: Ctx, memories: Memory[], rng: Rng): { text: string; score: number } {
    const ms = (memories ?? []).filter((m) => m && (m.about?.includes('player') || /странник/i.test(m.text)));
    const score = ms.reduce((s, m) => s + Math.sign(sentiment(m.text)) * m.importance, 0);
    let text: string;
    if (!ms.length) text = rng.pick(['Не знам. Не съм [говорил/говорила] с него.', 'Чужденец е. Ще видим какъв е.', 'Още не мога да кажа нищо за него.']);
    else if (score > 0) text = rng.pick(['Добър човек е. Има честни очи.', 'Харесвам го. Помага, без да чака нещо.', 'На него може да се вярва, [мисля/мисля].']);
    else if (score < 0) text = rng.pick(['Не му вярвам.', 'Държи се грубо. Не ми харесва.', 'Пази се от него.']);
    else text = rng.pick(['Разпитва много. Чудя се какво търси.', 'Странен е. Ама не е лош.']);
    const m = ms.length ? [...ms].sort((x, y) => y.importance - x.importance || y.time - x.time)[0] : undefined;
    let out = fill(text, c);
    if (m && rng.chance(0.6)) out = `${out} ${rng.pick(['Ще ти кажа само това —', 'Знаеш ли —'])} ${lcFirst(ensurePeriod(m.text.trim()))}`;
    if (c.vid === 'ivan') out = out.split(/(?<=[.!?])\s/)[0];
    else out = voice(c, rng, out, 0.3, CHAT_PREFIX);
    return { text: tidy(out), score };
  }

  // ——————————————— Реакция на случка ———————————————
  reactNow(req: ReactRequest): BrainReply {
    try { return this.reactImpl(req); } catch { return { say: 'Ох, какво стана?!', ai: false }; }
  }

  private reactImpl(req: ReactRequest): BrainReply {
    const c = makeCtx(req.speaker, { id: 'all', name: 'селото', isPlayer: false }, req.situation, req.memories, [], req.seed);
    const kind = classifyEvent(req.event);
    let text: string;
    let mood: string | undefined;
    if (kind === 'election') {
      const r = this.electionReaction(c, req.event);
      text = r.say; mood = r.mood;
    } else {
      const own = c.vid ? REACT[c.vid][kind] : undefined;
      const aboutMe = !!c.prof && (kind === 'player_good' || kind === 'player_bad') && req.event.includes(c.prof.short);
      const pool = aboutMe ? (kind === 'player_good' ? PERSONAL_GOOD : PERSONAL_BAD) : own?.length ? own : REACT_GENERIC[kind];
      text = fill(c.rng.pick(pool), c);
      if (aboutMe || !own?.length) text = voice(c, c.rng, text, 0.6);
      mood = moodFor(kind, c);
    }
    const reply: BrainReply = { say: tidy(text), ai: false };
    if (mood) reply.mood = mood;
    const rem = rememberFor(kind, req.event, c);
    if (rem) reply.remember = rem;
    return reply;
  }

  private electionReaction(c: Ctx, event: string): { say: string; mood?: string } {
    const winner = (Object.values(VILLAGERS).find((v) => event.includes(v.short)) ?? null);
    if (winner && winner.id === c.id) {
      const t = c.vid === 'peyu' ? 'Аз пак съм кмет! Редът си е ред — селото знае кого да избере.'
        : c.vid === 'radka' ? 'Аз — кмет?! Ох, ама да си остане между нас — знаех си!'
          : c.vid === 'petko' ? 'Абе… мене ли избраха? Ми… добре. Ще се опитам.'
            : c.vid === 'ivan' ? 'Хм. Кмет. Думата ми е дума — ще се старая.'
              : c.vid === 'maria' ? 'Аз?! Представи си! Ще направя селото по-светло, обещавам!'
                : c.vid === 'kalin' ? 'Аз?… Някой ме е забелязал? Благодаря… извинявайте, развълнуван съм.'
                  : 'Мене ли избраха? Ей го на, на стари години — кметица! Е, ще ви уча на ред и на билки.';
      return { say: t, mood: g(c, 'горд', 'горда') };
    }
    if (c.vid === 'peyu' && winner && winner.id !== 'peyu') {
      return { say: `Значи ${winner.name} ще е кмет… Едно време селото ценеше опита. Е, редът си е ред.`, mood: 'тъжен' };
    }
    const name = winner ? winner.name : 'новият кмет';
    const pool = c.vid === 'petko' ? [`Абе, ${name}. Все тая.`] : c.vid === 'ivan' ? [`Хм. ${cap(name)}. Добре.`]
      : c.vid === 'radka' ? [`${cap(name)} — кмет! Ох, ще има да се говори!`]
        : [`Значи ${name} е кметът. Дано е за добро.`, `${cap(name)} спечели изборите. Ще видим как ще управлява.`];
    return { say: fill(c.rng.pick(pool), c) };
  }

  // ——————————————— План за деня ———————————————
  planNow(req: PlanRequest): PlanReply {
    try { return this.planImpl(req); } catch { return { plan: 'Ще си гледам работата.', ai: false }; }
  }

  private planImpl(req: PlanRequest): PlanReply {
    const c = makeCtx(req.speaker, { id: 'all', name: 'селото', isPlayer: false }, req.situation, req.memories, [], (req.seed ^ (parseSituation(req.situation).day * 7919)) >>> 0);
    const pool = c.vid ? eligible(PLANS[c.vid], c) : ['Ще си гледам работата.', 'Ще мина през мегдана да чуя какво ново.'];
    let plan = fill(c.rng.pick(pool.length ? pool : ['Ще си гледам работата.']), c);
    // спомен може да промени плана
    const m = pickMemory(c, {});
    if (m && m.importance >= 6 && c.rng.chance(0.5)) {
      const target = (m.about ?? []).find((x) => isVillagerId(x) && x !== c.id) as VillagerId | undefined;
      const s = sentiment(m.text);
      if (target) {
        const tn = nameOf(target);
        plan += s < 0 ? ` И ще стоя по-далеч от ${tn}.` : s > 0 ? ` И ще мина да видя ${tn}.` : '';
      } else if (m.about?.includes('player')) {
        plan += s < 0 ? ' Ако видя странника — ще го заобиколя.' : ' Ако видя странника — ще го поздравя.';
      }
    }
    return { plan: tidy(plan), ai: false };
  }

  // ——————————————— Вечерен размисъл ———————————————
  reflectNow(req: ReflectRequest): ReflectReply {
    try { return this.reflectImpl(req); } catch { return { beliefs: (req.beliefs ?? []).slice(0, 5), ai: false }; }
  }

  private reflectImpl(req: ReflectRequest): ReflectReply {
    const rng = new Rng((req.seed ^ 0x7f4a7c15) >>> 0);
    const female = isFemale(req.speaker);
    const self = req.speaker.id;
    type Agg = { pos: number; neg: number; weight: number; texts: string[] };
    const by = new Map<string, Agg>();
    const add = (k: string, m: Memory) => {
      const a = by.get(k) ?? { pos: 0, neg: 0, weight: 0, texts: [] };
      const s = sentiment(m.text);
      if (s > 0) a.pos += m.importance; else if (s < 0) a.neg += m.importance;
      a.weight += m.importance; a.texts.push(m.text);
      by.set(k, a);
    };
    let flowing = false, lamiaDead = false;
    for (const m of req.memories ?? []) {
      if (!m || typeof m.text !== 'string') continue;
      const t = m.text.toLowerCase();
      if (/тече|потече|водата се върна/.test(t)) flowing = true;
      if (/ламята[^.]*(победен|мъртва|убит)|победи ламята|уби ламята/.test(t)) lamiaDead = true;
      const subjects = new Set<string>((m.about ?? []).filter((x) => x !== self));
      if (!subjects.size) {
        if (/странник/.test(t)) subjects.add('player');
        if (/река|бистриц|вода/.test(t)) subjects.add('river');
        if (/ламя/.test(t)) subjects.add('lamia');
        if (/кокош/.test(t)) subjects.add('chickens');
        for (const v of Object.values(VILLAGERS)) if (v.id !== self && t.includes(v.short.toLowerCase())) subjects.add(v.id);
      }
      for (const s of subjects) add(s, m);
    }
    const scored: { key: string; text: string; w: number }[] = [];
    for (const [key, a] of by) {
      const net = a.pos - a.neg;
      const w = a.weight + Math.abs(net);
      let text: string | undefined;
      if (key === 'player') {
        text = net >= 3 ? rng.pick(['Странникът ми помогна. Може би на него може да се вярва.', 'Странникът е добър човек. И аз ще му помагам.'])
          : net <= -3 ? rng.pick(['Странникът ме обиди. Трябва да внимавам с него.', 'Не вярвам на странника.'])
            : rng.pick(['Странникът разпитва много. Чудя се какво търси в Самодивско.', 'Още не знам какъв човек е странникът.']);
      } else if (isVillagerId(key)) {
        const v = VILLAGERS[key];
        const pron = v.gender === 'f' ? 'нея' : 'него';
        text = net >= 3 ? `${cap(v.name)} е ${v.gender === 'f' ? 'добра душа' : 'добър човек'}. Мога да разчитам на ${pron}.`
          : net <= -3 ? `${cap(v.name)} ме ядосва. По-добре да стоя настрана от ${pron}.`
            : `${cap(v.name)} напоследък ми е на ума.`;
      } else if (key === 'river') {
        text = flowing ? 'Реката пак тече. Животът се връща в Самодивско.' : 'Без вода селото ще загине. Някой трябва да прогони Ламята.';
      } else if (key === 'lamia') {
        text = lamiaDead ? 'Ламята я няма — вече не се страхувам.' : 'Ламята е голямата беда на селото.';
      } else if (key === 'chickens') {
        text = req.speaker.id === 'radka' ? 'Някой ми краде кокошките. Трябва да разбера кой — и тогава ще види той!'
          : req.speaker.id === 'petko' ? 'Радка ме мисли за крадец. А кокошките ги взима нещо от гората.'
            : 'Някой краде кокошките на Радка. Трябва да се разбере кой.';
      } else if (key === 'election') {
        text = 'Изборите наближават. Кой ли ще е кмет?';
      } else if (key === 'love') {
        text = female ? 'Сърцето ми е неспокойно напоследък.' : 'Сърцето ми е неспокойно напоследък.';
      }
      if (text) scored.push({ key, text, w });
    }
    scored.sort((x, y) => y.w - x.w || x.key.localeCompare(y.key));
    const fresh = scored.slice(0, 5);
    const coveredKeys = new Set(fresh.map((f) => f.key));
    const subjOf = (b: string): string | undefined => {
      const t = b.toLowerCase();
      if (/странник/.test(t)) return 'player';
      if (/река|бистриц|вода/.test(t)) return 'river';
      if (/ламя/.test(t)) return 'lamia';
      if (/кокош/.test(t)) return 'chickens';
      for (const v of Object.values(VILLAGERS)) if (t.includes(v.short.toLowerCase())) return v.id;
      return undefined;
    };
    const keep = (req.beliefs ?? []).filter((b) => typeof b === 'string' && b.trim() && !coveredKeys.has(subjOf(b) ?? '#'));
    const out: string[] = [];
    // най-силните нови първо, после старите (до 5)
    for (const f of fresh) if (out.length < 5 && !out.includes(f.text)) out.push(f.text);
    for (const b of keep) if (out.length < 5 && !out.includes(b)) out.push(b);
    return { beliefs: out, ai: false };
  }

  async talk(req: TalkRequest) { return this.talkNow(req); }
  async chat(req: ChatRequest) { return this.chatNow(req); }
  async react(req: ReactRequest) { return this.reactNow(req); }
  async plan(req: PlanRequest) { return this.planNow(req); }
  async reflect(req: ReflectRequest) { return this.reflectNow(req); }
}

const PERSONAL_GOOD = ['Странникът ми помогна! Няма да го забравя.', 'Не съм [очаквал/очаквала] такава доброта от чужд човек. Благодарен[/а] съм му.', 'Ей това се казва човек — помогна ми, без да му се моля.'];
const PERSONAL_BAD = ['Странникът ме нарани. Няма да му простя лесно.', 'Как можа да ми направи такова нещо! Срамота!', 'Ще го запомня това на странника.'];

/** Главна буква в началото на всяко изречение („… баба Гена не повярва.“ → „… Баба Гена не повярва.“). */
export function capSentences(t: string): string {
  return t.replace(/(^|[.!?]\s+)([а-яё])/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}

function ctxOk(cond: string, c: Ctx): boolean {
  return eligible([`#${cond} x`], c).length > 0;
}

export function classifyEvent(event: string): EventKind {
  const t = (event || '').toLowerCase();
  if (/^storm$|буря|гръм|гърм|светкав/.test(t)) return 'storm';
  if (/karakondzhul|караконджул/.test(t)) return 'karakondzhul';
  if (/samodiv|самодив/.test(t)) return 'samodivi';
  if (/lamia_dead|lamia.?defeat|ламята[^.]*(победен|мъртва|убит|падна)|победи ламята|уби ламята/.test(t)) return 'lamia_dead';
  if (/river|реката[^.]*тече|бистрица[^.]*тече|потече|водата се върна/.test(t)) return 'river';
  if (/sabor|festival|сбор|празник/.test(t)) return 'sabor';
  if (/election|избор|кмет/.test(t)) return 'election';
  if (/theft|краж|краде|открадн|кокош/.test(t)) return 'theft';
  if (/talasam|таласъм/.test(t)) return 'talasam';
  if (/player|странник/.test(t)) {
    const s = sentiment(t);
    if (s > 0 || /помог|донесе|спаси|уби|победи/.test(t)) return 'player_good';
    if (s < 0) return 'player_bad';
    return 'player_good';
  }
  return 'other';
}

function moodFor(kind: EventKind, c: Ctx): string | undefined {
  const G = (m: string, f: string) => (c.female ? f : m);
  switch (kind) {
    case 'storm': return G('уплашен', 'уплашена');
    case 'karakondzhul': return G('уплашен', 'уплашена');
    case 'talasam': return G('уплашен', 'уплашена');
    case 'theft': return c.vid === 'radka' || c.vid === 'petko' ? G('ядосан', 'ядосана') : G('загрижен', 'загрижена');
    case 'samodivi': return G('замислен', 'замислена');
    case 'sabor': return G('весел', 'весела');
    case 'lamia_dead': return G('щастлив', 'щастлива');
    case 'river': return G('щастлив', 'щастлива');
    case 'player_good': return G('доволен', 'доволна');
    case 'player_bad': return G('сърдит', 'сърдита');
    default: return undefined;
  }
}

function rememberFor(kind: EventKind, event: string, c: Ctx): string | undefined {
  const t = (event || '').trim();
  const cyr = (t.match(/[а-яё]/gi) ?? []).length;
  if (cyr >= 6 && cyr / Math.max(1, (t.match(/[a-zа-яё]/gi) ?? []).length) > 0.7) return ensurePeriod(t);
  switch (kind) {
    case 'storm': return 'Имаше страшна буря над селото.';
    case 'karakondzhul': return 'Караконджулът обикаляше селото. Цяла нощ не мигнах.';
    case 'samodivi': return 'Самодивите играха на поляната.';
    case 'sabor': return 'В селото имаше сбор с хоро и огън.';
    case 'lamia_dead': return 'Ламята е победена! Странникът я надви.';
    case 'river': return 'Бистрица пак тече.';
    case 'theft': return 'Пак откраднаха кокошка от Радка.';
    case 'talasam': return 'Таласъми обикаляха около селото.';
    default: return undefined;
  }
  void c;
}
