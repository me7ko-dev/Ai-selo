// Задачите (мисиите) — машина на състоянията. Чиста логика, без three.js (тества се в Node).
// Разговорите минават през жителите: Rpg.questOptions / questChoose ги препращат тук.
import type { VillagerId } from '../data/villagers';
import type { PlaceId } from '../data/layout';
import type { DialogueOption } from '../sim/types';
import type { QuestHost } from './host';
import type { Inventory } from './inventory';
import type { ItemId } from './items';

export type QuestId = 'rosen' | 'chickens' | 'lamia' | 'iron';
export const QUEST_IDS: QuestId[] = ['rosen', 'lamia', 'chickens', 'iron'];

export const QUEST_TITLES: Record<QuestId, string> = {
  rosen: 'Три стръка росен',
  chickens: 'Кой краде кокошките?',
  lamia: 'Ламята',
  iron: 'Желязо и вълна',
};
export const QUEST_MAIN: Record<QuestId, boolean> = { rosen: true, lamia: true, chickens: false, iron: false };

export type RosenStage = 'none' | 'collect' | 'return' | 'done';
export type ChickensStage = 'none' | 'ask' | 'watch' | 'return' | 'done';
export type LamiaStage = 'none' | 'go' | 'report' | 'done';
export type IronStage = 'none' | 'bell' | 'confront' | 'tell' | 'done';

export interface QuestStages { rosen: RosenStage; chickens: ChickensStage; lamia: LamiaStage; iron: IronStage }

export interface QuestsSave {
  stages: QuestStages;
  clues: VillagerId[];
  talked: VillagerId[];
  bowGiven: boolean;
  petkoHarsh: boolean;
}

export type NotifyKind = 'quest' | 'item' | 'info' | 'warn' | 'level';

export interface QuestCtx {
  host: QuestHost;
  inv: Inventory;
  /** Дава предмет (и съобщава „pickup“). */
  give(id: ItemId, n: number): void;
  xp(n: number): void;
  /** Слага оръжие/дреха на героя. */
  equip(id: ItemId): void;
  notify(text: string, kind: NotifyKind): void;
  questChanged(id: QuestId, stage: string, title: string, text: string): void;
  questDone(id: QuestId, title: string): void;
  /** Купува предмет за грошове (false — не стигат или няма място). */
  buy?(id: ItemId, price: number): boolean;
  /** Продава всички такива предмети по each гроша. Връща получените грошове. */
  sellAll?(id: ItemId, each: number): number;
}

export interface QuestReply { say: string; options?: DialogueOption[]; end?: boolean }

export interface QuestMarker { label: string; kind: 'quest' | 'boss' | 'item'; villager?: VillagerId; place?: PlaceId; x?: number; z?: number }

export const BANITSA_PRICE = 5;
export const TEA_PRICE = 3;
export const POTION_PRICE = 25;
export const CLAW_PRICE = 2;
export const ROSEN_NEEDED = 3;
export const CLUES_NEEDED = 2;

const o = (id: string, text: string): DialogueOption => ({ id: 'q:' + id, text });

export class Quests {
  stages: QuestStages = { rosen: 'none', chickens: 'none', lamia: 'none', iron: 'none' };
  clues: VillagerId[] = [];
  talked: VillagerId[] = [];
  bowGiven = false;
  petkoHarsh = false;

  constructor(private ctx: QuestCtx) {}

  // ---------- стъпки ----------
  title(id: QuestId): string { return QUEST_TITLES[id]; }

