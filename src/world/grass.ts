// Туфи трева и цветя около героя: мрежа от клетки, които се пренареждат, когато героят мине в нова клетка.
// Люлеят се във вертекс шейдъра (евтино).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from './height';
import { BASE_N } from './ground';
import { WORLD_HALF } from '../data/layout';

const CELL = 8;

function tuftGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7, r = 0.12 + (i % 2) * 0.08, h = 0.45 + ((i * 37) % 10) / 30;
    const lean = 0.18;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, w = 0.07;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([x - px, 0, z - pz, x + px, 0, z + pz, x + Math.cos(a) * lean, h, z + Math.sin(a) * lean], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const c0 = [0.25, 0.42, 0.18], c1 = [0.55, 0.72, 0.32];
    g.setAttribute('color', new THREE.Float32BufferAttribute([...c0, ...c0, ...c1], 3));
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}
function flowerTuftGeo(): THREE.BufferGeometry {
  const g = tuftGeo();
  const extra = new THREE.IcosahedronGeometry(0.07, 0).toNonIndexed();
  extra.deleteAttribute('uv');
  extra.translate(0.05, 0.55, 0.02);
  const n = extra.attributes.position.count;
  extra.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(1), 3));
  return mergeGeometries([g, extra], false)!;
}

export class GrassField {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private slots: string[] = [];
  private R = 5;            // клетки във всяка посока
  private perCell = 70;
  readonly uniforms = { uTime: { value: 0 }, uWind: { value: 0.6 } };
  private lastKey = '';
  private dummy = new THREE.Matrix4();

  constructor(private mask: Uint8Array, private base?: Uint8ClampedArray) { this.group.name = 'grass'; }

  setDensity(level: 0 | 1 | 2 | 3): void {
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = []; this.slots = []; this.lastKey = '';
    if (level === 0) return;
    this.R = level === 1 ? 3 : level === 2 ? 4 : 5;
    this.perCell = level === 1 ? 45 : level === 2 ? 70 : 100;
    const side = this.R * 2 + 1, cells = side * side;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime; sh.uniforms.uWind = this.uniforms.uWind;
      sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
        vec2 ip = vec2(0.0);
        #endif
        float sw = sin(uTime * (1.6 + uWind) + ip.x * 0.35 + ip.y * 0.21) + 0.5 * sin(uTime * 3.1 + ip.x * 0.9);
        transformed.x += sw * 0.09 * uWind * position.y * 2.0;
        transformed.z += cos(uTime * 1.3 + ip.y * 0.4) * 0.05 * uWind * position.y * 2.0;`);
      sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = vec3(0.0, 1.0, 0.0);');
    };
    for (const [geo, frac] of [[tuftGeo(), 0.88], [flowerTuftGeo(), 0.12]] as const) {
      const count = Math.ceil(cells * this.perCell * frac);
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < count; i++) { im.setMatrixAt(i, zero); im.setColorAt(i, white); }
      this.meshes.push(im); this.group.add(im);
    }
    this.slots = new Array(cells).fill('');
  }

  update(focus: THREE.Vector3, time: number): void {
    this.uniforms.uTime.value = time;
    if (!this.meshes.length) return;
    const cx = Math.floor(focus.x / CELL), cz = Math.floor(focus.z / CELL);
    const key = `${cx},${cz}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const side = this.R * 2 + 1;
    let budget = 40; // клетки на кадър
    for (let dz = -this.R; dz <= this.R; dz++) for (let dx = -this.R; dx <= this.R; dx++) {
      const gx = cx + dx, gz = cz + dz;
      const slot = (((gz % side) + side) % side) * side + (((gx % side) + side) % side);
      const want = `${gx},${gz}`;
      if (this.slots[slot] === want) continue;
      if (budget-- <= 0) { this.lastKey = ''; continue; }
      this.slots[slot] = want;
      this.fillCell(slot, gx, gz);
    }
    for (const m of this.meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  private fillCell(slot: number, gx: number, gz: number): void {
    const cells = this.slots.length;
    const q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    let seed = (Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663)) >>> 0;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (const im of this.meshes) {
      const per = Math.floor(im.count / cells), base = slot * per;
      for (let k = 0; k < per; k++) {
        const x = gx * CELL + rnd() * CELL, z = gz * CELL + rnd() * CELL;
        const mi = Math.floor(((x + WORLD_HALF) / (WORLD_HALF * 2)) * BASE_N), mj = Math.floor(((z + WORLD_HALF) / (WORLD_HALF * 2)) * BASE_N);
        const dens = mi >= 0 && mj >= 0 && mi < BASE_N && mj < BASE_N ? this.mask[mj * BASE_N + mi] / 255 : 0;
        const r = rnd(), sc = 0.45 + rnd() * 0.4, rot = rnd() * 6.28, tint = rnd();
        if (r > dens) { this.dummy.makeScale(0, 0, 0); im.setMatrixAt(base + k, this.dummy); continue; }
        q.setFromEuler(e.set(0, rot, 0));
        this.dummy.compose(v.set(x, heightAt(x, z) - 0.03, z), q, s.set(sc, sc * (0.8 + dens * 0.5), sc));
        im.setMatrixAt(base + k, this.dummy);
        if (im === this.meshes[1]) { const fc = [[1, 1, 1], [1, 0.85, 0.3], [0.95, 0.55, 0.7], [0.65, 0.72, 1]][Math.floor(tint * 4)]; c.setRGB(fc[0], fc[1], fc[2]); }
        else if (this.base) {
          // оттенък по цвета на земята под туфата (гората — тъмно, блатото — маслинено, поляната — сочно)
          const bi = (mj * BASE_N + mi) * 4;
          c.setRGB((this.base[bi] / 111) * (0.85 + tint * 0.3), (this.base[bi + 1] / 154) * (0.9 + tint * 0.2), (this.base[bi + 2] / 74) * (0.85 + tint * 0.2));
        } else c.setRGB(0.85 + tint * 0.3, 0.9 + tint * 0.2, 0.8 + tint * 0.2);
        im.setColorAt(base + k, c);
      }
    }
  }
}
