// Дъжд, светулки/светли прашинки, празникът (огън, фенери, гирлянди).
import * as THREE from 'three';
import { heightAt } from './height';
import { PAL } from './palette';
import { GLADE, POND } from './plan';
import { PLACES } from '../data/layout';
import { Batch } from './geom';

// ---------------------------------------------------------------- дъжд
export class Rain {
  readonly mesh: THREE.LineSegments;
  readonly u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(0.15, 0.05) }, uAmount: { value: 0 }, uColor: { value: new THREE.Color('#b8c4cc') } };
  constructor(count = 9000) {
    const pos = new Float32Array(count * 6), seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 70 - 35, y = Math.random() * 40, z = Math.random() * 70 - 35, r = Math.random();
      pos.set([x, y, z, x, y, z], i * 6); seed.set([r, 0, r, 1], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; uniform float uAmount;
        attribute vec2 aSeed; varying float vA;
        void main() {
          vec3 p = position;
          float sp = 22.0 + aSeed.x * 8.0;
          p.y = mod(p.y - uTime * sp, 40.0);
          vec3 w = vec3(uWind.x, 0.0, uWind.y);
          p.x = mod(p.x - uCam.x + 35.0 + w.x * uTime * sp, 70.0) - 35.0 + uCam.x;
          p.z = mod(p.z - uCam.z + 35.0 + w.z * uTime * sp, 70.0) - 35.0 + uCam.z;
          p.y += uCam.y - 14.0;
          // втората точка на чертичката — малко нагоре и по вятъра
          p += (vec3(-w.x, 1.0, -w.z)) * aSeed.y * 0.7;
          vA = step(aSeed.x, uAmount) * (0.35 + 0.35 * aSeed.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(uColor, vA); }`,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.visible = false; this.mesh.name = 'rain';
  }
  update(time: number, cam: THREE.Vector3, amount: number, wind: number): void {
    this.mesh.visible = amount > 0.01;
    this.u.uTime.value = time; this.u.uCam.value.copy(cam); this.u.uAmount.value = amount;
    this.u.uWind.value.set(0.12 + wind * 0.45, 0.04 + wind * 0.15);
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
          gl_PointSize = uSize * 9.0 * (0.6 + vA * 0.6) * (30.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: /* glsl */`
        uniform float uAmount; varying vec3 vC; varying float vA;
        void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vC * (a * a * 1.5), a * uAmount * (0.4 + vA * 0.6)); }`,
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
export class Festival {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight('#ff9a4a', 0, 34, 1.6);
  private flames: THREE.Mesh;
  private lanternMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private sparks: THREE.Points;
  private on = false;
  readonly pos: THREE.Vector3;

  constructor(solid: THREE.Material) {
    const sq = PLACES.square.pos;
    const fx = sq.x, fz = sq.z + 10.5, fy = heightAt(fx, fz);
    this.pos = new THREE.Vector3(fx, fy, fz);
    this.group.name = 'festival'; this.group.visible = false;
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
    // пламъците: няколко конуса с адитивен шейдър
    const fg = new THREE.ConeGeometry(0.7, 2.2, 8, 1, true);
    fg.translate(0, 1.1, 0);
    const fmat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `uniform float uTime; varying float vH; void main(){ vec3 p = position; vH = p.y / 2.2;
        float w = sin(uTime * 9.0 + p.y * 3.0 + p.x * 4.0) * 0.12 * vH; p.x += w; p.z += cos(uTime * 7.0 + p.y * 2.0) * 0.1 * vH;
        p.xz *= 1.0 - vH * 0.2 + 0.08 * sin(uTime * 13.0 + p.y * 5.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `varying float vH; void main(){ vec3 c = mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 0.3, 0.05), vH);
        gl_FragColor = vec4(c * (1.0 - vH) * 1.4, (1.0 - vH) * 0.9); }`,
    });
    this.flames = new THREE.Mesh(fg, fmat);
    const f2 = new THREE.Mesh(fg, fmat); f2.scale.set(0.6, 1.4, 0.6); f2.rotation.y = 1;
    const f3 = new THREE.Mesh(fg, fmat); f3.scale.set(0.8, 0.8, 0.8); f3.position.set(0.3, 0, -0.2);
    this.flames.add(f2, f3);
    this.flames.position.copy(this.pos).add(new THREE.Vector3(0, 0.25, 0));
    this.group.add(this.flames);
    // искри
    const sp = new Float32Array(120 * 3), ss = new Float32Array(120);
    for (let i = 0; i < 120; i++) { sp.set([(Math.random() - 0.5) * 1.2, Math.random() * 6, (Math.random() - 0.5) * 1.2], i * 3); ss[i] = Math.random() * 10; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1));
    this.sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; attribute float aSeed; varying float vA; void main(){ vec3 p = position; float t = fract(uTime * 0.25 + aSeed * 0.1);
        p.y = t * 7.0; p.x += sin(uTime + aSeed) * t * 1.2; p.z += cos(uTime * 0.7 + aSeed) * t * 1.2; vA = 1.0 - t;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 60.0 / max(1.0, -mv.z); }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(1.0, 0.6, 0.2, vA); }`,
    }));
    this.sparks.position.copy(this.pos); this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    this.light.position.copy(this.pos).add(new THREE.Vector3(0, 2.2, 0));
  }
  set(on: boolean): void { this.on = on; this.group.visible = on; if (!on) this.light.intensity = 0; }
  update(time: number, night: number): void {
    if (!this.on) return;
    (this.flames.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    (this.sparks.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    const fl = 0.75 + 0.15 * Math.sin(time * 11) + 0.1 * Math.sin(time * 23.7 + 1.3);
    this.light.intensity = (8 + night * 22) * fl;
    this.lanternMat.color.setScalar(0.55 + night * 0.65 + 0.05 * Math.sin(time * 5));
  }
}
function triangleGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.18, 0.2, 0, 0.18, 0.2, 0, 0, -0.2, 0, 0.18, 0.2, 0, -0.18, 0.2, 0, 0, -0.2, 0], 3));
  g.computeVertexNormals();
  return g;
}
