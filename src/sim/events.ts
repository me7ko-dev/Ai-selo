// Генератор на случки (със семе): кражби на кокошки, кози в нивата, любов, работа, времето, избори,
// и случките отвън (буря, Караконджул, самодиви, сбор, кражба, по желание).
import { isDarkish } from '../core/time';
import { dist, nearestPlace, type PlaceId } from '../data/layout';
import { VILLAGER_IDS, VILLAGERS, type VillagerId } from '../data/villagers';
import type { InjectedEvent, Rumor, VillagerState, Weather, WorldState } from './types';
import type { VillageSim } from './VillageSim';
import { addMemory } from './memory';
import { LOC, Name, cap, g, hash, hpick, joinNames, nameOf } from './text';

const H = (h: number, m = 0) => h * 60 + m;

/** Като hpick, но не повтаря последния избран вариант за същия ключ (помни го в s.flags → влиза в записите). */
export function pickNew<T>(s: WorldState, key: string, arr: readonly T[], ...salt: (string | number)[]): T {
  const k = 'pick_' + key, n = arr.length;
  if (n <= 1) return arr[0];
  let i = hash(key, ...salt) % n;
  if (s.flags[k] === i) i = (i + 1 + (hash(key, 'skip', ...salt) % (n - 1))) % n;
  s.flags[k] = i;
  return arr[i];
}

// ───────────────────────── слухове в началото ─────────────────────────

export function initialRumors(s: WorldState) {
  const V = (id: VillagerId) => s.villagers[VILLAGER_IDS.indexOf(id)];
  const add = (r: Omit<Rumor, 'id' | 'time'>, knowers: [VillagerId, number][]) => {
    const rumor: Rumor = { id: s.nextId++, time: s.time, ...r };
    s.rumors.push(rumor);
    for (const [id, b] of knowers) { const v = V(id); v.knownRumors.push(rumor.id); v.rumorBelief![String(rumor.id)] = b; }
  };
  add({ topic: 'chickens', tag: 'petko_thief', text: 'Петко краде кокошките от кокошарника на хана.', about: ['petko'], truth: false, origin: 'radka', sentiment: -1 },
    [['radka', 0.9], ['ivan', 0.7], ['peyu', 0.4], ['petko', -1]]);
  add({ topic: 'chickens', tag: 'fox', text: 'Нощем край кокошарника се мярка лисица със светещи очи — таласъм от гората.', about: ['fox'], truth: true, origin: 'gena', sentiment: 0 },
    [['gena', 0.7], ['kalin', 0.5], ['radka', 1]]);
  add({ topic: 'goats', tag: 'goats', text: 'Козите на Петко пак тъпчат нивата на Иван — и то не случайно.', about: ['petko', 'ivan'], truth: true, origin: 'ivan', sentiment: -1 },
    [['ivan', 1], ['peyu', 0.6], ['petko', 1]]);
  add({ topic: 'debt', tag: 'debt', text: 'Дядо Пею дължи пари на Радка и не може да ги върне.', about: ['peyu'], truth: true, origin: 'radka', sentiment: -1 },
    [['radka', 1], ['peyu', 1]]);
  add({ topic: 'lamia', tag: 'lamia', text: 'Ламята седи на извора на Бистрица и пие водата на цялото село.', about: ['lamia'], truth: true, origin: 'gena', sentiment: 0 },
    VILLAGER_IDS.map(id => [id, 0.9] as [VillagerId, number]));
}

const DISTORT: Record<string, { text: string; truth: boolean }[]> = {
  petko_thief: [{ text: 'Петко краде по три кокошки на нощ и ги продава отвъд гората!', truth: false }],
  fox: [{ text: 'В Тъмната гора живее лисица-таласъм с очи като въглени — който я погледне, онемява!', truth: false }],
  goats: [{ text: 'Петко нарочно пуска козите в нивата на Иван — иска да го съсипе!', truth: true }],
  debt: [{ text: 'Дядо Пею дължи на Радка цяла торба жълтици!', truth: false }],
  love: [{ text: 'Иван и Мария тайно ще се женят — Иван вече кове пръстен!', truth: false }],
  samodivi: [{ text: 'Самодивите омагьосали човек от селото — три нощи не можал да заспи!', truth: false }],
  theft: [{ text: 'В селото има крадец — нощем обикаля и прибира всичко, което блести!', truth: false }],
};

/** Изкривен вариант на слух (или undefined, ако вече има такъв / няма шаблон). */
export function distortion(s: WorldState, r: Rumor, by: string): Rumor | undefined {
  const base = r.parent ? s.rumors.find(x => x.id === r.parent) ?? r : r;
  const opts = DISTORT[base.tag ?? '']; if (!opts) return undefined;
  if (s.rumors.some(x => x.parent === base.id)) return undefined;
  const o = opts[0];
  const d: Rumor = { id: s.nextId++, time: Math.floor(s.time), topic: base.topic, tag: base.tag, text: o.text, about: [...base.about], truth: o.truth, origin: by, sentiment: base.sentiment, parent: base.id };
  s.rumors.push(d);
  return d;
}

// ───────────────────────── всяка минута ─────────────────────────

