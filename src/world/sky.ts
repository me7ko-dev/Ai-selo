// Небето: градиентен купол (шейдър) според часа, слънце, луна, звезди, стилизирани облаци;
// слънчева/лунна светлина със сенки около героя, полусферична светлина, мъгла в цвета на небето.
import * as THREE from 'three';
import { minuteOfDay, sunElevation } from '../core/time';
import { PAL } from './palette';

const C = (s: string) => new THREE.Color(s);
function sstep(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = /* glsl */`
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uSunColor; uniform vec3 uGlow;
uniform float uStars; uniform float uTime; uniform float uCloud; uniform vec3 uCloudLit; uniform vec3 uCloudShade;
uniform float uFlash; uniform float uSunVis; uniform float uMoonVis;
varying vec3 vDir;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += noise(p) * a; p = p * 2.07 + 13.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float h = max(y, 0.0);
  vec3 col = h < 0.1 ? mix(uHorizon, uMid, smoothstep(0.0, 0.1, h)) : mix(uMid, uTop, smoothstep(0.1, 0.6, h));
  // сиянието около слънцето (по-силно ниско над хоризонта)
  float sd = max(dot(d, uSunDir), 0.0);
  col += uGlow * pow(sd, 6.0) * (1.0 - h * 0.7);
  col += uGlow * 0.35 * pow(sd, 2.0) * (1.0 - h);
  // звезди
  if (uStars > 0.01 && y > 0.0) {
    vec3 sp = floor(d * 260.0);
    float st = hash3(sp);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + st * 80.0);
    col += vec3(0.95, 0.95, 1.0) * smoothstep(0.9975, 1.0, st) * tw * uStars * smoothstep(0.0, 0.25, y) * 1.6;
  }
  // слънчев диск
  float sun = smoothstep(0.9990, 0.9995, dot(d, uSunDir));
  col = mix(col, uSunColor * 1.6 + 0.4, sun * uSunVis);
  // луна
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.99935, 0.9996, md);
  float crat = 0.85 + 0.15 * noise(d.xz * 900.0);
  col += vec3(0.957, 0.925, 0.816) * 0.18 * pow(max(md, 0.0), 300.0) * uMoonVis;
  col = mix(col, vec3(0.957, 0.925, 0.816) * 1.15 * crat, moon * uMoonVis);
  // облаци (стилизирани, с ясни ръбове)
  if (y > 0.0 && uCloud > 0.01) {
    vec2 uv = d.xz / (y + 0.12) * 1.3 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(uv);
    float th = 1.0 - uCloud * 0.75;
    float c = smoothstep(th - 0.06, th + 0.08, n);
    float edge = smoothstep(th + 0.02, th + 0.22, n);
    vec3 cc = mix(uCloudLit, uCloudShade, edge * 0.85);
    cc += uGlow * 0.5 * pow(sd, 4.0);
    col = mix(col, cc, c * smoothstep(0.0, 0.18, y) * 0.95);
  }
  if (y < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, -0.25, y));
  col += vec3(0.75, 0.8, 1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyWeather { cloud: number; dark: number; fogNear: number; fogFar: number; flash: number }

export class SkySystem {
  readonly dome: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  readonly hemi = new THREE.HemisphereLight('#cfe3f0', '#5e7a45', 1.0);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, 1, 0);
  /** посоката на светлината, която хвърля сенки (слънце денем, луна нощем) */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  readonly horizon = new THREE.Color();
  readonly top = new THREE.Color();
  readonly fog: THREE.Fog;
  readonly u: Record<string, THREE.IUniform>;
  shadowExtent = 70;
  night = 0;      // 0 ден … 1 нощ
  twilight = 0;
  weather: SkyWeather = { cloud: 0.3, dark: 0, fogNear: 70, fogFar: 560, flash: 0 };
  /** добавка към плътността на мъглата (блатото, гората) */
  localFog = 0;

  constructor(private scene: THREE.Scene) {
    this.u = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uSunColor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
      uStars: { value: 0 }, uTime: { value: 0 }, uCloud: { value: 0.3 }, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
      uFlash: { value: 0 }, uSunVis: { value: 1 }, uMoonVis: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.dome.frustumCulled = false; this.dome.renderOrder = -1000; this.dome.name = 'sky';
    scene.add(this.dome);
    this.fog = new THREE.Fog('#c9dbe6', 70, 560);
    scene.fog = this.fog;
    this.sun.castShadow = true;
    const sc = this.sun.shadow;
    sc.mapSize.set(2048, 2048);
    sc.camera.near = 1; sc.camera.far = 420;
    sc.bias = -0.0004; sc.normalBias = 0.6;
    this.setShadowExtent(70);
    scene.add(this.sun, this.sun.target, this.hemi);
  }

  setShadowExtent(e: number): void {
    this.shadowExtent = e;
    const c = this.sun.shadow.camera;
    c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.updateProjectionMatrix();
  }

  update(totalMinutes: number, camera: THREE.Camera, focus: THREE.Vector3, timeSec: number): void {
    const e = sunElevation(totalMinutes);
    const h = minuteOfDay(totalMinutes) / 60;
    // посока на слънцето: изгрев на изток (+x), залез на запад (-x), по пладне на юг (+z), високо
    const dayT = Math.min(1, Math.max(0, (h - 6) / 14));
    const az = Math.PI * dayT;
    this.sunDir.set(Math.cos(az) * 0.95, e, 0.38 + 0.2 * Math.sin(az)).normalize();
    const nh = h >= 20 ? h - 20 : h < 6 ? h + 4 : -1;
    const moonT = nh >= 0 ? nh / 10 : (h < 13 ? 1 : 0);
    const mAz = Math.PI * moonT;
    const mEl = nh >= 0 ? Math.sin(moonT * Math.PI) * 0.8 : -0.3;
    this.moonDir.set(Math.cos(mAz) * 0.9, mEl, -0.45).normalize();

    const dayW = sstep(0.04, 0.4, e);
    const nightW = sstep(-0.02, -0.26, e);
    const twW = Math.max(0, 1 - dayW - nightW);
    this.night = nightW; this.twilight = twW;
    const w = this.weather;
    const grey = new THREE.Color('#8d949b');

    const mix3 = (a: string, b: string, c: string) => new THREE.Color(0, 0, 0)
      .add(C(a).multiplyScalar(dayW)).add(C(b).multiplyScalar(twW)).add(C(c).multiplyScalar(nightW));
    const top = mix3(PAL.dayTop, PAL.dawn[2], PAL.nightTop);
    const mid = mix3('#bcd8ee', PAL.dawn[1], '#16224a');
    const hor = mix3(PAL.dayHorizon, PAL.dawn[0], PAL.nightHorizon);
    // лошо време: по-сиво и по-тъмно
    const dk = w.dark;
    const greyN = grey.clone().multiplyScalar(1 - nightW * 0.8);
    top.lerp(greyN.clone().multiplyScalar(0.85), dk * 0.85); mid.lerp(greyN, dk * 0.85); hor.lerp(greyN.clone().multiplyScalar(1.05), dk * 0.8);
    this.top.copy(top); this.horizon.copy(hor);
    (this.u.uTop.value as THREE.Color).copy(top);
    (this.u.uMid.value as THREE.Color).copy(mid);
    (this.u.uHorizon.value as THREE.Color).copy(hor);
    (this.u.uGround.value as THREE.Color).copy(hor).multiplyScalar(0.8);
    const sunCol = new THREE.Color('#fff4dc').lerp(C('#ff9a55'), sstep(0.35, 0.02, e));
    (this.u.uSunColor.value as THREE.Color).copy(sunCol);
    (this.u.uGlow.value as THREE.Color).copy(C('#ffb36b')).multiplyScalar((twW * 0.55 + dayW * 0.12) * (1 - dk * 0.8));
    this.u.uStars.value = nightW * (1 - Math.min(1, w.cloud * 1.2)) + nightW * 0.15;
    this.u.uTime.value = timeSec;
    this.u.uCloud.value = w.cloud;
    (this.u.uCloudLit.value as THREE.Color).copy(mix3('#ffffff', '#ffd2a8', '#3a4a78')).lerp(C('#b9bec4').multiplyScalar(1 - nightW * 0.75), dk);
    (this.u.uCloudShade.value as THREE.Color).copy(mix3('#c6d3df', '#9a6a80', '#1c2546')).lerp(C('#6d747c').multiplyScalar(1 - nightW * 0.75), dk);
    this.u.uFlash.value = w.flash;
    this.u.uSunVis.value = sstep(-0.05, 0.02, e) * (1 - dk);
    this.u.uMoonVis.value = sstep(-0.05, 0.1, this.moonDir.y) * (1 - dk * 0.9) * (0.3 + nightW * 0.7);

    // мъглата е с цвета на хоризонта
    this.fog.color.copy(hor).lerp(mid, 0.3);
    const lf = this.localFog;
    this.fog.near = w.fogNear * (1 - lf * 0.9);
    this.fog.far = w.fogFar * (1 - lf * 0.75);

    // светлина: слънцето денем, луната нощем (по-слаба, синкава)
    const useMoon = e < -0.02;
    const L = useMoon ? this.moonDir : this.sunDir;
    this.lightDir.copy(L);
    if (this.lightDir.y < 0.12) this.lightDir.y = 0.12; this.lightDir.normalize();
    if (!useMoon) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = (0.15 + 2.6 * sstep(-0.02, 0.3, e)) * (1 - dk * 0.75);
    } else {
      this.sun.color.set('#9db2e6');
      this.sun.intensity = 0.75 * sstep(-0.02, -0.12, e) * sstep(-0.1, 0.15, this.moonDir.y) * (1 - dk * 0.7);
    }
    this.hemi.color.copy(mix3('#d6e6f2', '#f0b48c', '#4a63a8')).lerp(grey, dk * 0.6);
    this.hemi.groundColor.copy(mix3('#6a7f4a', '#6a4a4a', '#1a2238'));
    this.hemi.intensity = (dayW * 1.15 + twW * 0.85 + nightW * 0.75) * (1 - dk * 0.25) + w.flash * 3;

    // куполът и сенките следват камерата/героя
    this.dome.position.copy(camera.position);
    const ext = this.shadowExtent, texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.lightDir.x * 200, focus.y + this.lightDir.y * 200, fz + this.lightDir.z * 200);
    this.sun.target.updateMatrixWorld();
  }
}
