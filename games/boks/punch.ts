import { SW_METERS } from "./config";

/**
 * Punch detector for ONE hand (pure: no three.js, no engine). Fed once per frame with what the tracker knows about the hand,
 * all lengths in SHOULDER WIDTHS (so the numbers do not depend on how far the player stands from the camera).
 *
 * A punch is a fast thrust of the wrist AWAY from its own shoulder or TOWARDS the camera, not just a fast hand:
 *   - lateral punches (a straight punch or a hook towards a pad): the blade speed is high for at least two frames, the wrist
 *     travelled a real distance in the last ~180 ms, and the arm got longer (wrist - shoulder distance grew) or a forward cue fired;
 *   - punches straight at the camera hardly move in the picture, so the forward cues carry them: the forearm is foreshortened
 *     (elbow - wrist distance dropped), the hand got bigger, or the world landmarks say the wrist came forward. These need
 *     less picture speed but a strong cue.
 * Tracking jitter does not count: a one-frame speed spike (the point jumped and came back) is only one fast frame and its net
 * displacement is zero; a speed far above anything a human can do is a glitch and resets the detector; a hand waved with a
 * straight arm (distance to the shoulder constant) is not a punch; slow reaching stays under the speed gate.
 */

export interface HandSample {
  /** ms */
  t: number;
  /** the wrist is tracked well this frame */
  valid: boolean;
  /** blade speed in shoulder widths per second (includes body motion) */
  speed: number;
  /** wrist relative to its own shoulder, shoulder widths (x to the screen right, y down) */
  ex: number;
  ey: number;
  /** elbow -> wrist distance in shoulder widths, 0 = unknown */
  fore: number;
  /** wrist -> index finger distance (hand size) in shoulder widths, 0 = unknown */
  size: number;
  /** wrist z minus shoulder z of the world landmarks in metres (negative = towards the camera), NaN = unknown */
  dz: number;
}

export interface PunchCfg {
  /** shoulder widths / s a thrust has to reach */
  vMin: number;
  /** above this the sample is a tracking glitch */
  vMax: number;
  /** wrist travel (shoulder widths) over the window */
  dispMin: number;
  /** window of the evidence (ms) */
  windowMs: number;
  /** fast frames needed */
  minFast: number;
  /** growth of the wrist - shoulder distance */
  extGain: number;
  /** weak and strong forward cues */
  foreDrop: number;
  foreDropStrong: number;
  sizeGain: number;
  sizeGainStrong: number;
  dzGain: number;
  dzGainStrong: number;
  /** speed needed together with a strong forward cue */
  vFwd: number;
  /** a punch ends when the speed falls below this fraction of its peak */
  endRatio: number;
  /** ms before the same hand may punch again */
  cooldownMs: number;
  /** a punch cannot last longer than this (ms) */
  maxMs: number;
}

export const PUNCH_CFG: PunchCfg = {
  vMin: 4.5,
  vMax: 45,
  dispMin: 0.4,
  windowMs: 180,
  minFast: 2,
  extGain: 0.3,
  foreDrop: 0.2,
  foreDropStrong: 0.35,
  sizeGain: 0.15,
  sizeGainStrong: 0.3,
  dzGain: 0.12,
  dzGainStrong: 0.2,
  vFwd: 1.8,
  endRatio: 0.45,
  cooldownMs: 180,
  maxMs: 650,
};

/** what the detector reports; the object is reused (read it right after `update`) */
export interface PunchState {
  /** a punch is going on (from the frame it was recognised until the hand slows down) */
  live: boolean;
  /** true only on the frame the punch was recognised */
  fired: boolean;
  /** true only on the frame the punch is over */
  ended: boolean;
  /** peak speed so far (shoulder widths / s) */
  peak: number;
  /** estimated speed, km/h (rough) */
  kmh: number;
  /** the punch was already used for a pad (it cannot hit twice) */
  used: boolean;
  /** why it counted */
  cue: "" | "lateral" | "forward";
}

/** Rough punch speed in km/h from the peak picture speed (the picture misses the part towards the camera, hence the 1.25). */
export function punchKmh(peakSw: number, forward = 1.25): number {
  return Math.max(0, Math.min(95, peakSw * SW_METERS * 3.6 * forward));
}

const N = 32;

export class PunchDetector {
  readonly st: PunchState = { live: false, fired: false, ended: false, peak: 0, kmh: 0, used: false, cue: "" };
  private cfg: PunchCfg;
  private t = new Float64Array(N);
  private ex = new Float64Array(N);
  private ey = new Float64Array(N);
  private fore = new Float64Array(N);
  private size = new Float64Array(N);
  private dz = new Float64Array(N);
  private sp = new Float64Array(N);
  private head = 0;
  private count = 0;
  private startT = 0;
  private lastEnd = -1e9;

