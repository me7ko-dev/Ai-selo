// Материалът на терена: истински PBR текстури (Poly Haven, CC0), смесени по маските от ground.ts.
// Слоевете са в два масива от текстури (албедо+височина и нормала+грапавост+AO), за да се ползват малко
// текстурни слотове. Смесване по височина (камъчетата „стърчат“ от пръстта), без видимо повтаряне
// (втори, завъртян вариант на всяка текстура по петна шум), скали по стръмното (три проекции),
// коловози по пътищата, бразди в нивата, мокро в дъжд (локви) и мокро корито, когато реката тръгне.
// MeshStandardMaterial + onBeforeCompile — получава светлините, сенките, мъглата и небето (IBL) на three.
import * as THREE from 'three';
import { ASSET_BASE, hasDom, texLoading } from './tex';
import { ROAD_DMAX, RIVER_DMAX, type GroundData } from './ground';
import type { GroundTextures } from './groundTex';
import { RIVER_HALF_WIDTH } from '../data/layout';

export interface TerrainLayer {
  id: string;
  /** метра на едно повторение на текстурата */
  scale: number;
  /** сила на нормалата */
  nrm: number;
  /** приблизителен среден цвят (sRGB) — докато се заредят текстурите */
  avg: string;
}

/** Слоевете (редът е важен — индексите се ползват в шейдъра). */
export const TERRAIN_LAYERS: TerrainLayer[] = [
  { id: 'forrest_ground_01', scale: 3.2, nrm: 1.0, avg: '#5f6a3c' },            // 0 ливада: пръст, сухи стръкове, клонки
  { id: 'forest_leaves_02', scale: 3.4, nrm: 1.0, avg: '#5a5333' },             // 1 горска постеля: игли, мъх, листа
  { id: 'rocky_trail', scale: 3.0, nrm: 1.1, avg: '#8c7a62' },                  // 2 път и утъпкана пръст
  { id: 'mossy_rock', scale: 7.0, nrm: 1.2, avg: '#77786c' },                   // 3 скала (лишеи)
  { id: 'mud_cracked_dry_riverbed_002', scale: 4.5, nrm: 1.0, avg: '#9c8466' }, // 4 напукана кал в коритото
  { id: 'dry_river_pebbles', scale: 2.2, nrm: 1.2, avg: '#857a6a' },            // 5 речни камъчета
  { id: 'brown_mud_03', scale: 3.0, nrm: 1.0, avg: '#4b3f31' },                 // 6 кал (блатото, брегът на езерцето)
];
const NL = TERRAIN_LAYERS.length;
const TEX_RES = 1024;

// ---------------------------------------------------------------- зареждане на текстурите в масиви
async function bitmap(url: string): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  // flipY: ред 0 = долу (както в GL), за да е нормалата в посоката на v
  return createImageBitmap(await r.blob(), { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

function arrayTex(data: Uint8Array<ArrayBuffer>, s: number, depth: number, srgb: boolean, aniso: number): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, s, s, depth);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = s > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = s > 1;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Слоевете → два масива: [албедо RGB + височина] (sRGB) и [нормала XY + грапавост + AO] (линеен). */
async function loadLayers(aniso: number): Promise<{ alb: THREE.DataArrayTexture; nrm: THREE.DataArrayTexture; avg: THREE.Color[] }> {
  const S = TEX_RES, P = S * S;
  const alb = new Uint8Array(P * 4 * NL), nrm = new Uint8Array(P * 4 * NL);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const read = (b: ImageBitmap) => { ctx.clearRect(0, 0, S, S); ctx.drawImage(b, 0, 0, S, S); b.close(); return ctx.getImageData(0, 0, S, S).data; };
  const f = (id: string, m: string) => `${ASSET_BASE}tex/${id}/${id}_${m}_1k.jpg`;
  const sets = await Promise.all(TERRAIN_LAYERS.map(l => Promise.all(['diff', 'disp', 'nor_gl', 'arm'].map(m => bitmap(f(l.id, m))))));
  const avg: THREE.Color[] = [];
  for (let l = 0; l < NL; l++) {
    const [diff, disp, nor, arm] = sets[l], o = l * P * 4;
    const d = read(diff);
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < P; k++) {
      alb[o + k * 4] = d[k * 4]; alb[o + k * 4 + 1] = d[k * 4 + 1]; alb[o + k * 4 + 2] = d[k * 4 + 2];
      if ((k & 15) === 0) { r += d[k * 4]; g += d[k * 4 + 1]; b += d[k * 4 + 2]; n++; }
    }
    avg.push(new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace));
    // височината — разтегната до целия обхват (за еднакво смесване между слоевете)
    const h = read(disp);
    let lo = 255, hi = 0;
    for (let k = 0; k < P; k += 7) { const v = h[k * 4]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const sc = 255 / Math.max(1, hi - lo);
    for (let k = 0; k < P; k++) alb[o + k * 4 + 3] = Math.max(0, Math.min(255, (h[k * 4] - lo) * sc));
    const nn = read(nor);
    for (let k = 0; k < P; k++) { nrm[o + k * 4] = nn[k * 4]; nrm[o + k * 4 + 1] = nn[k * 4 + 1]; }
    const a = read(arm);
    for (let k = 0; k < P; k++) { nrm[o + k * 4 + 2] = a[k * 4 + 1]; nrm[o + k * 4 + 3] = a[k * 4]; }
  }
  return { alb: arrayTex(alb, S, NL, true, aniso), nrm: arrayTex(nrm, S, NL, false, aniso), avg };
}

