// Жителите на Самодивско — носия по PLAN (бяла риза, червен пояс, тъмен елек; жените — забрадка и престилка с шевици).
import * as THREE from 'three';
import type { VillagerLook } from '../data/villagers';
import { HumanoidModel, humanDims, HIPS, SPINE, LFA, LHAND, RHAND } from './humanoid';
import { buildBody, buildHead } from './body';
import { buildTool } from './items';
import { mat, part, boxGeo, shevicaTex } from './shared';

export function buildVillager(look: VillagerLook): HumanoidModel {
  const female = look.gender === 'f';
  const old = look.age === 'old';
  const d = humanDims(look.height, look.build);
  const H = d.H, bw = d.bw;
  const hatH = look.hat === 'kalpak' ? 0.11 * H : female ? 0.015 * H : 0.01 * H;
  const m = new HumanoidModel(d, { kind: 'villager', female, old, tool: look.tool }, H + hatH);
  const shinColor = female ? '#ece5d6' : '#d9cfbd';
  buildBody(m, {
    skin: look.skin, shirt: look.shirt, belt: look.belt, vest: look.vest, legs: look.legs, shin: shinColor,
    shoe: female ? '#3a2a22' : '#5a3e2a',
    skirt: female ? { color: look.legs, flare: 0.2 } : undefined,
    cuff: female ? '#b3262b' : undefined,
    sleeveFlare: female ? 1.2 : 1.05,
  });
  const J = m.j;
  // престилка с шевици (жените)
  if (female && look.apron) {
    const tex = shevicaTex(look.apron);
    const am = tex ? mat('#ffffff', { map: tex }) : mat(look.apron);
    part(J[HIPS], boxGeo(), am, 0.16 * H * bw, 0.3 * H, 0.006 * H, 0, -0.14 * H, 0.129 * H * bw + 0.006 * H, -0.22, 0, 0);
  }
  // кожена престилка на ковача
  if (look.tool === 'hammer') {
    part(J[SPINE], boxGeo(), mat('#5a3a22'), 0.19 * H * bw, 0.3 * H, 0.008 * H, 0, -0.06 * H, 0.085 * H * bw, 0.04, 0, 0);
  }
  const hairCol = look.hair;
  buildHead(m, {
    skin: look.skin, hair: hairCol,
    hairStyle: old && !female ? 'cap' : 'cap',
    beard: look.beard ?? 'none',
    kalpak: look.hat === 'kalpak',
    scarf: female ? look.scarf ?? '#2a2a3a' : undefined,
    braid: female && look.age === 'young',
    noseScale: old ? 1.25 : look.gender === 'm' ? 1.1 : 0.9,
  });
  // сечиво
  if (look.tool) {
    const t = buildTool(look.tool);
    const oldAdj = old ? 0.3 : 0;
    switch (look.tool) {
      case 'staff': case 'crook':
        t.rotation.x = 0.77 - oldAdj;
        t.position.y = (look.tool === 'staff' ? 0.85 : 0.9) - 0.44 * H;
        J[RHAND].add(t); break;
      case 'hammer': case 'saw': case 'pipe':
        J[RHAND].add(t); break;
      case 'basket': {
        const g = new THREE.Group();
        g.position.set(0, -d.foreArm * 0.5, 0.045 * H);
        g.rotation.x = 1.57 - oldAdj;
        g.add(t); J[LFA].add(g); break;
      }
      case 'spindle':
        t.rotation.x = 1.25 - oldAdj; J[LHAND].add(t); break;
      case 'tray':
        t.rotation.x = 1.5 - oldAdj; t.position.y = 0.02;
        J[RHAND].add(t); break;
    }
  }
  return m.done();
}
