// Проба на света: свободна камера, час, време, река, празник, качество, fps.
import * as THREE from 'three';
import { Engine } from '../engine/Engine';
import { World3D, type Quality } from '../world/World3D';
import { formatClock } from '../core/time';
import type { Weather } from '../sim/types';
import { heightAt } from '../world/height';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const engine = new Engine($('game'));
const t0 = performance.now();
const world = new World3D(engine, { quality: (new URLSearchParams(location.search).get('q') as Quality) || 'high' });
console.log(`World3D built in ${(performance.now() - t0).toFixed(0)} ms`, JSON.stringify(world.buildMs));

let minutes = 600;
let yaw = 0, pitch = -0.25;
const cam = engine.camera;
cam.position.set(0, 18, 95);
const focus = new THREE.Vector3();

const VIEWS: Record<string, { pos: [number, number, number]; at: [number, number, number]; time: number }> = {
  'мегдан': { pos: [-20, 7, 66], at: [4, 4, 38], time: 630 },
  'здрач': { pos: [-30, 16, 110], at: [5, 4, 45], time: 1185 },
  'гора нощ': { pos: [-92, 4, 2], at: [-130, 4, -38], time: 1380 },
  'поляна': { pos: [-158, 5, -150], at: [-178, 0, -182], time: 1410 },
  'арена': { pos: [134, 37, -146], at: [167, 34, -192], time: 840 },
  'пещера': { pos: [150, 33, -168], at: [167, 34, -192], time: 840 },
  'къща': { pos: [-12, 4.5, 24], at: [-20, 3.5, 9], time: 560 },
  'сбор': { pos: [-12, 6, 66], at: [0, 3, 48], time: 1300 },
  'река': { pos: [64, 14, 68], at: [90, 0, 30], time: 700 },
  'Ламин връх': { pos: [112, 46, -128], at: [152, 30, -170], time: 900 },
  'крепост': { pos: [168, 26, 82], at: [214, 15, 50], time: 1000 },
  'блато': { pos: [-110, 14, 118], at: [-170, 3, 168], time: 800 },
  'отгоре': { pos: [0, 320, 200], at: [0, 0, 20], time: 720 },
};
function setView(name: string) {
  const v = VIEWS[name]; if (!v) return;
  cam.position.set(...v.pos);
  const dx = v.at[0] - v.pos[0], dy = v.at[1] - v.pos[1], dz = v.at[2] - v.pos[2];
  yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz));
  minutes = v.time;
  ($('time') as HTMLInputElement).value = String(v.time);
}
const viewsEl = $('views');
for (const k of Object.keys(VIEWS)) { const b = document.createElement('button'); b.textContent = k; b.onclick = () => setView(k); viewsEl.appendChild(b); }

($('time') as HTMLInputElement).oninput = (e) => { minutes = +(e.target as HTMLInputElement).value; };
($('weather') as HTMLSelectElement).onchange = (e) => world.setWeather((e.target as HTMLSelectElement).value as Weather);
($('quality') as HTMLSelectElement).onchange = (e) => world.setQuality((e.target as HTMLSelectElement).value as Quality);
($('river') as HTMLInputElement).onchange = (e) => world.setRiverFlowing((e.target as HTMLInputElement).checked, true);
($('festival') as HTMLInputElement).onchange = (e) => world.setFestival((e.target as HTMLInputElement).checked);
($('showmap') as HTMLInputElement).onchange = (e) => {
  const on = (e.target as HTMLInputElement).checked, m = $('map') as HTMLCanvasElement;
  m.style.display = on ? 'block' : 'none';
  if (on) m.getContext('2d')!.drawImage(world.mapCanvas(), 0, 0);
};

// мишка: влачене
let drag = false, lx = 0, ly = 0;
const canvas = $('game') as HTMLCanvasElement;
canvas.addEventListener('mousedown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
window.addEventListener('mouseup', () => { drag = false; });
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  yaw -= (e.clientX - lx) * 0.004; pitch -= (e.clientY - ly) * 0.004; lx = e.clientX; ly = e.clientY;
  pitch = Math.max(-1.5, Math.min(1.5, pitch));
});

const statsEl = $('stats');
let statT = 0;
engine.onUpdate((dt) => {
  const inp = engine.input;
  const sp = (inp.down('ShiftLeft') || inp.down('ShiftRight') ? 60 : 15) * dt;
  const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (inp.down('KeyW')) cam.position.addScaledVector(fwd, sp);
  if (inp.down('KeyS')) cam.position.addScaledVector(fwd, -sp);
  if (inp.down('KeyD')) cam.position.addScaledVector(right, sp);
  if (inp.down('KeyA')) cam.position.addScaledVector(right, -sp);
  if (inp.down('KeyE')) cam.position.y += sp;
  if (inp.down('KeyQ')) cam.position.y -= sp;
  cam.position.y = Math.max(cam.position.y, heightAt(cam.position.x, cam.position.z) + 1.2);
  cam.lookAt(cam.position.clone().add(fwd));
  if (($('run') as HTMLInputElement).checked) { minutes = (minutes + dt * 15) % 1440; ($('time') as HTMLInputElement).value = String(Math.floor(minutes)); }
  // фокус = точка пред камерата на земята (като героя)
  focus.set(cam.position.x + fwd.x * 12, 0, cam.position.z + fwd.z * 12);
  focus.y = heightAt(focus.x, focus.z);
  world.update(dt, minutes, focus);
  $('clock').textContent = formatClock(minutes);
  statT += dt;
  if (statT > 0.5) { statT = 0; const s = world.stats(); statsEl.textContent = `${engine.fps.toFixed(0)} fps · ${s.calls} draw calls · ${(s.triangles / 1000).toFixed(0)}k триъг.`; }
});
engine.start();

// за роботите (Playwright)
(window as unknown as Record<string, unknown>).__dev = {
  world, engine, setView, VIEWS,
  setTime: (m: number) => { minutes = m; },
  set: (x: number, y: number, z: number, yw: number, p: number) => { cam.position.set(x, y, z); yaw = yw; pitch = p; },
  ready: true,
};