// ---------------------------------------------------------------- шейдърът
const VERT_PARS = /* glsl */`
varying vec3 vTW;
varying vec3 vTN;
`;
const FRAG_PARS = /* glsl */`
#define NL ${NL}
#define ROAD_DMAX ${ROAD_DMAX.toFixed(1)}
#define RIVER_DMAX ${RIVER_DMAX.toFixed(1)}
#define RIVER_HW ${RIVER_HALF_WIDTH.toFixed(1)}
uniform sampler2DArray tAlb;
uniform sampler2DArray tNrm;
uniform sampler2D tRegion;
uniform sampler2D tLines;
uniform sampler2D tMacro;
uniform sampler2D tNoise;
uniform float uLScale[NL];
uniform float uLNrm[NL];
uniform vec3 uLAvg[NL];
uniform float uTexReady;
uniform float uWet;
uniform float uRiverFront;
uniform vec4 uField;
uniform vec2 uFieldHalf;
uniform float uGrassFar;
varying vec3 vTW;
varying vec3 vTN;

vec2 tRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// Един слой отгоре (проекция xz). A = албедо + височина, N = нормала xy (-1..1, по света x/z) + грапавост + AO.
// sel (шум на петна) избира между текстурата и завъртян/изместен неин вариант — така не се вижда повторение.
void tSample(int i, vec2 p, vec2 dpx, vec2 dpy, float sel, out vec4 A, out vec4 N) {
  // далеч повторението не се вижда (мип нивата и шумът в цвета го скриват) — там само една проба
  float s = 1.0 / uLScale[i];
  vec2 uv = p * s, gx = dpx * s, gy = dpy * s;
  float L = float(i);
#ifdef TERRAIN_HQ
  float wB = smoothstep(0.36, 0.64, sel) * (1.0 - smoothstep(0.006, 0.03, dot(dpx, dpx) + dot(dpy, dpy)));
#else
  float wB = 0.0;
#endif
  vec4 a1 = vec4(0.0), n1 = vec4(0.5, 0.5, 1.0, 1.0), a2 = vec4(0.0), n2 = vec4(0.5, 0.5, 1.0, 1.0);
  if (wB < 0.999) { a1 = textureGrad(tAlb, vec3(uv, L), gx, gy); n1 = textureGrad(tNrm, vec3(uv, L), gx, gy); }
  if (wB > 0.001) {
    float ang = 2.4 + L * 1.3;
    vec2 uv2 = tRot(uv, ang) + vec2(0.31, 0.67);
    vec2 gx2 = tRot(gx, ang), gy2 = tRot(gy, ang);
    a2 = textureGrad(tAlb, vec3(uv2, L), gx2, gy2); n2 = textureGrad(tNrm, vec3(uv2, L), gx2, gy2);
    n2.xy = tRot(n2.xy * 2.0 - 1.0, -ang) * 0.5 + 0.5;
  }
  float t = wB;
  if (wB > 0.001 && wB < 0.999) {
    // смесване по височина между двата варианта (ръбът минава по „долинките“ на текстурата)
    float b1 = a1.a + (1.0 - wB), b2 = a2.a + wB, m = max(b1, b2) - 0.2;
    float w1 = max(b1 - m, 0.0), w2 = max(b2 - m, 0.0);
    t = w2 / (w1 + w2 + 1e-4);
  }
  A = mix(a1, a2, t); N = mix(n1, n2, t);
  N.xy = (N.xy * 2.0 - 1.0) * uLNrm[i];
}

#ifdef TERRAIN_HQ
// Скалата по стръмното: три проекции (без разтягане на текстурата по отвесните стени).
void tRock(vec3 p, vec3 ng, vec3 dpx, vec3 dpy, out vec4 A, out vec3 NW, out vec2 RA) {
  float s = 1.0 / uLScale[3];
  vec3 bw = pow(abs(ng), vec3(4.0)); bw /= dot(bw, vec3(1.0));
  A = vec4(0.0); NW = vec3(0.0); RA = vec2(0.0);
  float ws = 0.0;
  vec4 a, n; vec3 tn;
  if (bw.x > 0.03) {
    a = textureGrad(tAlb, vec3(p.zy * s, 3.0), dpx.zy * s, dpy.zy * s); n = textureGrad(tNrm, vec3(p.zy * s, 3.0), dpx.zy * s, dpy.zy * s);
    tn.xy = (n.xy * 2.0 - 1.0) * uLNrm[3]; tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
    tn = vec3(tn.xy + ng.zy, abs(tn.z) * ng.x);
    A += a * bw.x; NW += tn.zyx * bw.x; RA += n.ba * bw.x; ws += bw.x;
  }
  if (bw.y > 0.03) {
    a = textureGrad(tAlb, vec3(p.xz * s, 3.0), dpx.xz * s, dpy.xz * s); n = textureGrad(tNrm, vec3(p.xz * s, 3.0), dpx.xz * s, dpy.xz * s);
    tn.xy = (n.xy * 2.0 - 1.0) * uLNrm[3]; tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
    tn = vec3(tn.xy + ng.xz, abs(tn.z) * ng.y);
    A += a * bw.y; NW += tn.xzy * bw.y; RA += n.ba * bw.y; ws += bw.y;
  }
  if (bw.z > 0.03) {
    a = textureGrad(tAlb, vec3(p.xy * s, 3.0), dpx.xy * s, dpy.xy * s); n = textureGrad(tNrm, vec3(p.xy * s, 3.0), dpx.xy * s, dpy.xy * s);
    tn.xy = (n.xy * 2.0 - 1.0) * uLNrm[3]; tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
    tn = vec3(tn.xy + ng.xy, abs(tn.z) * ng.z);
    A += a * bw.z; NW += tn.xyz * bw.z; RA += n.ba * bw.z; ws += bw.z;
  }
  A /= ws; RA /= ws; NW = normalize(NW);
}
#endif

// един слой: текстурите (или средния цвят, докато се заредят) + оцветяването му
void tLayer(float fi, vec2 p, vec3 p3, vec3 ng, vec2 dpx, vec2 dpy, vec3 dpx3, vec3 dpy3, float sel, float slope, out vec4 A, out vec4 N, out vec3 NW, out float tri) {
  int i = int(fi + 0.5);
  A = vec4(uLAvg[i], 0.5); N = vec4(0.0, 0.0, 0.85, 1.0); NW = ng; tri = 0.0;
  if (uTexReady < 0.5) return;
#ifdef TERRAIN_HQ
  if (i == 3 && slope > 0.1) { vec2 ra; tRock(p3, ng, dpx3, dpy3, A, NW, ra); N = vec4(0.0, 0.0, ra); tri = 1.0; return; }
#endif
  tSample(i, p, dpx, dpy, sel, A, N);
}

// слой W се „полага“ с a върху всички предишни
#define T_LAYER(W, a) { float aa_ = clamp(a, 0.0, 1.0), ia_ = 1.0 - aa_; wM *= ia_; wF *= ia_; wD *= ia_; wR *= ia_; wC *= ia_; wP *= ia_; wU *= ia_; W += aa_; }
// подрежда трите най-тежки слоя: t = (тежест, номер)
#define T_PUSH(W, I) { vec2 c_ = vec2(W, I); if (c_.x > t1.x) { t3 = t2; t2 = t1; t1 = c_; } else if (c_.x > t2.x) { t3 = t2; t2 = c_; } else if (c_.x > t3.x) { t3 = c_; } }
`;

