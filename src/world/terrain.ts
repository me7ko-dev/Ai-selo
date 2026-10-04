// Мрежата на терена: 6×6 парчета по 100 м, стъпка 2 м, „рисувана“ текстура върху целия свят + фин шум.
import * as THREE from 'three';
import { terrainHeight } from './height';
import { WORLD_HALF } from '../data/layout';

export function buildTerrain(tex: THREE.Texture, step = 2): { group: THREE.Group; material: THREE.MeshLambertMaterial } {
  const S = WORLD_HALF * 2, N = Math.round(S / step);
  // височини и нормали на цялата мрежа (за гладки шевове между парчетата)
  const H = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = terrainHeight(-WORLD_HALF + i * step, -WORLD_HALF + j * step);
  const h = (i: number, j: number) => H[Math.min(N, Math.max(0, j)) * (N + 1) + Math.min(N, Math.max(0, i))];
  const material = new THREE.MeshLambertMaterial({ map: tex });
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vWP;\nfloat th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }\n'
      + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float dn = tn(vWP.xz * 1.7) * 0.55 + tn(vWP.xz * 5.3) * 0.3 + tn(vWP.xz * 0.35) * 0.15;
        diffuseColor.rgb *= 0.86 + dn * 0.26;`);
  };
  const group = new THREE.Group(); group.name = 'terrain';
  const C = 6, per = N / C;
  for (let cj = 0; cj < C; cj++) for (let ci = 0; ci < C; ci++) {
    const pos = new Float32Array((per + 1) * (per + 1) * 3), nor = new Float32Array(pos.length), uv = new Float32Array((per + 1) * (per + 1) * 2);
    let k = 0;
    for (let j = 0; j <= per; j++) for (let i = 0; i <= per; i++) {
      const gi = ci * per + i, gj = cj * per + j;
      const x = -WORLD_HALF + gi * step, z = -WORLD_HALF + gj * step;
      pos[k * 3] = x; pos[k * 3 + 1] = h(gi, gj); pos[k * 3 + 2] = z;
      const nx = h(gi - 1, gj) - h(gi + 1, gj), nz = h(gi, gj - 1) - h(gi, gj + 1), ny = 2 * step, l = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
      uv[k * 2] = (x + WORLD_HALF) / S; uv[k * 2 + 1] = 1 - (z + WORLD_HALF) / S;
      k++;
    }
    const idx: number[] = [];
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
      const a = j * (per + 1) + i, b = a + 1, c = a + per + 1, d = c + 1;
      // редуваме диагонала за по-естествен вид
      if ((i + j) % 2) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false; mesh.name = `terrain_${ci}_${cj}`;
    group.add(mesh);
  }
  return { group, material };
}
