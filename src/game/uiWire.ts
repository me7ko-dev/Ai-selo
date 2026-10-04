// Връзва бутоните и прозорците на интерфейса към играта.
import type { Game } from './Game';
import type { Settings } from '../save/settings';

export function wireUi(g: Game): void {
  const ui = g.ui;
  // начален екран
  ui.start.onNew = () => { g.audio.unlock(); void g.newGame(false); };
  ui.start.onContinue = () => { g.audio.unlock(); void g.continueGame(false); };
  ui.start.onLive = () => {
    g.audio.unlock();
    void g.save.hasSave().then((has) => (has ? g.continueGame(true) : g.newGame(true)));
  };
  ui.start.onSettings = () => { ui.settings.open(g.settings, g.settingsStatus(), 'ai'); };

  // диалог
  ui.dialogue.onOption = (id) => {
    const text = g.dialogue.optionText(id);
    void g.dialogue.choose(id, text);
  };
  ui.dialogue.onFreeText = (text) => { void g.dialogue.free(text); };
  ui.dialogue.onClose = () => g.onModalClosed('dialogue');

  // раница
  ui.inventory.onUse = (i) => { g.rpg.useSlot(i); g.refreshInventory(); };
  ui.inventory.onEquip = (i) => { g.rpg.equipFromSlot(i); g.refreshInventory(); g.sfx('click'); };
  ui.inventory.onUnequip = (slot) => { g.rpg.unequip(slot); g.refreshInventory(); g.sfx('click'); };
  ui.inventory.onMove = (a, b) => { g.rpg.moveSlot(a, b); g.refreshInventory(); };
  ui.inventory.onAssignHotbar = (i, hot) => { g.rpg.assignHotbar(i, hot); g.refreshInventory(); };
  ui.inventory.onClose = () => g.onModalClosed('inventory');

  ui.map.onClose = () => g.onModalClosed('map');
  ui.chronicle.onClose = () => g.onModalClosed('chronicle');

  // машина на времето
  ui.time.onClose = () => g.onModalClosed('time');
  ui.time.onWatch = (time, speed) => { void g.timeMachine.watch(time, speed); };
  ui.time.onStopWatch = () => g.timeMachine.stopWatching();
  ui.time.onLoadFrom = (time) => { void g.timeMachine.loadFrom(time); };
  ui.time.onSaveNow = () => { void g.timeMachine.saveNow(); };
  ui.time.onSwitchBranch = (id) => { void g.timeMachine.switchBranch(id); };

  // настройки / меню
  ui.settings.onClose = () => { if (g.mode === 'play') g.onModalClosed('settings'); };
  ui.settings.onChange = (s) => g.applySettings(s as Settings);
  ui.settings.onSave = () => { void g.saveMain().then(() => g.makeSnapshot('manual')).then((m) => g.toast(`Записано (${m.label}).`, 'info')); };
  ui.settings.onExport = () => { void g.saveMain().then(() => g.save.downloadExport()); };
  ui.settings.onImport = (file) => {
    void g.save.importFile(file)
      .then(() => { g.toast('Записът е зареден от файла.', 'info'); ui.settings.hide(); g.modal = null; return g.continueGame(false); })
      .catch((e: Error) => g.toast(e.message || 'Файлът не е запис на играта.', 'warn'));
  };
  ui.settings.onMainMenu = () => {
    void g.saveMain().then(async () => {
      ui.settings.hide(); g.stopLive(); ui.closeAll(); g.modal = null;
      g.engine.input.enabled = true;
      g.showMenu(await g.save.hasSave());
    });
  };
  ui.settings.onTestAi = () => {
    ui.settings.setStatus({ ai: { connected: false, label: 'Проверявам…', testing: true } });
    void g.brainKit.connect().then(() => ui.settings.setStatus(g.settingsStatus()));
  };
  ui.settings.onLiveStart = () => { g.startLive(); ui.settings.setStatus(g.settingsStatus()); };
  ui.settings.onLiveStop = () => { g.stopLive(); ui.settings.setStatus(g.settingsStatus()); };
  ui.settings.onLiveDemo = () => { if (!g.liveOn) g.startLive(); g.vote.startDemo((m) => ui.live.chat(m.user, m.text)); ui.settings.setStatus(g.settingsStatus()); };

  // смърт
  ui.death.onRespawn = () => g.rpg.respawn();
}
