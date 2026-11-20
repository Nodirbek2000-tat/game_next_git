import type { Voice } from "./instruments";

// Nurli tor: the sound — a plucked string (guitar, dutor, rubob, harp: see instruments.ts). Karplus–Strong (a noise burst through a delay line with a loss filter),
// rendered once per note into a buffer and cached, played through a small "guitar body" (resonance filters) and a short room
// echo. A new pluck on the same string damps the old one, like a real string. Web Audio only, nothing downloaded.

type Graph = { ac: AudioContext; sfx: GainNode };

export interface StringTone {
  /** where it is plucked (0..0.5): a comb on the excitation, near the end = thin and bright */
  pick: number;
  /** ring time (s): the note falls by 60 dB */
  t60: number;
  /** loss filter weight (0..0.5): 0.5 = warm, smaller = bright / metallic */
  damp: number;
}

const DEFAULT_TONE: StringTone = { pick: 0.18, t60: 3, damp: 0.5 };

/** Karplus–Strong plucked string, normalised to 0.9. */
export function pluckSamples(freq: number, rate: number, seconds = 3.2, tone: StringTone = DEFAULT_TONE, seed = 1): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  ksInto(out, freq, rate, tone, seed, 1);
  return finish(out, rate);
}

/** add one Karplus–Strong string (`gain`) into `out` */
function ksInto(out: Float32Array, freq: number, rate: number, tone: StringTone, seed: number, gain: number): void {
  const n = out.length;
  const pickPos = tone.pick;
  const w = Math.max(0.05, Math.min(0.5, tone.damp));
  // the loss filter adds w samples of delay
  const period = Math.max(2, Math.round(rate / freq - w));
  const buf = new Float32Array(period);
  let s = seed % 2147483646 || 1;
  for (let i = 0; i < period; i++) {
    s = (s * 16807) % 2147483647;
    buf[i] = (s / 2147483647) * 2 - 1;
  }
  // a softer burst (one pass of lowpass) and the pick position comb
  for (let i = 1; i < period; i++) buf[i] = buf[i] * 0.6 + buf[i - 1] * 0.4;
  const m = Math.max(1, Math.round(period * pickPos));
  const ex = Float32Array.from(buf);
  for (let i = 0; i < period; i++) buf[i] = ex[i] - ex[(i - m + period) % period] * 0.9;
  let mean = 0;
  for (let i = 0; i < period; i++) mean += buf[i];
  mean /= period;
  for (let i = 0; i < period; i++) buf[i] -= mean;
  // loss per round so the note falls by 60 dB in t60 seconds
  const g = Math.pow(0.001, 1 / (freq * Math.max(0.3, tone.t60)));
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[idx];
    const nxt = buf[(idx + 1) % period];
    buf[idx] = g * ((1 - w) * cur + w * nxt);
    out[i] += cur * gain;
    idx = (idx + 1) % period;
  }
}

/** the samples of one note of an instrument: ring time by pitch, two detuned strings for a double course */
export function voiceSamples(freq: number, rate: number, v: Voice, seed = 1): Float32Array {
  const k = Math.max(0, Math.min(1, Math.log(freq / 80) / Math.log(900 / 80)));
  const t60 = v.t60Low + (v.t60High - v.t60Low) * k;
  const out = new Float32Array(Math.floor(rate * Math.min(5, t60 * 0.85 + 0.5)));
  const tone: StringTone = { pick: v.pick, t60, damp: v.damp };
  if (v.course > 0) {
    const c = Math.pow(2, v.course / 2 / 1200);
    ksInto(out, freq * c, rate, tone, seed, 0.6);
    ksInto(out, freq / c, rate, { ...tone, pick: Math.min(0.5, tone.pick * 1.3) }, seed * 7 + 3, 0.6);
  } else ksInto(out, freq, rate, tone, seed, 1);
  return finish(out, rate);
}

/** normalise, fade in / out */
function finish(out: Float32Array, rate: number): Float32Array {
  const n = out.length;
  // normalise, a 2 ms fade-in (no click) and a fade-out at the end
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const k = 0.9 / peak;
  const fi = Math.min(n, Math.floor(rate * 0.002));
  const fo = Math.min(n, Math.floor(rate * 0.3));
  for (let i = 0; i < n; i++) {
    let v = out[i] * k;
    if (i < fi) v *= i / fi;
    if (i >= n - fo) v *= (n - i) / fo;
    out[i] = v;
  }
  return out;
}

export class StringSynth {
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly voices = new Map<number, { src: AudioBufferSourceNode; amp: GainNode }>();
  private out: GainNode | null = null;
  private ac: AudioContext | null = null;

  constructor(private readonly graph: () => Graph | null) {}

