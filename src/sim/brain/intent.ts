// Разпознаване на намерението в свободен текст на играча (по корени на български думи).
import type { VillagerId } from '../../data/villagers';

export type Intent =
  | 'insult' | 'bye' | 'thanks' | 'compliment' | 'greet' | 'secret' | 'person'
  | 'lamia' | 'river' | 'chickens' | 'samodivi' | 'talasam' | 'karakondzhul' | 'election' | 'forest' | 'rosen'
  | 'love' | 'money' | 'weapon' | 'inn' | 'howareyou' | 'doing' | 'whoareyou' | 'self' | 'village' | 'news'
  | 'help' | 'weather' | 'introduce' | 'unknown';

export interface IntentResult { intent: Intent; target?: VillagerId; question: boolean; word?: string }

const L = '[^а-яёa-z]';
/** Корен: съвпада в началото на дума. Ако завършва на „!“ — само цялата дума. */
function stemRe(stem: string): RegExp {
  if (stem.endsWith('!')) return new RegExp(`(^|${L})${stem.slice(0, -1)}(?=${L}|$)`, 'u');
  return new RegExp(`(^|${L})${stem}`, 'u');
}
const cache = new Map<string, RegExp>();
export function has(text: string, stem: string): boolean {
  let re = cache.get(stem);
  if (!re) { re = stemRe(stem); cache.set(stem, re); }
  return re.test(text);
}
function any(text: string, stems: string[]): string | undefined { return stems.find((s) => has(text, s)); }

const INSULTS = ['глупа', 'глупо', 'тъпак', 'тъпанар', 'тъп си', 'тъпа си', 'идиот', 'малоум', 'магаре', 'простак', 'простач', 'смрадлив', 'урод', 'гадин', 'гад ', 'гад$', 'мръсник', 'лъжец', 'лъжкин', 'мразя те', 'махай се', 'млъкни', 'вещиц', 'дърт', 'грозна си', 'грозен си', 'тиквеник', 'серсем', 'загубеня', 'нещастник', 'хайван', 'говед', 'боклук', 'жалък', 'жалка', 'кретен', 'смотан'];

const PEOPLE: [VillagerId, string[]][] = [
  ['gena', ['гена', 'гено', 'баба', 'бабо', 'билкар']],
  ['peyu', ['пею', 'пейо', 'дядо', 'кмет']],
  ['petko', ['петк', 'овчар']],
  ['ivan', ['иван', 'ковач']],
  ['maria', ['мария', 'марийо', 'марийк', 'мари ', 'тъкач']],
  ['radka', ['радк', 'ханджий']],
  ['kalin', ['калин', 'дърводел']],
];

export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.endsWith('?')) return true;
  if (/^(кой|коя|кое|кои|какво|какъв|каква|какви|къде|кога|защо|как|колко|дали|чий|чия|откъде|накъде)(\s|$)/u.test(t)) return true;
  return has(t, 'ли ');
}

