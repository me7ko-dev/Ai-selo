// Пост-обработка (библиотеката postprocessing + N8AO): сцената се рисува в HDR буфер, после
//  • N8AO — околно засенчване в ъглите и под нещата (само „Високо“, на половин резолюция);
//  • мек блясък (bloom) — слънце, огън, фенери, прозорци нощем; прагът следи експонацията;
//  • AgX тонално преобразуване + лека цветова корекция (наситеност/контраст), нощен вид (по-синкаво,
//    по-обезцветено — както окото вижда на лунна светлина), съвсем лека винетка;
//  • изглаждане на ръбовете: SMAA (високо/средно), FXAA (ниско) — вместо MSAA.
// Нищо крещящо — целта е „като на живо“.
import * as THREE from 'three';
import {
  BlendFunction, BloomEffect, EdgeDetectionMode, Effect, EffectComposer, EffectPass, FXAAEffect, RenderPass, SMAAEffect, SMAAPreset,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type PostQuality = 'low' | 'medium' | 'high';

const gradeFrag = /* glsl */`
#include <tonemapping_pars_fragment>
uniform float uNight;
uniform float uVignette;
uniform float uSat;
uniform float uContrast;
uniform vec3 uTint;
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
	vec3 c = AgXToneMapping( max( inputColor.rgb, vec3( 0.0 ) ) * uTint );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	// контраст около средно сивото (в лог.), наситеност
	c = 0.2 * pow( max( c, vec3( 1e-5 ) ) / 0.2, vec3( uContrast ) );
	l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = mix( vec3( l ), c, uSat );
	// нощем: по-малко цвят, синкаво (ефектът на Пуркине)
	c = mix( c, vec3( l ) * vec3( 0.8, 0.92, 1.22 ), uNight );
	// винетка
	vec2 q = uv - 0.5;
	c *= 1.0 - dot( q, q ) * uVignette;
	outputColor = vec4( clamp( c, 0.0, 1.0 ), inputColor.a );
}`;

/** Тоново преобразуване (AgX) + цветова корекция + нощен вид + винетка — един проход. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uNight', new THREE.Uniform(0)],
        ['uVignette', new THREE.Uniform(0.32)],
        ['uSat', new THREE.Uniform(1.12)],
        ['uContrast', new THREE.Uniform(1.08)],
        ['uTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    });
  }
  u(name: string): THREE.Uniform { return this.uniforms.get(name)!; }
}

export class PostFX {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private ao: N8AOPostPass | null = null;
  private bloom: BloomEffect | null = null;
  private grade = new GradeEffect();
  private aa: SMAAEffect | FXAAEffect | null = null;
  private passes: { dispose(): void }[] = [];
  private quality: PostQuality | null = null;
  /** експонация (умножава сцената преди AgX) */
  exposure = 1;
  /** 0..1 нощен вид */
  night = 0;
  /** сила на блясъка (за светкавица и т.н.) */
  bloomBoost = 0;
  /** оттенък на цялата картина преди AgX (напр. по-хладно утро) */
  get tint(): THREE.Vector3 { return this.grade.u('uTint').value as THREE.Vector3; }

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0, stencilBuffer: false, depthBuffer: true });
    this.renderPass = new RenderPass(scene, camera);
    this.setQuality('high');
  }

  setQuality(q: PostQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.composer.removeAllPasses();
    for (const p of this.passes) p.dispose();
    this.passes = [];
    this.ao = null; this.bloom = null; this.aa = null;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (q === 'high') {
      const ao = new N8AOPostPass(this.scene, this.camera, size.x, size.y);
      (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
      const c = ao.configuration;
      c.halfRes = true;
      c.depthAwareUpsampling = true;
      c.aoSamples = 6; // 6 проби на половин резолюция — разликата не се вижда, ~0.5 ms по-евтино
      c.denoiseSamples = 4;
      c.denoiseRadius = 8;
      c.denoiseIterations = 1;
      c.aoRadius = 1.4;
      c.distanceFalloff = 0.5;
      c.intensity = 2.0;
      c.gammaCorrection = false;
      c.transparencyAware = false;
      c.screenSpaceRadius = false;
      this.ao = ao;
      this.composer.addPass(ao);
    }
    if (q !== 'low') {
      this.bloom = new BloomEffect({
        mipmapBlur: true, luminanceThreshold: 1.2, luminanceSmoothing: 0.35, intensity: 0.55, radius: 0.72,
        levels: 5,
      });
    }
    // един проход: изглаждане (върху HDR; прагът следи експонацията) → блясък → AgX и корекция
    this.aa = q === 'low'
      ? new FXAAEffect()
      // SMAA MEDIUM: HIGH почти не се различава, а е по-скъп на GTX 1650
      : new SMAAEffect({ preset: SMAAPreset.MEDIUM, edgeDetectionMode: EdgeDetectionMode.COLOR });
    if (this.aa instanceof SMAAEffect) uniformEdgeThreshold(this.aa);
    const effects: Effect[] = q === 'low' ? [this.grade, this.aa] : [this.aa];
    if (q !== 'low') { if (this.bloom) effects.push(this.bloom); effects.push(this.grade); }
    const main = new EffectPass(this.camera, ...effects);
    main.dithering = true;
    this.composer.addPass(main);
    this.passes.push(this.renderPass, main);
    if (this.ao) this.passes.push(this.ao as unknown as { dispose(): void });
  }

  setSize(w: number, h: number): void { this.composer.setSize(w, h, false); }

  render(dt: number): void {
    this.renderer.toneMappingExposure = this.exposure;
    this.grade.u('uNight').value = this.night;
    if (this.bloom) {
      // прагът — спрямо видимата яркост (експонацията се мени от ден към нощ)
      this.bloom.luminanceMaterial.threshold = 1.15 / Math.max(0.1, this.exposure);
      this.bloom.intensity = 0.5 + this.bloomBoost;
    }
    if (this.aa instanceof SMAAEffect) {
      const u = this.aa.edgeDetectionMaterial.uniforms.uEdgeThreshold;
      if (u) u.value = 0.07 / Math.max(0.3, this.exposure);
    }
    this.composer.render(dt);
  }
}

/**
 * Прагът на SMAA е #define в postprocessing — всяка промяна (а той следи експонацията всеки кадър) прекомпилира
 * шейдъра: по нов шейдър на кадър, докато окото „свиква“ (залез, гората, влизане в нощта) — секунди насечени кадри.
 * Тук прагът става uniform (един шейдър завинаги).
 */
function uniformEdgeThreshold(aa: SMAAEffect): void {
  const m = aa.edgeDetectionMaterial;
  m.uniforms.uEdgeThreshold = new THREE.Uniform(0.07);
  const fs = m.fragmentShader;
  const patched = fs.replace('const vec2 threshold=vec2(EDGE_THRESHOLD);', 'vec2 threshold=vec2(uEdgeThreshold);');
  if (patched === fs) return; // друга версия на библиотеката — остава с #define
  m.fragmentShader = 'uniform float uEdgeThreshold;\n' + patched;
  m.needsUpdate = true;
}
