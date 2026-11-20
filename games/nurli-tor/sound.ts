// Nurli tor: the sound. A plucked string (Karplus–Strong, rendered once per note into a buffer and cached) on every new note,
// plus a soft glowing tone that holds while the string is stretched and glides with it. Web Audio only, nothing downloaded.

type Graph = { ac: AudioContext; sfx: GainNode };

/** Karplus–Strong: a burst of noise through a delay line with an averaging filter = a plucked string. */
export function pluckSamples(freq: number, rate: number, seconds = 2.2, brightness = 0.5, seed = 1): Float32Array {
  const n = Math.floor(rate * seconds);
  const out = new Float32Array(n);
  const period = Math.max(2, Math.round(rate / freq));
  const buf = new Float32Array(period);
  let s = seed;
  for (let i = 0; i < period; i++) {
    s = (s * 16807) % 2147483647;
    buf[i] = (s / 2147483647) * 2 - 1;
  }
  // decay per round so a low note rings ~2 s and a high one a bit shorter
  const decay = 0.996 - (freq / 4000) * 0.01;
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[idx];
    const next = buf[(idx + 1) % period];
    const v = decay * (brightness * cur + (1 - brightness) * 0.5 * (cur + next));
    buf[idx] = v;
    out[i] = cur * 0.6 + prev * 0.4;
    prev = cur;
    idx = (idx + 1) % period;
  }
  // a short fade-in (no click) and a fade-out at the end
  const fi = Math.min(n, Math.floor(rate * 0.003));
  for (let i = 0; i < fi; i++) out[i] *= i / fi;
  const fo = Math.min(n, Math.floor(rate * 0.25));
  for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
  return out;
}

export class StringSynth {
  private readonly cache = new Map<number, AudioBuffer>();
  private hum: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private out: GainNode | null = null;

  constructor(private readonly graph: () => Graph | null) {}

  private bus(): Graph | null {
    const g = this.graph();
    if (!g) return null;
    if (!this.out || this.out.context !== g.ac) {
      // a little room: a short feedback echo makes the light sound wide
      const out = g.ac.createGain();
      out.gain.value = 0.9;
      const delay = g.ac.createDelay(1);
      delay.delayTime.value = 0.21;
      const fb = g.ac.createGain();
      fb.gain.value = 0.28;
      const wet = g.ac.createGain();
      wet.gain.value = 0.32;
      out.connect(g.sfx);
      out.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(g.sfx);
      this.out = out;
    }
    return g;
  }

  /** a plucked note now; `vel` 0..1 */
  pluck(freq: number, vel = 0.8): void {
    const g = this.bus();
    if (!g || !this.out) return;
    const key = Math.round(freq * 10);
    let buf = this.cache.get(key);
    if (!buf) {
      const data = pluckSamples(freq, g.ac.sampleRate, 2.2, 0.55, key);
      buf = g.ac.createBuffer(1, data.length, g.ac.sampleRate);
      buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.cache.set(key, buf);
    }
    const src = g.ac.createBufferSource();
    src.buffer = buf;
    const amp = g.ac.createGain();
    amp.gain.value = 0.55 * Math.max(0.2, Math.min(1, vel));
    src.connect(amp);
    amp.connect(this.out);
    src.start();
  }

  /** the glowing tone while the string is held: follows `freq`, `level` 0..1 (0 = fade out) */
  holdTone(freq: number, level: number): void {
    const g = this.bus();
    if (!g || !this.out) return;
    const t = g.ac.currentTime;
    if (!this.hum) {
      if (level <= 0) return;
      const osc = g.ac.createOscillator();
      osc.type = "triangle";
      const osc2 = g.ac.createOscillator();
      osc2.type = "sine";
      osc2.detune.value = 7;
      const filter = g.ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.7;
      const gain = g.ac.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.out);
      osc.frequency.value = freq;
      osc2.frequency.value = freq * 2;
      osc.start();
      osc2.start();
      this.hum = { osc, osc2, gain, filter };
    }
    const h = this.hum;
    h.osc.frequency.setTargetAtTime(freq, t, 0.04);
    h.osc2.frequency.setTargetAtTime(freq * 2, t, 0.04);
    h.filter.frequency.setTargetAtTime(freq * 3, t, 0.05);
    h.gain.gain.setTargetAtTime(0.09 * Math.max(0, Math.min(1, level)), t, level > 0 ? 0.05 : 0.12);
  }

  stop(): void {
    if (this.hum) {
      const h = this.hum;
      try {
        h.osc.stop();
        h.osc2.stop();
        h.gain.disconnect();
      } catch {
        /* already stopped */
      }
      this.hum = null;
    }
  }
}
