// Сцени на галерията: примерни данни за раница, карта, летопис, машина на времето и т.н.
import type { Ui } from '../ui';
import type { ChronicleType, ChronicleEntry, Branch, SnapshotMeta } from '../sim/types';
import type { IconKey } from '../data/icons';
import type { ItemView, InventoryData } from '../ui/InventoryView';
import { DEFAULT_UI_SETTINGS, type SettingsTab } from '../ui/SettingsView';
import { hudData, iconBoard } from './ui-mock';

const T = (day: number, hh: number, mm = 0) => (day - 1) * 1440 + hh * 60 + mm;

const LINES: [ChronicleType, string[], string, number, boolean?][] = [
  ['talk', ['gena', 'kalin'], 'Баба Гена и Калин си говориха за билките край гората.', 3],
  ['quarrel', ['petko', 'ivan'], 'Петко и Иван се скараха на мегдана заради козите в нивата.', 7],
  ['rumor', ['radka', 'maria'], 'Радка прошепна на Мария, че кокошките ги краде някой от селото.', 5],
  ['love', ['ivan', 'maria'], 'Иван подари на Мария железен пръстен, изкован нощем.', 8, true],
  ['work', ['kalin'], 'Калин цял ден дяла в дърводелницата. Никой не разбра какво прави.', 2],
  ['player', ['player', 'gena'], 'Странникът донесе три стръка росен на баба Гена.', 8],
  ['theft', ['radka'], 'Пак изчезна кокошка от кокошарника на Радка.', 6],
  ['weather', [], 'Над селото мина буря. Чешмата едва капе.', 4],
  ['reflection', ['peyu'], 'Дядо Пею цяла вечер мисли за реката и за изборите.', 4, true],
  ['monster', ['player'], 'Таласъм излезе от Тъмната гора по здрач и нападна странника.', 7],
  ['election', ['peyu', 'radka'], 'Селото избра кмет: дядо Пею остава с 4 гласа срещу 3 за Радка.', 9],
  ['festival', ['gena', 'peyu', 'ivan', 'maria', 'radka', 'kalin', 'petko'], 'Сбор на мегдана: хоро около огъня до късно.', 9],
  ['quest', ['player', 'peyu'], 'Кметът помоли странника да разбере кой краде кокошките.', 6],
  ['mood', ['petko'], 'Петко е сърдит на целия свят и не излиза от кошарата.', 3],
  ['live', [], 'Зрителят Мечо извика буря над селото!', 6],
];

export function chronicleEntries(): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  let id = 1;
  for (let d = 1; d <= 4; d++) {
    for (let k = 0; k < 9; k++) {
      const [type, participants, text, importance, ai] = LINES[(d * 7 + k * 3) % LINES.length];
      out.push({ id: id++, time: T(d, 6 + Math.floor(k * 1.7), (k * 17) % 60), type, participants, text, importance, ai, branchId: 'main' });
    }
  }
  for (let k = 0; k < 10; k++) {
    const [type, participants, text, importance, ai] = LINES[(k * 5 + 2) % LINES.length];
    out.push({ id: id++, time: T(2, 15) + k * 190, type, participants, text: `(Друг път) ${text}`, importance, ai, branchId: 'b2' });
  }
  for (let k = 0; k < 5; k++) {
    const [type, participants, text, importance] = LINES[(k * 4 + 1) % LINES.length];
    out.push({ id: id++, time: T(3, 11) + k * 160, type, participants, text: `(Трети път) ${text}`, importance, branchId: 'b3' });
  }
  return out;
}

export function branches(entries: ChronicleEntry[]): Branch[] {
  const lastBefore = (b: string, t: number) => entries.filter((e) => e.branchId === b && e.time <= t).pop()?.id ?? 0;
  return [
    { id: 'main', parentId: null, forkTime: 0, forkEntryId: 0, createdAt: 1, label: 'Основна история' },
    { id: 'b2', parentId: 'main', forkTime: T(2, 14), forkEntryId: lastBefore('main', T(2, 14)), createdAt: 2, label: 'Клон 2 (от Ден 2 · 14:00)' },
    { id: 'b3', parentId: 'b2', forkTime: T(3, 10), forkEntryId: lastBefore('b2', T(3, 10)), createdAt: 3, label: 'Клон 3 (от Ден 3 · 10:00)' },
  ];
}

export function snapshots(): SnapshotMeta[] {
  const out: SnapshotMeta[] = [];
  for (let d = 1; d <= 4; d++) out.push({ id: `d${d}`, branchId: 'main', time: T(d, 0), kind: 'day', label: `Ден ${d} · 00:00`, realTime: 0 });
  for (let hh = 6; hh < 22; hh += 3) out.push({ id: `h${hh}`, branchId: 'main', time: T(4, hh), kind: 'hour', label: `Ден 4 · ${hh}:00`, realTime: 0 });
  out.push({ id: 'm1', branchId: 'b2', time: T(2, 20), kind: 'manual', label: 'Ден 2 · 20:00', realTime: 0 });
  return out;
}

