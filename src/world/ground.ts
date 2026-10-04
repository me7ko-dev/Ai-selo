// „Рисуваната“ земя: голяма текстура върху целия терен (трева, пътища, коритото, мегданът, нивите…)
// + маска къде расте трева + картата отгоре (за мини-картата и пергамента).
import { PLACES, RIVER_HALF_WIDTH, RIVER_PATH, VILLAGE_CENTER, WORLD_HALF } from '../data/layout';
import { fbm, riverInfo, terrainHeight, BRIDGE } from './height';
import { forestMask, roadDist, ROAD_SEGS, roadHalfWidth, smoothstep, GLADE, POND, PLATEAU, FORT, SWAMP, PEAK, type WorldPlan } from './plan';
import { PAL } from './palette';
import { Rng } from '../core/rng';

export const BASE_N = 512;      // мрежа за основните цветове и маските (≈1.17 м)
export const GROUND_PX = 2048;  // текстурата на земята (≈0.29 м на пиксел)

const hex = (s: string): [number, number, number] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface GroundData {
  canvas: HTMLCanvasElement;
  /** 0..255 колко трева да има (BASE_N × BASE_N, ред 0 = север) */
  grass: Uint8Array;
  /** 0..255 сянка от релефа за картата */
  shade: Uint8Array;
  /** основният цвят на земята (RGBA, BASE_N × BASE_N) — за оттенъка на тревата */
  base: Uint8ClampedArray;
}

export function worldToPx(x: number, z: number, size: number): [number, number] {
  return [((x + WORLD_HALF) / (WORLD_HALF * 2)) * size, ((z + WORLD_HALF) / (WORLD_HALF * 2)) * size];
}

