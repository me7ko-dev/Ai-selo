// Рисунките за въведението („Нова игра“): три сцени като меки low-poly картинки (SVG), в палитрата на играта.
// Чиста логика — само низове, без DOM. Тук са и текстовете на страниците (INTRO_PAGES).

const W = 600, H = 300;

/** align — коя част остава, когато рамката е по-широка от рисунката (YMin = горе, YMax = долу). */
function svg(id: string, body: string, defs = '', align = 'xMidYMid'): string {
  return `<svg class="intro-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="${align} slice" role="img" aria-hidden="true"><defs>${defs}</defs><g id="${id}">${body}</g></svg>`;
}

function grad(id: string, stops: [number, string][], vertical = true): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
}

/** Възрожденска къща: бели стени, тъмен чардак, червени керемиди. x,y = долу в средата. */
function house(x: number, y: number, s: number, lit = true): string {
  const w = 60 * s, wh = 26 * s, up = 18 * s, rh = 20 * s;
  const l = x - w / 2;
  return `<g>
    <rect x="${l}" y="${y - wh}" width="${w}" height="${wh}" fill="#efe6d4"/>
    <rect x="${l - 4 * s}" y="${y - wh - up}" width="${w + 8 * s}" height="${up}" fill="#e6dcc6"/>
    <rect x="${l - 4 * s}" y="${y - wh - 3 * s}" width="${w + 8 * s}" height="${4 * s}" fill="#5a3b26"/>
    <rect x="${l - 4 * s}" y="${y - wh - up}" width="${w + 8 * s}" height="${3 * s}" fill="#5a3b26"/>
    ${[0.18, 0.5, 0.82].map((k) => `<rect x="${l - 4 * s + (w + 8 * s) * k - 1.5 * s}" y="${y - wh - up}" width="${3 * s}" height="${up}" fill="#5a3b26"/>`).join('')}
    <polygon points="${l - 12 * s},${y - wh - up} ${x},${y - wh - up - rh} ${l + w + 12 * s},${y - wh - up}" fill="#a4472f"/>
    <polygon points="${x},${y - wh - up - rh} ${l + w + 12 * s},${y - wh - up} ${x + 6 * s},${y - wh - up}" fill="#7e3424"/>
    <rect x="${l + 8 * s}" y="${y - wh + 7 * s}" width="${9 * s}" height="${10 * s}" fill="${lit ? '#f6c27a' : '#3a2a1e'}"/>
    <rect x="${l + w - 17 * s}" y="${y - wh + 7 * s}" width="${9 * s}" height="${10 * s}" fill="${lit ? '#f2b764' : '#3a2a1e'}"/>
    <rect x="${x - 5 * s}" y="${y - 15 * s}" width="${10 * s}" height="${15 * s}" fill="#5a3b26"/>
  </g>`;
}

function pine(x: number, y: number, s: number, c = '#2f4a35'): string {
  return `<polygon points="${x},${y - 46 * s} ${x + 13 * s},${y - 14 * s} ${x - 13 * s},${y - 14 * s}" fill="${c}"/><polygon points="${x},${y - 32 * s} ${x + 17 * s},${y} ${x - 17 * s},${y}" fill="${c}"/>`;
}

