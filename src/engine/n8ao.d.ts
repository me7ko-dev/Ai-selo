// Типове за n8ao (библиотеката е на JavaScript, без собствени .d.ts) — само каквото ползваме.
declare module 'n8ao' {
  import type * as THREE from 'three';
  import type { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: {
      aoSamples: number; aoRadius: number; denoiseSamples: number; denoiseRadius: number; distanceFalloff: number;
      intensity: number; denoiseIterations: number; renderMode: number; color: THREE.Color; gammaCorrection: boolean;
      screenSpaceRadius: boolean; halfRes: boolean; depthAwareUpsampling: boolean; colorMultiply: boolean;
      transparencyAware: boolean; accumulate: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
