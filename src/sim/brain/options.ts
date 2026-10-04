// 3-те готови отговора на играча за следващата реплика в разговор (по контекст: първи ход или не,
// какво е избрал преди, с кого говори, колко му вярва). Всички id се разбират от ScriptedBrain.talkNow.
import { Rng } from '../../core/rng';
import type { VillagerId } from '../../data/villagers';
import type { DialogueOption } from '../types';
import type { Partner, Persona } from './Brain';
import { isVillagerId, parseSituation } from './context';

export interface OptionsRequest {
  speaker: Persona; partner: Partner; turn: number; lastOptionId?: string; seed: number;
  /** по желание: ситуацията (за текстове като „Реката пак тече — радваш ли се?“) */
  situation?: string;
}

const TEXTS: Record<string, string[]> = {
  news: ['Какво ново в селото?', 'Какво се говори напоследък?'],
  self: ['Разкажи ми за себе си.', 'С какво се занимаваш?'],
  help: ['Мога ли да помогна с нещо?', 'Имаш ли нужда от помощ?'],
  lamia: ['Разкажи ми за Ламята.', 'Какво знаеш за Ламята?'],
  river: ['Какво стана с реката?', 'Защо пресъхна Бистрица?'],
  village: ['Как се живее в Самодивско?', 'Разкажи ми за селото.'],
  chickens: ['Кой според теб краде кокошките?', 'Чух, че някой краде кокошки. Кой е?'],
  forest: ['Какво има в Тъмната гора?', 'Опасна ли е гората?'],
  people: ['Какво мислиш за хората тук?', 'С кого се разбираш в селото?'],
  secret: ['Имаш ли някаква тайна?', 'Има ли нещо, което не казваш на другите?'],
  samodivi: ['Вярно ли е, че има самодиви?', 'Разкажи ми за самодивите.'],
  election: ['Кой ще е кмет на изборите?', 'Какво мислиш за изборите?'],
  weapon: ['Можеш ли да ми изковеш сабя?', 'Трябва ми добро оръжие.'],
  world: ['Искаш ли да ти разкажа за света?', 'Да ти разкажа ли какво има отвъд планините?'],
  notice: ['Ти ли направи люлката на мегдана? Хубава е!', 'Оградите в селото са твоя работа, нали? Майсторска работа!'],
  bye: ['Сбогом.', 'Сбогом. Ще се видим пак.'],
};
const RIVER_FLOW_TEXT = ['Реката пак тече — радваш ли се?', 'Как е сега, като Бистрица тече?'];
const LAMIA_DEAD_TEXT = ['Чу ли, че Ламята я няма?', 'Какво ще правите сега, без Ламята?'];

const FOLLOW: Record<string, string[]> = {
  greet: ['news', 'self', 'help'],
  news: ['chickens', 'lamia', 'people', 'village'],
  self: ['help', 'people', 'village', 'secret'],
  help: ['lamia', 'river', 'news', 'forest'],
  lamia: ['river', 'forest', 'help'],
  river: ['lamia', 'help', 'village'],
  village: ['people', 'news', 'election'],
  chickens: ['people', 'forest', 'help'],
  forest: ['samodivi', 'lamia', 'help'],
  people: ['news', 'secret', 'village'],
  secret: ['help', 'news', 'self'],
  samodivi: ['forest', 'secret', 'news'],
  election: ['people', 'village', 'news'],
  weapon: ['lamia', 'help', 'people'],
  world: ['self', 'secret', 'news'],
  notice: ['self', 'help', 'secret'],
};

/** Любими теми на всеки — предлагат се по-често. */
const FAV: Record<VillagerId, string[]> = {
  gena: ['forest', 'samodivi', 'lamia', 'help'],
  peyu: ['river', 'election', 'help'],
  petko: ['chickens', 'people', 'help'],
  ivan: ['weapon', 'help', 'people'],
  maria: ['world', 'self', 'help'],
  radka: ['chickens', 'news', 'people'],
  kalin: ['notice', 'self', 'help'],
};

function text(id: string, rng: Rng, flowing: boolean, dead: boolean): string {
  if (id === 'river' && flowing) return rng.pick(RIVER_FLOW_TEXT);
  if (id === 'lamia' && dead) return rng.pick(LAMIA_DEAD_TEXT);
  return rng.pick(TEXTS[id] ?? TEXTS.news);
}

export function dialogueOptions(req: OptionsRequest): DialogueOption[] {
  const rng = new Rng((req.seed ^ 0x3c6ef372) >>> 0);
  const sit = parseSituation(req.situation ?? '');
  const vid = isVillagerId(req.speaker.id) ? req.speaker.id : undefined;
  const trust = req.partner.relation?.trust ?? 0;
  const last = req.lastOptionId;

  if (req.turn <= 0 || (last === 'greet' && req.turn <= 1)) {
    // първи ход: новини, за себе си, помощ (+ любимата тема понякога)
    const base = ['news', 'self', 'help'];
    if (vid && rng.chance(0.35)) {
      const fav = FAV[vid].find((f) => !base.includes(f) && f !== 'secret');
      if (fav) base[rng.int(0, 1)] = fav;
    }
    return base.map((id) => ({ id, text: text(id, rng, sit.riverFlowing, sit.lamiaDead) }));
  }

  const follow = (last && FOLLOW[last]) || ['news', 'help', 'self'];
  const cands: [string, number][] = [];
  const push = (id: string, w: number) => {
    if (id === last || id === 'bye' || id === 'greet') return;
    if (id === 'secret' && trust < 40) return;
    if (id === 'notice' && vid !== 'kalin') return;
    if (id === 'world' && vid !== 'maria') return;
    if (id === 'weapon' && vid !== 'ivan' && vid !== 'kalin') return;
    const ex = cands.find((x) => x[0] === id);
    if (ex) ex[1] += w; else cands.push([id, w]);
  };
  follow.forEach((id, i) => push(id, 4 - i * 0.7));
  if (vid) FAV[vid].forEach((id, i) => push(id, 3 - i * 0.5));
  ['news', 'self', 'help', 'village'].forEach((id) => push(id, 0.5));
  const picked: string[] = [];
  while (picked.length < 2 && cands.length) {
    const id = rng.weighted(cands);
    picked.push(id);
    cands.splice(cands.findIndex((x) => x[0] === id), 1);
  }
  while (picked.length < 2) picked.push(picked.includes('news') ? 'help' : 'news');
  return [
    ...picked.map((id) => ({ id, text: text(id, rng, sit.riverFlowing, sit.lamiaDead) })),
    { id: 'bye', text: rng.pick(TEXTS.bye) },
  ];
}
