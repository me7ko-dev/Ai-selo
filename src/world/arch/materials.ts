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
  m.leaves = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5, name: 'arch_leaves' });
  mats = m;
  return m;
}

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
