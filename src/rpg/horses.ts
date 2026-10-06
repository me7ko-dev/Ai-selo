// Конете: диви стада по ливадите, опитомяване ([E]), оседлаване (седло от Калин), езда и повикване ([H]).
// Конете на играча се записват (кой е опитомен, оседлан, къде е оставен); дивите се връщат при стадото си.
import * as THREE from 'three';
import type { WorldQuery } from '../core/world-query';
import { createHorseModel, HORSE_COATS, type HorseCoat, type HorseModel } from '../models';

export interface HerdDef { x: number; z: number; r: number; place: string }
/** Ливадите на стадата (равни, далеч от гората и реката). */
export const HERDS: HerdDef[] = [
  { x: -34, z: 108, r: 10, place: 'ливадата западно от входа на селото' },
  { x: -20, z: 160, r: 12, place: 'поляните до пътя на юг' },
  { x: 60, z: -40, r: 12, place: 'ливадата на изток, към Бистрица' },
  { x: 175, z: 95, r: 14, place: 'полето под Старата крепост' },
];

export interface HorseDef { id: string; name: string; coat: HorseCoat; herd: number }
export const HORSES: HorseDef[] = [
  { id: 'dorcho', name: 'Дорчо', coat: 'bay', herd: 0 },
  { id: 'belcho', name: 'Белчо', coat: 'white', herd: 0 },
  { id: 'zlatka', name: 'Златка', coat: 'palomino', herd: 0 },
  { id: 'vrancho', name: 'Вранчо', coat: 'black', herd: 1 },
  { id: 'sivcho', name: 'Сивчо', coat: 'grey', herd: 1 },
  { id: 'kestenka', name: 'Кестенка', coat: 'chestnut', herd: 1 },
  { id: 'vihar', name: 'Вихър', coat: 'black', herd: 2 },
  { id: 'zvezdana', name: 'Звездана', coat: 'bay', herd: 2 },
  { id: 'laska', name: 'Ласка', coat: 'chestnut', herd: 2 },
  { id: 'sneja', name: 'Снежа', coat: 'white', herd: 3 },
  { id: 'burya', name: 'Буря', coat: 'grey', herd: 3 },
  { id: 'slanchko', name: 'Слънчо', coat: 'palomino', herd: 3 },
];

/** Скорости (м/с): кротко ходене, тръс, галоп с ездач. */
export const HORSE_WALK = 1.3, HORSE_TROT = 5.5, RIDE_WALK = 4.6, RIDE_GALLOP = 12.5;
/** Колко близо трябва да е героят за [E]. */
export const HORSE_REACH = 2.8;

type HState = 'graze' | 'walk' | 'flee' | 'come' | 'ridden';

export interface Horse {
  readonly def: HorseDef;
  readonly model: HorseModel;
  readonly pos: THREE.Vector3;
  yaw: number;
  owned: boolean;
  saddled: boolean;
  /** Около коя точка пасе (стадото или където си го оставил). */
  home: { x: number; z: number; r: number };
  state: HState;
  target: { x: number; z: number };
  wait: number;
  speed: number;
  anim: string;
}

export interface HorsesSave {
  owned: { id: string; saddled: boolean; x: number; z: number; yaw: number }[];
  riding: string | null;
}

/** Детерминиран „случаен“ брой (за началните места — еднакви след всяко зареждане). */
function h01(i: number, k: number): number { const v = Math.sin(i * 91.7 + k * 13.3) * 43758.5453; return v - Math.floor(v); }

export class HorseManager {
  readonly list: Horse[] = [];
  /** На кой кон е героят (id) или null. */
  riding: string | null = null;
  private group = new THREE.Group();
  private t = 0;

  constructor(scene: THREE.Object3D | null, private world: WorldQuery) {
    scene?.add(this.group);
    this.group.name = 'horses';
    HORSES.forEach((def, i) => {
      const model = createHorseModel(def.coat);
      this.group.add(model.root);
      const herd = HERDS[def.herd];
      const h: Horse = {
        def, model, pos: new THREE.Vector3(), yaw: h01(i, 3) * Math.PI * 2, owned: false, saddled: false,
        home: { x: herd.x, z: herd.z, r: herd.r }, state: 'graze', target: { x: 0, z: 0 }, wait: h01(i, 4) * 5, speed: 0, anim: '',
      };
      this.list.push(h);
    });
    this.resetWild();
  }

