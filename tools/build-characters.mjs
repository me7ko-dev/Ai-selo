// Сглобява хората на играта от CC0 моделите на Quaternius (https://quaternius.com):
//   Universal Base Characters (глави, очи, коса), Modular Character Outfits – Fantasy (селски и горски дрехи),
//   Universal Animation Library (анимациите, същият скелет).
//
//   node tools/build-characters.mjs [папка-с-източниците]
//
// Папката по подразбиране е $QUATERNIUS_DIR или ../quaternius (до папката на репото); в нея трябва да са
// разархивирани трите пакета (Universal_Base_Characters/, Modular_Character_Outfits_-_Fantasy/, Universal_Animation_Library/).
// Пише public/assets/chars/people.glb (тела, дрехи, коси, текстури) и public/assets/chars/anims.glb (анимациите).
// Пуска се само на компютъра на автора, когато се сменят хората; сглобяването на играта (CI) ползва готовите файлове.
//
// Какво прави:
//  - всяко тяло = скелет + 4 меша: „cloth“ (дрехите от пакета, пребоядисвани в играта по етикет на всеки връх),
//    „folk“ (носията, която я няма в пакета: пола, престилка с шевици, забрадка, елек, пояс, калпак — правят се тук),
//    „skin“ (глава + ръце) и „eyes“;
//  - косите, веждите, брадите и калпакът са твърди части в пространството на костта Head (закачат се за главата);
//  - текстурите се свиват до 1k (JPEG), анимациите — само нужните клипове, само завъртания + таза.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(process.argv[2] || process.env.QUATERNIUS_DIR || path.join(ROOT, '..', 'quaternius'));
const OUT = path.join(ROOT, 'public/assets/chars');
const COMPRESS = !process.argv.includes('--no-compress');

const P = {
  base: 'Universal_Base_Characters/Universal Base Characters[Standard]/Base Characters/Godot - UE',
  hair: 'Universal_Base_Characters/Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)',
  outfits: 'Modular_Character_Outfits_-_Fantasy/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits',
  tex: 'Modular_Character_Outfits_-_Fantasy/Modular Character Outfits - Fantasy[Standard]/Textures',
  anims: 'Universal_Animation_Library/Universal Animation Library[Standard]/Unreal-Godot',
};
if (!fs.existsSync(path.join(SRC, P.outfits))) {
  console.error('Няма източници в ' + SRC + '\nПодай папката: node tools/build-characters.mjs <папка> (или QUATERNIUS_DIR=…)');
  process.exit(2);
}
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// ───────────────────────────── етикети на дрехите (същите са в src/models/gltf/palette.ts) ─────────────────────────────
export const G = {
  KEEP: 0, SHIRT: 1, VEST: 2, SASH: 3, TROUSERS: 4, BOOTS: 5, CUFF: 6, SKIRT: 7, APRON: 8, SCARF: 9,
  HOOD: 10, KALPAK: 11, LEATHER: 12, TRIM: 13, BODICE: 14, LEGWRAP: 15, DRESS: 16, CLOAK: 17,
};

// ───────────────────────────── четене ─────────────────────────────
async function readGltf(rel) {
  const file = path.join(SRC, rel);
  const dir = path.dirname(file);
  if (file.endsWith('.glb')) return io.read(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const resources = {};
  for (const b of json.buffers || []) if (b.uri) resources[b.uri] = new Uint8Array(fs.readFileSync(path.join(dir, b.uri)));
  // някои файлове сочат „…_png.png“, а на диска е „….png“; липсващите картинки просто се пропускат
  json.images = json.images || [];
  for (const im of json.images) {
    if (!im.uri) continue;
    let p = path.join(dir, im.uri);
    if (!fs.existsSync(p)) p = path.join(dir, im.uri.replace(/_png\.png$/, '.png'));
    resources[im.uri] = fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : new Uint8Array(0);
  }
  return io.readJSON({ json, resources });
}

const M4 = (arr) => new THREE.Matrix4().fromArray(arr);

/** Скелетът на един файл: имена на костите в реда на skin-а, обратни матрици, световни матрици в покой. */
function skeletonOf(doc) {
  const node = doc.getRoot().listNodes().find((n) => n.getSkin());
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const ibmAcc = skin.getInverseBindMatrices();
  const ibm = joints.map((_, i) => M4(ibmAcc.getElement(i, [])));
  return { skin, joints, names: joints.map((j) => j.getName()), ibm, index: new Map(joints.map((j, i) => [j.getName(), i])) };
}

/** Примитив → масиви (костите са преномерирани към целевия скелет по име). */
function primData(node, prim, target) {
  const sk = node.getSkin();
  const srcNames = sk.listJoints().map((j) => j.getName());
  const srcIbm = (() => { const a = sk.getInverseBindMatrices(); return srcNames.map((_, i) => M4(a.getElement(i, []))); })();
  const pos = prim.getAttribute('POSITION'), nrm = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  const n = pos.getCount();
  const out = { n, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), jn: new Uint16Array(n * 4), wt: new Float32Array(n * 4), idx: null, gar: new Uint8Array(n) };
  const a = [], b = [], c = [], j = [], w = [];
  // поправка, ако скелетът на източника е с други размери: v' = Σ w · (IBM_цел⁻¹ · IBM_изт) · v
  const fix = srcNames.map((name, i) => {
    const ti = target.index.get(name);
    if (ti === undefined) throw new Error('няма кост ' + name);
    const m = target.ibm[ti].clone().invert().multiply(srcIbm[i]);
    const e = m.elements; let d = 0; const I = new THREE.Matrix4().elements;
    for (let k = 0; k < 16; k++) d = Math.max(d, Math.abs(e[k] - I[k]));
    return d > 1e-4 ? m : null;
  });
  const v = new THREE.Vector3(), nv = new THREE.Vector3(), acc = new THREE.Vector3(), accN = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    pos.getElement(i, a); nrm.getElement(i, b); uv ? uv.getElement(i, c) : (c[0] = c[1] = 0);
    J.getElement(i, j); W.getElement(i, w);
    v.fromArray(a); nv.fromArray(b);
    const ws = w[0] + w[1] + w[2] + w[3] || 1;
    if (fix.some((f, k) => f && w.some((ww, q) => ww > 0 && j[q] === k))) {
      acc.set(0, 0, 0); accN.set(0, 0, 0);
      for (let q = 0; q < 4; q++) {
        if (w[q] <= 0) continue;
        const f = fix[j[q]];
        tmp.copy(v); if (f) tmp.applyMatrix4(f); acc.addScaledVector(tmp, w[q] / ws);
        tmp.copy(nv); if (f) tmp.transformDirection(f); accN.addScaledVector(tmp, w[q] / ws);
      }
      v.copy(acc); nv.copy(accN.normalize());
    }
    out.pos.set([v.x, v.y, v.z], i * 3); out.nrm.set([nv.x, nv.y, nv.z], i * 3); out.uv.set([c[0], c[1]], i * 2);
    for (let q = 0; q < 4; q++) { out.jn[i * 4 + q] = target.index.get(srcNames[j[q]]); out.wt[i * 4 + q] = w[q] / ws; }
  }
  out.idx = new Uint32Array(prim.getIndices().getArray());
  return out;
}