export function worldTick(sim: VillageSim) {
  const s = sim.s, f = s.flags, mod = sim.mod, day = sim.day, t = s.time;
  // край на бурята / Караконджула
  if (f.storm_until !== undefined && Number(f.storm_until) <= t) {
    delete f.storm_until; s.weather = 'rain';
    if (!f.river_flowing && !f.lamia_dead) sim.chronicle('weather', 'Бурята отмина. Дядо Пею се надяваше поне тя да напълни Бистрица — но сухото корито попи водата за час.', ['peyu'], 2, 'storm_end');
  }
  if (f.karakondzhul_until !== undefined && Number(f.karakondzhul_until) <= t) {
    delete f.karakondzhul_until;
    sim.chronicle('monster', 'Тропотът утихна — Караконджулът си отиде. Хората дълго не смееха да отворят вратите.', [], 3, 'karakondzhul_end');
  }
  // вестта за Ламята
  if (f.lamia_dead && !f.lamia_news) {
    f.lamia_news = day;
    sim.chronicle('festival', 'Вестта, че Ламята е мъртва, обиколи Самодивско по-бързо от вятъра. Хората излизаха от къщите, прегръщаха се и тичаха към моста да видят как Бистрица отново тече.', ['player', ...VILLAGER_IDS], 9, 'lamia_news');
    for (const v of s.villagers) { addMemory(s, v, 'Ламята е мъртва! Странникът я победи и реката пак тече.', 9, ['lamia', 'river', 'player']); sim.feel(v.id, 40, 'happy', 600); sim.adjustRelation(v.id, 'player', 15, 15); }
    sim.say('peyu', 'Тече! Бистрица тече!');
    sim.say('gena', 'Ей го на, чедо… доживях го.', undefined, 0.6);
  }

  switch (mod) {
    case H(3): chickenTheft(sim); break;
    case H(5): case H(13): weather(sim); break;
    case H(6): genaHerbs(sim); break;
    case H(6, 40): ivanGift(sim); break;
    case H(7): genaClue(sim); break;
    case H(7, 30): radkaFurious(sim); break;
    case H(8): karakondzhulMorning(sim); break;
    case H(10): goatsRoll(sim); errand(sim); break;
    case H(15): case H(8, 30): errand(sim); break;
    case H(11): goatsReport(sim); break;
    case H(12): if (s.nextElectionDay === day) election(sim); else ivanLearnsGoats(sim); break;
    case H(12, 40): peyuOnCredit(sim); break;
    case H(14): if (s.nextElectionDay === day + 1) preElection(sim); break;
    case H(12, 15): radkaRecipe(sim); break;
    case H(15, 30): kalinToy(sim); break;
    case H(17): workResults(sim); break;
    case H(17, 15): petkoKaval(sim); break;
    case H(17, 40): genaTale(sim, 0.45); break;
    case H(20, 15): genaTale(sim, 0.35); break;
    case H(18): ivanSeeksMaria(sim); saborStarts(sim); break;
    case H(19, 30): eveningGathering(sim); break;
    case H(20, 30): if (f.lamia_dead && day > Number(f.lamia_news) && sim.r.chance(0.25)) riverJoy(sim); break;
    case H(21, 30): kalinLight(sim); break;
  }
  void t;
}

function chickenTheft(sim: VillageSim) {
  const s = sim.s, f = s.flags;
  if (f.fox_caught || !sim.r.chance(0.4)) return;
  const n = Number(f.chickens_lost ?? 3) + 1;
  f.chickens_lost = n; f.last_theft_day = sim.day;
  sim.chronicle('theft', pickNew(s, 'theft', [
    `Нощес от кокошарника на Радка изчезна още една кокошка — вече ${n}. До оградата остана само перушина и странни малки следи.`,
    `Посред нощ кокошките на Радка изпищяха, после настана тишина. Сутринта липсваше още една — ${ordinalF(n)} поред.`,
    `Някой пак е бил в кокошарника на Радка. Вратата — залостена, оградата — цяла, а кокошките — с една по-малко. Общо ${n}.`,
  ], sim.day), ['radka'], 5, 'chicken_theft');
  addMemory(s, sim.v('radka')!, 'Нощес пак изчезна кокошка. Пак видях онези светещи очи откъм гората…', 6, ['chickens', 'fox']);
}

const ORD_F = ['', 'първата', 'втората', 'третата', 'четвъртата', 'петата', 'шестата', 'седмата', 'осмата', 'деветата', 'десетата', 'единайсетата', 'дванайсетата'];
/** „четвъртата“ (за кокошка — женски род). */
export function ordinalF(n: number): string { return ORD_F[n] ?? `${n}-ата`; }

function radkaFurious(sim: VillageSim) {
  const s = sim.s, f = s.flags;
  if (f.fox_caught || f.last_theft_day !== sim.day) return;
  const radka = sim.v('radka')!;
  sim.feel('radka', -20, 'angry', 240);
  const suspect = String(f.chicken_suspect ?? 'petko');
  if (f.radka_admitted) {
    sim.say('radka', 'Пак тая проклета лисица! Ще ѝ видя сметката!');
    sim.chronicle('theft', 'Радка цяла сутрин кълне лисицата-таласъм пред хана. Вече не обвинява никого — само заплашва гората с метлата.', ['radka'], 3, 'radka_blames');
    return;
  }
  sim.say('radka', hpick(['Пак ми откраднаха кокошка! Знам аз кой е!', 'Петко, ти си! Всички знаят, че си ти!', 'Още една! Докога ще търпим тоя крадец?!'], sim.day, 'rf'));
  sim.chronicle('rumor', hpick([
    `Радка вдигна целия мегдан на крак: „Пак ${nameOf(suspect)} е, кой друг!“ ${Name(suspect)}, като чу, плю на земята и не каза нищо.`,
    `Още от сутринта Радка разправя на всеки, който мине покрай хана, че ${nameOf(suspect)} ѝ краде кокошките. Повечето кимат, но никой не е видял нищо.`,
  ], sim.day, 'rf2'), ['radka', suspect], 4, 'radka_blames');
  sim.adjustRelation('radka', suspect, -3, -2);
  const r = s.rumors.find(x => x.tag === 'petko_thief' && !x.parent);
  // който е наблизо — чува
  if (r) for (const v of s.villagers) {
    if (v === radka || v.indoors || v.activity === 'sleep' || dist(v.pos, radka.pos) > 25) continue;
    const trust = v.relations.radka?.trust ?? 0;
    sim.learnRumor(v, r, v.id === 'petko' ? -1 : Math.max(0, 0.3 + trust / 100));
    addMemory(s, v, `Радка викаше, че ${nameOf(suspect)} ѝ краде кокошките.`, 3, ['radka', suspect, 'chickens'], 'rumor');
  }
  if (suspect === 'petko') { sim.feel('petko', -15, 'angry', 180); addMemory(s, sim.v('petko')!, 'Радка пак ме нарече крадец пред цялото село!', 6, ['radka', 'chickens']); sim.adjustRelation('petko', 'radka', -4, -3); }
}

function genaClue(sim: VillageSim) {
  const s = sim.s, f = s.flags;
  if (f.fox_caught || f.last_theft_day !== sim.day || !sim.r.chance(0.6)) return;
  const gena = sim.v('gena')!;
  addMemory(s, gena, 'На зазоряване видях край кокошарника малки следи от лапи — светеха като гнили дънери и водеха към гората.', 6, ['chickens', 'fox']);
  const r = s.rumors.find(x => x.tag === 'fox' && !x.parent);
  if (r) sim.learnRumor(gena, r, Math.min(1, (gena.rumorBelief?.[String(r.id)] ?? 0.5) + 0.2));
  if (sim.r.chance(0.5)) sim.chronicle('rumor', 'Баба Гена се наведе над калта край кокошарника, дълго гледа нещо и мърмореше: „Не са човешки тия следи, мари… не са.“', ['gena'], 3, 'gena_tracks');
}

