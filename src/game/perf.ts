// Автоматично качество: ако кадрите са малко дълго време, светът минава на по-леко качество (веднъж надолу на стъпка).
import type { Game } from './Game';

const ORDER = ['high', 'medium', 'low'] as const;

export class AutoQuality {
  private low = 0;
  private cooldown = 20;

  update(g: Game, dt: number): void {
    if (g.mode !== 'play' || g.modal !== null || document.hidden) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const fps = g.engine.fps;
    this.low = fps < 28 ? this.low + dt : Math.max(0, this.low - dt * 0.5);
    if (this.low < 6) return;
    this.low = 0;
    this.cooldown = 25;
    const q = g.settings.graphics.quality;
    const i = ORDER.indexOf(q);
    if (i < 0 || i >= ORDER.length - 1) return;
    const next = ORDER[i + 1];
    g.applySettings({ ...g.settings, graphics: { ...g.settings.graphics, quality: next } });
    g.toast(`Играта върви бавно — качеството на графиката е намалено (${next === 'medium' ? 'средно' : 'ниско'}). Сменя се от Esc → Графика.`, 'info');
  }
}
