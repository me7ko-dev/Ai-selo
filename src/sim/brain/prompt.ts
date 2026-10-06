// Подкани (prompts) към ИИ (Ollama / Genesis) — на български, кратки (num_ctx 4096).
import { dayOf, formatClock } from '../../core/time';
import type { Memory, Relation } from '../types';
import type { ChatRequest, Partner, Persona, PlanRequest, ReactRequest, ReflectRequest, RetellRequest, TalkRequest } from './Brain';
import { isFemale, nameOf, profileOf } from './context';

export interface Prompt { system: string; user: string; format: Record<string, unknown> }

const WORLD = 'Светът: българско приказно село Самодивско в планината, старо време. Ламята (с три глави) седна на извора и пресуши река Бистрица. В Тъмната гора по здрач излизат таласъми, на поляната нощем играят самодиви. В селото има чешма, мегдан със стар орех, ковачница, хан (храна и билков чай), кошара, ниви.';

const RULES = [
  'Отговаряй САМО на български език.',
  'Говори като героя си, с неговите думи и изрази. 1–3 кратки изречения.',
  'Никога не споменавай, че си изкуствен интелект, модел или програма. Не излизай от ролята.',
  'Няма модерни неща (телефони, коли, интернет). Няма религия, църкви, свещеници и кръстове. Няма алкохол — в хана има храна и билков чай.',
  'Не измисляй нови жители или места извън селото и околността му.',
  'Не казвай часове и номера на дни от спомените си ("в 13:20", "Ден 3") — хората в селото говорят „вчера“, „сутринта“, „по здрач“.',
].join('\n');

function clip(t: string, words: number): string {
  const w = (t || '').split(/\s+/);
  return w.length <= words ? t : w.slice(0, words).join(' ') + '…';
}

function level(v: number, hi: string, mid: string, lo: string, neg: string, veryNeg: string): string {
  if (v >= 60) return hi;
  if (v >= 20) return mid;
  if (v > -20) return lo;
  if (v > -55) return neg;
  return veryNeg;
}

export function relationWords(name: string, r?: Relation, female = false): string {
  const go = female ? 'я' : 'го', mu = female ? 'ѝ' : 'му';
  if (!r) return `${name}: не ${go} познаваш добре.`;
  const aff = level(r.affinity, `много ${go} обичаш`, `харесваш ${go}`, `нито ${go} харесваш, нито не`, `не ${go} харесваш`, `не ${go} понасяш`);
  const tr = level(r.trust, `вярваш ${mu} напълно`, `вярваш ${mu}`, `не си сигурен дали да ${mu} вярваш`, `не ${mu} вярваш`, `никак не ${mu} вярваш`);
  return `${name}: ${aff}; ${tr} (симпатия ${r.affinity}, доверие ${r.trust}).`;
}

/** „с Иван“, но „със странника“, „със Стоян“. */
function withS(name: string): string { return /^[сзСЗ]/.test(name) ? `със ${name}` : `с ${name}`; }

function genderNote(p: Persona): string {
  return isFemale(p) ? 'Ти си жена — говори за себе си в женски род.' : 'Ти си мъж — говори за себе си в мъжки род.';
}

function secretNote(p: Persona, trust: number): string {
  const secret = p.secret ?? profileOf(p.id)?.secret;
  if (!secret || trust < 40) return 'Имаш тайна, но не я издавай и не намеквай за нея.';
  if (trust < 70) return `Твоята тайна: ${secret} Пази я — най-много леко намекни, че имаш тайна.`;
  return `Твоята тайна: ${secret} Вярваш на събеседника — можеш да му я разкажеш, ако те пита.`;
}

