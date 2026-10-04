// Старт на играта. (Временно: прост терен и летяща камера, докато модулите се сглобят в src/game/.)
import * as THREE from 'three';
import { Engine } from './engine/Engine';
import { createPlaceholderWorld } from './world/placeholder';
import { heightAt } from './world/height';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas);
createPlaceholderWorld(engine.scene);
let t = 0;
engine.onUpdate((dt) => {
  t += dt * 0.05;
  const x = Math.sin(t) * 120, z = 40 + Math.cos(t) * 120;
  engine.camera.position.set(x, heightAt(x, z) + 40, z);
  engine.camera.lookAt(new THREE.Vector3(0, 2, 40));
});
engine.start();
document.getElementById('loading')?.remove();
