// Сваля текстурите на листата/иглиците от ez-tree (MIT, Daniel Greenheck — https://github.com/dgreenheck/ez-tree)
// и ги подготвя за играта: прозрачните пиксели получават цвета на най-близкия лист („разливане“ на цвета),
// за да няма бели ръбове при mip-map и alpha-test. Пише RGBA PNG в public/assets/trees/.
//
//   node tools/prep-leaves.mjs
//
// Без външни пакети: малък PNG четец/писач (zlib от Node).
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets/trees');
const SRC = 'https://cdn.jsdelivr.net/npm/@dgreenheck/ez-tree@1.1.0/src/lib/assets/leaves/';
// изходно име → файл в ez-tree
const LIST = { spruce_twig: 'pine_color.png', oak_leaves: 'oak_color.png', ash_leaves: 'ash_color.png' };

// ---------------------------------------------------------------- PNG четене
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('не е PNG');
  let o = 8, w = 0, h = 0, depth = 0, ctype = 0, plte = null, trns = null;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; if (d[12]) throw new Error('interlace не се поддържа'); }
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  if (depth !== 8) throw new Error('само 8 бита на канал');
  const bpp = ctype === 3 ? 1 : ctype === 2 ? 3 : ctype === 6 ? 4 : ctype === 0 ? 1 : ctype === 4 ? 2 : 0;
  if (!bpp) throw new Error('непознат вид PNG ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = up ? up[x] : 0, c = up && x >= bpp ? up[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ctype === 3) { const k = px[i]; rgba[i * 4] = plte[k * 3]; rgba[i * 4 + 1] = plte[k * 3 + 1]; rgba[i * 4 + 2] = plte[k * 3 + 2]; rgba[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255; }
    else if (ctype === 6) { rgba.set(px.subarray(i * 4, i * 4 + 4), i * 4); }
    else if (ctype === 2) { rgba.set(px.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255; }
    else if (ctype === 0) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[i]; rgba[i * 4 + 3] = 255; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[i * 2]; rgba[i * 4 + 3] = px[i * 2 + 1]; }
  }
  return { w, h, rgba };
}

// ---------------------------------------------------------------- PNG писане (RGBA, филтър по ред)
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const stride = w * 4, out = Buffer.alloc(h * (stride + 1)), tmp = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride), up = y ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestSum = Infinity, bestRow = null;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? row[x - 4] : 0, b = up ? up[x] : 0, c = up && x >= 4 ? up[x - 4] : 0;
        let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (row[x] - p) & 255; tmp[x] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; bestRow = Uint8Array.from(tmp); }
    }
    out[y * (stride + 1)] = best; out.set(bestRow, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- разливане на цвета в прозрачното
function dilate(w, h, rgba) {
  const filled = new Uint8Array(w * h);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] >= 128) { filled[i] = 1; sr += rgba[i * 4]; sg += rgba[i * 4 + 1]; sb += rgba[i * 4 + 2]; n++; }
  // полупрозрачните ръбове често са смесени с бял фон — взимаме им цвета от плътните съседи
  let front = [];
  for (let i = 0; i < w * h; i++) if (!filled[i]) front.push(i);
  for (let pass = 0; pass < 64 && front.length; pass++) {
    const next = [], done = [];
    for (const i of front) {
      const x = i % w, y = (i / w) | 0;
      let r = 0, g = 0, b = 0, k = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (filled[j] === 1) { r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; k++; }
      }
      if (k) { rgba[i * 4] = r / k; rgba[i * 4 + 1] = g / k; rgba[i * 4 + 2] = b / k; done.push(i); } else next.push(i);
    }
    for (const i of done) filled[i] = 1;
    front = next;
  }
  for (const i of front) { rgba[i * 4] = sr / n; rgba[i * 4 + 1] = sg / n; rgba[i * 4 + 2] = sb / n; }
}

function credit() {
  const f = path.join(ROOT, 'public/assets/CREDITS.md');
  const line = '- Текстури на иглички и листа (смърч, дъб, ясен) — ez-tree от Daniel Greenheck, лиценз MIT — https://github.com/dgreenheck/ez-tree\n';
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# Ресурси в public/assets (всички са със свободен лиценз)\n\n';
  if (!cur.includes('ez-tree')) fs.writeFileSync(f, cur + line);
}

// ---------------------------------------------------------------- сглобяване на гъсти клонки от едно клонче
// Едно клонче в текстурата покрива ~23 % от картата — за гъста корона трябват много карти. Затова тук от няколко
// завъртени копия се сглобява цял клон (смърч) или китка листа (дъб, ясен): същата карта покрива 2–3 пъти повече.
function bilinear(img, x, y) {
  const { w, h, rgba } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const out = [0, 0, 0, 0];
  const acc = (xx, yy, k) => { const i = (yy * w + xx) * 4, a = rgba[i + 3] / 255 * k; out[0] += rgba[i] * a; out[1] += rgba[i + 1] * a; out[2] += rgba[i + 2] * a; out[3] += a; };
  acc(x0, y0, (1 - fx) * (1 - fy)); acc(x1, y0, fx * (1 - fy)); acc(x0, y1, (1 - fx) * fy); acc(x1, y1, fx * fy);
  if (out[3] > 1e-6) { out[0] /= out[3]; out[1] /= out[3]; out[2] /= out[3]; }
  return out; // rgb (0..255, непредумножено), a (0..1)
}
/**
 * Рисува копия на src върху нов образ W×H. Всяко копие: основата на клончето (bx, by в src, пиксели) отива в (x, y),
 * завъртяно на ang (рад, 0 = нагоре, + = надясно), мащаб s, по желание огледално, по-тъмно с dark (0..1).
 */