function kalinLight(sim: VillageSim) {
  const s = sim.s;
  if (s.flags.fox_caught || !sim.r.chance(0.12)) return;
  const k = sim.v('kalin')!;
  if (k.place !== 'workshop_kalin') return;
  addMemory(s, k, 'Късно вечерта видях синкава светлинка да се промъква от кокошарника към гората. Не казах на никого.', 6, ['chickens', 'fox']);
  const r = s.rumors.find(x => x.tag === 'fox' && !x.parent);
  if (r) sim.learnRumor(k, r, 0.8);
  sim.chronicle('rumor', 'Калин работеше до късно в дърводелницата, когато видя синкава светлинка да се промъква покрай кокошарника към гората. Понечи да каже на някого — но наоколо нямаше никой.', ['kalin'], 3, 'kalin_light');
}

function genaHerbs(sim: VillageSim) {
  if (!sim.r.chance(0.2)) return;
  sim.chronicle('work', pickNew(sim.s, 'herbs', [
    'Баба Гена излезе преди зазоряване да бере билки в края на гората. Върна се с пълна кошница и мокри от росата цървули.',
    'Още по тъмно баба Гена тръгна към гората с кошницата си. „Билката се бере, докато спи“, казва тя.',
    'Баба Гена набра риган и жълт кантарион в края на гората и си тананикаше стара песен за самодиви.',
  ], sim.day), ['gena'], 1, 'gena_herbs');
}

function weather(sim: VillageSim) {
  const s = sim.s; if (s.flags.storm_until) return;
  const morning = sim.mod < H(12);
  const w = s.weather;
  const table: Record<Weather, [Weather, number][]> = {
    clear: [['clear', 6], ['cloudy', 2.5], ['fog', morning ? 1 : 0]],
    cloudy: [['cloudy', 3], ['clear', 4], ['rain', 3]],
    rain: [['rain', 2], ['cloudy', 5], ['clear', 2], ['storm', 0.3]],
    storm: [['rain', 6], ['cloudy', 4]],
    fog: [['clear', 7], ['cloudy', 3]],
  };
  const nw = sim.r.weighted(table[w]);
  if (nw === w) return;
  s.weather = nw;
  if (nw === 'rain') sim.chronicle('weather', s.flags.river_flowing || s.flags.lamia_dead
    ? 'Заваля тих дъжд. Бистрица се надигна и запя още по-силно под моста.'
    : 'Заваля дъжд — малко, но дядо Пею излезе на мегдана и вдигна ръце към небето. Коритото на Бистрица остана сухо.', ['peyu'], 2, 'rain');
  else if (nw === 'fog') sim.chronicle('weather', 'Мъгла се спусна от Тъмната гора и покри селото. Баба Гена каза, че в такава мъгла самодивите слизат до реката.', ['gena'], 2, 'fog');
  else if (nw === 'storm') { s.flags.storm_until = s.time + 90; sim.chronicle('weather', 'Небето почерня и над Самодивско се изви буря. Хората се разтичаха към къщите си.', [], 4, 'storm'); }
}

function ivanGift(sim: VillageSim) {
  const s = sim.s;
  const ivan = sim.v('ivan')!, maria = sim.v('maria')!;
  if ((ivan.relations.maria?.affinity ?? 0) < 50 || !sim.r.chance(0.2)) return;
  const gift = sim.r.pick(['малко ковано цвете от желязо', 'желязна кукичка за стана ѝ', 'звънче за вратата', 'подкова за късмет', 'медно гривна с гравирани звезди']);
  sim.chronicle('love', `Рано сутринта Иван остави на прага на Мария ${gift} и побърза да си тръгне, преди някой да го види.`, ['ivan', 'maria'], 4, 'gift');
  addMemory(s, maria, `Някой ми остави на прага ${gift}. Знам кой е — само ковачът може да направи такова нещо.`, 5, ['ivan', 'love', 'gift']);
  addMemory(s, ivan, `Оставих на Мария ${gift}. Дано ѝ хареса.`, 4, ['maria', 'love']);
  sim.adjustRelation('maria', 'ivan', 4, 2);
  sim.feel('maria', 10, 'cheerful', 180);
  // Радка винаги разбира
  if (sim.r.chance(0.35) && !s.rumors.some(r => r.tag === 'love' && !r.parent)) {
    sim.addRumor({ topic: 'love', tag: 'love', text: 'Иван е хлътнал по Мария — всяка сутрин ѝ оставя подаръци на прага.', about: ['ivan', 'maria'], truth: true, origin: 'radka', sentiment: 0 }, [['radka', 0.9]]);
  }
}

function ivanSeeksMaria(sim: VillageSim) {
  const s = sim.s, ivan = sim.v('ivan')!;
  if (ivan.flags.seek || isDarkish(s.time) || !sim.r.chance(0.3)) return;
  ivan.flags.seek = 'maria'; ivan.flags.seekUntil = s.time + 40; ivan.flags.seekTopic = 'love';
}

const ERRANDS: Partial<Record<VillagerId, PlaceId[]>> = {
  gena: ['inn', 'well', 'workshop_kalin'], petko: ['smithy', 'inn', 'well'], ivan: ['inn', 'well', 'workshop_kalin'],
  maria: ['well', 'inn', 'house_gena'], radka: ['well', 'loom_maria', 'smithy'], kalin: ['inn', 'smithy', 'house_gena'],
};
/** Някой отскача по работа (до хана, чешмата, ковачницата…) — така се срещат и денем. */
function errand(sim: VillageSim) {
  const s = sim.s;
  const ids = (Object.keys(ERRANDS) as VillagerId[]).filter(id => { const v = sim.v(id)!; return v.activity !== 'sleep' && !v.talkingWith && !v.flags.seek; });
  if (!ids.length) return;
  const id = sim.r.pick(ids), v = sim.v(id)!;
  const pl = sim.r.pick(ERRANDS[id]!);
  if (pl === v.place) return;
  v.flags.errand = pl; v.flags.errandUntil = s.time + 40;
}

function goatsRoll(sim: VillageSim) {
  const s = sim.s;
  if (s.flags.ivan_petko_peace || !sim.r.chance(0.3)) return;
  s.flags.goats_day = sim.day;
}

function goatsReport(sim: VillageSim) {
  const s = sim.s;
  if (s.flags.goats_day !== sim.day) return;
  sim.chronicle('theft', pickNew(s, 'goats', [
    'Козите на Петко пак се озоваха в нивата на Иван и изпасаха половината ечемик. Петко седеше на синора и свиреше с кавала, сякаш нищо не вижда.',
    'Цяла сутрин козите на Петко пасоха в нивата на Иван. „Сами са дошли“, каза Петко на всеки, който попита.',
    'Пак кози в нивата на Иван! Вредата е голяма, а Петко само сви рамене.',
  ], sim.day), ['petko', 'ivan'], 4, 'goats');
  addMemory(s, sim.v('petko')!, 'Пуснах козите в нивата на Иван. Да види и той как е.', 5, ['ivan', 'goats', 'secret']);
}