/** Само триъгълниците, за които keep(tri, [i0,i1,i2]) е вярно; върховете се свиват. */
function filterTris(p, keep) {
  const idx = [];
  for (let t = 0; t < p.idx.length; t += 3) if (keep(t / 3, p.idx[t], p.idx[t + 1], p.idx[t + 2])) idx.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
  return compact({ ...p, idx: new Uint32Array(idx) });
}
function compact(p) {
  const map = new Int32Array(p.n).fill(-1);
  let m = 0;
  for (const i of p.idx) if (map[i] < 0) map[i] = m++;
  const o = { n: m, pos: new Float32Array(m * 3), nrm: new Float32Array(m * 3), uv: new Float32Array(m * 2), jn: p.jn ? new Uint16Array(m * 4) : null, wt: p.wt ? new Float32Array(m * 4) : null, gar: new Uint8Array(m), col: p.col ? new Float32Array(m * 3) : null, idx: new Uint32Array(p.idx.length) };
  for (let i = 0; i < p.n; i++) {
    const k = map[i]; if (k < 0) continue;
    o.pos.set(p.pos.subarray(i * 3, i * 3 + 3), k * 3); o.nrm.set(p.nrm.subarray(i * 3, i * 3 + 3), k * 3); o.uv.set(p.uv.subarray(i * 2, i * 2 + 2), k * 2);
    if (o.jn) { o.jn.set(p.jn.subarray(i * 4, i * 4 + 4), k * 4); o.wt.set(p.wt.subarray(i * 4, i * 4 + 4), k * 4); }
    if (o.col) o.col.set(p.col.subarray(i * 3, i * 3 + 3), k * 3);
    o.gar[k] = p.gar[i];
  }
  for (let t = 0; t < p.idx.length; t++) o.idx[t] = map[p.idx[t]];
  return o;
}
function merge(parts) {
  parts = parts.filter((p) => p && p.n);
  const n = parts.reduce((s, p) => s + p.n, 0), ni = parts.reduce((s, p) => s + p.idx.length, 0);
  const rigid = !parts[0].jn;
  const o = { n, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), jn: rigid ? null : new Uint16Array(n * 4), wt: rigid ? null : new Float32Array(n * 4), gar: new Uint8Array(n), col: parts.some((p) => p.col) ? new Float32Array(n * 3).fill(1) : null, idx: new Uint32Array(ni) };
  let v = 0, t = 0;
  for (const p of parts) {
    o.pos.set(p.pos, v * 3); o.nrm.set(p.nrm, v * 3); o.uv.set(p.uv, v * 2); o.gar.set(p.gar, v);
    if (!rigid) { o.jn.set(p.jn, v * 4); o.wt.set(p.wt, v * 4); }
    if (o.col && p.col) o.col.set(p.col, v * 3);
    for (let i = 0; i < p.idx.length; i++) o.idx[t + i] = p.idx[i] + v;
    v += p.n; t += p.idx.length;
  }
  return o;
}
/** Опростяване (meshoptimizer) — пази ръбовете на UV островите. */
function simplify(p, ratio, err = 0.02) {
  if (ratio >= 1) return p;
  const target = Math.floor((p.idx.length * ratio) / 3) * 3;
  const [idx] = MeshoptSimplifier.simplify(p.idx, p.pos, 3, target, err, ['LockBorder']);
  const before = p.idx.length / 3;
  const o = compact({ ...p, idx: new Uint32Array(idx) });
  console.log(`    опростено ${before} → ${o.idx.length / 3} триъгълника`);
  return o;
}

/** Свързани UV острови (без сливане по позиция): номер на остров за всеки връх. */
function islands(p) {
  const par = new Int32Array(p.n).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = find(p.idx[t]), b = find(p.idx[t + 1]), c = find(p.idx[t + 2]);
    if (a !== b) par[a] = b;
    const b2 = find(b); if (find(c) !== b2) par[find(c)] = b2;
  }
  const ids = new Int32Array(p.n);
  for (let i = 0; i < p.n; i++) ids[i] = find(i);
  return ids;
}

// ───────────────────────────── текстури ─────────────────────────────
async function decode(file, size) {
  const { data, info } = await sharp(file).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** Средна (линейна) яркост и цвят на текстурата под UV на триъгълниците от списъка. */
function avgColor(tex, p, tris) {
  const s = [0, 0, 0]; let n = 0;
  for (const t of tris) {
    let u = 0, v = 0;
    for (let k = 0; k < 3; k++) { const i = p.idx[t * 3 + k]; u += p.uv[i * 2] / 3; v += p.uv[i * 2 + 1] / 3; }
    const x = Math.min(tex.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.w)));
    const y = Math.min(tex.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.h)));
    const o = (y * tex.w + x) * 3;
    for (let c = 0; c < 3; c++) s[c] += srgb2lin(tex.data[o + c] / 255);
    n++;
  }
  return s.map((x) => x / Math.max(1, n));
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

async function jpeg(input, size, q = 86, opts = {}) {
  let img = sharp(input, opts.raw ? { raw: opts.raw } : undefined);
  if (size) img = img.resize(size[0], size[1], { fit: 'fill' });
  return img.removeAlpha().jpeg({ quality: q, mozjpeg: true }).toBuffer();
}
async function png(input, size, opts = {}) {
  let img = sharp(input, opts.raw ? { raw: opts.raw } : undefined);
  if (size) img = img.resize(size[0], size[1], { fit: 'fill' });
  return img.png({ compressionLevel: 9, palette: false }).toBuffer();
}
/** Две квадратни текстури една до друга (атлас 2:1). */
async function sideBySide(a, b, size) {
  const A = await sharp(a).resize(size, size, { fit: 'fill' }).removeAlpha().toBuffer();
  const B = await sharp(b).resize(size, size, { fit: 'fill' }).removeAlpha().toBuffer();
  return sharp({ create: { width: size * 2, height: size, channels: 3, background: '#808080' } })
    .composite([{ input: A, left: 0, top: 0 }, { input: B, left: size, top: 0 }]).png().toBuffer();
}
/** Грапавост (сив канал) → glTF metallicRoughness (G = грапавост, B = 0 метал, R = 255). */
async function roughToMR(file, size, mul = 1, add = 0) {
  const { data, info } = await sharp(file).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) { out[i * 3] = 255; out[i * 3 + 1] = Math.max(0, Math.min(255, data[i] * mul + add * 255)); out[i * 3 + 2] = 0; }
  return jpeg(out, null, 88, { raw: { width: info.width, height: info.height, channels: 3 } });
}

