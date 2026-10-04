// Сечива, оръжия и предмети. Всяко сечиво/оръжие има хватка в (0,0,0).
import * as THREE from 'three';
import { mat, part, cylGeo, cylCGeo, boxGeo, sphGeo, lowSph, coneGeo, cachedGeo, glow, haloSprite } from './shared';
import type { ToolKind } from './humanoid';

const WOOD = '#6b4a2a', WOOD_L = '#a0764a', IRON = '#3d3f45', STEEL = '#c9d0d8';

/** Сабя: хватка в началото, острието по +Y (леко извито). fine = Сабята на Иван. */
export function buildSaber(fine = false): THREE.Group {
  const g = new THREE.Group();
  const blade = cachedGeo('saberBlade|' + fine, () => {
    const L = fine ? 0.82 : 0.74, w = fine ? 0.03 : 0.04;
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0);
    sh.quadraticCurveTo(-w / 2 - 0.02, L * 0.6, -0.06, L);           // гръб, леко извит
    sh.quadraticCurveTo(-0.01, L * 0.92, w / 2, L * 0.75);
    sh.quadraticCurveTo(w / 2 - 0.01, L * 0.4, w / 2, 0);
    sh.lineTo(-w / 2, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false, curveSegments: 4 });
    geo.translate(0, 0.1, -0.003);
    return geo;
  });
  const bm = fine ? mat('#e4ebf2', { emissive: '#8fa6c0', emissiveIntensity: 0.25 }) : mat(STEEL);
  const bl = new THREE.Mesh(blade, bm); bl.castShadow = true; g.add(bl);
  const gold = fine ? mat('#d8aa3a', { emissive: '#6a4a10', emissiveIntensity: 0.35 }) : mat('#8a6a3a');
  part(g, boxGeo(), gold, 0.11, 0.018, 0.03, 0, 0.1, 0);                         // предпазител
  part(g, cylCGeo(1, 6), mat(fine ? '#3a1a14' : '#2e2018'), 0.016, 0.12, 0.016, 0, 0.035, 0); // дръжка
  part(g, sphGeo(0), gold, 0.022, 0.022, 0.022, 0, -0.03, 0);                       // топче
  if (fine) {
    part(g, coneGeo(4), mat('#b3262b'), 0.018, 0.09, 0.018, 0, -0.03, 0, Math.PI, 0, 0, false); // пискюл
    part(g, sphGeo(0), glow('#ffe7a0'), 0.009, 0.009, 0.009, 0, 0.1, 0.017, 0, 0, 0, false);
  }
  return g;
}

/** Ножница (за гърба на Стоян). */
export function buildScabbard(): THREE.Group {
  const g = new THREE.Group();
  part(g, cylGeo(0.75, 6), mat('#3a2618'), 0.03, 0.78, 0.014, 0, 0.1, 0);
  part(g, cylGeo(1, 6), mat('#8a6a3a'), 0.032, 0.03, 0.016, 0, 0.1, 0, 0, 0, 0, false);
  part(g, cylGeo(1, 6), mat('#8a6a3a'), 0.025, 0.03, 0.013, 0, 0.8, 0, 0, 0, 0, false);
  return g;
}

/** Лъкът на Калин: дъга в равнината YZ, хватка в средата, тетивата е отзад (-Z). */
export function buildBow(): THREE.Group {
  const g = new THREE.Group();
  const R = 0.62, A = Math.PI * 0.6;
  const inner = new THREE.Group(); inner.rotation.y = -Math.PI / 2; g.add(inner);
  const arc = cachedGeo('bowArc', () => { const t = new THREE.TorusGeometry(R, 0.016, 4, 12, A); t.rotateZ(-A / 2); t.translate(-R, 0, 0); return t; });
  const a = new THREE.Mesh(arc, mat('#7a4e2a')); a.castShadow = true; inner.add(a);
  const tipX = R * Math.cos(A / 2) - R, tipY = R * Math.sin(A / 2);
  part(inner, cylCGeo(1, 3), mat('#efe6d4'), 0.004, tipY * 2, 0.004, tipX, 0, 0, 0, 0, 0, false);
  part(g, cylCGeo(1, 6), mat('#3a2618'), 0.022, 0.12, 0.022, 0, 0, 0);
  part(g, cylCGeo(1, 6), mat('#b3262b'), 0.024, 0.03, 0.024, 0, 0.07, 0, 0, 0, 0, false);
  return g;
}

