// Старт на „Балкански легенди“: зарежда света, селото и интерфейса, после показва началния екран.
import { Game } from './game/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const loading = document.getElementById('loading');
const fill = document.getElementById('load-fill') as HTMLElement | null;
const sub = loading?.querySelector('.load-sub') as HTMLElement | null;

function progress(p: number, text?: string): void {
  if (fill) fill.style.width = `${Math.round(Math.max(0.03, Math.min(1, p)) * 100)}%`;
  if (text && sub) sub.textContent = text;
}

Game.create(canvas, uiRoot, progress)
  .then((game) => {
    (window as unknown as { game: Game; __ready: boolean }).game = game;
    (window as unknown as { __ready: boolean }).__ready = true;
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 700);
  })
  .catch((err) => {
    console.error(err);
    const box = loading?.querySelector('.load-box');
    if (box) {
      const e = document.createElement('div');
      e.className = 'load-err';
      e.textContent = 'Играта не успя да тръгне. Опитай с друг браузър (Chrome/Edge) или обнови страницата. Грешка: ' + (err?.message ?? err);
      box.appendChild(e);
    }
  });
