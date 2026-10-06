// Ритъм на кадрите (истинската видеокарта): средно, медиана, 95/99 %, най-дълъг кадър, нови шейдърни програми.
//   node tools/perf/pace.mjs <сцена> [low|medium|high] [секунди] [js преди мерката] [js всеки кадър (dt, t)]
// Пример — ходене напред през гората:  node tools/perf/pace.mjs forest high 8 "" "game.rpg.debug.walk?.(dt)"
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = +(process.env.SHOT_PORT || 4193);
const shot = process.argv[2] || 'village-day';
const q = process.argv[3] || 'high';
const secs = +(process.argv[4] || 6);
const extra = process.argv[5] || '';
const perFrame = process.argv[6] || '';
const W = +(process.env.PACE_W || 1920), H = +(process.env.PACE_H || 1080);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore', shell: true });
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 120; i++) { try { const r = await fetch(base); if (r.ok) break; } catch { /* */ } await sleep(250); }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force_high_performance_gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' && !/11434|favicon|ERR_CONNECTION/.test(m.text())) console.log('ERR', m.text().slice(0, 300)); });
  await page.addInitScript((q) => { try { localStorage.setItem('balkanski-legendi:settings', JSON.stringify({ graphics: { quality: q } })); } catch { /* */ } }, q);
  await page.goto(`${base}?shot=${shot}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady, null, { timeout: 90000, polling: 200 });
  if (extra) await page.evaluate(extra);
  await sleep(+(process.env.PACE_WAIT || 1500));
  const out = await page.evaluate(([secs, perFrame]) => new Promise((resolve) => {
    const g = window.game; const r = g.engine.renderer;
    const p0 = r.info.programs.length;
    const f = perFrame ? new Function('dt', 't', 'game', perFrame) : null;
    const dts = []; let last = performance.now(); const t0 = last;
    const loop = () => {
      const now = performance.now(); const dt = now - last; last = now; dts.push(dt);
      if (f) f(dt / 1000, (now - t0) / 1000, g);
      if (now - t0 < secs * 1000) requestAnimationFrame(loop);
      else {
        dts.shift();
        const s = dts.slice().sort((a, b) => a - b), n = s.length, pc = (k) => s[Math.min(n - 1, Math.floor(n * k))];
        const big = dts.map((d, i) => [d, i]).filter(([d]) => d > 33).map(([d, i]) => `${i}:${d.toFixed(0)}`).slice(0, 12).join(' ');
        resolve(`кадри/с ${(n / (secs)).toFixed(1)}  медиана ${pc(0.5).toFixed(1)} ms  95% ${pc(0.95).toFixed(1)}  99% ${pc(0.99).toFixed(1)}  макс ${s[n - 1].toFixed(0)}  >33ms: ${dts.filter((d) => d > 33).length}  нови програми: ${r.info.programs.length - p0} (общо ${r.info.programs.length})  вызовы ${r.info.render.calls}  △ ${(r.info.render.triangles / 1e6).toFixed(2)}M${big ? '\n  дълги: ' + big : ''}`);
      }
    };
    requestAnimationFrame(loop);
  }), [secs, perFrame]);
  console.log(`== ${shot} ${q}: ${out}`);
} finally {
  await browser.close().catch(() => {});
  try { spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); } catch { /* */ }
  server.kill();
}
process.exit(0);
