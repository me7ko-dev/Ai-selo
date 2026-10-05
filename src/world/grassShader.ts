// Шейдърите на тревата и полските цветя (вмъкват се в MeshStandardMaterial чрез onBeforeCompile).
// Всеки стрък се строи във вертекс шейдъра: корен (клетка + позиция в „кръпката“), височина от терена
// (точно по триъгълниците), извивка по дъга (наклон + вятър + героят го разгръща), заострена форма,
// заоблена нормала, цвят (тъмен в корена, светли/сламени върхове, оттенък на туфата, сухи стръкове).
import { RIVER_DMAX, ROAD_DMAX } from './ground';
import { RIVER_HALF_WIDTH } from '../data/layout';

export const GRASS_VERT_PARS = /* glsl */`
#define RIVER_DMAX ${RIVER_DMAX.toFixed(1)}
#define ROAD_DMAX ${ROAD_DMAX.toFixed(1)}
#define RIVER_HW ${RIVER_HALF_WIDTH.toFixed(1)}
attribute vec4 aB0;   // u, v (в клетката), ранг (ред на изтъняване), посока на листа
attribute vec4 aB1;   // посока на наклона, наклон, височина, ширина            (стръкове)
                      // вид, височина, посока на главичката, наклон на главичката (цветя)
attribute vec4 aB2;   // оттенък на туфата, случайно, сух връх, фаза
attribute vec4 aTile; // клетката: x0, z0, вариант (завъртане/огледало), —
uniform sampler2D tHeight;
uniform sampler2D tGrass;
uniform sampler2D tMacro;
uniform sampler2D tLines;
uniform sampler2D tNoise;
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform vec4 uHero;      // x, y, z, радиус
uniform vec4 uDens;      // гъстота близо (/м²), до колко м е пълна, докъде има трева, капацитет на клетката (/м²)
uniform float uCov;      // после: колкото да покрие земята ~2,5 пъти (стръка/м² ≈ uCov / (ширина × разстояние))
uniform vec3 uBlade;     // височина, ширина, разширяване с разстоянието
uniform float uWet;
uniform vec3 uDryCol;
uniform float uCell;
uniform vec2 uFlower;   // до колко м са пълни, докъде има цветя
varying vec3 vGCol;
varying float vGTrans;

// височината на терена точно като триъгълниците в terrain.ts (стъпка 2 м, редуващ се диагонал) + нормалата
float gTerrainH(vec2 p, out vec3 n) {
  vec2 g = (p + 300.0) * 0.5;
  vec2 gi = clamp(floor(g), vec2(0.0), vec2(299.0));
  vec2 f = clamp(g - gi, 0.0, 1.0);
  ivec2 i0 = ivec2(gi);
  vec4 a = texelFetch(tHeight, i0, 0), b = texelFetch(tHeight, i0 + ivec2(1, 0), 0);
  vec4 c = texelFetch(tHeight, i0 + ivec2(0, 1), 0), d = texelFetch(tHeight, i0 + ivec2(1, 1), 0);
  float h;
  if (((i0.x + i0.y) & 1) == 1) {
    if (f.x + f.y < 1.0) h = a.x + f.x * (b.x - a.x) + f.y * (c.x - a.x);
    else h = d.x + (1.0 - f.x) * (c.x - d.x) + (1.0 - f.y) * (b.x - d.x);
  } else {
    if (f.x < f.y) h = a.x + f.y * (c.x - a.x) + f.x * (d.x - c.x);
    else h = a.x + f.x * (b.x - a.x) + f.y * (d.x - b.x);
  }
  vec2 nxz = mix(mix(a.yz, b.yz, f.x), mix(c.yz, d.yz, f.x), f.y);
  n = vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y);
  return h;
}
`;

/** Общото начало (евтино): коренът и дали клетката е пред камерата. Задава gRoot, gWuv, gD, gOut. */
const ROOT = /* glsl */`
  vec2 cuv = aB0.xy;
  float tv = mod(aTile.z, 8.0);
  float gHalf = floor(aTile.z / 8.0) * 0.25;
  if (mod(tv, 2.0) >= 1.0) cuv = cuv.yx;
  if (mod(floor(tv * 0.5), 2.0) >= 1.0) cuv.x = 1.0 - cuv.x;
  if (tv >= 4.0) cuv.y = 1.0 - cuv.y;
  vec2 gRoot = aTile.xy + cuv * uCell;
  vec2 gWuv = (gRoot + 300.0) / 600.0;
  float gD = distance(gRoot, cameraPosition.xz);
  // отрязване извън екрана (по средната височина на клетката, с толеранс за наклона)
  vec4 gCp = projectionMatrix * (viewMatrix * vec4(gRoot.x, aTile.w + 0.3, gRoot.y, 1.0));
  float gM = 1.2 + gHalf;
  bool gOut = gCp.w < -gM || abs(gCp.x) > gCp.w + gM || abs(gCp.y) > gCp.w + gM;
  vec3 gPos = vec3(gRoot.x, aTile.w - 50.0, gRoot.y);
  vec3 gNormal = vec3(0.0, 1.0, 0.0);
  vGCol = vec3(0.0); vGTrans = 0.0;
`;