// ───────────────────────────── процедурна текстура за носията (шевици, вълна, басма) ─────────────────────────────
// 1024×1024 RGBA. A = 255 → пребоядисва се в цвета на дрехата; A = 0 → остава както е нарисувано (шевиците).
// Области (UV): [0,.5]×[0,.5] тъкан (сукно/лен); [.5,1]×[0,.5] престилка с шевици; [0,.5]×[.5,1] басма за забрадката;
// [.5,1]×[.5,.75] пояс на ивици; [.5,1]×[.75,1] агнешка вълна (калпак).
export const FOLK = { cloth: [0, 0, 0.5, 0.5], apron: [0.5, 0, 1, 0.5], scarf: [0, 0.5, 0.5, 1], sash: [0.5, 0.5, 1, 0.75], wool: [0.5, 0.75, 1, 1] };
function folkTexture() {
  const S = 1024;
  const rgba = Buffer.alloc(S * S * 4);
  const hgt = new Float32Array(S * S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const noise = new Float32Array(S * S).map(() => rnd());
  const blur = (x, y) => { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += noise[((y + dy + S) % S) * S + ((x + dx + S) % S)]; return s / 9; };
  const put = (x, y, g, a = 255, rgb = null, h = g / 255) => {
    const o = (y * S + x) * 4;
    if (rgb) { rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; } else { rgba[o] = rgba[o + 1] = rgba[o + 2] = g; }
    rgba[o + 3] = a; hgt[y * S + x] = h;
  };
  const RED = [179, 38, 43], BLACK = [28, 20, 20], GOLD = [214, 168, 60], WHITE = [238, 230, 212], GREEN = [60, 96, 52];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // тъкан: сплитка (основа × вътък) + лек шум
    const weave = (Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2) > 0 ? 1 : 0.86);
    const base = 180 + (blur(x, y) - 0.5) * 40;
    if (u < 0.5 && v < 0.5) { put(x, y, Math.round(base * weave)); continue; }
    if (u >= 0.5 && v < 0.5) {
      // престилка: ленено поле, долу три пояса шевици, над тях ромбове, отстрани кант
      const lx = (u - 0.5) / 0.5, ly = v / 0.5; // 0..1 (ly = 0 горе, 1 долу)
      const g = Math.round(base * weave);
      let col = null;
      const px = Math.floor(lx * 64), py = Math.floor(ly * 128);
      const band = (y0, y1) => ly >= y0 && ly < y1;
      if (lx < 0.05 || lx > 0.95) col = (py % 4 < 2) ? RED : BLACK;                               // кант отстрани
      else if (band(0.62, 0.66) || band(0.94, 0.97)) col = RED;                                     // плътни ивици
      else if (band(0.67, 0.93)) {                                                                  // широк пояс: ромбове с кръст
        const cx = ((px % 12) - 5.5), cy = (((py - Math.floor(0.67 * 128)) % 12) - 5.5);
        const d = Math.abs(cx) + Math.abs(cy);
        if (d < 2) col = GOLD; else if (d >= 3 && d < 4.5) col = RED; else if (d >= 5 && d < 6) col = BLACK;
        else if ((px + py) % 2 === 0 && d >= 6) col = null;
      } else if (band(0.45, 0.6)) {                                                                 // „елхички“
        const cx = (px % 8) - 3.5, cy = (py - Math.floor(0.45 * 128)) % 10;
        if (Math.abs(cx) < cy * 0.45 && cy < 8) col = (cy < 3) ? BLACK : RED;
      } else if (band(0.06, 0.09)) col = (px % 4 < 2) ? RED : BLACK;                                // горен кант
      if (col) {
        // кръстат бод — малко релеф
        const st = ((x % 3) + (y % 3)) % 3 === 0 ? 0.85 : 1;
        put(x, y, 0, 0, col.map((c) => Math.round(c * st)), 0.75 + 0.1 * st);
      } else put(x, y, g);
      continue;
    }
    if (u < 0.5 && v >= 0.5) {
      // басма: дребни цветчета на точки
      const g = Math.round(base * 0.98 * weave);
      const cx = (x % 32) - 16, cy = (y % 32) - 16, ox = ((x + 16) % 32) - 16, oy = ((y + 16) % 32) - 16;
      const r1 = Math.hypot(cx, cy), r2 = Math.hypot(ox, oy);
      if (r1 < 3.2) put(x, y, 0, 0, GOLD, 0.8);
      else if (r1 < 6 && Math.abs(Math.sin(Math.atan2(cy, cx) * 3)) > 0.35) put(x, y, 0, 0, WHITE, 0.8);
      else if (r2 < 2.6) put(x, y, 0, 0, GREEN, 0.75);
      else put(x, y, g);
      continue;
    }
    if (v < 0.75) {
      // пояс: червено сукно с тесни черни/жълти ивици по дължина (u)
      const ly = (v - 0.5) / 0.25;
      const g = Math.round(base * weave);
      const s = Math.floor(ly * 40);
      if (s === 4 || s === 35) put(x, y, 0, 0, BLACK, 0.7);
      else if (s === 6 || s === 33) put(x, y, 0, 0, GOLD, 0.7);
      else put(x, y, g);
      continue;
    }
    // агнешка вълна: къдрици
    const k = blur(x, y) * 0.5 + 0.5 * Math.abs(Math.sin(x * 0.45 + Math.sin(y * 0.3) * 2) * Math.cos(y * 0.5 + Math.sin(x * 0.25) * 2));
    put(x, y, Math.round(110 + k * 120), 255, null, k);
  }
  // нормали от височината
  const nrm = Buffer.alloc(S * S * 3);
  const H = (x, y) => hgt[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2, dy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1);
    const o = (y * S + x) * 3;
    nrm[o] = Math.round((-dx / l * 0.5 + 0.5) * 255); nrm[o + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); nrm[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
  }
  return { rgba, nrm, S };
}

// ───────────────────────────── източници ─────────────────────────────
console.log('Източници: ' + SRC);
const src = {
  mPeasant: await readGltf(P.outfits + '/Male_Peasant.gltf'),
  fPeasant: await readGltf(P.outfits + '/Female_Peasant.gltf'),
  mRanger: await readGltf(P.outfits + '/Male_Ranger.gltf'),
  fRanger: await readGltf(P.outfits + '/Female_Ranger.gltf'),
  mBase: await readGltf(P.base + '/Superhero_Male_FullBody.gltf'),
  fBase: await readGltf(P.base + '/Superhero_Female_FullBody.gltf'),
};
const hairSrc = {};
for (const h of ['Hair_Long', 'Hair_Buns', 'Hair_SimpleParted', 'Hair_Beard', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Eyebrows_Female', 'Eyebrows_Regular'])
  hairSrc[h] = await readGltf(P.hair + '/' + h + '.gltf');

const meshNodes = (doc) => doc.getRoot().listNodes().filter((n) => n.getMesh());
const getPrims = (doc, nodeName, matName) => {
  const node = meshNodes(doc).find((n) => n.getName() === nodeName);
  if (!node) throw new Error('няма ' + nodeName);
  return node.getMesh().listPrimitives().filter((p) => !matName || p.getMaterial()?.getName() === matName).map((p) => ({ node, prim: p }));
};
const one = (doc, nodeName, matName, target) => { const [{ node, prim }] = getPrims(doc, nodeName, matName); return primData(node, prim, target); };

const TEX = 1024;
const texPeasant = await decode(path.join(SRC, P.tex, 'Peasant/T_Peasant_BaseColor.png'), 512);
const texRanger = await decode(path.join(SRC, P.tex, 'Ranger/T_Ranger_3_BaseColor.png'), 512);

/** Етикет по UV остров: fn(среден цвят, триъгълници, bbox) → етикет или -1 (махни острова). */
function labelIslands(p, tex, fn) {
  const isl = islands(p);
  const tris = new Map();
  for (let t = 0; t < p.idx.length / 3; t++) { const k = isl[p.idx[t * 3]]; if (!tris.has(k)) tris.set(k, []); tris.get(k).push(t); }
  const drop = new Set();
  for (const [k, list] of tris) {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const t of list) for (let q = 0; q < 3; q++) box.expandByPoint(v.fromArray(p.pos, p.idx[t * 3 + q] * 3));
    const col = avgColor(tex, p, list);
    const g = fn(col, list.length, box);
    if (g < 0) { drop.add(k); continue; }
    for (const t of list) for (let q = 0; q < 3; q++) p.gar[p.idx[t * 3 + q]] = g;
  }
  return drop.size ? filterTris(p, (t, a) => !drop.has(isl[a])) : p;
}
const setG = (p, g) => { p.gar.fill(g); return p; };
/** Тегло на група кости във връх i. */
const wOf = (p, i, set) => { let s = 0; for (let q = 0; q < 4; q++) if (set.has(p.jn[i * 4 + q])) s += p.wt[i * 4 + q]; return s; };
const boneSet = (sk, re) => new Set(sk.names.map((n, i) => (re.test(n) ? i : -1)).filter((i) => i >= 0));

// ───────────────────────────── генерирани дрехи ─────────────────────────────
/** Скинва точка към кости с тегла [[индекс, тегло], …] (нормира, до 4). */
function skinW(list) {
  list = list.filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = list.reduce((a, [, w]) => a + w, 0) || 1;
  const jn = [0, 0, 0, 0], wt = [0, 0, 0, 0];
  list.forEach(([j, w], i) => { jn[i] = j; wt[i] = w / s; });
  return { jn, wt };
}
/** Решетка (rows+1)×(cols+1) от функция f(i, j) → { p:[x,y,z], skin, uv:[u,v] }; nrm се смятат после. */
function grid(rows, cols, f, gar, wrap = false) {
  const n = (rows + 1) * (cols + 1);
  const o = { n, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), jn: new Uint16Array(n * 4), wt: new Float32Array(n * 4), gar: new Uint8Array(n).fill(gar), idx: null };
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
    const k = i * (cols + 1) + j, r = f(i, j);
    o.pos.set(r.p, k * 3); o.uv.set(r.uv, k * 2); o.jn.set(r.skin.jn, k * 4); o.wt.set(r.skin.wt, k * 4);
  }
  const idx = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  o.idx = new Uint32Array(idx);
  computeNormals(o, wrap ? cols : 0);
  return o;
}
function computeNormals(o, wrapCols = 0) {
  const nrm = new Float32Array(o.n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < o.idx.length; t += 3) {
    a.fromArray(o.pos, o.idx[t] * 3); b.fromArray(o.pos, o.idx[t + 1] * 3); c.fromArray(o.pos, o.idx[t + 2] * 3);
    e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);
    for (let q = 0; q < 3; q++) for (let k = 0; k < 3; k++) nrm[o.idx[t + q] * 3 + k] += e1.getComponent(k);
  }
  if (wrapCols) {
    // шевът на пръстена (j = 0 и j = cols) — общи нормали
    const C = wrapCols + 1;
    for (let r = 0; r * C < o.n; r++) for (let k = 0; k < 3; k++) { const s = nrm[r * C * 3 + k] + nrm[(r * C + wrapCols) * 3 + k]; nrm[r * C * 3 + k] = nrm[(r * C + wrapCols) * 3 + k] = s; }
  }
  for (let i = 0; i < o.n; i++) { a.fromArray(nrm, i * 3).normalize(); o.nrm.set([a.x, a.y, a.z], i * 3); }
}
/** Нормали наново, като върховете на едно и също място (UV шевове) получават обща нормала. */
function computeNormalsKeepSeams(o) {
  computeNormals(o);
  const by = new Map();
  for (let i = 0; i < o.n; i++) {
    const k = [0, 1, 2].map((q) => Math.round(o.pos[i * 3 + q] * 1e4)).join(',');
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(i);
  }
  const v = new THREE.Vector3();
  for (const list of by.values()) {
    if (list.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of list) v.x += o.nrm[i * 3], v.y += o.nrm[i * 3 + 1], v.z += o.nrm[i * 3 + 2];
    v.normalize();
    for (const i of list) o.nrm.set([v.x, v.y, v.z], i * 3);
  }
}
const inRect = (rect, u, v) => [rect[0] + (rect[2] - rect[0]) * u, rect[1] + (rect[3] - rect[1]) * v];

