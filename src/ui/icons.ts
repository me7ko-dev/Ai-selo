// Иконки (вграден SVG, без външни картинки) + портрети на жителите и героя.
// Чиста функция (без DOM) — тества се в Node.
import type { IconKey } from '../data/icons';
import { VILLAGERS, type VillagerId } from '../data/villagers';
import type { ChronicleType } from '../sim/types';
import { portraitImage } from './portrait3d';

const O = '#24160c'; // контур
const S = `stroke="${O}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"`;

/** Тяло на иконите във viewBox 0 0 24 24. */
const ICONS: Record<IconKey, string> = {
  saber: `<path d="M5 19 C9 15 14 9 19 3 C18 8 14 13 7 20 Z" fill="#d9dde2" ${S}/><path d="M4 17 l3 3" stroke="#e8c27a" stroke-width="2.4" stroke-linecap="round"/><path d="M3.5 20.5 l1.5-1.5" stroke="#6b4a2f" stroke-width="2.6" stroke-linecap="round"/>`,
  ivan_saber: `<path d="M5 19 C9 15 14 9 20 3 C19 9 14 13 7 20 Z" fill="#eef2f6" ${S}/><path d="M8 16 C11 13 14 9 17 6" stroke="#9fb3c8" stroke-width="0.8" fill="none"/><path d="M3.5 16.5 l4 4" stroke="#e8c27a" stroke-width="2.6" stroke-linecap="round"/><path d="M3.2 20.8 l1.6-1.6" stroke="#b3262b" stroke-width="2.6" stroke-linecap="round"/><circle cx="5.6" cy="18.4" r="1" fill="#b3262b"/>`,
  bow: `<path d="M7 3 C15 6 15 18 7 21" fill="none" stroke="#8a5a32" stroke-width="2.4" stroke-linecap="round"/><path d="M7 3 C15 6 15 18 7 21" fill="none" ${S} stroke-width="0.6"/><path d="M7 3 L7 21" stroke="#efe6d4" stroke-width="0.9"/><path d="M4 12 H20 M18 10 l2 2 -2 2" stroke="#d9dde2" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  rosen: `<path d="M12 22 V10" stroke="#4f7a3a" stroke-width="1.6"/><path d="M12 16 C8 15 7 12 7 11 C10 11 12 13 12 16 Z M12 14 C16 13 17 10 17 9 C14 9 12 11 12 14 Z" fill="#6f9a4a" ${S}/><g fill="#d58ad0" ${S}><circle cx="12" cy="6" r="2.3"/><circle cx="9" cy="8" r="1.8"/><circle cx="15" cy="8" r="1.8"/></g><circle cx="12" cy="6" r="0.8" fill="#f6e27a"/>`,
  potion: `<path d="M10 3 h4 v4 C18 9 19 12 19 15 A7 7 0 0 1 5 15 C5 12 6 9 10 7 Z" fill="#c8423a" ${S}/><path d="M6.5 14 A5.5 5.5 0 0 0 17.5 14" fill="none" stroke="#ff9a8a" stroke-width="1"/><rect x="9.5" y="2" width="5" height="2.4" rx="0.6" fill="#8a5a32" ${S}/><circle cx="9.5" cy="12" r="1.2" fill="#ffd2c8" opacity="0.8"/>`,
  banitsa: `<ellipse cx="12" cy="15" rx="9" ry="5" fill="#d79a4a" ${S}/><ellipse cx="12" cy="13" rx="9" ry="5" fill="#f0c070" ${S}/><path d="M12 13 m-6 0 a6 3 0 1 0 12 0 a4 2 0 1 0 -8 0 a2 1 0 1 0 4 0" fill="none" stroke="#b9772f" stroke-width="1.1"/>`,
  tea: `<path d="M5 9 h12 v5 a6 6 0 0 1 -12 0 Z" fill="#efe6d4" ${S}/><path d="M17 10 a3 3 0 0 1 0 6" fill="none" ${S} stroke-width="1.6"/><path d="M6 10 h10" stroke="#a4472f" stroke-width="1.6"/><path d="M8 3 c-1 2 1 2 0 4 M12 3 c-1 2 1 2 0 4" stroke="#c9bfa8" stroke-width="1" fill="none" stroke-linecap="round"/><path d="M4 21 h14" ${S}/>`,
  bread: `<path d="M3 15 C3 9 8 7 12 7 C16 7 21 9 21 15 C21 17 19 18 12 18 C5 18 3 17 3 15 Z" fill="#c98a45" ${S}/><path d="M8 10 l2 3 M12 9 l1.5 3.5 M16 10 l1.5 3" stroke="#f3d79a" stroke-width="1.3" stroke-linecap="round"/>`,
  apple: `<path d="M12 7 C8 4 3 7 4 13 C5 19 9 21 12 19 C15 21 19 19 20 13 C21 7 16 4 12 7 Z" fill="#c8423a" ${S}/><path d="M12 7 C12 5 13 3 14 2" stroke="#5a3b26" stroke-width="1.4" fill="none"/><path d="M13 5 C15 3 18 4 18 4 C17 6 15 6 13 5 Z" fill="#6f9a4a" ${S} stroke-width="0.8"/><ellipse cx="8" cy="11" rx="1.3" ry="2" fill="#ff9a8a" opacity="0.7"/>`,
  kalpak: `<path d="M6 17 C5 11 7 5 12 4 C17 5 19 11 18 17 Z" fill="#3a2a22" ${S}/><path d="M4.5 16 h15 a1 1 0 0 1 1 1 v2 h-17 v-2 a1 1 0 0 1 1 -1 Z" fill="#2a1d18" ${S}/><path d="M8 8 l1 1 M12 6 l0 1.3 M15.5 8 l-1 1 M9 12 l1 1 M14 12 l1 -1" stroke="#5a463c" stroke-width="1" stroke-linecap="round"/>`,
  cloak: `<path d="M12 3 C8 3 7 6 7 8 L4 21 H20 L17 8 C17 6 16 3 12 3 Z" fill="#6b4a2f" ${S}/><path d="M9 8 C10 11 14 11 15 8" fill="#3d2a1a" ${S}/><path d="M12 11 V21" stroke="#4a3220" stroke-width="1"/><circle cx="12" cy="11.5" r="1.1" fill="#e8c27a" ${S} stroke-width="0.7"/>`,
  vest: `<path d="M7 3 L10 5 L12 13 L14 5 L17 3 L20 7 L19 20 H5 L4 7 Z" fill="#2e2018" ${S}/><path d="M6 10 l2 1 -2 1 2 1 -2 1 M18 10 l-2 1 2 1 -2 1 2 1" stroke="#b3262b" stroke-width="1" fill="none"/><path d="M5 18 H19" stroke="#e8c27a" stroke-width="1"/>`,
  tsarvuli: `<path d="M3 15 C3 12 6 11 9 12 L14 13 C18 13 21 14 21 17 C21 19 19 19 12 19 C6 19 3 18 3 15 Z" fill="#8a5a32" ${S}/><path d="M7 12 L8 7 M10 12.5 L11 7.5 M8 9 l3 0.5" stroke="#efe6d4" stroke-width="1" stroke-linecap="round"/><path d="M5 16 h14" stroke="#5a3b26" stroke-width="0.9" stroke-dasharray="1.4 1.2"/>`,
  gloves: `<path d="M7 21 V13 C5 12 5 10 6 9 L8 10 V5 a1.2 1.2 0 0 1 2.4 0 V4 a1.2 1.2 0 0 1 2.4 0 V5 a1.2 1.2 0 0 1 2.4 0 V7 a1.2 1.2 0 0 1 2.4 0 V15 L16 21 Z" fill="#9a6a3e" ${S}/><path d="M7 18 h9" stroke="#b3262b" stroke-width="1.6"/>`,
  martenitsa: `<path d="M6 4 C9 8 15 8 18 4" fill="none" stroke="#efe6d4" stroke-width="1.6"/><path d="M6 4 C9 8 15 8 18 4" fill="none" stroke="#c8423a" stroke-width="1.6" stroke-dasharray="1.6 1.6"/><path d="M8 7 V12 M16 7 V12" stroke="#c9bfa8" stroke-width="1"/><circle cx="8" cy="15" r="3" fill="#efe6d4" ${S}/><circle cx="16" cy="15" r="3" fill="#c8423a" ${S}/><path d="M8 18 l-1 3 M8 18 l1 3 M16 18 l-1 3 M16 18 l1 3" stroke="#c9bfa8" stroke-width="1" stroke-linecap="round"/>`,
  ring: `<circle cx="12" cy="14" r="6" fill="none" stroke="${O}" stroke-width="4"/><circle cx="12" cy="14" r="6" fill="none" stroke="#e8c27a" stroke-width="2.4"/><path d="M9 7 L12 3 L15 7 L12 9 Z" fill="#5b8fd6" ${S}/>`,
  fox_tail: `<path d="M4 20 C6 12 12 6 20 4 C19 9 16 15 9 18 C7 19 5 20 4 20 Z" fill="#d6782e" ${S}/><path d="M20 4 C19 7 18 8 16 9 C16 7 17 5 20 4 Z" fill="#f3ead7"/><path d="M8 15 C11 13 13 11 15 8" stroke="#a5521c" stroke-width="1" fill="none"/>`,
  lamia_scale: `<path d="M12 3 C17 6 19 11 18 15 C17 19 14 21 12 21 C10 21 7 19 6 15 C5 11 7 6 12 3 Z" fill="#4f8a6a" ${S}/><path d="M12 6 C15 8 16 12 15 15 M12 6 C9 8 8 12 9 15" stroke="#a8e0b8" stroke-width="1" fill="none"/><path d="M12 6 V19" stroke="#2f5a44" stroke-width="1"/>`,
  claw: `<path d="M5 20 C6 13 10 7 17 4 C14 9 12 14 11 20 Z" fill="#e9e1cf" ${S}/><path d="M11 20 C12 15 15 11 20 9 C17 13 16 16 16 20 Z" fill="#d9cfb8" ${S}/><path d="M4 20 H17" ${S} stroke-width="1.6"/>`,
  coin: `<circle cx="12" cy="12" r="8" fill="#e8c27a" ${S}/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#b08a3a" stroke-width="1.1"/><path d="M12 8.5 L13.2 11 L15.8 11.3 L13.8 13 L14.3 15.6 L12 14.3 L9.7 15.6 L10.2 13 L8.2 11.3 L10.8 11 Z" fill="#b08a3a"/>`,
  bell: `<path d="M6 17 C6 10 8 6 12 6 C16 6 18 10 18 17 Z" fill="#d8a84a" ${S}/><path d="M4 17 H20 v1.5 H4 Z" fill="#b08a3a" ${S}/><circle cx="12" cy="20.5" r="1.6" fill="#8a6a2a" ${S}/><path d="M12 3 v3" ${S} stroke-width="2"/><path d="M8.5 11 C9 9 10 8 11 7.8" stroke="#f6e0a0" stroke-width="1" fill="none"/>`,
  egg: `<path d="M12 3 C16 3 19 10 19 14 A7 7 0 0 1 5 14 C5 10 8 3 12 3 Z" fill="#f3ead7" ${S}/><path d="M7 14 l2 -1.5 2 1.5 2 -1.5 2 1.5 2 -1.5" stroke="#b3262b" stroke-width="1.1" fill="none"/><ellipse cx="9.5" cy="9" rx="1.2" ry="2" fill="#fff" opacity="0.7"/>`,
  key: `<circle cx="7.5" cy="8" r="4" fill="none" stroke="${O}" stroke-width="3.6"/><circle cx="7.5" cy="8" r="4" fill="none" stroke="#c9a24a" stroke-width="2"/><path d="M10.5 11 L19 19.5 M15 15.5 l2 -2 M17.3 17.8 l2 -2" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/><path d="M10.5 11 L19 19.5 M15 15.5 l2 -2 M17.3 17.8 l2 -2" stroke="#c9a24a" stroke-width="1.8" stroke-linecap="round"/>`,
  letter: `<rect x="3" y="6" width="18" height="13" rx="1.2" fill="#efe6d4" ${S}/><path d="M3.5 7 L12 13.5 L20.5 7" fill="none" ${S}/><circle cx="12" cy="13.5" r="2" fill="#b3262b" ${S} stroke-width="0.8"/>`,
  wood: `<rect x="3" y="12" width="15" height="6" rx="3" fill="#8a5a32" ${S}/><ellipse cx="18" cy="15" rx="2.6" ry="3" fill="#d6a86a" ${S}/><circle cx="18" cy="15" r="1.2" fill="none" stroke="#8a5a32" stroke-width="0.8"/><rect x="6" y="6" width="14" height="5.5" rx="2.75" fill="#9a6a3e" ${S}/><ellipse cx="20" cy="8.75" rx="2.3" ry="2.75" fill="#e2b77a" ${S}/>`,
  iron: `<path d="M4 15 L7 9 H17 L20 15 Z" fill="#7d858f" ${S}/><path d="M4 15 H20 V18 H4 Z" fill="#5b636c" ${S}/><path d="M8 10.5 H15" stroke="#c4ccd4" stroke-width="1" stroke-linecap="round"/>`,
  feather: `<path d="M19 3 C10 5 5 11 5 19 C11 18 17 12 19 3 Z" fill="#efe6d4" ${S}/><path d="M19 3 L4 21" stroke="#8a7a62" stroke-width="1.2" stroke-linecap="round"/><path d="M9 11 l3 1 M8 14 l3 0.5 M11 8 l3 1.2" stroke="#c9bfa8" stroke-width="0.9"/>`,
  map: `<path d="M3 6 L9 4 L15 6 L21 4 V18 L15 20 L9 18 L3 20 Z" fill="#e6d3a8" ${S}/><path d="M9 4 V18 M15 6 V20" stroke="#b39a6a" stroke-width="1"/><path d="M5 15 C7 13 10 14 12 11 S17 9 19 8" stroke="#b3262b" stroke-width="1.2" stroke-dasharray="1.6 1.2" fill="none"/><path d="M17.5 6.5 l2 2 M19.5 6.5 l-2 2" stroke="#b3262b" stroke-width="1.2"/>`,
  saddle: `<path d="M3 13 C3 10 6 9 8 9 C10 11 14 11 16 9 C18 9 21 10 21 13 L19 16.5 H5 Z" fill="#a8282a" ${S}/><path d="M5 14.6 h14" stroke="#1a1414" stroke-width="0.9" stroke-dasharray="1.3 1.1"/><path d="M6 10 C6 6 9 5 10 7 C11 9 13 9 14 7 C15 5 18 6 18 10 C15 12 9 12 6 10 Z" fill="#6b4226" ${S}/><path d="M12 12 V18" stroke="#2a1a10" stroke-width="1.2"/><path d="M10 18 h4 l-0.6 2.6 h-2.8 Z" fill="none" stroke="#9aa2ab" stroke-width="1.4"/>`,
  horse: `<path d="M7 21 C7 15 6 11 8 7 L7 3 L10 5 C13 4 16 5 18 8 L21 13 C21 15 19 16 17 15 L14 13 C13 16 14 19 15 21 Z" fill="#8a5a38" ${S}/><path d="M10 5 C8 8 7 12 7.5 17" stroke="#211813" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="14" cy="8.5" r="0.9" fill="#1a1414"/><path d="M19.5 12.6 l0.8 0.4" stroke="#1a1414" stroke-width="1"/>`,
  quest: `<path d="M12 2 L21 12 L12 22 L3 12 Z" fill="#e8c27a" ${S}/><path d="M12 6 L17 12 L12 18 L7 12 Z" fill="none" stroke="#9a7230" stroke-width="1"/><path d="M12 9 V13.5" stroke="${O}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.1" fill="${O}"/>`,
  sun: `<g stroke="#f6c27a" stroke-width="1.8" stroke-linecap="round"><path d="M12 1.5 v3 M12 19.5 v3 M1.5 12 h3 M19.5 12 h3 M4.6 4.6 l2.1 2.1 M17.3 17.3 l2.1 2.1 M4.6 19.4 l2.1-2.1 M17.3 6.7 l2.1-2.1"/></g><circle cx="12" cy="12" r="5" fill="#f6c27a" ${S}/>`,
  moon: `<path d="M15 3 A9 9 0 1 0 21 15 A7 7 0 0 1 15 3 Z" fill="#f4ecd0" ${S}/><circle cx="10" cy="14" r="1.2" fill="#d8ceb0"/><circle cx="13" cy="18" r="0.8" fill="#d8ceb0"/>`,
  heart: `<path d="M12 20 C5 15 3 11 3 8.5 A4.5 4.5 0 0 1 12 6.5 A4.5 4.5 0 0 1 21 8.5 C21 11 19 15 12 20 Z" fill="#c8423a" ${S}/><ellipse cx="8" cy="9" rx="1.5" ry="1" fill="#ff9a8a" opacity="0.8"/>`,
  shield: `<path d="M12 2.5 L20 5.5 V11 C20 16 16 19.5 12 21.5 C8 19.5 4 16 4 11 V5.5 Z" fill="#8a5a32" ${S}/><path d="M12 5 L17.5 7 V11 C17.5 14.6 15 17.2 12 18.8 C9 17.2 6.5 14.6 6.5 11 V7 Z" fill="#b3262b" stroke="#e8c27a" stroke-width="1"/><path d="M12 8 L14 11 L12 14 L10 11 Z" fill="#e8c27a"/>`,
  sword: `<path d="M12 2 L14 5 V15 H10 V5 Z" fill="#d9dde2" ${S}/><path d="M12 5 V15" stroke="#9fb3c8" stroke-width="0.8"/><path d="M6.5 15 H17.5 V17 H6.5 Z" fill="#e8c27a" ${S}/><path d="M11 17 h2 v3.5 h-2 Z" fill="#6b4a2f" ${S}/><circle cx="12" cy="21.5" r="1.2" fill="#e8c27a" ${S} stroke-width="0.8"/>`,
  star: `<path d="M12 2.5 L14.6 9 L21.5 9.4 L16.2 13.8 L17.9 20.6 L12 16.8 L6.1 20.6 L7.8 13.8 L2.5 9.4 L9.4 9 Z" fill="#e8c27a" ${S}/>`,
  empty: `<circle cx="12" cy="12" r="3" fill="none" stroke="#c9bfa8" stroke-width="1" opacity="0.35"/>`,
};

