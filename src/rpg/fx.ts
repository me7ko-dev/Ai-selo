// Прости ефекти: кръгове-предупреждения на земята, огън (частици), горяща земя, падащи камъни, стрели.
import * as THREE from 'three';
import type { WorldQuery } from '../core/world-query';
import { stoneGeometry, addTriplanar } from '../world/trees/rocks';
import { loadTex } from '../world/tex';

/** Кръг на земята (предупреждение къде ще удари). */
export class GroundRing {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  constructor(scene: THREE.Scene, radius: number, color = 0xff5533) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.82, radius, 32), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  place(x: number, z: number, world: WorldQuery): void { this.mesh.position.set(x, world.heightAt(x, z) + 0.12, z); }
  /** 0..1 — колко остава до удара (запълване). */
  progress(p: number): void { const s = 0.4 + 0.6 * p; this.mesh.scale.setScalar(s); this.mat.opacity = 0.25 + 0.5 * p; }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/** Огнени частици (един общ облак). */
export class FireParticles {
  private N = 260;
  private pts: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.N * 3).fill(-9999);
    this.vel = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xff8a2a, size: 0.9, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.pts = new THREE.Points(g, m);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life = 0.7): void {
    const i = this.next; this.next = (this.next + 1) % this.N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
  }
  update(dt: number): void {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] += 1.5 * dt;
    }
    (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void { this.pts.removeFromParent(); this.pts.geometry.dispose(); (this.pts.material as THREE.Material).dispose(); }
}

/** Горяща земя — щети, докато стоиш в нея. */
export interface BurnPatch { x: number; z: number; r: number; t: number; mesh: THREE.Mesh }

export class BurnPatches {
  list: BurnPatch[] = [];
  private geo = new THREE.CircleGeometry(1, 20);
  private mat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  constructor(private scene: THREE.Scene, private fire: FireParticles) {}
  add(x: number, z: number, r: number, t: number, world: WorldQuery): void {
    const m = new THREE.Mesh(this.geo, this.mat);
    m.rotation.x = -Math.PI / 2; m.scale.setScalar(r);
    m.position.set(x, world.heightAt(x, z) + 0.1, z);
    this.scene.add(m);
    this.list.push({ x, z, r, t, mesh: m });
  }
  update(dt: number): void {
    for (const p of this.list) {
      p.t -= dt;
      if (Math.random() < dt * 14) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * p.r;
        this.fire.emit(p.x + Math.cos(a) * d, p.mesh.position.y + 0.1, p.z + Math.sin(a) * d, 0, 1.5 + Math.random(), 0, 0.6);
      }
    }
    for (const p of this.list.filter(q => q.t <= 0)) p.mesh.removeFromParent();
    this.list = this.list.filter(q => q.t > 0);
  }
  inside(x: number, z: number): boolean { return this.list.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r); }
  clear(): void { for (const p of this.list) p.mesh.removeFromParent(); this.list = []; }
  dispose(): void { this.clear(); this.geo.dispose(); this.mat.dispose(); }
}

/** Падащи камъни (фаза 3 на Ламята). */
export interface Rock { x: number; z: number; t: number; ring: GroundRing; mesh: THREE.Mesh; landed: boolean }

export class Rockfall {
  list: Rock[] = [];
  // три различни камъка от шум (като скалите в света), текстура на скала отвсякъде (без UV)
  private geos = [11, 23, 37].map((seed) => stoneGeometry(seed, 0.85, 3));
  private mat = Rockfall.material();
  private n = 0;
  constructor(private scene: THREE.Scene) {}
  private static material(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0xb4aca0, roughness: 0.9, metalness: 0 });
    addTriplanar(m, {
      map: loadTex('tex/rock_boulder_dry/rock_boulder_dry_diff_1k.jpg', { srgb: true }),
      nor: loadTex('tex/rock_boulder_dry/rock_boulder_dry_nor_gl_1k.jpg'),
      moss: loadTex('tex/mossy_rock/mossy_rock_diff_1k.jpg', { srgb: true }),
      scale: 0.5, moss01: 0.15,
    });
    return m;
  }
  add(x: number, z: number, delay: number, world: WorldQuery): void {
    const ring = new GroundRing(this.scene, 2, 0xffaa44); ring.place(x, z, world);
    const mesh = new THREE.Mesh(this.geos[this.n++ % this.geos.length], this.mat); mesh.castShadow = true;
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    mesh.position.set(x, world.heightAt(x, z) + 30, z);
    this.scene.add(mesh);
    this.list.push({ x, z, t: delay, ring, mesh, landed: false });
  }
  /** Връща камъните, които паднаха този кадър. */
  update(dt: number, world: WorldQuery): Rock[] {
    const landed: Rock[] = [];
    for (const r of this.list) {
      r.t -= dt;
      const g = world.heightAt(r.x, r.z);
      if (!r.landed) {
        r.ring.progress(Math.max(0, 1 - r.t / 1.3));
        r.mesh.position.y = g + 0.6 + Math.max(0, r.t) * 22;
        r.mesh.rotation.x += dt * 4;
        if (r.t <= 0) { r.landed = true; landed.push(r); r.ring.dispose(); }
      } else if (r.t < -2.5) { r.mesh.removeFromParent(); }
    }
    this.list = this.list.filter(r => r.t >= -2.5);
    return landed;
  }
  clear(): void { for (const r of this.list) { r.mesh.removeFromParent(); if (!r.landed) r.ring.dispose(); } this.list = []; }
  dispose(): void { this.clear(); for (const g of this.geos) g.dispose(); this.mat.dispose(); }
}

/** Стрели от лъка на Калин. */
export interface Arrow { pos: THREE.Vector3; vel: THREE.Vector3; t: number; mesh: THREE.Mesh; damage: number }

export class Arrows {
  list: Arrow[] = [];
  private geo = new THREE.CylinderGeometry(0.025, 0.025, 0.8, 5).rotateX(Math.PI / 2);
  private mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f });
  constructor(private scene: THREE.Scene) {}
  shoot(from: THREE.Vector3, dir: THREE.Vector3, damage: number): void {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.copy(from);
    const vel = dir.clone().normalize().multiplyScalar(38);
    mesh.lookAt(from.clone().add(vel));
    this.scene.add(mesh);
    this.list.push({ pos: from.clone(), vel, t: 1.6, mesh, damage });
  }
  /** hit(pos) → true, ако стрелата е ударила нещо (тогава изчезва). */
  update(dt: number, world: WorldQuery, hit: (a: Arrow) => boolean): void {
    for (const a of this.list) {
      a.t -= dt;
      a.vel.y -= 4 * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.pos.clone().add(a.vel));
      if (a.pos.y < world.heightAt(a.pos.x, a.pos.z)) a.t = Math.min(a.t, 0);
      else if (hit(a)) a.t = -1;
    }
    for (const a of this.list) if (a.t <= 0) a.mesh.removeFromParent();
    this.list = this.list.filter(a => a.t > 0);
  }
  dispose(): void { for (const a of this.list) a.mesh.removeFromParent(); this.list = []; this.geo.dispose(); this.mat.dispose(); }
}
