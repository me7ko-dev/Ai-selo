// Физичен модел на атмосферата (единично разсейване Рейли + Ми + озон, с груба добавка за многократно разсейване).
// Една и съща математика в GLSL (таблицата на небето в sky.ts) и в TS (цвят на слънцето, мараната, околната светлина).
// Единици: излъчване на единица слънчева осветеност (E = 1); sky.ts ги умножава по силата на слънцето/луната.
import * as THREE from 'three';

export const R_EARTH = 6360e3;
export const R_TOP = 6460e3;
/** височина на наблюдателя (Балкан, ~500 м) */
export const OBS_ALT = 500;
const BR: [number, number, number] = [5.802e-6, 13.558e-6, 33.1e-6];
const HR = 8000;
const HM = 1200;
const BO: [number, number, number] = [0.65e-6, 1.881e-6, 0.085e-6];
/** Ми по подразбиране (лека мараня); времето го вдига */
export const MIE_CLEAR = 8.5e-6;
const MS = 0.9; // добавка за многократно разсейване (изотропна)
/** оцветяване на многократното разсейване: (β_R / β_R.g)^0.3 — малко по-синьо */
const MSB = BR.map((b) => Math.pow(b / BR[1], 0.3)) as [number, number, number];

export const ATMOSPHERE_GLSL = /* glsl */`
const float A_RE = ${R_EARTH.toFixed(1)};
const float A_RT = ${R_TOP.toFixed(1)};
const vec3 A_BR = vec3(${BR.map((v) => v.toExponential(4)).join(', ')});
const vec3 A_BO = vec3(${BO.map((v) => v.toExponential(4)).join(', ')});
const float A_HR = ${HR.toFixed(1)};
const float A_HM = ${HM.toFixed(1)};
const float A_MS = ${MS.toFixed(3)};
const vec3 A_MSB = vec3(${MSB.map((v) => v.toFixed(4)).join(', ')});
uniform float uMie;   // разсейване на Ми при земята (м⁻¹)
uniform float uMieG;  // асиметрия на Ми

vec2 aSphere( vec3 ro, vec3 rd, float r ) {
	float b = dot( ro, rd ), c = dot( ro, ro ) - r * r, d = b * b - c;
	if ( d < 0.0 ) return vec2( 1e12, -1e12 );
	d = sqrt( d );
	return vec2( -b - d, -b + d );
}
vec3 aDens( float h ) {
	return vec3( exp( -h / A_HR ), exp( -h / A_HM ), max( 0.0, 1.0 - abs( h - 25000.0 ) / 15000.0 ) );
}
vec3 aExt( vec3 od ) { return A_BR * od.x + vec3( uMie * 1.11 ) * od.y + A_BO * od.z; }
// пропускливост от точка p към светлината L до края на атмосферата (0 в сянката на Земята)
vec3 aSunTrans( vec3 p, vec3 L ) {
	vec2 g = aSphere( p, L, A_RE );
	if ( g.y > g.x && g.x > 0.0 ) return vec3( 0.0 );
	float t1 = aSphere( p, L, A_RT ).y;
	float dt = t1 / 6.0;
	vec3 od = vec3( 0.0 );
	for ( int i = 0; i < 6; i ++ ) od += aDens( length( p + L * ( float( i ) + 0.5 ) * dt ) - A_RE );
	return exp( -aExt( od * dt ) );
}
float aPhaseR( float mu ) { return 0.0596831 * ( 1.0 + mu * mu ); }
float aPhaseM( float mu, float g ) {
	float g2 = g * g;
	return 0.1193662 * ( 1.0 - g2 ) * ( 1.0 + mu * mu ) / ( ( 2.0 + g2 ) * pow( max( 1.0 + g2 - 2.0 * g * mu, 1e-4 ), 1.5 ) );
}
// излъчването на небето в посока V при светлина от L (единица осветеност)
vec3 aScatter( vec3 V, vec3 L ) {
	vec3 O = vec3( 0.0, A_RE + ${OBS_ALT.toFixed(1)}, 0.0 );
	float tmax = aSphere( O, V, A_RT ).y;
	vec2 tg = aSphere( O, V, A_RE );
	if ( tg.y > tg.x && tg.x > 0.0 ) tmax = min( tmax, tg.x );
	tmax = min( tmax, 600e3 );
	float mu = dot( V, L );
	vec3 sR = vec3( 0.0 ), sM = vec3( 0.0 ), od = vec3( 0.0 );
	float tPrev = 0.0;
	for ( int i = 0; i < 20; i ++ ) {
		float f = ( float( i ) + 1.0 ) / 20.0;
		float t = tmax * f * f;
		float dt = t - tPrev;
		vec3 p = O + V * ( tPrev + dt * 0.5 );
		tPrev = t;
		vec3 d = aDens( length( p ) - A_RE );
		od += d * dt;
		vec3 S = exp( -aExt( od ) ) * aSunTrans( p, L );
		sR += S * d.x * dt;
		sM += S * d.y * dt;
	}
	vec3 single = sR * A_BR * aPhaseR( mu ) + sM * uMie * aPhaseM( mu, uMieG );
	// многократното разсейване е по-синьо от единичното (светлината се разсейва повторно по Рейли)
	vec3 multi = ( sR * A_BR * A_MSB + sM * uMie ) * 0.0795775 * A_MS;
	return single + multi;
}
`;

