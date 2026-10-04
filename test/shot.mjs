// Робот за снимки на играта (фаза 8) и бърза проба за грешки.
//
//   npm run build && npm run shot                 — всички снимки → docs/screenshots/<име>.png
//   npm run shot -- village-day lamia-fight       — само избраните (по име или част от името)
//   npm run shot -- --check                       — само зарежда играта и гърми при грешки в конзолата (smoke test)
//   npm run shot -- --list                        — списък на сцените
//
// Сам НЕ сглобява играта: пуска `vite preview` на порт 4180 върху готовия dist/ (или ползва SHOT_URL=http://…).
// Други настройки: CHROME_PATH (Chromium), SHOT_OUT (папка), SHOT_W/SHOT_H (1920×1080), SHOT_TIMEOUT (ms, 90000), HEADED=1.
//
// Договор с играта:
//   window.__ready = true          — играта е заредена (менюто/светът се вижда);
//   window.__shotReady = true      — при ?shot=<сцена>: сцената е подредена (камера, час, хора, прозорци) и може да се снима;
//   window.__info                  — по желание: каквото играта иска да покаже в отчета (fps, брой жители…).
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.SHOT_OUT || 'docs/screenshots');
const W = +(process.env.SHOT_W || 1920), H = +(process.env.SHOT_H || 1080);
const TIMEOUT = +(process.env.SHOT_TIMEOUT || 90000);
const PORT = 4180;
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

/**
 * Сцените. url е относителен към адреса на играта. keys — клавиши след зареждането (по ред), напр. 'KeyJ' или
 * { key: 'KeyW', holdMs: 800 }; evalJs — JS преди снимката; waitMs — колко да чака след готовността.
 */
const SCENARIOS = [
  { name: 'title', url: '?shot=title', waitMs: 1500, title: 'Начален екран' },
  { name: 'village-day', url: '?shot=village-day', waitMs: 2500, title: 'Самодивско денем' },
  { name: 'village-sunset', url: '?shot=village-sunset', waitMs: 2500, title: 'Залез над селото' },
  { name: 'village-night', url: '?shot=village-night', waitMs: 2500, title: 'Селото нощем' },
  { name: 'square-gossip', url: '?shot=square-gossip', waitMs: 3000, title: 'Клюки на мегдана' },
  { name: 'dialogue', url: '?shot=dialogue', waitMs: 2500, title: 'Разговор с жител' },
  { name: 'forest', url: '?shot=forest', waitMs: 2500, title: 'Тъмната гора' },
  { name: 'talasam-fight', url: '?shot=talasam-fight', waitMs: 2500, title: 'Бой с таласъми' },
  { name: 'samodivi', url: '?shot=samodivi', waitMs: 3000, title: 'Поляната на самодивите' },
  { name: 'lamia-fight', url: '?shot=lamia-fight', waitMs: 3000, title: 'Ламята на Ламин връх' },
  { name: 'sabor', url: '?shot=sabor', waitMs: 3000, title: 'Сборът след победата' },
  { name: 'map', url: '?shot=map', waitMs: 1500, title: 'Картата на света' },
  { name: 'inventory', url: '?shot=inventory', waitMs: 1500, title: 'Герой и раница' },
  { name: 'chronicle', url: '?shot=chronicle', waitMs: 1500, title: 'Летописът' },
  { name: 'time-machine', url: '?shot=time-machine', waitMs: 1500, title: 'Машината на времето' },
  { name: 'while-away', url: '?shot=while-away', waitMs: 1500, title: '„Докато те нямаше…“' },
  { name: 'live', url: '?shot=live', waitMs: 2500, title: 'Лайв режим — гласуване' },
];

// Очаквани „грешки“, които не са бъгове: няма Ollama на 127.0.0.1:11434, няма връзка с Twitch, иконка за любими.
const IGNORE = [/11434/, /irc-ws\.chat\.twitch\.tv/, /favicon\.ico/, /ERR_CONNECTION_REFUSED/, /GPU stall due to ReadPixels/];
const ignored = (s) => IGNORE.some((r) => r.test(s));

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const LIST = args.includes('--list');
const wanted = args.filter((a) => !a.startsWith('--'));

if (LIST) {
  for (const s of SCENARIOS) console.log(`${s.name.padEnd(16)} ${s.title}  (${s.url})`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* още не е тръгнал */ }
    await sleep(250);
  }
  return false;
}

let server = null;
async function startServer() {
  if (process.env.SHOT_URL) return process.env.SHOT_URL.replace(/\/?$/, '/');
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
    console.error('Няма dist/ — първо пусни „npm run build“ (или подай SHOT_URL=http://…).');
    process.exit(2);
  }
  const base = `http://127.0.0.1:${PORT}/`;
  server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  if (!(await waitHttp(base, 30000))) {
    console.error('vite preview не тръгна на порт ' + PORT + ':\n' + log);
    stopServer();
    process.exit(2);
  }
  return base;
}
function stopServer() {
  if (server && !server.killed) { try { server.kill(); } catch { /* */ } }
  server = null;
}
process.on('exit', stopServer);
process.on('SIGINT', () => { stopServer(); process.exit(130); });