  step(id: QuestId): string {
    const s = this.stages;
    switch (id) {
      case 'rosen':
        if (s.rosen === 'collect') return `Събери ${ROSEN_NEEDED} стръка росен в Тъмната гора (${Math.min(ROSEN_NEEDED, this.ctx.inv.count('rosen'))}/${ROSEN_NEEDED}). Пази се от таласъмите по здрач.`;
        if (s.rosen === 'return') return 'Занеси росена на баба Гена.';
        if (s.rosen === 'done') return 'Баба Гена получи росена и ти каза къде спи Ламята.';
        return 'Поговори с баба Гена.';
      case 'chickens':
        if (s.chickens === 'ask') return `Разпитай селяните за кокошките на Радка (${Math.min(CLUES_NEEDED, this.clues.length)}/${CLUES_NEEDED}).`;
        if (s.chickens === 'watch') return 'Пази кокошарника нощем (22:00–04:00) и хвани крадеца.';
        if (s.chickens === 'return') return 'Занеси лисичата опашка на Радка.';
        if (s.chickens === 'done') return 'Крадецът беше лисица-таласъм. Петко е невинен.';
        return 'Поговори с Радка в хана.';
      case 'lamia':
        if (s.lamia === 'go') return 'Иди на Ламин връх нагоре по сухото корито на Бистрица и победи Ламята.';
        if (s.lamia === 'report') return 'Ламята е мъртва! Разкажи на дядо Пею.';
        if (s.lamia === 'done') return 'Бистрица тече отново. Селото празнува сбор.';
        return 'Разбери къде спи Ламята.';
      case 'iron':
        if (s.iron === 'bell') return 'Потърси следи в нивата на Иван (на юг от портата).';
        if (s.iron === 'confront') return 'Покажи звънчето на Петко овчаря.';
        if (s.iron === 'tell') return 'Кажи на Иван, че Петко ще огради козите си.';
        if (s.iron === 'done') return 'Иван и Петко се сдобриха. Иван ти изкова сабя.';
        return 'Поговори с Иван ковача.';
    }
  }

  private set<K extends QuestId>(id: K, stage: QuestStages[K]): void {
    if (this.stages[id] === stage) return;
    const wasNone = this.stages[id] === 'none';
    this.stages[id] = stage;
    if (stage === 'done') {
      this.ctx.questDone(id, QUEST_TITLES[id]);
      this.ctx.notify(`Задачата е изпълнена: „${QUEST_TITLES[id]}“`, 'quest');
    } else {
      this.ctx.questChanged(id, stage, QUEST_TITLES[id], this.step(id));
      this.ctx.notify(wasNone ? `Нова задача: „${QUEST_TITLES[id]}“` : `„${QUEST_TITLES[id]}“: ${this.step(id)}`, 'quest');
    }
  }

  /** Обновява стъпка, която зависи от брой предмети (без смяна на етапа). */
  private refresh(id: QuestId): void { this.ctx.questChanged(id, this.stages[id], QUEST_TITLES[id], this.step(id)); }

  isActive(id: QuestId): boolean { const s = this.stages[id]; return s !== 'none' && s !== 'done'; }

  // ---------- кукички от играта ----------
  /** Когато в раницата влезе предмет. */
  onItem(id: ItemId): void {
    const inv = this.ctx.inv;
    if (id === 'rosen' && this.stages.rosen === 'collect') {
      if (inv.count('rosen') >= ROSEN_NEEDED) this.set('rosen', 'return'); else this.refresh('rosen');
    }
    if (id === 'bell' && this.stages.iron === 'bell') this.set('iron', 'confront');
    if (id === 'fox_tail' && this.stages.chickens === 'watch') this.set('chickens', 'return');
  }

  /** Лисицата е хваната. */
  onFoxCaught(): void {
    this.ctx.host.setFlag('fox_caught', true);
    this.ctx.host.chronicle('Странникът хвана лисицата-таласъм, която крадеше кокошките на Радка.', ['player', 'radka'], 6, 'monster');
  }

  /** Ламята е победена (вика се от боя). */
  onLamiaDefeated(): void {
    if (this.stages.lamia !== 'done') this.set('lamia', 'report');
  }

  onTalk(v: VillagerId): void {
    if (!this.talked.includes(v)) this.talked.push(v);
  }

  /** Активна ли е лисицата (етап „пази кокошарника“). */
  foxActive(): boolean { return this.stages.chickens === 'watch'; }
  wantsRosen(): boolean { return this.stages.rosen === 'collect'; }
  wantsBell(): boolean { return this.stages.iron === 'bell'; }

