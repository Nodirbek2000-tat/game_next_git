import { clamp } from "../math";

/**
 * Low-light / low-contrast handling for dim and blurry webcams.
 *
 *  - `lightStats` summarises a small RGBA camera snapshot (mean luma + 2nd/98th percentile).
 *  - `LowLightController` decides, with hysteresis and smoothing, whether the frame fed to MediaPipe should be
 *    brightened (contrast stretch + gamma through a 256 entry LUT) and how strongly; it also says when the room
 *    is so dark that the player should be told, and gives the darkness level the rest of the engine adapts to
 *    (MediaPipe confidence thresholds, player lock, blade visibility).
 *  - `buildLut` / `applyLut` do the actual (cheap, allocation free) pixel work on a small canvas.
 */

export interface LightStats {
  /** mean luma 0..1 */
  mean: number;
  /** 2nd / 98th percentile of the luma 0..1 */
  lo: number;
  hi: number;
}

const BINS = 64;
const hist = new Uint32Array(BINS);

/** Luma statistics of an RGBA buffer (every `step`-th pixel). Null when there is no data. */
export function lightStats(data: ArrayLike<number> | null | undefined, step = 2): LightStats | null {
  if (!data || data.length < 16) return null;
  hist.fill(0);
  let n = 0;
  let sum = 0;
  const stride = 4 * Math.max(1, step);
  for (let i = 0; i + 2 < data.length; i += stride) {
    const y = (54 * data[i] + 183 * data[i + 1] + 19 * data[i + 2]) >> 8; // Rec.709 luma, 0..255
    hist[y >> 2]++;
    sum += y;
    n++;
  }
  if (!n) return null;
  const at = (q: number): number => {
    const target = q * n;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b];
      if (acc >= target) return (b + 0.5) / BINS;
    }
    return 1;
  };
  return { mean: sum / n / 255, lo: at(0.02), hi: at(0.98) };
}

export interface EnhanceState {
  /** the frame sent to the model should be brightened */
  active: boolean;
  gamma: number;
  lo: number;
  hi: number;
  /** 0 (fine) .. 1 (very dark), smoothed */
  darkness: number;
}

export const IDENTITY: Readonly<EnhanceState> = { active: false, gamma: 1, lo: 0, hi: 1, darkness: 0 };

export interface Target {
  need: boolean;
  lo: number;
  hi: number;
  gamma: number;
  darkness: number;
}

/** What the frame would need right now (no hysteresis, no smoothing). Pure. */
export function computeTarget(s: LightStats): Target {
  const darkness = clamp((0.34 - s.mean) / 0.24, 0, 1);
  const flat = s.hi - s.lo < 0.2 && s.mean < 0.42;
  const need = s.mean < 0.3 || flat;
  if (!need) return { need: false, lo: 0, hi: 1, gamma: 1, darkness };
  const lo = Math.min(s.lo, 0.18);
  // never amplify more than ~3.5x: beyond that only the sensor noise grows
  const hi = clamp(Math.max(s.hi, lo + 0.28), 0.3, 1);
  const m = clamp((s.mean - lo) / (hi - lo), 0.02, 0.98);
  const gamma = m < 0.45 ? clamp(Math.log(0.45) / Math.log(m), 0.45, 1) : 1;
  return { need: true, lo, hi, gamma, darkness };
}

/** 256 entry lookup table of the enhancement (identity when `!p.active`). */
export function buildLut(p: Pick<EnhanceState, "gamma" | "lo" | "hi">, out: Uint8Array = new Uint8Array(256)): Uint8Array {
  const span = Math.max(0.05, p.hi - p.lo);
  for (let i = 0; i < 256; i++) {
    const x = clamp((i / 255 - p.lo) / span, 0, 1);
    out[i] = Math.round(255 * Math.pow(x, p.gamma));
  }
  return out;
}