  /** Всички диви — по стадата си (при ново начало и преди зареждане на запис). */
  private resetWild(): void {
    this.list.forEach((h, i) => {
      const herd = HERDS[h.def.herd];
      const a = h01(i, 1) * Math.PI * 2, r = herd.r * (0.3 + 0.6 * h01(i, 2));
      h.owned = false; h.saddled = false; h.model.setSaddled(false); h.model.ridden = false;
      h.home = { x: herd.x, z: herd.z, r: herd.r };
      this.place(h, herd.x + Math.cos(a) * r, herd.z + Math.sin(a) * r);
      h.state = 'graze'; h.wait = 1 + h01(i, 4) * 5;
    });
    this.riding = null;
  }

  private place(h: Horse, x: number, z: number): void {
    h.pos.set(x, this.world.heightAt(x, z), z);
    h.target = { x, z };
    h.model.root.position.copy(h.pos);
    h.model.root.rotation.y = h.yaw;
  }

  get(id: string | null): Horse | undefined { return id ? this.list.find((h) => h.def.id === id) : undefined; }
  get ridden(): Horse | undefined { return this.get(this.riding); }
  owned(): Horse[] { return this.list.filter((h) => h.owned); }

  /** Най-близкият кон (без този, който яздиш). */
  nearest(x: number, z: number, maxD: number): { h: Horse; d: number } | null {
    let best: Horse | null = null, bd = maxD;
    for (const h of this.list) {
      if (h.def.id === this.riding) continue;
      const d = Math.hypot(h.pos.x - x, h.pos.z - z);
      if (d < bd) { bd = d; best = h; }
    }
    return best ? { h: best, d: bd } : null;
  }

  // ───────── действия (Rpg проверява условията и казва на играча) ─────────
  tame(h: Horse): void {
    h.owned = true;
    h.state = 'graze'; h.wait = 3;
    h.home = { x: h.pos.x, z: h.pos.z, r: 3 };
  }

  saddle(h: Horse): void { h.saddled = true; h.model.setSaddled(true); }

  mount(h: Horse): void {
    this.riding = h.def.id;
    h.state = 'ridden';
    h.model.ridden = true;
  }

  /** Слизане: конят остава на място и пасе наоколо; връща точката, където стъпва героят (вляво от коня). */
  dismount(): { x: number; z: number } | null {
    const h = this.ridden;
    if (!h) return null;
    this.riding = null;
    h.model.ridden = false;
    h.state = 'graze'; h.wait = 2 + Math.random() * 3; h.speed = 0;
    h.home = { x: h.pos.x, z: h.pos.z, r: 3 };
    const lx = Math.cos(h.yaw), lz = -Math.sin(h.yaw); // лявата страна на коня
    const p = this.world.collide(h.pos.x + lx * 1.3, h.pos.z + lz * 1.3, 0.4);
    return p;
  }

  /** [H]: твоят кон идва в галоп. Предпочита оседлания, после най-близкия. */
  call(x: number, z: number): Horse | null {
    const mine = this.owned().filter((h) => h.state !== 'ridden');
    if (!mine.length) return null;
    mine.sort((a, b) => (Number(b.saddled) - Number(a.saddled)) || (Math.hypot(a.pos.x - x, a.pos.z - z) - Math.hypot(b.pos.x - x, b.pos.z - z)));
    const h = mine[0];
    h.state = 'come'; h.target = { x, z };
    return h;
  }

