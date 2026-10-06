// Преглед на хората (GLB): /dev/chars.html?raw=male_peasant,female_peasant&anim=Walk_Loop&t=0.4&focus=0&dist=3&yaw=0.3&h=1.5
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { preloadCharacters, createVillagerModel, createHeroModel, createSamodivaModel, bakePortraits, type AnimName, type CharacterModel } from '../models';
import { setPortraitImages } from '../ui/portrait3d';
import { portrait } from '../ui/icons';
import { VILLAGERS, type VillagerId } from '../data/villagers';

const qs = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = qs.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : qs.get('tm') === 'neutral' ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9cc7e8');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = +(qs.get('env') ?? 0.6);
const camera = new THREE.PerspectiveCamera(+(qs.get('fov') ?? 40), innerWidth / innerHeight, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight('#cfe3f0', '#5e7a45', 0.8));
const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
const sc = sun.shadow.camera; sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.far = 40;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ color: '#6f9a4a', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);

const info = document.getElementById('info')!;
const loader = new GLTFLoader();
const raw = (qs.get('raw') ?? '').split(',').filter(Boolean);
const animName = qs.get('anim');
const tFix = qs.get('t');
const mixers: THREE.AnimationMixer[] = [];
const roots: THREE.Object3D[] = [];

/** Лента: всяка анимация е ред от n фигури през цялата ѝ продължителност. */
async function strip(names: string[], n: number, who: string): Promise<void> {
  const anims = (await loader.loadAsync('/test/tmp/raw/UAL1_Standard.glb')).animations;
  const g = await loader.loadAsync('/test/tmp/raw/' + who + '.glb');
  const lines: string[] = [];
  names.forEach((name, row) => {
    const c0 = anims.find((a) => a.name === name);
    if (!c0) { lines.push(name + ' НЯМА'); return; }
    const clip = c0.clone();
    clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
    lines.push(`${name} ${clip.duration.toFixed(2)}s`);
    for (let i = 0; i < n; i++) {
      const root = SkeletonUtils.clone(g.scene);
      root.position.set((i - (n - 1) / 2) * 1.05, 0, -row * 2.2);
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
      scene.add(root);
      const mx = new THREE.AnimationMixer(root);
      mx.clipAction(clip).play();
      mx.setTime((clip.duration * i) / (n - 1 || 1) * 0.999);
    }
  });
  info.textContent = lines.join('\n');
  const rows = names.length;
  const target = new THREE.Vector3(0, 0.9, -(rows - 1) * 1.1);
  camera.position.set(target.x, 2.2 + rows * 0.6, target.z + 4 + rows * 1.6);
  controls.target.copy(target); controls.update();
  (window as any).__ready = true;
}

/** Хората на играта (createVillagerModel/createHeroModel/createSamodivaModel): ?who=gena,hero,s0&anim=walk&speed=1.3 */
const models: CharacterModel[] = [];
async function people(list: string[]): Promise<void> {
  const ok = await preloadCharacters({ quality: 'high' });
  const anim = (qs.get('anim') ?? 'idle') as AnimName;
  const gap = +(qs.get('gap') ?? 0.9);
  let x = -((list.length - 1) * gap) / 2;
  for (const w of list) {
    let m: CharacterModel;
    if (w === 'hero') { const h = createHeroModel(); if (qs.get('weapon')) h.setWeapon(qs.get('weapon') === 'none' ? null : qs.get('weapon') as 'bow'); m = h; }
    else if (/^s\d$/.test(w)) m = createSamodivaModel(+w[1]);
    else m = createVillagerModel(VILLAGERS[w as VillagerId].look);
    m.root.position.x = x; x += gap;
    m.root.rotation.y = +(qs.get('ry') ?? 0);
    scene.add(m.root); models.push(m);
    m.play(anim);
  }
  const sp = +(qs.get('speed') ?? (anim === 'run' ? 4.5 : anim === 'walk' ? 1.3 : 0));
  const tt = +(qs.get('t') ?? 1.2);
  for (let t = 0; t < tt; t += 1 / 30) for (const m of models) m.update(1 / 30, sp);
  info.textContent = (ok ? 'GLB' : 'процедурни') + ' ' + list.join(' ') + ' ' + anim + '\n' + models.map((m) => {
    let tris = 0, draws = 0;
    m.root.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh && mm.visible) { draws++; tris += (mm.geometry.index ? mm.geometry.index.count : mm.geometry.attributes.position.count) / 3; } });
    return `${Math.round(tris)} тр. / ${draws} draw`;
  }).join('  ');
  const f = +(qs.get('focus') ?? -1);
  const target = new THREE.Vector3(f >= 0 && models[f] ? models[f].root.position.x : 0, +(qs.get('h') ?? 1.0), 0);
  const dist = +(qs.get('dist') ?? 4), yaw = +(qs.get('yaw') ?? 0), pitch = +(qs.get('pitch') ?? 0.05);
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
  controls.target.copy(target);
  controls.update();
  (window as any).models = models;
  if (qs.get('perf')) (window as any).__perf = await gpuPerf(qs.get('perf')!);
  (window as any).__ready = true;
}

/**
 * GPU време на кадър (EXT_disjoint_timer_query): по 4 кадъра с „нещото“ и 4 без, редувани — за честно сравнение
 * дори когато видеокартата е заета с други неща. what: all | shadow | cloth | folk | skin | eyes | hair | ds (двустранни).
 */