export function systemPrompt(p: Persona, partner: Partner | null, extra = ''): string {
  const prof = profileOf(p.id);
  const trust = partner?.relation?.trust ?? 0;
  const lines = [
    `Ти си ${p.name} (${p.job}) от село Самодивско.`,
    clip(p.card || prof?.card || '', 120),
    `Как говориш: ${p.speech || prof?.speech || ''}`,
    genderNote(p),
    WORLD,
    partner ? `Говориш ${withS(partner.isPlayer ? 'странника Стоян (дошъл отдалеч, с кафяво наметало и сабя)' : nameOf(partner.id, partner.name))}. ${relationWords(partner.isPlayer ? 'Странникът' : nameOf(partner.id, partner.name), partner.relation, !partner.isPlayer && isFemale(partner))}` : '',
    p.beliefs?.length ? `Какво мислиш: ${p.beliefs.slice(0, 5).join(' ')}` : '',
    `Настроение: ${p.mood || 'спокойно'}.`,
    partner ? secretNote(p, trust) : '',
    'Правила:',
    RULES,
    extra,
  ];
  return lines.filter(Boolean).join('\n');
}

export function memoryLines(ms: Memory[], max = 8): string {
  const list = (ms ?? []).filter((m) => m && typeof m.text === 'string').slice(-max);
  if (!list.length) return 'Спомени: няма важни.';
  return 'Спомени:\n' + list.map((m) => `- Ден ${dayOf(m.time)}, ${formatClock(m.time)}: ${m.text}`).join('\n');
}

function historyLines(req: TalkRequest): string {
  const h = (req.history ?? []).slice(-8);
  if (!h.length) return 'Разговорът тепърва започва.';
  return 'Разговорът досега:\n' + h.map((x) => {
    const who = x.who === req.speaker.id ? 'Ти' : x.who === 'player' || x.who === req.partner.id ? (req.partner.isPlayer ? 'Странникът' : nameOf(req.partner.id, req.partner.name)) : nameOf(x.who);
    return `${who}: ${x.text}`;
  }).join('\n');
}

const OPTION_HINT: Record<string, string> = {
  greet: 'Странникът току-що дойде при теб. Поздрави го според часа и отношението си.',
  news: 'Странникът пита какво ново. Разкажи слух или скорошна случка от спомените си.',
  self: 'Странникът пита за теб. Разкажи за работата, какво обичаш, за какво мечтаеш.',
  help: 'Странникът предлага помощ. Кажи каква е твоята грижа.',
  bye: 'Странникът се сбогува. Изпрати го с една реплика; action = "end".',
};

export const TALK_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string' },
    action: { type: 'string', enum: ['none', 'end', 'give_quest', 'walk_away'] },
    mood: { type: 'string' },
    remember: { type: 'string' },
  },
  required: ['say', 'action', 'mood', 'remember'],
};
export const REACT_SCHEMA = {
  type: 'object',
  properties: { say: { type: 'string' }, mood: { type: 'string' }, remember: { type: 'string' } },
  required: ['say', 'mood', 'remember'],
};
export function chatSchema(aId: string, bId: string) {
  return {
    type: 'object',
    properties: {
      lines: {
        type: 'array', minItems: 2, maxItems: 4,
        items: { type: 'object', properties: { who: { type: 'string', enum: [aId, bId] }, text: { type: 'string' } }, required: ['who', 'text'] },
      },
      summary: { type: 'string' },
      affinityDelta: { type: 'integer', minimum: -10, maximum: 10 },
    },
    required: ['lines', 'summary', 'affinityDelta'],
  };
}
export const REFLECT_SCHEMA = {
  type: 'object',
  properties: { beliefs: { type: 'array', maxItems: 5, items: { type: 'string' } } },
  required: ['beliefs'],
};
export const PLAN_SCHEMA = { type: 'object', properties: { plan: { type: 'string' } }, required: ['plan'] };

