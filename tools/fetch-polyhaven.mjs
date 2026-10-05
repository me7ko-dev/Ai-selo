// Сваля CC0 текстури и HDRI небета от Poly Haven (https://polyhaven.com, лиценз CC0) в public/assets/.
//
//   node tools/fetch-polyhaven.mjs forrest_ground_01                 — текстура 1k: diff, nor_gl, arm
//   node tools/fetch-polyhaven.mjs rock_face --res 2k --maps diff,nor_gl,arm,disp
//   node tools/fetch-polyhaven.mjs --hdri kloofendal_48d_partly_cloudy --res 1k
//
// Текстура → public/assets/tex/<id>/<id>_<map>_<res>.jpg   (map: diff | nor_gl | arm | rough | ao | disp)
// HDRI     → public/assets/hdri/<id>_<res>.hdr
// Всеки свален ресурс се дописва в public/assets/CREDITS.md (името и линк към източника).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets');
const KEY = { diff: 'Diffuse', nor_gl: 'nor_gl', arm: 'arm', rough: 'Rough', ao: 'AO', disp: 'Displacement' };

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const hdri = args.includes('--hdri');
const res = opt('res', '1k');
const maps = opt('maps', 'diff,nor_gl,arm').split(',').map((s) => s.trim()).filter(Boolean);
const ids = args.filter((a, i) => !a.startsWith('--') && !['--res', '--maps'].includes(args[i - 1]));
if (!ids.length) { console.error('Подай id от polyhaven.com, напр. forrest_ground_01'); process.exit(2); }

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r;
}

function credit(id, kind) {
  const f = path.join(OUT, 'CREDITS.md');
  const line = `- ${kind} „${id}“ — Poly Haven, CC0 — https://polyhaven.com/a/${id}\n`;
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# Ресурси в public/assets (всички са със свободен лиценз)\n\n';
  if (!cur.includes(`„${id}“`)) fs.writeFileSync(f, cur + line);
}

for (const id of ids) {
  const files = await (await get(`https://api.polyhaven.com/files/${id}`)).json();
  if (hdri) {
    const f = files.hdri?.[res]?.hdr;
    if (!f) { console.error(`${id}: няма HDRI ${res}`); process.exitCode = 1; continue; }
    const dst = path.join(OUT, 'hdri', `${id}_${res}.hdr`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, Buffer.from(await (await get(f.url)).arrayBuffer()));
    console.log(`✔ ${path.relative(ROOT, dst)} (${(f.size / 1e6).toFixed(1)} MB)`);
    credit(id, 'HDRI');
    continue;
  }
  for (const m of maps) {
    const f = files[KEY[m] ?? m]?.[res]?.jpg ?? files[KEY[m] ?? m]?.[res]?.png;
    if (!f) { console.error(`${id}: няма ${m} ${res}`); process.exitCode = 1; continue; }
    const ext = path.extname(f.url);
    const dst = path.join(OUT, 'tex', id, `${id}_${m}_${res}${ext}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, Buffer.from(await (await get(f.url)).arrayBuffer()));
    console.log(`✔ ${path.relative(ROOT, dst)} (${(f.size / 1e6).toFixed(2)} MB)`);
  }
  credit(id, 'Текстура');
}