function ivanLearnsGoats(sim: VillageSim) {
  const s = sim.s;
  if (s.flags.goats_day !== sim.day) return;
  const ivan = sim.v('ivan')!;
  addMemory(s, ivan, 'Козите на Петко пак ми изпасаха нивата! Стига толкова.', 7, ['petko', 'goats']);
  sim.feel('ivan', -20, 'angry', 300);
  sim.adjustRelation('ivan', 'petko', -5, -5);
  const r = s.rumors.find(x => x.tag === 'goats' && !x.parent);
  if (r) sim.learnRumor(ivan, r, 1);
  ivan.flags.seek = 'petko'; ivan.flags.seekUntil = s.time + 6 * 60 + 30; ivan.flags.seekTopic = 'quarrel';
}

function peyuOnCredit(sim: VillageSim) {
  const peyu = sim.v('peyu')!;
  if (peyu.place !== 'inn') return;
  sim.adjustRelation('radka', 'peyu', -3, -1);
  addMemory(sim.s, peyu, 'Пак ядох в хана на вересия. Срам ме е от Радка.', 4, ['radka', 'debt', 'secret']);
  if (sim.r.chance(0.5)) {
    sim.say('radka', 'Пак на вересия, а, кмете?', 'peyu');
    sim.say('peyu', 'Шшт! Ще ти платя, Радке, ще ти платя…', 'radka', 0.7);
    sim.feel('peyu', -8, 'ashamed', 90);
  }
}

function workResults(sim: VillageSim) {
  const s = sim.s, day = sim.day;
  const who = sim.r.weighted<VillagerId>([['ivan', 1], ['maria', 1], ['kalin', 1]]);
  const T: Record<string, string[]> = {
    ivan: [
      'От ковачницата цял ден се чуваше чукът — Иван изкова нова брадва и три сърпа за жътвата.',
      'Иван изкова нов лемеж за ралото на дядо Пею. Кметът го огледа от всички страни и каза: „Едно време такова желязо нямаше.“',
      'Иван подкова всички коне в селото и не каза нито дума през целия ден.',
    ],
    maria: [
      'Мария изтъка нова черга с червени и черни шевици — най-хубавата досега.',
      'Мария изтъка покривка с шарки като звезди. Казва, че така изглеждало небето над морето.',
      'Мария довърши пъстра престилка за Радка. Радка я показа на всеки гост в хана.',
    ],
    kalin: [
      'Калин направи нов стол за хана. Никой не забеляза.',
      'Калин поправи оградата на кокошарника. Радка мислеше, че тя си е била такава.',
      'Калин издяла дървена лъжица с шарки и я остави на масата в хана. Никой не попита кой я е направил.',
    ],
  };
  const txt = pickNew(s, 'work_' + who, T[who], day);
  sim.chronicle('work', txt, [who], 2, 'work_' + who);
  sim.feel(who, 8, who === 'kalin' ? undefined : 'proud', 120);
  addMemory(s, sim.v(who)!, who === 'kalin' ? 'Свърших хубава работа. Пак никой не каза нищо.' : 'Днес свърших хубава работа.', 2, ['work']);
}

// ───────────────────────── мили дребни случки от всекидневието ─────────────────────────

const free = (v: VillagerState) => !v.talkingWith && !v.indoors && v.activity !== 'sleep' && v.activity !== 'flee';
const calm = (s: WorldState, t: number) => !(Number(s.flags.karakondzhul_until ?? 0) > t || Number(s.flags.storm_until ?? 0) > t);

const TOYS: [string, 'го' | 'я'][] = [
  ['дървено конче на колелца', 'го'], ['птичка-свирка от явор', 'я'], ['малка люлка за кукла', 'я'], ['пумпал с червени ивици', 'го'],
  ['мече от липово дърво', 'го'], ['дървена кукла с плетени коси', 'я'],
];
/** Калин прави играчка — за никого. */
function kalinToy(sim: VillageSim) {
  const s = sim.s, k = sim.v('kalin')!;
  if (k.place !== 'workshop_kalin' || !free(k) || !calm(s, s.time) || !sim.r.chance(0.25)) return;
  const [toy, it] = pickNew(s, 'toy', TOYS, sim.day);
  sim.chronicle('mood', pickNew(s, 'toy_text', [
    `Калин цял следобед дялка ${toy} и ${it} остави на перваза на дърводелницата. За кого е — не каза. Може би за никого.`,
    `От стружките в дърводелницата се роди ${toy}. Калин ${it} повъртя в ръце, усмихна се и ${it} прибра в сандъка при другите — играчки, които чакат някое дете да ги намери.`,
    `Калин направи ${toy} и ${it} сложи на прага на хана. На сутринта ${it === 'го' ? 'го нямаше' : 'я нямаше'} — дали някой ${it} взе, или вятърът, никой не знае.`,
  ], sim.day), ['kalin'], 2, 'kalin_toy');
  addMemory(s, k, `Направих ${toy}. Не знам за кого. Просто ръцете ми искаха.`, 2, ['work', 'kalin']);
  sim.feel('kalin', 6, 'content', 120);
}

const DISHES = ['баница с тиква и орехи', 'пита с мащерка и сирене', 'чорба от коприва с кисело мляко', 'гювеч с гъби от гората', 'сладко от шипки', 'зелник с праз и мед'];
/** Радка опитва нова рецепта. */
function radkaRecipe(sim: VillageSim) {
  const s = sim.s, radka = sim.v('radka')!;
  if (radka.place !== 'inn' || !calm(s, s.time) || !sim.r.chance(0.3)) return;
  const dish = pickNew(s, 'dish', DISHES, sim.day);
  const near = s.villagers.filter(v => v !== radka && free(v) && dist(v.pos, radka.pos) < 14);
  const taster = near.length ? near[0].id as VillagerId : null;
  const text = taster
    ? `Радка опита нова рецепта — ${dish}. ${Name(taster)} ${g(taster, 'я опита първа', 'я опита пръв')} и ${hpick([
      'си поиска още едно парче', 'обра чинията до троха', `кимна мълчаливо — а от ${nameOf(taster)} това е голяма похвала`,
    ], sim.day, taster, 'taste')}. Радка сияеше.`
    : `Радка опита нова рецепта — ${dish}. Опита сама, кимна доволно и обяви на празния хан, че от утре влиза в менюто.`;
  sim.chronicle('mood', text, taster ? ['radka', taster] : ['radka'], 2, 'radka_recipe');
  addMemory(s, radka, `Сготвих нещо ново — ${dish}. ${taster ? `${Name(taster)} поиска още!` : 'Хубаво стана.'}`, 3, ['work', 'inn']);
  if (taster) { addMemory(s, sim.v(taster)!, `Опитах новото ястие на Радка — ${dish}. Хубаво беше.`, 2, ['radka', 'inn']); sim.adjustRelation(taster, 'radka', 2, 0); }
  sim.feel('radka', 8, 'proud', 120);
  sim.say('radka', 'Опитайте, опитайте! Ново е!');
}

