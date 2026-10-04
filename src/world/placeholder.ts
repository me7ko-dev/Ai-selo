// Прост терен + светлини — само за проби (dev страници) и докато World3D не е готов.
import * as THREE from 'three';
import { heightAt } from './height';
import { PLACES } from '../data/layout';

export function createPlaceholderWorld(scene: THREE.Scene): { update(dt: number): void } {
  scene.background = new THREE.Color('#9cc7e8');
  scene.fog = new THREE.Fog('#c9dbe6', 120, 520);
  const N = 200, S = 600;
  const geo = new THREE.PlaneGeometry(S, S, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), grass = new THREE.Color('#6f9a4a'), grass2 = new THREE.Color('#4f7a3a'), rock = new THREE.Color('#9a9184');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z);
    pos.setY(i, y);
    c.copy(grass).lerp(grass2, (Math.sin(x * 0.05) * Math.cos(z * 0.04) + 1) / 2);
    if (y > 22) c.lerp(rock, Math.min(1, (y - 22) / 14));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight('#e9f1f4', '#4f7a3a', 1.1));
  const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
  sun.position.set(80, 140, 60);
  scene.add(sun);
  // кутийки на местата на къщите
  for (const p of Object.values(PLACES)) {
    if (!p.id.startsWith('house_') && !['inn', 'smithy'].includes(p.id)) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 7), new THREE.MeshLambertMaterial({ color: '#efe6d4' }));
    m.position.set(p.pos.x, heightAt(p.pos.x, p.pos.z) + 3, p.pos.z);
    m.rotation.y = p.facing ?? 0;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.5, 3, 4), new THREE.MeshLambertMaterial({ color: '#a4472f' }));
    roof.position.y = 4.5; roof.rotation.y = Math.PI / 4;
    m.add(roof);
    scene.add(m);
  }
  return { update() {} };
}
