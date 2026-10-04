// Светът в 3D: терен, небе, светлини, селото, гората, поляната, коритото, Ламин връх, крепостта, блатото,
// вода, трева, време (дъжд, буря, мъгла), празник. Изпълнява WorldQuery (височина, препятствия, вода).
import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { WorldQuery } from '../core/world-query';
import type { Weather } from '../sim/types';
import { heightAt, riverInfo, riverWaterHeight, terrainHeight, POND_WATER_HEIGHT } from './height';
import { getPlan, type WorldPlan, GLADE, POND, SWAMP } from './plan';
import { Batch, vertexColorMaterial } from './geom';
import { buildHouse, buildProp } from './buildings';
import { buildFences, buildRuins, buildSigns, buildSignPosts } from './extras';
import { paintGround, paintMap, type GroundData } from './ground';
import { buildTerrain } from './terrain';
import { SkySystem } from './sky';
import { instanced, pineGeo, oakGeo, bushGeo, rockGeo, deadTreeGeo, fernGeo, mushroomGeo, logGeo, flowerGeo, type InstGroup } from './vegetation';
import { buildPond, buildRiver, buildSwampPools } from './water';
import { GrassField } from './grass';
import { Rain, Motes, Festival } from './effects';
import { FOREST, RIVER_HALF_WIDTH } from '../data/layout';

export type Quality = 'low' | 'medium' | 'high';

interface WeatherParams { cloud: number; dark: number; fogNear: number; fogFar: number; rain: number; wind: number; storm: number }
const WEATHER: Record<Weather, WeatherParams> = {
  clear: { cloud: 0.3, dark: 0, fogNear: 140, fogFar: 1000, rain: 0, wind: 0.45, storm: 0 },
  cloudy: { cloud: 0.8, dark: 0.32, fogNear: 70, fogFar: 520, rain: 0, wind: 0.75, storm: 0 },
  rain: { cloud: 0.97, dark: 0.58, fogNear: 25, fogFar: 260, rain: 0.65, wind: 0.95, storm: 0 },
  storm: { cloud: 1, dark: 0.8, fogNear: 18, fogFar: 210, rain: 1, wind: 1.7, storm: 1 },
  fog: { cloud: 0.55, dark: 0.25, fogNear: 2, fogFar: 85, rain: 0, wind: 0.2, storm: 0 },
};

const CHUNK = 100;

