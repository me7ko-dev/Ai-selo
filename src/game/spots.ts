// Къде точно стоят жителите: по истинския план на света (сградите са преместени встрани от пътищата),
// а не по грубите точки от картата. Всяко място е избутано извън препятствията (къщи, маси, наковалня…).
import { getPlan, type WorldPlan } from '../world/plan';
import { PLACES, ROAD_NODES, type PlaceId, type Vec2 } from '../data/layout';
import { VILLAGER_IDS, type VillagerId } from '../data/villagers';
import { baseSpotFor, type SpotTable } from '../sim/schedules';

/** Опорна точка на място: център + посока (rot като rotation.y) + линията, на която се стои отпред. */
interface Anchor {
  x: number; z: number; rot: number;
  /** колко напред (по лицето) е редицата */
  front: number;
  /** разстояние между жителите встрани */
  spread: number;
  /** лични места (локални координати: x встрани, z напред), напр. Иван при наковалнята */
  own?: Partial<Record<VillagerId, [number, number]>>;
  /** открито място: разпръснати в кръг с този радиус */
  scatter?: number;
  /** „вътре“: точката зад вратата (жителят изчезва на прага, не насред двора) */
  door?: Vec2;
}

const toWorld = (a: { x: number; z: number; rot: number }, lx: number, lz: number): Vec2 => {
  const cs = Math.cos(a.rot), sn = Math.sin(a.rot);
  return { x: a.x + lx * cs + lz * sn, z: a.z - lx * sn + lz * cs };
};

function anchors(plan: WorldPlan): { anchors: Partial<Record<PlaceId, Anchor>>; centers: Partial<Record<PlaceId, Vec2>> } {
  const A: Partial<Record<PlaceId, Anchor>> = {};
  const C: Partial<Record<PlaceId, Vec2>> = {};
  for (const h of plan.houses) {
    // центърът на целия отпечатък (с чардака)
    const r = toWorld({ x: h.x, z: h.z, rot: h.rot }, h.fx, h.fz);
    C[h.id] = { x: h.x, z: h.z };
    if (h.kind === 'inn') {
      // ханджийката — на прага пред чардака; другите — пред масите
      A[h.id] = { x: r.x, z: r.z, rot: h.rot, front: h.fd / 2 + 4.6, spread: 1.9, own: { radka: [-h.w / 2 + 1.2, h.fd / 2 + 0.9] } };
    } else {
      A[h.id] = { x: r.x, z: r.z, rot: h.rot, front: h.fd / 2 + 1.5, spread: 1.4 };
    }
    A[h.id]!.door = toWorld({ x: r.x, z: r.z, rot: h.rot }, 0, h.fd / 2 - 1.2);
  }
  const prop = (type: string) => plan.props.find((p) => p.type === type);
  const smithy = prop('smithy');
  if (smithy) {
    C.smithy = { x: smithy.x, z: smithy.z };
    A.smithy = { x: smithy.x, z: smithy.z, rot: smithy.rot, front: 4.4, spread: 1.4, own: { ivan: [1.0, 1.45] } };
  }
  const coop = prop('coop');
  if (coop) { C.coop = { x: coop.x, z: coop.z }; A.coop = { x: coop.x, z: coop.z, rot: coop.rot, front: 2.8, spread: 1.4 }; }
  const ws = prop('workshop');
  if (ws) {
    C.workshop_kalin = { x: ws.x, z: ws.z };
    A.workshop_kalin = { x: ws.x, z: ws.z, rot: ws.rot, front: 3.9, spread: 1.4, own: { kalin: [-1.2, 2.9] } };
  }
  const loom = prop('loom');
  if (loom) {
    C.loom_maria = { x: loom.x, z: loom.z };
    A.loom_maria = { x: loom.x, z: loom.z, rot: loom.rot, front: 2.3, spread: 1.4, own: { maria: [0, 1.25] } };
  }
  const well = prop('fountain');
  if (well) { C.well = { x: well.x, z: well.z }; A.well = { x: well.x, z: well.z, rot: well.rot, front: 2.1, spread: 1.4 }; }
  // кошарата: вътре, до отвора към пътя
  {
    const c = PLACES.sheepfold.pos, n = ROAD_NODES.sheepfold;
    const rot = Math.atan2(n.x - c.x, n.z - c.z);
    C.sheepfold = { x: c.x, z: c.z };
    A.sheepfold = { x: c.x + Math.sin(rot) * 3.4, z: c.z + Math.cos(rot) * 3.4, rot, front: 0, spread: 1.3 };
  }
  const field = prop('field');
  if (field) { C.field_ivan = { x: field.x, z: field.z }; A.field_ivan = { x: field.x - 4, z: field.z, rot: field.rot, front: -12.3, spread: 1.6 }; } // нивата е оградена със зид: стоят отвън, откъм пътя
  return { anchors: A, centers: C };
}

export function buildSpotTable(plan: WorldPlan = getPlan()): SpotTable {
  const { anchors: A, centers } = anchors(plan);
  const col = plan.colliders;
  const spots: Record<string, Vec2> = {};
  for (const place of Object.keys(PLACES) as PlaceId[]) {
    const a = A[place];
    VILLAGER_IDS.forEach((id, i) => {
      // вътре: в средата на сградата (не се вижда)
      const inside = a?.door ? { ...a.door } : a && centers[place] ? { ...centers[place]! } : baseSpotFor(place, id, true);
      spots[`${place}:${id}:1`] = inside;
      let p: Vec2;
      if (!a) p = baseSpotFor(place, id, false);
      else if (a.scatter) { const ang = i * 2.4 + 0.5; p = { x: a.x + Math.sin(ang) * a.scatter, z: a.z + Math.cos(ang) * a.scatter }; }
      else { const own = a.own?.[id]; p = own ? toWorld(a, own[0], own[1]) : toWorld(a, (i - 3) * a.spread, a.front); }
      const q = col.collide(p.x, p.z, 0.4);
      spots[`${place}:${id}:0`] = { x: Math.round(q.x * 100) / 100, z: Math.round(q.z * 100) / 100 };
    });
  }
  return { spots, centers };
}
