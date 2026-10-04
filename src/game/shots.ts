// Сцени за снимките (робот с Playwright): ?shot=<име>. Нагласява света и казва „готово“ чрез window.__shotReady.
import type { Game } from './Game';
import { PLACES } from '../data/layout';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setTime(g: Game, hour: number, minute = 0): void {
  const day = Math.floor(g.sim.state.time / 1440);
  g.sim.state.time = day * 1440 + hour * 60 + minute;
}

export async function runShot(g: Game, name: string): Promise<void> {
  const w = window as unknown as { __shotReady?: boolean; __shotError?: string };
  try {
    await wait(300);
    if (name === 'start') { setTime(g, 18, 40); await wait(2500); w.__shotReady = true; return; }
    await g.newGame(false);
    g.ui.banner.hide?.();
    // ускорено: селото поживява малко, за да има летопис
    const fast = (min: number) => { let left = min; while (left > 0) { const s = Math.min(20, left); g.sim.advance(s); left -= s; } };
    switch (name) {
      case 'village-day': fast(240); setTime(g, 10, 30); g.rpg.teleport(4, 76, Math.PI); break;
      case 'village-dusk': fast(240); setTime(g, 19, 40); g.rpg.teleport(-6, 70, Math.PI * 0.9); break;
      case 'dialogue': fast(120); setTime(g, 9, 30); {
        const p = g.sim.villager('gena').pos; g.rpg.teleport(p.x + 1.5, p.z + 1.5, Math.atan2(-1.5, -1.5));
        g.villagers.update(0.016, g.sim.state, true); g.dialogue.open('gena');
        await wait(600); await g.dialogue.choose('news', 'Какво ново в селото?');
      } break;
      case 'inventory': g.openInventory(); break;
      case 'map': g.openMap(); break;
      case 'chronicle': fast(1440 * 2); g.openChronicle(); break;
      case 'time': {
        for (let i = 0; i < 2 * 24; i++) { const prev = g.sim.state.time; fast(60); for (const k of g.timeline.snapshotDue(prev, g.sim.state.time)) await g.makeSnapshot(k); }
        g.timeMachine.open();
      } break;
      case 'away': {
        const { catchUp } = await import('../sim/away');
        const cards = catchUp(g.sim, 1000 * 60 * 60 * 3);
        g.openAway(cards);
      } break;
      case 'forest-night': setTime(g, 22, 10); g.rpg.teleport(-118, -30, -Math.PI * 0.75); break;
      case 'glade-night': setTime(g, 23, 30); g.rpg.teleport(PLACES.glade.pos.x + 10, PLACES.glade.pos.z + 28, Math.PI); break;
      case 'lamia': setTime(g, 14, 0); g.rpg.teleport(PLACES.lamia_plateau.pos.x - 14, PLACES.lamia_plateau.pos.z + 14, Math.PI * 0.75); break;
      case 'festival': {
        g.sim.state.flags['lamia_dead'] = true; g.sim.state.flags['river_flowing'] = true;
        g.sim.inject({ type: 'sabor' });
        setTime(g, 20, 10); fast(30); g.rpg.teleport(0, 66, Math.PI);
      } break;
      case 'river': g.sim.state.flags['river_flowing'] = true; setTime(g, 16, 0); g.rpg.teleport(80, 60, Math.PI * 0.8); break;
      case 'live': g.startLive(); setTime(g, 12, 0); g.rpg.teleport(4, 76, Math.PI); await wait(4000); break;
      default: break;
    }
    g.villagers.update(0.016, g.sim.state, true);
    await wait(2500);
    w.__shotReady = true;
  } catch (e) {
    console.error(e);
    w.__shotError = String(e);
    w.__shotReady = true;
  }
}
