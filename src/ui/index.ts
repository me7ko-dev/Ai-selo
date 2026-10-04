// Интерфейсът на играта: „тъпи“ изгледи — данни влизат, обратни извиквания излизат. Без игрова логика.
import '@fontsource/philosopher/cyrillic-400.css';
import '@fontsource/philosopher/cyrillic-700.css';
import '@fontsource/philosopher/cyrillic-400-italic.css';
import '@fontsource/philosopher/latin-400.css';
import '@fontsource/philosopher/latin-700.css';
import '@fontsource/philosopher/latin-400-italic.css';
import '@fontsource/ruslan-display/cyrillic-400.css';
import '@fontsource/ruslan-display/latin-400.css';
import './css/base.css';

import { ornamentVars } from './ornament';
import { StartScreen } from './StartScreen';
import { Hud } from './Hud';
import { NameTags } from './NameTags';
import { DialogueView } from './DialogueView';

export * from './StartScreen';
export * from './Hud';
export * from './NameTags';
export * from './DialogueView';
export { icon, portrait, typeIcon, sparkle, personName, TYPE_COLORS, TYPE_LABELS, ICON_KEYS } from './icons';

export interface Ui {
  root: HTMLElement;
  start: StartScreen;
  hud: Hud;
  tags: NameTags;
  dialogue: DialogueView;
}

/** Закача целия интерфейс в root (играта подава document.getElementById('ui')). */
export function mountUi(root: HTMLElement): Ui {
  root.classList.add('bl-ui');
  for (const [k, v] of Object.entries(ornamentVars())) root.style.setProperty(k, v);
  // ред на слоевете: етикети → HUD → прозорци → екрани най-отгоре
  const tags = new NameTags(root);
  const hud = new Hud(root);
  const dialogue = new DialogueView(root);
  const start = new StartScreen(root);
  return { root, start, hud, tags, dialogue };
}