/** Гъстотата тук: маската + без трева по пътищата, в коритото и по скалите. Задава gLin, gTN, gH0, gDens. */
const GROUND = /* glsl */`
    vec4 gLin = texture(tLines, gWuv);
    vec3 gTN;
    float gH0 = gTerrainH(gRoot, gTN);
    float gDens = (1.0 - smoothstep(0.22, 0.6, gLin.a))
      * smoothstep(RIVER_HW - 0.6, RIVER_HW + 1.4, gLin.g * RIVER_DMAX)
      * (1.0 - smoothstep(0.16, 0.26, 1.0 - gTN.y));
`;

export const GRASS_MAIN = /* glsl */`
  ${ROOT}
  vec4 gGP = texture(tGrass, gWuv);
  float gWant = max(uDens.x * min(1.0, pow(uDens.y / max(gD, 0.01), 4.0)), uCov / ((1.0 + gD * uBlade.z) * max(gD, 0.5)));
  float gKeep = gWant * gGP.r / uDens.w;
  // по-голям ранг от нужното → стръкът не се рисува (без да четем терена и останалото)
  if (!gOut && aB0.z < gKeep && gD < uDens.z) {
    ${GROUND}
    float k2 = gKeep * gDens;
    // стръковете близо до прага растат плавно (без „изскачане“), а към края на обхвата потъват в земята
    float gVis = (1.0 - smoothstep(k2 * 0.7, k2, aB0.z)) * (1.0 - smoothstep(uDens.z * 0.7, uDens.z, gD));
    if (gVis > 0.02) {
      float t = position.y, side = position.x;
      float H = uBlade.x * gGP.g * 2.0 * (0.5 + aB1.z * 0.9) * gVis;
      float W = uBlade.y * (0.65 + aB1.w * 0.7) * (1.0 + gD * uBlade.z);
      // вятър: вълни от пориви, които минават по ливадата, + трептене на всеки стрък
      vec4 nz = texture(tNoise, gRoot * 0.011 - uWindDir * uTime * (0.035 + uWind * 0.05));
      float gust = smoothstep(0.3, 0.9, nz.r * 0.75 + nz.b * 0.4);
      float flut = sin(uTime * (3.2 + aB2.y * 2.6) + aB2.w * 6.2832 + dot(gRoot, vec2(0.9, 1.3))) * (0.05 + 0.12 * gust);
      float face = aB0.w * 6.2832;
      vec2 fd = vec2(cos(face), sin(face));
      vec2 wd = vec2(-fd.y, fd.x);
      float la = aB1.x * 6.2832;
      vec2 bend = vec2(cos(la), sin(la)) * (0.12 + aB1.y * 0.85)
        + uWindDir * uWind * (0.1 + 1.05 * gust)
        + (uWindDir * 1.4 + fd * 0.6) * flut * (0.3 + uWind);
      // героят разгръща тревата около себе си
      vec2 away = gRoot - uHero.xz; float hd = length(away);
      float push = (1.0 - smoothstep(uHero.w * 0.25, uHero.w, hd)) * (1.0 - smoothstep(1.2, 2.2, abs(gH0 - uHero.y)));
      bend += (away / max(hd, 0.01)) * push * 1.7;
      H *= 1.0 - push * 0.3;
      float bl = length(bend);
      float th = min(bl, 1.5);
      vec2 bd = bend / max(bl, 1e-4);
      // дъга: стръкът се огъва равномерно по дължината си
      float a = th * t;
      float sx = th > 0.001 ? H * (1.0 - cos(a)) / th : 0.0;
      float sy = th > 0.001 ? H * sin(a) / th : H * t;
      vec3 tan3 = vec3(bd.x * sin(a), cos(a), bd.y * sin(a));
      // гледан откъм ръба, стръкът се завърта малко към камерата (не изтънява до черта)
      vec2 toC = normalize(cameraPosition.xz - gRoot + 1e-4);
      vec2 sideV = vec2(-toC.y, toC.x);
      float edgeOn = 1.0 - abs(dot(fd, toC));
      vec2 wdv = normalize(wd + sideV * sign(dot(wd, sideV) + 1e-4) * edgeOn * 0.8);
      vec3 w3 = vec3(wdv.x, 0.0, wdv.y);
      // лента с почти успоредни ръбове, която се заостря в последната трета
      float wt = W * pow(max(0.0, 1.0 - pow(t, 2.4)), 0.85);
      gPos = vec3(gRoot.x, gH0 - 0.04, gRoot.y) + vec3(bd.x * sx, sy, bd.y * sx) + w3 * side * wt;
      // заоблена нормала, обърната към камерата, леко към нормалата на терена
      vec3 nb = normalize(cross(w3, tan3));
      vec3 toCam3 = cameraPosition - vec3(gRoot.x, gH0 + H * 0.5, gRoot.y);
      if (dot(nb, toCam3) < 0.0) nb = -nb;
      nb = normalize(nb + w3 * side * 0.6);
      gNormal = normalize(mix(nb, gTN, 0.5));
      // цвят: оттенъкът на ливадата, туфата и стръка; тъмен корен, светъл (жълтеникав/сламен) връх
      vec3 base = texture(tMacro, gWuv).rgb;
      // туфите се различават: по-жълтеникави, по-синкави, по-тъмни; всеки стрък — малко по-светъл/тъмен
      float hue = aB2.x - 0.5;
      base *= vec3(1.0 + hue * 0.5, 1.0 + hue * 0.1, 1.0 - hue * 0.7) * (0.72 + aB2.y * 0.5);
      float dry = gGP.b;
      float dryBlade = step(1.0 - (0.03 + dry * 0.28), fract(aB2.y * 7.31 + aB2.x * 3.7));
      vec3 straw = uDryCol * (0.7 + 0.6 * fract(aB2.y * 13.7));
      // върхът: по-светъл и по-жълт; при сухите места — към слама
      vec3 tip = mix(base * vec3(1.22, 1.16, 0.72), straw, 0.08 + dry * 0.5);
      vec3 col = mix(base, tip, smoothstep(0.5, 1.0, t) * aB2.z);
      col = mix(col, straw * mix(0.7, 1.0, t), dryBlade);
      wt *= 1.0 - dryBlade * 0.45;
      gPos = vec3(gRoot.x, gH0 - 0.04, gRoot.y) + vec3(bd.x * sx, sy, bd.y * sx) + w3 * side * wt;
      float ao = mix(0.25, 1.0, smoothstep(0.0, 0.75, t));
      vGCol = col * ao * (1.0 - uWet * 0.3);
      vGTrans = (0.15 + 0.85 * t) * ao * (1.0 - dryBlade * 0.4);
    }
  }
`;