/** Профил на тялото: за височина y — полуширина и център/дълбочина (от меша на краката/тялото). */
function bodyProfile(parts) {
  const bins = new Map();
  for (const p of parts) for (let i = 0; i < p.n; i++) {
    const y = p.pos[i * 3 + 1], k = Math.round(y * 50);
    const b = bins.get(k) || { xmin: 9, xmax: -9, zmin: 9, zmax: -9 };
    const x = p.pos[i * 3], z = p.pos[i * 3 + 2];
    b.xmin = Math.min(b.xmin, x); b.xmax = Math.max(b.xmax, x); b.zmin = Math.min(b.zmin, z); b.zmax = Math.max(b.zmax, z);
    bins.set(k, b);
  }
  return (y) => bins.get(Math.round(y * 50)) || bins.get(Math.round(y * 50) + 1) || bins.get(Math.round(y * 50) - 1);
}

/**
 * Пола (сукман) — камбана от кръста до hemY, с плисета. Горният пръстен е на таза, надолу теглата минават към
 * бедрата (лявата страна към лявото бедро), за да следва краката при ходене.
 */
function makeSkirt(sk, prof, { topY, hemY, flare, rings = 14, cols = 56, pleats = 18, gar = G.SKIRT, uvRect = FOLK.cloth, lenTex = 1 }) {
  const pel = sk.index.get('pelvis'), tl = sk.index.get('thigh_l'), tr = sk.index.get('thigh_r'), cl = sk.index.get('calf_l'), cr = sk.index.get('calf_r'), sp = sk.index.get('spine_01');
  const top = prof(topY);
  const cx = (top.xmin + top.xmax) / 2, cz = (top.zmin + top.zmax) / 2;
  const rx0 = (top.xmax - top.xmin) / 2 + 0.012, rz0 = (top.zmax - top.zmin) / 2 + 0.012;
  const hips = prof(topY - 0.12) || top;
  const rxH = Math.max(rx0, (hips.xmax - hips.xmin) / 2 + 0.02), rzH = Math.max(rz0, (hips.zmax - hips.zmin) / 2 + 0.02);
  return grid(rings, cols, (i, j) => {
    const t = i / rings;                      // 0 горе → 1 подгъв
    const y = topY + (hemY - topY) * t;
    const a = (j / cols) * Math.PI * 2;       // 0 = отпред (+Z), π/2 = ляво (+X)
    const sx = Math.sin(a), cz2 = Math.cos(a);
    // от кръста през ханша до подгъва
    const hipT = Math.min(1, t / 0.18);
    let rx = rx0 + (rxH - rx0) * Math.sin(hipT * Math.PI / 2), rz = rz0 + (rzH - rz0) * Math.sin(hipT * Math.PI / 2);
    const fl = Math.max(0, t - 0.15) / 0.85;
    rx += flare * fl * fl * 0.8 + flare * fl * 0.4; rz += flare * fl * fl * 0.8 + flare * fl * 0.4;
    const pl = 1 + (0.012 + 0.05 * fl) * Math.sin(a * pleats) * Math.min(1, t * 4);
    const x = cx + sx * rx * pl, z = cz + cz2 * rz * pl;
    // тегла: горе таз (+ малко гръбнак), надолу към бедрата/прасците според страната
    const side = sx; // +1 ляво, -1 дясно
    const leg = Math.pow(t, 1.3) * 0.75;
    const wl = leg * Math.max(0, 0.5 + side * 0.9) , wr = leg * Math.max(0, 0.5 - side * 0.9);
    const calf = Math.max(0, t - 0.75) * 0.6;
    const skin = skinW([[pel, 1 - Math.min(0.85, wl + wr)], [sp, t < 0.1 ? 0.3 * (1 - t / 0.1) : 0], [tl, wl * (1 - calf)], [tr, wr * (1 - calf)], [cl, wl * calf], [cr, wr * calf]]);
    return { p: [x, y, z], skin, uv: inRect(uvRect, (j / cols) * 2 % 1, t * lenTex) };
  }, gar, true);
}

/** Най-предната точка (z) на повърхността на частите около (x, y). */
function frontSampler(parts) {
  const pts = [];
  for (const p of parts) for (let i = 0; i < p.n; i++) pts.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
  return (x, y, r = 0.04) => {
    let best = -9;
    for (let i = 0; i < pts.length; i += 3) if (Math.abs(pts[i + 1] - y) < r && Math.abs(pts[i] - x) < r && pts[i + 2] > best) best = pts[i + 2];
    return best;
  };
}

