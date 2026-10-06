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
  /** Лицето: меш → оси на тялото с начало костта Head (за бръчките в шейдъра на кожата) и средата на очите в тях. */
  face: { matrix: THREE.Matrix4; eye: THREE.Vector3 } | null;
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


// ───────────────────────────── материали ─────────────────────────────
interface SheenOpts { sheen: number; sheenRoughness: number; sheenColor: string }

/** Физичен материал със същите текстури и настройки (MeshStandardMaterial → MeshPhysicalMaterial с „мъх“). */
function physical(m: THREE.MeshStandardMaterial, o?: SheenOpts): THREE.MeshPhysicalMaterial {
  const p = new THREE.MeshPhysicalMaterial({
    name: m.name, color: m.color, map: m.map, normalMap: m.normalMap, normalScale: m.normalScale,
    roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap, roughness: m.roughness, metalness: m.metalness,
    side: m.side, transparent: m.transparent, alphaTest: m.alphaTest, emissive: m.emissive,
  });
  p.userData = { ...m.userData };
  if (o) { p.sheen = o.sheen; p.sheenRoughness = o.sheenRoughness; p.sheenColor.set(o.sheenColor); }
  m.dispose();
  return p;
}

// Кожата: светлината „обвива“ ръба (wrap) и там става червеникава — както светлината минава под кожата;
// отражението е меко и слабо (F0 ≈ 0.028), без пластмасов блясък.
const SKIN_WRAP = /* glsl */`
	float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.4 ) / 1.4 );
	vec3 sssTint = mix( vec3( 1.0 ), vec3( 1.0, 0.58, 0.45 ), saturate( 1.0 - dotNL * 3.0 ) * step( 1e-3, wrapNL ) );
	reflectedLight.directDiffuse += wrapNL * directLight.color * sssTint * BRDF_Lambert( material.diffuseColor );
`;
const LAMBERT_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';

function skinMaterial(m: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const s = physical(m, { sheen: 0.25, sheenRoughness: 0.55, sheenColor: '#ffd9c4' });
  s.roughness = 0.82; s.metalness = 0;
  s.specularIntensity = 0.55;
  s.normalScale.set(0.75, 0.75);
  s.userData.skin = true;
  return s;
}

/**
 * Добавя „обвиващата“ светлина на кожата към материала (вика се и от копията с onBeforeCompile).
 * old > 0 — бръчки (чело, около очите, бузите) като фини гънки в нормалата (в пространството на тялото в покой).
 */
export function skinShader(face: BodyTemplate['face'], old: boolean): (sh: THREE.WebGLProgramParametersWithUniforms) => void {
  return (sh) => {
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
    if (chunk.includes(LAMBERT_LINE)) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk.replace(LAMBERT_LINE, SKIN_WRAP));
    }
    if (!old || !face) return;
    sh.uniforms.uFace = { value: face.matrix };
    sh.uniforms.uEye = { value: face.eye };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uFace;\nvarying vec3 vFace;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFace = ( uFace * vec4( position, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEye;\nvarying vec3 vFace;\n' + WRINKLES)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + WRINKLE_APPLY);
  };
}

