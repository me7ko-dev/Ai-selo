// Дъжд (струи + пръски по земята), светулки/светли прашинки, празникът (огън с дим и искри, фенери, гирлянди),
// мълния (видима светкавица в далечината).
import * as THREE from 'three';
import { heightAt } from './height';
import { PAL } from './palette';
import { GLADE, POND } from './plan';
import { PLACES } from '../data/layout';
import { Batch } from './geom';

// ---------------------------------------------------------------- дъжд
/** Струите: тесни ленти, обърнати към камерата, удължени по посоката на падане (размазване от движението). */
export class Rain {
  readonly mesh: THREE.Mesh;
  readonly u = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(0.15, 0.05) }, uAmount: { value: 0 },
    uColor: { value: new THREE.Color('#b8c4cc') }, uFlash: { value: 0 },
  };
  constructor(count = 7000) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const off = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) off.set([Math.random() * 70 - 35, Math.random() * 40, Math.random() * 70 - 35, Math.random()], i * 4);
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; uniform float uAmount;
        attribute vec4 aOff; varying float vA; varying vec2 vUv;
        void main() {
          vec3 p = aOff.xyz;
          float sp = 22.0 + aOff.w * 8.0;
          p.y = mod(p.y - uTime * sp, 40.0);
          vec3 w = vec3(uWind.x, 0.0, uWind.y);
          p.x = mod(p.x - uCam.x + 35.0 + w.x * uTime * sp, 70.0) - 35.0 + uCam.x;
          p.z = mod(p.z - uCam.z + 35.0 + w.z * uTime * sp, 70.0) - 35.0 + uCam.z;
          p.y += uCam.y - 14.0;
          // лентата: по посоката на падане, обърната към камерата
          vec3 fall = normalize(vec3(-w.x, 1.0, -w.z));
          vec3 toCam = normalize(uCam - p);
          vec3 side = normalize(cross(fall, toCam));
          float len = 0.55 + aOff.w * 0.35;
          float d = length(uCam - p);
          float wid = 0.011 + d * 0.0011;
          p += fall * (uv.y - 0.5) * len + side * (uv.x - 0.5) * wid;
          vA = step(aOff.w, uAmount) * (0.25 + 0.3 * aOff.w) * smoothstep(0.6, 2.5, d);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uFlash; varying float vA; varying vec2 vUv;
        void main(){ if (vA < 0.01) discard;
          float a = vA * (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
          gl_FragColor = vec4(uColor * (1.0 + uFlash * 4.0), a); }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.visible = false; this.mesh.name = 'rain';
  }
  /** skyLight — колко светло е небето (цветът на струите следи осветеността). */
  update(time: number, cam: THREE.Vector3, amount: number, wind: number, skyLight?: THREE.Color, flash = 0): void {
    this.mesh.visible = amount > 0.01;
    this.u.uTime.value = time; this.u.uCam.value.copy(cam); this.u.uAmount.value = amount;
    this.u.uWind.value.set(0.12 + wind * 0.45, 0.04 + wind * 0.15);
    if (skyLight) this.u.uColor.value.copy(skyLight).multiplyScalar(0.55);
    this.u.uFlash.value = flash;
  }
  setDensity(frac: number): void { (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.floor(7000 * frac); }
}

/** Пръски: малки разширяващи се кръгчета по земята около камерата. */
export class Splashes {
  readonly mesh: THREE.InstancedMesh;
  private n: number;
  private seeds: Float32Array;
  private lastPhase: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private s = new THREE.Vector3(1, 1, 1);
  private v = new THREE.Vector3();
  readonly u = { uTime: { value: 0 }, uAmount: { value: 0 }, uColor: { value: new THREE.Color(0.5, 0.55, 0.6) } };
  constructor(n = 420) {
    this.n = n;
    const geo = new THREE.PlaneGeometry(1, 1);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) seed[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        uniform float uTime; attribute float aSeed; varying vec2 vUv; varying float vPh;
        void main() {
          vPh = fract(uTime * 2.2 + aSeed);
          vUv = uv;
          float r = 0.03 + vPh * 0.14;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position * r * 2.0, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uAmount; varying vec2 vUv; varying float vPh;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.8, 0.92, d) * smoothstep(1.0, 0.94, d);
          float a = ring * (1.0 - vPh) * (1.0 - vPh) * uAmount * 0.35;
          if (a < 0.005) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 4; this.mesh.name = 'splashes';
    this.seeds = seed;
    this.lastPhase = new Float32Array(n).fill(2);
  }
  update(time: number, cam: THREE.Vector3, amount: number, skyLight?: THREE.Color): void {
    this.mesh.visible = amount > 0.05;
    if (!this.mesh.visible) return;
    this.u.uTime.value = time; this.u.uAmount.value = Math.min(1, amount * 1.3);
    if (skyLight) this.u.uColor.value.copy(skyLight).multiplyScalar(0.5);
    let dirty = false;
    for (let i = 0; i < this.n; i++) {
      const ph = (time * 2.2 + this.seeds[i]) % 1;
      if (ph < this.lastPhase[i]) {
        // нова капка: случайно място до ~16 м от камерата (повече близо)
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.pow(Math.random(), 0.7) * 15;
        const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
        this.m.compose(this.v.set(x, heightAt(x, z) + 0.04, z), this.q, this.s);
        this.mesh.setMatrixAt(i, this.m);
        dirty = true;
      }
      this.lastPhase[i] = ph;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- мълния
/** Видима мълния в далечината (начупена светеща линия от облаците до земята). */
export class Lightning {
  readonly mesh: THREE.Mesh;
  private life = 0;
  private mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `attribute float aW; varying float vW; void main(){ vW = aW; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uI; varying float vW; void main(){ float a = 1.0 - abs(vW); gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * uI * a * a * 30.0, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 950; this.mesh.name = 'lightning';
  }
  /** Нов удар в посока от камерата (на 250–500 м). */
  strike(cam: THREE.Vector3): void {
    const a = Math.random() * Math.PI * 2, dist = 250 + Math.random() * 250;
    const gx = cam.x + Math.cos(a) * dist, gz = cam.z + Math.sin(a) * dist;
    const top = new THREE.Vector3(gx + (Math.random() - 0.5) * 60, 260, gz + (Math.random() - 0.5) * 60);
    const bottom = new THREE.Vector3(gx, Math.max(0, heightAt(Math.max(-299, Math.min(299, gx)), Math.max(-299, Math.min(299, gz)))), gz);
    const pos: number[] = [], w: number[] = [], idx: number[] = [];
    const toCam = new THREE.Vector3();
    const addBolt = (from: THREE.Vector3, to: THREE.Vector3, segs: number, width: number, jag: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const p = from.clone().lerp(to, t);
        if (i > 0 && i < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag * 0.4, (Math.random() - 0.5) * jag));
        pts.push(p);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const dir = p1.clone().sub(p0).normalize();
        toCam.copy(cam).sub(p0).normalize();
        const side = dir.clone().cross(toCam).normalize().multiplyScalar(width);
        const b = pos.length / 3;
        pos.push(p0.x - side.x, p0.y - side.y, p0.z - side.z, p0.x + side.x, p0.y + side.y, p0.z + side.z,
          p1.x - side.x, p1.y - side.y, p1.z - side.z, p1.x + side.x, p1.y + side.y, p1.z + side.z);
        w.push(-1, 1, -1, 1);
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
      return pts;
    };
    const main = addBolt(top, bottom, 18, 0.9, 28);
    // клонки
    for (let k = 0; k < 3; k++) {
      const s = main[3 + Math.floor(Math.random() * 10)];
      const end = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 70, -40 - Math.random() * 60, (Math.random() - 0.5) * 70));
      addBolt(s, end, 8, 0.45, 16);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(w, 1));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.life = 0.32;
    this.mesh.visible = true;
  }
  update(dt: number): void {
    if (this.life <= 0) { this.mesh.visible = false; return; }
    this.life -= dt;
    const t = this.life / 0.32;
    // трепти 2–3 пъти, после гасне
    this.mat.uniforms.uI.value = Math.max(0, t) * (0.55 + 0.45 * Math.sign(Math.sin(t * 40)));
  }
}

// ---------------------------------------------------------------- светулки (поляната, гората)
export class Motes {
  readonly points: THREE.Points;
  readonly u = { uTime: { value: 0 }, uAmount: { value: 0 }, uSize: { value: 1 } };
  constructor() {
    const pts: number[] = [], seeds: number[] = [], cols: number[] = [];
    const add = (cx: number, cz: number, r: number, n: number, col: [number, number, number]) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * r, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        pts.push(x, heightAt(x, z) + 0.4 + Math.random() * 2.2, z); seeds.push(Math.random() * 100); cols.push(...col);
      }
    };
    add(GLADE.x, GLADE.z, 34, 260, [0.75, 1.0, 0.85]);
    add(POND.x, POND.z, 16, 90, [0.7, 0.85, 1.0]);
    add(-150, -60, 90, 260, [0.95, 0.95, 0.55]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        uniform float uTime; uniform float uSize; attribute float aSeed; attribute vec3 color; varying vec3 vC; varying float vA;
        void main() {
          vec3 p = position + vec3(sin(uTime * 0.5 + aSeed) * 0.8, sin(uTime * 0.9 + aSeed * 2.0) * 0.4, cos(uTime * 0.4 + aSeed * 1.3) * 0.8);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = 0.5 + 0.5 * sin(uTime * 2.3 + aSeed * 5.0);
          vC = color;
          gl_PointSize = uSize * 7.0 * (0.6 + vA * 0.6) * (30.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: /* glsl */`
        uniform float uAmount; varying vec3 vC; varying float vA;
        void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.0, r);
          // светулките светят сами — малко над прага на блясъка
          gl_FragColor = vec4(vC * (a * a * 0.9), a * uAmount * (0.4 + vA * 0.6)); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'motes'; this.points.renderOrder = 6; this.points.visible = false;
  }
  update(time: number, amount: number, pixelRatio: number): void {
    this.u.uTime.value = time; this.u.uAmount.value = amount; this.u.uSize.value = pixelRatio;
    this.points.visible = amount > 0.01;
  }
}

// ---------------------------------------------------------------- празникът (сбор)
const fireVert = /* glsl */`
uniform float uTime; varying vec2 vUv; varying float vSeed;
attribute float aSeed;
void main() {
  vUv = uv; vSeed = aSeed;
  // цилиндричен билборд: въртим около вертикалата към камерата
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCam = cameraPosition - c; toCam.y = 0.0; toCam = normalize(toCam);
  vec3 right = vec3(toCam.z, 0.0, -toCam.x);
  float a = aSeed * 6.2831;
  vec3 r2 = normalize(right * cos(a * 0.15) + toCam * sin(a * 0.15) * 0.3);
  vec3 wp = c + r2 * position.x * (1.0 + 0.08 * sin(uTime * 7.0 + aSeed * 9.0)) + vec3(0.0, position.y, 0.0) + toCam * (aSeed - 0.5) * 0.3;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const fireFrag = /* glsl */`
uniform float uTime; uniform sampler2D tNoise; uniform float uI; varying vec2 vUv; varying float vSeed;
void main() {
  vec2 uv = vUv;
  float t = uTime * (1.3 + vSeed * 0.4);
  // шумът тече нагоре, изкривява пламъка
  float n1 = texture2D(tNoise, vec2(uv.x * 0.9 + vSeed, uv.y * 0.55 - t * 0.55)).r;
  float n2 = texture2D(tNoise, vec2(uv.x * 2.1 - vSeed, uv.y * 1.2 - t * 1.1)).b;
  float n = n1 * 0.65 + n2 * 0.35;
  // форма: широко и плътно долу; нагоре се къса на езици (шумът), които се люшкат
  float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 0.9 * uv.y;
  float w = mix(0.9, 0.12, pow(uv.y, 0.7));
  float shape = 1.0 - smoothstep(w * 0.35, w, abs(x));
  float tongues = smoothstep(uv.y * 0.95 - 0.05, uv.y * 0.95 + 0.3, n);
  float f = shape * tongues * smoothstep(0.0, 0.06, uv.y);
  f = clamp(f * 1.6, 0.0, 1.0);
  // цвят: бяло-жълта сърцевина → оранжево → червено
  vec3 col = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.62, 0.18), smoothstep(0.15, 0.55, f));
  col = mix(col, vec3(1.0, 0.92, 0.7), smoothstep(0.7, 0.95, f));
  gl_FragColor = vec4(col * f * uI, f);
}`;

const smokeVert = /* glsl */`
uniform float uTime; attribute float aSeed; varying vec2 vUv; varying float vA; varying float vH;
void main() {
  float life = fract(uTime * 0.12 + aSeed);
  vH = life;
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 drift = vec3(sin(aSeed * 40.0 + uTime * 0.3) * 0.6 + life * 1.8, life * 9.0 + 1.2, cos(aSeed * 23.0) * 0.6 + life * 0.8);
  float size = 0.6 + life * 3.2;
  vec3 toCam = normalize(cameraPosition - (c + drift));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  float rot = aSeed * 6.28 + uTime * 0.2;
  vec2 p = vec2(position.x * cos(rot) - position.y * sin(rot), position.x * sin(rot) + position.y * cos(rot));
  vec3 wp = c + drift + (right * p.x + up * p.y) * size;
  vUv = uv;
  vA = smoothstep(0.0, 0.12, life) * (1.0 - life);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const smokeFrag = /* glsl */`
uniform sampler2D tNoise; uniform vec3 uLight; uniform vec3 uGlow; varying vec2 vUv; varying float vA; varying float vH;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float n = texture2D(tNoise, vUv * 0.7 + vH * 0.3).r;
  float a = smoothstep(1.0, 0.2, d + (n - 0.5) * 0.6) * vA * 0.32;
  if (a < 0.004) discard;
  vec3 col = uLight * 0.35 + uGlow * (1.0 - smoothstep(0.0, 0.35, vH)) * 0.6;
  gl_FragColor = vec4(col, a);
}`;

export class Festival {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight('#ff9a4a', 0, 34, 1.6);
  private flames: THREE.Mesh;
  private smoke: THREE.Mesh;
  private lanternMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private sparks: THREE.Points;
  private on = false;
  readonly pos: THREE.Vector3;
  private fireU = { uTime: { value: 0 }, uI: { value: 8 }, tNoise: { value: null as THREE.Texture | null } };
  private smokeU = { uTime: { value: 0 }, tNoise: { value: null as THREE.Texture | null }, uLight: { value: new THREE.Color(0.3, 0.3, 0.3) }, uGlow: { value: new THREE.Color(1.0, 0.45, 0.15) } };

  constructor(solid: THREE.Material, noise: THREE.Texture | null = null) {
    const sq = PLACES.square.pos;
    const fx = sq.x, fz = sq.z + 10.5, fy = heightAt(fx, fz);
    this.pos = new THREE.Vector3(fx, fy, fz);
    this.group.name = 'festival'; this.group.visible = false;
    this.fireU.tNoise.value = noise; this.smokeU.tNoise.value = noise;
    // огънят: кръг камъни + цепеници
    const b = new Batch();
    b.push(fx, fy, fz);
    for (let k = 0; k < 10; k++) { const a = (k / 10) * 6.28; b.box(0.45, 0.3, 0.35, Math.sin(a) * 1.2, 0.12, Math.cos(a) * 1.2, PAL.stoneDark, a); }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.28; b.beam(Math.sin(a) * 0.9, 0.1, Math.cos(a) * 0.9, 0, 1.1, 0, 0.16, '#4a3424'); }
    b.pop();
    // гирлянди и фенери между стълбове около мегдана
    const poles: [number, number][] = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.28 + 0.39; poles.push([sq.x + Math.sin(a) * 16.5, sq.z + Math.cos(a) * 16.5]); }
    const lan = new Batch();
    const flagCols = [PAL.red, '#f2ead8', '#e8c27a', '#3f6b8f', PAL.red, '#7fb069'];
    poles.forEach(([x, z], k) => {
      const y = heightAt(x, z);
      b.box(0.14, 4.2, 0.14, x, y + 2.1, z, PAL.wood);
      const [nx, nz] = poles[(k + 1) % poles.length]; const ny = heightAt(nx, nz);
      // провиснал шнур с флагчета и фенерчета
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const t = i / n, sag = Math.sin(t * Math.PI) * 0.9;
        const px = x + (nx - x) * t, pz = z + (nz - z) * t, py = y + 4.0 + (ny - y) * t - sag;
        if (i < n) {
          const t2 = (i + 1) / n, qx = x + (nx - x) * t2, qz = z + (nz - z) * t2, qy = y + 4.0 + (ny - y) * t2 - Math.sin(t2 * Math.PI) * 0.9;
          b.beam(px, py, pz, qx, qy, qz, 0.03, '#3a2a1c');
          const ang = Math.atan2(qx - px, qz - pz);
          b.geo(triangleGeo(), flagCols[(i + k) % flagCols.length], (px + qx) / 2, (py + qy) / 2 - 0.25, (pz + qz) / 2, 0, ang + Math.PI / 2, 0, 1, 1, 1, 0);
        }
        if (i % 3 === 1) {
          lan.box(0.28, 0.36, 0.28, px, py - 0.35, pz, '#ffb04a', 0, 0, 0, 0);
          b.box(0.34, 0.06, 0.34, px, py - 0.14, pz, '#3a2a1c');
        }
      }
    });
    const solidMesh = b.build(solid, { name: 'festival' })!;
    const lanternMesh = lan.build(this.lanternMat, { castShadow: false, receiveShadow: false, name: 'lanterns' })!;
    this.group.add(solidMesh, lanternMesh);
    // пламъците: няколко кръстосани билборда с течащ шум (HDR → блясък)
    const fg = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1.7, 2.9); plane.translate(0, 1.45, 0);
    fg.index = plane.index; fg.setAttribute('position', plane.attributes.position); fg.setAttribute('uv', plane.attributes.uv);
    fg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array([0.1, 0.45, 0.8, 0.27]), 1));
    fg.instanceCount = 4;
    fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 3);
    this.flames = new THREE.Mesh(fg, new THREE.ShaderMaterial({
      uniforms: this.fireU, vertexShader: fireVert, fragmentShader: fireFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.flames.position.copy(this.pos).add(new THREE.Vector3(0, 0.15, 0));
    this.flames.renderOrder = 7;
    this.group.add(this.flames);
    // дим: меки въртящи се петна, които се издигат и разширяват
    const sg = new THREE.InstancedBufferGeometry();
    const sp = new THREE.PlaneGeometry(1, 1);
    sg.index = sp.index; sg.setAttribute('position', sp.attributes.position); sg.setAttribute('uv', sp.attributes.uv);
    const seeds = new Float32Array(26); for (let i = 0; i < seeds.length; i++) seeds[i] = i / seeds.length + Math.random() * 0.02;
    sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    sg.instanceCount = seeds.length;
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, 0), 10);
    this.smoke = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      uniforms: this.smokeU, vertexShader: smokeVert, fragmentShader: smokeFrag, transparent: true, depthWrite: false,
    }));
    this.smoke.position.copy(this.pos);
    this.smoke.renderOrder = 6;
    this.group.add(this.smoke);
    // искри
    const spos = new Float32Array(160 * 3), ss = new Float32Array(160);
    for (let i = 0; i < 160; i++) { spos.set([(Math.random() - 0.5) * 1.2, Math.random() * 6, (Math.random() - 0.5) * 1.2], i * 3); ss[i] = Math.random() * 10; }
    const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3)); sgeo.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1));
    this.sparks = new THREE.Points(sgeo, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uI: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; uniform float uI; attribute float aSeed; varying float vA; void main(){ vec3 p = position; float t = fract(uTime * (0.22 + fract(aSeed) * 0.15) + aSeed * 0.1);
        p.y = 0.6 + t * (5.0 + fract(aSeed * 3.7) * 4.0); p.x += sin(uTime * 1.3 + aSeed) * t * 1.6; p.z += cos(uTime * 0.9 + aSeed) * t * 1.6; vA = (1.0 - t) * step(0.3, fract(aSeed * 7.3 + uTime * 3.0) + 0.5) * uI;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 34.0 / max(1.0, -mv.z); }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(vec3(1.0, 0.55, 0.18) * vA * 6.0 * (1.0 - r * 2.0), 1.0); }`,
    }));
    this.sparks.position.copy(this.pos); this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    this.light.position.copy(this.pos).add(new THREE.Vector3(0, 2.2, 0));
  }
  set(on: boolean): void { this.on = on; this.group.visible = on; if (!on) this.light.intensity = 0; }
  /** ambient — околната светлина (за дима); exposure — текущата експонация (огънят не бива да „прегаря“ в бяло). */
  update(time: number, night: number, ambient?: THREE.Color, exposure = 1): void {
    if (!this.on) return;
    this.fireU.uTime.value = time;
    this.smokeU.uTime.value = time;
    const su = (this.sparks.material as THREE.ShaderMaterial).uniforms;
    su.uTime.value = time; su.uI.value = 1.6 / Math.max(0.6, exposure);
    const fl = 0.75 + 0.15 * Math.sin(time * 11) + 0.1 * Math.sin(time * 23.7 + 1.3);
    this.fireU.uI.value = (3.2 / Math.max(0.6, exposure)) * (0.85 + fl * 0.2);
    if (ambient) this.smokeU.uLight.value.copy(ambient);
    this.light.intensity = (8 + night * 22) * fl;
    // фенерчетата: топла HDR светлина (малко над прага на блясъка нощем)
    this.lanternMat.color.setScalar(0.5 + night * 1.1 + 0.05 * Math.sin(time * 5));
  }
}
function triangleGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.18, 0.2, 0, 0.18, 0.2, 0, 0, -0.2, 0, 0.18, 0.2, 0, -0.18, 0.2, 0, 0, -0.2, 0], 3));
  g.computeVertexNormals();
  return g;
}