  constructor(cfg: PunchCfg = PUNCH_CFG) {
    this.cfg = cfg;
  }

  reset(): void {
    this.head = this.count = 0;
    const s = this.st;
    s.live = s.fired = s.ended = s.used = false;
    s.peak = s.kmh = 0;
    s.cue = "";
  }

  /** a pad took this punch: it cannot hit a second one */
  consume(): void {
    this.st.used = true;
  }

  /** index of the sample `back` frames ago (0 = newest) */
  private idx(back: number): number {
    return (this.head - 1 - back + N * 2) % N;
  }

  /** `sens` > 1 = more sensitive (the sensitivity setting): the speed gates are divided by it */
  update(s: HandSample, sens = 1): PunchState {
    const c = this.cfg;
    const st = this.st;
    st.fired = false;
    st.ended = false;
    const k = Math.max(0.5, Math.min(1.5, sens));
    if (!s.valid || !Number.isFinite(s.speed) || s.speed > c.vMax) {
      // a lost hand or an impossible jump: forget the evidence (a running punch is dropped without scoring)
      this.reset();
      return st;
    }
    const h = this.head;
    this.t[h] = s.t;
    this.ex[h] = s.ex;
    this.ey[h] = s.ey;
    this.fore[h] = s.fore;
    this.size[h] = s.size;
    this.dz[h] = s.dz;
    this.sp[h] = s.speed;
    this.head = (h + 1) % N;
    this.count = Math.min(N, this.count + 1);
    // the oldest sample inside the window, the fast frames and the peak of that window
    let o = 0;
    let fast = 0;
    let peak = 0;
    for (let b = 0; b < this.count; b++) {
      const i = this.idx(b);
      if (s.t - this.t[i] > c.windowMs) break;
      o = b;
      if (this.sp[i] >= (c.vMin * 0.8) / k) fast++;
      if (this.sp[i] > peak) peak = this.sp[i];
    }
    const oi = this.idx(o);
    const ci = this.idx(0);
    const disp = Math.hypot(this.ex[ci] - this.ex[oi], this.ey[ci] - this.ey[oi]);
    const ext = Math.hypot(this.ex[ci], this.ey[ci]) - Math.hypot(this.ex[oi], this.ey[oi]);
    const f0 = this.fore[oi];
    const f1 = this.fore[ci];
    const foreDrop = f0 > 0.3 && f1 > 0 ? (f0 - f1) / f0 : 0;
    const s0 = this.size[oi];
    const s1 = this.size[ci];
    const sizeGain = s0 > 0.05 && s1 > 0 ? s1 / s0 - 1 : 0;
    const dzGain = Number.isFinite(this.dz[oi]) && Number.isFinite(this.dz[ci]) ? this.dz[oi] - this.dz[ci] : 0;

    // raising the guard (the arm retracts) and dropping the hands (straight down) are fast hand motions, not punches
    const dyv = this.ey[ci] - this.ey[oi];
    const notPunch = ext < -0.05 || (disp > 0 && dyv / disp > 0.85);
    const weakFwd = foreDrop >= c.foreDrop || sizeGain >= c.sizeGain || dzGain >= c.dzGain;
    const strongFwd = foreDrop >= c.foreDropStrong || sizeGain >= c.sizeGainStrong || dzGain >= c.dzGainStrong;
    const lateral = !notPunch && fast >= c.minFast && peak >= c.vMin / k && s.speed >= (c.vMin * 0.6) / k && disp >= c.dispMin && (ext >= c.extGain || weakFwd);
    const forward = !notPunch && strongFwd && peak >= c.vFwd / k && disp >= 0.15 && this.count >= 3;

    if (!st.live) {
      if ((lateral || forward) && s.t - this.lastEnd >= c.cooldownMs) {
        st.live = true;
        st.fired = true;
        st.used = false;
        st.peak = peak;
        st.cue = lateral ? "lateral" : "forward";
        this.startT = s.t;
        st.kmh = punchKmh(st.peak);
      }
      return st;
    }
    // a punch is running
    if (s.speed > st.peak) st.peak = s.speed;
    st.kmh = punchKmh(st.peak);
    if (s.speed < st.peak * c.endRatio || s.t - this.startT > c.maxMs) {
      st.live = false;
      st.ended = true;
      this.lastEnd = s.t;
    }
    return st;
  }
}