// Бръчки на старите (баба Гена, дядо Пею): чело, „пачи крак“ край очите, гънки от носа към устата.
// Височина h(p) в осите на главата (м, спрямо средата на очите) → нормалата се накланя (bump по производните),
// а в гънките кожата е малко по-тъмна и по-матова.
const WRINKLES = /* glsl */`
float ageWrinkles( vec3 p ) {
  float ax = abs( p.x ), fy = p.y - uEye.y, h = 0.0;
  float front = smoothstep( uEye.z - 0.045, uEye.z - 0.02, p.z );
  float fore = smoothstep( 0.022, 0.032, fy ) * ( 1.0 - smoothstep( 0.058, 0.072, fy ) ) * ( 1.0 - smoothstep( 0.03, 0.05, ax ) );
  h += fore * front * pow( 0.5 + 0.5 * cos( fy * 6.2832 / 0.0105 + sin( p.x * 90.0 ) * 0.6 ), 3.0 );
  vec2 q = vec2( ax - ( uEye.x + 0.017 ), fy + 0.002 );
  float r = length( q );
  float crow = ( 1.0 - smoothstep( 0.006, 0.02, r ) ) * smoothstep( -0.004, 0.002, q.x ) * smoothstep( 0.002, 0.006, r );
  h += crow * pow( 0.5 + 0.5 * cos( atan( q.y, q.x ) * 9.0 ), 4.0 );
  vec2 a = vec2( 0.017, -0.036 ), b = vec2( 0.029, -0.07 );
  vec2 pa = vec2( ax, fy ) - a, ba = b - a;
  float t = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
  float dn = length( pa - ba * t );
  h += exp( - dn * dn / ( 0.0022 * 0.0022 ) ) * 0.9 * front;
  return h;
}
`;
const WRINKLE_APPLY = /* glsl */`
	{
		float ah = ageWrinkles( vFace );
		vec3 dpx = dFdx( - vViewPosition ), dpy = dFdy( - vViewPosition );
		vec3 r1 = cross( dpy, normal ), r2 = cross( normal, dpx );
		float det = dot( dpx, r1 );
		vec3 grad = sign( det ) * ( dFdx( ah ) * r1 + dFdy( ah ) * r2 ) * 0.0012;
		normal = normalize( abs( det ) * normal - grad );
		diffuseColor.rgb *= 1.0 - 0.16 * ah;
		roughnessFactor = min( 1.0, roughnessFactor + 0.08 * ah );
	}
`;

/**
 * Забрадката: UV-тата от инструмента са „около тялото“ (ъгъл × височина) и на темето се събират в звезда.
 * Тук — сферично развиване около главата с полюс отзад-долу (на тила, под възела), така че темето и челото
 * са в средата на шарката, без събиране.
 */
function remapScarf(armature: THREE.Object3D, face: NonNullable<BodyTemplate['face']>): void {
  armature.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.name.endsWith('_folk')) return;
    const g = m.geometry, gar = g.getAttribute('_garment'), uv = g.getAttribute('uv'), pos = g.getAttribute('position');
    if (!gar || !uv || !pos) return;
    const c = new THREE.Vector3(0, face.eye.y + 0.03, face.eye.z - 0.085);
    const P = new THREE.Vector3(0, -0.3, -1).normalize();           // полюсът: тилът; срещуположният е на челото (под ръба)
    const X = new THREE.Vector3(1, 0, 0), Yb = new THREE.Vector3().crossVectors(P, X).normalize();
    const Xb = new THREE.Vector3().crossVectors(Yb, P).normalize();
    const v = new THREE.Vector3();
    const out = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { out[i * 2] = uv.getX(i); out[i * 2 + 1] = uv.getY(i); }
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(gar.getX(i)) !== G_SCARF) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(face.matrix).sub(c).normalize();
      const theta = Math.acos(THREE.MathUtils.clamp(v.dot(P), -1, 1));   // 0 на тила → π отпред-горе
      const phi = Math.atan2(v.dot(Yb), v.dot(Xb));                      // шевът (±π) е надолу към врата
      // правоъгълникът на басмата в атласа: [0, 0.5] × [0.5, 1]
      out[i * 2] = 0.25 + (phi / (2 * Math.PI)) * 0.5 * 0.98;
      out[i * 2 + 1] = 0.5 + (theta / Math.PI) * 0.5 * 0.98;
      n++;
    }
    if (n) g.setAttribute('uv', new THREE.BufferAttribute(out, 2));
  });
}
const G_SCARF = 9;

/** Лицето на тялото: матрица меш → оси на тялото около костта Head и средата на очите (от меша на очите). */
function faceFrame(armature: THREE.Object3D, bindWorld: Map<string, THREE.Quaternion>): BodyTemplate['face'] {
  let skin: THREE.SkinnedMesh | null = null, eyes: THREE.SkinnedMesh | null = null;
  armature.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    if (m.name.endsWith('_skin')) skin = m;
    else if (m.name.endsWith('_eyes')) eyes = m;
  });
  const sk = (skin as THREE.SkinnedMesh | null)?.skeleton;
  const hq = bindWorld.get('Head');
  if (!sk || !hq) return null;
  const hi = sk.bones.findIndex((b) => b.name === 'Head');
  if (hi < 0) return null;
  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(hq).multiply(sk.boneInverses[hi]);
  const eye = new THREE.Vector3(0.032, 0.09, 0.08);
  const e = eyes as THREE.SkinnedMesh | null;
  if (e && e.skeleton === sk) {
    const pos = e.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    let ax = 0, y = 0, zmax = -9;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(matrix); ax += Math.abs(v.x); y += v.y; zmax = Math.max(zmax, v.z); }
    if (pos.count) eye.set(ax / pos.count, y / pos.count, zmax);
  }
  return { matrix, eye };
}

