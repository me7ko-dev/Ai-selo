// Мерене на видеокартата/процесора по части (истинската видеокарта): node tools/perf/gputime.mjs <сцена> [low|medium|high] [js преди мерката]
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
  const g = window.game; const r = g.engine.renderer; const gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) { resolve('нет EXT_disjoint_timer_query_webgl2'); return; }
  const sums = {}; const counts = {}; const pending = [];
  let active = null;
  const begin = (name) => { if (active) return false; const qq = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qq); active = { name, qq }; return true; };
  const end = () => { if (!active) return; gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); active = null; };
  const wrap = (obj, fn, name) => { const o = obj[fn].bind(obj); obj[fn] = (...a) => { const b = begin(name); const res = o(...a); if (b) end(); return res; }; };
  wrap(r.shadowMap, 'render', 'shadows');
  const passes = g.engine.post.composer.passes;
  passes.forEach((p, i) => wrap(p, 'render', (p.name || p.constructor.name) + '#' + i));
  const sky = g.world.sky;
  wrap(sky, 'update', 'sky.update');
  // whole frame
  const ep = g.engine.post; const pr = ep.render.bind(ep);
  let frames = 0;
  const t0 = performance.now();
  const poll = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (gl.getQueryParameter(p.qq, gl.QUERY_RESULT_AVAILABLE)) {
        const ns = gl.getQueryParameter(p.qq, gl.QUERY_RESULT);
        sums[p.name] = (sums[p.name] || 0) + ns / 1e6; counts[p.name] = (counts[p.name] || 0) + 1;
        gl.deleteQuery(p.qq); pending.splice(i, 1);
      }
    }
    frames++;
    if (performance.now() - t0 < 4000) requestAnimationFrame(poll);
    else resolve(Object.keys(sums).map((k) => `${k}: ${(sums[k] / counts[k]).toFixed(2)} ms (n=${counts[k]})`).join('\n') + `\nкадри: ${(frames / 4).toFixed(0)}/s`);
  };
  requestAnimationFrame(poll);
}));
console.log(`== ${shot} ${q}\n${out}`);
await browser.close();
server.kill(); try { spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); } catch { }
process.exit(0);
