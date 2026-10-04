// Разговор с жител: готови отговори (задачи + селото) и свободен текст към ИИ/сценария.
import type { Game } from './Game';
import { VILLAGERS, type VillagerId } from '../data/villagers';
import type { DialogueOption, DialogueReply } from '../sim/types';

export class DialogueController {
  active: VillagerId | null = null;
  private busy = false;
  private gen = 0;
  private lastSimOptions: DialogueOption[] = [];

  constructor(private g: Game) {}

  open(id: VillagerId): void {
    const g = this.g;
    this.active = id;
    this.gen++;
    g.openModal('dialogue');
    const v = g.sim.villager(id);
    const prof = VILLAGERS[id];
    g.ui.dialogue.open({ id, name: prof.name, job: prof.job, mood: v.mood });
    g.rpg.onTalk(id);
    const reply = g.sim.beginTalk(id);
    this.show(reply);
    g.sfx('bubble');
  }

  private options(simOpts: DialogueOption[]): DialogueOption[] {
    if (!this.active) return [];
    this.lastSimOptions = simOpts;
    const quest = this.g.rpg.questOptions(this.active);
    const seen = new Set<string>();
    const out: DialogueOption[] = [];
    for (const o of [...quest, ...simOpts]) { if (!seen.has(o.id)) { seen.add(o.id); out.push(o); } }
    // най-много 4: задачите първо, после селото (винаги остави „Сбогом“, ако го има)
    if (out.length > 4) {
      const bye = out.find((o) => o.id === 'bye');
      const trimmed = out.filter((o) => o.id !== 'bye').slice(0, bye ? 3 : 4);
      if (bye) trimmed.push(bye);
      return trimmed;
    }
    return out;
  }

  private show(reply: DialogueReply): void {
    const g = this.g;
    if (!this.active) return;
    g.ui.dialogue.setThinking(false);
    g.ui.dialogue.say(reply.say, { ai: reply.ai, mood: reply.mood });
    g.ui.dialogue.setOptions(this.options(reply.options));
    if (reply.end) setTimeout(() => { if (this.active && g.modal === 'dialogue') g.closeModal(); }, 2200);
  }

  async choose(optionId: string, text: string): Promise<void> {
    const g = this.g;
    const id = this.active;
    if (!id || this.busy) return;
    if (optionId.startsWith('q:')) {
      const r = g.rpg.questChoose(id, optionId);
      if (r) {
        g.ui.dialogue.say(r.say, { ai: false });
        g.ui.dialogue.setOptions(r.options ?? this.options(this.lastSimOptions));
        g.refreshInventory();
        if (r.end) setTimeout(() => { if (this.active === id && g.modal === 'dialogue') g.closeModal(); }, 2400);
        return;
      }
    }
    if (optionId === 'bye') {
      // сбогуване — жителят отговаря и разговорът свършва
    }
    await this.ask(id, { optionId, text });
  }

  async free(text: string): Promise<void> {
    const id = this.active;
    if (!id || this.busy || !text.trim()) return;
    await this.ask(id, { text: text.trim() });
  }

  private async ask(id: VillagerId, input: { optionId?: string; text: string }): Promise<void> {
    const g = this.g;
    const gen = this.gen;
    this.busy = true;
    g.ui.dialogue.setThinking(true);
    try {
      const reply = await g.sim.playerSay(id, input);
      if (gen !== this.gen || this.active !== id) return;
      this.show(reply);
    } catch (e) {
      console.warn(e);
      if (gen === this.gen) g.ui.dialogue.setThinking(false);
    } finally {
      this.busy = false;
    }
  }

  close(): void {
    const g = this.g;
    if (!this.active) return;
    g.sim.endTalk(this.active);
    this.active = null;
    this.gen++;
    this.busy = false;
    g.ui.dialogue.close();
  }
}