  // ---------- диалози ----------
  options(v: VillagerId): DialogueOption[] {
    const s = this.stages;
    const out: DialogueOption[] = [];
    switch (v) {
      case 'gena':
        if (s.rosen === 'none') out.push(o('rosen_ask', 'Бабо Гено, има ли с какво да помогна?'));
        if (s.rosen === 'collect') out.push(o('rosen_where', 'Къде точно расте росенът?'));
        if (s.rosen === 'return') out.push(o('rosen_give', 'Донесох ти три стръка росен, бабо.'));
        if (s.lamia === 'go') out.push(o('lamia_how', 'Бабо, как да победя Ламята?'));
        if (s.rosen === 'done' && this.ctx.buy) out.push(o('gena_potion', `Ще ми свариш ли още отвара? (${POTION_PRICE} гроша)`));
        break;
      case 'radka':
        if (this.ctx.buy) out.push(o('shop', 'Какво има за хапване, Радке?'));
        if (s.chickens === 'none') out.push(o('chickens_ask', 'Изглеждаш разтревожена, Радке.'));
        if (s.chickens === 'watch') out.push(o('chickens_radka', 'Ти самата какво видя онази нощ?'));
        if (s.chickens === 'return') out.push(o('chickens_tail', 'Ето кой крадеше кокошките ти — лисица-таласъм.'));
        break;
      case 'ivan':
        if (s.iron === 'none') out.push(o('iron_ask', 'Нещо те гложди, ковачо?'));
        if (s.iron === 'tell') out.push(o('iron_tell', 'Петко си призна. Ще огради козите си.'));
        if (this.ctx.sellAll && this.ctx.inv.count('claw') > 0) out.push(o('sell_claws', `Купуваш ли таласъмски нокти? (${this.ctx.inv.count('claw')} бр.)`));
        break;
      case 'petko':
        if (s.iron === 'confront') out.push(o('iron_bell', 'Това звънче е от твоя коза. Намерих го в нивата на Иван.'));
        break;
      case 'peyu':
        if (s.lamia === 'report') out.push(o('lamia_report', 'Дядо Пею, Ламята е мъртва. Реката тече!'));
        break;
      case 'kalin':
        if (this.ctx.host.getFlag('lamia_dead') && !this.bowGiven) out.push(o('kalin_bow', 'Калине, като че ли искаш да ми кажеш нещо?'));
        break;
      case 'maria': break;
    }
    if ((s.chickens === 'ask' || s.chickens === 'watch') && v !== 'radka' && !this.clues.includes(v) && this.clues.length < 3) {
      out.push(o('chickens_clue', 'Знаеш ли нещо за кокошките на Радка?'));
    }
    return out;
  }