const FRAG_MAIN = /* glsl */`
  vec3 tP = vTW;
  vec3 tNg = normalize(vTN);
  vec2 tWuv = (tP.xz + 300.0) / 600.0;
  vec2 tDpx = dFdx(tP.xz), tDpy = dFdy(tP.xz);
  vec3 tDpx3 = dFdx(tP), tDpy3 = dFdy(tP);
  float tDist = distance(cameraPosition, tP);
  vec4 tReg = texture(tRegion, tWuv);
  vec4 tLin = texture(tLines, tWuv);
  vec4 tMac = texture(tMacro, tWuv);
  vec4 tNz = texture(tNoise, tP.xz * 0.0105);
  vec4 tNz2 = texture(tNoise, tP.xz * 0.061);
  float tSlope = 1.0 - tNg.y;
  float tRoadD = tLin.r * ROAD_DMAX;
  // наклонът на разстоянието до пътя (по света) — за коловозите, от производните на екрана
  vec2 tGx = vec2(dFdx(tRoadD), dFdy(tRoadD));
  float tDet = tDpx.x * tDpy.y - tDpx.y * tDpy.x;
  vec2 tGradD = abs(tDet) > 1e-9 ? vec2(tDpy.y * tGx.x - tDpx.y * tGx.y, -tDpy.x * tGx.x + tDpx.x * tGx.y) / tDet : vec2(0.0);

  // ---- тежестите на слоевете (всеки следващ се „полага“ върху предишните)
  float wM = 1.0, wF = 0.0, wD = 0.0, wR = 0.0, wC = 0.0, wP = 0.0, wU = 0.0;
  T_LAYER(wF, tReg.r * 1.3 - 0.12 + (tNz.b - 0.5) * 0.4)
  T_LAYER(wU, tReg.g)
  T_LAYER(wD, tLin.a)
  float tRivD = tLin.g * RIVER_DMAX;
  float tBed = 1.0 - smoothstep(RIVER_HW - 1.2, RIVER_HW + 1.6, tRivD + (tNz2.b - 0.5) * 2.5);
  float tPeb = max(smoothstep(RIVER_HW * 0.45, RIVER_HW * 0.95, tRivD + (tNz2.r - 0.5) * 3.0), smoothstep(0.64, 0.72, tNz2.b));
  T_LAYER(wC, tBed)
  T_LAYER(wP, tBed * tPeb)
  T_LAYER(wR, max(smoothstep(0.16, 0.3, tSlope + (tNz2.r - 0.5) * 0.1), tReg.b))
  // трите най-силни слоя (другите се пренебрегват)
  vec2 t1 = vec2(-1.0, 0.0), t2 = vec2(-1.0, 0.0), t3 = vec2(-1.0, 0.0);
  T_PUSH(wM, 0.0) T_PUSH(wF, 1.0) T_PUSH(wD, 2.0) T_PUSH(wR, 3.0) T_PUSH(wC, 4.0) T_PUSH(wP, 5.0) T_PUSH(wU, 6.0)

  // ---- текстурите
  float tSel = tNz2.g;
  vec4 A1, N1, A2 = vec4(0.0), N2 = vec4(0.0), A3 = vec4(0.0), N3 = vec4(0.0);
  vec3 W1, W2 = tNg, W3 = tNg; float r1, r2 = 0.0, r3 = 0.0;
  tLayer(t1.y, tP.xz, tP, tNg, tDpx, tDpy, tDpx3, tDpy3, tSel, tSlope, A1, N1, W1, r1);
  if (t2.x > 0.004) tLayer(t2.y, tP.xz, tP, tNg, tDpx, tDpy, tDpx3, tDpy3, tSel, tSlope, A2, N2, W2, r2);
  if (t3.x > 0.004) tLayer(t3.y, tP.xz, tP, tNg, tDpx, tDpy, tDpx3, tDpy3, tSel, tSlope, A3, N3, W3, r3);
  // смесване по височина: камъчетата и буците излизат над пръстта по ръба между слоевете
  float h1 = t1.x + A1.a * 0.5, h2 = t2.x > 0.004 ? t2.x + A2.a * 0.5 : -9.0, h3 = t3.x > 0.004 ? t3.x + A3.a * 0.5 : -9.0;
  float hm = max(h1, max(h2, h3)) - 0.22;
  float b1 = max(h1 - hm, 0.0), b2 = max(h2 - hm, 0.0), b3 = max(h3 - hm, 0.0);
  float bs = b1 + b2 + b3; b1 /= bs; b2 /= bs; b3 /= bs;
  // оцветяване: ливадата (0) — като тревата отгоре; под стръковете (близо) — сенчеста пръст и слама,
  // а там, където тревата вече не се рисува — цветът на самата трева; другите — лек шум
  float tFar = smoothstep(uGrassFar * 0.5, uGrassFar, tDist);
  vec3 tRec = tMac.rgb / max(uLAvg[0], vec3(0.01));
  float tUnder = mix(1.0, 0.62, tMac.a * (1.0 - tFar));
  vec3 tOther = vec3(0.88 + 0.24 * tNz.g);
  vec3 c1 = A1.rgb * (t1.y < 0.5 ? mix(mix(vec3(1.0), tRec, 0.5), tRec * 0.86, tFar) * tUnder : tOther);
  vec3 c2 = A2.rgb * (t2.y < 0.5 ? mix(mix(vec3(1.0), tRec, 0.5), tRec * 0.86, tFar) * tUnder : tOther);
  vec3 c3 = A3.rgb * (t3.y < 0.5 ? mix(mix(vec3(1.0), tRec, 0.5), tRec * 0.86, tFar) * tUnder : tOther);
  vec3 tAlbC = c1 * b1 + c2 * b2 + c3 * b3;
  vec2 tNT = N1.xy * b1 + N2.xy * b2 + N3.xy * b3;
  float tRough = N1.z * b1 + N2.z * b2 + N3.z * b3;
  float tAO = N1.w * b1 + N2.w * b2 + N3.w * b3;
  float tH = A1.a * b1 + A2.a * b2 + A3.a * b3;
  vec3 tRockNW = normalize(W1 * r1 * b1 + W2 * r2 * b2 + W3 * r3 * b3 + tNg * 1e-4);
  float tRockF = r1 * b1 + r2 * b2 + r3 * b3;
  float tDirtF = (t1.y > 1.5 && t1.y < 2.5 ? b1 : 0.0) + (t2.y > 1.5 && t2.y < 2.5 ? b2 : 0.0) + (t3.y > 1.5 && t3.y < 2.5 ? b3 : 0.0);

  // ---- коловози по пътищата
  float tRoadIn = (1.0 - smoothstep(1.2, 1.7, tRoadD)) * step(0.35, tLin.a);
  float tU = (tRoadD - 0.68) / 0.2, tEu = exp(-tU * tU) * tRoadIn;
  tNT += tGradD * (-2.0 * tU / 0.2 * tEu) * 0.05;
  tAlbC *= 1.0 - 0.16 * tEu;
  tH -= tEu * 0.4;
  tRough -= tEu * 0.06;
  // ---- браздите в нивата
  {
    vec2 fq = tP.xz - uField.xy;
    vec2 fl = vec2(fq.x * uField.z - fq.y * uField.w, fq.x * uField.w + fq.y * uField.z);
    float edgeF = smoothstep(0.0, 0.8, uFieldHalf.x - abs(fl.x)) * smoothstep(0.0, 0.8, uFieldHalf.y - abs(fl.y));
    if (edgeF > 0.0) {
      float ph = fl.y * 6.2832 / 1.2;
      float ridge = 0.5 + 0.5 * cos(ph);
      tAlbC = mix(tAlbC, tAlbC * vec3(0.8, 0.7, 0.6) * (0.72 + 0.28 * ridge), edgeF);
      float ds = -0.07 * 0.5 * sin(ph) * 6.2832 / 1.2;
      tNT -= ds * vec2(uField.w, uField.z) * edgeF;
      tH = mix(tH, ridge, 0.5 * edgeF);
    }
  }
  // ---- опърленото плато на Ламята
  tAlbC = mix(tAlbC, tAlbC * 0.28 + vec3(0.012, 0.011, 0.01), tReg.a * 0.85);
  tRough = mix(tRough, 0.95, tReg.a);
  // ---- мокро: дъжд (+ локви по пътищата) и коритото, щом водата стигне дотук
  float tWet = uWet;
  if (tLin.b <= uRiverFront && tRivD < RIVER_HW + 2.5) tWet = 1.0;
  tAlbC *= mix(1.0, 0.58, tWet * (1.0 - tRockF * 0.5));
  tRough = mix(tRough, 0.3, tWet);
  float tPud = smoothstep(0.42, 0.22, tH + (tNz2.b - 0.5) * 0.3) * tDirtF * uWet;
  tAlbC = mix(tAlbC, tAlbC * 0.62, tPud); tRough = mix(tRough, 0.04, tPud); tNT *= 1.0 - tPud;

  vec3 tNW = normalize(tNg + vec3(tNT.x, 0.0, tNT.y));
  tNW = normalize(mix(tNW, tRockNW, tRockF));
  diffuseColor.rgb = tAlbC;
`;
export interface TerrainMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform>;
  setQuality(hq: boolean): void;
  /** 0..1 мокро от дъжда */
  setWet(v: number): void;
  /** докъде е стигнала водата по коритото (0..1); < 0 — сухо */
  setRiverFront(v: number): void;
  setGrassFar(m: number): void;
}