/** Петко свири на кавал при кошарата. */
function petkoKaval(sim: VillageSim) {
  const s = sim.s, petko = sim.v('petko')!;
  if (petko.place !== 'sheepfold' || !free(petko) || !calm(s, s.time) || !sim.r.chance(0.35)) return;
  const near = s.villagers.filter(v => v !== petko && free(v) && dist(v.pos, petko.pos) < 30);
  const lis = near.length ? near[0].id as VillagerId : null;
  sim.chronicle('mood', lis
    ? `Привечер откъм кошарата се чу кавал. ${Name(lis)} спря да послуша. Петко се намуси, като ${g(lis, 'я', 'го')} видя — но не спря да свири.`
    : pickNew(s, 'kaval', [
      'Привечер откъм кошарата се чу кавал. Петко свиреше на овцете — тъжна, протяжна мелодия, която никой не подозираше, че знае.',
      'Петко седна на камъка пред кошарата и засвири на кавала. Овцете спряха да блеят и сякаш слушаха.',
      'Докато прибираше стадото, Петко свиреше на кавала. Звукът се носеше чак до мегдана, а някой там въздъхна: „Кой би казал, че Петко има такава душа.“',
    ], sim.day), lis ? ['petko', lis] : ['petko'], 2, 'petko_kaval');
  addMemory(s, petko, 'Свирих на кавала при кошарата. Само овцете ме разбират.', 2, ['kaval', 'sheep']);
  if (lis) { addMemory(s, sim.v(lis)!, 'Чух Петко да свири на кавал. Кой би помислил — хубаво свири.', 3, ['petko', 'kaval']); sim.adjustRelation(lis, 'petko', 3, 1); }
  sim.feel('petko', 10, 'calm', 90);
}

const TALES = [
  'за самодивата, която изгубила ризата си край езерцето',
  'за юнака, който надхитрил Ламята с три гатанки',
  'за таласъма, който се страхувал от петли',
  'за момата, която изтъкала пътя си чак до морето',
  'за времето, когато Бистрица пеела песни на ковачите',
  'за Караконджула, който се заплел в сол и чакал до зори',
];
/** Баба Гена разказва приказка под ореха (или вечер, където е). */
function genaTale(sim: VillageSim, p: number) {
  const s = sim.s, gena = sim.v('gena')!, f = s.flags;
  if (f.gena_tale_day === sim.day || !free(gena) || !calm(s, s.time) || !gena.place) return;
  const lis = s.villagers.filter(v => v !== gena && free(v) && dist(v.pos, gena.pos) < 12);
  if (!lis.length || !sim.r.chance(p)) return;
  f.gena_tale_day = sim.day;
  const ids = lis.map(v => v.id as VillagerId);
  const tale = pickNew(s, 'tale', TALES, sim.day);
  const where = gena.place === 'walnut' || gena.place === 'square' ? 'Под стария орех' : cap(LOC[gena.place]);
  const tail = ids.includes('maria') && tale.includes('морето') ? 'Мария слушаше със светнали очи и не мигаше.'
    : ids.includes('ivan') && /таласъм|Караконджул/.test(tale) ? 'Иван се правеше, че не го е страх, но седна по-близо до баба Гена.'
    : ids.includes('kalin') ? 'Калин седеше най-отзад, както винаги, и пръв попита: „А после?“'
    : ids.length > 1 ? 'Слушаха я, без да мигнат.' : `${Name(ids[0])} слушаше като дете.`;
  sim.chronicle('mood', `${where} баба Гена разказа на ${joinNames(ids)} приказка ${tale}. ${tail}`, ['gena', ...ids], 2, 'gena_tale');
  for (const v of lis) addMemory(s, v, `Баба Гена разказа приказка ${tale}.`, 2, ['gena', 'tale']);
  addMemory(s, gena, `Разказах приказка ${tale}. Младите още обичат приказките.`, 2, ['tale']);
  sim.feel('gena', 8, 'cheerful', 120);
  for (const v of lis) sim.feel(v.id, 4);
  sim.say('gena', 'Имало едно време, чеда…');
}

function eveningGathering(sim: VillageSim) {
  const s = sim.s;
  if (!sim.r.chance(0.35)) return;
  for (const place of ['square', 'inn'] as const) {
    const here = s.villagers.filter(v => v.place === place || (v.activity !== 'sleep' && !v.indoors && nearestPlace(v.pos).id === place));
    if (here.length < 3) continue;
    const ids = here.map(v => v.id);
    const txt = place === 'inn'
      ? pickNew(s, 'ev_inn', [
        `Вечерта в хана седяха ${joinNames(ids)}. Радка разнасяше боб и билков чай — и клюки, разбира се.`,
        `В хана беше пълно: ${joinNames(ids)}. Над масите миришеше на мащерка и на топъл хляб.`,
        `Вечерта пред хана ${joinNames(ids)} пиха билков чай и се смяха на нещо, което Радка разказа шепнешком.`,
      ], sim.day)
      : pickNew(s, 'ev_sq', [
        `Вечерта на мегдана под стария орех се събраха ${joinNames(ids)}. Говориха си до здрач.`,
        `${cap(joinNames(ids))} седнаха на пейките под ореха и гледаха как слънцето залязва зад Ламин връх.`,
        `Под стария орех ${joinNames(ids)} чакаха първата звезда. Който я види пръв, щял да има късмет цяла година.`,
      ], sim.day);
    sim.chronicle('talk', txt, ids, 1, 'evening');
    return;
  }
}

function riverJoy(sim: VillageSim) {
  sim.chronicle('mood', hpick([
    'Калин пусна по Бистрица лодка от кора, а дядо Пею му викаше да внимава — и се смееше като дете.',
    'Вечерта жените излязоха на моста да слушат реката. „Като песен е“, каза Мария.',
    'Петко изкара стадото до реката и овцете пиха, докато се наситиха. Овчарят за първи път от месеци си подсвиркваше.',
  ], sim.day, 'river_joy'), [], 3, 'river_joy');
}

function preElection(sim: VillageSim) {
  const mayor = sim.s.mayor;
  sim.chronicle('election', mayor === 'peyu'
    ? 'Дядо Пею цял следобед обикаляше селото и се ръкува с всеки срещнат. Утре са изборите за кмет.'
    : `${Name(mayor)} цял следобед обикаляше селото и обещаваше какво ли не. Утре са изборите за кмет.`, [mayor], 3, 'pre_election');
  sim.feel('peyu', -5, 'thoughtful', 300);
}