/** Престилка — платно отпред, над полата/тялото; горе на кръста (или на гърдите), долу следва бедрата. */
function makeApron(sk, surface, { topY, botY, halfW, rows = 10, cols = 8, gar = G.APRON, uvRect = FOLK.apron, flare = 0.25, gap = 0.012 }) {
  const pel = sk.index.get('pelvis'), tl = sk.index.get('thigh_l'), tr = sk.index.get('thigh_r'), s1 = sk.index.get('spine_01'), s2 = sk.index.get('spine_02');
  const front = frontSampler(surface);
  const o = grid(rows, cols, (i, j) => {
    const t = i / rows, s = j / cols;
    const y = topY + (botY - topY) * t;
    const hw = halfW * (1 + flare * t);
    const x = (s - 0.5) * 2 * hw;
    let z = front(x, y);
    if (z < -1) z = front(x, y, 0.09);
    z += gap + 0.006 * t;
    let skin;
    if (y > 1.1) { const f = Math.min(1, (y - 1.1) / 0.25); skin = skinW([[s2, f], [s1, 1 - f]]); }
    else {
      const leg = Math.pow(Math.max(0, (1.05 - y) / 0.6), 1.3) * 0.6;
      const wl = leg * Math.max(0, 0.5 + (x / hw) * 0.6), wr = leg * Math.max(0, 0.5 - (x / hw) * 0.6);
      skin = skinW([[pel, 1 - wl - wr], [tl, wl], [tr, wr]]);
    }
    return { p: [x, y, z], skin, uv: inRect(uvRect, s, t) };
  }, gar);
  return o;
}

/** Слой над съществуваща дреха (елек, пояс): избрани триъгълници, издути по нормалата, с нови UV. */
function shellFrom(p, keep, { offset, gar, uvRect, uvScale = 3 }) {
  const o = filterTris(p, keep);
  for (let i = 0; i < o.n; i++) {
    for (let k = 0; k < 3; k++) o.pos[i * 3 + k] += o.nrm[i * 3 + k] * offset;
    const x = o.pos[i * 3], y = o.pos[i * 3 + 1], z = o.pos[i * 3 + 2];
    const ang = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
    o.uv.set(inRect(uvRect, (ang * uvScale) % 1, (y * uvScale) % 1), i * 2);
    o.gar[i] = gar;
  }
  return o;
}

/** Калпак — пресечен конус с овален връх, в пространството на Head (твърда част). */
function makeKalpak(headTop, { r = 0.105, h = 0.15, rings = 8, cols = 28, uvRect = FOLK.wool } = {}) {
  const n = (rings + 2) * (cols + 1);
  const o = { n, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), gar: new Uint8Array(n).fill(G.KALPAK), idx: null, jn: null, wt: null };
  let k = 0;
  for (let i = 0; i <= rings + 1; i++) for (let j = 0; j <= cols; j++) {
    const a = (j / cols) * Math.PI * 2;
    const t = Math.min(1, i / rings);
    let rr = r * (1 + 0.08 * Math.sin(t * Math.PI)) * (1 - 0.1 * t);
    let y = headTop.y + t * h;
    if (i === rings + 1) { rr = 0; y = headTop.y + h + 0.012; }
    o.pos.set([headTop.x + Math.sin(a) * rr * 1.04, y, headTop.z + Math.cos(a) * rr], k * 3);
    o.uv.set(inRect(uvRect, j / cols, Math.min(1, i / (rings + 1))), k * 2);
    k++;
  }
  const idx = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j < cols; j++) { const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  o.idx = new Uint32Array(idx);
  computeNormals(o, cols);
  return o;
}

// ───────────────────────────── тела ─────────────────────────────
function cutSkin(doc, target, keepFn) {
  const node = meshNodes(doc).find((n) => /^Super[Hh]ero_/.test(n.getName()));
  const p = primData(node, node.getMesh().listPrimitives()[0], target);
  return filterTris(p, (t, a, b, c) => keepFn(p, a) && keepFn(p, b) && keepFn(p, c));
}
/** Твърда част (коса/вежди) → в пространството на костта Head на източника. */
function rigidPart(doc, gar) {
  const node = meshNodes(doc)[0];
  const sk = node.getSkin();
  const names = sk.listJoints().map((j) => j.getName());
  const ibm = M4(sk.getInverseBindMatrices().getElement(names.indexOf('Head'), []));
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION'), nrm = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
  const n = pos.getCount();
  const o = { n, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), gar: new Uint8Array(n).fill(gar), idx: new Uint32Array(prim.getIndices().getArray()), jn: null, wt: null };
  const v = new THREE.Vector3(), a = [];
  for (let i = 0; i < n; i++) {
    v.fromArray(pos.getElement(i, a)).applyMatrix4(ibm); o.pos.set([v.x, v.y, v.z], i * 3);
    v.fromArray(nrm.getElement(i, a)).transformDirection(ibm); o.nrm.set([v.x, v.y, v.z], i * 3);
    o.uv.set(uv.getElement(i, [0, 0]), i * 2);
  }
  return o;
}
/** Части с UV в [0,1] → в лявата/дясната половина на атлас 2:1. */
function toAtlasHalf(p, half) {
  for (let i = 0; i < p.n; i++) {
    let u = p.uv[i * 2]; u = Math.min(1, Math.max(0, u));
    p.uv[i * 2] = half * 0.5 + u * 0.5;
  }
  return p;
}

const bodies = {};

// ── мъж (селянин) ──
{
  const sk = skeletonOf(src.mPeasant);
  const shirtParts = getPrims(src.mPeasant, 'Male_Peasant_Body').map(({ node, prim }) => primData(node, prim, sk));
  let body = shirtParts[0];
  // ризата (най-големият остров… по цвят: светло = риза), коланът (тъмен, на кръста), катарамата (метал)
  body = labelIslands(body, texPeasant, (col, n, box) => {
    if (box.min.y > 1.0 && box.max.y < 1.16 && lum(col) < 0.12) return G.SASH;  // коланът → пояс
    if (lum(col) > 0.3 && n < 200) return G.KEEP;                                  // метал
    return G.SHIRT;
  });
  const cuffs = setG(one(src.mPeasant, 'Male_Peasant_Arms', 'MI_Peasant', sk), G.CUFF);
  const legs = setG(one(src.mPeasant, 'Male_Peasant_Legs', null, sk), G.TROUSERS);
  let feet = one(src.mPeasant, 'Male_Peasant_Feet', null, sk);
  feet = labelIslands(feet, texPeasant, (col, n, box) => (box.max.y > 0.3 ? G.LEGWRAP : G.BOOTS));
  feet = simplify(feet, 0.55);
  const hands = simplify(one(src.mPeasant, 'Male_Peasant_Arms', 'MI_Regular_Male', sk), 0.5);
  const headSet = boneSet(sk, /^(Head|neck_01)$/);
  const head = cutSkin(src.mBase, sk, (p, i) => wOf(p, i, headSet) > 0.35 && p.pos[i * 3 + 1] > 1.45);
  const eyes = one(src.mBase, 'Eyes', null, sk);
  // елек: торсът на ризата (без ръкавите — по теглата на костите — и без яката), отворен отпред с остро деколте
  const armSet = boneSet(sk, /^(upperarm|lowerarm|hand)_/);
  const vest = shellFrom(body, (t, a, b, c) => [a, b, c].every((i) => {
    const x = body.pos[i * 3], y = body.pos[i * 3 + 1], z = body.pos[i * 3 + 2];
    // покрива и раменете (без яката); деколтето е тясно долу и се разширява към врата
    const open = z > 0 && Math.abs(x) < 0.028 + Math.max(0, y - 1.28) * 0.42;
    const collar = y > 1.5 && Math.abs(x) < 0.1;
    return body.gar[i] === G.SHIRT && wOf(body, i, armSet) < 0.35 && y > 1.1 && y < 1.58 && !open && !collar;
  }), { offset: 0.008, gar: G.VEST, uvRect: FOLK.cloth });
  // пояс: широка ивица от ризата на кръста
  const sash = shellFrom(body, (t, a, b, c) => [a, b, c].every((i) => body.gar[i] === G.SHIRT && body.pos[i * 3 + 1] > 1.0 && body.pos[i * 3 + 1] < 1.16), { offset: 0.011, gar: G.SASH, uvRect: FOLK.sash, uvScale: 1 });
  for (let i = 0; i < sash.n; i++) sash.uv[i * 2 + 1] = FOLK.sash[1] + (FOLK.sash[3] - FOLK.sash[1]) * Math.min(0.999, Math.max(0, (sash.pos[i * 3 + 1] - 1.0) / 0.16));
  // кожена престилка (Иван): платно отпред от гърдите до коленете
  const leather = makeApron(sk, [body, legs], { topY: 1.42, botY: 0.6, halfW: 0.15, rows: 12, gar: G.LEATHER, uvRect: FOLK.cloth, flare: 0.15, gap: 0.016 });
  bodies.M = {
    sk, cloth: merge([body, cuffs, legs, feet]), folk: merge([vest, sash, leather]), skin: merge([head, hands]), eyes: setG(eyes, 0),
    headTop: new THREE.Vector3(0, 1.0, 0),
  };
}

