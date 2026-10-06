// Поглед от няколко места (истинската видеокарта): героят застава на (x, z) с посока heading в даден час,
// камерата се успокоява и се снима (960×540) — за проверка дали героят и враговете се виждат в гъстата гора.
//   node tools/perf/look.mjs [набор|JSON] [папка]
//   набор: forest (по подразбиране) — 10 места в Тъмната гора по здрач и нощем, с двама таласъми.
//   JSON: [{"x":-126,"z":-26,"h":0.6,"hour":21.5,"tal":true,"js":"…"}]
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';

const PORT = +(process.env.SHOT_PORT || 4193);
const arg = process.argv[2] || 'forest';
const OUT = path.resolve(process.argv[3] || 'test/tmp/look');
const W = +(process.env.LOOK_W || 960), H = +(process.env.LOOK_H || 540);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// детерминирани места в гората (център -150,-60, радиус 100)
function forestSet() {
  const v = [{ x: -126, z: -26, h: Math.atan2(-24, -34), hour: 21.5, tal: true }];
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 11; i++) {
    const a = rnd() * Math.PI * 2, r = 15 + rnd() * 70;
    v.push({ x: -150 + Math.cos(a) * r, z: -60 + Math.sin(a) * r, h: rnd() * Math.PI * 2, hour: i % 3 === 0 ? 12 : i % 3 === 1 ? 19.8 : 22, tal: i % 2 === 0, pitch: i % 4 === 1 ? 0.05 : undefined });
  }
  return v;
}
const views = arg === 'forest' ? forestSet() : JSON.parse(arg);

const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore', shell: true });
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 120; i++) { try { const r = await fetch(base); if (r.ok) break; } catch { /* */ } await sleep(250); }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force_high_performance_gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' && !/11434|favicon|ERR_CONNECTION/.test(m.text())) console.log('ERR', m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('balkanski-legendi:settings', JSON.stringify({ graphics: { quality: 'high' } })); } catch { /* */ } });
  await page.goto(`${base}?shot=forest`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady, null, { timeout: 90000, polling: 200 });
  fs.mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    await page.evaluate((v) => {
      const g = window.game;
      g.sim.state.time = Math.floor(g.sim.state.time / 1440) * 1440 + Math.round(v.hour * 60);
      g.rpg.teleport(v.x, v.z, v.h);
      if (v.pitch !== undefined) g.rpg.cam.pitch = v.pitch;
      g.rpg.debug.heal();
      if (v.tal) { g.rpg.debug.spawnTalasam(4); g.rpg.debug.spawnTalasam(7); }
      if (v.js) (0, eval)(v.js);
    }, v);
    await sleep(1600);
    const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
    if (process.env.LOOK_INFO) console.log(await page.evaluate(process.env.LOOK_INFO).catch((e) => String(e)));
    const file = path.join(OUT, `look${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(`${file}  x=${v.x.toFixed(1)} z=${v.z.toFixed(1)} h=${v.h.toFixed(2)} ${v.hour}ч  ${fps} к/с`);
    await page.evaluate(() => { const g = window.game; g.rpg.debug.clearEnemies?.(); });
  }
} finally {
  await browser.close().catch(() => {});
  try { spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); } catch { /* */ }
  server.kill();
}
process.exit(0);