const glasa = (n: number) => (n === 1 ? 'един глас' : `${n} гласа`);

export function election(sim: VillageSim) {
  const s = sim.s, mayor = s.mayor;
  const pop = (c: VillagerId) => s.villagers.reduce((acc, v) => acc + (v.id === c ? 0 : (v.relations[c]?.affinity ?? 0) + 0.5 * (v.relations[c]?.trust ?? 0)), 0);
  // баба Гена не иска да е кмет, а за Калин никой не се сеща
  const others = VILLAGER_IDS.filter(id => id !== mayor && id !== 'gena' && id !== 'kalin').map(id => ({ id, p: pop(id) })).sort((a, b) => b.p - a.p || VILLAGER_IDS.indexOf(a.id) - VILLAGER_IDS.indexOf(b.id));
  const cands: VillagerId[] = [mayor, ...others.slice(0, 2).map(o => o.id)];
  const debtBelief = (v: VillagerState) => { const r = s.rumors.find(x => x.tag === 'debt'); return r ? v.rumorBelief?.[String(r.id)] ?? 0 : 0; };
  const votes: Record<string, number> = {}; for (const c of cands) votes[c] = 0;
  for (const v of s.villagers) {
    let best = cands[0], bs = -Infinity;
    for (const c of cands) {
      const rel = v.relations[c];
      let sc = c === v.id ? 45 : (rel?.affinity ?? 0) + 0.5 * (rel?.trust ?? 0);
      if (c === mayor) {
        sc += 18 + v.moodValue * 0.3 + (s.flags.river_flowing || s.flags.lamia_dead ? 15 : 0);
        if (mayor === 'peyu' && v.id !== 'peyu' && debtBelief(v) > 0.4) sc -= 20;
      }
      sc += sim.r.range(-8, 8);
      if (sc > bs) { bs = sc; best = c; }
    }
    votes[best]++;
  }
  let winner = mayor;
  for (const c of cands) if (votes[c] > votes[winner]) winner = c;
  const changed = winner !== mayor;
  s.mayor = winner;
  s.nextElectionDay += 10;
  const rest = cands.filter(c => c !== winner && votes[c] > 0).map(c => `${nameOf(c)} — ${glasa(votes[c])}`);
  const restTxt = rest.length ? ` (${rest.join(', ')})` : '';
  if (changed) {
    const txt = mayor === 'peyu'
      ? `Нов кмет! На изборите под стария орех селото избра ${nameOf(winner)} с ${glasa(votes[winner])}${restTxt}. Дядо Пею свали калпака, дълго мълча и после пръв стисна ръката на ${nameOf(winner)}.`
      : `Нов кмет! Селото избра ${nameOf(winner)} с ${glasa(votes[winner])}${restTxt}. ${Name(mayor)} предаде кметския печат с въздишка.`;
    sim.chronicle('election', txt, [winner, mayor], 8, 'new_mayor');
    sim.feel(winner, 30, 'proud', 600); sim.feel(mayor, -35, 'sad', 600);
    sim.say(winner, winner === 'petko' ? 'Абе… благодаря. Ще видите вие ред!' : winner === 'radka' ? 'Ох, мили мои! Първо — нова цена на боба!' : 'Благодаря ви, хора! Няма да ви разочаровам.');
    for (const v of s.villagers) addMemory(s, v, `${Name(winner)} е новият кмет на Самодивско.`, 6, [winner, mayor, 'election']);
    addMemory(s, sim.v(mayor)!, 'Загубих изборите. Селото вече не ме иска за кмет.', 8, ['election']);
  } else {
    const tie = cands.some(c => c !== winner && votes[c] === votes[winner]);
    const txt = `На мегдана се проведоха избори за кмет. ${Name(winner)} запази поста си с ${glasa(votes[winner])}${restTxt}.${tie ? ' При равен брой гласове селото остави стария кмет.' : ''}${winner === 'peyu' ? ' Кметът оправи калпака си и произнесе реч за реда, която никой не дослуша.' : ''}`;
    sim.chronicle('election', txt, [winner, ...cands.filter(c => c !== winner)], 6, 'election');
    sim.feel(winner, 15, 'proud', 300);
    sim.say(winner, winner === 'peyu' ? 'Редът си е ред! Благодаря ви, хора!' : 'Благодаря ви!');
    for (const v of s.villagers) addMemory(s, v, `На изборите ${nameOf(winner)} остана кмет.`, 4, [winner, 'election']);
  }
  sim.bus.emit('election', { mayor: winner, votes });
}

function saborStarts(sim: VillageSim) {
  const s = sim.s, f = s.flags;
  if (f.sabor !== sim.day || f.sabor_dance === sim.day) return;
  f.sabor_dance = sim.day;
  sim.chronicle('festival', 'Вечерта на мегдана запалиха голям огън и хорото се изви около него. Дори Иван дойде — огънят светеше толкова силно, че тъмното не го плашеше.', [...VILLAGER_IDS], 5, 'sabor_dance');
}

// ───────────────────────── Караконджулът ─────────────────────────

const KARA_FEAR: Record<VillagerId, string> = {
  gena: 'Караконджулът дойде в селото. Чух копитата му по покривите — като едно време, когато бях малка.',
  peyu: 'Караконджулът тропаше по покривите, а аз, кметът, треперех зад залостената врата. Срамота.',
  petko: 'Караконджулът дойде! Овцете блееха като луди в кошарата, а аз стисках гегата.',
  ivan: 'Караконджулът дойде, а наоколо беше тъмно. Не помня кога съм се страхувал повече.',
  maria: 'Караконджулът мина под прозореца ми. Чух смеха му — още ми е студено.',
  radka: 'Караконджулът дойде! Залостих вратата и дълго слушах тропота.',
  kalin: 'Караконджулът дойде в селото. Чух копитата му точно пред дърводелницата.',
};