function compose(src, W, H, base, list) {
  const rgba = new Uint8Array(W * H * 4);
  const acc = new Float32Array(W * H * 4); // предумножено
  for (const p of list) {
    const c = Math.cos(p.ang), s = Math.sin(p.ang), k = 1 / p.s;
    // граници на копието
    const corners = [[0, 0], [src.w, 0], [0, src.h], [src.w, src.h]].map(([u, v]) => {
      let dx = (u - base[0]) * (p.flip ? -1 : 1), dy = v - base[1];
      return [p.x + (dx * c - dy * s) * p.s, p.y + (dx * s + dy * c) * p.s];
    });
    const xs = corners.map((q) => q[0]), ys = corners.map((q) => q[1]);
    const X0 = Math.max(0, Math.floor(Math.min(...xs))), X1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const Y0 = Math.max(0, Math.floor(Math.min(...ys))), Y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    const dark = 1 - (p.dark ?? 0);
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const ox = (x - p.x) * k, oy = (y - p.y) * k;
      // обратно завъртане
      let u = ox * c + oy * s, v = -ox * s + oy * c;
      if (p.flip) u = -u;
      const smp = bilinear(src, u + base[0], v + base[1]);
      const a = smp[3];
      if (a <= 0) continue;
      const i = (y * W + x) * 4, inv = 1 - a;
      acc[i] = smp[0] * dark * a + acc[i] * inv; acc[i + 1] = smp[1] * dark * a + acc[i + 1] * inv; acc[i + 2] = smp[2] * dark * a + acc[i + 2] * inv;
      acc[i + 3] = a + acc[i + 3] * inv;
    }
  }
  let cov = 0;
  for (let i = 0; i < W * H; i++) {
    const a = acc[i * 4 + 3];
    if (a > 0) { rgba[i * 4] = acc[i * 4] / a; rgba[i * 4 + 1] = acc[i * 4 + 1] / a; rgba[i * 4 + 2] = acc[i * 4 + 2] / a; }
    rgba[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
    if (a >= 0.5) cov++;
  }
  return { w: W, h: H, rgba, cov: cov / (W * H) };
}
const deg = (d) => (d * Math.PI) / 180;

// клонка смърч: основата долу в средата, расте нагоре; копията са подредени „рибена кост“ — по-тъмни отдолу
function spruceSpray(tw) {
  const W = 1024, H = 1024, b = [0.452 * tw.w, tw.h - 2];
  const L = [
    { x: 512, y: 1016, ang: deg(-58), s: 0.5, dark: 0.25 }, { x: 512, y: 1000, ang: deg(60), s: 0.48, flip: true, dark: 0.25 },
    { x: 512, y: 900, ang: deg(-40), s: 0.62, dark: 0.15 }, { x: 512, y: 880, ang: deg(42), s: 0.6, flip: true, dark: 0.15 },
    { x: 512, y: 700, ang: deg(-30), s: 0.55, dark: 0.08 }, { x: 512, y: 690, ang: deg(33), s: 0.52, flip: true, dark: 0.08 },
    { x: 512, y: 1016, ang: deg(-6), s: 0.97 },
    { x: 512, y: 520, ang: deg(-20), s: 0.42 }, { x: 512, y: 500, ang: deg(22), s: 0.4, flip: true },
    { x: 512, y: 330, ang: deg(4), s: 0.32, flip: true },
  ];
  return compose(tw, W, H, b, L);
}
// китка листа: ветрило от клончета около общата основа
function leafCluster(tw, bu) {
  const W = 1024, H = 1024, b = [bu * tw.w, tw.h - 2];
  const L = [
    { x: 512, y: 1016, ang: deg(-42), s: 0.72, dark: 0.18 }, { x: 512, y: 1016, ang: deg(44), s: 0.7, flip: true, dark: 0.18 },
    { x: 512, y: 1016, ang: deg(-20), s: 0.88, dark: 0.08 }, { x: 512, y: 1016, ang: deg(22), s: 0.86, flip: true, dark: 0.08 },
    { x: 512, y: 1016, ang: deg(2), s: 0.98 },
  ];
  return compose(tw, W, H, b, L);
}

fs.mkdirSync(OUT, { recursive: true });
const write = (name, img) => {
  dilate(img.w, img.h, img.rgba);
  const out = encodePng(img.w, img.h, img.rgba);
  const dst = path.join(OUT, name + '.png');
  fs.writeFileSync(dst, out);
  console.log(`✔ ${path.relative(ROOT, dst)} (${(out.length / 1e6).toFixed(2)} MB)${img.cov ? `, покритие ${(img.cov * 100).toFixed(0)} %` : ''}`);
};
for (const [name, file] of Object.entries(LIST)) {
  const r = await fetch(SRC + file);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${SRC + file}`);
  const png = decodePng(Buffer.from(await r.arrayBuffer()));
  if (name === 'spruce_twig') write('spruce_spray', spruceSpray(png));
  else if (name === 'oak_leaves') write('oak_cluster', leafCluster(png, 0.48));
  else if (name === 'ash_leaves') write('ash_cluster', leafCluster(png, 0.467));
}
credit();