// ── жена (селянка) ──
{
  const sk = skeletonOf(src.fPeasant);
  let body = one(src.fPeasant, 'Female_Peasant_Body', null, sk);
  body = labelIslands(body, texPeasant, (col) => {
    const L = lum(col);
    if (L > 0.25) return G.SHIRT;
    if (L < 0.03) return G.SASH;     // корсетът → червен пояс
    return G.BODICE;                 // елечето
  });
  let arms = one(src.fPeasant, 'Female_Peasant_Arms', null, sk);
  // ръкавът и маншетът остават, ръкавиците (от лакътя надолу) се махат — там са истински ръце
  arms = labelIslands(arms, texPeasant, (col, n, box) => {
    const ax = Math.min(Math.abs(box.min.x), Math.abs(box.max.x));
    if (ax > 0.5) return -1;
    if (box.max.x - box.min.x > 0.2 || Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) > 0.4 && lum(col) > 0.2) return G.SHIRT;
    return G.TRIM;
  });
  let feet = one(src.fPeasant, 'Female_Peasant_Feet', null, sk);
  feet = labelIslands(feet, texPeasant, (col, n, box) => (box.max.y > 0.3 && box.min.y > 0.02 ? G.LEGWRAP : G.BOOTS));
  feet = simplify(feet, 0.55);
  const legsRef = one(src.fPeasant, 'Female_Peasant_Legs', null, sk);
  const headSet = boneSet(sk, /^(Head|neck_01)$/);
  const head = cutSkin(src.fBase, sk, (p, i) => wOf(p, i, headSet) > 0.35 && p.pos[i * 3 + 1] > 1.42);
  const handSet = boneSet(sk, /^(lowerarm|hand|thumb|index|middle|ring|pinky)_/);
  const hands = simplify(cutSkin(src.fBase, sk, (p, i) => wOf(p, i, handSet) > 0.5 && Math.abs(p.pos[i * 3]) > 0.43), 0.5);
  const eyes = one(src.fBase, 'Eyes', null, sk);
  const prof = bodyProfile([legsRef, body]);
  const skirt = makeSkirt(sk, prof, { topY: 1.07, hemY: 0.3, flare: 0.13 });
  const apron = makeApron(sk, [skirt], { topY: 1.05, botY: 0.4, halfW: 0.14 });
  // дълга рокля на самодивите — до глезените
  const dress = makeSkirt(sk, prof, { topY: 1.07, hemY: 0.05, flare: 0.2, rings: 18, gar: G.DRESS });
  // забрадка — от качулката на горската дреха (по-плътно до главата), с нови UV към басмата
  let hood = one(src.fRanger, 'Female_Ranger_Head_Hood', null, sk);
  {
    // качулката е широка и с връх — над очите я прибираме към главата (забрадката е плътно, само малко обем от косата)
    const c = new THREE.Vector3(0, 1.655, -0.015), v = new THREE.Vector3();
    for (let i = 0; i < hood.n; i++) {
      v.fromArray(hood.pos, i * 3);
      const k = THREE.MathUtils.smoothstep(v.y, 1.6, 1.68);
      if (k <= 0) continue;
      const d = v.distanceTo(c), r0 = 0.112;
      if (d <= r0) continue;
      const d2 = r0 + (d - r0) * (1 - 0.6 * k);
      v.sub(c).multiplyScalar(d2 / d).add(c);
      hood.pos.set([v.x, v.y, v.z], i * 3);
    }
    computeNormalsKeepSeams(hood);
  }
  hood = shellFrom(hood, () => true, { offset: 0, gar: G.SCARF, uvRect: FOLK.scarf, uvScale: 4 });
  bodies.F = {
    sk, cloth: merge([body, arms, feet]), folk: merge([skirt, apron, hood, dress]), skin: merge([head, hands]), eyes: setG(eyes, 0),
  };
}

// ── Стоян (горска дреха, кафява) ──
{
  const sk = skeletonOf(src.mRanger);
  const parts = [];
  for (const node of meshNodes(src.mRanger)) {
    const name = node.getName();
    if (/Pauldron/.test(name)) continue;
    for (const prim of node.getMesh().listPrimitives()) {
      if (prim.getMaterial()?.getName() !== 'MI_Ranger') continue;
      let p = primData(node, prim, sk);
      if (/Hood/.test(name)) setG(p, G.HOOD);
      else if (/Boots/.test(name)) { setG(p, G.KEEP); p = simplify(p, 0.25, 0.03); }
      else if (/Bracer/.test(name)) { setG(p, G.KEEP); p = simplify(p, 0.4, 0.03); }
      else if (/Belt/.test(name)) { setG(p, G.KEEP); p = simplify(p, 0.6, 0.03); }
      else if (/Legs/.test(name)) setG(p, G.TROUSERS);
      else if (/Arms/.test(name)) setG(p, G.SHIRT);
      else if (/Body/.test(name)) p = labelIslands(p, texRanger, (col) => (lum(col) > 0.2 ? G.SHIRT : G.KEEP));
      parts.push(p);
    }
  }
  const hands = simplify(one(src.mRanger, 'Male_Ranger_Arms', 'MI_Regular_Male', sk), 0.6);
  const headSet = boneSet(sk, /^(Head|neck_01)$/);
  const head = cutSkin(src.mBase, sk, (p, i) => wOf(p, i, headSet) > 0.35 && p.pos[i * 3 + 1] > 1.45);
  const eyes = one(src.mBase, 'Eyes', null, sk);
  bodies.H = { sk, cloth: merge(parts), folk: null, skin: merge([head, hands]), eyes: setG(eyes, 0) };
}