/** Кой къде се скри: [заварен навън, …, у дома]. */
const KARA_HID: Record<VillagerId, string[]> = {
  gena: ['Баба Гена залости вратата и шепнеше над огнището стари думи против нечисти сили, докато тропотът не утихна.'],
  peyu: [
    'Дядо Пею понечи да въдвори ред с тоягата си, но като чу копитата, захвърли калпака и се шмугна в хана при Радка.',
    'Дядо Пею се скри под масата у дома и после се кълнеше, че само търсел калпака си.',
  ],
  petko: ['Петко се затвори в кошарата при овцете — „да не ги е страх сами“, обясни после той.'],
  ivan: [
    'Иван се скри в ковачницата и през цялото време стискаше чука, а огнището гореше с всичка сила, за да не е тъмно.',
    'Иван се завря в най-далечния ъгъл на къщата си и запали всички борини, които имаше.',
  ],
  maria: ['Мария се скри зад стана и броеше нишките на глас, за да не чува тропота.', 'Мария се сви под стана и стискаше совалката като нож.'],
  radka: ['Радка залости хана с пейките и пускаше вътре всеки, който почука. Дори от страх не спря да говори нито за миг.'],
  kalin: ['Калин се скри в дърводелницата между дъските. Никой не се сети да провери къде е — както винаги.'],
};
/** Кой беше смел. */
const KARA_BRAVE: Partial<Record<VillagerId, string>> = {
  gena: 'Само баба Гена не се изплаши: посипа сол на прага си и седна да чака. „Караконджулът сол не прекрачва, чедо“, каза тя на сутринта.',
  kalin: 'Калин единствен не побягна — застана с брадвата пред вратата на баба Гена, докато тропотът не утихна. На сутринта никой не разбра кой я е пазил.',
  petko: 'Петко не остави стадото: стоеше пред кошарата с горяща главня и гегата, докато Караконджулът не се отказа. Овцете оцеляха до една.',
  radka: 'Радка излезе на прага на хана с метлата и така се развика, че тропотът се отдалечи. „Мен и Караконджулът ме слуша“, хвалеше се тя после.',
};

function karakondzhulStories(sim: VillageSim, wasOut: VillagerId[], radkaInn: boolean) {
  const s = sim.s, day = sim.day;
  // смелият (Радка — само ако е била в хана)
  const braveIds = (Object.keys(KARA_BRAVE) as VillagerId[]).filter(id => id !== 'radka' || radkaInn);
  const brave = hpick(braveIds, day, s.time, 'kbrave');
  sim.chronicle('monster', KARA_BRAVE[brave]!, [brave], 5, 'karakondzhul_brave');
  addMemory(s, sim.v(brave)!, 'Когато дойде Караконджулът, не побягнах. Сърцето ми биеше, но устоях.', 8, ['karakondzhul', 'brave']);
  sim.feel(brave, 25, 'proud', 600);
  sim.addRumor({ topic: 'karakondzhul', tag: 'brave', text: `${Name(brave)} не се уплаши от Караконджула!`, about: [brave, 'karakondzhul'], truth: true, origin: brave, sentiment: 1 },
    [[brave, 1], ...(brave === 'kalin' ? [['gena', 0.9] as [string, number]] : [['radka', 0.8] as [string, number]])]);
  // кой къде се скри — най-напред някой, който беше навън
  const others = VILLAGER_IDS.filter(id => id !== brave);
  const out = wasOut.filter(id => id !== brave);
  const hid = out.length ? hpick(out, day, s.time, 'khid') : hpick(others, day, 'khid');
  // първият вариант е за някой, заварен навън; последният — за някой, който си беше у дома
  const list = KARA_HID[hid], t = out.includes(hid) ? list[0] : list[list.length - 1];
  sim.chronicle('monster', t, [hid], 4, 'karakondzhul_hide');
  addMemory(s, sim.v(hid)!, `Скрих се от Караконджула. ${hid === 'peyu' ? 'Дано никой не е видял.' : 'Не искам да го помня.'}`, 6, ['karakondzhul', 'fear']);
}

/** Сутринта след Караконджула: следи от копита и приказки при чешмата. */
function karakondzhulMorning(sim: VillageSim) {
  const s = sim.s, f = s.flags;
  if (f.karakondzhul_talk !== sim.day || f.karakondzhul_told === sim.day) return;
  f.karakondzhul_told = sim.day;
  sim.chronicle('monster', hpick([
    'На сутринта половината село се събра при чешмата да оглежда следите от копита в калта. Радка разправяше, че Караконджулът имал три рога, Петко — че имал два, а баба Гена само се усмихваше под забрадката.',
    'Сутринта никой не говореше за друго. Дядо Пею мери следите от копита с тоягата си и обяви, че „такова чудо едно време нямаше“. Иван се прозяваше — цяла нощ не беше мигнал.',
    'На сутринта Калин тихо закова наново една откъртена дъска на кокошарника. Хората при чешмата спореха дали Караконджулът ще се върне довечера.',
  ], sim.day, 'kmorning'), ['radka', 'petko', 'gena', 'peyu'], 4, 'karakondzhul_morning');
  for (const v of s.villagers) addMemory(s, v, 'Цялото село говори за нощта с Караконджула. Видях следите от копитата му.', 4, ['karakondzhul', 'fear']);
  sim.say('radka', 'Три рога, ви казвам, три! И очи като въглени!');
  sim.say('petko', 'Абе, два бяха. Аз го видях.', 'radka', 0.8);
}

// ───────────────────────── случки отвън ─────────────────────────

const byTxt = (by: string | undefined, phrase: string) => (by ? ` ${phrase.replace('{by}', by)}` : '');