/** Сечивата на жителите. Ориентацията е спрямо ръката (ръката виси надолу, +Z е напред). */
export function buildTool(kind: ToolKind): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(WOOD), woodL = mat(WOOD_L);
  switch (kind) {
    case 'staff':
      part(g, cylGeo(0.85, 5), woodL, 0.022, 1.45, 0.022, 0, -0.85, 0);
      part(g, sphGeo(0), wood, 0.04, 0.035, 0.04, 0, 0.6, 0);
      break;
    case 'crook': {
      part(g, cylGeo(0.9, 5), woodL, 0.02, 1.6, 0.02, 0, -0.9, 0);
      const hook = cachedGeo('crookHook', () => new THREE.TorusGeometry(0.075, 0.018, 4, 8, Math.PI * 1.25));
      const h = new THREE.Mesh(hook, woodL);
      h.position.set(0, 0.7, 0.075); h.rotation.set(0, Math.PI / 2, 0); h.castShadow = true;
      g.add(h);
      break;
    }
    case 'hammer': {
      const hg = new THREE.Group(); hg.rotation.x = 0.5; g.add(hg);
      part(hg, cylGeo(1, 5), woodL, 0.018, 0.4, 0.018, 0, 0, -0.06, Math.PI / 2, 0, 0);
      part(hg, boxGeo(), mat(IRON), 0.06, 0.16, 0.065, 0, 0.02, 0.32);
      break;
    }
    case 'basket': {
      const wick = mat('#a77b45');
      part(g, cylGeo(1.25, 8), wick, 0.1, 0.14, 0.1, 0, -0.2, 0);
      part(g, cylGeo(1, 8), mat('#8a6236'), 0.126, 0.02, 0.126, 0, -0.07, 0, 0, 0, 0, false);
      const handle = cachedGeo('basketHandle', () => new THREE.TorusGeometry(0.11, 0.01, 3, 8, Math.PI));
      const hh = new THREE.Mesh(handle, wick); hh.position.y = -0.07; hh.rotation.y = Math.PI / 2; g.add(hh);
      // билки
      for (let i = 0; i < 5; i++) part(g, sphGeo(0), mat(i % 2 ? '#6f9a4a' : '#9ab8d8'), 0.035, 0.03, 0.035, Math.cos(i * 1.3) * 0.05, -0.05, Math.sin(i * 1.3) * 0.05, 0, 0, 0, false);
      break;
    }
    case 'spindle': {
      part(g, cylGeo(0.7, 5), woodL, 0.016, 1.05, 0.016, 0, -0.3, 0);
      part(g, sphGeo(1), mat('#f1ebdd'), 0.075, 0.13, 0.075, 0, 0.55, 0);
      part(g, cylGeo(1, 6), mat('#b3262b'), 0.02, 0.03, 0.02, 0, 0.36, 0, 0, 0, 0, false);
      break;
    }
    case 'tray': {
      const tg = new THREE.Group(); tg.position.set(0.19, 0.0, 0.1); g.add(tg);
      part(tg, cylGeo(1, 10), mat('#b87333'), 0.2, 0.02, 0.2, 0, 0, 0);
      part(tg, sphGeo(1), mat('#c8914a'), 0.08, 0.04, 0.08, 0.05, 0.035, 0.02);
      part(tg, cylGeo(0.8, 6), mat('#7a3a2a'), 0.03, 0.06, 0.03, -0.09, 0.02, 0.05);
      part(tg, cylGeo(0.8, 6), mat('#7a3a2a'), 0.03, 0.06, 0.03, -0.07, 0.02, -0.08);
      break;
    }
    case 'saw': {
      part(g, boxGeo(), woodL, 0.035, 0.1, 0.06, 0, 0, 0.01);
      part(g, boxGeo(), mat(STEEL), 0.004, 0.11, 0.5, 0, -0.02, 0.29);
      break;
    }
    case 'pipe': {
      part(g, cylGeo(1, 5), wood, 0.01, 0.18, 0.01, 0, 0, 0, Math.PI / 2, 0, 0);
      part(g, cylGeo(1.2, 6), wood, 0.02, 0.05, 0.02, 0, 0, 0.18);
      break;
    }
  }
  return g;
}

/** Росен — сребристо-синя цъфтяща билка със светеща роса (вижда се отдалеч по здрач). */
export function buildRosen(): THREE.Group {
  const g = new THREE.Group();
  const stem = mat('#5f8a5a');
  const leaf = mat('#8fb39a');
  const petal = mat('#b8d4f0', { emissive: '#4a78b0', emissiveIntensity: 0.55 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, r = 0.04 + (i % 2) * 0.04;
    const h = 0.32 + ((i * 37) % 10) / 40;
    const tilt = 0.18 + (i % 3) * 0.06;
    const st = new THREE.Group(); st.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    st.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt); g.add(st);
    part(st, cylGeo(0.6, 3), stem, 0.01, h, 0.01, 0, 0, 0, 0, 0, 0, false);
    part(st, sphGeo(0), leaf, 0.05, 0.012, 0.022, 0.03, h * 0.4, 0, 0, a, 0.4, false);
    // соцветие — гроздче от звездички
    for (let f = 0; f < 3; f++) part(st, sphGeo(0), petal, 0.032, 0.026, 0.032, Math.cos(f * 2.1) * 0.025, h + f * 0.02, Math.sin(f * 2.1) * 0.025, f, f, 0, false);
    part(st, lowSph(5, 4), glow('#e8fbff'), 0.016, 0.016, 0.016, 0.02, h + 0.06, 0.01, 0, 0, 0, false);
  }
  // листна розетка
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    part(g, sphGeo(0), leaf, 0.09, 0.012, 0.035, Math.cos(a) * 0.08, 0.02, Math.sin(a) * 0.08, 0, -a, 0.15, false);
  }
  const halo = haloSprite('#8fd0ff', 1.3, 0.6);
  halo.position.y = 0.42; g.add(halo);
  const core = haloSprite('#e8fbff', 0.5, 0.85);
  core.position.y = 0.42; g.add(core);
  // леко пулсиране без кадрови заделяния
  const ph = Math.random() * 6;
  halo.onBeforeRender = () => { const k = 0.85 + 0.15 * Math.sin(performance.now() * 0.002 + ph); halo.scale.set(1.3 * k, 1.3 * k, 1); };
  return g;
}

