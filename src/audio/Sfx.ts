// Звукът на играта — изцяло процедурен (WebAudio, без звукови файлове).
// Ефекти (play), фонове (ambient: птици, щурци, вятър, дъжд, буря, река, сбор) и музика (setMusic):
// кавал над гайдарски бурдон в български ладове, ръченица 7/8 (2+2+3) с тъпан за сбора, напрегнато остинато за боя.
// Нотите се планират напред по часовника на AudioContext (малък планировчик на 60 ms) — евтино за процесора.

export type SfxName =
  | 'swing' | 'hit' | 'hurt' | 'block' | 'step' | 'jump' | 'pickup' | 'quest' | 'levelup' | 'talasam' | 'lamia_roar'
  | 'fire' | 'bite' | 'coin' | 'click' | 'page' | 'bubble' | 'death' | 'victory' | 'thunder' | 'vote';
export type AmbientKind = 'day' | 'night' | 'forest' | 'rain' | 'storm' | 'festival' | 'river' | 'none';
export type MusicKind = 'village' | 'night' | 'battle' | 'festival' | 'none';
export interface Volumes { master: number; music: number; sfx: number }

export const SFX_NAMES: readonly SfxName[] = [
  'swing', 'hit', 'hurt', 'block', 'step', 'jump', 'pickup', 'quest', 'levelup', 'talasam', 'lamia_roar',
  'fire', 'bite', 'coin', 'click', 'page', 'bubble', 'death', 'victory', 'thunder', 'vote',
];