// ───────────────────────────── същото в TS ─────────────────────────────

function sphere(ro: number[], rd: number[], r: number): [number, number] {
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - r * r;
  let d = b * b - c;
  if (d < 0) return [1e12, -1e12];
  d = Math.sqrt(d);
  return [-b - d, -b + d];
}

/** Пропускливост (rgb) от точка p (м, от центъра на Земята) към L. */
function sunTrans(p: number[], L: number[], mie: number, out: number[]): number[] {
  const g = sphere(p, L, R_EARTH);
  if (g[1] > g[0] && g[0] > 0) { out[0] = out[1] = out[2] = 0; return out; }
  const t1 = sphere(p, L, R_TOP)[1], dt = t1 / 6;
  let r = 0, m = 0, o = 0;
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) * dt;
    const x = p[0] + L[0] * t, y = p[1] + L[1] * t, z = p[2] + L[2] * t;
    const h = Math.sqrt(x * x + y * y + z * z) - R_EARTH;
    r += Math.exp(-h / HR); m += Math.exp(-h / HM); o += Math.max(0, 1 - Math.abs(h - 25000) / 15000);
  }
  r *= dt; m *= dt; o *= dt;
  out[0] = Math.exp(-(BR[0] * r + mie * 1.11 * m + BO[0] * o));
  out[1] = Math.exp(-(BR[1] * r + mie * 1.11 * m + BO[1] * o));
  out[2] = Math.exp(-(BR[2] * r + mie * 1.11 * m + BO[2] * o));
  return out;
}

const O = [0, R_EARTH + OBS_ALT, 0];
const _t = [0, 0, 0];

/** Пропускливостта на атмосферата за слънце в посока L (от наблюдателя) — цветът на слънчевата светлина. */
export function transmittance(L: THREE.Vector3, mie: number, out = new THREE.Color()): THREE.Color {
  const l = [L.x, L.y, L.z];
  sunTrans(O, l, mie, _t);
  return out.setRGB(_t[0], _t[1], _t[2]);
}

function phaseM(mu: number, g: number): number {
  const g2 = g * g;
  return 0.1193662 * (1 - g2) * (1 + mu * mu) / ((2 + g2) * Math.pow(Math.max(1 + g2 - 2 * g * mu, 1e-4), 1.5));
}

/** Излъчването на небето в посока V при светлина от L (единица осветеност) — същото като aScatter в GLSL. */
export function scatter(V: THREE.Vector3, L: THREE.Vector3, mie: number, g: number, out = new THREE.Color(), steps = 12): THREE.Color {
  const v = [V.x, V.y, V.z], l = [L.x, L.y, L.z];
  let tmax = sphere(O, v, R_TOP)[1];
  const tg = sphere(O, v, R_EARTH);
  if (tg[1] > tg[0] && tg[0] > 0) tmax = Math.min(tmax, tg[0]);
  tmax = Math.min(tmax, 600e3);
  const mu = V.x * L.x + V.y * L.y + V.z * L.z;
  let sR0 = 0, sR1 = 0, sR2 = 0, sM0 = 0, sM1 = 0, sM2 = 0, odR = 0, odM = 0, odO = 0, tPrev = 0;
  const p = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const f = (i + 1) / steps, t = tmax * f * f, dt = t - tPrev, tm = tPrev + dt * 0.5;
    tPrev = t;
    p[0] = O[0] + v[0] * tm; p[1] = O[1] + v[1] * tm; p[2] = O[2] + v[2] * tm;
    const h = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) - R_EARTH;
    const dR = Math.exp(-h / HR), dM = Math.exp(-h / HM), dO = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
    odR += dR * dt; odM += dM * dt; odO += dO * dt;
    sunTrans(p, l, mie, _t);
    const e0 = Math.exp(-(BR[0] * odR + mie * 1.11 * odM + BO[0] * odO)) * _t[0];
    const e1 = Math.exp(-(BR[1] * odR + mie * 1.11 * odM + BO[1] * odO)) * _t[1];
    const e2 = Math.exp(-(BR[2] * odR + mie * 1.11 * odM + BO[2] * odO)) * _t[2];
    sR0 += e0 * dR * dt; sR1 += e1 * dR * dt; sR2 += e2 * dR * dt;
    sM0 += e0 * dM * dt; sM1 += e1 * dM * dt; sM2 += e2 * dM * dt;
  }
  const pR = 0.0596831 * (1 + mu * mu), pM = phaseM(mu, g), iso = 0.0795775 * MS;
  return out.setRGB(
    sR0 * BR[0] * (pR + iso * MSB[0]) + sM0 * mie * (pM + iso),
    sR1 * BR[1] * (pR + iso * MSB[1]) + sM1 * mie * (pM + iso),
    sR2 * BR[2] * (pR + iso * MSB[2]) + sM2 * mie * (pM + iso),
  );
}