export function talkPrompt(req: TalkRequest): Prompt {
  const hint = req.optionId && OPTION_HINT[req.optionId] ? `\nПодсказка: ${OPTION_HINT[req.optionId]}` : '';
  const user = [
    `Ситуация: ${req.situation}`,
    memoryLines(req.memories),
    historyLines(req),
    `${req.partner.isPlayer ? 'Странникът' : nameOf(req.partner.id, req.partner.name)} казва: „${(req.input || '').slice(0, 300)}“${hint}`,
    'Отговори в ролята си. Върни JSON: {"say": "твоята реплика (1–3 изречения)", "action": "none|end|give_quest|walk_away", "mood": "настроението ти с една дума", "remember": "кратък спомен от първо лице за този разговор или празно"}',
  ].join('\n');
  return { system: systemPrompt(req.speaker, req.partner), user, format: TALK_SCHEMA };
}

export function chatPrompt(req: ChatRequest): Prompt {
  const a = req.a, b = req.b;
  const system = [
    'Ти пишеш кратки сцени от живота на българско приказно село Самодивско.',
    WORLD,
    `${a.name} (id "${a.id}", ${a.job}): ${clip(a.card, 60)} Говори: ${a.speech} Настроение: ${a.mood}.`,
    `${b.name} (id "${b.id}", ${b.job}): ${clip(b.card, 60)} Говори: ${b.speech} Настроение: ${b.mood}.`,
    relationWords(`${a.name} към ${b.name}`, req.relationAB, isFemale(b)),
    relationWords(`${b.name} към ${a.name}`, req.relationBA, isFemale(a)),
    'Правила:',
    RULES,
    'Всеки герой пази тайните си.',
  ].join('\n');
  const user = [
    `Ситуация: ${req.situation}`,
    `Тема: ${TOPIC_WORDS[req.topic] ?? req.topic}.`,
    req.rumor ? `Слух, който се предава: „${req.rumor}“` : '',
    `Спомени на ${a.name}:\n${memoryLines(req.memoriesA, 4).replace(/^Спомени:\n?/, '')}`,
    `Спомени на ${b.name}:\n${memoryLines(req.memoriesB, 4).replace(/^Спомени:\n?/, '')}`,
    `Напиши разговор от 2 до 4 кратки реплики между тях (who = "${a.id}" или "${b.id}", започва "${a.id}"), едно изречение за летописа (summary, в трето лице, като в приказка) и affinityDelta от -10 до 10 (как се промени отношението им). Върни JSON.`,
  ].filter(Boolean).join('\n');
  return { system, user, format: chatSchema(a.id, b.id) };
}

const TOPIC_WORDS: Record<string, string> = {
  weather: 'времето', river: 'пресъхналата река Бистрица', gossip: 'клюка от селото', love: 'любовта (Иван тайно обича Мария)',
  quarrel: 'кавга', work: 'работата', stranger: 'странника Стоян', lamia: 'Ламята', election: 'изборите за кмет',
  festival: 'сбора (празник с хоро и огън)', fear: 'страшната нощ (Караконджул или таласъми)', greeting: 'кратък поздрав на минаване',
};

export function reactPrompt(req: ReactRequest): Prompt {
  const user = [
    `Ситуация: ${req.situation}`,
    memoryLines(req.memories, 5),
    `Току-що се случи: ${req.event}`,
    'Как реагираш на глас? Върни JSON: {"say": "реакцията ти (1–2 изречения)", "mood": "настроението ти с една дума", "remember": "кратък спомен от първо лице"}',
  ].join('\n');
  return { system: systemPrompt(req.speaker, null), user, format: REACT_SCHEMA };
}

export function planPrompt(req: PlanRequest): Prompt {
  const user = [
    `Ситуация: ${req.situation}`,
    memoryLines(req.memories, 6),
    'Какво смяташ да правиш днес? Едно-две кратки изречения от първо лице, според работата и грижите ти. Върни JSON: {"plan": "..."}',
  ].join('\n');
  return { system: systemPrompt(req.speaker, null), user, format: PLAN_SCHEMA };
}

