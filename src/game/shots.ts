// Сцени за снимките (робот test/shot.mjs): ?shot=<име>. Нагласява света и вдига window.__shotReady.
import type { Game } from './Game';
import { PLACES } from '../data/layout';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setTime(g: Game, hour: number, minute = 0): void {
  const day = Math.floor(g.sim.state.time / 1440);
  g.sim.state.time = day * 1440 + hour * 60 + minute;
}
/** Селото поживява малко (за летопис, клюки, отношения). */
function fast(g: Game, min: number): void {
  let left = min;
  while (left > 0) { const s = Math.min(20, left); g.sim.advance(s); left -= s; }
}
/** Героят застава на (x,z) и гледа към (tx,tz). */
function standLook(g: Game, x: number, z: number, tx: number, tz: number): void {
  g.rpg.teleport(x, z, Math.atan2(tx - x, tz - z));
}

export async function runShot(g: Game, name: string): Promise<void> {
  const w = window as unknown as { __shotReady?: boolean; __shotError?: string; __info?: unknown };
  try {
    await wait(200);
    if (name === 'title') { setTime(g, 18, 50); await wait(3000); w.__shotReady = true; return; }
    await g.newGame(false);
    g.ui.banner.hide();
    g.ui.hud.setPaused(false);
    const sq = PLACES.square.pos;
    switch (name) {
      case 'village-day': fast(g, 200); setTime(g, 10, 20); fast(g, 30); standLook(g, 6, 82, 0, 40); break;
      case 'village-sunset': fast(g, 600); setTime(g, 19, 25); fast(g, 15); standLook(g, -24, 74, 6, 30); break;
      case 'village-night': fast(g, 800); setTime(g, 22, 40); fast(g, 10); standLook(g, 14, 62, -4, 30); break;
      case 'square-gossip': {
        fast(g, 600); setTime(g, 18, 10); fast(g, 40);
        standLook(g, sq.x + 9, sq.z + 13, sq.x, sq.z);
      } break;
      case 'dialogue': {
        setTime(g, 9, 0); fast(g, 90);
        const v = g.sim.villager('radka');
        g.villagers.update(0.016, g.sim.state, true);
        standLook(g, v.pos.x + 2.2, v.pos.z + 1.2, v.pos.x, v.pos.z);
        await wait(300);
        g.dialogue.open('radka');
        await wait(900);
        await g.dialogue.choose('news', 'Какво ново в селото?');
      } break;
      case 'forest': setTime(g, 19, 50); standLook(g, -104, -14, -150, -60); break;
      case 'talasam-fight': {
        setTime(g, 21, 30); standLook(g, -126, -26, -150, -60);
        await wait(300);
        g.rpg.debug.spawnTalasam(5); g.rpg.debug.spawnTalasam(8);
        await wait(1500);
        g.rpg.debug.attack();
      } break;
      case 'samodivi': setTime(g, 23, 20); standLook(g, PLACES.glade.pos.x + 6, PLACES.glade.pos.z + 26, PLACES.glade.pos.x + 6, PLACES.glade.pos.z + 10); break;
      case 'lamia-fight': {
        setTime(g, 15, 0);
        g.rpg.debug.give('ivan_saber', 1);
        g.rpg.debug.toLamia(20);
        await wait(2500);
      } break;
      case 'sabor': {
        g.sim.state.flags['lamia_dead'] = true;
        g.sim.state.flags['river_flowing'] = true;
        setTime(g, 18, 30);
        g.sim.inject({ type: 'sabor' });
        fast(g, 100);
        standLook(g, sq.x + 4, sq.z + 22, sq.x, sq.z);
      } break;
      case 'map': fast(g, 60); g.rpg.teleport(-120, -40); await wait(800); g.rpg.teleport(4, 80); await wait(300); g.openMap(); break;
      case 'inventory': g.rpg.debug.give('rosen', 3); g.rpg.debug.give('rosen_potion', 2); g.rpg.debug.give('martenitsa', 1); g.openInventory(); break;
      case 'chronicle': fast(g, 1440 * 2 + 300); g.openChronicle(); break;
      case 'time-machine': {
        for (let i = 0; i < 40; i++) { const prev = g.sim.state.time; fast(g, 60); for (const k of g.timeline.snapshotDue(prev, g.sim.state.time)) await g.makeSnapshot(k); }
        // един клон за красота
        const t = g.sim.state.time - 20 * 60;
        await g.timeMachine.loadFrom(t);
        for (let i = 0; i < 10; i++) { const prev = g.sim.state.time; fast(g, 60); for (const k of g.timeline.snapshotDue(prev, g.sim.state.time)) await g.makeSnapshot(k); }
        g.timeMachine.open();
      } break;
      case 'while-away': {
        const { catchUp } = await import('../sim/away');
        const cards = catchUp(g.sim, 1000 * 60 * 60 * 3);
        g.openAway(cards);
      } break;
      case 'live': setTime(g, 12, 0); standLook(g, 6, 82, 0, 40); g.startLive(); await wait(6000); break;
      default: break;
    }
    g.villagers.update(0.016, g.sim.state, true);
    await wait(2000);
    w.__info = { scene: name, time: g.sim.state.time };
    w.__shotReady = true;
  } catch (e) {
    console.error(e);
    w.__shotError = String(e);
    w.__shotReady = true;
  }
}
