// Картата на „Край 1: Самодивско“ — единственият източник на координати за всички модули
// (светът строи по тях, жителите ходят по тях, задачите и картата ги ползват).
// Мерки в метри. Светът е от -300 до 300 по x и z. СЕВЕР = -z (горе на картата).

export interface Vec2 { x: number; z: number }

export type PlaceId =
  | 'square' | 'walnut' | 'well' | 'smithy' | 'inn' | 'coop' | 'sheepfold' | 'field_ivan' | 'gate'
  | 'house_gena' | 'house_peyu' | 'house_petko' | 'house_ivan' | 'house_maria' | 'house_radka' | 'house_kalin'
  | 'workshop_kalin' | 'loom_maria'
  | 'forest_edge' | 'forest' | 'glade' | 'pond' | 'riverbed' | 'bridge' | 'lamia_plateau' | 'lamia_peak'
  | 'fortress' | 'swamp' | 'south_road' | 'start';

export interface Place {
  id: PlaceId;
  name: string;          // името на български (за картата, летописа, диалозите)
  pos: Vec2;
  radius: number;        // колко е голямо мястото (за „стигнал ли е“, за картата)
  region: RegionId;
  /** посоката, в която гледа сградата (radians, rotation.y; 0 = лицето към +z/юг) */
  facing?: number;
}

export type RegionId = 'village' | 'forest' | 'glade' | 'river' | 'peak' | 'fortress' | 'swamp' | 'fields' | 'wild';

export const WORLD_HALF = 300;
export const VILLAGE_CENTER: Vec2 = { x: 0, z: 40 };
export const VILLAGE_RADIUS = 80;

const P = (id: PlaceId, name: string, x: number, z: number, radius: number, region: RegionId, facing?: number): Place =>
  ({ id, name, pos: { x, z }, radius, region, facing });

export const PLACES: Record<PlaceId, Place> = {
  square: P('square', 'мегданът', 0, 40, 14, 'village'),
  walnut: P('walnut', 'старият орех', 0, 40, 4, 'village'),
  well: P('well', 'чешмата', 11, 29, 3, 'village', Math.PI * 0.75),
  smithy: P('smithy', 'ковачницата', -34, 44, 7, 'village', Math.PI / 2),
  inn: P('inn', 'ханът', 31, 43, 8, 'village', -Math.PI / 2),
  coop: P('coop', 'кокошарникът', 47, 54, 4, 'village', -Math.PI / 2),
  sheepfold: P('sheepfold', 'кошарата', -72, 100, 12, 'fields', Math.PI / 4),
  field_ivan: P('field_ivan', 'нивата на Иван', 52, 108, 16, 'fields'),
  gate: P('gate', 'входът на селото', 0, 92, 5, 'village'),
  house_gena: P('house_gena', 'къщата на баба Гена', -46, 14, 6, 'village', Math.PI * 0.25),
  house_peyu: P('house_peyu', 'къщата на дядо Пею', -20, 10, 6, 'village', 0),
  house_petko: P('house_petko', 'къщата на Петко', -56, 76, 6, 'village', Math.PI * 0.6),
  house_ivan: P('house_ivan', 'къщата на Иван', -32, 64, 6, 'village', Math.PI / 2),
  house_maria: P('house_maria', 'къщата на Мария', 22, 8, 6, 'village', 0),
  house_radka: P('house_radka', 'къщата на Радка', 48, 30, 6, 'village', -Math.PI / 2),
  house_kalin: P('house_kalin', 'къщата на Калин', 30, 70, 6, 'village', Math.PI),
  workshop_kalin: P('workshop_kalin', 'дърводелницата', 40, 76, 4, 'village', Math.PI),
  loom_maria: P('loom_maria', 'станът на Мария', 26, 16, 2, 'village', 0),
  forest_edge: P('forest_edge', 'края на гората', -88, 4, 8, 'forest'),
  forest: P('forest', 'Тъмната гора', -150, -50, 95, 'forest'),
  glade: P('glade', 'Поляната на самодивите', -175, -175, 30, 'glade'),
  pond: P('pond', 'езерцето', -178, -182, 13, 'glade'),
  riverbed: P('riverbed', 'коритото на Бистрица', 100, -20, 10, 'river'),
  bridge: P('bridge', 'каменният мост', 88, 44, 6, 'river', Math.PI / 2),
  lamia_plateau: P('lamia_plateau', 'бърлогата на Ламята', 150, -168, 24, 'peak'),
  lamia_peak: P('lamia_peak', 'Ламин връх', 178, -208, 20, 'peak'),
  fortress: P('fortress', 'Старата крепост', 215, 50, 22, 'fortress'),
  swamp: P('swamp', 'Блатото на юдите', -175, 170, 60, 'swamp'),
  south_road: P('south_road', 'пътят на юг', 0, 200, 6, 'wild'),
  start: P('start', 'пътят към селото', 0, 132, 3, 'wild', Math.PI),
};