// ---- ладове (полутонове от основния тон) ----
const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10],   // „хиджаз“ — с увеличена секунда, чест в Родопите и Тракия
};
const D4 = 293.66;
const midiRatio = (semi: number) => Math.pow(2, semi / 12);
/** Честота на степен deg (може и отрицателна/над октавата) в лад mode от основен тон root. */
function degFreq(root: number, mode: number[], deg: number): number {
  const n = mode.length;
  const oct = Math.floor(deg / n);
  const i = ((deg % n) + n) % n;
  return root * midiRatio(mode[i] + 12 * oct);
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

interface Track {
  kind: MusicKind;
  out: GainNode;
  persistent: AudioScheduledSourceNode[];
  next: number;        // кога е следващото събитие (време на AudioContext)
  step: number;
  phrase: number[];    // текуща фраза (степени)
  durs: number[];
  pos: number;
  deg: number;
}

interface AmbientHandle {
  out: GainNode;
  nodes: AudioScheduledSourceNode[];
  nextEvent: number;   // за случайните звуци (птици, бухал, гръмотевици)
}

type Ctx = AudioContext;

export class Audio {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbIn!: GainNode;
  private noise!: AudioBuffer;
  private vol: Volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
  private track: Track | null = null;
  private wantedMusic: MusicKind = 'none';
  private ambients = new Map<Exclude<AmbientKind, 'none'>, AmbientHandle>();
  private wantedAmbients = new Set<Exclude<AmbientKind, 'none'>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPlay = new Map<SfxName, number>();
  private onVis = () => {
    if (!this.ctx) return;
    if (typeof document !== 'undefined' && document.hidden) void this.ctx.suspend().catch(() => {});
    else void this.ctx.resume().catch(() => {});
  };

  /** Звукът е отключен (имало е жест на играча и AudioContext работи). */
  get unlocked(): boolean { return !!this.ctx && this.ctx.state !== 'closed'; }

  /** Викай при първия жест на играча (щракване/клавиш). Безопасно е да се вика многократно. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {}); return; }
    const AC: typeof AudioContext | undefined = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let ctx: Ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    // шум (2 s) — за дъх, вятър, дъжд, удари
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // лек ехо-отзвук (импулс от затихващ шум)
    this.reverb = ctx.createConvolver();
    const rl = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < rl; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.35;
    this.reverbIn.connect(this.reverb).connect(this.master);
    this.applyVolumes(true);
    this.timer = setInterval(() => this.pump(), 60);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVis);
    void ctx.resume().catch(() => {});
    // приложи желаното преди отключването
    for (const k of this.wantedAmbients) this.startAmbient(k);
    if (this.wantedMusic !== 'none') this.startMusic(this.wantedMusic);
  }

  setVolumes(v: Partial<Volumes>): void {
    this.vol = { master: clamp01(v.master ?? this.vol.master), music: clamp01(v.music ?? this.vol.music), sfx: clamp01(v.sfx ?? this.vol.sfx) };
    this.applyVolumes(false);
  }

  private applyVolumes(now: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (g: GainNode, v: number) => { if (now) g.gain.value = v; else g.gain.setTargetAtTime(v, t, 0.05); };
    set(this.master, this.vol.master * this.vol.master);   // по-естествено усещане за силата
    set(this.musicBus, this.vol.music * this.vol.music * 0.8);
    set(this.sfxBus, this.vol.sfx * this.vol.sfx);
    set(this.ambBus, this.vol.sfx * this.vol.sfx * 0.7);
  }

  /** Спира всичко и освобождава AudioContext. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVis);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.track = null;
    this.ambients.clear();
  }

  // ================= основни парчета =================

  private env(g: AudioParam, t: number, attack: number, peak: number, decay: number) {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private osc(type: OscillatorType, freq: number, t: number, stop: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.start(t);
    o.stop(stop);
    return o;
  }

  private noiseSrc(t: number, stop: number, loop = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    const off = Math.random() * 1.5;
    if (loop) s.start(t, off);
    else { s.start(t, off); s.stop(stop); }
    return s;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private gain(v = 0): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  /** Кратък тон с обвивка → dest. */
  private tone(dest: AudioNode, type: OscillatorType, f0: number, t: number, attack: number, decay: number, peak: number, f1?: number, reverb = 0) {
    const o = this.osc(type, f0, t, t + attack + decay + 0.05);
    if (f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = this.gain();
    this.env(g.gain, t, attack, peak, decay);
    o.connect(g).connect(dest);
    if (reverb > 0) { const s = this.gain(reverb); g.connect(s).connect(this.reverbIn); }
    return o;
  }

  /** Шумов изблик през филтър → dest. */
  private burst(dest: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, attack: number, decay: number, peak: number, freqEnd?: number) {
    const s = this.noiseSrc(t, t + attack + decay + 0.05);
    const f = this.filter(type, freq, q);
    if (freqEnd !== undefined) { f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + attack + decay); }
    const g = this.gain();
    this.env(g.gain, t, attack, peak, decay);
    s.connect(f).connect(g).connect(dest);
  }

  // ================= ефекти =================

  play(name: SfxName, opts: { volume?: number; pan?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    // не трупаме един и същ звук по-често от 30 ms (напр. стъпки от много жители)
    const lp = this.lastPlay.get(name) ?? -1;
    if (t - lp < 0.03) return;
    this.lastPlay.set(name, t);
    let out: AudioNode = this.sfxBus;
    const vol = this.gain(clamp01(opts.volume ?? 1));
    if (opts.pan !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      vol.connect(p).connect(this.sfxBus);
    } else vol.connect(this.sfxBus);
    out = vol;
    this.sfx(name, out, t);
  }

  private sfx(name: SfxName, o: AudioNode, t: number) {
    switch (name) {
      case 'swing':
        this.burst(o, t, 'bandpass', 2800, 1.2, 0.02, 0.18, 0.5, 600);
        break;
      case 'hit':
        this.tone(o, 'sine', 150, t, 0.003, 0.16, 0.9, 45);
        this.burst(o, t, 'lowpass', 2500, 0.8, 0.002, 0.08, 0.6, 400);
        break;
      case 'hurt':
        this.tone(o, 'sawtooth', 320, t, 0.01, 0.25, 0.25, 110);
        this.tone(o, 'square', 240, t + 0.02, 0.01, 0.2, 0.12, 90);
        this.burst(o, t, 'lowpass', 1200, 0.7, 0.003, 0.12, 0.4);
        break;
      case 'block':
        for (const [f, p] of [[820, 0.25], [1290, 0.18], [1960, 0.14], [2730, 0.08]] as const) this.tone(o, 'triangle', f * rnd(0.98, 1.02), t, 0.001, 0.35, p, undefined, 0.3);
        this.burst(o, t, 'highpass', 3000, 0.7, 0.001, 0.04, 0.5);
        break;
      case 'step':
        this.burst(o, t, 'lowpass', rnd(500, 900), 1, 0.005, rnd(0.05, 0.08), rnd(0.25, 0.4));
        break;
      case 'jump':
        this.tone(o, 'sine', 180, t, 0.01, 0.15, 0.3, 420);
        this.burst(o, t, 'bandpass', 1200, 0.8, 0.02, 0.15, 0.2, 2500);
        break;
      case 'pickup':
        this.tone(o, 'triangle', degFreq(D4 * 2, MODES.mixolydian, 0), t, 0.005, 0.12, 0.35, undefined, 0.3);
        this.tone(o, 'triangle', degFreq(D4 * 2, MODES.mixolydian, 4), t + 0.07, 0.005, 0.2, 0.35, undefined, 0.3);
        break;
      case 'quest': {
        const notes = [0, 2, 4, 7];
        notes.forEach((d, i) => this.tone(o, 'triangle', degFreq(D4, MODES.dorian, d + 4), t + i * 0.11, 0.01, 0.5, 0.3, undefined, 0.5));
        this.tone(o, 'sine', degFreq(D4, MODES.dorian, 0), t, 0.05, 1.2, 0.18, undefined, 0.4);
        break;
      }
      case 'levelup': {
        const notes = [0, 2, 4, 5, 7, 9, 11, 14];
        notes.forEach((d, i) => this.tone(o, 'triangle', degFreq(D4, MODES.mixolydian, d), t + i * 0.07, 0.005, 0.35, 0.25, undefined, 0.5));
        for (const d of [14, 16, 18]) this.tone(o, 'sine', degFreq(D4, MODES.mixolydian, d), t + 0.6, 0.05, 1.4, 0.12, undefined, 0.6);
        break;
      }
      case 'talasam': {
        // гърлено ръмжене с трептене + дъх
        const dur = 0.9;
        const s = this.osc('sawtooth', 75, t, t + dur + 0.1);
        s.frequency.linearRampToValueAtTime(58, t + dur);
        const lfo = this.osc('sine', 9, t, t + dur + 0.1);
        const lg = this.gain(18);
        lfo.connect(lg).connect(s.frequency);
        const f = this.filter('lowpass', 600, 4);
        f.frequency.setValueAtTime(300, t);
        f.frequency.linearRampToValueAtTime(900, t + 0.25);
        f.frequency.linearRampToValueAtTime(250, t + dur);
        const g = this.gain();
        this.env(g.gain, t, 0.12, 0.5, dur);
        s.connect(f).connect(g).connect(o);
        const sg = this.gain(0.25); g.connect(sg).connect(this.reverbIn);
        this.burst(o, t, 'bandpass', 900, 2, 0.1, 0.7, 0.2, 400);
        break;
      }
      case 'lamia_roar': {
        const dur = 1.8;
        const shaper = this.ctx!.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3.5); }
        shaper.curve = curve;
        const f = this.filter('lowpass', 1400, 2);
        f.frequency.setValueAtTime(500, t);
        f.frequency.linearRampToValueAtTime(1800, t + 0.35);
        f.frequency.exponentialRampToValueAtTime(220, t + dur);
        const g = this.gain();
        this.env(g.gain, t, 0.18, 0.55, dur);
        shaper.connect(f).connect(g).connect(o);
        const rv = this.gain(0.5); g.connect(rv).connect(this.reverbIn);
        // три глави — три гласа
        for (const base of [62, 83, 111]) {
          const s = this.osc('sawtooth', base * 0.8, t, t + dur + 0.2);
          s.frequency.linearRampToValueAtTime(base * 1.15, t + 0.3);
          s.frequency.exponentialRampToValueAtTime(base * 0.6, t + dur);
          const sg = this.gain(0.35);
          s.connect(sg).connect(shaper);
        }
        this.burst(o, t, 'lowpass', 1500, 1, 0.1, dur * 0.9, 0.35, 300);
        break;
      }
      case 'fire':
        this.burst(o, t, 'bandpass', 900, 0.6, 0.05, 0.6, 0.45, 300);
        for (let i = 0; i < 7; i++) this.burst(o, t + rnd(0, 0.5), 'highpass', rnd(2000, 5000), 1, 0.001, 0.02, rnd(0.2, 0.5));
        break;
      case 'bite':
        this.burst(o, t, 'highpass', 1800, 1, 0.002, 0.07, 0.6);
        this.burst(o, t + 0.05, 'bandpass', 1200, 2, 0.002, 0.06, 0.4);
        this.tone(o, 'sine', 120, t, 0.003, 0.1, 0.5, 60);
        break;
      case 'coin':
        this.tone(o, 'square', 1567, t, 0.002, 0.08, 0.12);
        this.tone(o, 'triangle', 2093, t + 0.06, 0.002, 0.3, 0.25, undefined, 0.3);
        break;
      case 'click':
        this.tone(o, 'sine', 1400, t, 0.001, 0.03, 0.25, 900);
        break;
      case 'page': {
        const s = this.noiseSrc(t, t + 0.4);
        const f = this.filter('bandpass', 3500, 0.8);
        f.frequency.setValueAtTime(2500, t);
        f.frequency.linearRampToValueAtTime(5000, t + 0.3);
        const g = this.gain();
        g.gain.setValueAtTime(0.0001, t);
        for (let i = 0; i < 5; i++) g.gain.linearRampToValueAtTime(i % 2 ? 0.08 : rnd(0.2, 0.35), t + 0.03 + i * 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
        s.connect(f).connect(g).connect(o);
        break;
      }
      case 'bubble':
        this.tone(o, 'sine', rnd(260, 360), t, 0.005, 0.09, 0.35, rnd(800, 1100));
        break;
      case 'death': {
        const notes = [4, 3, 1, 0, -3];
        notes.forEach((d, i) => this.tone(o, 'triangle', degFreq(D4 / 2, MODES.aeolian, d), t + i * 0.28, 0.02, 0.6, 0.3, undefined, 0.6));
        this.burst(o, t, 'lowpass', 400, 0.7, 0.3, 1.5, 0.2);
        break;
      }
      case 'victory': {
        const seq: [number, number][] = [[0, 0], [4, 0.14], [7, 0.28], [11, 0.42], [9, 0.62], [11, 0.76], [14, 0.9]];
        for (const [d, dt] of seq) {
          const f = degFreq(D4, MODES.mixolydian, d);
          this.tone(o, 'triangle', f, t + dt, 0.01, dt > 0.85 ? 1.4 : 0.3, 0.3, undefined, 0.5);
          this.tone(o, 'square', f, t + dt, 0.01, dt > 0.85 ? 0.8 : 0.15, 0.05);
        }
        this.drum(o, t, true); this.drum(o, t + 0.42, true); this.drum(o, t + 0.9, true);
        break;
      }
      case 'thunder': {
        this.burst(o, t, 'highpass', 1500, 0.7, 0.005, 0.25, 0.5);
        const s = this.noiseSrc(t, t + 3.8);
        const f = this.filter('lowpass', 500, 0.9);
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(120, t + 3.5);
        const g = this.gain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.9, t + 0.08);
        g.gain.linearRampToValueAtTime(0.5, t + 0.5);
        g.gain.linearRampToValueAtTime(0.7, t + 0.9);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
        s.connect(f).connect(g).connect(o);
        const rv = this.gain(0.4); g.connect(rv).connect(this.reverbIn);
        break;
      }
      case 'vote':
        this.tone(o, 'sine', 660, t, 0.003, 0.9, 0.35, undefined, 0.4);
        this.tone(o, 'sine', 1320 * 1.003, t, 0.003, 0.5, 0.15);
        this.tone(o, 'sine', 1980, t, 0.003, 0.25, 0.06);
        break;
    }
  }

  /** Тъпан: strong — бум (бухалката), иначе „цък“ (пръчката). */
  private drum(o: AudioNode, t: number, strong: boolean, vel = 1) {
    if (strong) {
      this.tone(o, 'sine', 105, t, 0.003, 0.28, 0.75 * vel, 48);
      this.burst(o, t, 'lowpass', 900, 0.8, 0.002, 0.06, 0.35 * vel);
    } else {
      this.burst(o, t, 'highpass', 2600, 0.9, 0.001, 0.05, 0.28 * vel);
      this.tone(o, 'triangle', 330, t, 0.001, 0.03, 0.08 * vel, 200);
    }
  }

  // ================= фонове =================

  ambient(kind: AmbientKind, on: boolean): void {
    if (kind === 'none') {
      // 'none' (с каквото и да е on) спира всички фонове
      for (const k of [...this.wantedAmbients]) this.ambient(k, false);
      return;
    }
    if (on) {
      if (this.wantedAmbients.has(kind)) return;
      this.wantedAmbients.add(kind);
      if (this.ctx) this.startAmbient(kind);
    } else {
      this.wantedAmbients.delete(kind);
      this.stopAmbient(kind);
    }
  }

  private loopNoise(h: AmbientHandle, chainEnd: (src: AudioNode) => AudioNode, level: number) {
    const t = this.ctx!.currentTime;
    const s = this.noiseSrc(t, 0, true);
    const g = this.gain(level);
    chainEnd(s).connect(g).connect(h.out);
    h.nodes.push(s);
    return g;
  }

  private lfo(h: AmbientHandle, freq: number, depth: number, target: AudioParam) {
    const t = this.ctx!.currentTime;
    const o = this.ctx!.createOscillator();
    o.frequency.value = freq;
    o.start(t);
    const g = this.gain(depth);
    o.connect(g).connect(target);
    h.nodes.push(o);
  }

  private startAmbient(kind: Exclude<AmbientKind, 'none'>) {
    if (!this.ctx || this.ambients.has(kind)) return;
    const t = this.ctx.currentTime;
    const out = this.gain(0);
    out.connect(this.ambBus);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(1, t + 2.5);
    const h: AmbientHandle = { out, nodes: [], nextEvent: t + rnd(0.3, 1.5) };
    switch (kind) {
      case 'day':
        // лек ветрец
        this.loopNoise(h, (s) => s.connect(this.filter('lowpass', 500)), 0.04);
        break;
      case 'night': {
        // щурци: висок тон, накъсван бързо
        const c = this.ctx.createOscillator();
        c.frequency.value = 4400;
        c.start(t);
        const cg = this.gain(0);
        const am = this.ctx.createOscillator();
        am.type = 'square';
        am.frequency.value = 28;
        am.start(t);
        const amg = this.gain(0.025);
        am.connect(amg).connect(cg.gain);
        const slow = this.ctx.createOscillator();     // групи от цвърчене
        slow.frequency.value = 0.7;
        slow.start(t);
        const sg = this.gain(0.02);
        slow.connect(sg).connect(cg.gain);
        c.connect(cg).connect(out);
        h.nodes.push(c, am, slow);
        this.loopNoise(h, (s) => s.connect(this.filter('lowpass', 300)), 0.025);
        break;
      }
      case 'forest': {
        const f = this.filter('bandpass', 500, 0.6);
        this.lfo(h, 0.11, 250, f.frequency);
        const g = this.loopNoise(h, (s) => s.connect(f), 0.22);
        this.lfo(h, 0.07, 0.1, g.gain);
        break;
      }
      case 'rain': {
        this.loopNoise(h, (s) => s.connect(this.filter('highpass', 900)).connect(this.filter('lowpass', 7000)), 0.16);
        this.loopNoise(h, (s) => s.connect(this.filter('lowpass', 400)), 0.08);
        break;
      }
      case 'storm': {
        this.loopNoise(h, (s) => s.connect(this.filter('highpass', 700)).connect(this.filter('lowpass', 8000)), 0.28);
        const f = this.filter('bandpass', 400, 0.5);
        this.lfo(h, 0.13, 220, f.frequency);
        const g = this.loopNoise(h, (s) => s.connect(f), 0.3);
        this.lfo(h, 0.09, 0.15, g.gain);
        h.nextEvent = t + rnd(2, 6);
        break;
      }
      case 'festival': {
        // глъчка от хора на мегдана
        const f = this.filter('bandpass', 550, 1.4);
        this.lfo(h, 0.4, 120, f.frequency);
        const g = this.loopNoise(h, (s) => s.connect(f), 0.12);
        this.lfo(h, 0.23, 0.04, g.gain);
        break;
      }
      case 'river': {
        this.loopNoise(h, (s) => s.connect(this.filter('lowpass', 900)), 0.12);
        const f = this.filter('bandpass', 1400, 3);
        this.lfo(h, 0.9, 500, f.frequency);
        this.loopNoise(h, (s) => s.connect(f), 0.07);
        break;
      }
    }
    this.ambients.set(kind, h);
  }

  private stopAmbient(kind: Exclude<AmbientKind, 'none'>) {
    const h = this.ambients.get(kind);
    if (!h || !this.ctx) return;
    this.ambients.delete(kind);
    const t = this.ctx.currentTime;
    h.out.gain.cancelScheduledValues(t);
    h.out.gain.setValueAtTime(h.out.gain.value, t);
    h.out.gain.linearRampToValueAtTime(0.0001, t + 2);
    for (const n of h.nodes) try { n.stop(t + 2.1); } catch { /* */ }
    setTimeout(() => { try { h.out.disconnect(); } catch { /* */ } }, 2300);
  }

  /** Случайните звуци във фоновете: птици, бухал, гръмотевици, капки. */
  private ambientEvents(now: number) {
    for (const [kind, h] of this.ambients) {
      if (now < h.nextEvent) continue;
      const t = Math.max(now, h.nextEvent) + 0.02;
      const o = h.out;
      switch (kind) {
        case 'day': this.bird(o, t); h.nextEvent = t + rnd(0.4, 2.8); break;
        case 'forest': if (Math.random() < 0.4) this.bird(o, t, 0.5); else this.creak(o, t); h.nextEvent = t + rnd(3, 9); break;
        case 'night': this.owl(o, t); h.nextEvent = t + rnd(9, 22); break;
        case 'rain': this.burst(o, t, 'bandpass', rnd(2000, 4000), 6, 0.001, 0.03, 0.15); h.nextEvent = t + rnd(0.1, 0.6); break;
        case 'storm': this.play('thunder', { volume: rnd(0.5, 1), pan: rnd(-0.6, 0.6) }); h.nextEvent = t + rnd(7, 20); break;
        case 'festival': this.claps(o, t); h.nextEvent = t + rnd(4, 10); break;
        case 'river': this.tone(o, 'sine', rnd(500, 900), t, 0.005, 0.06, 0.05, rnd(1000, 1600)); h.nextEvent = t + rnd(0.3, 1.5); break;
      }
    }
  }

  private bird(o: AudioNode, t: number, vol = 1) {
    const n = 2 + Math.floor(Math.random() * 5);
    const base = rnd(2600, 4200);
    const pan = this.ctx!.createStereoPanner();
    let dest: AudioNode = o;
    if (pan) { pan.pan.value = rnd(-0.8, 0.8); pan.connect(o); dest = pan; }
    for (let i = 0; i < n; i++) {
      const tt = t + i * rnd(0.07, 0.13);
      const up = Math.random() < 0.5;
      this.tone(dest, 'sine', base * (up ? 0.8 : 1.2), tt, 0.005, rnd(0.04, 0.08), 0.11 * vol, base * (up ? 1.25 : 0.75));
    }
  }

  private owl(o: AudioNode, t: number) {
    // „ху-хууу“
    for (const [dt, len, f] of [[0, 0.25, 390], [0.45, 0.6, 370]] as const) {
      const s = this.osc('sine', f, t + dt, t + dt + len + 0.1);
      s.frequency.linearRampToValueAtTime(f * 0.92, t + dt + len);
      const g = this.gain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.linearRampToValueAtTime(0.09, t + dt + 0.06);
      g.gain.linearRampToValueAtTime(0.06, t + dt + len * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + len);
      s.connect(g).connect(o);
      const rv = this.gain(0.5); g.connect(rv).connect(this.reverbIn);
    }
  }

  private creak(o: AudioNode, t: number) {
    const s = this.osc('sawtooth', rnd(140, 220), t, t + 0.8);
    s.frequency.linearRampToValueAtTime(rnd(90, 160), t + 0.7);
    const f = this.filter('bandpass', 900, 8);
    const g = this.gain();
    this.env(g.gain, t, 0.15, 0.025, 0.55);
    s.connect(f).connect(g).connect(o);
  }

  private claps(o: AudioNode, t: number) {
    const n = 4 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) this.burst(o, t + i * 0.28 + rnd(-0.02, 0.02), 'bandpass', rnd(1200, 1800), 1.2, 0.001, 0.05, 0.12);
  }

  // ================= музика =================

  setMusic(kind: MusicKind): void {
    if (kind === this.wantedMusic && (this.track?.kind === kind || kind === 'none')) return;
    this.wantedMusic = kind;
    if (!this.ctx) return;
    this.stopMusic();
    if (kind !== 'none') this.startMusic(kind);
  }

  private stopMusic() {
    const tr = this.track;
    if (!tr || !this.ctx) return;
    this.track = null;
    const t = this.ctx.currentTime;
    tr.out.gain.cancelScheduledValues(t);
    tr.out.gain.setValueAtTime(tr.out.gain.value, t);
    tr.out.gain.linearRampToValueAtTime(0.0001, t + 1.5);
    for (const n of tr.persistent) try { n.stop(t + 1.6); } catch { /* */ }
    setTimeout(() => { try { tr.out.disconnect(); } catch { /* */ } }, 3500);
  }

  private startMusic(kind: MusicKind) {
    if (!this.ctx || kind === 'none') return;
    const t = this.ctx.currentTime;
    const out = this.gain(0);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(1, t + 2);
    out.connect(this.musicBus);
    const tr: Track = { kind, out, persistent: [], next: t + 0.3, step: 0, phrase: [], durs: [], pos: 0, deg: 0 };
    // бурдон (гайда): нисък тон, леко „биещ“
    const droneRoot = kind === 'night' ? D4 / 4 : D4 / 2;
    const droneLevel = kind === 'battle' ? 0.05 : kind === 'night' ? 0.035 : kind === 'festival' ? 0.06 : 0.045;
    const df = this.filter('lowpass', kind === 'festival' ? 900 : 550, 1.2);
    const dg = this.gain(droneLevel);
    df.connect(dg).connect(out);
    for (const det of [1, 1.004]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = droneRoot * det;
      o.start(t);
      o.connect(df);
      tr.persistent.push(o);
    }
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    lfo.start(t);
    const lg = this.gain(150);
    lfo.connect(lg).connect(df.frequency);
    tr.persistent.push(lfo);
    if (kind === 'festival') {
      // втори бурдон в квинта — по-пълен звук
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = droneRoot * 1.5;
      o.start(t);
      const g = this.gain(0.4);
      o.connect(g).connect(df);
      tr.persistent.push(o);
    }
    this.track = tr;
  }

  /** Кавал: триъгълник + октава, вибрато, дъх. */
  private kaval(o: AudioNode, t: number, f: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const end = t + dur;
    const a = Math.min(0.09, dur * 0.3);
    const g = this.gain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3 * vel, t + a);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);
    const lp = this.filter('lowpass', 2600, 0.5);
    g.connect(lp).connect(o);
    const rv = this.gain(0.6); lp.connect(rv).connect(this.reverbIn);
    const o1 = this.osc('triangle', f, t, end + 0.15);
    const o2 = this.osc('sine', f * 2, t, end + 0.15);
    const o2g = this.gain(0.18);
    o1.connect(g);
    o2.connect(o2g).connect(g);
    if (dur > 0.35) {
      // вибратото идва след началото на тона
      const v = ctx.createOscillator();
      v.frequency.value = rnd(5, 6);
      v.start(t);
      v.stop(end + 0.15);
      const vg = this.gain(0);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.5, dur * 0.6));
      v.connect(vg);
      vg.connect(o1.frequency);
      vg.connect(o2.frequency);
    }
    // дъх — в началото на всеки тон, малко и по време на тона
    const n = this.noiseSrc(t, end + 0.1);
    const bf = this.filter('bandpass', Math.min(8000, f * 3), 1.5);
    const bg = this.gain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(0.08 * vel, t + 0.03);
    bg.gain.linearRampToValueAtTime(0.02 * vel, t + 0.12);
    bg.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
    n.connect(bf).connect(bg).connect(o);
  }

  /** Гайда: тръстиков тон (трион през лентов филтър), с бърз „удар“ отгоре по желание. */
  private gaida(o: AudioNode, t: number, f: number, dur: number, vel: number, grace?: number) {
    const end = t + dur;
    const g = this.gain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1 * vel, t + 0.012);
    g.gain.setValueAtTime(0.1 * vel, end - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.03);
    const bp = this.filter('bandpass', 1300, 0.6);
    const lp = this.filter('lowpass', 3200, 0.7);
    g.connect(bp).connect(lp).connect(o);
    const rv = this.gain(0.25); lp.connect(rv).connect(this.reverbIn);
    const s = this.osc('sawtooth', f, t, end + 0.05);
    const sq = this.osc('square', f * 1.002, t, end + 0.05);
    const sqg = this.gain(0.3);
    s.connect(g);
    sq.connect(sqg).connect(g);
    if (grace) {
      s.frequency.setValueAtTime(grace, t);
      s.frequency.setValueAtTime(f, t + 0.035);
      sq.frequency.setValueAtTime(grace * 1.002, t);
      sq.frequency.setValueAtTime(f * 1.002, t + 0.035);
    }
  }

  /** Нова мелодична фраза: случайно ходене по степените, завършва на основния тон или квинтата. */
  private newPhrase(tr: Track, len: number, rhythms: number[][], range: [number, number], endOn: number[]) {
    const r = pick(rhythms);
    const phrase: number[] = [];
    let d = tr.deg;
    for (let i = 0; i < r.length; i++) {
      const last = i === r.length - 1;
      if (last) d = pick(endOn);
      else {
        const stepChoices = [-2, -1, -1, 0, 1, 1, 2, 3];
        d = Math.max(range[0], Math.min(range[1], d + pick(stepChoices)));
      }
      phrase.push(d);
    }
    tr.deg = phrase[phrase.length - 1];
    tr.phrase = phrase.slice(0, len || phrase.length);
    tr.durs = r;
    tr.pos = 0;
  }

  /** Планировчикът: вика се на 60 ms, планира ноти до 0.35 s напред. */
  private pump() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.ambientEvents(now);
    const tr = this.track;
    if (!tr) return;
    if (tr.next < now) tr.next = now + 0.05;       // след пауза/скрит раздел — не наваксваме
    const horizon = now + 0.35;
    let guard = 0;
    while (tr.next < horizon && guard++ < 32) {
      switch (tr.kind) {
        case 'village': this.stepVillage(tr); break;
        case 'night': this.stepNight(tr); break;
        case 'festival': this.stepFestival(tr); break;
        case 'battle': this.stepBattle(tr); break;
        default: return;
      }
    }
  }

  private stepVillage(tr: Track) {
    const beat = 0.5;
    if (tr.pos >= tr.phrase.length) {
      // пауза между фразите
      if (tr.phrase.length && Math.random() < 0.6) { tr.phrase = []; tr.next += beat * pick([1, 2, 2, 3]); return; }
      this.newPhrase(tr, 0, [[1, 0.5, 0.5, 1, 1, 2], [0.5, 0.5, 1, 0.5, 0.5, 1, 3], [1.5, 0.5, 1, 1, 0.5, 0.5, 2], [0.5, 0.5, 0.5, 0.5, 1, 1, 1, 2]], [-1, 9], [0, 0, 4, 2]);
    }
    const d = tr.phrase[tr.pos];
    const len = tr.durs[tr.pos] * beat;
    this.kaval(tr.out, tr.next, degFreq(D4 * 2, MODES.dorian, d), len * 0.95, tr.pos === 0 ? 1 : rnd(0.75, 0.95));
    tr.next += len;
    tr.pos++;
  }

  private stepNight(tr: Track) {
    const beat = 0.8;
    if (tr.pos >= tr.phrase.length) {
      if (tr.phrase.length) { tr.phrase = []; tr.next += beat * pick([2, 3, 4, 5]); return; }
      this.newPhrase(tr, 0, [[1, 1, 2, 3], [2, 1, 1, 4], [1, 0.5, 0.5, 2, 3], [3, 1, 3]], [-3, 5], [0, -3, 2]);
    }
    const d = tr.phrase[tr.pos];
    const len = tr.durs[tr.pos] * beat;
    this.kaval(tr.out, tr.next, degFreq(D4, MODES.aeolian, d), len * 0.97, rnd(0.55, 0.75));
    tr.next += len;
    tr.pos++;
  }

  /** Ръченица 7/8: 2+2+3 осмини, тъпан + гайда. */
  private stepFestival(tr: Track) {
    const e = 0.125;                       // една осмина
    const pulse = tr.step % 7;             // 0..6 в такта
    const t = tr.next;
    // тъпан: бум на 0, цък на 2 (второто 2), бум на 4 (началото на 3-те), цък на 6
    if (pulse === 0) this.drum(tr.out, t, true, 1);
    else if (pulse === 4) this.drum(tr.out, t, true, 0.7);
    else if (pulse === 2 || pulse === 6) this.drum(tr.out, t, false, 0.9);
    else if (Math.random() < 0.3) this.drum(tr.out, t, false, 0.4);
    // мелодия: нова фраза на всеки 2 такта
    if (tr.step % 14 === 0) {
      const motif: number[] = [];
      let d = tr.deg;
      for (let i = 0; i < 14; i++) {
        if (i === 13) d = pick([0, 4, 7]);
        else d = Math.max(-1, Math.min(9, d + pick([-1, -1, 1, 1, 0, 2, -2])));
        motif.push(d);
      }
      tr.deg = motif[13];
      tr.phrase = motif;
    }
    // групите: на началото на всяка група — по-дълъг тон; понякога всяка осмина
    const groupStart = pulse === 0 || pulse === 2 || pulse === 4;
    const groupLen = pulse === 4 ? 3 : 2;
    const d = tr.phrase[tr.step % 14] ?? 0;
    if (groupStart && Math.random() < 0.45) {
      const f = degFreq(D4, MODES.mixolydian, d + 7);
      this.gaida(tr.out, t, f, e * groupLen * 0.95, 1, degFreq(D4, MODES.mixolydian, d + 8));
      tr.step += groupLen;
      tr.next += e * groupLen;
      return;
    }
    this.gaida(tr.out, t, degFreq(D4, MODES.mixolydian, d + 7), e * 0.9, groupStart ? 1 : 0.8);
    tr.step++;
    tr.next += e;
  }

  /** Бой: остинато в хиджаз (основен тон, малка секунда) + тъпан. */
  private stepBattle(tr: Track) {
    const s = 0.12;                        // шестнайсетина
    const t = tr.next;
    const i = tr.step % 16;
    const pattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 4, 0, 3, 0, 1, 0];
    const bar = Math.floor(tr.step / 16) % 4;
    const shift = bar === 3 ? 1 : 0;       // на всеки 4-ти такт — нагоре с полутон (напрежение)
    const f = degFreq(D4 / 4, MODES.hijaz, pattern[i] + shift);
    const g = this.gain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(i % 4 === 0 ? 0.16 : 0.1, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + s * 0.9);
    const lp = this.filter('lowpass', i % 4 === 0 ? 1400 : 900, 3);
    g.connect(lp).connect(tr.out);
    const o = this.osc('sawtooth', f, t, t + s);
    const o2 = this.osc('sawtooth', f * 2.005, t, t + s);
    const o2g = this.gain(0.35);
    o.connect(g); o2.connect(o2g).connect(g);
    if (i === 0 || i === 6 || i === 10) this.drum(tr.out, t, true, i === 0 ? 1 : 0.6);
    else if (i % 4 === 2) this.drum(tr.out, t, false, 0.5);
    // висок кавален вик на всеки 2 такта
    if (i === 0 && tr.step % 32 === 0) {
      const d = pick([4, 5, 7]);
      this.kaval(tr.out, t, degFreq(D4 * 2, MODES.hijaz, d), s * 7, 0.7);
      this.kaval(tr.out, t + s * 8, degFreq(D4 * 2, MODES.hijaz, d - 1), s * 6, 0.6);
    }
    tr.step++;
    tr.next += s;
  }
}

/** Един общ звук за цялата игра. */
export const audio = new Audio();
export { Audio as GameAudio };
