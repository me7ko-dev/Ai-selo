// Строител на статична геометрия: всичко с цвят по върховете → сливане в малко мрежи (малко draw calls).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Подготвя геометрия за сливане: без индекси, без uv, с атрибут color. */
export function prep(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, seed = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  _c.set(color);
  let r = _c.r, gg = _c.g, b = _c.b;
  for (let i = 0; i < n; i++) {
    if (jitter && i % 6 === 0) {
      const h = Math.sin((i + seed * 131) * 12.9898) * 43758.5453, f = 1 + (h - Math.floor(h) - 0.5) * jitter;
      r = _c.r * f; gg = _c.g * f; b = _c.b * f;
    }
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Batch {
  parts: THREE.BufferGeometry[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  get top(): THREE.Matrix4 { return this.stack[this.stack.length - 1]; }
  /** Работи в локални координати: позиция + завъртане около y (+ мащаб). */
  push(x: number, y: number, z: number, rotY = 0, scale = 1): void {
    _q.setFromEuler(_e.set(0, rotY, 0));
    _m.compose(_v.set(x, y, z), _q, _s.set(scale, scale, scale));
    this.stack.push(this.top.clone().multiply(_m));
  }
  pushMatrix(m: THREE.Matrix4): void { this.stack.push(this.top.clone().multiply(m)); }
  pop(): void { if (this.stack.length > 1) this.stack.pop(); }

  /** Добавя геометрия (вече prep-ната или не) с локална матрица. */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, local?: THREE.Matrix4, jitter = 0.06): void {
    const g = prep(geo, color, jitter, this.parts.length);
    g.applyMatrix4(local ? this.top.clone().multiply(local) : this.top);
    this.parts.push(g);
  }
  /** Кутия с център (x, y, z) в локалните координати; rx/ry/rz завъртане. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0, rx = 0, rz = 0, jitter = 0.06): void {
    const g = new THREE.BoxGeometry(w, h, d);
    _q.setFromEuler(_e.set(rx, ry, rz));
    this.add(g, color, new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)), jitter);
  }
  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, rx = 0, ry = 0, rz = 0, jitter = 0.06): void {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
    _q.setFromEuler(_e.set(rx, ry, rz));
    this.add(g, color, new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)), jitter);
  }
  /** Геометрия с произволна трансформация. */
  geo(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, jitter = 0.06): void {
    _q.setFromEuler(_e.set(rx, ry, rz));
    this.add(g, color, new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)), jitter);
  }
  /** Тънка греда между две точки (в локалните координати). */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, color: THREE.ColorRepresentation): void {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(t, len, t);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.add(g, color, new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), q, _s.set(1, 1, 1)));
  }
  /** Сурови триъгълници (позиции в локалните координати) с цвят. */
  tris(pos: number[], color: THREE.ColorRepresentation, jitter = 0): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    this.add(g, color, undefined, jitter);
  }

  build(material: THREE.Material, opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) return null;
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    mesh.matrixAutoUpdate = false;
    mesh.name = opts.name ?? 'batch';
    return mesh;
  }
}

/** Деформира върховете на геометрия с шум (за скали, храсти) — детерминистично. */
export function lumpy(g: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const offs = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = key(x, y, z);
    let o = offs.get(k);
    if (o === undefined) { const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.618) * 43758.5453; o = 1 + (h - Math.floor(h) - 0.5) * amount; offs.set(k, o); }
    p.setXYZ(i, x * o, y * o, z * o);
  }
  g.computeVertexNormals();
  return g;
}

/** Обща материя за всичко с цветове по върховете (low-poly, плоско осветяване). */
export function vertexColorMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
}