export function injectEvent(sim: VillageSim, ev: InjectedEvent) {
  const s = sim.s, t = s.time, day = sim.day, mod = sim.mod;
  const outside = () => s.villagers.filter(v => !v.indoors && v.activity !== 'sleep');
  switch (ev.type) {
    case 'storm': {
      s.weather = 'storm'; s.flags.storm_until = t + 120;
      sim.panic();
      sim.chronicle('weather', 'Над Самодивско се изви страшна буря — гръмотевици, вятър и пороен дъжд. Всички се прибраха по къщите, само Радка остана да залоства капаците на хана.' + byTxt(ev.by, 'Говори се, че я е извикал някой на име {by}.'), [], 5, 'storm');
      for (const v of outside()) { addMemory(s, v, 'Изви се страшна буря и тичах да се прибера.', 4, ['storm', 'weather']); sim.feel(v.id, -6); }
      sim.react('Изви се страшна буря с гръмотевици.', 'Бурята! Бягайте да се приберете!');
      break;
    }
    case 'karakondzhul': {
      s.flags.karakondzhul_until = t + 120;
      const night = isDarkish(t);
      const wasOut = outside().map(v => v.id as VillagerId);
      // утрото след страшната нощ (или вечерта, ако е било денем) селото ще говори само за това
      s.flags.karakondzhul_day = day;
      s.flags.karakondzhul_talk = mod < H(7, 30) ? day : day + 1;
      const rv = sim.v('radka')!;
      const radkaInn = !rv.indoors && rv.activity !== 'sleep' && nearestPlace(rv.pos).id === 'inn';
      const txt = night
        ? 'Посред нощ из селото се разнесе тропот на копита и зловещ смях — Караконджулът! Хората залостиха вратите, а Иван цяла нощ не мигна.'
        : 'Посред бял ден небето притъмня и по улиците на Самодивско пробяга рогата сянка — Караконджулът! Всички се изпокриха по къщите.';
      sim.panic();
      sim.chronicle('monster', txt + byTxt(ev.by, 'Казват, че го е довел {by}.'), [...VILLAGER_IDS], 7, 'karakondzhul');
      for (const v of s.villagers) { addMemory(s, v, KARA_FEAR[v.id as VillagerId], 7, ['karakondzhul', 'monster', 'fear']); sim.feel(v.id, -30, 'afraid', 300); }
      sim.feel('ivan', -15, 'afraid', 600);
      karakondzhulStories(sim, wasOut, radkaInn);
      sim.react('Караконджулът дойде в селото!', 'Караконджулът! Бягайте!');
      break;
    }
    case 'samodivi': {
      s.flags.samodivi_until = t + 180; // три часа самодивите играят на поляната (и денем)
      const who = sim.r.pick<VillagerId>(['petko', 'maria', 'kalin']);
      const SAM: Record<string, string> = {
        petko: 'Петко закъсня със стадото край гората и после се кълнеше, че видял самодиви да играят хоро на поляната — в бели ризи, леки като мъгла.',
        maria: 'Мария гледала звездите от прозореца и видяла далеч в гората синкава светлина. После се кълнеше, че там играли самодиви — в бели ризи, леки като мъгла.',
        kalin: 'Калин търсел хубаво дърво в края на гората и видял самодиви да играят хоро на поляната. Разказа го тихо, на един-единствен човек — и той не го чу.',
      };
      sim.chronicle('rumor', SAM[who] + ' Баба Гена, като чу, само се усмихна и замълча.' + byTxt(ev.by, 'Самодивите сякаш играеха за {by}.'), [who, 'gena'], 6, 'samodivi');
      addMemory(s, sim.v(who)!, 'Видях самодиви да играят хоро на поляната! Никога няма да го забравя.', 8, ['samodivi', 'glade']);
      addMemory(s, sim.v('gena')!, 'Пак си спомних самодивата, която видях като млада на поляната. Никому не съм казвала.', 8, ['samodivi', 'secret']);
      sim.feel(who, 15, 'thoughtful', 300); sim.feel('gena', 10, 'thoughtful', 300);
      sim.react(`${Name(who)} видял${g(who, 'а', '')} самодиви да играят хоро на поляната.`, 'Самодиви! Истински самодиви!', 1);
      sim.addRumor({ topic: 'samodivi', tag: 'samodivi', text: `${Name(who)} видял${g(who, 'а', '')} самодиви да играят хоро на поляната.`, about: [who, 'samodivi'], truth: true, origin: who, sentiment: 0 }, [[who, 1], ['gena', 1]]);
      break;
    }
    case 'sabor': {
      const d = mod >= H(23) ? day + 1 : day;
      s.flags.sabor = d;
      const now = d === day && mod >= H(18);
      if (now) s.flags.sabor_dance = day;
      sim.chronicle('festival', (now
        ? 'Самодивско си направи сбор! На мегдана запалиха огън, гайдата засвири и цялото село се хвана на хоро около огъня.'
        : `Дядо Пею обяви, че ${d === day ? 'тази вечер' : 'утре вечер'} ще има сбор! Жените месят баници, Калин сковава маси, а Иван — колкото и да не обича тъмното — обеща да дойде.`) + byTxt(ev.by, 'Сборът е по желание на {by}.'), [...VILLAGER_IDS], 7, 'sabor');
      for (const v of s.villagers) { addMemory(s, v, 'Ще има сбор на мегдана — с огън, гайда и хоро!', 5, ['sabor', 'festival']); sim.feel(v.id, 20, 'cheerful', 300); }
      sim.react('В селото ще има сбор с хоро и огън!', 'Сбор! Хайде на хорото!');
      break;
    }
    case 'theft': {
      const victim = sim.r.pick<VillagerId>(VILLAGER_IDS);
      const OBJ: Record<VillagerId, [string, string]> = {
        gena: ['торбичката с билки на баба Гена', 'торбичката с билки на баба Гена'], peyu: ['кметският печат на дядо Пею', 'кметския печат на дядо Пею'],
        petko: ['звънецът на най-старата коза на Петко', 'звънеца на най-старата коза на Петко'], ivan: ['новият чук на Иван', 'новия чук на Иван'],
        maria: ['кълбото червена вълна от стана на Мария', 'кълбото червена вълна от стана на Мария'], radka: ['медната тава от хана', 'медната тава от хана'],
        kalin: ['любимото длето на Калин', 'любимото длето на Калин'],
      };
      const v = sim.v(victim)!;
      let suspect: VillagerId = VILLAGER_IDS.find(x => x !== victim)!, low = Infinity;
      for (const o of VILLAGER_IDS) { if (o === victim) continue; const a = v.relations[o]?.affinity ?? 0; if (a < low) { low = a; suspect = o; } }
      const [objS, obj] = OBJ[victim];
      sim.chronicle('theft', `${cap(objS)} изчезна безследно! ${Name(victim)} обърна всичко наопаки и накрая започна да гледа накриво ${nameOf(suspect)}.` + byTxt(ev.by, 'А някои шепнат, че зад всичко стои {by}.'), [victim, suspect], 5, 'theft');
      addMemory(s, v, `Някой ми открадна ${obj.replace(/ на .*$| от .*$/, '')}! Сигурно е ${nameOf(suspect)}.`, 6, ['theft', suspect]);
      sim.feel(victim, -20, 'angry', 240);
      sim.react(`Някой открадна ${obj}.`, 'Крадец! В селото има крадец!', 1);
      sim.adjustRelation(victim, suspect, -6, -6);
      sim.addRumor({ topic: 'theft', tag: 'theft', text: `${Name(suspect)} е взел${g(suspect, 'а', '')} ${obj} — така казва ${nameOf(victim)}.`, about: [suspect], truth: false, origin: victim, sentiment: -1 }, [[victim, 0.8], ['radka', 0.6]]);
      break;
    }
    case 'custom': {
      const ids = (ev.participants ?? []).filter(Boolean);
      const imp = Math.max(1, Math.min(10, ev.importance ?? 4));
      sim.chronicle(ev.chronicleType ?? 'live', ev.text, ids, imp, 'custom');
      const who = ids.length ? ids : [...VILLAGER_IDS];
      for (const id of who) { const v = sim.v(id); if (v) addMemory(s, v, ev.text, imp, ['event', ...ids]); }
      break;
    }
  }
  void LOC;
}

void VILLAGERS;