function attachLogs(page, sink) {
  // „Failed to load resource“ се хваща по-долу заедно с адреса (response/requestfailed)
  page.on('console', (m) => { if (m.type() === 'error' && !ignored(m.text()) && !/^Failed to load resource/.test(m.text())) sink.push('конзола: ' + m.text()); });
  page.on('pageerror', (e) => sink.push('грешка: ' + (e.stack || e.message)));
  page.on('requestfailed', (r) => { const u = r.url(); if (!ignored(u)) sink.push(`неуспешна заявка: ${u} (${r.failure()?.errorText ?? ''})`); });
  page.on('response', (r) => { if (r.status() >= 400 && !ignored(r.url())) sink.push(`HTTP ${r.status()}: ${r.url()}`); });
}

/** Чака window[flag]; връща true/false (без да хвърля). */
async function waitFlag(page, flag, ms) {
  try {
    await page.waitForFunction((f) => !!window[f], flag, { timeout: ms, polling: 200 });
    return true;
  } catch { return false; }
}

/**
 * Чака сцената: window.__shotReady (при ?shot=) или window.__ready. Ако играта е готова (__ready),
 * но __shotReady не дойде до GRACE ms — сцената явно не е направена в играта; снимаме каквото има.
 */
const GRACE = +(process.env.SHOT_GRACE || 20000);
async function waitScene(page, hasShot) {
  const end = Date.now() + TIMEOUT;
  let readyAt = 0;
  while (Date.now() < end) {
    const f = await page.evaluate(() => ({ r: !!window.__ready, s: !!window.__shotReady })).catch(() => ({ r: false, s: false }));
    if (hasShot ? f.s : f.r) return 'ok';
    if (f.r && !readyAt) readyAt = Date.now();
    if (hasShot && readyAt && Date.now() - readyAt > GRACE) return 'играта е готова, но сцената не даде __shotReady';
    await sleep(250);
  }
  return readyAt ? 'сцената не даде __shotReady' : 'без сигнал за готовност (__ready)';
}

async function pressKeys(page, keys = []) {
  for (const k of keys) {
    if (typeof k === 'string') await page.keyboard.press(k);
    else {
      await page.keyboard.down(k.key);
      await sleep(k.holdMs ?? 100);
      await page.keyboard.up(k.key);
    }
    await sleep(250);
  }
}

const base = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: CHROME, headless: !process.env.HEADED, args: GL_ARGS });
} catch (e) {
  console.error('Chromium не тръгна (' + CHROME + '). Подай CHROME_PATH=…\n' + e.message);
  stopServer();
  process.exit(2);
}

let exitCode = 0;
try {
  if (CHECK) {
    // ---- бърза проба: зарежда играта, чака, събира грешките ----
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    attachLogs(page, errors);
    const t0 = Date.now();
    await page.goto(base, { waitUntil: 'load', timeout: TIMEOUT });
    const ready = await waitFlag(page, '__ready', Math.min(TIMEOUT, 60000));
    await sleep(+(process.env.WAIT || 4000));
    const info = await page.evaluate(() => window.__info ?? null).catch(() => null);
    console.log(`Проба: ${base} — ${ready ? 'играта е готова' : 'window.__ready не се появи'} за ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (info) console.log('Информация: ' + JSON.stringify(info));
    if (!ready && process.env.SHOT_REQUIRE_READY) errors.push('window.__ready не се появи');
    if (errors.length) {
      console.log(`ГРЕШКИ (${errors.length}):\n  ` + errors.slice(0, 30).join('\n  '));
      exitCode = 1;
    } else console.log('Без грешки в конзолата. ✔');
  } else {
    // ---- снимки ----
    const list = wanted.length ? SCENARIOS.filter((s) => wanted.some((w) => s.name.includes(w))) : SCENARIOS;
    if (!list.length) { console.error('Няма такава сцена. Виж: npm run shot -- --list'); exitCode = 2; }
    fs.mkdirSync(OUT, { recursive: true });
    const summary = [];
    for (const s of list) {
      const t0 = Date.now();
      const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const errors = [];
      attachLogs(page, errors);
      let status = 'ok';
      let saved = false;
      try {
        await page.goto(new URL(s.url, base).href, { waitUntil: 'load', timeout: TIMEOUT });
        status = await waitScene(page, /[?&]shot=/.test(s.url));
        await pressKeys(page, s.keys);
        if (s.evalJs) await page.evaluate(s.evalJs);
        await sleep(s.waitMs ?? 2000);
        const file = path.join(OUT, s.name + '.png');
        await page.screenshot({ path: file, timeout: 60000 });
        saved = true;
      } catch (e) {
        status = 'ПРОВАЛ: ' + String(e.message || e).split('\n')[0];
        exitCode = 1;
      }
      if (errors.length) { status += `, ${errors.length} грешки в конзолата`; exitCode = exitCode || 1; }
      summary.push({ name: s.name, status, saved, sec: ((Date.now() - t0) / 1000).toFixed(1), errors });
      console.log(`${status === 'ok' ? '✔' : saved ? '!' : '✖'} ${s.name.padEnd(16)} ${status} (${summary.at(-1).sec} s)`);
      await page.close();
    }
    console.log('\nОбобщение:');
    for (const r of summary) {
      console.log(`  ${r.saved ? '✔' : '✖'} ${r.name.padEnd(16)} ${r.status}`);
      for (const e of r.errors.slice(0, 5)) console.log('      ' + e.split('\n')[0]);
    }
    const savedN = summary.filter((r) => r.saved).length;
    const okN = summary.filter((r) => r.status === 'ok').length;
    console.log(`\n${savedN}/${summary.length} снимки в ${path.relative(ROOT, OUT) || '.'}/ (${okN} с готова сцена)`);
  }
} finally {
  await browser.close().catch(() => {});
  stopServer();
}
process.exit(exitCode);