/** In-place per channel LUT on an RGBA buffer (alpha untouched). */
export function applyLut(data: Uint8ClampedArray | Uint8Array, lut: Uint8Array): void {
  for (let i = 0; i + 2 < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

export interface Confidence {
  det: number;
  pres: number;
  track: number;
}
const CONF_STEPS: [number, Confidence][] = [
  [0.75, { det: 0.35, pres: 0.35, track: 0.35 }],
  [0.45, { det: 0.4, pres: 0.4, track: 0.4 }],
  [0.15, { det: 0.45, pres: 0.45, track: 0.45 }],
  [0, { det: 0.5, pres: 0.5, track: 0.5 }],
];
/** MediaPipe confidence thresholds for a darkness level (quantised so the model is reconfigured rarely). */
export function confidenceFor(darkness: number): Confidence {
  for (const [min, c] of CONF_STEPS) if (darkness >= min) return c;
  return CONF_STEPS[CONF_STEPS.length - 1][1];
}

export interface LowLightOptions {
  /** consecutive "needed" samples before the enhancement starts */
  onStreak: number;
  /** consecutive "not needed" samples before it stops */
  offStreak: number;
  /** raw mean luma below which the player is told it is too dark */
  tooDarkLuma: number;
  /** ... for at least this long (ms) */
  tooDarkMs: number;
  smooth: number;
}
export const LOW_LIGHT_DEFAULTS: LowLightOptions = { onStreak: 3, offStreak: 10, tooDarkLuma: 0.085, tooDarkMs: 2500, smooth: 0.25 };

export class LowLightController {
  readonly state: EnhanceState = { ...IDENTITY };
  /** the room is dark even after the enhancement (show a gentle hint) */
  tooDark = false;
  /** raw (before the enhancement) mean luma of the last sample */
  mean = 0.5;
  private on = 0;
  private off = 0;
  private darkSince = 0;
  private enabled = false;

  constructor(private o: LowLightOptions = LOW_LIGHT_DEFAULTS) {}

  /** Feed one snapshot (~10 Hz). `nowMs` is any monotonic clock. Returns the (shared) state. */
  update(stats: LightStats | null, nowMs: number): EnhanceState {
    if (!stats) return this.state;
    const o = this.o;
    const st = this.state;
    this.mean = stats.mean;
    const t = computeTarget(stats);
    if (t.need) {
      this.on++;
      this.off = 0;
    } else {
      this.off++;
      this.on = 0;
    }
    if (!this.enabled && this.on >= o.onStreak) this.enabled = true;
    else if (this.enabled && this.off >= o.offStreak) this.enabled = false;

    const goal = this.enabled && t.need ? t : this.enabled ? { lo: st.lo, hi: st.hi, gamma: st.gamma, darkness: t.darkness } : { lo: 0, hi: 1, gamma: 1, darkness: 0 };
    const k = o.smooth;
    st.lo += (goal.lo - st.lo) * k;
    st.hi += (goal.hi - st.hi) * k;
    st.gamma += (goal.gamma - st.gamma) * k;
    st.darkness += (goal.darkness - st.darkness) * k;
    // fully faded out -> really off (the pixel pass is skipped)
    const near = st.lo < 0.01 && st.hi > 0.985 && st.gamma > 0.985;
    st.active = this.enabled || !near;
    if (!st.active) {
      st.lo = 0;
      st.hi = 1;
      st.gamma = 1;
      st.darkness = 0;
    }

    if (stats.mean < o.tooDarkLuma) {
      if (!this.darkSince) this.darkSince = nowMs;
      if (nowMs - this.darkSince >= o.tooDarkMs) this.tooDark = true;
    } else if (stats.mean > o.tooDarkLuma * 1.3) {
      this.darkSince = 0;
      this.tooDark = false;
    }
    return st;
  }

  reset(): void {
    Object.assign(this.state, IDENTITY);
    this.on = this.off = 0;
    this.darkSince = 0;
    this.tooDark = false;
    this.enabled = false;
    this.mean = 0.5;
  }
}