// ── коси (твърди, в пространството на Head) — един меш, всяка част с номер в _GARMENT (виж HAIR_PIECES) ──
export const HAIR_PIECES = { hair_long: 1, hair_buns: 2, hair_parted: 3, hair_buzzed: 4, hair_buzzed_f: 5, beard: 6, mustache: 7, brows_m: 8, brows_f: 9, kalpak: 10 };
const hair = {
  hair_long: toAtlasHalf(rigidPart(hairSrc.Hair_Long, 1), 1),
  hair_buns: toAtlasHalf(rigidPart(hairSrc.Hair_Buns, 2), 1),
  hair_parted: toAtlasHalf(rigidPart(hairSrc.Hair_SimpleParted, 3), 0),
  hair_buzzed: toAtlasHalf(rigidPart(hairSrc.Hair_Buzzed, 4), 0),
  hair_buzzed_f: toAtlasHalf(rigidPart(hairSrc.Hair_BuzzedFemale, 5), 0),
  beard: toAtlasHalf(rigidPart(hairSrc.Hair_Beard, 6), 0),
  brows_m: toAtlasHalf(rigidPart(hairSrc.Eyebrows_Regular, 8), 0),
  brows_f: toAtlasHalf(rigidPart(hairSrc.Eyebrows_Female, 9), 1),
};
// мустак = само горната устна от брадата (над устата и пред лицето)
hair.mustache = filterTris(hair.beard, (t, a, b, c) => [a, b, c].every((i) => hair.beard.pos[i * 3 + 1] > 0.0 && hair.beard.pos[i * 3 + 2] > 0.085));
hair.mustache.gar.fill(7);
{
  // калпак: върху темето (в пространството на Head) — темето е най-високата точка на късата коса
  let top = -9, cz = 0;
  const hp = hair.hair_buzzed;
  for (let i = 0; i < hp.n; i++) if (hp.pos[i * 3 + 1] > top) { top = hp.pos[i * 3 + 1]; cz = hp.pos[i * 3 + 2]; }
  // калпакът ползва гъстата коса от атласа (дясната половина) — оцветена в черно прилича на агнешка вълна
  hair.kalpak = makeKalpak(new THREE.Vector3(0, top - 0.075, cz - 0.02), { uvRect: [0.52, 0.1, 0.98, 0.7] });
  hair.kalpak.gar.fill(10);
}
for (const [k, p] of Object.entries(hair)) {
  let mn = 9, mx = -9;
  for (let i = 0; i < p.n; i++) { mn = Math.min(mn, p.pos[i * 3 + 1]); mx = Math.max(mx, p.pos[i * 3 + 1]); }
  console.log(`  коса ${k}: ${p.idx.length / 3} тр., y ${mn.toFixed(3)}..${mx.toFixed(3)}`);
}
const hairAll = merge(Object.values(hair));

// ───────────────────────────── изходен документ ─────────────────────────────
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('people');
const texCache = new Map();
async function tex(name, makeBuf, mime = 'image/jpeg') {
  if (texCache.has(name)) return texCache.get(name);
  const t = doc.createTexture(name).setImage(new Uint8Array(await makeBuf())).setMimeType(mime).setURI(name + (mime === 'image/png' ? '.png' : '.jpg'));
  texCache.set(name, t);
  return t;
}
const T = (rel) => path.join(SRC, rel);
const folkTex = folkTexture();
const mats = {
  peasant: doc.createMaterial('cloth_peasant').setDoubleSided(true).setMetallicFactor(1).setRoughnessFactor(1)
    .setBaseColorTexture(await tex('peasant_c', () => jpeg(T(P.tex + '/Peasant/T_Peasant_BaseColor.png'), [TEX, TEX], 88)))
    .setNormalTexture(await tex('peasant_n', () => jpeg(T(P.tex + '/Peasant/T_Peasant_Normal.png'), [TEX, TEX], 90)))
    .setMetallicRoughnessTexture(await tex('peasant_orm', () => jpeg(T(P.tex + '/Peasant/T_Peasant_ORM.png'), [TEX, TEX], 88))),
  ranger: doc.createMaterial('cloth_ranger').setDoubleSided(true).setMetallicFactor(1).setRoughnessFactor(1)
    .setBaseColorTexture(await tex('ranger_c', () => jpeg(T(P.tex + '/Ranger/T_Ranger_3_BaseColor.png'), [TEX, TEX], 88)))
    .setNormalTexture(await tex('ranger_n', () => jpeg(T(P.tex + '/Ranger/T_Ranger_Normal.png'), [TEX, TEX], 90)))
    .setMetallicRoughnessTexture(await tex('ranger_orm', () => jpeg(T(P.tex + '/Ranger/T_Ranger_ORM.png'), [TEX, TEX], 88))),
  folk: doc.createMaterial('folk').setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(0.92)
    .setBaseColorTexture(await tex('folk_c', () => png(folkTex.rgba, null, { raw: { width: folkTex.S, height: folkTex.S, channels: 4 } }), 'image/png'))
    .setNormalTexture(await tex('folk_n', () => jpeg(folkTex.nrm, null, 90, { raw: { width: folkTex.S, height: folkTex.S, channels: 3 } }))),
  skinM: doc.createMaterial('skin_m').setDoubleSided(false).setMetallicFactor(0).setRoughnessFactor(1)
    .setBaseColorTexture(await tex('skin_m_c', () => jpeg(T(P.tex + '/Base/T_Regular_Male_Dark_BaseColor.png'), [TEX, TEX], 90)))
    .setNormalTexture(await tex('skin_m_n', () => jpeg(T(P.tex + '/Base/T_Regular_Male_Normal.png'), [TEX, TEX], 90)))
    .setMetallicRoughnessTexture(await tex('skin_m_r', () => roughToMR(T(P.tex + '/Base/T_Regular_Male_Roughness.png'), 512, 0.9, 0.08))),
  skinF: doc.createMaterial('skin_f').setDoubleSided(false).setMetallicFactor(0).setRoughnessFactor(1)
    .setBaseColorTexture(await tex('skin_f_c', () => jpeg(T(P.tex + '/Base/T_Regular_Female_Dark_BaseColor.png'), [TEX, TEX], 90)))
    .setNormalTexture(await tex('skin_f_n', () => jpeg(T(P.tex + '/Base/T_Regular_Female_Normal.png'), [TEX, TEX], 90)))
    .setMetallicRoughnessTexture(await tex('skin_f_r', () => roughToMR(T(P.tex + '/Base/T_Regular_Female_Roughness.png'), 512, 0.9, 0.08))),
  eyes: doc.createMaterial('eyes').setMetallicFactor(0).setRoughnessFactor(0.25)
    .setBaseColorTexture(await tex('eyes_c', () => jpeg(T(P.base + '/T_Eye_Brown.png'), [256, 256], 90))),
  hair: doc.createMaterial('hair').setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(0.6)
    .setBaseColorTexture(await tex('hair_c', async () => jpeg(await sideBySide(T(P.hair + '/T_Hair_1_BaseColor.png'), T(P.hair + '/T_Hair_2_BaseColor.png'), 512), null, 88)))
    .setNormalTexture(await tex('hair_n', async () => jpeg(await sideBySide(T(P.hair + '/T_Hair_1_Normal.png'), T(P.hair + '/T_Hair_2_Normal.png'), 512), null, 90))),
};
// средна яркост на оригиналната текстура под всеки етикет (за пребоядисването в играта)
function garmentRef(tex, p) {
  const by = new Map();
  for (let t = 0; t < p.idx.length / 3; t++) { const g = p.gar[p.idx[t * 3]]; if (!by.has(g)) by.set(g, []); by.get(g).push(t); }
  const ref = new Array(20).fill(0.5);
  for (const [g, list] of by) ref[g] = +lum(avgColor(tex, p, list)).toFixed(4);
  return ref;
}
mats.peasant.setExtras({ garmentRef: (() => { const r = garmentRef(texPeasant, merge([bodies.M.cloth, bodies.F.cloth])); return r; })() });
mats.ranger.setExtras({ garmentRef: garmentRef(texRanger, bodies.H.cloth) });
{
  const atlas = await sideBySide(T(P.hair + '/T_Hair_1_BaseColor.png'), T(P.hair + '/T_Hair_2_BaseColor.png'), 256);
  const { data, info } = await sharp(atlas).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  mats.hair.setExtras({ garmentRef: garmentRef({ data, w: info.width, h: info.height }, hairAll) });
}
{
  const fl = { data: Buffer.alloc(512 * 512 * 3), w: 512, h: 512 };
  const r = folkTex.rgba;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const o = ((y * 2) * folkTex.S + x * 2) * 4; fl.data.set([r[o], r[o + 1], r[o + 2]], (y * 512 + x) * 3); }
  // вълната/сукното са сиви: еталонът е яркостта на тъканта (само пикселите с A = 255)
  let s = 0, n = 0;
  for (let i = 0; i < folkTex.S * folkTex.S; i++) if (r[i * 4 + 3] === 255) { s += srgb2lin(r[i * 4] / 255); n++; }
  mats.folk.setExtras({ garmentRef: new Array(20).fill(+(s / n).toFixed(4)) });
}