  // ───────── всеки кадър ─────────
  update(dt: number, hero: { pos: THREE.Vector3; yaw: number; speed: number }, heroSprint: boolean): void {
    if (dt > 0.1) dt = 0.1;
    this.t += dt;
    for (const h of this.list) {
      const dHero = Math.hypot(h.pos.x - hero.pos.x, h.pos.z - hero.pos.z);
      if (h.state === 'ridden') {
        h.pos.copy(hero.pos);
        h.yaw = hero.yaw;
        h.speed = hero.speed;
        this.anim(h, hero.speed > 7.5 ? 'run' : hero.speed > 0.4 ? 'walk' : 'idle');
        h.model.root.position.copy(h.pos);
        h.model.root.rotation.y = h.yaw;
        h.model.update(dt, hero.speed);
        continue;
      }
      // дивите се плашат от тичащ човек
      if (!h.owned && heroSprint && dHero < 9 && h.state !== 'flee') {
        const ax = h.pos.x - hero.pos.x, az = h.pos.z - hero.pos.z, al = Math.hypot(ax, az) || 1;
        h.state = 'flee'; h.target = { x: h.pos.x + (ax / al) * 18, z: h.pos.z + (az / al) * 18 };
      }
      let speed = 0;
      switch (h.state) {
        case 'graze':
          h.wait -= dt;
          if (h.wait <= 0) {
            const a = Math.random() * Math.PI * 2, r = h.home.r * Math.sqrt(Math.random());
            h.target = { x: h.home.x + Math.cos(a) * r, z: h.home.z + Math.sin(a) * r };
            h.state = 'walk';
          }
          break;
        case 'walk': speed = HORSE_WALK; break;
        case 'flee': speed = HORSE_TROT; break;
        case 'come': {
          h.target = { x: hero.pos.x, z: hero.pos.z };
          speed = dHero > 14 ? RIDE_GALLOP * 0.85 : HORSE_TROT;
          if (dHero < 3) { h.state = 'graze'; h.wait = 4; h.home = { x: h.pos.x, z: h.pos.z, r: 3 }; speed = 0; }
          break;
        }
      }
      if (speed > 0) {
        const dx = h.target.x - h.pos.x, dz = h.target.z - h.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.4 && h.state !== 'come') { h.state = 'graze'; h.wait = 3 + Math.random() * 8; speed = 0; }
        else {
          const step = Math.min(d, speed * dt);
          const c = this.world.collide(h.pos.x + (dx / d) * step, h.pos.z + (dz / d) * step, 0.7);
          // заседнал в препятствие — тръгва другаде
          if (Math.hypot(c.x - h.pos.x, c.z - h.pos.z) < step * 0.2 && h.state !== 'come') { h.state = 'graze'; h.wait = 1; }
          h.pos.x = c.x; h.pos.z = c.z;
          let dy = Math.atan2(dx, dz) - h.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          h.yaw += dy * Math.min(1, dt * 4);
        }
      }
      if (h.state === 'flee' && dHero > 22) { h.state = 'graze'; h.wait = 2; }
      h.speed = speed;
      h.pos.y = this.world.heightAt(h.pos.x, h.pos.z);
      h.model.root.position.copy(h.pos);
      h.model.root.rotation.y = h.yaw;
      // анимацията — само наблизо (далечните само се местят)
      if (dHero < 110) {
        this.anim(h, speed > 4 ? 'run' : speed > 0.3 ? 'walk' : 'idle');
        h.model.update(dt, speed);
      }
      h.model.root.visible = dHero < 260;
    }
  }

  private anim(h: Horse, a: 'idle' | 'walk' | 'run'): void {
    if (h.anim !== a) { h.model.play(a); h.anim = a; }
  }

  /** Описание на коня: „Дорчо — дорест кон“, „Златка — жълтеникава кобила“. */
  static label(h: Horse): string {
    const fem = h.def.name.endsWith('а');
    return `${h.def.name} — ${HORSE_COATS[h.def.coat].name}${fem ? 'а кобила' : ' кон'}`;
  }
  /** Кобила ли е (за „твой/твоя“ в съобщенията). */
  static fem(h: Horse): boolean { return h.def.name.endsWith('а'); }

  // ───────── запис ─────────
  serialize(): HorsesSave {
    return {
      owned: this.owned().map((h) => ({ id: h.def.id, saddled: h.saddled, x: +h.pos.x.toFixed(2), z: +h.pos.z.toFixed(2), yaw: +h.yaw.toFixed(3) })),
      riding: this.riding,
    };
  }

  load(s: HorsesSave | undefined): void {
    this.resetWild();
    if (!s) return;
    for (const o of s.owned ?? []) {
      const h = this.get(o.id);
      if (!h) continue;
      h.owned = true;
      h.saddled = !!o.saddled; h.model.setSaddled(h.saddled);
      h.yaw = o.yaw ?? 0;
      this.place(h, o.x, o.z);
      h.home = { x: o.x, z: o.z, r: 3 };
    }
    const r = this.get(s.riding);
    if (r && r.owned && r.saddled) this.mount(r);
  }

  dispose(): void {
    for (const h of this.list) h.model.dispose();
    this.group.removeFromParent();
  }
}