/**
 * GLTF с квантувани позиции (KHR_mesh_quantization) дава на всеки меш свой skin (обратните матрици носят
 * мащаба на квантуването) → 4 скелета на човек. Тук мащабът се „запича“ в геометрията и всички мешове на тялото
 * ползват скелета на първия.
 */
function shareSkeleton(armature: THREE.Object3D): void {
  const meshes: THREE.SkinnedMesh[] = [];
  armature.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  if (meshes.length < 2) return;
  const ref = meshes[0].skeleton;
  const d = new THREE.Matrix4(), inv = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  for (const m of meshes.slice(1)) {
    const sk = m.skeleton;
    if (sk === ref) continue;
    if (sk.bones.length !== ref.bones.length || sk.bones.some((b, i) => b !== ref.bones[i])) continue;
    // D = IBM_ref⁻¹ · IBM_меш (еднакво за всички кости, ако разликата е само квантуването)
    d.copy(inv.copy(ref.boneInverses[0]).invert()).multiply(sk.boneInverses[0]);
    let same = true;
    for (let i = 1; i < sk.bones.length && same; i++) {
      m2.copy(inv.copy(ref.boneInverses[i]).invert()).multiply(sk.boneInverses[i]);
      for (let k = 0; k < 16; k++) if (Math.abs(m2.elements[k] - d.elements[k]) > 1e-3) { same = false; break; }
    }
    if (!same) continue;
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const out = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(d); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    g.boundingBox = null; g.boundingSphere = null;
    m.bind(ref, m.bindMatrix);
  }
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
  // вълната и ленът имат мек „мъх“ по ръбовете (sheen); кожата — топла, с разсейване под повърхността (wrap)
  const materials = {
    peasant: physical(need('cloth_peasant'), { sheen: 0.55, sheenRoughness: 0.75, sheenColor: '#d8cfc0' }),
    ranger: physical(need('cloth_ranger'), { sheen: 0.45, sheenRoughness: 0.8, sheenColor: '#b8a890' }),
    folk: physical(need('folk'), { sheen: 0.7, sheenRoughness: 0.7, sheenColor: '#cfc6b8' }),
    skinM: skinMaterial(need('skin_m')), skinF: skinMaterial(need('skin_f')),
    eyes: need('eyes'),
    hair: physical(need('hair'), { sheen: 0.5, sheenRoughness: 0.45, sheenColor: '#a89880' }),
  };
  for (const m of Object.values(materials)) {
    for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.anisotropy = 4;
    m.envMapIntensity = 1;
  }
  materials.folk.roughness = 0.95;
  materials.hair.roughness = 0.55;
  materials.eyes.roughness = 0.2;

  const animPelvis = (anims.userData?.pelvisHeight as number) ?? 0.9167;
  const speeds = (anims.userData?.speeds as Record<string, number>) ?? {};
  const bodies = {} as Record<BodyKind, BodyTemplate>;
  for (const kind of ['M', 'F', 'H'] as BodyKind[]) {
    const armature = scene.getObjectByName(kind);
    if (!armature) throw new Error('липсва тяло ' + kind);
    armature.removeFromParent();
    armature.position.set(0, 0, 0);
    shareSkeleton(armature);
    const boneNames = new Set<string>();
    armature.traverse((o) => { if ((o as THREE.Bone).isBone) boneNames.add(o.name); });
    const ph = pelvisZ(armature);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of anims.animations) clips.set(c.name, retarget(c, boneNames, ph / animPelvis));
    const bp = bindPose(armature);
    const face = faceFrame(armature, bp.rot);
    if (face) remapScarf(armature, face);
    bodies[kind] = { kind, armature, pelvisHeight: ph, clips, bindWorld: bp.rot, bindPos: bp.pos, face };
  }
  const hair = scene.getObjectByName('HAIR') as THREE.Mesh;
  if (!hair) throw new Error('липсва косата');
  hair.removeFromParent();
  assets = { bodies, hair, speeds, animPelvis, materials, quality };
}

/** Само за пробите: забравя заредените хора. */
export function resetCharacters(): void { assets = null; loading = null; }
