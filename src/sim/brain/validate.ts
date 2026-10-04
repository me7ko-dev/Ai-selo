// Проверка и почистване на отговорите от ИИ. При съмнение → null (и се ползва мозъкът по сценарий).

const B = '(?<![а-яёa-z])';
const E = '(?![а-яёa-z])';
/** Изтичане „като ИИ…“ и подобни. */
const LEAK = new RegExp([
  'изкуствен(ия|ият)? интелект', 'езиков(ия|ият)? модел', `${B}ии${E}`, `${B}ai${E}`, 'as an ai', 'language model', 'chatgpt', 'openai',
  `${B}qwen`, `${B}gemma`, `${B}llama`, `${B}подкан`, `${B}prompt`, `${B}асистент`, 'като модел', 'не мога да изпълня', 'json',
].join('|'), 'iu');
/** Неща, които нямат място в света на играта (религия, алкохол, модерни неща). */
const BANNED = new RegExp([
  `${B}църк`, `${B}свещеник`, `${B}поп(а|ът)?${E}`, `${B}кръст(а|ът|ове)?${E}`, `${B}молитв`, `${B}бог(а|ът|у|ове)?${E}`, `${B}господ`,
  `${B}ракия`, `${B}ракия`, `${B}вино(то)?${E}`, `${B}бира(та)?${E}`, `${B}алкохол`, `${B}пиян`, `${B}водка`,
  `${B}телефон`, `${B}интернет`, `${B}компютър`, `${B}кола(та)?${E}`, `${B}автомобил`, `${B}телевиз`,
].join('|'), 'iu');

export function cyrillicRatio(t: string): { ratio: number; cyr: number } {
  const letters = t.match(/[a-zа-яё]/giu) ?? [];
  const cyr = t.match(/[а-яё]/giu) ?? [];
  return { ratio: letters.length ? cyr.length / letters.length : 0, cyr: cyr.length };
}

function splitSentences(t: string): string[] {
  const out = t.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? [t];
  return out.map((s) => s.trim()).filter(Boolean);
}

export interface CleanOpts { maxSentences?: number; maxLen?: number; minCyr?: number }

/** Почиства една реплика. Връща null, ако не става. */
export function cleanLine(raw: unknown, opts: CleanOpts = {}): string | null {
  const maxSentences = opts.maxSentences ?? 3;
  const maxLen = opts.maxLen ?? 400;
  if (typeof raw !== 'string') return null;
  let t = raw.replace(/\r/g, ' ').replace(/\n+/g, ' ').trim();
  if (!t) return null;
  // markdown и сценични бележки
  t = t.replace(/\*[^*]{1,60}\*/g, ' ').replace(/\([^)]{1,60}\)/g, ' ').replace(/\[[^\]]{1,60}\]/g, ' ');
  t = t.replace(/[*_#`~]+/g, '').replace(/\s+/g, ' ').trim();
  // „Иван: …“ в началото
  t = t.replace(/^[А-ЯЁA-Z][а-яёa-zА-Я\s]{0,22}:\s+/u, '');
  // обграждащи кавички
  for (let i = 0; i < 3; i++) {
    const m = /^[„“"'«»‚‘’”]+(.*?)[„“"'«»‚‘’”]+$/su.exec(t);
    if (!m) break;
    t = m[1].trim();
  }
  t = t.replace(/^[—–-]\s*/, '');
  if (!t) return null;
  if (BANNED.test(t)) return null;
  // изречения с изтичане → махаме
  let sents = splitSentences(t).filter((s) => !LEAK.test(s));
  if (!sents.length) return null;
  sents = sents.slice(0, maxSentences);
  let out = sents.join(' ');
  while (out.length > maxLen && sents.length > 1) { sents.pop(); out = sents.join(' '); }
  if (out.length > maxLen) {
    const cut = out.slice(0, maxLen - 1);
    out = cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[,;:—\s]+$/, '') + '…';
  }
  out = out.replace(/\s+([,.!?])/g, '$1').trim();
  const { ratio, cyr } = cyrillicRatio(out);
  if (cyr < (opts.minCyr ?? 3) || ratio < 0.75) return null;
  if (/undefined|NaN|\{|\}/.test(out)) return null;
  return out;
}

/** Настроение: една-две думи на кирилица. */
export function cleanMood(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase().replace(/[.!„“"'*]/g, '');
  if (!t || t.length > 24) return null;
  if (!/^[а-яё]+(?:[\s-][а-яё]+)?$/u.test(t)) return null;
  return t;
}

/** Опит да се извади JSON обект от текст (понякога моделът добавя ```json …```). */
export function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const tryParse = (x: string) => { try { const v = JSON.parse(x); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; } };
  const direct = tryParse(s);
  if (direct) return direct;
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return tryParse(s.slice(a, b + 1));
  return null;
}