async function gpuPerf(what: string): Promise<Record<string, unknown>> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return { err: 'няма timer query' };
  const toggles: [any, string, unknown, unknown][] = [];
  if (what === 'sun') toggles.push([sun, 'castShadow', true, false]);
  if (what === 'bonetex') for (const m of models) m.root.traverse((o: any) => { if (o.isSkinnedMesh) toggles.push([o.skeleton, 'frame', -1, -1]); });
  for (const m of models) m.root.traverse((o: any) => {
    if (!o.isMesh) return;
    if (what === 'all') toggles.push([o, 'visible', true, false]);
    else if (what === 'shadow') toggles.push([o, 'castShadow', true, false]);
    else if (what === 'ds') toggles.push([o.material, 'side', o.material.side, THREE.FrontSide]);
    else if (o.name.endsWith('_' + what) || o.name === what) toggles.push([o, 'visible', true, false]);
  });
  const out: number[][] = [[], []];
  const pending: [WebGLQuery, number][] = [];
  let mode = 0;
  const poll = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const [q, m] = pending[i];
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out[m].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q); pending.splice(i, 1);
      }
    }
  };
  for (let n = 0; n < 400; n++) {
    mode = Math.floor(n / 4) % 2;
    for (const [o, k, on, off] of toggles) { o[k] = mode === 0 ? on : off; if (k === 'side') o.needsUpdate = true; }
    const q = gl.createQuery()!;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    renderer.render(scene, camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push([q, mode]);
    await new Promise((r) => requestAnimationFrame(r));
    poll();
  }
  for (const [o, k, on] of toggles) o[k] = on;
  await new Promise((r) => setTimeout(r, 200)); poll();
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return +(s[s.length >> 1] ?? 0).toFixed(3); };
  const lo = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return +(s[Math.floor(s.length * 0.1)] ?? 0).toFixed(3); };
  return { what, toggles: toggles.length, on: med(out[0]), off: med(out[1]), onLo: lo(out[0]), offLo: lo(out[1]), n: [out[0].length, out[1].length] };
}

/** Портретите за диалога (?portraits=1): истинските (3D) и рисуваните едни до други. */
async function portraits(): Promise<void> {
  await preloadCharacters({ quality: 'high' });
  const ids = ['gena', 'peyu', 'petko', 'ivan', 'maria', 'radka', 'kalin', 'hero'];
  const drawn = ids.map((id) => portrait(id, 120));
  setPortraitImages(await bakePortraits(ids.map((id) => ({ id, look: id === 'hero' ? undefined : VILLAGERS[id as VillagerId].look }))));
  renderer.domElement.style.display = 'none';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;background:#2a2018;display:grid;grid-template-columns:repeat(8,1fr);gap:8px;padding:30px;align-content:start';
  box.innerHTML = ids.map((id) => `<div>${portrait(id, 220)}</div>`).join('') + drawn.map((d) => `<div>${d}</div>`).join('');
  document.body.appendChild(box);
  (window as any).__ready = true;
}

async function main(): Promise<void> {
  if (qs.get('portraits')) return portraits();
  if (qs.get('who')) return people(qs.get('who')!.split(','));
  if (qs.get('strip')) return strip(qs.get('strip')!.split(','), +(qs.get('n') ?? 6), qs.get('stripwho') ?? 'sh_male');
  const anims = animName ? (await loader.loadAsync('/test/tmp/raw/UAL1_Standard.glb')).animations : [];
  const clip0 = anims.find((a) => a.name === animName);
  let clip: THREE.AnimationClip | undefined;
  if (clip0) {
    // само завъртания + таза
    clip = clip0.clone();
    clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
  }
  const gap = +(qs.get('gap') ?? 1.0);
  let x = -((raw.length - 1) * gap) / 2;
  const lines: string[] = [];
  for (const name of raw) {
    const g = await loader.loadAsync('/test/tmp/raw/' + name + '.glb');
    const root = SkeletonUtils.clone(g.scene);
    root.position.x = x; x += gap;
    let tris = 0, draws = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; draws++; tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; m.frustumCulled = false; }
    });
    lines.push(`${name}: ${Math.round(tris)} tris, ${draws} draws`);
    scene.add(root); roots.push(root);
    if (clip) {
      const mx = new THREE.AnimationMixer(root);
      const a = mx.clipAction(clip); a.play();
      if (tFix !== null) mx.setTime(+tFix);
      mixers.push(mx);
    }
  }
  info.textContent = lines.join('\n') + (animName ? `\nanim ${animName} ${clip ? clip.duration.toFixed(2) + 's' : 'НЯМА'}` : '') + '\n' + anims.map((a) => a.name).join(' ');
  const f = +(qs.get('focus') ?? -1);
  const target = new THREE.Vector3(f >= 0 && roots[f] ? roots[f].position.x : 0, +(qs.get('h') ?? 1.0), 0);
  const dist = +(qs.get('dist') ?? 4), yaw = +(qs.get('yaw') ?? 0), pitch = +(qs.get('pitch') ?? 0.05);
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
  controls.target.copy(target);
  controls.update();
  (window as any).__ready = true;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (tFix === null) for (const m of mixers) m.update(dt);
  if (!qs.get('pause')) for (const m of models) m.update(dt, +(qs.get('speed') ?? 0));
  renderer.render(scene, camera);
});
main().catch((e) => { info.textContent = String(e); console.error(e); });