const item = (id: string, name: string, ic: IconKey, kind: string, desc: string, count = 1, extra: Partial<ItemView> = {}): ItemView => ({ id, name, icon: ic, count, desc, kind, ...extra });

export function inventory(): InventoryData {
  const slots: (ItemView | null)[] = Array(24).fill(null);
  slots[0] = item('potion', 'Отвара на баба Гена', 'potion', 'potion', 'Червена отвара от росен и мед. Връща 40 живот.', 3, { stats: [{ label: 'Живот', value: '+40' }] });
  slots[1] = item('banitsa', 'Баница', 'banitsa', 'food', 'Топла баница от хана на Радка.', 2, { stats: [{ label: 'Живот', value: '+15' }, { label: 'Сила', value: '+20' }] });
  slots[2] = item('rosen', 'Росен', 'rosen', 'quest', 'Рядка билка от Тъмната гора. Баба Гена иска три стръка.', 2);
  slots[3] = item('bow', 'Лъкът на Калин', 'bow', 'weapon', 'Тайно направен лък от явор. Стреля далеч.', 1, { equip: 'weapon', rarity: 'rare', stats: [{ label: 'Щета', value: '9' }, { label: 'Обхват', value: '30 м' }] });
  slots[4] = item('kalpak', 'Калпак', 'kalpak', 'armor', 'Агнешки калпак — топъл и горд.', 1, { equip: 'head', stats: [{ label: 'Броня', value: '+2' }] });
  slots[6] = item('fox', 'Лисича опашка', 'fox_tail', 'material', 'Опашка на лисицата-таласъм. Доказателство!', 1);
  slots[7] = item('coin', 'Жълтици', 'coin', 'misc', 'Звънтят в кесията.', 37);
  slots[9] = item('letter', 'Писмо', 'letter', 'quest', 'Писмо от Мария до странник от друг край. Запечатано.', 1);
  slots[12] = item('tea', 'Чай от мащерка', 'tea', 'food', 'Ободрява. Връща сила.', 1);
  slots[13] = item('scale', 'Люспа от Ламята', 'lamia_scale', 'material', 'Твърда като камък и зелена като вир.', 1, { rarity: 'legend' });
  return {
    slots,
    equipment: {
      weapon: item('saber', 'Сабя', 'saber', 'weapon', 'Стара, но вярна сабя.', 1, { equip: 'weapon', stats: [{ label: 'Щета', value: '12' }] }),
      head: null,
      body: item('cloak', 'Наметало', 'cloak', 'armor', 'Кафяво вълнено наметало с качулка.', 1, { equip: 'body', stats: [{ label: 'Броня', value: '+4' }] }),
      hands: null,
      feet: item('tsarvuli', 'Цървули', 'tsarvuli', 'armor', 'Кожени цървули — леки и тихи.', 1, { equip: 'feet', stats: [{ label: 'Броня', value: '+1' }] }),
      amulet: item('mart', 'Мартеница', 'martenitsa', 'amulet', 'Бяло и червено — пази от уроки.', 1, { equip: 'amulet', rarity: 'rare', stats: [{ label: 'Късмет', value: '+5%' }] }),
    },
    hotbar: [item('saber', 'Сабя', 'saber', 'weapon', ''), slots[0], slots[1], slots[12], null, slots[2]],
    stats: { level: 7, title: 'Странник', xp: 340, xpMax: 600, hp: 72, hpMax: 120, stamina: 64, staminaMax: 100, damage: 12, armor: 5, gold: 37 },
  };
}

export function explored(): number[] {
  const g: number[] = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const wx = (x / 64) * 600 - 300, wz = (y / 64) * 600 - 300;
    const near = (px: number, pz: number, r: number) => (wx - px) ** 2 + (wz - pz) ** 2 < r * r;
    g.push(near(0, 50, 110) || near(-120, -30, 70) || near(60, -40, 50) || near(0, 160, 40) ? 1 : 0);
  }
  return g;
}

