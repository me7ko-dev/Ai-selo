// ВРЕМЕННО: минимален мозък по сценарий. Агентът „мозък“ ще го замени с истинския (богати шаблони на български).
// Подписите (класът ScriptedBrain implements Brain, SyncBrain) са договорът.
import { Rng } from '../../core/rng';
import type { Brain, BrainReply, BrainStatus, ChatReply, ChatRequest, PlanReply, PlanRequest, ReactRequest, ReflectReply, ReflectRequest, SyncBrain, TalkRequest } from './Brain';

export class ScriptedBrain implements Brain, SyncBrain {
  status(): BrainStatus { return { connected: false, model: '', label: 'ИИ: няма връзка — жителите говорят по сценарий', busy: false, queue: 0 }; }
  talkNow(req: TalkRequest): BrainReply {
    const r = new Rng(req.seed);
    return { say: r.pick(['Добре дошъл в Самодивско, странниче.', 'Хм, какво има?', 'Реката пресъхна, тежко ни е.']), ai: false };
  }
  chatNow(req: ChatRequest): ChatReply {
    return { lines: [{ who: req.a.id, text: 'Как си?' }, { who: req.b.id, text: 'Горе-долу.' }], summary: `${req.a.name} и ${req.b.name} си поговориха.`, ai: false };
  }
  reactNow(req: ReactRequest): BrainReply { return { say: 'Ох, какво стана!', ai: false }; }
  planNow(req: PlanRequest): PlanReply { return { plan: 'Ще си гледам работата.', ai: false }; }
  reflectNow(req: ReflectRequest): ReflectReply { return { beliefs: req.beliefs.slice(0, 5), ai: false }; }
  async talk(req: TalkRequest) { return this.talkNow(req); }
  async chat(req: ChatRequest) { return this.chatNow(req); }
  async react(req: ReactRequest) { return this.reactNow(req); }
  async plan(req: PlanRequest) { return this.planNow(req); }
  async reflect(req: ReflectRequest) { return this.reflectNow(req); }
}