/** Полските цветя: лайка, мак, метличина, лютиче, детелина, камбанка — стъбло + малка главичка. */
export const FLOWER_MAIN = /* glsl */`
  ${ROOT}
  vec4 gGP = texture(tGrass, gWuv);
  // цветята оредяват с разстоянието (иначе далеч трептят като шум) и изчезват към края на обхвата си
  float gFk = gGP.a * gGP.r * min(1.0, (uFlower.x * uFlower.x) / max(gD * gD, 0.01));
  if (!gOut && aB0.z < gFk && gD < uFlower.y) {
    ${GROUND}
    float k2 = gFk * gDens;
    float gVis = (1.0 - smoothstep(k2 * 0.75, k2, aB0.z)) * (1.0 - smoothstep(uFlower.y * 0.7, uFlower.y, gD));
    if (gVis > 0.02) {
      // видът
      float sp = aB1.x;
      vec3 pet, cen; float rad, cup, hm;
      if (sp < 0.3)       { pet = vec3(0.80, 0.80, 0.74); cen = vec3(0.80, 0.50, 0.03); rad = 0.014; cup = 0.1;  hm = 0.9; }  // лайка
      else if (sp < 0.52) { pet = vec3(0.78, 0.50, 0.02); cen = vec3(0.62, 0.42, 0.02); rad = 0.011; cup = 0.5;  hm = 0.95; } // лютиче
      else if (sp < 0.67) { pet = vec3(0.42, 0.10, 0.26); cen = vec3(0.30, 0.08, 0.20); rad = 0.010; cup = 1.6;  hm = 0.55; } // детелина
      else if (sp < 0.80) { pet = vec3(0.08, 0.16, 0.70); cen = vec3(0.10, 0.07, 0.35); rad = 0.017; cup = 0.25; hm = 1.05; } // метличина
      else if (sp < 0.91) { pet = vec3(0.62, 0.025, 0.012); cen = vec3(0.02, 0.02, 0.02); rad = 0.03; cup = 0.7; hm = 1.15; } // мак
      else                { pet = vec3(0.26, 0.17, 0.62); cen = vec3(0.20, 0.12, 0.45); rad = 0.013; cup = -0.9; hm = 0.95; } // камбанка
      float H = uBlade.x * gGP.g * 2.0 * (0.75 + aB1.y * 0.6) * hm * gVis;
      float sz = rad * (0.8 + aB2.x * 0.45) * (1.0 + gD * 0.05) * gVis;
      vec4 nz = texture(tNoise, gRoot * 0.011 - uWindDir * uTime * (0.035 + uWind * 0.05));
      float gust = smoothstep(0.3, 0.9, nz.r * 0.75 + nz.b * 0.4);
      float flut = sin(uTime * (2.6 + aB2.y * 2.0) + aB2.w * 6.2832) * (0.05 + 0.1 * gust);
      vec2 bend = uWindDir * uWind * (0.08 + 0.8 * gust) + uWindDir * flut * (0.3 + uWind);
      vec2 away = gRoot - uHero.xz; float hd = length(away);
      float push = (1.0 - smoothstep(uHero.w * 0.25, uHero.w, hd)) * (1.0 - smoothstep(1.2, 2.2, abs(gH0 - uHero.y)));
      bend += (away / max(hd, 0.01)) * push * 1.5;
      float th = min(length(bend), 1.3); vec2 bd = bend / max(length(bend), 1e-4);
      float t = position.z < 0.5 ? position.y : 1.0;
      float a = th * t;
      vec3 sp3 = vec3(gRoot.x, gH0 - 0.03, gRoot.y) + vec3(bd.x * H * (1.0 - cos(a)) / max(th, 1e-3), th > 0.001 ? H * sin(a) / th : H * t, bd.y * H * (1.0 - cos(a)) / max(th, 1e-3));
      if (position.z < 0.5) {
        // стъблото
        vec2 toC = normalize(cameraPosition.xz - gRoot + 1e-4);
        vec3 w3 = vec3(-toC.y, 0.0, toC.x);
        gPos = sp3 + w3 * position.x * 0.0035 * (1.0 + gD * 0.03);
        gNormal = normalize(mix(vec3(toC.x, 0.0, toC.y), gTN, 0.4));
        vec3 stem = texture(tMacro, gWuv).rgb * vec3(0.8, 0.95, 0.7);
        vGCol = stem * mix(0.25, 0.9, t);
        vGTrans = 0.3 * t;
      } else {
        // главичката: розетка от венчелистчета; гледа нагоре, наклонена на случайна страна (+ вятъра)
        float ta = aB1.z * 6.2832, tl = aB1.w * 0.7;
        vec3 up = normalize(vec3(cos(ta) * tl + bd.x * th * 0.5, 1.0, sin(ta) * tl + bd.y * th * 0.5));
        vec3 ax = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
        vec3 az = cross(ax, up);
        float r2 = dot(position.xy, position.xy);
        gPos = sp3 + (ax * position.x + az * position.y) * sz + up * (cup * sz * r2);
        gNormal = normalize(up - (ax * position.x + az * position.y) * cup * 0.6);
        vGCol = mix(cen, pet, smoothstep(0.15, 0.5, sqrt(r2))) * (0.85 + 0.3 * aB2.y);
        vGTrans = 0.7;
      }
    }
  }
`;

/** Фрагментна част: цветът от вертекса, нормалата без обръщане на гърба, просветляване на слънцето през листата. */
export const GRASS_FRAG_PARS = /* glsl */`
varying vec3 vGCol;
varying float vGTrans;
uniform vec3 uTransTint;
uniform float uWetF;
`;

/** Добавя се след lights_physical_pars_fragment: просветляването (транслуцентност) на тънките листа срещу светлината. */
export const GRASS_RE = /* glsl */`
void RE_Direct_Grass(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  // отблясъкът на тревата е мек (восъчен), не като на мокър камък — само част от физическия
  vec3 spec0 = reflectedLight.directSpecular;
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  reflectedLight.directSpecular = spec0 + (reflectedLight.directSpecular - spec0) * 0.35;
  float back = saturate(dot(directLight.direction, -geometryViewDir));
  float through = saturate(-dot(geometryNormal, directLight.direction));
  float sss = (pow(back, 5.0) * 2.4 + through * 0.55) * vGTrans;
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert(material.diffuseColor) * uTransTint * sss;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Grass
`;
