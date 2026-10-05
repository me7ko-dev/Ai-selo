// Мерене на видеокартата/процесора по части (истинската видеокарта): node tools/perf/cputime.mjs <сцена> [low|medium|high] [js преди мерката]
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = +(process.env.SHOT_PORT || 4183);
const shot = process.argv[2] || 'village-day';
const q = process.argv[3] || 'high';
const extra = process.argv[4] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore', shell: true });
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 120; i++) { try { const r = await fetch(base); if (r.ok) break; } catch { } await sleep(250); }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force_high_performance_gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text()); });
await page.goto(`${base}?shot=${shot}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady, null, { timeout: 90000, polling: 200 });
await page.evaluate((q) => { const g = window.game; g.world.setQuality(q); }, q);
if (extra) await page.evaluate(extra);
await sleep(1500);
const out = await page.evaluate(() => new Promise((resolve) => {
  const g = window.game; const e = g.engine; const sums = {}; const cnt = {};
  const T = (name, f) => function (...a) { const t = performance.now(); const r = f.apply(this, a); const d = performance.now() - t; sums[name] = (sums[name] || 0) + d; cnt[name] = (cnt[name] || 0) + 1; return r; };
  e.updaters = e.updaters.map((f, i) => T('upd#' + i + ' ' + f.toString().slice(0, 50).replace(/s+/g, ' '), f));
  e.lateUpdaters = e.lateUpdaters.map((f, i) => T('late#' + i + ' ' + f.toString().slice(0, 50).replace(/s+/g, ' '), f));
  e.post.render = T('post.render (CPU)', e.post.render.bind(e.post));
  const sc = e.scene; if (sc.onBeforeRender) sc.onBeforeRender = T('scene.onBeforeRender', sc.onBeforeRender);
  const sm = e.renderer.shadowMap; sm.render = T('shadowMap.render (CPU)', sm.render.bind(sm));
  let frames = 0; const t0 = performance.now();
  const loop = () => { frames++; if (performance.now() - t0 < 4000) requestAnimationFrame(loop); else resolve('вызовы: ' + e.renderer.info.render.calls + ' триъгълници: ' + e.renderer.info.render.triangles + ' програми: ' + e.renderer.info.programs.length + String.fromCharCode(10) + Object.keys(sums).map((k) => [sums[k] / frames, k]).sort((a, b) => b[0] - a[0]).slice(0, 14).map(([v, k]) => v.toFixed(2) + ' ms  ' + k).join(String.fromCharCode(10)) + String.fromCharCode(10) + 'кадри: ' + (frames / 4).toFixed(0)); };
  requestAnimationFrame(loop);
}));
console.log(`== ${shot} ${q}\n${out}`);
await browser.close();
server.kill(); try { spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); } catch { }
process.exit(0);
