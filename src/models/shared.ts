// Общи материали, геометрии и текстури за моделите — кеширани и споделени между всички копия.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const matCache = new Map<string, THREE.Material>();

export interface MatOpts {
  emissive?: string | number;
  emissiveIntensity?: number;
  flat?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  map?: THREE.Texture | null;
  basic?: boolean;
}

/** Споделен материал по цвят и настройки (Lambert, плоско осветяване по подразбиране). */
export function mat(color: string | number, o: MatOpts = {}): THREE.Material {
  const key = `${color}|${o.emissive ?? ''}|${o.emissiveIntensity ?? ''}|${o.flat ?? true}|${o.side ?? 0}|${o.transparent ?? false}|${o.opacity ?? 1}|${o.map?.uuid ?? ''}|${o.basic ?? false}`;
  let m = matCache.get(key);
  if (!m) {
    if (o.basic) {
      m = new THREE.MeshBasicMaterial({ color, side: o.side ?? THREE.FrontSide, transparent: o.transparent ?? false, opacity: o.opacity ?? 1, map: o.map ?? null, fog: true });
    } else {
      const lm = new THREE.MeshLambertMaterial({
        color, flatShading: o.flat ?? true, side: o.side ?? THREE.FrontSide,
        transparent: o.transparent ?? false, opacity: o.opacity ?? 1, map: o.map ?? null,
      });
      if (o.emissive !== undefined) { lm.emissive.set(o.emissive); lm.emissiveIntensity = o.emissiveIntensity ?? 1; }
      m = lm;
    }
    if (o.transparent) m.depthWrite = false;
    matCache.set(key, m);
  }
  return m;
}

/** Ярък светещ материал (очи, роса, огън в устата) — без осветяване. */
export function glow(color: string | number, opacity = 1): THREE.Material {
  return mat(color, { basic: true, transparent: opacity < 1, opacity });
}

const flashCache = new Map<string, THREE.Material>();
/** Копие на материала с емисивен оттенък — за кратко „светване“ при удар. */
export function flashMat(orig: THREE.Material, color: number): THREE.Material {
  const key = orig.uuid + '|' + color;
  let m = flashCache.get(key);
  if (!m) {
    const c = new THREE.Color(color);
    if (orig instanceof THREE.MeshLambertMaterial) {
      const f = orig.clone();
      f.emissive.copy(c); f.emissiveIntensity = 0.65;
      m = f;
    } else if (orig instanceof THREE.MeshStandardMaterial) {
      const f = orig.clone();
      f.emissive.copy(c); f.emissiveIntensity = 0.35;
      m = f;
    } else if (orig instanceof THREE.MeshBasicMaterial) {
      const f = orig.clone();
      f.color.lerp(c, 0.5);
      m = f;
    } else m = orig;
    flashCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
export function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); g.userData.geoKey = key; geoCache.set(key, g); }
  return g;
}

/** Цилиндър с височина 1 и радиус 1 отдолу (y=0) догоре (y=1); r = горен/долен радиус. */
export function cylGeo(topRatio = 1, seg = 7, open = false, thetaLen = Math.PI * 2, thetaStart = 0): THREE.BufferGeometry {
  return cachedGeo(`cyl|${topRatio.toFixed(3)}|${seg}|${open}|${thetaLen.toFixed(3)}|${thetaStart.toFixed(3)}`, () => {
    const g = new THREE.CylinderGeometry(topRatio, 1, 1, seg, 1, open, thetaStart, thetaLen);
    g.translate(0, 0.5, 0);
    return g;
  });
}
/** Цилиндър, центриран (y от -0.5 до 0.5). */
export function cylCGeo(topRatio = 1, seg = 7): THREE.BufferGeometry {
  return cachedGeo(`cylc|${topRatio.toFixed(3)}|${seg}`, () => new THREE.CylinderGeometry(topRatio, 1, 1, seg, 1));
}
export function boxGeo(): THREE.BufferGeometry { return cachedGeo('box', () => new THREE.BoxGeometry(1, 1, 1)); }
export function sphGeo(detail = 1): THREE.BufferGeometry { return cachedGeo('ico|' + detail, () => new THREE.IcosahedronGeometry(1, detail)); }
export function lowSph(w = 8, h = 6): THREE.BufferGeometry { return cachedGeo(`sph|${w}|${h}`, () => new THREE.SphereGeometry(1, w, h)); }
export function coneGeo(seg = 6): THREE.BufferGeometry {
  return cachedGeo('cone|' + seg, () => { const g = new THREE.ConeGeometry(1, 1, seg); g.translate(0, 0.5, 0); return g; });
}
/** Полусфера (горната половина). */
export function capGeo(w = 9, h = 4, thetaLen = Math.PI / 2): THREE.BufferGeometry {
  return cachedGeo(`cap|${w}|${h}|${thetaLen.toFixed(3)}`, () => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, thetaLen));
}

export interface PartOpts { cast?: boolean; }
/** Добавя меш с мащаб/позиция/завъртане към родител. */
export function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material,
  sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = cast;
  parent.add(m);
  return m;
}

export function joint(parent: THREE.Object3D, x = 0, y = 0, z = 0, name = ''): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.name = name;
  parent.add(g);
  return g;
}

// ---------- текстури (само в браузъра; в Node връщат null) ----------
const hasDom = typeof document !== 'undefined';
const texCache = new Map<string, THREE.Texture | null>();

function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = false, rx = 1): THREE.Texture | null {
  if (texCache.has(key)) return texCache.get(key)!;
  let t: THREE.Texture | null = null;
  if (hasDom) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    if (c) {
      draw(c);
      t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.NearestFilter;
      t.anisotropy = 4;
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, 1); }
    }
  }
  texCache.set(key, t);
  return t;
}

