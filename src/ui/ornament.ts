// Шевици: геометрични мотиви като кръстат бод (червено / черно / злато), нарисувани като SVG от „пикселна“ схема.
// Чиста логика — без DOM (тества се в Node).

const COLORS: Record<string, string> = { R: '#b3262b', K: '#1a1210', G: '#e8c27a', W: '#efe6d4', D: '#7e1c20' };

/** Пикселна схема → SVG <rect>-ове. */
export function stitch(rows: string[], ox = 0, oy = 0, cell = 1): string {
  let out = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = COLORS[row[x]];
      if (c) out += `<rect x="${ox + x * cell}" y="${oy + y * cell}" width="${cell}" height="${cell}" fill="${c}"/>`;
    }
  });
  return out;
}

/** Лента-бордюр (повтаря се хоризонтално): ромб + златен кръст. 14×11. */
export const STRIP_TILE = [
  'GGGGGGGGGGGGGG',
  '..............',
  '......R.......',
  '.....RKR......',
  '....RKGKR....G',
  'G..RKGGGKR..GG',
  '....RKGKR....G',
  '.....RKR......',
  '......R.......',
  '..............',
  'GGGGGGGGGGGGGG',
];

/** Розетка (осмолъчка) 9×9 — за ъгли и разделители. */
export const ROSETTE = [
  '....R....',
  '...RKR...',
  'R.RKGKR.R',
  '.RKGGGKR.',
  'RKGGRGGKR',
  '.RKGGGKR.',
  'R.RKGKR.R',
  '...RKR...',
  '....R....',
];

/** Ъгъл (горе вляво), 11×11 — „стъпала“ от кръстат бод. */
export const CORNER = [
  'GGGGGGGGGGG',
  'G..........',
  'G.RRR.R....',
  'G.RKR.KR...',
  'G.RRR..R...',
  'G......G...',
  'G.RK.......',
  'G..R.......',
  'G.....G....',
  'G..........',
  'G..........',
];

function svg(w: number, h: number, body: string, extra = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges"${extra}>${body}</svg>`;
}

/** data: URI за CSS background. */
export function dataUri(svgText: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svgText)}")`;
}

export function stripSvg(): string { return svg(14, 11, stitch(STRIP_TILE)); }
export function rosetteSvg(): string { return svg(9, 9, stitch(ROSETTE)); }
export function cornerSvg(): string { return svg(11, 11, stitch(CORNER)); }

/** Вграден разделител: линия — розетка — линия. */
export function dividerHtml(cls = ''): string {
  return `<div class="orn-divider ${cls}"><i></i>${svg(9, 9, stitch(ROSETTE), ' class="orn-rosette"')}<i></i></div>`;
}

/** Вградена розетка (inline). */
export function rosetteHtml(size = '1em'): string {
  return svg(9, 9, stitch(ROSETTE), ` class="orn-rosette" style="width:${size};height:${size}"`);
}

/** CSS променливи с шевиците — слагат се на корена на интерфейса. */
export function ornamentVars(): Record<string, string> {
  return {
    '--orn-strip': dataUri(stripSvg()),
    '--orn-rosette': dataUri(rosetteSvg()),
    '--orn-corner': dataUri(cornerSvg()),
  };
}