  choose(v: VillagerId, optionId: string): QuestReply | null {
    if (!optionId.startsWith('q:')) return null;
    const id = optionId.slice(2);
    const c = this.ctx, h = c.host, inv = c.inv;
    const s = this.stages;
    switch (id) {
      // ---------- 1) Три стръка росен ----------
      case 'rosen_ask':
        if (v !== 'gena' || s.rosen !== 'none') return null;
        return {
          say: 'Ох, чедо, ей го на — сякаш те е пратила самата гора. Отварите ми свършиха, а без росен не мога да ги сваря. Росенът расте само в Тъмната гора — светли стръкчета, ще ги познаеш. Донеси ми три. Ама внимавай, мари: по здрач там излизат таласъми. Иди денем.',
          options: [o('rosen_accept', 'Ще ти донеса три стръка росен.'), o('rosen_later', 'Ще помисля, бабо.')],
        };
      case 'rosen_accept':
        if (v !== 'gena' || s.rosen !== 'none') return null;
        this.set('rosen', 'collect');
        if (inv.count('rosen') >= ROSEN_NEEDED) this.set('rosen', 'return');
        return { say: 'Кой каквото прави, на себе си го прави — а ти правиш добро, чедо. Гората е на запад от селото. Върви и се прибери преди мръкване.' };
      case 'rosen_later':
        return { say: 'Не бързай, чедо. Гората чака. Аз — не толкова, хе-хе.' };
      case 'rosen_where':
        return { say: 'Навътре в гората, на запад от селото, покрай пътеката. Светят си слабичко, като светулки. Три стръка, чедо, не повече — гората не обича алчните.' };
      case 'rosen_give': {
        if (v !== 'gena' || s.rosen !== 'return' || inv.count('rosen') < ROSEN_NEEDED) return null;
        inv.remove('rosen', ROSEN_NEEDED);
        c.give('rosen_potion', 2);
        c.xp(200);
        h.deed({ kind: 'quest_done', villager: 'gena', text: 'Странникът донесе три стръка росен на баба Гена от Тъмната гора.', importance: 6, affinity: 20, trust: 20, witnesses: ['gena', 'kalin'] });
        h.chronicle('Странникът донесе на баба Гена три стръка росен от Тъмната гора.', ['player', 'gena'], 5, 'quest');
        this.set('rosen', 'done');
        if (s.lamia === 'none') this.set('lamia', 'go');
        return {
          say: 'Ей го на! Три стръка, свежи като роса. Вземи тези две отвари — за тежки рани са. А сега слушай, чедо, че няма кой друг да ти каже. Ламята, дето пресуши Бистрица, спи горе на Ламин връх. Върви нагоре по сухото корито на реката, на североизток от моста — там, при извора, е бърлогата ѝ. Три глави има. Удряй ги, когато се навеждат да хапят — тогава са слаби.',
        };
      }
      case 'lamia_how':
        return { say: 'Чуй баба си, чедо. Не стой пред нея като пън — когато глава се надигне, отскочи, а щом захапе земята, удряй. Като ѝ паднат две глави, ще бълва огън — не стой в пламъците. Вземи си баници и отвари. И се върни жив, че кой ще ми носи росен?' };

      // ---------- ханът, отварите, ноктите ----------
      case 'shop':
        if (v !== 'radka') return null;
        return { say: `Баница със сирене — ${BANITSA_PRICE} гроша, билков чай — ${TEA_PRICE}. Ханът е за хора, не за празни стомаси!`, options: this.shopOptions() };
      case 'buy_banitsa':
      case 'buy_tea': {
        if (v !== 'radka' || !c.buy) return null;
        const ok = id === 'buy_banitsa' ? c.buy('banitsa', BANITSA_PRICE) : c.buy('tea', TEA_PRICE);
        return { say: ok ? (id === 'buy_banitsa' ? 'Заповядай, топла е! Пази я за после — по пътя към Ламята ще ти дотрябва.' : 'Мащерка и липа. Пий, че силата ще ти трябва.') : 'Ех, грошовете не стигат, чедо… Ела пак.', options: this.shopOptions() };
      }
      case 'shop_no':
        return { say: 'Както кажеш. Ако огладнееш — знаеш къде съм.' };
      case 'gena_potion': {
        if (v !== 'gena' || s.rosen !== 'done' || !c.buy) return null;
        const ok = c.buy('rosen_potion', POTION_PRICE);
        return { say: ok ? 'Ей, сварих една и за теб. Пий я, когато ти причернее пред очите.' : `Билките не растат на дърво, чедо… е, растат, ама грошове трябват. ${POTION_PRICE}.` };
      }
      case 'sell_claws': {
        if (v !== 'ivan' || !c.sellAll) return null;
        const got = c.sellAll('claw', CLAW_PRICE);
        return { say: got > 0 ? `Хм. ${got} гроша. Ще стане за пирони.` : 'Нямаш нищо. Хм.' };
      }

      // ---------- 2) Кой краде кокошките? ----------
      case 'chickens_ask':
        if (v !== 'radka' || s.chickens !== 'none') return null;
        return {
          say: 'Разтревожена ли? Бясна съм! Ама да си остане между нас… Някой ми краде кокошките! Всяка нощ по една. Аз си знам кой е — оня Петко, дето все се мръщи. Ама никой не ми вярва. Разпитай хората, ти си нов, на теб ще кажат.',
          options: [o('chickens_accept', 'Ще разбера кой краде кокошките.'), o('chickens_later', 'Не е моя работа.')],
        };
      case 'chickens_accept':
        if (v !== 'radka' || s.chickens !== 'none') return null;
        this.set('chickens', 'ask');
        return { say: 'Ей, така те искам! Питай ги всичките — кой какво е видял. Ама гледай: тук всеки лъже по малко. Освен мен, разбира се.' };
      case 'chickens_later':
        return { say: 'Хм. Като ти свършат баниците, пак ще дойдеш, знам аз.' };
      case 'chickens_clue': {
        if (v === 'radka' || !(s.chickens === 'ask' || s.chickens === 'watch') || this.clues.includes(v)) return null;
        const say = h.clue(v, 'chickens') || 'Нищо не знам за кокошките. Питай другите.';
        this.clues.push(v);
        if (s.chickens === 'ask') {
          if (this.clues.length >= CLUES_NEEDED) this.set('chickens', 'watch'); else this.refresh('chickens');
        }
        return { say };
      }
      case 'chickens_radka':
        return { say: 'Ами… видях нещо рижо да се шмугва към гората. С очи като въглени. Ама кой ще ми повярва, че е таласъм? По-лесно е да кажа, че е Петко. Ти пази нощем при кокошарника — ще видиш сам.' };
      case 'chickens_tail': {
        if (v !== 'radka' || s.chickens !== 'return' || inv.count('fox_tail') < 1) return null;
        inv.remove('fox_tail', 1);
        c.give('coin', 40);
        c.xp(150);
        h.deed({ kind: 'helped', villager: 'radka', text: 'Странникът хвана лисицата-таласъм, която крадеше кокошките на Радка, и показа, че Петко е невинен.', importance: 7, affinity: 25, trust: 20, witnesses: 'all' });
        h.relation('radka', 'petko', 20, 25);
        h.chronicle('Радка разбра, че кокошките ѝ ги е крала лисица-таласъм, а не Петко. Петко е оправдан пред селото.', ['player', 'radka', 'petko'], 6, 'quest');
        this.set('chickens', 'done');
        return { say: 'Мале мила! Лисица… значи не било Петко. Ох, че ме е срам — половин село наговорих. Вземи тия грошове, заслужил си ги. И… ще се извиня на Петко. Някой ден. Може би.' };
      }

      // ---------- 3) Ламята ----------
      case 'lamia_report':
        if (v !== 'peyu' || s.lamia !== 'report') return null;
        return {
          say: 'Аз като кмет… ох, остави кмета. Аз като старец ти благодаря, синко. Бистрица пее пак! Едно време така пееше. Редът си е ред — героят получава награда. Избери си.',
          options: [o('lamia_kalpak', 'Ще взема калпака ти, дядо.'), o('lamia_mart', 'Ще взема мартеницата.')],
        };
      case 'lamia_kalpak':
      case 'lamia_mart': {
        if (v !== 'peyu' || s.lamia !== 'report') return null;
        const kalpak = id === 'lamia_kalpak';
        c.give(kalpak ? 'kalpak' : 'martenitsa', 1);
        if (!inv.equipment[kalpak ? 'head' : 'amulet']) c.equip(kalpak ? 'kalpak' : 'martenitsa');
        c.xp(200);
        h.deed({ kind: 'quest_done', villager: 'peyu', text: 'Странникът разказа на кмета, че Ламята е мъртва и реката тече.', importance: 7, affinity: 30, trust: 30, witnesses: 'all' });
        h.chronicle('Дядо Пею награди странника, който уби Ламята. Кметът обяви сбор на мегдана.', ['player', 'peyu'], 7, 'quest');
        this.set('lamia', 'done');
        return {
          say: kalpak
            ? 'Моят калпак! Носих го на три избора… Носи го с чест. Сборът на мегдана е за теб — с хоро и огън!'
            : 'Мартеница от баба ми — за здраве. Носи я на сърцето си. Сборът на мегдана е за теб — с хоро и огън!',
        };
      }

      // ---------- Странична: Желязо и вълна ----------
      case 'iron_ask': {
        if (v !== 'ivan' || s.iron !== 'none') return null;
        const clue = h.clue('ivan', 'goats');
        return {
          say: 'Хм. Козите. Някой ги пуска в нивата ми. Всяка сутрин — стъпкано.' + (clue ? ' ' + clue : ''),
          options: [o('iron_accept', 'Ще разбера кой пуска козите.'), o('iron_later', 'Не мога сега.')],
        };
      }
      case 'iron_accept':
        if (v !== 'ivan' || s.iron !== 'none') return null;
        this.set('iron', 'bell');
        return { say: 'Ще видим. Нивата е на юг от портата. Гледай за следи.' };
      case 'iron_later':
        return { say: 'Хм.' };
      case 'iron_bell':
        if (v !== 'petko' || s.iron !== 'confront') return null;
        return {
          say: 'Абе ти кво… Дай го насам! …Мое е, да. И кво от това?',
          options: [o('iron_kind', 'Всеки греши, Петко. Огради козите и да забравим.'), o('iron_harsh', 'Стига лъга! Цялото село ще разбере какъв си.')],
        };
      case 'iron_kind':
      case 'iron_harsh': {
        if (v !== 'petko' || s.iron !== 'confront') return null;
        const harsh = id === 'iron_harsh';
        this.petkoHarsh = harsh;
        inv.remove('bell', 1);
        h.deed({
          kind: harsh ? 'insulted' : 'helped', villager: 'petko',
          text: harsh ? 'Странникът хвана Петко в лъжа и му се развика.' : 'Странникът хвана Петко в лъжа, но му предложи да се сдобри с Иван.',
          importance: 5, affinity: harsh ? -10 : 15, trust: harsh ? 5 : 15, witnesses: ['petko'],
        });
        this.set('iron', 'tell');
        return {
          say: harsh
            ? 'Кво?! …Добре де, добре! Аз ги пусках. Нарочно. Доволен ли си? Ще ги оградя, само не разправяй по хана.'
            : '…Ми то е ясно, че не съм прав. Яд ме беше на Иван — гледа ме отвисоко. Добре. Ще оградя козите. Кажи му. Ама да знае, че не съм го направил от страх.',
        };
      }
      case 'iron_tell': {
        if (v !== 'ivan' || s.iron !== 'tell') return null;
        h.relation('ivan', 'petko', 40, 30);
        h.setFlag('ivan_petko_peace', true);
        h.chronicle('Иван ковачът и Петко овчарят се сдобриха. Петко ще огради козите си.', ['player', 'ivan', 'petko'], 6, 'quest');
        h.deed({ kind: 'helped', villager: 'ivan', text: 'Странникът сдобри Иван ковача с Петко овчаря.', importance: 6, affinity: 30, trust: 25, witnesses: ['ivan', 'petko', 'maria'] });
        c.give('ivan_saber', 1);
        c.equip('ivan_saber');
        c.xp(150);
        this.set('iron', 'done');
        return { say: '…Петко? Сам ли го каза? Хм. Думата му е дума тогава. И моята е дума. Ковах нещо, докато те нямаше. Вземи. Сабята на Иван.' };
      }

      // ---------- Бонус: лъкът на Калин ----------
      case 'kalin_bow': {
        if (v !== 'kalin' || this.bowGiven || !h.getFlag('lamia_dead')) return null;
        this.bowGiven = true;
        h.setFlag('kalin_bow', true);
        c.give('bow', 1);
        c.xp(50);
        h.deed({ kind: 'gift', villager: 'kalin', text: 'Калин подари на странника лък, който правил тайно цяло лято.', importance: 6, affinity: 25, trust: 20, witnesses: ['kalin', 'gena'] });
        h.chronicle('Калин дърводелецът разкри тайната си: цяло лято правил лък за героя, който ще спаси селото — и го подари на странника.', ['kalin', 'player'], 6, 'player');
        return { say: 'Аз… ако не ти преча… Цяло лято правих нещо. Тайно. За героя, който ще спаси селото. Мислех, че никога няма да дойде. А ти дойде. Ето — лък. От ясен е. Вземи го… ако искаш, де.' };
      }
    }
    return null;
  }

