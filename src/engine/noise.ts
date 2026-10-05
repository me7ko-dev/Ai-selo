// Шумови текстури, нарисувани веднъж на видеокартата (без файлове): за облаците и за вълничките по водата.
// И двете се повтарят безшевно (периодичен шум), с mipmap-и.
import * as THREE from 'three';

const vert = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const common = /* glsl */`
varying vec2 vUv;
vec2 h22( vec2 p ) { p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ); return fract( sin( p ) * 43758.5453123 ); }
// градиентен шум с период P (клетки)
float pnoise( vec2 p, float P ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	vec2 g00 = h22( mod( i, P ) ) * 2.0 - 1.0, g10 = h22( mod( i + vec2( 1.0, 0.0 ), P ) ) * 2.0 - 1.0;
	vec2 g01 = h22( mod( i + vec2( 0.0, 1.0 ), P ) ) * 2.0 - 1.0, g11 = h22( mod( i + vec2( 1.0, 1.0 ), P ) ) * 2.0 - 1.0;
	float a = dot( g00, f ), b = dot( g10, f - vec2( 1.0, 0.0 ) ), c = dot( g01, f - vec2( 0.0, 1.0 ) ), d = dot( g11, f - vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float fbm( vec2 uv, float P, int oct ) {
	float s = 0.0, a = 0.5, n = 0.0;
	for ( int i = 0; i < 8; i ++ ) { if ( i >= oct ) break; s += a * pnoise( uv * P, P ); n += a; P *= 2.0; a *= 0.5; }
	return s / n;
}
// клетъчен шум (Уорли) с период P
float worley( vec2 uv, float P ) {
	vec2 p = uv * P, i = floor( p ), f = fract( p );
	float d = 1.0;
	for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
		vec2 g = vec2( float( x ), float( y ) );
		vec2 o = h22( mod( i + g, P ) + 17.0 );
		d = min( d, length( g + o - f ) );
	}
	return d;
}
`;

// R: едри облачни форми (fbm), G: Уорли (бухнали ръбове), B: фин детайл, A: средна честота
const cloudFrag = common + /* glsl */`
void main() {
	float r = fbm( vUv, 4.0, 6 ) * 0.5 + 0.5;
	float w1 = worley( vUv, 6.0 ), w2 = worley( vUv, 12.0 ), w3 = worley( vUv, 24.0 );
	float g = clamp( 1.0 - ( w1 * 0.625 + w2 * 0.25 + w3 * 0.125 ), 0.0, 1.0 );
	float b = fbm( vUv, 16.0, 4 ) * 0.5 + 0.5;
	float a = fbm( vUv, 8.0, 5 ) * 0.5 + 0.5;
	gl_FragColor = vec4( r, g, b, a );
}`;

// височина на вълнички → нормали (xy в 0..1), z = височината
const waterHeightFrag = common + /* glsl */`
float hgt( vec2 uv ) {
	float h = fbm( uv, 8.0, 5 ) * 0.7;
	h += ( 1.0 - worley( uv, 10.0 ) ) * 0.25;
	h += fbm( uv + 0.37, 24.0, 3 ) * 0.15;
	return h;
}
void main() {
	float e = 1.0 / 256.0;
	float h = hgt( vUv );
	float hx = hgt( vUv + vec2( e, 0.0 ) ) - hgt( vUv - vec2( e, 0.0 ) );
	float hy = hgt( vUv + vec2( 0.0, e ) ) - hgt( vUv - vec2( 0.0, e ) );
	vec3 n = normalize( vec3( -hx * 9.0, -hy * 9.0, 1.0 ) );
	gl_FragColor = vec4( n.xy * 0.5 + 0.5, h * 0.5 + 0.5, 1.0 );
}`;

function bake(renderer: THREE.WebGLRenderer, frag: string, size: number): THREE.Texture {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  geo.dispose(); mat.dispose();
  return rt.texture;
}

let cache: { cloud: THREE.Texture; water: THREE.Texture } | null = null;

/** Шумът за облаците (256²) и нормалите на водата (256²); правят се веднъж. */
export function noiseTextures(renderer: THREE.WebGLRenderer): { cloud: THREE.Texture; water: THREE.Texture } {
  if (!cache) cache = { cloud: bake(renderer, cloudFrag, 256), water: bake(renderer, waterHeightFrag, 256) };
  return cache;
}

/** Цял екран — един триъгълник (за таблиците на небето). */
export function fullscreenTriangle(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geo;
}