/** 1. Ламята на Ламин връх, а под нея — пресъхналото корито на Бистрица. */
export function artLamia(): string {
  const defs = grad('ia-sky', [[0, '#3e3560'], [0.5, '#a65a5e'], [0.8, '#e2795a'], [1, '#f6c27a']]) +
    grad('ia-peak', [[0, '#5e4664'], [1, '#2e2236']]) +
    '<radialGradient id="ia-sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffe6b0"/><stop offset="0.6" stop-color="#f6c27a" stop-opacity="0.7"/><stop offset="1" stop-color="#f6c27a" stop-opacity="0"/></radialGradient>';
  const neck = (d: string) => `<path d="${d}" stroke="#1a1020" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  const head = (x: number, y: number, dir: number) => `<g transform="translate(${x} ${y}) scale(${dir} 1)">
      <ellipse cx="0" cy="0" rx="9" ry="6" fill="#1a1020"/><polygon points="5,-4 19,0 5,4" fill="#1a1020"/>
      <polygon points="-4,-5 -10,-13 -1,-6" fill="#1a1020"/><circle cx="3" cy="-1.5" r="1.6" fill="#ff6a3a"/></g>`;
  const body = `
    <rect width="${W}" height="${H}" fill="url(#ia-sky)"/>
    <circle cx="470" cy="168" r="70" fill="url(#ia-sun)"/>
    <circle cx="470" cy="168" r="26" fill="#ffe2a8" opacity="0.9"/>
    <path d="M0 205 L60 170 L120 195 L190 150 L250 185 L330 160 L410 190 L480 158 L545 182 L600 168 V300 H0Z" fill="#7a5a78" opacity="0.7"/>
    <path d="M0 245 L110 205 L200 128 L300 52 L392 124 L470 190 L600 228 V300 H0Z" fill="url(#ia-peak)"/>
    <path d="M300 52 L392 124 L350 116 L322 84Z" fill="#6c5272" opacity="0.8"/>
    <path d="M300 52 L200 128 L236 118 L276 82Z" fill="#241a2c" opacity="0.6"/>
    <path d="M304 96 C318 130 270 150 292 182 C312 212 250 236 268 300" stroke="#6a5038" stroke-width="20" fill="none" stroke-linecap="round"/>
    <path d="M304 96 C318 130 270 150 292 182 C312 212 250 236 268 300" stroke="#c9b48a" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M304 96 C318 130 270 150 292 182 C312 212 250 236 268 300" stroke="#8a6c4c" stroke-width="2" stroke-dasharray="3 9 1 6" fill="none"/>
    <path d="M0 300 L0 262 L90 246 L190 262 L260 250 L340 266 L430 248 L520 258 L600 244 V300Z" fill="#3a2a30"/>
    <path d="M262 74 C268 56 334 54 342 72 C352 80 372 82 384 98 C366 92 350 90 336 84 C318 90 280 90 262 74Z" fill="#1a1020"/>
    ${neck('M280 66 C268 46 256 36 244 36')}
    ${neck('M300 62 C300 40 304 26 312 18')}
    ${neck('M320 66 C334 48 346 40 360 40')}
    ${head(242, 36, -1)}${head(314, 17, 1)}${head(362, 40, 1)}`;
  return svg('intro-lamia', body, defs, 'xMidYMin');
}

/** 2. Самодивско по здрач: жълти ниви, сухата чешма, очи в Тъмната гора. */
export function artVillage(): string {
  const defs = grad('iv-sky', [[0, '#16224a'], [0.45, '#3a3f6e'], [0.75, '#7a5878'], [1, '#e2795a']]) +
    grad('iv-field', [[0, '#9a8e4e'], [1, '#6e6a36']]);
  const eyes = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#f6d06a"/><circle cx="${x + 8}" cy="${y}" r="2.2" fill="#f6d06a"/>`;
  const stars = [[60, 30], [140, 52], [220, 22], [380, 40], [450, 18], [520, 58], [570, 26], [300, 60]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="#f4ecd0" opacity="0.8"/>`).join('');
  const body = `
    <rect width="${W}" height="${H}" fill="url(#iv-sky)"/>
    ${stars}
    <circle cx="500" cy="62" r="17" fill="#f4ecd0"/><circle cx="508" cy="56" r="15" fill="#2a3060"/>
    <path d="M0 196 C100 170 200 186 300 172 C410 158 500 182 600 170 V300 H0Z" fill="#3e4a52"/>
    <path d="M0 220 C120 204 240 214 360 204 C460 196 540 210 600 204 V300 H0Z" fill="url(#iv-field)"/>
    ${pine(18, 236, 1.3, '#1e3226')}${pine(52, 226, 1.1, '#24392b')}${pine(84, 238, 1.4, '#1e3226')}${pine(118, 232, 1.0, '#24392b')}${pine(-6, 250, 1.6, '#182a20')}
    ${eyes(46, 214)}${eyes(96, 222)}
    ${house(250, 236, 0.9)}${house(360, 228, 0.75, false)}${house(462, 240, 1.0)}
    <circle cx="560" cy="200" r="30" fill="#2f4a35"/><circle cx="540" cy="212" r="22" fill="#35553c"/><rect x="556" y="214" width="7" height="30" fill="#4a3220"/>
    <path d="M0 300 L0 262 C120 250 220 268 330 258 C440 248 520 266 600 256 V300Z" fill="#4a4426"/>
    <g transform="translate(330 270)">
      <rect x="-18" y="-26" width="36" height="26" fill="#9a9184"/><rect x="-22" y="-30" width="44" height="6" fill="#7a7266"/>
      <rect x="-3" y="-18" width="6" height="4" fill="#5a5248"/><path d="M0 -14 v4" stroke="#8fb8f0" stroke-width="1.5"/>
      <ellipse cx="0" cy="2" rx="24" ry="5" fill="#6a6256"/>
    </g>`;
  return svg('intro-village', body, defs);
}

/** 3. Стоян, странникът — гледан в гръб, на пътя към селото, призори. */
export function artHero(): string {
  const defs = grad('ih-sky', [[0, '#9cc7e8'], [0.55, '#e9f1f4'], [0.85, '#f6dcae'], [1, '#f6c27a']]) +
    grad('ih-cloak', [[0, '#7a5838'], [1, '#4e3420']]) +
    grad('ih-road', [[0, '#d8c49a'], [1, '#b89c6a']]);
  const body = `
    <rect width="${W}" height="${H}" fill="url(#ih-sky)"/>
    <circle cx="430" cy="150" r="22" fill="#fff0c8" opacity="0.9"/>
    <path d="M0 170 L80 128 L150 156 L240 110 L320 150 L400 124 L480 148 L560 118 L600 132 V300 H0Z" fill="#8aa0b4" opacity="0.8"/>
    <path d="M0 196 C120 172 220 186 330 172 C440 160 520 176 600 168 V300 H0Z" fill="#6f9a4a"/>
    <path d="M0 236 C140 214 260 230 380 214 C470 204 540 214 600 210 V300 H0Z" fill="#4f7a3a"/>
    ${house(372, 176, 0.32)}${house(402, 172, 0.26)}${house(346, 180, 0.28)}
    <path d="M380 180 C360 200 330 208 300 224 C262 244 236 266 220 300 L330 300 C330 270 350 240 372 214 C384 200 390 190 384 180Z" fill="url(#ih-road)"/>
    ${pine(540, 240, 1.2)}${pine(570, 250, 1.5)}${pine(40, 250, 1.3)}
    <g transform="translate(200 300)">
      <path d="M-34 0 L-26 -40 L26 -40 L34 0Z" fill="#2a1e16"/>
      <path d="M-40 -6 C-44 -50 -40 -90 -26 -112 L26 -112 C40 -90 44 -50 40 -6 C20 0 -20 0 -40 -6Z" fill="url(#ih-cloak)"/>
      <path d="M-30 -58 L30 -58 L30 -52 L-30 -52Z" fill="#b3262b"/>
      <path d="M-26 -112 C-30 -140 -10 -152 0 -152 C10 -152 30 -140 26 -112 C14 -106 -14 -106 -26 -112Z" fill="#6b4a2f"/>
      <path d="M-4 -150 C2 -146 4 -132 0 -114" stroke="#4e3420" stroke-width="2" fill="none"/>
      <path d="M-30 -30 L34 -128" stroke="#c9c2b4" stroke-width="5" stroke-linecap="round"/>
      <path d="M26 -116 L42 -140" stroke="#5a3b26" stroke-width="6" stroke-linecap="round"/>
      <path d="M20 -118 L34 -110" stroke="#e8c27a" stroke-width="4" stroke-linecap="round"/>
    </g>`;
  return svg('intro-hero', body, defs, 'xMidYMax');
}

export interface IntroPage { kicker: string; title: string; text: string; art: () => string }

export const INTRO_PAGES: IntroPage[] = [
  {
    kicker: 'Отдавна, в Балкана…',
    title: 'Ламята пресуши Бистрица',
    text: 'Високо на Ламин връх се събуди Ламята — змей с три глави. Тя легна върху извора на река Бистрица и я изпи до капка. Където течеше вода, сега има само напукани камъни.',
    art: artLamia,
  },
  {
    kicker: 'Под планината',
    title: 'Самодивско чака помощ',
    text: 'В селото Самодивско чешмата едва капе, а нивите жълтеят. Хората се карат и шушукат, а по здрач от Тъмната гора излизат таласъми. Никой не смее да тръгне срещу Ламята.',
    art: artVillage,
  },
  {
    kicker: 'А ти…',
    title: 'Ти си Стоян, странникът',
    text: 'С кафяво наметало и стара сабя на гърба. Пътят те доведе до Самодивско. Поговори с хората — баба Гена знае пътеките през гората. Може би заедно ще върнете Бистрица.',
    art: artHero,
  },
];
