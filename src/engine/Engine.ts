// Рендер, сцена, камера, цикъл. Светът (World3D) слага небе/светлини/мъгла; героят движи камерата.
import * as THREE from 'three';
import { Input } from './Input';

export type Updater = (dt: number) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  private updaters: Updater[] = [];
  private lateUpdaters: Updater[] = [];
  private last = performance.now();
  /** Колко пъти по-бързо тече времето за симулацията (машината на времето го ползва); рендерът не се влияе. */
  paused = false;
  pixelRatioCap = 1.5;
  fps = 60;
  private fpsAcc = 0; private fpsFrames = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping; // пази цветовете от палитрата
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1400);
    this.camera.position.set(0, 20, 160);
    this.input = new Input(canvas);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setPixelRatioCap(cap: number): void {
    this.pixelRatioCap = cap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
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
    for (const f of this.updaters) { try { f(dt); } catch (e) { console.error(e); } }
    for (const f of this.lateUpdaters) { try { f(dt); } catch (e) { console.error(e); } }
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }
}