export function reflectPrompt(req: ReflectRequest): Prompt {
  const user = [
    req.beliefs?.length ? `Досегашните ти убеждения:\n${req.beliefs.map((b) => `- ${b}`).join('\n')}` : 'Още нямаш убеждения.',
    memoryLines(req.memories, 8),
    'Вечер е. Помисли над деня. Свий спомените до най-много 5 кратки убеждения от първо лице — за странника, за другите жители, за реката и Ламята (например „Странникът ми помогна. Може би на него може да се вярва.“). Запази най-важните стари убеждения, ако още са верни. Върни JSON: {"beliefs": ["...", "..."]}',
  ].join('\n');
  return { system: systemPrompt(req.speaker, null), user, format: REFLECT_SCHEMA };
}

export function retellSchema(n: number) {
  return {
    type: 'object',
    properties: { texts: { type: 'array', minItems: n, maxItems: n, items: { type: 'string' } } },
    required: ['texts'],
  };
}

/** „Докато те нямаше…“: преразказ на най-важните случки като в книжка с приказки. */
export function retellPrompt(req: RetellRequest): Prompt {
  const n = req.events.length;
  const system = [
    'Ти си стар разказвач от село Самодивско. Странникът Стоян се връща в селото след отсъствие и ти му разказваш накратко какво е станало, докато го е нямало.',
    WORLD,
    'Жителите: баба Гена (билкарка), дядо Пею (кмет), Петко (овчар), Иван (ковач), Мария (тъкачка), Радка (стопанка на хана), Калин (дърводелец).',
    'Правила:',
    'Пиши САМО на български език, с правилен род и падеж.',
    'Всяка случка — 1 или 2 кратки, живи изречения в минало време, в трето лице, като в книжка с приказки: топло, с малка подробност (звук, светлина, жест).',
    'Пази фактите: същите хора, същото място, същият изход. Не измисляй нови жители, места или случки.',
    'Без модерни неща, без религия, църкви и кръстове, без алкохол. Никога не споменавай, че си изкуствен интелект.',
  ].join('\n');
  const list = req.events.map((e, i) => {
    const who = e.participants.filter((p) => p !== 'player').map((p) => nameOf(p)).join(', ');
    return `${i + 1}. (Ден ${dayOf(e.time)}, ${formatClock(e.time)}) ${e.title}: ${e.text}${who ? ` [участници: ${who}]` : ''}`;
  }).join('\n');
  const user = [
    `Сега: ${req.situation}`,
    `Случките (${n}):`,
    list,
    `Преразкажи всяка случка поотделно, в същия ред. Върни JSON: {"texts": [${Array.from({ length: n }, (_, i) => `"разказ за случка ${i + 1}"`).join(', ')}]}`,
  ].join('\n');
  return { system, user, format: retellSchema(n) };
}

/**
 * Пример за формата на отговора, изведен от JSON схемата (за модели, които не приемат схема — напр. облачните през Genesis).
 * {type:'object', properties:{say:{type:'string'}}} → {"say":"…"}; enum → "a|b"; масив → [пример]; число → 0.
 */
export function jsonShape(schema: unknown): unknown {
  const s = (schema && typeof schema === 'object' ? schema : {}) as Record<string, unknown>;
  switch (s.type) {
    case 'object': {
      const props = (s.properties && typeof s.properties === 'object' ? s.properties : {}) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) out[k] = jsonShape(v);
      return out;
    }
    case 'array': {
      const n = Math.max(1, Math.min(6, typeof s.minItems === 'number' ? s.minItems : 1));
      return Array.from({ length: n }, () => jsonShape(s.items));
    }
    case 'integer': case 'number': return 0;
    case 'boolean': return false;
    default: return Array.isArray(s.enum) ? s.enum.join('|') : '…';
  }
}

/** Същата подкана, но с изрично указание за JSON във system (когато сървърът не приема JSON схема). */
export function withJsonShape(p: Prompt): Prompt {
  const rule = `Отговори САМО с един JSON обект, без друг текст и без \`\`\`. Ключовете са на английски точно както тук, а текстовете — на български:\n${JSON.stringify(jsonShape(p.format))}`;
  return { ...p, system: `${p.system}\n${rule}` };
}
