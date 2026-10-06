// Живинка около селото: стадото на Петко, кокошките, кучето, котката; нощем — самодивите на поляната;
// при „Караконджул“ — сянка, която обикаля селото. Само за картинка (не влиза в записите).
import * as THREE from 'three';
import { createAnimalModel, createMonsterModel, createSamodivaModel, type AnimalKind, type CharacterModel } from '../models';
import { PLACES, type Vec2 } from '../data/layout';
import { heightAt } from '../world/height';
import type { WorldState } from '../sim/types';
import { RING, samodiviDancing } from '../rpg/samodivi';

interface Critter {
  model: CharacterModel;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  wait: number;
  speed: number;
  home: () => Vec2;
  radius: number;
  anim: string;
}

let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Ливадата на кончето (извън селото, на запад от входа). */
const HORSE_MEADOW: Vec2 = { x: -34, z: 108 };

export class Ambient {
  private critters: Critter[] = [];
  private samodivi: CharacterModel[] = [];
  private samodiviGroup = new THREE.Group();
  /** Ъгълът на хорото (спира, докато самодивите гледат героя). */
  private danceT = 0;
  /** Реакция: спират и гледат героя (bless — после пак играят; curse — после изчезват). */
  private samPause = 0;
  private samReact: 'bless' | 'curse' | null = null;
  private samHero = { x: 0, z: 0 };
  /** Изчезнали ли са тази нощ (Game го свързва с проклятието в Rpg). */
  samodiviGone: () => boolean = () => false;
  private kara: CharacterModel | null = null;
  private karaT = 0;
  private group = new THREE.Group();
  private t = 0;
  private petko: () => Vec2 | null = () => null;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    scene.add(this.samodiviGroup);
    const flockHome = () => {
      const p = this.petko();
      if (p && Math.hypot(p.x - PLACES.sheepfold.pos.x, p.z - PLACES.sheepfold.pos.z) < 90) return p;
      return PLACES.sheepfold.pos;
    };
    const add = (kind: AnimalKind, n: number, home: () => Vec2, radius: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const model = createAnimalModel(kind);
        const h = home();
        const pos = new THREE.Vector3(h.x + (rnd() - 0.5) * radius, 0, h.z + (rnd() - 0.5) * radius);
        pos.y = heightAt(pos.x, pos.z);
        this.group.add(model.root);
        this.critters.push({ model, pos, target: pos.clone(), wait: rnd() * 4, speed, home, radius, anim: '' });
      }
    };
    add('sheep', 9, flockHome, 9, 0.9);
    add('goat', 3, flockHome, 11, 1.1);
    add('chicken', 6, () => PLACES.coop.pos, 4, 0.7);
    add('dog', 1, flockHome, 6, 1.6);
    add('cat', 1, () => ({ x: PLACES.inn.pos.x - 6, z: PLACES.inn.pos.z + 2 }), 4, 0.8);
    // кончето пасе на ливадата между селото и кошарата
    add('horse', 1, () => HORSE_MEADOW, 10, 1.3);
    for (let i = 0; i < 5; i++) {
      const s = createSamodivaModel(i);
      this.samodivi.push(s);
      this.samodiviGroup.add(s.root);
      s.play('dance');
    }
    this.samodiviGroup.visible = false;
  }

  /** Самодивите спират хорото и се обръщат към героя (поклон или обида). */
  samodiviReact(kind: 'bless' | 'curse', heroX: number, heroZ: number): void {
    this.samReact = kind;
    this.samPause = kind === 'bless' ? 6 : 2.4;
    this.samHero = { x: heroX, z: heroZ };
    let best = 0, bd = Infinity;
    this.samodivi.forEach((s, i) => {
      const d = Math.hypot(s.root.position.x - heroX, s.root.position.z - heroZ);
      if (d < bd) { bd = d; best = i; }
      s.play('idle');
    });
    // най-близката говори: благославя (cast) или проклина (cast с размах)
    this.samodivi[best]?.play('cast');
  }

  /** Къде са самодивите и виждат ли се (за пробите и за играта). */
  samodiviInfo(): { visible: boolean; ring: { x: number; z: number; r: number }; positions: Vec2[] } {
    return { visible: this.samodiviGroup.visible, ring: { ...RING }, positions: this.samodivi.map((s) => ({ x: s.root.position.x, z: s.root.position.z })) };
  }

  /** Откъде да знаем къде е Петко (стадото го следва денем). */
  followPetko(fn: () => Vec2 | null): void { this.petko = fn; }

  update(dt: number, state: WorldState): void {
    this.t += dt;
    for (const c of this.critters) {
      const d = Math.hypot(c.target.x - c.pos.x, c.target.z - c.pos.z);
      if (d < 0.3) {
        c.wait -= dt;
        if (c.anim !== 'idle') { c.model.play('idle'); c.anim = 'idle'; }
        if (c.wait <= 0) {
          const h = c.home();
          c.target.set(h.x + (rnd() - 0.5) * c.radius * 2, 0, h.z + (rnd() - 0.5) * c.radius * 2);
          c.wait = 2 + rnd() * 6;
        }
        c.model.update(dt, 0);
      } else {
        const step = Math.min(d, c.speed * dt * (d > 25 ? 3 : 1));
        c.pos.x += (c.target.x - c.pos.x) / d * step;
        c.pos.z += (c.target.z - c.pos.z) / d * step;
        c.model.root.rotation.y = Math.atan2(c.target.x - c.pos.x, c.target.z - c.pos.z);
        if (c.anim !== 'walk') { c.model.play('walk'); c.anim = 'walk'; }
        c.model.update(dt, c.speed);
      }
      c.pos.y = heightAt(c.pos.x, c.pos.z);
      c.model.root.position.copy(c.pos);
    }
    // самодиви: нощем (или когато е извикана случката „самодиви“); след проклятие — изчезват до сутринта
    const wasPaused = this.samPause > 0;
    this.samPause = Math.max(0, this.samPause - dt);
    if (wasPaused && this.samPause === 0) {
      for (const s of this.samodivi) s.play('dance'); // след проклятие — за следващата нощ
      this.samReact = null;
    }
    const show = samodiviDancing(state.time, state.flags['samodivi_until']) && (!this.samodiviGone() || this.samPause > 0);
    this.samodiviGroup.visible = show;
    if (show) {
      const paused = this.samPause > 0;
      if (!paused) this.danceT += dt;
      for (let i = 0; i < this.samodivi.length; i++) {
        const s = this.samodivi[i];
        const a = this.danceT * 0.35 + (i / this.samodivi.length) * Math.PI * 2;
        const x = RING.x + Math.cos(a) * RING.r, z = RING.z + Math.sin(a) * RING.r;
        s.root.position.set(x, heightAt(x, z) + 0.15 + Math.sin(this.t * 2 + i) * 0.05 + (paused && this.samReact === 'curse' ? 0.25 : 0), z);
        if (paused) {
          // гледат героя
          const want = Math.atan2(this.samHero.x - x, this.samHero.z - z);
          let d = want - s.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
          s.root.rotation.y += d * Math.min(1, dt * 6);
        } else s.root.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI / 2;
        s.update(dt, paused ? 0 : 0.6);
      }
    }
    // Караконджул: тъмна сянка обикаля мегдана
    const karaOn = typeof state.flags['karakondzhul_until'] === 'number' && (state.flags['karakondzhul_until'] as number) > state.time;
    if (karaOn && !this.kara) {
      this.kara = createMonsterModel('karakondzhul');
      this.kara.play('walk');
      this.group.add(this.kara.root);
    } else if (!karaOn && this.kara) {
      this.group.remove(this.kara.root); this.kara.dispose(); this.kara = null;
    }
    if (this.kara) {
      this.karaT += dt * 0.08;
      const x = PLACES.square.pos.x + Math.cos(this.karaT) * 22, z = PLACES.square.pos.z + Math.sin(this.karaT) * 22;
      this.kara.root.position.set(x, heightAt(x, z), z);
      this.kara.root.rotation.y = Math.atan2(-Math.sin(this.karaT), Math.cos(this.karaT));
      this.kara.update(dt, 1.4);
    }
  }
}
