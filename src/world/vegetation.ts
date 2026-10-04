// Дървета, храсти, камъни, папрат, гъби, дънери, цветя — InstancedMesh на парчета (за отрязване извън кадър
// и по разстояние). Цветовете са в геометрията (по върховете) + лек оттенък на всеки екземпляр.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { prep, lumpy } from './geom';
import { heightAt, normalAt } from './height';
import type { TreeInst } from './plan';
import { PAL } from './palette';

const CHUNK = 100;

function g(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, jitter = 0.08, rx = 0, rz = 0): THREE.BufferGeometry {
  const p = prep(geo, color, jitter, Math.floor(x * 10 + y * 7));
  p.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  return p;
}
const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list, false)!;

export function pineGeo(): THREE.BufferGeometry {
  return merge([
    g(new THREE.CylinderGeometry(0.16, 0.28, 2.6, 5), '#4a3424', 0, 1.3, 0),
    g(new THREE.ConeGeometry(2.3, 3.6, 7), '#2b4431', 0, 3.4, 0, 1, 1, 1, 0.2),
    g(new THREE.ConeGeometry(1.85, 3.2, 7), '#2f4a35', 0, 5.2, 0, 1, 1, 1, 0.6),
    g(new THREE.ConeGeometry(1.35, 2.8, 7), '#365640', 0, 6.9, 0, 1, 1, 1, 1.1),
    g(new THREE.ConeGeometry(0.8, 2.0, 6), '#3d5f45', 0, 8.4, 0, 1, 1, 1, 0.3),
  ]);
}
export function oakGeo(): THREE.BufferGeometry {
  return merge([
    g(new THREE.CylinderGeometry(0.22, 0.38, 3.2, 6), '#5a4636', 0, 1.6, 0),
    g(lumpy(new THREE.IcosahedronGeometry(2.4, 1), 0.3, 1), '#4f7a3a', 0, 4.6, 0, 1, 0.85, 1),
    g(lumpy(new THREE.IcosahedronGeometry(1.7, 0), 0.3, 2), '#5d8a40', 1.5, 4.0, 0.6, 1, 0.9, 1),
    g(lumpy(new THREE.IcosahedronGeometry(1.6, 0), 0.3, 3), '#466f34', -1.3, 4.3, -0.7, 1, 0.9, 1),
    g(lumpy(new THREE.IcosahedronGeometry(1.4, 0), 0.3, 4), '#6a9446', 0.3, 5.8, 0.2, 1, 0.9, 1),
  ]);
}
export function bushGeo(): THREE.BufferGeometry {
  return merge([
    g(lumpy(new THREE.IcosahedronGeometry(0.9, 0), 0.35, 5), '#4f7a3a', 0, 0.55, 0, 1.2, 0.8, 1),
    g(lumpy(new THREE.IcosahedronGeometry(0.65, 0), 0.35, 6), '#5d8a40', 0.6, 0.45, 0.2, 1, 0.8, 1),
  ]);
}
export function rockGeo(): THREE.BufferGeometry {
  return g(lumpy(new THREE.DodecahedronGeometry(1, 0), 0.45, 9), PAL.rock, 0, 0.25, 0, 1.2, 0.7, 1, 0, 0.12);
}
export function deadTreeGeo(): THREE.BufferGeometry {
  const c = '#5e554a';
  return merge([
    g(new THREE.CylinderGeometry(0.12, 0.3, 4.2, 5), c, 0, 2.1, 0, 1, 1, 1, 0, 0.1, 0.06, 0),
    g(new THREE.CylinderGeometry(0.04, 0.1, 1.8, 4), c, 0.6, 3.4, 0, 1, 1, 1, 0, 0.1, 0, -0.9),
    g(new THREE.CylinderGeometry(0.04, 0.1, 1.5, 4), c, -0.5, 2.8, 0.2, 1, 1, 1, 0, 0.1, 0.3, 0.9),
    g(new THREE.CylinderGeometry(0.03, 0.08, 1.2, 4), c, 0.1, 4.2, -0.4, 1, 1, 1, 0, 0.1, -0.7, 0.2),
  ]);
}
export function fernGeo(): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) list.push(g(new THREE.ConeGeometry(0.18, 1.1, 3), k % 2 ? '#3f6a34' : '#4d7a3c', Math.sin(k * 1.26) * 0.35, 0.4, Math.cos(k * 1.26) * 0.35, 1, 1, 0.35, k * 1.26, 0.1, 0.9, 0));
  return merge(list.map(x => x));
}
export function mushroomGeo(): THREE.BufferGeometry {
  return merge([
    g(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5), '#efe6d4', 0, 0.15, 0),
    g(new THREE.SphereGeometry(0.17, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#c23a2a', 0, 0.28, 0, 1, 0.7, 1),
    g(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 5), '#efe6d4', 0.22, 0.11, 0.1),
    g(new THREE.SphereGeometry(0.11, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), '#c9442e', 0.22, 0.2, 0.1, 1, 0.7, 1),
  ]);
}
export function logGeo(): THREE.BufferGeometry {
  return merge([
    g(new THREE.CylinderGeometry(0.3, 0.34, 4.2, 7), '#5a4232', 0, 0.3, 0, 1, 1, 1, 0, 0.1, 0, Math.PI / 2),
    g(new THREE.CylinderGeometry(0.31, 0.31, 0.02, 7), '#a8865a', 2.11, 0.3, 0, 1, 1, 1, 0, 0, 0, Math.PI / 2),
    g(lumpy(new THREE.IcosahedronGeometry(0.25, 0), 0.4, 3), '#4d7a3c', 0.5, 0.6, 0.1, 1.4, 0.4, 1),
  ]);
}
export function flowerGeo(): THREE.BufferGeometry {
  return merge([
    g(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 3), '#4f7a3a', 0, 0.17, 0),
    g(new THREE.IcosahedronGeometry(0.08, 0), '#ffffff', 0, 0.36, 0, 1, 0.6, 1, 0, 0),
    g(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 3), '#4f7a3a', 0.12, 0.14, 0.05),
    g(new THREE.IcosahedronGeometry(0.065, 0), '#ffffff', 0.12, 0.29, 0.05, 1, 0.6, 1, 0, 0),
  ]);
}

