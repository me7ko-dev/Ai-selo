// Иконите на играта: шевица-розета (осмолъчна звезда) в червено и злато на тъмен фон.
// Рисува SVG с Chromium (playwright-core) → PNG 16…512, desktop/icon.png, desktop/icon.ico (много размери), public/icon-192/512.png.
// Пускане: node tools/make-icons.mjs   (CHROME_PATH=… за друг Chromium)
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';

const RED = '#b3262b', RED_DARK = '#7e1c20', GOLD = '#e8c27a', GOLD_DARK = '#b8924f', BG = '#14100c', BG2 = '#2a1f16';

/** Осмолъчна звезда (два квадрата един върху друг), център (256,256), „радиус“ r. */
function star8(r, fill, extra = '') {
  const s = r / Math.SQRT2;
  const sq = `M${256 - s} ${256 - s}h${2 * s}v${2 * s}h${-2 * s}z`;
  return `<path d="${sq}" fill="${fill}" ${extra}/><path d="${sq}" fill="${fill}" transform="rotate(45 256 256)" ${extra}/>`;
}

/** Ромб с център (cx,cy). */
const diamond = (cx, cy, r, fill) => `<path d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}z" fill="${fill}"/>`;

function svg(detail) {
  const parts = [];
  parts.push(`<defs><radialGradient id="bg" cx="50%" cy="45%" r="65%"><stop offset="0" stop-color="${BG2}"/><stop offset="1" stop-color="${BG}"/></radialGradient></defs>`);
  parts.push(`<rect x="8" y="8" width="496" height="496" rx="${detail ? 104 : 88}" fill="url(#bg)"/>`);
  parts.push(`<rect x="${detail ? 26 : 22}" y="${detail ? 26 : 22}" width="${detail ? 460 : 468}" height="${detail ? 460 : 468}" rx="${detail ? 88 : 76}" fill="none" stroke="${GOLD}" stroke-width="${detail ? 8 : 20}" opacity="0.85"/>`);
  if (detail) {
    // шевици по ъглите: стъпаловидни ромбчета
    for (const [cx, cy] of [[96, 96], [416, 96], [96, 416], [416, 416]]) {
      parts.push(diamond(cx, cy, 30, RED));
      parts.push(diamond(cx, cy, 16, GOLD));
      parts.push(diamond(cx, cy, 6, BG));
    }
    // ромбчета между ъглите (по средата на страните)
    for (const [cx, cy] of [[256, 58], [256, 454], [58, 256], [454, 256]]) parts.push(diamond(cx, cy, 12, GOLD_DARK));
    // голямата червена звезда със златен кант
    parts.push(star8(182, GOLD));
    parts.push(star8(170, RED));
    // вътрешна тъмна звезда и златна звезда
    parts.push(star8(128, RED_DARK));
    parts.push(star8(112, GOLD));
    // кръстосани „бодове“ — малки ромбове върху лъчите на голямата звезда
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x = 256 + Math.sin(a) * 140, y = 256 - Math.cos(a) * 140;
      parts.push(diamond(Math.round(x), Math.round(y), 9, GOLD));
    }
    parts.push(star8(70, RED));
    parts.push(diamond(256, 256, 34, GOLD));
    parts.push(diamond(256, 256, 16, BG));
  } else {
    // опростена за 16–48 px: само ясни форми
    parts.push(star8(196, GOLD));
    parts.push(star8(176, RED));
    parts.push(star8(100, GOLD));
    parts.push(diamond(256, 256, 52, RED));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${parts.join('')}</svg>`;
}

/** ICO с PNG записи (Windows Vista+). Заглавката се пише на ръка. */
function makeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);       // reserved
  header.writeUInt16LE(1, 2);       // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);      // ширина (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);  // височина
    dir.writeUInt8(0, o + 2);                       // палитра
    dir.writeUInt8(0, o + 3);                       // reserved
    dir.writeUInt16LE(1, o + 4);                    // color planes
    dir.writeUInt16LE(32, o + 6);                   // bits per pixel
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const sizes = [16, 32, 48, 64, 128, 192, 256, 512];
const out = {};
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  const doc = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg(size > 48)}</body></html>`;
  await page.setContent(doc);
  out[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
fs.mkdirSync(path.join(root, 'desktop'), { recursive: true });
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'desktop/icon.png'), out[512]);
fs.writeFileSync(path.join(root, 'desktop/icon.ico'), makeIco([16, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: out[s] }))));
fs.writeFileSync(path.join(root, 'public/icon-512.png'), out[512]);
fs.writeFileSync(path.join(root, 'public/icon-192.png'), out[192]);
if (process.env.ICON_SVG) fs.writeFileSync(process.env.ICON_SVG, svg(true));
console.log('OK: desktop/icon.png, desktop/icon.ico, public/icon-192.png, public/icon-512.png');
