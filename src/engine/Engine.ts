// Рендер, сцена, камера, цикъл. Светът (World3D) слага небе/светлини/мъгла; героят движи камерата.
// Картината минава през пост-обработката (post.ts): HDR → околно засенчване → блясък → AgX + корекция → SMAA.
import * as THREE from 'three';
import { Input } from './Input';
import { setMaxAnisotropy } from '../world/tex';
import { installAtmo } from './atmo';
import { PostFX, type PostQuality } from './post';
import { gpuName, qualityForGpu, type GpuQuality } from './gpu';

export type Updater = (dt: number) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly post: PostFX;
  /** Видеокартата и препоръчаното качество за нея (за първото пускане). */
  readonly gpu: { name: string; quality: GpuQuality };
  private updaters: Updater[] = [];
  private lateUpdaters: Updater[] = [];
  private last = performance.now();
  /** Колко пъти по-бързо тече времето за симулацията (машината на времето го ползва); рендерът не се влияе. */
  paused = false;
  /** таван на резолюцията от настройките на играча */
  pixelRatioCap = 1.5;
  /** таван от качеството (ниско/средно/високо) */
  private qualityPixelCap = 1.5;
  fps = 60;
  /** желана експонация (светът я подава според часа); стига се плавно */
  exposureTarget = 1;
  private exposure = 1;
  private fpsAcc = 0; private fpsFrames = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    installAtmo(); // кръпките на шейдърите — преди първия материал
    // без MSAA: изглаждането е SMAA в пост-обработката
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // тоновото преобразуване (AgX) е в пост-обработката; тук сцената остава линейна HDR
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    const name = gpuName(this.renderer.getContext());
    this.gpu = { name, quality: qualityForGpu(name) };
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1400);
    this.camera.position.set(0, 20, 160);
    this.input = new Input(canvas);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // за роботите със снимки (?shot=…): достъп до three (напр. пробни PBR тела)
    if (typeof location !== 'undefined' && /[?&]shot=/.test(location.search)) (window as unknown as { __THREE: typeof THREE }).__THREE = THREE;
  }

  setPixelRatioCap(cap: number): void {
    this.pixelRatioCap = cap;
    this.applyPixelRatio();
  }

  /** Качеството на картината: пост-обработка и таван на резолюцията. */
  setQuality(q: PostQuality): void {
    this.qualityPixelCap = q === 'low' ? 1 : q === 'medium' ? 1.25 : 1.5;
    this.post.setQuality(q);
    this.applyPixelRatio();
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap, this.qualityPixelCap));
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Шейдърите на всичко в сцената — още при зареждането: и на скритото (жители, които спят вкъщи, сборът, бурята),
   * и на сенките им, и на extra (напр. чудовищата, които се появяват по-късно). Иначе всеки нов вид неща на екрана
   * (първият жител в кадъра, първият таласъм) спира играта за 0,5–2 s, докато ANGLE компилира шейдърите.
   */
  async warmup(extra: THREE.Object3D[] = []): Promise<void> {
    const r = this.renderer, scene = this.scene;
    const tmp = new THREE.Group();
    for (const o of extra) tmp.add(o);
    tmp.position.copy(this.camera.position);
    scene.add(tmp);
    const saved: [THREE.Object3D, boolean, boolean][] = [];
    scene.traverse((o) => {
      saved.push([o, o.visible, o.frustumCulled]);
      o.visible = true; o.frustumCulled = false;
      const sh = (o as THREE.DirectionalLight).shadow;
      if (sh) sh.needsUpdate = true;
    });
    try {
      await r.compileAsync(scene, this.camera);
      // един кадър в малък буфер — компилира и вариантите за сенките
      const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
      r.setRenderTarget(rt);
      r.render(scene, this.camera);
      r.setRenderTarget(null);
      rt.dispose();
    } catch (e) { console.warn('warmup', e); }
    for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
    scene.remove(tmp);
  }

  /** Вика се всеки кадър преди рендера (dt в секунди, ≤ 0.1). Връща функция за махане. */
  onUpdate(fn: Updater): () => void { this.updaters.push(fn); return () => { this.updaters = this.updaters.filter(f => f !== fn); }; }
  /** Вика се след всички onUpdate (напр. камера, етикети над главите). */
  onLateUpdate(fn: Updater): () => void { this.lateUpdaters.push(fn); return () => { this.lateUpdaters = this.lateUpdaters.filter(f => f !== fn); }; }

  start(): void {
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(raw, 0.1);
    this.fpsAcc += raw; this.fpsFrames++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
    this.renderer.info.reset();
    for (const f of this.updaters) { try { f(dt); } catch (e) { console.error(e); } }
    for (const f of this.lateUpdaters) { try { f(dt); } catch (e) { console.error(e); } }
    // окото свиква плавно (в логаритмичен мащаб)
    const k = 1 - Math.exp(-dt * 1.6);
    this.exposure = Math.exp(Math.log(this.exposure) + (Math.log(Math.max(1e-3, this.exposureTarget)) - Math.log(this.exposure)) * k);
    this.post.exposure = this.exposure;
    this.post.render(dt);
    this.input.endFrame();
  }
}