export function paintGround(plan: WorldPlan): GroundData {
  const N = BASE_N, cell = (WORLD_HALF * 2) / N;
  const base = document.createElement('canvas'); base.width = base.height = N;
  const bctx = base.getContext('2d')!;
  const img = bctx.createImageData(N, N);
  const grass = new Uint8Array(N * N), shade = new Uint8Array(N * N);
  const G1 = hex(PAL.grass), G2 = hex(PAL.grass2), DRY = hex('#93a458'), LUSH = hex('#7cae52');
  const FF = hex('#3c4c2e'), NEEDLE = hex('#55492f'), ROCK = hex(PAL.rock), ROCKD = hex(PAL.rockDark), SNOWISH = hex('#b9b3a6');
  const SWMP = hex('#4f5a38'), SCORCH = hex('#4a423b'), SAND = hex(PAL.sand), VIL = hex('#86a052');
  const heights = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[j * (N + 1) + i] = terrainHeight(-WORLD_HALF + i * cell, -WORLD_HALF + j * cell);
  const hAt = (i: number, j: number) => heights[Math.min(N, Math.max(0, j)) * (N + 1) + Math.min(N, Math.max(0, i))];

  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -WORLD_HALF + (i + 0.5) * cell, z = -WORLD_HALF + (j + 0.5) * cell;
    const h = (hAt(i, j) + hAt(i + 1, j) + hAt(i, j + 1) + hAt(i + 1, j + 1)) / 4;
    const dx = (hAt(i + 1, j) + hAt(i + 1, j + 1) - hAt(i, j) - hAt(i, j + 1)) / (2 * cell);
    const dz = (hAt(i, j + 1) + hAt(i + 1, j + 1) - hAt(i, j) - hAt(i + 1, j)) / (2 * cell);
    const slope = Math.hypot(dx, dz);
    const n1 = fbm(x * 0.02, z * 0.02, 3), n2 = fbm(x * 0.09 + 5, z * 0.09 - 3, 2);
    let c = mix(G1, G2, smoothstep(0.35, 0.7, n1));
    c = mix(c, DRY, smoothstep(0.55, 0.8, n2) * 0.45);
    c = mix(c, LUSH, smoothstep(0.6, 0.85, fbm(x * 0.013 - 9, z * 0.013 + 4, 2)) * 0.4);
    const dv = Math.hypot(x - VILLAGE_CENTER.x, z - VILLAGE_CENTER.z);
    c = mix(c, VIL, (1 - smoothstep(50, 85, dv)) * 0.45);
    let g = 1;
    // гората
    const fm = forestMask(x, z);
    if (fm > 0) { c = mix(c, mix(FF, NEEDLE, smoothstep(0.4, 0.7, n2)), fm * 0.85); g *= 1 - fm * 0.7; }
    // поляната на самодивите — сочна и светла
    const dg = Math.hypot(x - GLADE.x, z - GLADE.z);
    c = mix(c, LUSH, (1 - smoothstep(24, 38, dg)) * 0.7);
    // блатото
    const ds = Math.hypot(x - SWAMP.x, z - SWAMP.z);
    if (ds < 80) { c = mix(c, SWMP, (1 - smoothstep(50, 80, ds)) * 0.85); }
    // скали: стръмно и високо
    const rockT = Math.max(smoothstep(0.55, 1.0, slope), smoothstep(34, 52, h) * 0.85);
    if (rockT > 0) { c = mix(c, mix(ROCK, ROCKD, n2), rockT); g *= 1 - rockT; }
    if (h > 62) c = mix(c, SNOWISH, smoothstep(62, 90, h) * 0.35);
    // платото на Ламята — опърлено
    const dp = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
    if (dp < 36) { const t = (1 - smoothstep(14, 34, dp)) * (0.7 + 0.3 * n2); c = mix(c, SCORCH, t); g *= 1 - t; }
    const dpk = Math.hypot(x - PEAK.x, z - PEAK.z);
    if (dpk < 70) { const t = (1 - smoothstep(20, 70, dpk)) * 0.5; c = mix(c, ROCKD, t); g *= 1 - t; }
    // хълмът на крепостта
    const df = Math.hypot(x - FORT.x, z - FORT.z);
    if (df < 24) c = mix(c, DRY, (1 - smoothstep(14, 24, df)) * 0.5);
    // коритото
    const rd = riverInfo(x, z).dist;
    if (rd < RIVER_HALF_WIDTH + 3) { const t = 1 - smoothstep(RIVER_HALF_WIDTH - 1, RIVER_HALF_WIDTH + 3, rd); c = mix(c, SAND, t); g *= 1 - t; }
    // пътища
    const rdd = roadDist(x, z), rhw = roadHalfWidth(x, z);
    if (rdd < rhw + 1.5) g *= smoothstep(rhw, rhw + 1.5, rdd);
    if (dv < 15) g *= smoothstep(11, 15, dv);
    if (Math.hypot(x - POND.x, z - POND.z) < 14) g = 0;
    if (Math.abs(x) > WORLD_HALF - 3 || Math.abs(z) > WORLD_HALF - 3) g = 0;
    const k = (j * N + i) * 4;
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    grass[j * N + i] = Math.round(Math.max(0, Math.min(1, g)) * 255);
    // сянка от релефа (светлина от северозапад)
    const lum = 0.5 + (-dx * 0.7 - dz * 0.7) * 0.9;
    shade[j * N + i] = Math.round(Math.max(0, Math.min(1, lum)) * 255);
  }
  // под сградите няма трева
  for (const f of plan.footprints) {
    const r = Math.hypot(f.w, f.d) / 2 + 1.5;
    const [ci, cj] = worldToPx(f.x, f.z, N);
    const rr = Math.ceil(r / cell);
    const cs = Math.cos(f.rot), sn = Math.sin(f.rot);
    for (let j = Math.floor(cj - rr); j <= cj + rr; j++) for (let i = Math.floor(ci - rr); i <= ci + rr; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const x = -WORLD_HALF + (i + 0.5) * cell - f.x, z = -WORLD_HALF + (j + 0.5) * cell - f.z;
      const lx = x * cs - z * sn, lz = x * sn + z * cs;
      if (Math.abs(lx) < f.w / 2 + 0.8 && Math.abs(lz) < f.d / 2 + 0.8) grass[j * N + i] = f.kind === 'fold' || f.kind === 'field' ? Math.min(grass[j * N + i], 60) : 0;
    }
  }
  bctx.putImageData(img, 0, 0);

  // ---- голямата текстура
  const S = GROUND_PX, sc = S / (WORLD_HALF * 2);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(base, 0, 0, S, S);
  const P = (x: number, z: number): [number, number] => [(x + WORLD_HALF) * sc, (z + WORLD_HALF) * sc];
  const rng = new Rng(77);

  // рисувана текстура: петънца светла/тъмна трева
  for (let k = 0; k < 45000; k++) {
    const px = rng.next() * S, py = rng.next() * S, r = 0.6 + rng.next() * 2.2;
    ctx.fillStyle = rng.next() < 0.5 ? 'rgba(255,255,220,0.06)' : 'rgba(20,40,10,0.08)';
    ctx.fillRect(px, py, r, r * (0.6 + rng.next()));
  }

  // коритото на Бистрица: пясък, по-тъмни брегове, пукнатини, камъчета
  const riverLine = (w: number, style: string) => {
    ctx.strokeStyle = style; ctx.lineWidth = w * sc; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); RIVER_PATH.forEach((p, i) => { const [a, b] = P(p.x, p.z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.stroke();
  };
  riverLine(RIVER_HALF_WIDTH * 2 + 4, 'rgba(140,118,84,0.35)');
  riverLine(RIVER_HALF_WIDTH * 2 + 1, 'rgba(184,160,120,0.85)');
  riverLine(RIVER_HALF_WIDTH * 1.3, 'rgba(206,188,148,0.9)');
  ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(110,88,60,0.55)';
  for (let k = 0; k < 2600; k++) {
    const t = rng.next(); const p = riverAt(t); const off = (rng.next() - 0.5) * RIVER_HALF_WIDTH * 2;
    let [a, b] = P(p.x + p.nx * off, p.z + p.nz * off);
    ctx.beginPath(); ctx.moveTo(a, b);
    for (let s = 0; s < 3; s++) { a += (rng.next() - 0.5) * 9; b += (rng.next() - 0.5) * 9; ctx.lineTo(a, b); }
    ctx.stroke();
  }
  for (let k = 0; k < 9000; k++) {
    const p = riverAt(rng.next()); const off = (rng.next() - 0.5) * RIVER_HALF_WIDTH * 2.3;
    const [a, b] = P(p.x + p.nx * off, p.z + p.nz * off);
    const v = 120 + Math.floor(rng.next() * 80);
    ctx.fillStyle = `rgba(${v},${v - 8},${v - 20},0.8)`;
    ctx.beginPath(); ctx.ellipse(a, b, 0.8 + rng.next() * 1.6, 0.6 + rng.next() * 1.2, rng.next() * 3, 0, Math.PI * 2); ctx.fill();
  }

  // пътища: мек ръб, утъпкана пръст, коловози
  const roadPass = (extra: number, style: string, width?: number) => {
    ctx.strokeStyle = style; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of ROAD_SEGS) {
      const hw = Math.min(roadHalfWidth(s[0], s[1]), roadHalfWidth(s[2], s[3]));
      ctx.lineWidth = (width ?? hw * 2 + extra) * sc;
      const [a, b] = P(s[0], s[1]), [c, d] = P(s[2], s[3]);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    }
  };
  roadPass(2.4, 'rgba(120,100,62,0.28)');
  roadPass(0.8, 'rgba(150,124,86,0.75)');
  roadPass(0, 'rgba(168,138,98,0.95)');
  // коловози
  ctx.strokeStyle = 'rgba(120,96,64,0.45)'; ctx.lineWidth = 0.32 * sc;
  for (const s of ROAD_SEGS) {
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]), nx = -(s[3] - s[1]) / len, nz = (s[2] - s[0]) / len;
    for (const o of [-0.65, 0.65]) {
      const [a, b] = P(s[0] + nx * o, s[1] + nz * o), [c, d] = P(s[2] + nx * o, s[3] + nz * o);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
    }
  }
  // мегданът: утъпкана пръст + калдъръм
  {
    const [a, b] = P(PLACES.square.pos.x, PLACES.square.pos.z);
    const gr = ctx.createRadialGradient(a, b, 6 * sc, a, b, 16 * sc);
    gr.addColorStop(0, 'rgba(170,144,104,1)'); gr.addColorStop(0.75, 'rgba(166,140,100,0.9)'); gr.addColorStop(1, 'rgba(166,140,100,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(a, b, 16 * sc, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 1700; k++) {
      const ang = rng.next() * Math.PI * 2, rr = Math.sqrt(rng.next()) * 11.5 * sc;
      if (rr < 3.4 * sc) continue;
      const v = 128 + Math.floor(rng.next() * 46);
      ctx.fillStyle = `rgba(${v + 14},${v - 2},${v - 26},0.75)`;
      ctx.beginPath(); ctx.ellipse(a + Math.cos(ang) * rr, b + Math.sin(ang) * rr, 0.9 + rng.next() * 0.7, 0.7 + rng.next() * 0.5, rng.next() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // дворовете: утъпкана земя около сградите
  for (const f of plan.footprints) {
    if (f.kind === 'field' || f.kind === 'fold') continue;
    const [a, b] = P(f.x, f.z);
    ctx.save(); ctx.translate(a, b); ctx.rotate(-f.rot);
    const w = (f.w + 2.4) * sc, d = (f.d + 2.4) * sc;
    ctx.fillStyle = 'rgba(128,110,74,0.55)';
    ctx.beginPath(); ctx.roundRect(-w / 2, -d / 2, w, d, 6); ctx.fill();
    ctx.restore();
  }
  // нивата: редове
  for (const pr of plan.props.filter(p => p.type === 'field')) {
    const w = Math.floor((pr.extra ?? 2420) / 100), d = (pr.extra ?? 2420) % 100;
    const [a, b] = P(pr.x, pr.z);
    ctx.save(); ctx.translate(a, b); ctx.rotate(-pr.rot);
    ctx.fillStyle = '#7a5e3c'; ctx.fillRect(-w / 2 * sc, -d / 2 * sc, w * sc, d * sc);
    for (let r = -d / 2 + 0.6; r < d / 2; r += 1.2) { ctx.fillStyle = 'rgba(96,74,46,0.9)'; ctx.fillRect(-w / 2 * sc, r * sc, w * sc, 0.45 * sc); }
    ctx.restore();
  }
  // кошарата — утъпкано
  {
    const [a, b] = P(PLACES.sheepfold.pos.x, PLACES.sheepfold.pos.z);
    ctx.fillStyle = 'rgba(132,112,72,0.7)'; ctx.beginPath(); ctx.arc(a, b, 8.6 * sc, 0, Math.PI * 2); ctx.fill();
  }
  // арената на Ламята: опърлено, пепел
  {
    const [a, b] = P(PLATEAU.x, PLATEAU.z);
    for (let k = 0; k < 40; k++) {
      const ang = rng.next() * 6.28, rr = rng.next() * 24 * sc;
      ctx.fillStyle = `rgba(30,26,24,${0.15 + rng.next() * 0.25})`;
      ctx.beginPath(); ctx.ellipse(a + Math.cos(ang) * rr, b + Math.sin(ang) * rr, (2 + rng.next() * 6) * sc, (1 + rng.next() * 3) * sc, rng.next() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // поляната: цветя
  {
    const cols = ['#f4f0e0', '#f3d35a', '#e98fb0', '#9fb6f0', '#f6f6ff'];
    for (let k = 0; k < 4000; k++) {
      const ang = rng.next() * 6.28, rr = Math.sqrt(rng.next()) * 36;
      const x = GLADE.x + Math.cos(ang) * rr, z = GLADE.z + Math.sin(ang) * rr;
      if (Math.hypot(x - POND.x, z - POND.z) < 14) continue;
      const [a, b] = P(x, z); ctx.fillStyle = cols[k % cols.length]; ctx.globalAlpha = 0.45;
      ctx.fillRect(a, b, 1.1, 1.1);
    }
    ctx.globalAlpha = 1;
    // калният бряг на езерцето
    const [a, b] = P(POND.x, POND.z);
    const gr = ctx.createRadialGradient(a, b, 10 * sc, a, b, 17 * sc);
    gr.addColorStop(0, 'rgba(92,80,56,0.9)'); gr.addColorStop(1, 'rgba(92,80,56,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(a, b, 17 * sc, 0, Math.PI * 2); ctx.fill();
  }
  // блатото: кал
  for (const p of plan.swampPools) {
    const [a, b] = P(p.x, p.z);
    const gr = ctx.createRadialGradient(a, b, p.r * 0.6 * sc, a, b, (p.r + 3) * sc);
    gr.addColorStop(0, 'rgba(58,54,36,0.9)'); gr.addColorStop(1, 'rgba(58,54,36,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(a, b, (p.r + 3) * sc, 0, Math.PI * 2); ctx.fill();
  }
  // под мостовете и около крепостта — камък
  {
    const [a, b] = P(FORT.x, FORT.z);
    ctx.strokeStyle = 'rgba(120,112,100,0.5)'; ctx.lineWidth = 4 * sc; ctx.beginPath(); ctx.arc(a, b, 19 * sc, 0, Math.PI * 2); ctx.stroke();
  }
  void BRIDGE;
  return { canvas: cv, grass, shade, base: img.data };
}

/** Точка по коритото (t 0..1) + нормала. */
export function riverAt(t: number): { x: number; z: number; nx: number; nz: number } {
  const P = RIVER_PATH; let total = 0; const L: number[] = [];
  for (let i = 0; i < P.length - 1; i++) { const l = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z); L.push(l); total += l; }
  let d = t * total;
  for (let i = 0; i < L.length; i++) {
    if (d <= L[i] || i === L.length - 1) {
      const u = Math.min(1, d / L[i]), a = P[i], b = P[i + 1], tx = (b.x - a.x) / L[i], tz = (b.z - a.z) / L[i];
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, nx: -tz, nz: tx };
    }
    d -= L[i];
  }
  return { x: P[0].x, z: P[0].z, nx: 1, nz: 0 };
}

/** Картата отгоре 1024×1024 (север горе). */
export function paintMap(ground: GroundData, plan: WorldPlan, riverFlowing: boolean): HTMLCanvasElement {
  const S = 1024, sc = S / (WORLD_HALF * 2);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(ground.canvas, 0, 0, S, S);
  // релеф
  const N = BASE_N, sh = document.createElement('canvas'); sh.width = sh.height = N;
  const sctx = sh.getContext('2d')!, im = sctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = ground.shade[i] / 255; const k = i * 4;
    if (v < 0.5) { im.data[k] = 20; im.data[k + 1] = 18; im.data[k + 2] = 30; im.data[k + 3] = Math.round((0.5 - v) * 2 * 150); }
    else { im.data[k] = 255; im.data[k + 1] = 248; im.data[k + 2] = 220; im.data[k + 3] = Math.round((v - 0.5) * 2 * 90); }
  }
  sctx.putImageData(im, 0, 0);
  ctx.drawImage(sh, 0, 0, S, S);
  const P = (x: number, z: number): [number, number] => [(x + WORLD_HALF) * sc, (z + WORLD_HALF) * sc];
  // вода
  if (riverFlowing) {
    ctx.strokeStyle = '#4f8fa6'; ctx.lineWidth = RIVER_HALF_WIDTH * 1.6 * sc; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); RIVER_PATH.forEach((p, i) => { const [a, b] = P(p.x, p.z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.stroke();
  }
  ctx.fillStyle = '#4f8fa6';
  { const [a, b] = P(POND.x, POND.z); ctx.beginPath(); ctx.arc(a, b, 13 * sc, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#4c5a3c';
  for (const p of plan.swampPools) { const [a, b] = P(p.x, p.z); ctx.beginPath(); ctx.arc(a, b, p.r * 0.8 * sc, 0, Math.PI * 2); ctx.fill(); }
  // дървета
  const dot = (list: { x: number; z: number; s: number }[], fill: string, r: number) => {
    ctx.fillStyle = fill;
    for (const t of list) { const [a, b] = P(t.x, t.z); ctx.beginPath(); ctx.arc(a, b, r * t.s * sc, 0, Math.PI * 2); ctx.fill(); }
  };
  dot(plan.pines, 'rgba(28,46,32,0.85)', 1.9);
  dot(plan.pines.map(t => ({ x: t.x - 0.5, z: t.z - 0.5, s: t.s })), 'rgba(58,88,58,0.7)', 1.0);
  dot(plan.oaks, 'rgba(52,84,40,0.9)', 2.8);
  dot(plan.oaks.map(t => ({ x: t.x - 0.7, z: t.z - 0.7, s: t.s })), 'rgba(98,136,64,0.8)', 1.5);
  dot(plan.deadTrees, 'rgba(70,64,52,0.9)', 1.0);
  dot(plan.rocks.filter(r => r.s > 0.8), 'rgba(130,124,114,0.9)', 0.9);
  // огради и зидове
  for (const f of plan.fences) {
    ctx.strokeStyle = f.type === 'wall' ? 'rgba(150,142,128,0.95)' : 'rgba(92,64,40,0.9)';
    ctx.lineWidth = f.type === 'wall' ? 1.4 : 1;
    ctx.beginPath(); f.pts.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.stroke();
  }
  for (const r of plan.ruins) {
    ctx.strokeStyle = 'rgba(160,152,140,1)'; ctx.lineWidth = 2.2;
    const [a, b] = P(r[0], r[1]), [c, d] = P(r[2], r[3]); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
  }
  // сгради: покриви
  const roofRect = (x: number, z: number, w: number, d: number, rot: number, fill: string) => {
    const [a, b] = P(x, z); ctx.save(); ctx.translate(a, b); ctx.rotate(-rot);
    ctx.fillStyle = 'rgba(30,20,14,0.35)'; ctx.fillRect(-w / 2 * sc + 1.5, -d / 2 * sc + 1.5, w * sc, d * sc);
    ctx.fillStyle = fill; ctx.fillRect(-w / 2 * sc, -d / 2 * sc, w * sc, d * sc);
    ctx.strokeStyle = 'rgba(60,24,16,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(-w / 2 * sc, -d / 2 * sc, w * sc, d * sc);
    ctx.beginPath(); ctx.moveTo(-w / 2 * sc * 0.5, 0); ctx.lineTo(w / 2 * sc * 0.5, 0); ctx.stroke();
    ctx.restore();
  };
  for (const h of plan.houses) {
    const cs = Math.cos(h.rot), sn = Math.sin(h.rot);
    roofRect(h.x + h.fx * cs + h.fz * sn, h.z - h.fx * sn + h.fz * cs, h.fw + 1.6, h.fd + 1.6, h.rot, PAL.roof);
  }
  for (const f of plan.footprints) if (f.kind === 'shed' || f.kind === 'canopy') roofRect(f.x, f.z, f.w + 0.8, f.d + 0.8, f.rot, '#8a6a48');
  for (const p of plan.props) {
    if (p.type === 'tower') { const [a, b] = P(p.x, p.z); ctx.fillStyle = '#a8a092'; ctx.beginPath(); ctx.arc(a, b, 3.4 * sc, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#5e574c'; ctx.stroke(); }
    if (p.type === 'walnut') { const [a, b] = P(p.x, p.z); ctx.fillStyle = 'rgba(46,80,36,0.95)'; ctx.beginPath(); ctx.arc(a, b, 8.5 * sc, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(96,134,62,0.8)'; ctx.beginPath(); ctx.arc(a - 2, b - 2, 5 * sc, 0, Math.PI * 2); ctx.fill(); }
    if (p.type === 'fountain') { const [a, b] = P(p.x, p.z); ctx.fillStyle = '#b8b0a2'; ctx.fillRect(a - 2.5, b - 2.5, 5, 5); }
    if (p.type === 'cave') { const [a, b] = P(p.x, p.z); ctx.fillStyle = '#1a1614'; ctx.beginPath(); ctx.ellipse(a, b, 4 * sc, 2.5 * sc, -p.rot, 0, Math.PI * 2); ctx.fill(); }
  }
  // мостът
  { const [a, b] = P(BRIDGE.x0, BRIDGE.z - BRIDGE.halfW), [c] = P(BRIDGE.x1, BRIDGE.z); ctx.fillStyle = '#a49c8e'; ctx.fillRect(a, b, c - a, BRIDGE.halfW * 2 * sc); ctx.strokeStyle = '#5e574c'; ctx.strokeRect(a, b, c - a, BRIDGE.halfW * 2 * sc); }
  return cv;
}
