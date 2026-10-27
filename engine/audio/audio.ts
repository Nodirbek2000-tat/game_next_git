import { rnd, rndi } from "../math";
import type { AudioApi } from "../types";

interface Hum {
  g: GainNode;
  f: BiquadFilterNode;
  o1: OscillatorNode;
  o2: OscillatorNode;
}
interface Eng {
  g: GainNode;
  f: BiquadFilterNode;
  o1: OscillatorNode;
  o2: OscillatorNode;
  o3: OscillatorNode;
}
interface Amb {
  s: AudioBufferSourceNode;
  g: GainNode;
  lfo: OscillatorNode;
}

export interface AudioOptions {
  /** live getters so the settings page can toggle sound while a game runs */
  sound: () => boolean;
  music: () => boolean;
}

/**
 * Synthesised sound effects and a step-sequencer music loop (ported from the prototype).
 * Everything is generated with the Web Audio API — nothing is downloaded. The AudioContext is created on
 * the first user gesture (`unlock()`), as browsers require.
 */
export class AudioEngine implements AudioApi {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last: Record<string, number> = {};
  private hum: Hum | null = null;
  private eng: Eng | null = null;
  private amb: Amb | null = null;
  // music
  private timer: ReturnType<typeof setInterval> | null = null;
  private bpm = 120;
  private step = 0;
  private nextT = 0;
  private startAt = 0;
  private style: "drive" | "calm" = "drive";
  private static PROG = [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
  ];

  constructor(private opts: AudioOptions) {}

  get ready(): boolean {
    return !!this.ac && this.ac.state === "running";
  }

  get musicOn(): boolean {
    return this.timer !== null;
  }

  /** Create / resume the context. Call from a user gesture. */
  unlock(): void {
    if (this.ac) {
      void this.ac.resume?.();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new Ctor();
      this.ac = ac;
      this.master = ac.createGain();
      this.master.gain.value = this.opts.sound() ? 0.55 : 0;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(ac.destination);
      this.musicBus = ac.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      this.noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      console.warn("audio", e);
    }
  }

  /** Re-apply sound setting to the master gain. */
  refresh(): void {
    if (this.master) this.master.gain.value = this.opts.sound() ? 0.55 : 0;
    if (!this.opts.music()) this.musicStop();
  }

  dispose(): void {
    this.musicStop();
    this.humStop();
    this.engineStop();
    this.ambStop();
    void this.ac?.close().catch(() => undefined);
    this.ac = null;
  }

  private ok(name: string, gap: number): boolean {
    if (!this.ac || !this.opts.sound()) return false;
    const t = performance.now();
    if (this.last[name] && t - this.last[name] < gap) return false;
    this.last[name] = t;
    return true;
  }

