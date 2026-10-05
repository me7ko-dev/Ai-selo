// Общо зареждане на текстури и модели от public/assets/ (Poly Haven, Quaternius… — виж public/assets/CREDITS.md).
// В Node (пробите) няма браузър: връщаме празни 1×1 текстури, за да може светът да се строи и тества.
import * as THREE from 'three';

/** Адресът на public/assets/ спрямо страницата (Vite base: './'). */
export const ASSET_BASE: string = (((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) ?? './') + 'assets/';

export const hasDom = (): boolean => typeof document !== 'undefined' && typeof Image !== 'undefined';

let maxAniso = 8;
/** Вика се веднъж от Engine — колко анизотропно филтриране позволява видеокартата. */
export function setMaxAnisotropy(n: number): void { maxAniso = Math.max(1, n); }

const cache = new Map<string, THREE.Texture>();
let loader: THREE.TextureLoader | null = null;

/** Брой текстури, които още се зареждат (за екрана „Зарежда се…“). */
export const texLoading = { pending: 0, done: 0, onChange: null as null | (() => void) };

export interface TexOpts {
  /** Цветна текстура (diff) — в sRGB; картите (нормали, грапавост) — линейни. */
  srgb?: boolean;
  repeat?: number | [number, number];
  /** Анизотропия: по подразбиране максималната (за земя под ъгъл е важно). */
  aniso?: number;
  wrap?: boolean;
}

/** Една текстура от public/assets/<rel>. Кешира се по адрес + настройки. */
export function loadTex(rel: string, o: TexOpts = {}): THREE.Texture {
  const rep = typeof o.repeat === 'number' ? [o.repeat, o.repeat] : o.repeat ?? [1, 1];
  const key = `${rel}|${o.srgb ? 1 : 0}|${rep[0]},${rep[1]}|${o.wrap === false ? 0 : 1}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let t: THREE.Texture;
  if (!hasDom()) {
    t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    t.needsUpdate = true;
  } else {
    loader ??= new THREE.TextureLoader();
    texLoading.pending++; texLoading.onChange?.();
    const fin = () => { texLoading.pending--; texLoading.done++; texLoading.onChange?.(); };
    t = loader.load(ASSET_BASE + rel, fin, undefined, (e) => { console.warn('Липсва текстура: ' + rel, e); fin(); });
  }
  if (o.srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (o.wrap !== false) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.repeat.set(rep[0], rep[1]);
  t.anisotropy = o.aniso ?? maxAniso;
  cache.set(key, t);
  return t;
}

export type PbrMap = 'diff' | 'nor_gl' | 'arm' | 'rough' | 'ao' | 'disp';

/**
 * Карти на PBR текстура от Poly Haven (свалена с tools/fetch-polyhaven.mjs).
 * arm = AO (R) + грапавост (G) + метал (B) — една текстура за три канала на MeshStandardMaterial.
 */
export function pbr(id: string, o: { res?: string; repeat?: number | [number, number]; maps?: PbrMap[] } = {}): Partial<THREE.MeshStandardMaterialParameters> {
  const res = o.res ?? '1k';
  const maps = o.maps ?? ['diff', 'nor_gl', 'arm'];
  const f = (m: PbrMap) => `tex/${id}/${id}_${m}_${res}.jpg`;
  const p: Partial<THREE.MeshStandardMaterialParameters> = {};
  if (maps.includes('diff')) p.map = loadTex(f('diff'), { srgb: true, repeat: o.repeat });
  if (maps.includes('nor_gl')) p.normalMap = loadTex(f('nor_gl'), { repeat: o.repeat });
  if (maps.includes('arm')) {
    const arm = loadTex(f('arm'), { repeat: o.repeat });
    p.aoMap = arm; p.roughnessMap = arm; p.metalnessMap = arm; p.metalness = 1; p.roughness = 1;
  } else {
    if (maps.includes('rough')) { p.roughnessMap = loadTex(f('rough'), { repeat: o.repeat }); p.roughness = 1; }
    if (maps.includes('ao')) p.aoMap = loadTex(f('ao'), { repeat: o.repeat });
  }
  return p;
}
