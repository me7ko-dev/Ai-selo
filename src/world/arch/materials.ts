// Материалите на сградите: PBR текстури от Poly Haven (CC0, виж public/assets/CREDITS.md) + цвят по върховете.
// Стъклата светят нощем (emissive по цвета на върха — някои прозорци са по-тъмни), жарта в ковачницата трепти.
import * as THREE from 'three';
import { pbr } from '../tex';
import type { Slot } from './kit';

type Quality = 'low' | 'medium' | 'high';

/** Коя текстура за кой слот и колко силна е релефната карта. */
const TEX: Partial<Record<Slot, { id: string; normal: number }>> = {
  plaster: { id: 'plastered_wall', normal: 0.9 },
  stone: { id: 'stone_wall', normal: 1.25 },
  masonry: { id: 'castle_wall_varriation', normal: 1.15 },
  timber: { id: 'rough_wood', normal: 1.1 },
  planks: { id: 'old_planks_02', normal: 1.0 },
  roof: { id: 'clay_roof_tiles_02', normal: 1.35 },
  bark: { id: 'bark_brown_02', normal: 1.2 },
  hay: { id: 'reed_roof_04', normal: 1.0 },
  rock: { id: 'rock_boulder_dry', normal: 1.2 },
};

let mats: Record<Slot, THREE.Material> | null = null;
const saved = new Map<THREE.MeshStandardMaterial, { normalMap: THREE.Texture | null; aoMap: THREE.Texture | null }>();

/** Всички материали (създават се веднъж и се делят от целия свят). */
export function archMaterials(): Record<Slot, THREE.Material> {
  if (mats) return mats;
  const m = {} as Record<Slot, THREE.Material>;
  for (const [slot, t] of Object.entries(TEX) as [Slot, { id: string; normal: number }][]) {
    const mat = new THREE.MeshStandardMaterial({ ...pbr(t.id), vertexColors: true });
    mat.normalScale.set(t.normal, t.normal);
    mat.name = 'arch_' + slot;
    saved.set(mat, { normalMap: mat.normalMap, aoMap: mat.aoMap });
    m[slot] = mat;
  }
  // обикновени (без текстура): плат, цветя, кости, желязо (тъмен цвят)
  m.plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08, name: 'arch_plain' });
  m.iron = m.plain;
  // стъклото: тъмно и гладко денем (отразява небето), топло светло нощем — силата идва от archTick
  const glass = new THREE.MeshStandardMaterial({ color: '#2a2b2c', roughness: 0.1, metalness: 0, vertexColors: true, emissive: '#ffd9a0', emissiveIntensity: 0, name: 'arch_glass' });
  glass.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
  };
  glass.customProgramCacheKey = () => 'arch_glass';
  m.glass = glass;
  m.hot = new THREE.MeshBasicMaterial({ vertexColors: true, name: 'arch_hot' });
  m.wet = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.04, metalness: 0, vertexColors: true, name: 'arch_wet' });
  // листата на ореха: атлас 2×2 снопа сложни листа (рисуват се на canvas); двете страни се осветяват еднакво
  const leaves = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45, name: 'arch_leaves', map: leafAtlas() });
  leaves.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };
  leaves.customProgramCacheKey = () => 'arch_leaves';
  m.leaves = leaves;
  mats = m;
  return m;
}

/** Атлас с листа на орех (сложни листа: дръжка + 5–9 продълговати листчета), прозрачен фон. В Node — празна текстура. */
function leafAtlas(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const leaflet = (x: number, y: number, ang: number, len: number, wid: number, col: string) => {
    c.save(); c.translate(x, y); c.rotate(ang);
    const g = c.createLinearGradient(0, -wid, 0, wid);
    g.addColorStop(0, col); g.addColorStop(0.5, shadeCss(col, 1.18)); g.addColorStop(1, shadeCss(col, 0.8));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 0);
    c.bezierCurveTo(len * 0.25, -wid, len * 0.75, -wid * 0.9, len, 0);
    c.bezierCurveTo(len * 0.75, wid * 0.9, len * 0.25, wid, 0, 0);
    c.fill();
    c.strokeStyle = 'rgba(30,50,10,0.35)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(len * 0.95, 0); c.stroke();
    c.restore();
  };
  const greens = ['#4f7a2c', '#5d8a34', '#466e28', '#6a9440', '#3e6424', '#58803a'];
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * (S / 2), oy = Math.floor(q / 2) * (S / 2), H = S / 2;
    c.save(); c.beginPath(); c.rect(ox, oy, H, H); c.clip();
    for (let l = 0; l < 9; l++) {
      // сложен лист: дръжка от ръба към вътре, двойки листчета, едно на върха
      const cx = ox + H * (0.2 + rnd() * 0.6), cy = oy + H * (0.2 + rnd() * 0.6);
      const ang = rnd() * Math.PI * 2, len = H * (0.32 + rnd() * 0.18), pairs = 2 + Math.floor(rnd() * 3);
      const col = greens[Math.floor(rnd() * greens.length)];
      const sx = cx - Math.cos(ang) * len * 0.5, sy = cy - Math.sin(ang) * len * 0.5;
      c.strokeStyle = '#4a5a28'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len); c.stroke();
      for (let k = 0; k < pairs; k++) {
        const t = 0.3 + (k / pairs) * 0.6, px = sx + Math.cos(ang) * len * t, py = sy + Math.sin(ang) * len * t;
        const ll = len * (0.32 + t * 0.12), ww = ll * 0.26;
        leaflet(px, py, ang + 1.0 + (rnd() - 0.5) * 0.3, ll, ww, col);
        leaflet(px, py, ang - 1.0 + (rnd() - 0.5) * 0.3, ll, ww, col);
      }
      leaflet(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len, ang, len * 0.45, len * 0.12, col);
    }
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function shadeCss(hex: string, f: number): string { const k = new THREE.Color(hex).multiplyScalar(f); return '#' + k.getHexString(); }

/** Ниско качество: без релефни карти и AO (по-лек шейдър); средно/високо — пълно. */
export function setArchQuality(q: Quality): void {
  if (!mats) return;
  for (const [mat, s] of saved) {
    const nm = q === 'low' ? null : s.normalMap, ao = q === 'low' ? null : s.aoMap;
    if (mat.normalMap !== nm || mat.aoMap !== ao) { mat.normalMap = nm; mat.aoMap = ao; mat.needsUpdate = true; }
  }
}

/** Всеки кадър: lit 0..1 — колко светят прозорците (нощ/здрач/буря), flick — трептене на жарта. */
export function archTick(lit: number, flick: number): void {
  if (!mats) return;
  (mats.glass as THREE.MeshStandardMaterial).emissiveIntensity = lit * 1.9;
  (mats.hot as THREE.MeshBasicMaterial).color.setScalar(0.85 + 0.15 * flick);
}
