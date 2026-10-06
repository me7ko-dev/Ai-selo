// Портрети за диалога и HUD: истинското 3D лице на човека (глава и рамене), снимано веднъж при зареждането
// със светлина като в ателие (топла основна, хладна запълваща, контражур отзад) върху прозрачен фон.
// Картинките (data URL) се пазят; рамката-медальон рисува UI (src/ui/icons.ts → portrait()).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { VillagerLook } from '../../data/villagers';
import { charactersReady } from './assets';
import { GltfCharacter } from './character';
import { villagerSpec, heroSpec } from './looks';

export interface PortraitSubject {
  id: string;
  /** Външният вид на жителя; без него — Стоян. */
  look?: VillagerLook;
}

/**
 * Снима портретите (по един кадър на човек) в отделен малък WebGL контекст, който после се освобождава.
 * Връща id → data URL (PNG с прозрачност). Без браузър или без заредените хора — празно.
 */
export async function bakePortraits(list: PortraitSubject[], size = 256): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (typeof document === 'undefined' || !charactersReady() || !list.length) return out;
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.45;
    // осветление „три точки“: основна (топла, отпред-отляво-отгоре), запълваща (хладна, отдясно), контражур (отзад)
    const key = new THREE.DirectionalLight('#ffdcb8', 2.9); key.position.set(1.4, 2.6, 2.2);
    const fill = new THREE.DirectionalLight('#c9d8ff', 0.75); fill.position.set(-2, 1.6, 1.4);
    const rim = new THREE.DirectionalLight('#fff1dc', 2.6); rim.position.set(-0.8, 2.4, -2.4);
    const rim2 = new THREE.DirectionalLight('#dfe8ff', 1.2); rim2.position.set(1.2, 2, -2);
    scene.add(key, fill, rim, rim2, key.target, fill.target, rim.target, rim2.target);
    const cam = new THREE.PerspectiveCamera(22, 1, 0.05, 20);
    const head = new THREE.Vector3(), tgt = new THREE.Vector3();
    for (const s of list) {
      const m = new GltfCharacter(s.look ? villagerSpec(s.look) : heroSpec());
      if (!s.look) m.setWeapon(null);
      m.play('idle');
      for (let i = 0; i < 12; i++) m.update(1 / 30, 0);
      scene.add(m.root);
      m.root.updateMatrixWorld(true);
      const hb = m.root.getObjectByName('Head');
      if (hb) hb.getWorldPosition(head); else head.set(0, m.height - 0.12, 0);
      // глава и рамене, леко отстрани (три четвърти), очите малко над средата на кадъра
      tgt.set(head.x, head.y + 0.0, head.z + 0.02);
      for (const l of [key, fill, rim, rim2]) l.target.position.copy(tgt);
      const d = 1.4, yaw = 0.3;
      cam.position.set(tgt.x + Math.sin(yaw) * d, tgt.y + 0.1, tgt.z + Math.cos(yaw) * d);
      cam.lookAt(tgt.x, tgt.y + 0.05, tgt.z);
      for (const l of [key, fill, rim, rim2]) l.position.add(tgt);
      renderer.render(scene, cam);
      for (const l of [key, fill, rim, rim2]) l.position.sub(tgt);
      out.set(s.id, canvas.toDataURL('image/png'));
      scene.remove(m.root);
      m.dispose();
      // да не замръзва зареждането
      await new Promise((r) => setTimeout(r, 0));
    }
    env.dispose();
    pmrem.dispose();
  } catch (e) {
    console.warn('Портретите не станаха — остават рисуваните.', e);
  } finally {
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
  }
  return out;
}
