// Автоматично качество: ако кадрите са малко дълго време, светът минава на по-леко качество (по една стъпка надолу).
// (ИИ на същата видеокарта временно сваля кадрите — затова праговете са ниски и се чака няколко секунди.)
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
    const q = g.settings.graphics.quality;
    // „Високо“ е за ≥ 60 кадъра: под ~34 за 8 s → „Средно“; от „Средно“ надолу — под ~28 за 6 s
    const limit = q === 'high' ? 34 : 28, hold = q === 'high' ? 8 : 6;
    this.low = fps < limit ? this.low + dt : Math.max(0, this.low - dt * 0.5);
    if (this.low < hold) return;
    this.low = 0;
    this.cooldown = 25;
    const i = ORDER.indexOf(q);
    if (i < 0 || i >= ORDER.length - 1) return;
    const next = ORDER[i + 1];
    g.applySettings({ ...g.settings, graphics: { ...g.settings.graphics, quality: next } });
    g.toast(`Играта върви бавно — качеството на графиката е намалено (${next === 'medium' ? 'средно' : 'ниско'}). Сменя се от Esc → Графика.`, 'info');
  }
}