/** Пресъхналото корито на река Бистрица — от извора в края на платото под Ламин връх (Ламята седи на извора) надолу покрай селото на юг. */
export const RIVER_PATH: Vec2[] = [
  { x: 136, z: -146 }, { x: 126, z: -108 }, { x: 108, z: -46 },
  { x: 92, z: 10 }, { x: 87, z: 44 }, { x: 86, z: 92 }, { x: 94, z: 160 }, { x: 88, z: 230 }, { x: 82, z: 310 },
];
export const RIVER_HALF_WIDTH = 6;

/** Пътища (за жителите — ходят по тях; за света — рисуват се като пътеки). */
export const ROAD_NODES: Record<string, Vec2> = {
  gate: { x: 0, z: 92 },
  sq_s: { x: 0, z: 58 }, sq_n: { x: 0, z: 22 }, sq_w: { x: -18, z: 40 }, sq_e: { x: 18, z: 40 },
  well: { x: 8, z: 32 },
  inn: { x: 24, z: 44 }, coop: { x: 42, z: 52 },
  smithy: { x: -28, z: 46 },
  gena: { x: -40, z: 20 }, peyu: { x: -20, z: 17 }, petko: { x: -50, z: 72 }, ivan: { x: -26, z: 62 },
  maria: { x: 22, z: 15 }, radka: { x: 41, z: 31 }, kalin: { x: 30, z: 63 }, workshop: { x: 38, z: 70 },
  sheepfold: { x: -64, z: 92 }, fields: { x: 44, z: 98 },
  forest_edge: { x: -86, z: 6 }, forest_mid: { x: -138, z: -42 }, forest_deep: { x: -160, z: -110 }, glade: { x: -168, z: -158 },
  bridge_w: { x: 78, z: 44 }, bridge_e: { x: 98, z: 44 }, fortress: { x: 204, z: 50 },
  river_low: { x: 96, z: 0 }, river_mid: { x: 118, z: -70 }, lamia: { x: 146, z: -160 },
  south: { x: 0, z: 140 }, south_far: { x: 0, z: 270 },
};

export const ROAD_EDGES: [string, string][] = [
  ['gate', 'sq_s'], ['sq_s', 'sq_w'], ['sq_s', 'sq_e'], ['sq_n', 'sq_w'], ['sq_n', 'sq_e'], ['sq_n', 'well'], ['well', 'sq_e'],
  ['sq_e', 'inn'], ['inn', 'coop'], ['inn', 'radka'], ['radka', 'well'], ['sq_w', 'smithy'], ['smithy', 'ivan'], ['ivan', 'sq_s'],
  ['sq_n', 'peyu'], ['peyu', 'gena'], ['gena', 'forest_edge'], ['smithy', 'petko'], ['petko', 'sheepfold'], ['sq_n', 'maria'],
  ['maria', 'radka'], ['sq_s', 'kalin'], ['kalin', 'workshop'], ['kalin', 'coop'], ['gate', 'fields'], ['coop', 'fields'],
  ['gate', 'south'], ['south', 'south_far'], ['sheepfold', 'gate'],
  ['forest_edge', 'forest_mid'], ['forest_mid', 'forest_deep'], ['forest_deep', 'glade'],
  ['coop', 'bridge_w'], ['radka', 'bridge_w'], ['bridge_w', 'bridge_e'], ['bridge_e', 'fortress'],
  ['bridge_w', 'river_low'], ['river_low', 'river_mid'], ['river_mid', 'lamia'],
];

