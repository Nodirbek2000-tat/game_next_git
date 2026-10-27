// Game-local sound: wind, rain, line strain, reel clicks, the partner warning. Everything is synthesised with Web Audio
// (there are no sound files yet). `samples` are the hooks for real recordings: when assets.json marks a sound as present it
// is decoded and played instead of the synthesised version. Shared effects (splash, birds, water ambience) use engine.audio.

import type { EngineApi } from "@/engine";
import { useSettings } from "@/engine/settings/store";
import type { AssetLib } from "./assets";

type SampleName = "birds" | "water" | "reel" | "strain" | "splash" | "rain" | "wind";
const SAMPLE_NAMES: SampleName[] = ["birds", "water", "reel", "strain", "splash", "rain", "wind"];

export class GameSfx {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { g: GainNode; f: BiquadFilterNode } | null = null;
  private rain: { g: GainNode } | null = null;
  private whine: { o: OscillatorNode; g: GainNode } | null = null;
  private lastTick = 0;
  private lastWarn = 0;
  private samples: Partial<Record<SampleName, AudioBuffer>> = {};
  private loading = false;
  /** number of times a partner warning was spoken / played (tests) */
  warnings = 0;
  lastWarning = "";

  constructor(
    private engine: EngineApi,
    private assets: AssetLib,
  ) {}

  private on(): boolean {
    try {
      return useSettings.getState().sound;
    } catch {
      return true;
    }
  }

  /** Create / resume the context (call every now and then; browsers need a user gesture first). */
  ensure(): boolean {
    try {
      if (!this.ac) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        const ac = new Ctor();
        this.ac = ac;
        this.master = ac.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(ac.destination);
        this.noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ac.state === "suspended") void this.ac.resume().catch(() => undefined);
      if (this.master) this.master.gain.value = this.on() ? 0.5 : 0;
      if (this.ac.state === "running" && !this.loading) {
        this.loading = true;
        for (const n of SAMPLE_NAMES) void this.assets.sound(this.ac, n).then((b) => b && (this.samples[n] = b));
      }
      return this.ac.state === "running";
    } catch {
      return false;
    }
  }

  private src(loop: boolean): AudioBufferSourceNode | null {
    if (!this.ac || !this.noise) return null;
    const s = this.ac.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  playSample(name: SampleName, vol = 0.6): boolean {
    const b = this.samples[name];
    if (!b || !this.ac || !this.master || !this.on()) return false;
    const s = this.ac.createBufferSource();
    const g = this.ac.createGain();
    g.gain.value = vol;
    s.buffer = b;
    s.connect(g).connect(this.master);
    s.start();
    return true;
  }

  startAmbience(windLevel: number, rain: boolean): void {
    if (!this.ensure() || !this.ac || !this.master) return;
    const ac = this.ac;
    if (!this.wind) {
      const s = this.src(true);
      if (s) {
        const f = ac.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 420;
        f.Q.value = 0.6;
        const g = ac.createGain();
        g.gain.value = 0.02 + windLevel * 0.07;
        s.connect(f).connect(g).connect(this.master);
        s.start();
        this.wind = { g, f };
      }
    }
    if (rain && !this.rain) {
      const s = this.src(true);
      if (s) {
        const f = ac.createBiquadFilter();
        f.type = "highpass";
        f.frequency.value = 2200;
        const g = ac.createGain();
        g.gain.value = 0.07;
        s.connect(f).connect(g).connect(this.master);
        s.start();
        this.rain = { g };
      }
    }
  }

  /** Slowly moving wind gusts; call each frame with the time. */
  update(t: number, windLevel: number): void {
    if (this.wind && this.ac) {
      const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1);
      this.wind.g.gain.setTargetAtTime((0.015 + windLevel * 0.06) * (0.6 + gust * 0.8) * (this.on() ? 1 : 0), this.ac.currentTime, 0.3);
      this.wind.f.frequency.setTargetAtTime(300 + gust * 400, this.ac.currentTime, 0.4);
    }
  }

  /** Line strain: a thin rising whine that only appears above ~60 % strain. */
  setStrain(v: number): void {
    if (!this.ac || !this.master) return;
    const level = Math.max(0, (v - 0.6) / 0.5);
    if (!this.whine) {
      if (level <= 0) return;
      const o = this.ac.createOscillator();
      o.type = "triangle";
      const g = this.ac.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.master);
      o.start();
      this.whine = { o, g };
    }
    this.whine.o.frequency.setTargetAtTime(700 + level * 900, this.ac.currentTime, 0.05);
    this.whine.g.gain.setTargetAtTime(this.on() ? level * 0.05 : 0, this.ac.currentTime, 0.06);
  }

  /** Ratchet click of the reel, rate 0..~2.6 circles / s. */
  reelTick(): void {
    const now = performance.now();
    if (now - this.lastTick < 60) return;
    this.lastTick = now;
    if (this.playSample("reel", 0.4)) return;
    this.engine.audio.click();
    if (this.ac && this.master && this.noise && this.on()) {
      const s = this.src(false);
      if (!s) return;
      const f = this.ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 3200;
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.07, this.ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ac.currentTime + 0.035);
      s.connect(f).connect(g).connect(this.master);
      s.start(0, Math.random(), 0.04);
    }
  }

  splash(big = false): void {
    if (!this.playSample("splash", big ? 0.7 : 0.4)) this.engine.audio.splash(big);
  }

  /** "Ehtiyot bo‘l!" — voice (if the browser has speech synthesis) plus a short alarm. Rate limited. */
  warn(text = "Ehtiyot bo‘l!"): void {
    const now = performance.now();
    if (now - this.lastWarn < 2500) return;
    this.lastWarn = now;
    this.warnings++;
    this.lastWarning = text;
    this.engine.audio.tone(880, 880, 0.12, "square", 0.08);
    this.engine.audio.tone(660, 660, 0.12, "square", 0.08, 0.16);
    if (!this.on()) return;
    try {
      const synth = window.speechSynthesis;
      if (synth && typeof SpeechSynthesisUtterance !== "undefined") {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "uz-UZ";
        u.rate = 1.1;
        u.volume = 0.9;
        synth.cancel();
        synth.speak(u);
      }
    } catch {
      /* no speech: the alarm tones and the on-screen text remain */
    }
  }

  dispose(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    try {
      this.whine?.o.stop();
    } catch {
      /* ignore */
    }
    void this.ac?.close().catch(() => undefined);
    this.ac = null;
    this.master = null;
    this.wind = this.rain = this.whine = null;
  }
}