export class World3D implements WorldQuery {
  readonly lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight };
  readonly root = new THREE.Group();
  readonly plan: WorldPlan;
  readonly sky: SkySystem;
  /** Вика се при светкавица (за гръм в звука). */
  onLightning: (() => void) | null = null;
  /** колко ms отне строенето (за доклада) */
  readonly buildMs: Record<string, number> = {};

  private ground: GroundData;
  private groundTex: THREE.CanvasTexture;
  private solidMat = vertexColorMaterial();
  private windowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private hotMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private staticMeshes: THREE.Mesh[] = [];
  private groups: InstGroup[] = [];
  private grass: GrassField;
  private pond: THREE.Mesh;
  private river: { mesh: THREE.Mesh; length: number };
  private swamp: THREE.Mesh;
  private rain = new Rain();
  private motes = new Motes();
  private festival: Festival;
  private forgeLight = new THREE.PointLight('#ff8a3a', 0, 16, 1.8);
  private quality: Quality = 'high';
  private distScale = 1;
  private weatherName: Weather = 'clear';
  private wp: WeatherParams = { ...WEATHER.clear };
  private lightningTimer = 6;
  private flash = 0;
  private riverOn = false;
  private riverFront = 0;   // 0..1 докъде е стигнала водата
  private riverSpeed = 0;
  private time = 0;
  private mapCache: { flowing: boolean; canvas: HTMLCanvasElement } | null = null;
  private tmp = new THREE.Vector3();

  constructor(private engine: Engine, opts: { quality?: Quality } = {}) {
    const scene = engine.scene;
    this.root.name = 'world';
    scene.add(this.root);
    this.engine.renderer.toneMapping = THREE.NeutralToneMapping;
    let tm = performance.now();
    const mark = (k: string) => { const n = performance.now(); this.buildMs[k] = Math.round(n - tm); tm = n; };
    this.plan = getPlan(); mark('plan');
    this.sky = new SkySystem(scene);
    this.lights = { sun: this.sky.sun, hemi: this.sky.hemi };

    // земята
    this.ground = paintGround(this.plan); mark('ground');
    this.groundTex = new THREE.CanvasTexture(this.ground.canvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = Math.min(8, engine.renderer.capabilities.getMaxAnisotropy());
    this.groundTex.generateMipmaps = true;
    this.groundTex.minFilter = THREE.LinearMipmapLinearFilter;
    const terrain = buildTerrain(this.groundTex);
    this.root.add(terrain.group); mark('terrain');

    this.buildStatic(); mark('static');
    this.buildVegetation(); mark('vegetation');

    this.pond = buildPond(); this.root.add(this.pond);
    this.river = buildRiver(); this.root.add(this.river.mesh);
    this.swamp = buildSwampPools(this.plan.swampPools); this.root.add(this.swamp);
    this.grass = new GrassField(this.ground.grass, this.ground.base); this.root.add(this.grass.group);
    this.root.add(this.rain.mesh, this.motes.points);
    this.festival = new Festival(this.solidMat);
    this.root.add(this.festival.group, this.festival.light);
    // светлината от огнището в ковачницата
    const smithy = this.plan.props.find(p => p.type === 'smithy');
    if (smithy) {
      const cs = Math.cos(smithy.rot), sn = Math.sin(smithy.rot), lx = -1.6, lz = -1.2;
      this.forgeLight.position.set(smithy.x + lx * cs + lz * sn, heightAt(smithy.x, smithy.z) + 1.6, smithy.z - lx * sn + lz * cs);
      this.root.add(this.forgeLight);
    }
    this.setQuality(opts.quality ?? 'high'); mark('rest');
  }

  // ------------------------------------------------------------------ строене
  private buildStatic(): void {
    const solid = new Map<string, Batch>(), windows = new Map<string, Batch>(), hot = new Batch();
    const key = (x: number, z: number) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    const S = (x: number, z: number) => { const k = key(x, z); return solid.get(k) ?? solid.set(k, new Batch()).get(k)!; };
    const Wn = (x: number, z: number) => { const k = key(x, z); return windows.get(k) ?? windows.set(k, new Batch()).get(k)!; };
    for (const h of this.plan.houses) buildHouse(S(h.x, h.z), Wn(h.x, h.z), h);
    for (const p of this.plan.props) buildProp(S(p.x, p.z), hot, p);
    for (const f of this.plan.fences) buildFences(S(f.pts[0][0], f.pts[0][1]), [f]);
    if (this.plan.ruins.length) buildRuins(S(this.plan.ruins[0][0], this.plan.ruins[0][1]), this.plan.ruins);
    buildSignPosts(S(0, 0), this.plan);
    for (const [k, b] of solid) { const m = b.build(this.solidMat, { name: `static_${k}` }); if (m) this.addStatic(m); }
    for (const [k, b] of windows) { const m = b.build(this.windowMat, { castShadow: false, name: `windows_${k}` }); if (m) this.addStatic(m); }
    const hm = hot.build(this.hotMat, { castShadow: false, receiveShadow: false, name: 'coals' }); if (hm) this.addStatic(hm);
    const inn = this.plan.props.find(p => p.type === 'inn_sign');
    const signs = buildSigns(this.plan, inn ? { x: inn.x, z: inn.z, rot: inn.rot } : null);
    this.root.add(signs); this.staticMeshes.push(signs);
  }
  private addStatic(m: THREE.Mesh) { m.updateMatrix(); this.root.add(m); this.staticMeshes.push(m); }

  private buildVegetation(): void {
    const p = this.plan;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const tintGreen = (t: { tint: number }, c: THREE.Color) => c.setRGB(0.82 + t.tint * 0.3, 0.86 + t.tint * 0.24, 0.8 + t.tint * 0.2);
    const add = (g: InstGroup) => { this.groups.push(g); for (const m of g.meshes) this.root.add(m); };
    add(instanced('pines', pineGeo(), mat, p.pines, { tint: tintGreen, maxDist: 520, sink: 0.2 }));
    add(instanced('oaks', oakGeo(), mat, p.oaks, { tint: tintGreen, maxDist: 480 }));
    add(instanced('bushes', bushGeo(), mat, p.bushes, { tint: (t, c) => t.tint > 0.85 ? c.setRGB(0.6, 0.62, 0.45) : tintGreen(t, c), maxDist: 220, castShadow: true }));
    add(instanced('rocks', rockGeo(), mat, p.rocks, {
      tint: (t, c) => t.tint < 0 ? c.setRGB(0.42, 0.38, 0.35) : t.tint >= 3 ? c.setRGB(1.25, 1.22, 1.15) : t.tint >= 2 ? c.setRGB(1.15, 1.08, 0.95) : c.setRGB(0.9 + t.tint * 0.25, 0.9 + t.tint * 0.22, 0.88 + t.tint * 0.2),
      maxDist: 300, sink: 0.25,
    }));
    add(instanced('deadTrees', deadTreeGeo(), mat, p.deadTrees, { maxDist: 320 }));
    add(instanced('ferns', fernGeo(), mat, p.ferns, { tint: tintGreen, maxDist: 110, castShadow: false, sink: 0.05 }));
    add(instanced('mushrooms', mushroomGeo(), mat, p.mushrooms, { maxDist: 70, castShadow: false, sink: 0 }));
    add(instanced('logs', logGeo(), mat, p.logs, { maxDist: 160, sink: 0.1 }));
    const flowerCols = [[1, 1, 1], [1, 0.85, 0.3], [0.95, 0.55, 0.75], [0.6, 0.7, 1]];
    add(instanced('flowers', flowerGeo(), mat, p.flowers, { tint: (t, c) => { const f = flowerCols[Math.floor(t.tint * 4) % 4]; c.setRGB(f[0], f[1], f[2]); }, maxDist: 120, castShadow: false, sink: 0 }));
  }

  // ------------------------------------------------------------------ API
  update(dt: number, totalGameMinutes: number, focus: THREE.Vector3): void {
    this.time += dt;
    const t = this.time, cam = this.engine.camera.position;
    // времето (плавно към целта)
    const target = WEATHER[this.weatherName], k = 1 - Math.exp(-dt * 0.35);
    for (const key of Object.keys(target) as (keyof WeatherParams)[]) this.wp[key] += (target[key] - this.wp[key]) * k;
    // светкавици
    if (this.wp.storm > 0.5) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) { this.flash = 1; this.lightningTimer = 4 + Math.random() * 9; this.onLightning?.(); }
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    const fl = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40)) : 0;
    // местна мъгла: блатото, гората
    const dSw = Math.hypot(focus.x - SWAMP.x, focus.z - SWAMP.z);
    const dFo = Math.hypot(focus.x - FOREST.center.x, focus.z - FOREST.center.z);
    const localFog = Math.max(THREE.MathUtils.smoothstep(150, 70, dSw) * 0.85, THREE.MathUtils.smoothstep(FOREST.radius + 10, FOREST.radius - 30, dFo) * 0.5);
    this.sky.localFog = localFog;
    const ds = this.distScale;
    this.sky.weather = { cloud: this.wp.cloud, dark: this.wp.dark, fogNear: this.wp.fogNear * Math.min(1, ds + 0.2), fogFar: this.wp.fogFar * Math.min(1, ds + 0.15), flash: fl * 0.5 };
    this.sky.update(totalGameMinutes, this.engine.camera, focus, t);
    const night = this.sky.night;

    // прозорците светят нощем, огнището гори винаги
    const lit = Math.min(1, night + this.sky.twilight * 0.6 + this.wp.dark * 0.4);
    this.windowMat.color.setRGB(0.03 + lit * 1.0, 0.03 + lit * 0.75, 0.035 + lit * 0.45);
    const flick = 0.8 + 0.12 * Math.sin(t * 9.3) + 0.08 * Math.sin(t * 17.1 + 2);
    this.hotMat.color.setScalar(0.85 + 0.15 * flick);
    this.forgeLight.intensity = (3 + night * 9) * flick;

    // вода
    const skyTop = this.sky.top, skyHor = this.sky.horizon;
    for (const m of [this.pond, this.river.mesh, this.swamp]) {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t; u.uSky.value.copy(skyHor); u.uTop.value.copy(skyTop);
      u.uLightDir.value.copy(this.sky.lightDir);
      u.uLightColor.value.copy(this.sky.sun.color).multiplyScalar(Math.min(1.2, this.sky.sun.intensity * 0.5));
    }
    if (this.riverOn && this.riverFront < 1.01) this.riverFront = Math.min(1.01, this.riverFront + dt * this.riverSpeed);
    (this.river.mesh.material as THREE.ShaderMaterial).uniforms.uFront.value = this.riverFront;

    // трева, дъжд, светулки, празник
    this.grass.uniforms.uWind.value = this.wp.wind;
    this.grass.update(focus, t);
    this.rain.update(t, cam, this.wp.rain, this.wp.wind);
    const nearMagic = Math.max(THREE.MathUtils.smoothstep(160, 60, Math.hypot(focus.x - GLADE.x, focus.z - GLADE.z)), THREE.MathUtils.smoothstep(140, 60, dFo) * 0.7);
    this.motes.update(t, night * nearMagic * (1 - this.wp.rain), this.engine.renderer.getPixelRatio());
    this.festival.update(t, night);

    // скриване по разстояние (дребните неща — само близо)
    for (const g of this.groups) {
      const md = g.maxDist * ds;
      for (const m of g.meshes) {
        const bs = m.boundingSphere; if (!bs) continue;
        m.visible = this.tmp.copy(bs.center).distanceTo(cam) - bs.radius < md;
      }
    }
  }

  setRiverFlowing(on: boolean, animate = true): void {
    this.riverOn = on;
    this.river.mesh.visible = on;
    if (!on) { this.riverFront = 0; return; }
    if (animate) { this.riverFront = 0; this.riverSpeed = 1 / 10; } else { this.riverFront = 1.01; }
  }
  get riverFlowing(): boolean { return this.riverOn; }

  setFestival(on: boolean): void { this.festival.set(on); }

  /** Сменя времето плавно (~5 с); instant — веднага (напр. при зареждане на запис). */
  setWeather(w: Weather, instant = false): void { this.weatherName = w; if (instant) this.wp = { ...WEATHER[w] }; }
  get weather(): Weather { return this.weatherName; }

  setQuality(q: Quality): void {
    this.quality = q;
    const r = this.engine.renderer;
    const sun = this.sky.sun;
    if (q === 'low') {
      sun.castShadow = false; this.grass.setDensity(1); this.distScale = 0.55; this.engine.setPixelRatioCap(1);
    } else if (q === 'medium') {
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); this.sky.setShadowExtent(55); this.grass.setDensity(2); this.distScale = 0.78; this.engine.setPixelRatioCap(1.25);
      r.shadowMap.type = THREE.PCFShadowMap;
    } else {
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); this.sky.setShadowExtent(70); this.grass.setDensity(3); this.distScale = 1; this.engine.setPixelRatioCap(1.5);
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    sun.shadow.map?.dispose(); sun.shadow.map = null;
    r.shadowMap.needsUpdate = true;
  }
  getQuality(): Quality { return this.quality; }

  heightAt(x: number, z: number): number { return heightAt(x, z); }
  collide(x: number, z: number, radius: number): { x: number; z: number } { return this.plan.colliders.collide(x, z, radius); }
  lockedAt(x: number, z: number): string | null { return this.plan.colliders.lockedAt(x, z); }
  waterAt(x: number, z: number): boolean {
    if (Math.hypot(x - POND.x, z - POND.z) < 16 && terrainHeight(x, z) < POND_WATER_HEIGHT) return true;
    if (this.riverOn) {
      const ri = riverInfo(x, z);
      if (ri.dist < RIVER_HALF_WIDTH + 1 && ri.t <= this.riverFront && terrainHeight(x, z) < riverWaterHeight(x, z) - 0.1 - (ri.dist > 3 ? 0 : 0)) return true;
    }
    if (Math.hypot(x - SWAMP.x, z - SWAMP.z) < 70) for (const p of this.plan.swampPools) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.85 && terrainHeight(x, z) < p.y) return true;
    return false;
  }

  /** Картата отгоре 1024×1024: (x, z) → ((x+300)/600*1024, (z+300)/600*1024), север (-z) горе. */
  mapCanvas(): HTMLCanvasElement {
    if (!this.mapCache || this.mapCache.flowing !== this.riverOn) this.mapCache = { flowing: this.riverOn, canvas: paintMap(this.ground, this.plan, this.riverOn) };
    return this.mapCache.canvas;
  }

  /** За дебъг/доклад: брой draw calls и триъгълници от последния кадър. */
  stats(): { calls: number; triangles: number } { const i = this.engine.renderer.info.render; return { calls: i.calls, triangles: i.triangles }; }
}