export function createTerrainMaterial(g: GroundData, gt: GroundTextures, opts: { aniso?: number; hq?: boolean; grassFar?: number } = {}): TerrainMaterial {
  const blank = (srgb: boolean) => arrayTex(new Uint8Array([128, 128, 128, 128]), 1, 1, srgb, 1);
  const f = g.field;
  const uniforms: Record<string, THREE.IUniform> = {
    tAlb: { value: blank(true) }, tNrm: { value: blank(false) },
    tRegion: { value: gt.region }, tLines: { value: gt.lines }, tMacro: { value: gt.macro }, tNoise: { value: gt.noise },
    uLScale: { value: TERRAIN_LAYERS.map(l => l.scale) },
    uLNrm: { value: TERRAIN_LAYERS.map(l => l.nrm) },
    uLAvg: { value: TERRAIN_LAYERS.map(l => new THREE.Color(l.avg)) },
    uTexReady: { value: 0 }, uWet: { value: 0 }, uRiverFront: { value: -1 },
    uField: { value: f ? new THREE.Vector4(f.x, f.z, Math.cos(f.rot), Math.sin(f.rot)) : new THREE.Vector4(1e5, 1e5, 1, 0) },
    uFieldHalf: { value: f ? new THREE.Vector2(f.w / 2, f.d / 2) : new THREE.Vector2(0, 0) },
    uGrassFar: { value: opts.grassFar ?? 70 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.name = 'terrain';
  let hq = opts.hq ?? true;
  const defs = material as unknown as { defines: Record<string, string> };
  defs.defines = hq ? { TERRAIN_HQ: '' } : {};
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT_PARS + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vTN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', FRAG_PARS + '\nvoid main() {')
      .replace('#include <map_fragment>', FRAG_MAIN)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(tRough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNW, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', /* glsl */`
        {
          float ambientOcclusion = mix(1.0, tAO, 0.85);
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
          #endif
        }`);
  };
  material.customProgramCacheKey = () => 'terrain' + (hq ? '-hq' : '');

  if (hasDom() && typeof createImageBitmap === 'function') {
    texLoading.pending++; texLoading.onChange?.();
    loadLayers(opts.aniso ?? 8).then(({ alb, nrm, avg }) => {
      (uniforms.tAlb.value as THREE.Texture).dispose(); (uniforms.tNrm.value as THREE.Texture).dispose();
      uniforms.tAlb.value = alb; uniforms.tNrm.value = nrm;
      uniforms.uLAvg.value = avg;
      uniforms.uTexReady.value = 1;
    }).catch((e) => console.warn('Текстурите на терена не се заредиха', e))
      .finally(() => { texLoading.pending--; texLoading.done++; texLoading.onChange?.(); });
  }

  return {
    material, uniforms,
    setQuality(v: boolean) { if (v === hq) return; hq = v; defs.defines = hq ? { TERRAIN_HQ: '' } : {}; material.needsUpdate = true; },
    setWet(v: number) { uniforms.uWet.value = v; },
    setRiverFront(v: number) { uniforms.uRiverFront.value = v; },
    setGrassFar(m: number) { uniforms.uGrassFar.value = m; },
  };
}
