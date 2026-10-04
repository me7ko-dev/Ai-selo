// QuestHost — връзката на задачите/RPG със селото, света, звука и интерфейса.
import type { QuestHost } from '../rpg/host';
import type { Game } from './Game';
import { VILLAGERS, type VillagerId } from '../data/villagers';

export function createHost(g: Game): QuestHost {
  return {
    notify: (text, kind) => g.toast(text, kind ?? 'info'),
    clue: (v, topic) => g.sim.clueFor(v, topic),
    deed: (d) => g.sim.recordDeed(d),
    chronicle: (text, participants, importance, type) => { g.sim.addChronicle(type ?? 'quest', text, participants, importance); },
    relation: (a, b, da, dt) => g.sim.adjustRelation(a, b, da, dt),
    getFlag: (k) => g.sim.state.flags[k],
    setFlag: (k, v) => { g.sim.state.flags[k] = v; },
    time: () => g.sim.state.time,
    riverFlow: (on) => { g.sim.state.flags['river_flowing'] = on; g.world.setRiverFlowing(on, true); },
    festival: (on) => { g.world.setFestival(on); },
    inject: (ev) => g.sim.inject(ev),
    villagerName: (id: VillagerId) => VILLAGERS[id]?.name ?? id,
    sfx: (name) => g.sfx(name),
    villagerPos: (id: VillagerId) => { const p = g.sim.villager(id).pos; return { x: p.x, z: p.z }; },
    waitUntil: (minute: number) => g.skipTo(minute),
  };
}
