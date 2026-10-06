// „Реалистичен“ пас за процедурните създания (животни, лисицата-таласъм, караконджула): по-гъсти версии на общите
// геометрии (гладко осветяване без ръбове) и PBR материали вместо плоските Lambert. Вика се от RigModel.finish(),
// преди мешовете да се слеят. Само когато се ползват и реалистичните хора — на „Ниско“ (телефони) моделите остават леки.
import * as THREE from 'three';
import { cylGeo, sphGeo, lowSph, coneGeo, capGeo, cylCGeo } from './shared';
import { pmat } from './skin';

/** По-гъстата версия на обща геометрия (по ключа ѝ в кеша); други геометрии остават. */
export function hiResGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const key = g.userData?.geoKey as string | undefined;
  if (!key) return g;
  const p = key.split('|');
  switch (p[0]) {
    case 'ico': return sphGeo(Math.min(4, +p[1] + 2));
    case 'cyl': return cylGeo(+p[1], Math.max(12, +p[2] * 2), p[3] === 'true', +p[4], +p[5]);
    case 'cylc': return cylCGeo(+p[1], Math.max(12, +p[2] * 2));
    case 'sph': return lowSph(Math.max(16, +p[1] * 2), Math.max(10, +p[2] * 2));
    case 'cone': return coneGeo(Math.max(8, +p[1] * 2));
    case 'cap': return capGeo(Math.max(16, +p[1] * 2), Math.max(8, +p[2] * 2), +p[3]);
    default: return g;
  }
}

/** Плосък цвят → гладък PBR (матов, с малко блясък); прозрачните и светещите (Basic) остават. */
function plainPbr(m: THREE.MeshLambertMaterial): THREE.Material {
  const hasEm = m.emissive.r + m.emissive.g + m.emissive.b > 0;
  return pmat('#' + m.color.getHexString(), 0.72, {
    side: m.side,
    emissive: hasEm ? '#' + m.emissive.getHexString() : undefined,
    emissiveIntensity: hasEm ? m.emissiveIntensity : undefined,
  });
}

export function realify(root: THREE.Object3D, skinFor: (m: THREE.MeshLambertMaterial) => THREE.Material | undefined): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const m = mesh.material;
    if (!(m instanceof THREE.MeshLambertMaterial) || m.transparent || m.map) return;
    mesh.geometry = hiResGeo(mesh.geometry);
    mesh.material = skinFor(m) ?? plainPbr(m);
    mesh.receiveShadow = true;
  });
}