  private bus(): Graph | null {
    const g = this.graph();
    if (!g) return null;
    if (!this.out || this.ac !== g.ac) {
      const ac = g.ac;
      this.ac = ac;
      this.cache.clear();
      this.voices.clear();
      // the guitar body: a low wooden resonance, a little air, the harsh top taken off
      const out = ac.createGain();
      out.gain.value = 0.85;
      const body1 = ac.createBiquadFilter();
      body1.type = "peaking";
      body1.frequency.value = 110;
      body1.Q.value = 1.2;
      body1.gain.value = 5;
      const body2 = ac.createBiquadFilter();
      body2.type = "peaking";
      body2.frequency.value = 230;
      body2.Q.value = 1.4;
      body2.gain.value = 3;
      const air = ac.createBiquadFilter();
      air.type = "peaking";
      air.frequency.value = 2600;
      air.Q.value = 0.9;
      air.gain.value = 2;
      const top = ac.createBiquadFilter();
      top.type = "lowpass";
      top.frequency.value = 7000;
      top.Q.value = 0.5;
      out.connect(body1);
      body1.connect(body2);
      body2.connect(air);
      air.connect(top);
      top.connect(g.sfx);
      // a small room: a short, quiet echo
      const delay = ac.createDelay(1);
      delay.delayTime.value = 0.13;
      const fb = ac.createGain();
      fb.gain.value = 0.22;
      const wet = ac.createGain();
      wet.gain.value = 0.18;
      top.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(g.sfx);
      this.out = out;
    }
    return g;
  }

  private buffer(ac: AudioContext, freq: number, v: Voice, inst: string): AudioBuffer {
    const key = `${inst}:${Math.round(freq * 10)}`;
    let buf = this.cache.get(key);
    if (!buf) {
      const data = voiceSamples(freq, ac.sampleRate, v, Math.round(freq * 10));
      buf = ac.createBuffer(1, data.length, ac.sampleRate);
      buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.cache.set(key, buf);
    }
    return buf;
  }

  /** render the buffers ahead (one per draw frame), so the first pluck of every note starts at once */
  warm(notes: readonly { freq: number; v: Voice; inst: string }[]): void {
    const g = this.bus();
    if (!g) return;
    let i = 0;
    const step = (): void => {
      if (i >= notes.length || this.ac !== g.ac) return;
      const n = notes[i++];
      this.buffer(g.ac, n.freq, n.v, n.inst);
      setTimeout(step, 16);
    };
    step();
  }

  /** pluck string `id` at `freq` with the sound `v` of instrument `inst`; `vel` 0..1 (louder and brighter) */
  pluck(id: number, freq: number, vel: number, v: Voice, inst: string): void {
    const g = this.bus();
    if (!g || !this.out) return;
    const ac = g.ac;
    const t = ac.currentTime;
    // the same string rings once: the old note is damped quickly
    const old = this.voices.get(id);
    if (old) {
      old.amp.gain.cancelScheduledValues(t);
      old.amp.gain.setValueAtTime(old.amp.gain.value, t);
      old.amp.gain.linearRampToValueAtTime(0, t + 0.03);
      try {
        old.src.stop(t + 0.04);
      } catch {
        /* already stopped */
      }
    }
    const k = Math.max(0.2, Math.min(1, vel));
    const src = ac.createBufferSource();
    src.buffer = this.buffer(ac, freq, v, inst);
    // soft plucks are darker, hard ones bright
    const tone = ac.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = v.toneLow + k * k * (v.toneHigh - v.toneLow);
    tone.Q.value = 0.6;
    const amp = ac.createGain();
    amp.gain.value = v.gain * (0.35 + 0.65 * k);
    src.connect(tone);
    tone.connect(amp);
    amp.connect(this.out);
    src.start(t);
    const voice = { src, amp };
    this.voices.set(id, voice);
    src.onended = () => {
      if (this.voices.get(id) === voice) this.voices.delete(id);
      amp.disconnect();
    };
  }

  /** a quiet tick while a string is being tuned (pulled longer / shorter) */
  tick(id: number, freq: number, v: Voice, inst: string): void {
    this.pluck(id, freq, 0.22, v, inst);
  }

  /** a string removed: its note stops */
  mute(id: number): void {
    const v = this.voices.get(id);
    const ac = this.ac;
    if (!v || !ac) return;
    const t = ac.currentTime;
    v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setValueAtTime(v.amp.gain.value, t);
    v.amp.gain.linearRampToValueAtTime(0, t + 0.08);
    try {
      v.src.stop(t + 0.1);
    } catch {
      /* already stopped */
    }
    this.voices.delete(id);
  }

  stop(): void {
    for (const id of [...this.voices.keys()]) this.mute(id);
  }
}