/** Места, където расте билката росен (в Тъмната гора). */
export const ROSEN_SPOTS: Vec2[] = [
  { x: -122, z: -18 }, { x: -146, z: -64 }, { x: -170, z: -40 }, { x: -132, z: -96 },
  { x: -186, z: -84 }, { x: -110, z: -60 }, { x: -158, z: -128 }, { x: -196, z: -20 },
];

/** Къде излизат таласъмите по здрач (вътре в гората). */
export const TALASAM_SPAWNS: Vec2[] = [
  { x: -128, z: -30 }, { x: -150, z: -80 }, { x: -175, z: -55 }, { x: -140, z: -120 }, { x: -105, z: -45 }, { x: -190, z: -110 },
];

/** Гората: кръг + малко неправилност (светът я пълни с борове; таласъмите не излизат извън нея). */
export const FOREST = { center: { x: -150, z: -60 } as Vec2, radius: 100 };

/** Заключени места (засега): невидима стена + надпис. */
export const LOCKED_REGIONS: { place: PlaceId; radius: number; message: string }[] = [
  { place: 'swamp', radius: 62, message: 'Пътят към Блатото на юдите е затрупан. (Ще се отвори по-късно.)' },
];

export function dist2(a: Vec2, b: Vec2): number { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }
export function dist(a: Vec2, b: Vec2): number { return Math.sqrt(dist2(a, b)); }

/** Най-близкото място (за „къде е сега“ в летописа / диалозите). */
export function nearestPlace(p: Vec2, filter?: (pl: Place) => boolean): Place {
  let best: Place = PLACES.square, bd = Infinity;
  for (const pl of Object.values(PLACES)) {
    if (filter && !filter(pl)) continue;
    const d = dist(p, pl.pos) - pl.radius;
    if (d < bd) { bd = d; best = pl; }
  }
  return best;
}

/** Път по пътищата от точка a до точка b (Dijkstra по ROAD_NODES). Връща точки, вкл. крайната. */
export function roadPath(a: Vec2, b: Vec2): Vec2[] {
  const names = Object.keys(ROAD_NODES);
  const nearest = (p: Vec2) => { let n = names[0], d = Infinity; for (const k of names) { const dd = dist2(p, ROAD_NODES[k]); if (dd < d) { d = dd; n = k; } } return n; };
  const s = nearest(a), t = nearest(b);
  // ако е по-близо направо — направо
  if (s === t || dist(a, b) < dist(a, ROAD_NODES[s]) + dist(ROAD_NODES[t], b) * 0.5) return [{ ...b }];
  const adj = new Map<string, string[]>();
  for (const [u, v] of ROAD_EDGES) { (adj.get(u) ?? adj.set(u, []).get(u)!).push(v); (adj.get(v) ?? adj.set(v, []).get(v)!).push(u); }
  const D = new Map<string, number>(names.map(n => [n, Infinity])); const prev = new Map<string, string>();
  D.set(s, 0); const todo = new Set(names);
  while (todo.size) {
    let u = '', du = Infinity; for (const n of todo) { const d = D.get(n)!; if (d < du) { du = d; u = n; } }
    if (!u || u === t) break; todo.delete(u);
    for (const v of adj.get(u) ?? []) { const nd = du + dist(ROAD_NODES[u], ROAD_NODES[v]); if (nd < D.get(v)!) { D.set(v, nd); prev.set(v, u); } }
  }
  if (!prev.has(t)) return [{ ...b }];
  const chain: string[] = []; for (let c: string | undefined = t; c; c = prev.get(c)) { chain.unshift(c); if (c === s) break; }
  return [...chain.map(n => ({ ...ROAD_NODES[n] })), { ...b }];
}