export const ICON_KEYS = Object.keys(ICONS) as IconKey[];

/** Вграден SVG за иконка. size в px или CSS единица ('1.4em'). */
export function icon(key: IconKey, size: number | string = '1.5em'): string {
  const body = ICONS[key] ?? ICONS.empty;
  const s = typeof size === 'number' ? `${size}px` : size;
  return `<svg class="ic ic-${key}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${body}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Видове записи в летописа: икона (с currentColor), цвят, име.

export const TYPE_COLORS: Record<ChronicleType, string> = {
  talk: '#c9bfa8', quarrel: '#e2795a', love: '#e58aa6', theft: '#9a7ac8', rumor: '#d6b45a', election: '#e8c27a',
  work: '#9cb36a', festival: '#f6c27a', monster: '#c8423a', player: '#7fc0d8', quest: '#e8c27a', weather: '#8fb3d9',
  live: '#d94a8a', reflection: '#a99ad6', mood: '#b8a888', system: '#8a8478',
};

export const TYPE_LABELS: Record<ChronicleType, string> = {
  talk: 'Разговори', quarrel: 'Кавги', love: 'Любов', theft: 'Кражби', rumor: 'Слухове', election: 'Избори',
  work: 'Работа', festival: 'Празници', monster: 'Чудовища', player: 'Странникът', quest: 'Задачи', weather: 'Времето',
  live: 'На живо', reflection: 'Размисли', mood: 'Настроения', system: 'Записи',
};

const TYPE_GLYPH: Record<ChronicleType, string> = {
  talk: `<path d="M4 5 h16 v10 h-9 l-4 4 v-4 h-3 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  quarrel: `<path d="M13 2 L6 13 h5 l-2 9 L18 10 h-5 l2 -8 Z" fill="currentColor"/>`,
  love: `<path d="M12 20 C5 15 3 11 3 8.5 A4.5 4.5 0 0 1 12 6.5 A4.5 4.5 0 0 1 21 8.5 C21 11 19 15 12 20 Z" fill="currentColor"/>`,
  theft: `<path d="M5 10 C5 6 9 4 12 4 C15 4 19 6 19 10 V13 C19 17 15 20 12 20 C9 20 5 17 5 13 Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 11 H19 V14 H5 Z" fill="currentColor"/><circle cx="9" cy="12.5" r="1" fill="#14100c"/><circle cx="15" cy="12.5" r="1" fill="#14100c"/>`,
  rumor: `<path d="M3 9 h4 l6 -5 v16 l-6 -5 h-4 Z" fill="currentColor"/><path d="M16 8 c2 2 2 6 0 8 M19 5 c4 4 4 10 0 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  election: `<path d="M4 11 h16 v9 h-16 Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 11 V4 h6 v7" fill="currentColor"/><path d="M8 15 h8" stroke="currentColor" stroke-width="1.6"/>`,
  work: `<path d="M4 20 L13 11 M11 5 l3 -2 6 6 -2 3 Z" fill="currentColor" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  festival: `<path d="M12 3 C15 7 17 9 17 13 A5 5 0 0 1 7 13 C7 10 9 9 9 6 C10.5 7.5 11 8.5 11 10 C12.5 8.5 12.5 5.5 12 3 Z" fill="currentColor"/><path d="M5 21 L19 17 M5 17 L19 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  monster: `<path d="M4 20 C4 11 7 5 12 5 C17 5 20 11 20 20 L17 17 L14.5 20 L12 17 L9.5 20 L7 17 Z" fill="currentColor"/><path d="M5 7 L8 3 L9 7 M19 7 L16 3 L15 7" fill="currentColor"/><circle cx="9.5" cy="11" r="1.4" fill="#14100c"/><circle cx="14.5" cy="11" r="1.4" fill="#14100c"/>`,
  player: `<path d="M12 3 C8.5 3 7 6 7 9 L5 21 H19 L17 9 C17 6 15.5 3 12 3 Z" fill="currentColor"/><path d="M9.5 9.5 C10 12 14 12 14.5 9.5 Z" fill="#14100c"/>`,
  quest: `<path d="M12 2 L21 12 L12 22 L3 12 Z" fill="currentColor"/><path d="M12 8 V13" stroke="#14100c" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.1" fill="#14100c"/>`,
  weather: `<path d="M7 16 A4 4 0 0 1 7.5 8 A5.5 5.5 0 0 1 18 9 A3.5 3.5 0 0 1 17.5 16 Z" fill="currentColor"/><path d="M8 19 l-1 2.5 M12 19 l-1 2.5 M16 19 l-1 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  live: `<circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.6"/>`,
  reflection: `<path d="M15 3 A9 9 0 1 0 21 15 A7 7 0 0 1 15 3 Z" fill="currentColor"/><path d="M18 3 l0.7 1.6 1.6 0.7 -1.6 0.7 -0.7 1.6 -0.7 -1.6 -1.6 -0.7 1.6 -0.7 Z" fill="currentColor"/>`,
  mood: `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path d="M8 14.5 C10 17 14 17 16 14.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  system: `<path d="M6 3 h9 l4 4 v14 h-13 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 11 h6 M9 14.5 h6 M9 18 h4" stroke="currentColor" stroke-width="1.5"/>`,
};

/** Малка иконка за вида запис (оцветена с TYPE_COLORS, ако color не е зададен). */
export function typeIcon(type: ChronicleType, size: number | string = '1.1em', color?: string): string {
  const s = typeof size === 'number' ? `${size}px` : size;
  const c = color ?? TYPE_COLORS[type] ?? '#c9bfa8';
  return `<svg class="ti ti-${type}" viewBox="0 0 24 24" width="${s}" height="${s}" style="color:${c}" aria-hidden="true">${TYPE_GLYPH[type] ?? TYPE_GLYPH.system}</svg>`;
}

/** Блестяща звездичка — маркер за текст, написан от ИИ. */
export function sparkle(size: number | string = '0.9em'): string {
  const s = typeof size === 'number' ? `${size}px` : size;
  return `<svg class="sparkle" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="M12 1 L14 10 L23 12 L14 14 L12 23 L10 14 L1 12 L10 10 Z" fill="#e8c27a"/><path d="M19 2 L19.8 4.2 L22 5 L19.8 5.8 L19 8 L18.2 5.8 L16 5 L18.2 4.2 Z" fill="#f6e0a0"/></svg>`;
}

// ---------------------------------------------------------------------------------------------
// Портрети (процедурни SVG лица по външния вид от VILLAGERS).

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

let uid = 0;

/** SVG портрет (кръгъл медальон) на жител или на героя ('hero' = Стоян). Непознато id → обща фигура. */
export function portrait(id: VillagerId | 'hero' | string, size: number | string = '3em'): string {
  const s = typeof size === 'number' ? `${size}px` : size;
  if (id === 'player') id = 'hero';
  const cid = `pc${++uid}`;
  const parts: string[] = [];
  const bgFor: Record<string, string> = { gena: '#3a4a3a', peyu: '#4a3a2a', petko: '#3a3a2a', ivan: '#4a2e26', maria: '#4a2a36', radka: '#46302a', kalin: '#3a3426', hero: '#2a2e3a' };
  const bg = bgFor[id] ?? '#3a3028';
  parts.push(`<circle cx="32" cy="32" r="31" fill="${bg}"/>`);
  parts.push(`<circle cx="32" cy="32" r="31" fill="url(#${cid}g)"/>`);
  const photo = portraitImage(id);

  if (photo) {
    // истинският портрет (3D), леко по-голям от кръга — раменете излизат до ръба
    parts.push(`<image href="${photo}" x="-2" y="-1" width="68" height="68" preserveAspectRatio="xMidYMid slice"/>`);
    parts.push(`<circle cx="32" cy="32" r="31" fill="url(#${cid}v)"/>`);
  } else if (id === 'hero') {
    const cloak = '#6b4a2f', skin = '#d8ac84';
    parts.push(`<path d="M6 64 C8 46 18 40 32 40 C46 40 56 46 58 64 Z" fill="${cloak}"/>`);
    parts.push(`<path d="M24 44 L32 56 L40 44" fill="${shade(cloak, 0.7)}"/><circle cx="32" cy="47" r="2" fill="#e8c27a"/>`);
    // качулка
    parts.push(`<path d="M14 40 C12 20 20 9 32 9 C44 9 52 20 50 40 C46 45 40 46 32 46 C24 46 18 45 14 40 Z" fill="${cloak}"/>`);
    parts.push(`<path d="M20 38 C19 25 24 17 32 17 C40 17 45 25 44 38 C41 42 37 44 32 44 C27 44 23 42 20 38 Z" fill="${shade(cloak, 0.45)}"/>`);
    // лице в сянка
    parts.push(`<ellipse cx="32" cy="32" rx="9.5" ry="11" fill="${skin}"/>`);
    parts.push(`<path d="M22.5 27 C25 21 39 21 41.5 27 C38 24 26 24 22.5 27 Z" fill="${shade(cloak, 0.35)}" opacity="0.85"/>`);
    parts.push(`<path d="M26.5 30 h4 M33.5 30 h4" stroke="#2a1a10" stroke-width="1.6" stroke-linecap="round"/>`);
    parts.push(`<path d="M24 36 C26 43 38 43 40 36 C38 38 35 39 32 39 C29 39 26 38 24 36 Z" fill="#4a3220" opacity="0.6"/>`);
    parts.push(`<path d="M29 39.5 h6" stroke="#6a3a2a" stroke-width="1.2" stroke-linecap="round"/>`);
    parts.push(`<path d="M44 12 L52 4" stroke="#c9ccd2" stroke-width="2.2" stroke-linecap="round"/><path d="M42 15 l4 -2" stroke="#e8c27a" stroke-width="2.4" stroke-linecap="round"/>`);
  } else {
    const p = (VILLAGERS as Record<string, (typeof VILLAGERS)[VillagerId]>)[id];
    const look = p?.look ?? { gender: 'm', age: 'adult', skin: '#d8ac84', hair: '#4a3020', shirt: '#efe9dc', belt: '#b3262b', vest: '#3a2a20', hat: 'none', beard: 'none' } as const;
    const skin = look.skin, hair = look.hair;
    const old = look.age === 'old';
    // тяло: риза + елек
    parts.push(`<path d="M8 64 C10 49 19 44 32 44 C45 44 54 49 56 64 Z" fill="${look.shirt}"/>`);
    parts.push(`<path d="M8 64 C10 50 17 46 24 45 L28 64 Z M56 64 C54 50 47 46 40 45 L36 64 Z" fill="${look.vest}"/>`);
    parts.push(`<path d="M27 48 l2 2 -2 2 2 2 -2 2 M37 48 l-2 2 2 2 -2 2 2 2" stroke="#b3262b" stroke-width="1.2" fill="none"/>`);
    // шия
    parts.push(`<rect x="28" y="38" width="8" height="8" fill="${shade(skin, 0.88)}"/>`);
    // коса отзад (жени без забрадка/дълга коса)
    if (look.gender === 'f' && !('scarf' in look && look.scarf)) parts.push(`<path d="M18 30 C18 16 46 16 46 30 V46 H18 Z" fill="${hair}"/>`);
    // лице
    parts.push(`<ellipse cx="32" cy="29" rx="11" ry="13" fill="${skin}"/>`);
    parts.push(`<ellipse cx="21.5" cy="30" rx="2" ry="3" fill="${shade(skin, 0.9)}"/><ellipse cx="42.5" cy="30" rx="2" ry="3" fill="${shade(skin, 0.9)}"/>`);
    // очи, вежди, уста
    const browC = old ? shade(hair, 0.8) : shade(hair, 0.9);
    parts.push(`<circle cx="27.5" cy="28" r="1.5" fill="#24160c"/><circle cx="36.5" cy="28" r="1.5" fill="#24160c"/>`);
    parts.push(`<path d="M24.5 24.5 q3 -1.6 5.5 0 M34 24.5 q2.5 -1.6 5.5 0" stroke="${browC}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
    parts.push(`<path d="M32 29 l-1.2 4.5 h2.4" fill="none" stroke="${shade(skin, 0.75)}" stroke-width="1.1" stroke-linejoin="round"/>`);
    parts.push(`<ellipse cx="25.5" cy="33" rx="2.2" ry="1.3" fill="#e2795a" opacity="0.28"/><ellipse cx="38.5" cy="33" rx="2.2" ry="1.3" fill="#e2795a" opacity="0.28"/>`);
    if (old) parts.push(`<path d="M23 31.5 q1.5 1 3 0 M38 31.5 q1.5 1 3 0" stroke="${shade(skin, 0.75)}" stroke-width="0.8" fill="none"/>`);
    const beard = 'beard' in look ? look.beard : 'none';
    if (beard === 'full') {
      parts.push(`<path d="M21 30 C21 40 25 45 32 45 C39 45 43 40 43 30 C41 35 38 37 32 37 C26 37 23 35 21 30 Z" fill="${hair}"/>`);
      parts.push(`<path d="M27 36.5 q5 -2.5 10 0" stroke="${shade(hair, 0.7)}" stroke-width="1.4" fill="none"/><path d="M29.5 39 h5" stroke="#7a3a2a" stroke-width="1.1" stroke-linecap="round"/>`);
    } else if (beard === 'mustache') {
      parts.push(`<path d="M32 35 C29 34 25 35 24 38 C27 37 29 37 32 36.4 C35 37 37 37 40 38 C39 35 35 34 32 35 Z" fill="${hair}"/>`);
      parts.push(`<path d="M29.5 39 q2.5 1 5 0" stroke="#7a3a2a" stroke-width="1.1" fill="none" stroke-linecap="round"/>`);
    } else {
      parts.push(`<path d="M28.5 37 q3.5 2 7 0" stroke="#8a3a2a" stroke-width="1.3" fill="none" stroke-linecap="round"/>`);
    }
    // глава: забрадка / калпак / коса
    if ('scarf' in look && look.scarf) {
      const sc = look.scarf;
      parts.push(`<path d="M18.5 32 C17 15 24 10 32 10 C40 10 47 15 45.5 32 C44 26 42 21 32 21 C22 21 20 26 18.5 32 Z" fill="${sc}"/>`);
      parts.push(`<path d="M24 19.5 C28 17.5 36 17.5 40 19.5" stroke="${shade(sc, 1.5)}" stroke-width="1.2" fill="none" stroke-dasharray="2 1.6"/>`);
      parts.push(`<path d="M24 21.5 C27 20 37 20 40 21.5 C37 21 27 21 24 21.5 Z" fill="${hair}"/>`);
      parts.push(`<path d="M44 33 L49 44 L42 41 Z" fill="${shade(sc, 0.8)}"/><path d="M20 33 L15 44 L22 41 Z" fill="${shade(sc, 0.8)}"/>`);
    } else if ('hat' in look && look.hat === 'kalpak') {
      parts.push(`<path d="M21 22 C19 18 20 10 25 7 C29 5 37 5 41 8 C45 11 45 18 43 22 Z" fill="#2a1d18"/>`);
      parts.push(`<path d="M20 20 h24 a1.5 1.5 0 0 1 1.5 1.5 v2 h-27 v-2 a1.5 1.5 0 0 1 1.5 -1.5 Z" fill="#1c1310"/>`);
      parts.push(`<path d="M26 12 l1.5 1 M32 10 v1.6 M37.5 12 l-1.5 1 M29 16 l1.3 0.8 M35 16 l-1.3 0.8" stroke="#4a3a32" stroke-width="1" stroke-linecap="round"/>`);
      parts.push(`<path d="M21 23.5 C21 26 21.5 27 22 28 M43 23.5 C43 26 42.5 27 42 28" stroke="${hair}" stroke-width="2.2" stroke-linecap="round"/>`);
    } else {
      parts.push(`<path d="M20.5 27 C19 15 26 12 32 12 C39 12 45 15 43.5 27 C42 21 39 19 35 19 C33 21 28 22 24 21 C22 22 21 24 20.5 27 Z" fill="${hair}"/>`);
    }
  }
  // рамка-медальон: шевица по ръба
  parts.push(`<circle cx="32" cy="32" r="30.5" fill="none" stroke="#e8c27a" stroke-width="1.6"/>`);
  parts.push(`<circle cx="32" cy="32" r="28.4" fill="none" stroke="#b3262b" stroke-width="1.4" stroke-dasharray="2.2 2.2" opacity="0.9"/>`);
  return `<svg class="portrait" viewBox="0 0 64 64" width="${s}" height="${s}" aria-hidden="true"><defs><radialGradient id="${cid}g" cx="50%" cy="35%" r="65%"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient><radialGradient id="${cid}v" cx="50%" cy="45%" r="55%"><stop offset="0.72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient><clipPath id="${cid}c"><circle cx="32" cy="32" r="30.6"/></clipPath></defs><g clip-path="url(#${cid}c)">${parts.slice(0, -2).join('')}</g>${parts.slice(-2).join('')}</svg>`;
}

/** Име за показване по id ('player' → „Странникът“). */
export function personName(id: string): string {
  if (id === 'player' || id === 'hero') return 'Странникът';
  const p = (VILLAGERS as Record<string, { name: string }>)[id];
  return p ? p.name : id;
}
