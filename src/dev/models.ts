// Преглед на моделите: /dev/models.html?set=villagers&anim=walk&t=1.2&pause=1&focus=0&yaw=0.4&dist=6&night=1
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VILLAGERS, VILLAGER_IDS } from '../data/villagers';
import {
  createVillagerModel, createHeroModel, createMonsterModel, createSamodivaModel, createAnimalModel, createLamiaModel, createPropModel,
  type AnimName, type CharacterModel, type LamiaModel, type PropKind,
} from '../models';
import { countTris } from '../models/shared';

const qs = new URLSearchParams(location.search);
const set = qs.get('set') ?? 'all';
const night = qs.get('night') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? '#0d1530' : '#9cc7e8');
scene.fog = new THREE.Fog(night ? '#0d1530' : '#9cc7e8', 40, 140);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
const controls = new OrbitControls(camera, renderer.domElement);

scene.add(new THREE.HemisphereLight(night ? '#253a6b' : '#e9f1f4', night ? '#1a2a1a' : '#4f7a3a', night ? 0.5 : 1.1));
const sun = new THREE.DirectionalLight(night ? '#9fb0e0' : '#fff3dd', night ? 0.5 : 2.2);
sun.position.set(20, 35, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -25; sc.right = 25; sc.top = 25; sc.bottom = -25; sc.far = 120;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshLambertMaterial({ color: night ? '#2f4a35' : '#6f9a4a' }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);

interface Entry { name: string; model?: CharacterModel; obj: THREE.Object3D; size: number; }
const entries: Entry[] = [];
const add = (name: string, model: CharacterModel | undefined, obj: THREE.Object3D, size: number) => entries.push({ name, model, obj, size });

if (set === 'all' || set === 'villagers') for (const id of VILLAGER_IDS) { const m = createVillagerModel(VILLAGERS[id].look); add(VILLAGERS[id].name, m, m.root, 1.2); }
if (set === 'all' || set === 'hero' || set === 'villagers') { const h = createHeroModel(); add('Стоян', h, h.root, 1.2); (window as any).hero = h; }
if (set === 'all' || set === 'monsters') {
  for (const k of ['talasam', 'fox_talasam'] as const) { const m = createMonsterModel(k); add(k, m, m.root, 1.5); }
  for (let i = 0; i < 3; i++) { const m = createSamodivaModel(i); add('самодива ' + i, m, m.root, 1.3); }
}
if (set === 'all' || set === 'animals') for (const k of ['sheep', 'goat', 'chicken', 'dog', 'cat'] as const) { const m = createAnimalModel(k); add(k, m, m.root, 1.2); }
if (set === 'all' || set === 'props') for (const k of ['rosen', 'chest', 'saber', 'ivan_saber', 'bow', 'potion', 'feather', 'egg'] as PropKind[]) { const o = createPropModel(k); add(k, undefined, o, 1.3); }
let lamia: LamiaModel | undefined;
if (set === 'all' || set === 'lamia') { lamia = createLamiaModel(); add('Ламята', lamia, lamia.root, 12); (window as any).lamia = lamia; }

// подреждане в редица
let x = 0;
const total = entries.reduce((a, e) => a + e.size, 0);
x = -total / 2;
for (const e of entries) {
  x += e.size / 2;
  e.obj.position.x = x;
  x += e.size / 2;
  e.obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.castShadow; });
  scene.add(e.obj);
}

const focus = qs.has('focus') ? entries[+qs.get('focus')!] : undefined;
const target = new THREE.Vector3(focus ? focus.obj.position.x : 0, qs.has('ty') ? +qs.get('ty')! : focus ? (focus.model?.height ?? 0.5) * 0.55 : 1, 0);
const dist = +(qs.get('dist') ?? (focus ? Math.max(3, (focus.model?.height ?? 1) * 3.2) : total * 0.75 + 2));
const yaw = +(qs.get('yaw') ?? 0.35), pitch = +(qs.get('pitch') ?? 0.18);
camera.position.set(target.x + Math.sin(yaw) * dist * Math.cos(pitch), target.y + Math.sin(pitch) * dist, Math.cos(yaw) * dist * Math.cos(pitch));
controls.target.copy(target);
controls.update();

const ANIMS: AnimName[] = ['idle', 'walk', 'run', 'attack', 'attack2', 'block', 'hit', 'die', 'talk', 'work', 'sit', 'sleep', 'dance', 'jump', 'cast', 'wave'];
let anim: AnimName = (qs.get('anim') as AnimName) ?? 'idle';
const ui = document.getElementById('ui')!;
const btns: HTMLButtonElement[] = [];
const setAnim = (a: AnimName) => { anim = a; for (const e of entries) e.model?.play(a); btns.forEach((b) => b.classList.toggle('on', b.textContent === a)); };
ANIMS.forEach((a, i) => { const b = document.createElement('button'); b.textContent = a; b.title = String(i + 1); b.onclick = () => setAnim(a); ui.appendChild(b); btns.push(b); });
if (lamia) for (let i = 0; i < 3; i++) for (const kind of ['bite', 'fire'] as const) {
  const b = document.createElement('button'); b.textContent = `глава ${i} ${kind}`; b.onclick = () => lamia!.headAttack(i, kind); ui.appendChild(b);
}
if (lamia) { const b = document.createElement('button'); b.textContent = 'убий глава 0'; b.onclick = () => lamia!.setHeadAlive(0, false); ui.appendChild(b); }
const wb = document.createElement('button'); wb.textContent = 'оръжие'; let wi = 0;
wb.onclick = () => { const h = (window as any).hero; if (h) h.setWeapon((['saber', 'ivan_saber', 'bow', null] as const)[++wi % 4]); };
ui.appendChild(wb);
const fb = document.createElement('button'); fb.textContent = 'удар (flash)'; fb.onclick = () => entries.forEach((e) => e.model?.flash(0xff4030)); ui.appendChild(fb);
let turn = qs.get('turn') === '1';
const tb = document.createElement('button'); tb.textContent = 'въртене'; tb.onclick = () => { turn = !turn; }; ui.appendChild(tb);
addEventListener('keydown', (ev) => { const n = parseInt(ev.key, 10); if (n >= 1 && n <= 9) setAnim(ANIMS[n - 1]); if (ev.key === '0') setAnim(ANIMS[9]); });
setAnim(anim);
const speed = qs.has('speed') ? +qs.get('speed')! : undefined;
const lamiaCmd = qs.get('lamia'); // напр. fire1, bite0, dead0
if (lamia && lamiaCmd) {
  const i = +lamiaCmd.slice(-1);
  if (lamiaCmd.startsWith('dead')) lamia.setHeadAlive(i, false); else lamia.headAttack(i, lamiaCmd.startsWith('fire') ? 'fire' : 'bite');
}
if (qs.get('weapon')) (window as any).hero?.setWeapon(qs.get('weapon') === 'none' ? null : qs.get('weapon'));

const info = document.getElementById('info')!;
info.textContent = entries.map((e) => `${e.name}: ${countTris(e.obj)}△`).join(' · ');

// детерминирано превъртане за снимки
const pre = +(qs.get('t') ?? 0);
for (let t = 0; t < pre; t += 1 / 60) for (const e of entries) e.model?.update(1 / 60, speed);
const pause = qs.get('pause') === '1';
let last = performance.now();
function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!pause) for (const e of entries) e.model?.update(dt, speed);
  if (turn) for (const e of entries) e.obj.rotation.y += dt * 0.5;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
renderer.render(scene, camera);
(window as any).__ready = true;
frame();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