  private shopOptions(): DialogueOption[] {
    return [o('buy_banitsa', `Една баница (${BANITSA_PRICE} гроша)`), o('buy_tea', `Чаша чай (${TEA_PRICE} гроша)`), o('shop_no', 'Друг път.')];
  }

  // ---------- за картата и дневника ----------
  log(): { id: string; title: string; step: string; done: boolean; main: boolean }[] {
    const out: { id: string; title: string; step: string; done: boolean; main: boolean }[] = [];
    for (const id of QUEST_IDS) {
      // в началото — подсказка накъде да тръгне („Поговори с баба Гена.“)
      if (this.stages[id] === 'none' && !(id === 'rosen' && Object.values(this.stages).every((v) => v === 'none'))) continue;
      out.push({ id, title: QUEST_TITLES[id], step: this.step(id), done: this.stages[id] === 'done', main: QUEST_MAIN[id] });
    }
    // активните най-отгоре, главните преди страничните
    return out.sort((a, b) => Number(a.done) - Number(b.done) || Number(b.main) - Number(a.main));
  }

  markers(): QuestMarker[] {
    const s = this.stages, m: QuestMarker[] = [];
    if (s.rosen === 'none') m.push({ label: 'Баба Гена', kind: 'quest', villager: 'gena' });
    if (s.rosen === 'return') m.push({ label: 'Баба Гена — росенът', kind: 'quest', villager: 'gena' });
    if (s.lamia === 'go') m.push({ label: 'Ламята', kind: 'boss', place: 'lamia_plateau' });
    if (s.lamia === 'report') m.push({ label: 'Дядо Пею', kind: 'quest', villager: 'peyu' });
    if (s.chickens === 'none' && s.rosen !== 'none') m.push({ label: 'Радка', kind: 'quest', villager: 'radka' });
    if (s.chickens === 'watch') m.push({ label: 'Кокошарникът (нощем)', kind: 'quest', place: 'coop' });
    if (s.chickens === 'return') m.push({ label: 'Радка — опашката', kind: 'quest', villager: 'radka' });
    if (s.iron === 'none' && s.rosen !== 'none') m.push({ label: 'Иван ковачът', kind: 'quest', villager: 'ivan' });
    if (s.iron === 'bell') m.push({ label: 'Нивата на Иван', kind: 'quest', place: 'field_ivan' });
    if (s.iron === 'confront') m.push({ label: 'Петко', kind: 'quest', villager: 'petko' });
    if (s.iron === 'tell') m.push({ label: 'Иван', kind: 'quest', villager: 'ivan' });
    return m;
  }

  serialize(): QuestsSave {
    return { stages: { ...this.stages }, clues: [...this.clues], talked: [...this.talked], bowGiven: this.bowGiven, petkoHarsh: this.petkoHarsh };
  }

  load(q: QuestsSave): void {
    const st: Partial<QuestStages> = q?.stages ?? {};
    this.stages = { rosen: st.rosen ?? 'none', chickens: st.chickens ?? 'none', lamia: st.lamia ?? 'none', iron: st.iron ?? 'none' };
    this.clues = [...(q?.clues ?? [])];
    this.talked = [...(q?.talked ?? [])];
    this.bowGiven = !!q?.bowGiven;
    this.petkoHarsh = !!q?.petkoHarsh;
  }
}
