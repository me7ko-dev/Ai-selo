// Предмети на земята: росен, звънчето, сандъци, плячка от враговете. Поклащат се и светят; [E] ги взима.
import * as THREE from 'three';
import type { WorldQuery } from '../core/world-query';
import { createPropModel } from '../models';
import { ITEMS, type ItemId } from './items';

export type PickupKind = 'rosen' | 'bell' | 'loot' | 'chest';

export interface WorldItem {
  key: string;
  kind: PickupKind;
  items: { id: ItemId; count: number }[];
  obj: THREE.Object3D;
  x: number; z: number; baseY: number;
  t: number;
  /** Изчезва след толкова секунди (плячката). */
  ttl?: number;
  /** Взима се само като минеш отгоре. */
  auto: boolean;
  label: string;
  /** Отворен сандък (остава, но не дава нищо). */
  used?: boolean;
}

const halo = (color: number, r: number) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.y = 0.35; return m;
};

function lootMesh(id: ItemId): THREE.Object3D {
  const g = new THREE.Group();
  const mat = (c: number, e = 0x000000) => new THREE.MeshStandardMaterial({ color: c, emissive: e, flatShading: true, roughness: 0.6 });
  let m: THREE.Mesh;
  switch (id) {
    case 'coin': m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10), mat(0xe8c27a, 0x553300)); m.rotation.x = Math.PI / 2; break;
    case 'claw': m = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 5), mat(0x2a2a2a)); m.rotation.z = 0.5; break;
    case 'bell': m = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.22, 8, 1, true), mat(0xc8902a, 0x442200)); break;
    case 'fox_tail': m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 6), mat(0xd0662a)); m.rotation.z = Math.PI / 2; break;
    case 'lamia_scale': m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 6), mat(0x4a7a3a, 0x113311)); m.rotation.x = 1.2; break;
    case 'rosen_potion': case 'banitsa': case 'tea': return createPropModel('potion');
    case 'saber': case 'ivan_saber': case 'bow': return createPropModel(id);
    default: m = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), mat(0xe8c27a));
  }
  m.position.y = 0.35; m.castShadow = true;
  g.add(m);
  return g;
}

export class PickupManager {
  list: WorldItem[] = [];
  private seq = 0;
  constructor(private scene: THREE.Scene) {}

  add(kind: PickupKind, key: string | null, x: number, z: number, items: { id: ItemId; count: number }[], world: WorldQuery, opts: { ttl?: number; auto?: boolean; label?: string } = {}): WorldItem {
    let obj: THREE.Object3D;
    if (kind === 'rosen') { obj = createPropModel('rosen'); obj.add(halo(0x9ad0ff, 0.5)); }
    else if (kind === 'chest') obj = createPropModel('chest');
    else { obj = lootMesh(items[0]?.id ?? 'coin'); obj.add(halo(kind === 'bell' ? 0xffe08a : 0xffd27a, kind === 'bell' ? 0.45 : 0.32)); }
    const y = world.heightAt(x, z);
    obj.position.set(x, y, z);
    this.scene.add(obj);
    const first = items[0] ? ITEMS[items[0].id] : null;
    const label = opts.label ?? (kind === 'chest' ? 'Отвори сандъка' : `Вземи: ${first?.name ?? ''}${items[0] && items[0].count > 1 ? ` ×${items[0].count}` : ''}`);
    const it: WorldItem = { key: key ?? `drop${++this.seq}`, kind, items, obj, x, z, baseY: y, t: Math.random() * 6, ttl: opts.ttl, auto: !!opts.auto, label };
    this.list.push(it);
    return it;
  }

  has(key: string): boolean { return this.list.some(p => p.key === key); }

  remove(it: WorldItem): void {
    it.obj.removeFromParent();
    this.list = this.list.filter(p => p !== it);
  }

  removeKey(key: string): void { const it = this.list.find(p => p.key === key); if (it) this.remove(it); }

  /** Поклащане, изтичане. Връща предметите, които се взимат сами (героят е отгоре). */
  update(dt: number, hx: number, hz: number): WorldItem[] {
    const auto: WorldItem[] = [];
    for (const p of this.list) {
      p.t += dt;
      if (p.kind !== 'chest') {
        p.obj.position.y = p.baseY + 0.12 + Math.sin(p.t * 2.2) * 0.1;
        p.obj.rotation.y += dt * (p.kind === 'rosen' ? 0.6 : 1.8);
      }
      if (p.ttl !== undefined) { p.ttl -= dt; if (p.ttl < 5) p.obj.visible = Math.sin(p.t * 20) > -0.3; }
      if (p.auto && !p.used && (p.x - hx) ** 2 + (p.z - hz) ** 2 < 1.6 * 1.6) auto.push(p);
    }
    for (const p of this.list.filter(q => q.ttl !== undefined && q.ttl <= 0)) this.remove(p);
    return auto;
  }

  nearest(hx: number, hz: number, maxD: number): { it: WorldItem; dist: number } | null {
    let best: WorldItem | null = null, bd = maxD;
    for (const p of this.list) {
      if (p.used) continue;
      const d = Math.hypot(p.x - hx, p.z - hz);
      if (d <= bd) { bd = d; best = p; }
    }
    return best ? { it: best, dist: bd } : null;
  }

  clear(filter?: (p: WorldItem) => boolean): void {
    for (const p of this.list.filter(q => !filter || filter(q))) p.obj.removeFromParent();
    this.list = this.list.filter(q => filter ? !filter(q) : false);
  }

  dispose(): void { this.clear(); }
}
