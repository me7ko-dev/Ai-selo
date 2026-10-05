// Зареждане на хората (public/assets/chars/people.glb + anims.glb, сглобени с tools/build-characters.mjs).
// Веднъж при старта на играта; после фабриките в src/models/index.ts клонират от кеша.
// Ако нещо не стане (няма браузър, файлът липсва, стар браузър) — играта ползва процедурните модели.
import * as THREE from 'three';
import type { BodyKind } from './looks';
import { N_GARMENTS } from './looks';

/** Адресът на public/assets/ спрямо страницата (Vite base: './'). */
const ASSET_BASE: string = (((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) ?? './') + 'assets/';

export interface BodyTemplate {
  kind: BodyKind;
  /** Скелетът с мешовете (клонира се с SkeletonUtils.clone). */
  armature: THREE.Object3D;
  /** Височина на таза в покой (за мащаба на крачката и на анимациите). */
  pelvisHeight: number;
  /** Анимациите, нагласени към това тяло (отместването на таза е мащабирано). */
  clips: Map<string, THREE.AnimationClip>;
  /** Посока „напред-встрани“ в покой: световните завъртания на костите (в пространството на тялото). */
  bindWorld: Map<string, THREE.Quaternion>;
  bindPos: Map<string, THREE.Vector3>;
}

export interface CharAssets {
  bodies: Record<BodyKind, BodyTemplate>;
  hair: THREE.Mesh;
  /** Скоростта (м/с) на ходенето/тичането в клипа (от варианта с root motion), за манекена. */
  speeds: Record<string, number>;
  animPelvis: number;
  materials: Record<'peasant' | 'ranger' | 'folk' | 'skinM' | 'skinF' | 'eyes' | 'hair', THREE.MeshStandardMaterial>;
  quality: string;
}

let assets: CharAssets | null = null;
let loading: Promise<boolean> | null = null;

export function charAssets(): CharAssets | null { return assets; }
export function charactersReady(): boolean { return !!assets; }

// ───────────────────────────── пребоядисване на дрехите ─────────────────────────────
// Всеки връх носи етикет на дрехата (_garment). Цветът = цвят от палитрата × (яркост на текстурата / средната
// яркост на тази дреха в оригинала) — гънките, шевовете и тъканта остават, сменя се само боята.
// gCol[i].a = сила (0 = оригиналната текстура). Алфата на текстурата (за носията) пази нарисуваните шевици.
const RECOLOR_FRAG = /* glsl */`
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  int gi = int( vGarment + 0.5 );
  vec4 gc = gCol[ gi ];
  float gL = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 gRc = gc.rgb * clamp( gL / max( gRef[ gi ], 1e-4 ), 0.0, 2.6 );
  diffuseColor.rgb *= mix( sampledDiffuseColor.rgb, gRc, gc.a * sampledDiffuseColor.a );
#endif
`;

export interface RecolorUniforms { gCol: { value: Float32Array }; gRef: { value: Float32Array } }

/** Копие на материала с пребоядисване по етикет (текстурите се споделят). */
export function recolorMaterial(base: THREE.MeshStandardMaterial, palette: Float32Array): THREE.MeshStandardMaterial {
  const m = base.clone();
  const ref = new Float32Array(N_GARMENTS).fill(0.5);
  const r = (base.userData?.garmentRef as number[] | undefined) ?? [];
  for (let i = 0; i < Math.min(N_GARMENTS, r.length); i++) ref[i] = r[i] || 0.5;
  const u: RecolorUniforms = { gCol: { value: palette }, gRef: { value: ref } };
  m.userData = { ...base.userData, recolor: u };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.gCol = u.gCol;
    sh.uniforms.gRef = u.gRef;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _garment;\nflat varying float vGarment;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGarment = _garment;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 gCol[ ${N_GARMENTS} ];\nuniform float gRef[ ${N_GARMENTS} ];\nflat varying float vGarment;`)
      .replace('#include <map_fragment>', RECOLOR_FRAG);
  };
  m.customProgramCacheKey = () => 'recolor-v1';
  return m;
}

// ───────────────────────────── зареждане ─────────────────────────────
function pelvisZ(o: THREE.Object3D): number {
  const p = o.getObjectByName('pelvis');
  return p ? p.position.z : 0.93;
}

/** Анимацията за дадено тяло: само завъртания + таза (мащабиран към ръста на тялото). */
function retarget(clip: THREE.AnimationClip, bones: Set<string>, scale: number): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const [node, prop] = t.name.split('.');
    if (!bones.has(node)) continue;
    if (prop === 'quaternion') tracks.push(t);
    else if (prop === 'position' && node === 'pelvis') {
      const c = t.clone();
      for (let i = 0; i < c.values.length; i++) c.values[i] *= scale;
      tracks.push(c);
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function bindPose(armature: THREE.Object3D): { rot: Map<string, THREE.Quaternion>; pos: Map<string, THREE.Vector3> } {
  armature.updateMatrixWorld(true);
  const inv = armature.matrixWorld.clone().invert();
  const rot = new Map<string, THREE.Quaternion>(), pos = new Map<string, THREE.Vector3>();
  const m = new THREE.Matrix4(), s = new THREE.Vector3();
  armature.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const q = new THREE.Quaternion(), p = new THREE.Vector3();
    m.decompose(p, q, s);
    rot.set(o.name, q); pos.set(o.name, p);
  });
  return { rot, pos };
}

/**
 * Зарежда хората. Вика се веднъж при старта (преди да се направят жителите); onProgress(0..1).
 * quality 'low' → не зарежда нищо (процедурните модели са по-леки за телефони).
 */
export function preloadCharacters(opts: { quality?: string; onProgress?: (p: number) => void } = {}): Promise<boolean> {
  if (assets) return Promise.resolve(true);
  if (loading) return loading;
  if (typeof document === 'undefined' || typeof window === 'undefined') return Promise.resolve(false);
  if (opts.quality === 'low') return Promise.resolve(false);
  // за сравнение на бързината: VITE_PEOPLE=0 npm run build → само процедурните хора
  if ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PEOPLE === '0') return Promise.resolve(false);
  loading = (async () => {
    try {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const prog = [0, 0];
      const report = () => opts.onProgress?.(Math.min(1, (prog[0] * 0.8 + prog[1] * 0.2)));
      const load = (file: string, k: 0 | 1) => loader.loadAsync(ASSET_BASE + 'chars/' + file, (e) => {
        if (e.total) { prog[k] = e.loaded / e.total; report(); }
      });
      const [people, anims] = await Promise.all([load('people.glb', 0), load('anims.glb', 1)]);
      initCharacterAssets(people, anims, opts.quality ?? 'high');
      opts.onProgress?.(1);
      return true;
    } catch (e) {
      console.warn('Хората (GLB) не се заредиха — ползват се процедурните модели.', e);
      return false;
    }
  })();
  return loading;
}

/** Заредените GLTF (people.glb + anims.glb) → шаблони за клониране. Отделно, за да се ползва и в пробите (Node). */
export interface LoadedGltf { scene: THREE.Group; animations: THREE.AnimationClip[]; userData: Record<string, unknown>; parser: { json: unknown; associations: Map<THREE.Object3D | THREE.Material | THREE.Texture, unknown> } }
export function initCharacterAssets(people: LoadedGltf, anims: LoadedGltf, quality = 'high'): void {
  const scene = people.scene;
  // GLTFLoader прави имената уникални (втори скелет: „pelvis_1“…) — връщаме истинските, по тях вървят анимациите
  const json = people.parser.json as { nodes: { name?: string }[] };
  scene.traverse((o) => {
    const ref = people.parser.associations.get(o) as { nodes?: number } | undefined;
    const n = ref?.nodes !== undefined ? json.nodes[ref.nodes]?.name : undefined;
    if (n && (o as THREE.Bone).isBone) o.name = THREE.PropertyBinding.sanitizeNodeName(n);
  });
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    mats.set(mat.name, mat);
    m.castShadow = true;
    m.receiveShadow = true;
  });
  const need = (n: string) => { const m = mats.get(n); if (!m) throw new Error('липсва материал ' + n); return m; };
  const materials = {
    peasant: need('cloth_peasant'), ranger: need('cloth_ranger'), folk: need('folk'),
    skinM: need('skin_m'), skinF: need('skin_f'), eyes: need('eyes'), hair: need('hair'),
  };
  // тъканите и косата — матови; кожата — мека, без пластмасов блясък
  for (const m of Object.values(materials)) {
    for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.anisotropy = 4;
    m.envMapIntensity = 1;
  }
  materials.folk.roughness = 0.95;
  materials.hair.roughness = 0.55;
  for (const s of [materials.skinM, materials.skinF]) { s.roughness = 1; s.metalness = 0; s.normalScale.set(0.8, 0.8); }
  materials.eyes.roughness = 0.2;

  const animPelvis = (anims.userData?.pelvisHeight as number) ?? 0.9167;
  const speeds = (anims.userData?.speeds as Record<string, number>) ?? {};
  const bodies = {} as Record<BodyKind, BodyTemplate>;
  for (const kind of ['M', 'F', 'H'] as BodyKind[]) {
    const armature = scene.getObjectByName(kind);
    if (!armature) throw new Error('липсва тяло ' + kind);
    armature.removeFromParent();
    armature.position.set(0, 0, 0);
    const boneNames = new Set<string>();
    armature.traverse((o) => { if ((o as THREE.Bone).isBone) boneNames.add(o.name); });
    const ph = pelvisZ(armature);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of anims.animations) clips.set(c.name, retarget(c, boneNames, ph / animPelvis));
    const bp = bindPose(armature);
    bodies[kind] = { kind, armature, pelvisHeight: ph, clips, bindWorld: bp.rot, bindPos: bp.pos };
  }
  const hair = scene.getObjectByName('HAIR') as THREE.Mesh;
  if (!hair) throw new Error('липсва косата');
  hair.removeFromParent();
  assets = { bodies, hair, speeds, animPelvis, materials, quality };
}

/** Само за пробите: забравя заредените хора. */
export function resetCharacters(): void { assets = null; loading = null; }