function accessor(type, arr, normalized = false) { return doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer).setNormalized(normalized); }
function primitive(p, mat, rigid = false) {
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', accessor('VEC3', p.pos))
    .setAttribute('NORMAL', accessor('VEC3', p.nrm))
    .setAttribute('TEXCOORD_0', accessor('VEC2', p.uv))
    .setIndices(accessor('SCALAR', p.n < 65536 ? new Uint16Array(p.idx) : p.idx));
  if (!rigid) {
    prim.setAttribute('JOINTS_0', accessor('VEC4', new Uint8Array(p.jn)));
    prim.setAttribute('WEIGHTS_0', accessor('VEC4', p.wt));
  }
  prim.setAttribute('_GARMENT', accessor('SCALAR', new Uint8Array(p.gar)));
  return prim;
}
/** Скелет: копие на възлите на източника (имена, покой, йерархия) + skin. */
function buildArmature(name, sk, meshes) {
  const arm = doc.createNode(name);
  const map = new Map();
  const copy = (n) => {
    const c = doc.createNode(n.getName()).setTranslation(n.getTranslation()).setRotation(n.getRotation()).setScale(n.getScale());
    map.set(n, c);
    for (const ch of n.listChildren()) if (sk.joints.includes(ch)) c.addChild(copy(ch));
    return c;
  };
  const rootJoint = sk.joints.find((j) => !sk.joints.includes(j.getParentNode()));
  arm.addChild(copy(rootJoint));
  const skin = doc.createSkin(name + '_skin').setSkeleton(map.get(rootJoint));
  for (const j of sk.joints) skin.addJoint(map.get(j));
  const ibm = new Float32Array(sk.joints.length * 16);
  sk.ibm.forEach((m, i) => ibm.set(m.elements, i * 16));
  skin.setInverseBindMatrices(accessor('MAT4', ibm));
  for (const [mname, p, mat] of meshes) {
    if (!p || !p.n) continue;
    const mesh = doc.createMesh(name + '_' + mname).addPrimitive(primitive(p, mat));
    arm.addChild(doc.createNode(name + '_' + mname).setMesh(mesh).setSkin(skin));
    console.log(`  ${name}_${mname}: ${p.idx.length / 3} тр., ${p.n} в.`);
  }
  scene.addChild(arm);
}
buildArmature('M', bodies.M.sk, [['cloth', bodies.M.cloth, mats.peasant], ['folk', bodies.M.folk, mats.folk], ['skin', bodies.M.skin, mats.skinM], ['eyes', bodies.M.eyes, mats.eyes]]);
buildArmature('F', bodies.F.sk, [['cloth', bodies.F.cloth, mats.peasant], ['folk', bodies.F.folk, mats.folk], ['skin', bodies.F.skin, mats.skinF], ['eyes', bodies.F.eyes, mats.eyes]]);
buildArmature('H', bodies.H.sk, [['cloth', bodies.H.cloth, mats.ranger], ['skin', bodies.H.skin, mats.skinM], ['eyes', bodies.H.eyes, mats.eyes]]);
scene.addChild(doc.createNode('HAIR').setMesh(doc.createMesh('HAIR').addPrimitive(primitive(hairAll, mats.hair, true))));
doc.getRoot().setExtras({ hairPieces: HAIR_PIECES, garments: G });

fs.mkdirSync(OUT, { recursive: true });
async function save(d, file) {
  await d.transform(prune({ keepAttributes: true, keepExtras: true }), dedup());
  if (COMPRESS) await d.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeNormal: 10, quantizeTexcoord: 12, quantizePosition: 14 }));
  const buf = await io.writeBinary(d);
  fs.writeFileSync(file, buf);
  console.log(`→ ${path.relative(ROOT, file)} ${(buf.length / 1e6).toFixed(2)} MB`);
}
await save(doc, path.join(OUT, 'people.glb'));

// ───────────────────────────── анимации ─────────────────────────────
// Само нужните клипове; само завъртания (+ отместването на таза). Скоростта на ходене/тичане е от варианта с root motion.
export const CLIPS = [
  'Idle_Loop', 'Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Idle_Talking_Loop', 'Sword_Attack', 'Sword_Idle',
  'Punch_Cross', 'Hit_Chest', 'Hit_Head', 'Death01', 'Dance_Loop', 'Fixing_Kneeling', 'Push_Loop', 'Interact', 'PickUp_Table',
  'Idle_Torch_Loop', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Spell_Simple_Shoot',
  'Spell_Simple_Enter', 'Spell_Simple_Idle_Loop', 'Pistol_Shoot', 'Crouch_Idle_Loop',
];
{
  const ad = await io.read(path.join(SRC, P.anims, 'UAL1_Standard.glb'));
  const rm = await io.read(path.join(SRC, P.anims, 'UAL1_Standard_RM.glb'));
  const speeds = {};
  for (const a of rm.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) {
      if (ch.getTargetNode().getName() !== 'root' || ch.getTargetPath() !== 'translation') continue;
      const s = ch.getSampler(), o = s.getOutput(), c = o.getCount();
      const a0 = o.getElement(0, []), a1 = o.getElement(c - 1, []), dur = s.getInput().getMax([])[0];
      const d = Math.hypot(a1[0] - a0[0], a1[2] - a0[2]);
      if (d > 0.05) speeds[a.getName()] = +(d / dur).toFixed(3);
    }
  }
  for (const a of ad.getRoot().listAnimations()) {
    if (!CLIPS.includes(a.getName())) { a.dispose(); continue; }
    for (const ch of a.listChannels()) {
      const path_ = ch.getTargetPath(), name = ch.getTargetNode()?.getName();
      const keep = path_ === 'rotation' || (path_ === 'translation' && name === 'pelvis');
      if (!keep) { const s = ch.getSampler(); ch.dispose(); s.dispose(); }
    }
  }
  // махаме меша на манекена — остава само скелетът (имената на костите)
  for (const n of ad.getRoot().listNodes()) if (n.getMesh()) { n.getMesh().dispose(); n.dispose(); }
  for (const s of ad.getRoot().listSkins()) s.dispose();
  const pelvis = ad.getRoot().listNodes().find((n) => n.getName() === 'pelvis');
  ad.getRoot().setExtras({ speeds, pelvisHeight: pelvis.getTranslation()[2] });
  await ad.transform(resample({ tolerance: 1e-4 }));
  console.log('  скорости (м/с):', JSON.stringify(speeds));
  await save(ad, path.join(OUT, 'anims.glb'));
}
console.log('Готово.');