  tone(f1: number, f2: number, dur: number, type: OscillatorType = "sine", vol = 0.2, delay = 0, out?: AudioNode): void {
    const ac = this.ac;
    if (!ac || !this.master) return;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out ?? this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private nz(dur: number, vol: number, f1: number, f2: number, q = 1, type: BiquadFilterType = "bandpass", delay = 0, out?: AudioNode): void {
    const ac = this.ac;
    if (!ac || !this.master || !this.noise) return;
    const t0 = ac.currentTime + delay;
    const s = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    s.buffer = this.noise;
    s.loop = true;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f1, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(out ?? this.master);
    s.start(t0, Math.random());
    s.stop(t0 + dur + 0.05);
  }

  slice(): void {
    if (this.ok("slice", 60)) this.nz(0.14, 0.35, 2500, 9000, 1.2, "highpass");
  }
  splat(): void {
    if (this.ok("splat", 40)) {
      this.nz(0.18, 0.45, 900, 200, 1, "lowpass");
      this.tone(320, 90, 0.12, "sine", 0.25);
    }
  }
  whoosh(v = 0.25): void {
    if (this.ok("whoosh", 120)) this.nz(0.28, v, 300, 2600, 0.8);
  }
  punch(): void {
    if (this.ok("punch", 50)) {
      this.tone(150, 45, 0.22, "sine", 0.8);
      this.nz(0.08, 0.5, 2000, 400, 1, "lowpass");
    }
  }
  boom(big = false): void {
    if (this.ok("boom", 120)) {
      this.tone(110, 25, big ? 1.3 : 0.7, "sine", 0.9);
      this.nz(big ? 1.1 : 0.6, 0.6, 1500, 50, 0.7, "lowpass");
    }
  }
  clash(): void {
    if (this.ok("clash", 60)) {
      [1800, 2450, 3100].forEach((f, i) => this.tone(f, f * 0.7, 0.35, "square", 0.06, i * 0.004));
      this.nz(0.2, 0.3, 6000, 1500, 2);
    }
  }
  pew(): void {
    if (this.ok("pew", 50)) this.tone(1500, 180, 0.16, "square", 0.12);
  }
  laser(): void {
    if (this.ok("laser", 70)) this.tone(900, 300, 0.25, "sawtooth", 0.06);
  }
  zap(): void {
    if (this.ok("zap", 80)) {
      this.nz(0.12, 0.3, 5000, 700, 3);
      this.tone(1300, 150, 0.12, "sawtooth", 0.05);
    }
  }
  coin(): void {
    if (this.ok("coin", 50)) {
      this.tone(988, 0, 0.08, "square", 0.1);
      this.tone(1319, 0, 0.25, "square", 0.1, 0.07);
    }
  }
  hurt(): void {
    if (this.ok("hurt", 200)) {
      this.tone(320, 70, 0.45, "sawtooth", 0.25);
      this.nz(0.3, 0.3, 800, 100, 1, "lowpass");
    }
  }
  beep(hi = false): void {
    if (this.ok("beep" + hi, 100)) this.tone(hi ? 1320 : 660, 0, hi ? 0.45 : 0.18, "triangle", 0.3);
  }
  good(): void {
    if (this.ok("good", 60)) {
      this.tone(660, 0, 0.12, "triangle", 0.18);
      this.tone(990, 0, 0.2, "triangle", 0.16, 0.06);
    }
  }
  bad(): void {
    if (this.ok("bad", 120)) this.tone(200, 120, 0.25, "square", 0.12);
  }
  combo(n: number): void {
    if (!this.ok("combo", 200)) return;
    const base = [523, 659, 784, 1047, 1319];
    for (let i = 0; i < Math.min(5, n); i++) this.tone(base[i], 0, 0.2, "triangle", 0.14, i * 0.06);
  }
  win(): void {
    if (!this.ok("win", 500)) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0, 0.5, "triangle", 0.18, i * 0.12));
  }
  lose(): void {
    if (!this.ok("lose", 500)) return;
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0, 0.45, "sawtooth", 0.08, i * 0.16));
  }
  click(): void {
    if (this.ok("click", 35)) this.tone(2400, 1800, 0.025, "square", 0.05);
  }
  plop(): void {
    if (this.ok("plop", 80)) {
      this.tone(700, 180, 0.12, "sine", 0.25);
      this.nz(0.1, 0.2, 1200, 400, 1, "bandpass");
    }
  }
  splash(big = false): void {
    if (this.ok("splash", 100)) {
      this.nz(big ? 0.7 : 0.35, big ? 0.5 : 0.3, 2500, 300, 0.7, "lowpass");
      this.tone(400, 120, 0.2, "sine", 0.15);
    }
  }
  strain(v: number): void {
    if (this.ok("strain", 260)) this.tone(900 + v * 900, 1100 + v * 900, 0.2, "sawtooth", 0.03 + v * 0.03);
  }
  crash(): void {
    if (this.ok("crash", 300)) {
      this.nz(0.8, 0.7, 3000, 200, 0.6, "lowpass");
      this.tone(90, 30, 0.6, "sine", 0.7);
      [1300, 1700, 2300].forEach((f, i) => this.tone(f, f * 0.8, 0.25, "square", 0.04, 0.03 + i * 0.02));
    }
  }
  horn(): void {
    if (this.ok("horn", 600)) {
      this.tone(415, 0, 0.45, "square", 0.08);
      this.tone(523, 0, 0.45, "square", 0.06);
    }
  }
  screech(v: number): void {
    if (this.ok("screech", 150)) this.nz(0.18, 0.08 * v, 3500, 2500, 6, "bandpass");
  }
  bird(): void {
    if (!this.ok("bird", 900)) return;
    const f = rnd(2200, 3600);
    const n = rndi(2, 4);
    for (let i = 0; i < n; i++) this.tone(f, f * rnd(1.1, 1.4), 0.09, "sine", 0.04, i * 0.13);
  }

  // ---- continuous voices ----
  humStart(): void {
    const ac = this.ac;
    if (!ac || !this.master || this.hum) return;
    const g = ac.createGain();
    const f = ac.createBiquadFilter();
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = 92;
    o2.type = "sawtooth";
    o2.frequency.value = 94.5;
    f.type = "lowpass";
    f.frequency.value = 420;
    f.Q.value = 4;
    g.gain.value = 0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.master);
    o1.start();
    o2.start();
    this.hum = { g, f, o1, o2 };
  }
  humSet(level: number, swing: number): void {
    if (!this.hum || !this.ac) return;
    const t = this.ac.currentTime;
    this.hum.g.gain.setTargetAtTime(this.opts.sound() ? level * 0.09 : 0, t, 0.05);
    this.hum.f.frequency.setTargetAtTime(380 + swing * 1400, t, 0.04);
    this.hum.o1.frequency.setTargetAtTime(92 + swing * 40, t, 0.05);
    this.hum.o2.frequency.setTargetAtTime(94.5 + swing * 44, t, 0.05);
  }
  humStop(): void {
    if (!this.hum || !this.ac) return;
    const h = this.hum;
    this.hum = null;
    try {
      h.g.gain.setTargetAtTime(0, this.ac.currentTime, 0.05);
      setTimeout(() => {
        h.o1.stop();
        h.o2.stop();
      }, 300);
    } catch {
      /* already stopped */
    }
  }
  engineStart(): void {
    const ac = this.ac;
    if (!ac || !this.master || this.eng) return;
    const g = ac.createGain();
    const f = ac.createBiquadFilter();
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    const o3 = ac.createOscillator();
    o1.type = "sawtooth";
    o2.type = "square";
    o3.type = "sawtooth";
    f.type = "lowpass";
    f.frequency.value = 500;
    f.Q.value = 2;
    g.gain.value = 0;
    for (const o of [o1, o2, o3]) {
      o.connect(f);
      o.start();
    }
    f.connect(g).connect(this.master);
    this.eng = { g, f, o1, o2, o3 };
  }
  engineSet(rpm: number, load: number): void {
    if (!this.eng || !this.ac) return;
    const t = this.ac.currentTime;
    const base = 38 + rpm * 120;
    this.eng.o1.frequency.setTargetAtTime(base, t, 0.06);
    this.eng.o2.frequency.setTargetAtTime(base / 2, t, 0.06);
    this.eng.o3.frequency.setTargetAtTime(base * 1.01, t, 0.06);
    this.eng.f.frequency.setTargetAtTime(300 + rpm * 900 + load * 700, t, 0.08);
    this.eng.g.gain.setTargetAtTime(this.opts.sound() ? 0.05 + load * 0.07 + rpm * 0.03 : 0, t, 0.08);
  }
  engineStop(): void {
    if (!this.eng || !this.ac) return;
    const e = this.eng;
    this.eng = null;
    try {
      e.g.gain.setTargetAtTime(0, this.ac.currentTime, 0.05);
      setTimeout(() => {
        e.o1.stop();
        e.o2.stop();
        e.o3.stop();
      }, 300);
    } catch {
      /* already stopped */
    }
  }
  ambStart(kind: "water" | "wind"): void {
    const ac = this.ac;
    if (!ac || !this.master || !this.noise || this.amb) return;
    const s = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    const lfo = ac.createOscillator();
    const lg = ac.createGain();
    s.buffer = this.noise;
    s.loop = true;
    f.type = kind === "water" ? "lowpass" : "bandpass";
    f.frequency.value = kind === "water" ? 520 : 900;
    g.gain.value = this.opts.sound() ? 0.05 : 0;
    lfo.frequency.value = 0.18;
    lg.gain.value = 0.025;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
    s.connect(f).connect(g).connect(this.master);
    s.start();
    this.amb = { s, g, lfo };
  }
  ambStop(): void {
    if (!this.amb) return;
    try {
      this.amb.s.stop();
      this.amb.lfo.stop();
    } catch {
      /* already stopped */
    }
    this.amb = null;
  }

  // ---- music: step sequencer ----
  musicStart(bpm = 120, style: "drive" | "calm" = "drive"): number {
    if (!this.ac || !this.opts.music()) return 0;
    this.musicStop();
    this.bpm = bpm;
    this.style = style;
    this.step = 0;
    this.startAt = this.nextT = this.ac.currentTime + 0.1;
    this.timer = setInterval(() => this.musicTick(), 25);
    this.musicTick();
    return this.startAt;
  }
  musicStop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private musicTick(): void {
    const ac = this.ac;
    if (!ac) return;
    const sp = 60 / this.bpm / 4;
    while (this.nextT < ac.currentTime + 0.14) {
      this.playStep(this.step, this.nextT);
      this.nextT += sp;
      this.step++;
    }
  }
  private static hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
  private playStep(s: number, t: number): void {
    const ac = this.ac;
    const out = this.musicBus;
    if (!ac || !out) return;
    const b = s % 16;
    const bar = Math.floor(s / 16);
    const chord = AudioEngine.PROG[bar % 4];
    const hz = AudioEngine.hz;
    const env = (node: GainNode, vol: number, dur: number, d?: number): void => {
      node.gain.setValueAtTime(0.0001, t);
      node.gain.exponentialRampToValueAtTime(vol, t + (d || 0.005));
      node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    };
    const delay = t - ac.currentTime;
    if (b % 4 === 0 || (this.style === "drive" && b === 14 && bar % 2)) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
      env(g, 0.9, 0.28);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    }
    if (b === 4 || b === 12) this.nz(0.18, 0.55, 2000, 900, 0.9, "bandpass", delay, out);
    if (b % 2 === 0) this.nz(0.04, b % 4 === 2 ? 0.22 : 0.1, 8000, 7000, 1, "highpass", delay, out);
    if (b % 4 === 0 || (b % 4 === 3 && this.style === "drive")) {
      const o = ac.createOscillator();
      const f = ac.createBiquadFilter();
      const g = ac.createGain();
      o.type = "sawtooth";
      o.frequency.value = hz(chord[0] - 24);
      f.type = "lowpass";
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(160, t + 0.2);
      env(g, 0.35, 0.24);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    }
    if (this.style !== "calm" ? b % 2 === 0 : b % 4 === 0) {
      const n = chord[((b / 2 + bar) % 3) | 0] + 12 + (b === 14 ? 12 : 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "square";
      o.frequency.value = hz(n);
      env(g, 0.07, 0.16);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.2);
    }
    if (b === 0) {
      chord.forEach((n) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = "triangle";
        o.frequency.value = hz(n);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (60 / this.bpm) * 4);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + (60 / this.bpm) * 4 + 0.1);
      });
    }
  }
}