/** Шевици: геометрични ромбове и зигзаг в червено и черно върху цвета на плата. */
export function shevicaTex(base: string, red = '#b3262b', dark = '#1a1414', light = '#efe6d4'): THREE.Texture | null {
  return canvasTex(`shev|${base}|${red}|${dark}`, 64, 64, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 64, 64);
    const baseIsRed = base.toLowerCase() === red.toLowerCase();
    const accent = baseIsRed ? light : red;
    // горна и долна лента
    const band = (y: number) => {
      c.fillStyle = dark; c.fillRect(0, y, 64, 2); c.fillRect(0, y + 12, 64, 2);
      for (let x = 0; x < 64; x += 8) {
        c.fillStyle = accent;
        c.beginPath(); c.moveTo(x + 4, y + 3); c.lineTo(x + 8, y + 7); c.lineTo(x + 4, y + 11); c.lineTo(x, y + 7); c.closePath(); c.fill();
        c.fillStyle = dark; c.fillRect(x + 3, y + 6, 2, 2);
      }
    };
    band(4); band(44);
    // зигзаг в средата
    c.strokeStyle = accent; c.lineWidth = 2; c.beginPath();
    for (let x = 0; x <= 64; x += 8) c.lineTo(x, (x / 8) % 2 ? 26 : 34);
    c.stroke();
    c.fillStyle = dark;
    for (let x = 4; x < 64; x += 16) { c.fillRect(x - 1, 29, 3, 3); }
  });
}

/** Ивица шевица (за подгъв/ръкав) — повтаря се хоризонтално. */
export function hemTex(base: string, red = '#b3262b', dark = '#1a1414'): THREE.Texture | null {
  return canvasTex(`hem|${base}|${red}|${dark}`, 64, 16, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 64, 16);
    c.fillStyle = dark; c.fillRect(0, 1, 64, 1); c.fillRect(0, 14, 64, 1);
    for (let x = 0; x < 64; x += 8) {
      c.fillStyle = red;
      c.beginPath(); c.moveTo(x + 4, 3); c.lineTo(x + 8, 8); c.lineTo(x + 4, 13); c.lineTo(x, 8); c.closePath(); c.fill();
      c.fillStyle = dark; c.fillRect(x + 3, 7, 2, 2);
    }
  }, true, 10);
}

/** Люспи (за Ламята): полукръгове в злато-зелено; долната част (корем) по-светла. */
export function scaleTex(belly: boolean): THREE.Texture | null {
  return canvasTex('scales|' + belly, 64, 64, (c) => {
    if (belly) {
      c.fillStyle = '#c9c07a'; c.fillRect(0, 0, 64, 64);
      c.fillStyle = '#a89c5a';
      for (let y = 0; y < 64; y += 8) c.fillRect(0, y, 64, 2);
      return;
    }
    c.fillStyle = '#3f5a2a'; c.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 5; col++) {
        const x = col * 16 + (row % 2 ? 8 : 0), y = row * 8;
        const g = c.createRadialGradient(x, y + 2, 1, x, y, 9);
        g.addColorStop(0, '#b9a64a'); g.addColorStop(0.6, '#6f8a36'); g.addColorStop(1, '#2e4420');
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, 8, 0, Math.PI); c.fill();
      }
    }
  }, true);
}

/** Мек кръгъл ореол (за спрайтове: роса, сияние). */
export function haloTex(): THREE.Texture | null {
  return canvasTex('halo', 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });
}

const spriteMatCache = new Map<string, THREE.SpriteMaterial>();
export function haloSprite(color: string | number, size: number, opacity = 0.7): THREE.Sprite {
  const key = `${color}|${opacity}`;
  let m = spriteMatCache.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({ color, map: haloTex(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    spriteMatCache.set(key, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, size);
  return s;
}

/** Брой триъгълници в обект (за проби и отчети). */
export function countTris(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return Math.round(n);
}

// ---------- сливане на мешове (по-малко draw call-ове) ----------
const _mtx = new THREE.Matrix4();

/** Копие на геометрията на меша, пренесено в пространството toSpace (неиндексирано, само position/normal/uv). */
export function bakeGeometry(m: THREE.Mesh, toSpace: THREE.Matrix4): THREE.BufferGeometry {
  const src = m.geometry;
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  m.updateWorldMatrix(true, false);
  g.applyMatrix4(_mtx.multiplyMatrices(toSpace, m.matrixWorld));
  return g;
}

export function mergeList(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 1) return geos[0];
  const g = mergeGeometries(geos);
  if (!g) throw new Error('mergeGeometries failed');
  for (const x of geos) x.dispose();
  return g;
}

/** Слива статичните мешове в група: по един меш на материал (спрайтовете остават). За предмети. */
export function mergeStatic(root: THREE.Object3D, skip?: THREE.Object3D): void {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  const remove: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.children.length) return;
    if (skip) for (let p: THREE.Object3D | null = m; p && p !== root; p = p.parent) if (p === skip) return;
    let gr = groups.get(m.material);
    if (!gr) { gr = { geos: [], cast: false }; groups.set(m.material, gr); }
    gr.geos.push(bakeGeometry(m, inv));
    gr.cast ||= m.castShadow;
    remove.push(m);
  });
  for (const m of remove) m.removeFromParent();
  for (const [material, gr] of groups) {
    const mesh = new THREE.Mesh(mergeList(gr.geos), material);
    mesh.castShadow = gr.cast;
    root.add(mesh);
  }
}