export interface InstGroup { name: string; meshes: THREE.InstancedMesh[]; maxDist: number }

/**
 * Строи InstancedMesh-и на парчета CHUNK×CHUNK м.
 * tint(t) връща цвят-множител за екземпляра; yOff — допълнително по y; tiltToGround — наклон по склона (камъни).
 */
export function instanced(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, list: TreeInst[], opts: {
  tint?: (t: TreeInst, c: THREE.Color) => void; yOff?: number; scaleY?: (t: TreeInst) => number; castShadow?: boolean; maxDist?: number; sink?: number;
} = {}): InstGroup {
  const buckets = new Map<string, TreeInst[]>();
  for (const t of list) {
    const k = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t);
  }
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  for (const arr of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach((t, i) => {
      // на стръмно — по-дълбоко в склона, за да не виси
      const steep = 1 - normalAt(t.x, t.z)[1];
      const y = heightAt(t.x, t.z) - (opts.sink ?? 0.15) * t.s - steep * 2.2 * t.s + (opts.yOff ?? 0);
      q.setFromEuler(e.set(0, t.rot, 0));
      m.compose(v.set(t.x, y, t.z), q, s.set(t.s, t.s * (opts.scaleY ? opts.scaleY(t) : 1), t.s));
      im.setMatrixAt(i, m);
      c.setRGB(1, 1, 1); opts.tint?.(t, c); im.setColorAt(i, c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.computeBoundingBox();
    im.castShadow = opts.castShadow ?? true; im.receiveShadow = true;
    im.name = name;
    meshes.push(im);
  }
  return { name, meshes, maxDist: opts.maxDist ?? 1e9 };
}