export function showExtra(ui: Ui, key: string, sceneBg: (k: 'day' | 'dusk' | 'night') => string, scene: HTMLElement, keep: (el: HTMLElement) => void, base: HTMLCanvasElement): void {
  const showHud = () => { ui.hud.show(); ui.hud.update(hudData()); ui.hud.minimap(4, 46, 0.6, [{ x: -150, z: -60, kind: 'quest' }], [{ x: -10, z: 30 }, { x: 20, z: 50 }]); };
  const entries = chronicleEntries();
  switch (key) {
    case 'icons': { const el = iconBoard(); ui.root.append(el); keep(el); break; }
    case 'inventory': showHud(); ui.inventory.open(inventory()); break;
    case 'map': showHud(); ui.map.open({ base, explored: explored(), player: { x: 6, z: 50, yaw: 2.4 }, markers: [{ x: -150, z: -60, kind: 'quest' }, { x: 150, z: -168, kind: 'boss' }], dots: [{ x: -40, z: 20 }, { x: 25, z: 45 }, { x: -30, z: 60 }] }); break;
    case 'chronicle': showHud(); ui.chronicle.open({ entries: entries.filter((e) => e.branchId === 'main') }); break;
    case 'chronicle-empty': showHud(); ui.chronicle.open({ entries: [] }); break;
    case 'time': {
      showHud();
      ui.time.open({ entries, branches: branches(entries), snapshots: snapshots(), currentBranch: 'b2', now: T(4, 9) });
      if (location.hash.includes('play')) ui.time.setPlayhead(T(3, 7, 30));
      ui.time.onWatch = (t, sp) => {
        let x = t;
        const iv = setInterval(() => { x += sp * 2; ui.time.setPlayhead(x); }, 50);
        ui.time.onStopWatch = () => { clearInterval(iv); ui.time.setPlayhead(null); };
      };
      ui.time.onLoadFrom = (t, b) => ui.hud.toast(`Зареждане от ${t} (${b}) — нов клон`, 'info');
      break;
    }
    case 'away':
      scene.style.background = sceneBg('dusk');
      ui.away.show([
        { title: 'Кавга на мегдана', text: 'Петко и Иван се скараха заради козите в нивата. Дядо Пею едва ги разтърва.', time: T(3, 14, 20), type: 'quarrel', participants: ['petko', 'ivan', 'peyu'] },
        { title: 'Железен пръстен', text: 'Иван подари на Мария пръстен, изкован нощем. Тя се изчерви до уши.', time: T(3, 19, 5), type: 'love', participants: ['ivan', 'maria'], ai: true },
        { title: 'Пак изчезна кокошка', text: 'Радка намери пера пред кокошарника. Казва, че знае кой е виновникът.', time: T(4, 5, 40), type: 'theft', participants: ['radka'] },
        { title: 'Избори за кмет', text: 'Дядо Пею остава кмет с 4 гласа срещу 3 за Радка. Радка не е доволна.', time: T(4, 12), type: 'election', participants: ['peyu', 'radka'] },
        { title: 'Таласъм край гората', text: 'По здрач Калин видя таласъм между боровете и избяга до селото.', time: T(4, 20, 10), type: 'monster', participants: ['kalin'] },
        { title: 'Слух за странника', text: 'Говори се, че странникът е виждал Ламята отблизо и е останал жив.', time: T(5, 8, 30), type: 'rumor', participants: ['radka', 'gena', 'player'], ai: true },
      ], () => ui.hud.toast('Добре дошъл обратно!', 'info'), 'Минаха 1 ден и 18 часа в Самодивско.');
      break;
    case 'settings': {
      showHud();
      const tab = (location.hash.match(/tab=(\w+)/)?.[1] as SettingsTab | undefined) ?? 'ai';
      ui.settings.open(DEFAULT_UI_SETTINGS, { inGame: true, browser: true, saveLabel: 'Последен запис: Ден 4 · 18:20', ai: { connected: false, label: 'ИИ: няма връзка — жителите говорят по сценарий', reason: 'Версията в браузъра не може да стигне до Ollama на компютъра ти.' } }, tab);
      ui.settings.onTestAi = () => { ui.settings.setStatus({ ai: { connected: false, label: '', testing: true } }); setTimeout(() => ui.settings.setStatus({ ai: { connected: true, label: 'ИИ: свързан (qwen3.5:4b)' } }), 1200); };
      break;
    }
    case 'live': {
      showHud();
      ui.live.setLive(true, 'balkanski_legendi');
      const opts = [{ cmd: '!буря', label: 'Буря над селото', count: 14 }, { cmd: '!караконджул', label: 'Караконджул', count: 21 }, { cmd: '!самодиви', label: 'Самодиви на хоро', count: 9 }, { cmd: '!сбор', label: 'Сбор на мегдана', count: 6 }, { cmd: '!кражба', label: 'Кражба', count: 3 }];
      ui.live.setVote({ options: opts, endsAt: Date.now() + 18000, duration: 30000 });
      for (const [u, t] of [['мечо', '!караконджул'], ['гергана_77', '!буря'], ['ники', 'това село е супер'], ['стоянчо', '!караконджул'], ['bobi', '!самодиви'], ['радо', 'хаха баба Гена']]) ui.live.chat(u, t);
      ui.live.result('Чатът реши: Караконджул!', 600000);
      break;
    }
    case 'death': ui.death.show('Ламята те повали. Радка те намери пред хана и те завлече вътре.'); break;
    case 'banner': showHud(); ui.banner.show('Ламята е победена!', 'Бистрица тече отново! Селото се готви за сбор.', 600000); break;
    case 'loading': ui.loading.show('Селото се събужда…', 0.62); break;
    case 'confirm': showHud(); void ui.confirm.ask({ title: 'Към началото?', text: 'Играта е запазена. Ще се върнеш на началния екран.', ok: 'Към началото' }); break;
    case 'pause': showHud(); ui.pause.show(); ui.hud.setPaused(true); break;
  }
}
