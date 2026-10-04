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
import { InventoryView } from './InventoryView';
import { MapView } from './MapView';
import { ChronicleView } from './ChronicleView';
import { TimeMachineView } from './TimeMachineView';
import { AwayView } from './AwayView';
import { SettingsView } from './SettingsView';
import { LiveOverlay } from './LiveOverlay';
import { DeathScreen, Banner, LoadingScreen, ConfirmDialog, PauseHint } from './Misc';
import { IntroView } from './IntroView';
import { HintView } from './HintView';

export * from './StartScreen';
export * from './Hud';
export * from './NameTags';
export * from './DialogueView';
export * from './InventoryView';
export * from './MapView';
export * from './ChronicleView';
export * from './TimeMachineView';
export * from './AwayView';
export * from './SettingsView';
export * from './LiveOverlay';
export * from './Misc';
export * from './IntroView';
export * from './HintView';
export { icon, portrait, typeIcon, sparkle, personName, TYPE_COLORS, TYPE_LABELS, ICON_KEYS } from './icons';

export interface Ui {
  root: HTMLElement;
  tags: NameTags;
  hud: Hud;
  live: LiveOverlay;
  banner: Banner;
  pause: PauseHint;
  dialogue: DialogueView;
  inventory: InventoryView;
  map: MapView;
  chronicle: ChronicleView;
  time: TimeMachineView;
  settings: SettingsView;
  away: AwayView;
  death: DeathScreen;
  start: StartScreen;
  confirm: ConfirmDialog;
  loading: LoadingScreen;
  /** Въведението при „Нова игра“ (3 страници). */
  intro: IntroView;
  /** Подсказките за обучението (над бързата лента). */
  hint: HintView;
  /** Отворен ли е прозорец, който иска мишката (диалог, раница, карта, летопис, машина, меню, „Докато те нямаше“, смърт, начало, потвърждение, въведение). */
  anyModalOpen(): boolean;
  /** Затваря всички прозорци (без onClose). */
  closeAll(): void;
}

/** Закача целия интерфейс в root (играта подава document.getElementById('ui')). */
export function mountUi(root: HTMLElement): Ui {
  root.classList.add('bl-ui');
  for (const [k, v] of Object.entries(ornamentVars())) root.style.setProperty(k, v);
  // ред на слоевете (по-късно = по-отгоре): етикети → HUD → лайв → съобщения → прозорци → екрани
  const tags = new NameTags(root);
  const hud = new Hud(root);
  const live = new LiveOverlay(root);
  const banner = new Banner(root);
  const pause = new PauseHint(root);
  const dialogue = new DialogueView(root);
  const inventory = new InventoryView(root);
  const map = new MapView(root);
  const chronicle = new ChronicleView(root);
  const time = new TimeMachineView(root);
  const settings = new SettingsView(root);
  const away = new AwayView(root);
  const death = new DeathScreen(root);
  const start = new StartScreen(root);
  const confirm = new ConfirmDialog(root);
  const intro = new IntroView(root);
  const loading = new LoadingScreen(root);
  const hint = new HintView(hud.bottomEl);
  // етикетите над главите не покриват панелите на HUD и прозореца с разговора
  tags.setAvoid(() => [...hud.cornerEls(), dialogue.el]);
  const modals = [dialogue, inventory, map, chronicle, time, settings, away, death, start, confirm, intro];
  return {
    root, tags, hud, live, banner, pause, dialogue, inventory, map, chronicle, time, settings, away, death, start, confirm, loading, intro, hint,
    anyModalOpen: () => modals.some((m) => m.isOpen),
    closeAll: () => { for (const m of [dialogue, inventory, map, chronicle, time, settings]) m.hide(); },
  };
}