export function buildChest(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat('#7a4e2a'), band = mat('#3d3f45'), gold = mat('#d8aa3a', { emissive: '#5a3a10', emissiveIntensity: 0.3 });
  part(g, boxGeo(), wood, 0.8, 0.42, 0.5, 0, 0.21, 0);
  const lid = new THREE.Group(); lid.position.set(0, 0.42, -0.25); lid.name = 'lid'; g.add(lid);
  part(lid, cylCGeo(1, 8), wood, 0.25, 0.8, 0.25, 0, 0, 0.25, 0, 0, Math.PI / 2).scale.set(0.25, 0.8, 0.25);
  for (const x of [-0.3, 0.3]) {
    part(g, boxGeo(), band, 0.05, 0.43, 0.52, x, 0.215, 0);
    part(lid, cylCGeo(1, 8), band, 0.26, 0.05, 0.26, x, 0, 0.25, 0, 0, Math.PI / 2);
  }
  part(g, boxGeo(), gold, 0.09, 0.11, 0.03, 0, 0.38, 0.26);
  return g;
}

export function buildPotion(): THREE.Group {
  const g = new THREE.Group();
  const body = cachedGeo('potionBody', () => {
    const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.07, 0.005), new THREE.Vector2(0.095, 0.06), new THREE.Vector2(0.09, 0.13),
      new THREE.Vector2(0.05, 0.18), new THREE.Vector2(0.03, 0.2), new THREE.Vector2(0.03, 0.25), new THREE.Vector2(0.04, 0.26)];
    return new THREE.LatheGeometry(pts, 8);
  });
  const b = new THREE.Mesh(body, mat('#b0603a')); b.castShadow = true; g.add(b);
  part(g, cylGeo(1, 8), mat('#d9c7a0'), 0.096, 0.025, 0.096, 0, 0.07, 0, 0, 0, 0, false); // ивица
  part(g, cylGeo(1, 8), glow('#7dff6a'), 0.028, 0.012, 0.028, 0, 0.245, 0, 0, 0, 0, false); // течността в гърлото
  const h = haloSprite('#6aff6a', 0.45, 0.6); h.position.y = 0.26; g.add(h);
  // капка, стекла се по шишето
  part(g, sphGeo(0), glow('#9dff8a'), 0.012, 0.02, 0.012, 0.035, 0.2, 0.02, 0, 0, 0, false);
  return g;
}

export function buildFeather(): THREE.Group {
  const g = new THREE.Group();
  const geo = cachedGeo('feather', () => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.quadraticCurveTo(0.05, 0.12, 0.012, 0.3); sh.quadraticCurveTo(-0.04, 0.12, 0, 0);
    const gg = new THREE.ShapeGeometry(sh, 4); gg.rotateX(-Math.PI / 2 + 0.08); return gg;
  });
  const f = new THREE.Mesh(geo, mat('#f2ece0', { side: THREE.DoubleSide })); f.position.y = 0.01; g.add(f);
  const tip = new THREE.Mesh(geo, mat('#8a5a3a', { side: THREE.DoubleSide })); tip.scale.set(0.6, 1, 0.35); tip.position.set(0.004, 0.012, -0.19); g.add(tip);
  part(g, cylGeo(1, 3), mat('#d9cfb8'), 0.003, 0.33, 0.003, 0, 0.012, 0.03, -Math.PI / 2 + 0.06, 0, 0, false);
  g.rotation.y = 0.7;
  return g;
}

export function buildEgg(): THREE.Group {
  const g = new THREE.Group();
  const geo = cachedGeo('egg', () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push(new THREE.Vector2(Math.sin(a) * 0.03 * (1 - 0.18 * Math.cos(a)), 0.04 - Math.cos(a) * 0.04)); }
    return new THREE.LatheGeometry(pts, 8);
  });
  const e = new THREE.Mesh(geo, mat('#f2e6d0', { flat: false })); e.castShadow = true; g.add(e);
  return g;
}