export function detectIntent(raw: string, speakerId: string): IntentResult {
  const t = ' ' + (raw || '').toLowerCase().replace(/ё/g, 'е').replace(/[„“"«»]/g, '') + ' ';
  const question = isQuestion(raw || '');

  // обида (но не „кой е крадецът“)
  const ins = INSULTS.find((s) => s.endsWith('$') ? new RegExp(`${L}${s.slice(0, -1)}\\s*$`, 'u').test(t) : has(t, s));
  if (ins) return { intent: 'insult', question, word: ins.replace('$', '').trim() };

  if (any(t, ['сбогом', 'довиждане', 'чао', 'тръгвам', 'лека нощ', 'до скоро', 'до утре', 'отивам си', 'хайде, със здраве'])) return { intent: 'bye', question };
  if (any(t, ['благодар', 'мерси', 'спасибо', 'благодаря'])) return { intent: 'thanks', question };

  // хора
  let target: VillagerId | undefined;
  for (const [id, stems] of PEOPLE) {
    if (stems.some((s) => has(t, s))) { target = id; break; }
  }

  if (any(t, ['кокош', 'лисиц', 'кражб', 'краде', 'крадец', 'крадат', 'откраднал', 'кокошар'])) return { intent: 'chickens', question, target };
  if (any(t, ['тайн', 'криеш', 'скриваш'])) return { intent: 'secret', question, target };

  if (target === speakerId) {
    if (any(t, ['кмет']) && speakerId === 'peyu') return { intent: 'election', question };
    return { intent: question ? 'whoareyou' : 'self', question };
  }
  if (target && !(target === 'peyu' && any(t, ['избор', 'глас']))) {
    if (target === 'maria' && speakerId === 'ivan' && any(t, ['обич', 'любов', 'влюб', 'харес'])) return { intent: 'love', question, target };
    return { intent: 'person', question, target };
  }

  if (any(t, ['ламя', 'ламят', 'ламя ', 'змей', 'хала', 'три глави', 'триглав', 'ламин'])) return { intent: 'lamia', question };
  if (any(t, ['караконджул'])) return { intent: 'karakondzhul', question };
  if (any(t, ['таласъм', 'таласъми', 'чудовищ', 'сянк'])) return { intent: 'talasam', question };
  if (any(t, ['самодив', 'поляна', 'юди', 'горски моми'])) return { intent: 'samodivi', question };
  if (any(t, ['росен', 'билк', 'отвар', 'лек ', 'церя'])) return { intent: 'rosen', question };
  if (any(t, ['река', 'реки!', 'вода', 'бистриц', 'суша!', 'пресъх', 'чешм', 'кладен', 'извор'])) return { intent: 'river', question };
  if (any(t, ['избор', 'гласува', 'гласа'])) return { intent: 'election', question };
  if (any(t, ['гора!', 'гората', 'горите', 'горски'])) return { intent: 'forest', question };
  if (any(t, ['обич', 'любов', 'влюб', 'харесваш', 'сърце', 'жени', 'сватб', 'целув'])) return { intent: 'love', question };
  if (any(t, ['пари!', 'парите', 'парички', 'дълг', 'длъж', 'злато', 'жълтиц', 'платя', 'плати', 'грош', 'богат'])) return { intent: 'money', question };
  if (any(t, ['сабя', 'сабят', 'меч!', 'лък!', 'лъка!', 'оръж', 'стрел', 'нож!'])) return { intent: 'weapon', question };
  if (any(t, ['хан!', 'ханът', 'хана!', 'ядене', 'яде', 'баниц', 'боб!', 'чай!', 'чая!', 'гладен', 'гладна', 'храна', 'обяд', 'вечеря', 'закуск'])) return { intent: 'inn', question };

  if (any(t, ['хубава си', 'хубав си', 'умна си', 'умен си', 'браво', 'мил си', 'мила си', 'красив', 'добър човек си', 'добра жена си', 'харесвам те', 'юнак си', 'страхотн', 'прекрас'])) return { intent: 'compliment', question };
  if (any(t, ['казвам се', 'аз съм стоян', 'името ми', 'аз съм странник'])) return { intent: 'introduce', question };
  if (any(t, ['как си', 'как сте', 'как е животът', 'как върви', 'как я караш', 'добре ли си'])) return { intent: 'howareyou', question };
  if (any(t, ['какво правиш', 'с какво се занимаваш', 'какво работиш', 'какво майстор', 'зает ли', 'заета ли'])) return { intent: 'doing', question };
  if (any(t, ['кой си', 'коя си', 'как се казваш', 'името ти', 'кой сте', 'ти кой'])) return { intent: 'whoareyou', question };
  if (any(t, ['за себе си', 'за теб', 'какво обичаш', 'мечта', 'мечтаеш', 'разкажи ми за теб'])) return { intent: 'self', question };
  if (any(t, ['помощ', 'помогна', 'помогн', 'задач', 'да направя', 'нужда', 'трябва ли ти', 'с какво мога'])) return { intent: 'help', question };
  if (any(t, ['ново', 'новини', 'какво става', 'слух', 'клюк', 'чу ли', 'какво се говори', 'разказ'])) return { intent: 'news', question };
  if (any(t, ['село', 'селото', 'самодивско', 'хората тук', 'съседи'])) return { intent: 'village', question };
  if (any(t, ['времето', 'дъжд', 'вали', 'слънц', 'буря', 'мъгла', 'студ', 'горещ'])) return { intent: 'weather', question };
  if (any(t, ['здравей', 'здрасти', 'добър ден', 'добро утро', 'добър вечер', 'привет', 'ехо!', 'хей!'])) return { intent: 'greet', question };
  return { intent: 'unknown', question };
}
