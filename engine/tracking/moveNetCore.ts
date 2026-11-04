import type { NormLm } from "../types";
import { CROWD_CFG } from "./crowdConfig";

// MoveNet MultiPose Lightning: the pure part (no TensorFlow, no DOM). Input geometry, decoding of the model output into the 33
// MediaPipe-indexed landmarks the rest of the engine expects, and the controller of the input size. Everything here is allocation-free
// per call after construction.
//
// Output tensor [1, 6, 56]: per person 17 x (y, x, score) in the PADDED input picture (0..1), then ymin, xmin, ymax, xmax, score.
// The mirroring and the "cover" fit to stage pixels are NOT done here: like MediaPipe results, the landmarks are normalised to the whole
// un-mirrored camera picture and `people.ts` (buildPeople / toStage) does the rest for both detectors.

export const MN_PEOPLE = 6;
export const MN_STRIDE = 56;
const MN_KP = 17;
const MP_COUNT = 33;

/** MoveNet keypoint index -> MediaPipe landmark index (both use the subject's own left / right). */
export const MN_TO_MP = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;

/** MediaPipe landmarks MoveNet has no point for: [target, source]. They sit on a neighbour (so nothing is drawn far away) with visibility 0. */
export const MP_FILL: readonly (readonly [number, number])[] = [
  [1, 2], [3, 2], [4, 5], [6, 5], [9, 0], [10, 0],
  [17, 15], [19, 15], [21, 15], [18, 16], [20, 16], [22, 16],
  [29, 27], [31, 27], [30, 28], [32, 28],
];

export interface InputGeo {
  /** picture shown to the model, scaled, without padding */
  rw: number;
  rh: number;
  /** canvas / tensor size: rw x rh padded (bottom / right, black) up to multiples of 32 */
  pw: number;
  ph: number;
}

const up32 = (n: number): number => Math.max(32, Math.ceil(n / 32) * 32);

/** Longest side `side` (px, a multiple of 32), aspect ratio kept, padded to multiples of 32 as the model requires. Never enlarges. */
export function inputGeo(frameW: number, frameH: number, side: number, out: InputGeo = { rw: 0, rh: 0, pw: 0, ph: 0 }): InputGeo {
  const k = Math.min(1, side / Math.max(1, frameW, frameH));
  out.rw = Math.max(2, Math.round(frameW * k));
  out.rh = Math.max(2, Math.round(frameH * k));
  out.pw = up32(out.rw);
  out.ph = up32(out.rh);
  return out;
}

/** A pool of people: 33 landmark objects each, reused by every decode (the result of the previous decode is overwritten). */
export class PosePool {
  readonly people: NormLm[][];
  /** the people of the latest decode (length = how many), the array handed to the rest of the engine */
  readonly view: NormLm[][] = [];
  /** score of each person of the latest decode */
  readonly scores = new Float32Array(MN_PEOPLE);

  constructor(n: number = MN_PEOPLE) {
    this.people = Array.from({ length: n }, () => Array.from({ length: MP_COUNT }, (): NormLm => ({ x: 0, y: 0, z: 0, visibility: 0 })));
  }
}

export interface DecodeCfg {
  minPoseScore: number;
  minKeypoint: number;
  /** keypoint score that counts as "seen well" (visibility 1): MoveNet scores of a seen point are 0.3-0.6, MediaPipe's visibility ~0.95 */
  visScale: number;
}

const order = new Int8Array(MN_PEOPLE);

/**
 * Model output -> up to `maxPeople` people (best score first) written into `pool.view`.
 * @param out the Float32Array of the output tensor (6 x 56)
 * @param geo input geometry the picture was made with
 * @returns the number of people
 */
export function decodeMultiPose(out: ArrayLike<number>, geo: InputGeo, pool: PosePool, maxPeople: number, cfg: DecodeCfg = CROWD_CFG.movenet): number {
  // x of the padded picture -> x of the whole camera picture: x_img = x_pad * pw / rw (the padding is below / right of the picture)
  const sx = geo.pw / geo.rw;
  const sy = geo.ph / geo.rh;
  const n = Math.min(MN_PEOPLE, Math.floor(out.length / MN_STRIDE), pool.people.length);
  // people above the score threshold, best first (insertion sort over <= 6 entries)
  let m = 0;
  for (let i = 0; i < n; i++) {
    const s = out[i * MN_STRIDE + 55];
    if (!(s >= cfg.minPoseScore)) continue; // also drops NaN
    let j = m++;
    while (j > 0 && out[order[j - 1] * MN_STRIDE + 55] < s) {
      order[j] = order[j - 1];
      j--;
    }
    order[j] = i;
  }
  const count = Math.min(m, Math.max(0, Math.floor(maxPeople)));
  pool.view.length = count;
  for (let r = 0; r < count; r++) {
    const b = order[r] * MN_STRIDE;
    const lm = pool.people[r];
    pool.scores[r] = out[b + 55];
    for (let k = 0; k < MN_KP; k++) {
      const p = lm[MN_TO_MP[k]];
      const y = out[b + k * 3];
      const x = out[b + k * 3 + 1];
      const s = out[b + k * 3 + 2];
      p.x = (Number.isFinite(x) ? x : 0) * sx;
      p.y = (Number.isFinite(y) ? y : 0) * sy;
      p.visibility = s >= cfg.minKeypoint ? Math.min(1, s / cfg.visScale) : 0;
    }
    for (let f = 0; f < MP_FILL.length; f++) {
      const t = lm[MP_FILL[f][0]];
      const src = lm[MP_FILL[f][1]];
      t.x = src.x;
      t.y = src.y;
      t.visibility = 0;
    }
    pool.view[r] = lm;
  }
  return count;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Input size

export interface SizeCfg {
  sides: readonly number[];
  startIdx: number;
  /** rungs below this index are emergency rungs: left (downwards) only above `emergencyMs`, entered back (upwards) only well below it */
  floorIdx: number;
  emergencyMs: number;
  downMs: number;
  upMs: number;
  downAfterSec: number;
  upAfterSec: number;
  cooldownSec: number;
  backoffWithinSec: number;
  emaK: number;
}

/**
 * Chooses the longest side of the picture shown to the model. Cost grows with the area, so the next rung up is judged by the measured
 * time scaled by the area ratio: it is tried only when that estimate stays below `upMs` for `upAfterSec`; the rung below is taken when
 * the measured time stays above `downMs` for `downAfterSec`. The lowest rung(s) (below `floorIdx`) are emergency rungs: taken only
 * above `emergencyMs` (a device so slow that the normal rungs give a few detections a second) and left again at 0.75 x that estimate.
 * A change is followed by a pause; the first call after a change (shader compile) is ignored. Time is passed in (seconds).
 */
export class SizeController {
  idx: number;
  /** model time at the current size (EMA, ms; 0 = not measured yet) */
  ms = 0;
  private badFor = 0;
  private goodFor = 0;
  private lastT: number | null = null;
  private cooldownUntil = 0;
  private lastUpAt = -1e9;
  private upWait: number;
  private skip = 0;
  /**
   * Can the picture size of this rung be used now? (false = its shaders are not compiled yet: the first picture of that size would stall
   * the detector for seconds.) The move waits, its timers keep running, and happens as soon as this says yes.
   */
  allow: ((idx: number) => boolean) | null = null;

  constructor(
    private cfg: SizeCfg = CROWD_CFG.movenet,
    /** fixed side (?mnside=): no adaptation */
    readonly fixed: boolean = false,
  ) {
    this.idx = Math.max(0, Math.min(cfg.sides.length - 1, cfg.startIdx));
    this.upWait = cfg.upAfterSec;
  }

  get side(): number {
    return this.cfg.sides[this.idx];
  }

  /** the longest side of rung `idx` */
  sideAt(idx: number): number {
    return this.cfg.sides[idx];
  }

  /** every rung's longest side */
  get ladder(): readonly number[] {
    return this.cfg.sides;
  }

  /** pick the rung closest to `side` and stop adapting */
  static fixedAt(side: number, cfg: SizeCfg = CROWD_CFG.movenet): SizeController {
    const c = new SizeController(cfg, true);
    let best = 0;
    cfg.sides.forEach((s, i) => {
      if (Math.abs(s - side) < Math.abs(cfg.sides[best] - side)) best = i;
    });
    c.idx = best;
    return c;
  }

  /**
   * Report a finished model call.
   * @returns true when the size changed
   */
  report(nowSec: number, ms: number): boolean {
    const dt = this.lastT === null ? 0 : Math.min(1, Math.max(0, nowSec - this.lastT));
    this.lastT = nowSec;
    if (this.skip > 0) {
      this.skip--;
      return false;
    }
    if (!(ms > 0)) return false;
    this.ms = this.ms > 0 ? this.ms + (ms - this.ms) * this.cfg.emaK : ms;
    if (this.fixed || nowSec < this.cooldownUntil) return false;
    const c = this.cfg;
    const last = c.sides.length - 1;
    const downAt = this.idx <= c.floorIdx ? c.emergencyMs : c.downMs;
    if (this.idx > 0 && this.ms > downAt) {
      this.badFor += dt;
      this.goodFor = 0;
      if (this.badFor >= c.downAfterSec && (!this.allow || this.allow(this.idx - 1))) {
        if (nowSec - this.lastUpAt < c.backoffWithinSec) this.upWait = Math.min(this.upWait * 2, c.upAfterSec * 16);
        this.idx--;
        return this.changed(nowSec);
      }
      return false;
    }
    this.badFor = Math.max(0, this.badFor - dt);
    if (this.idx < last) {
      const a = c.sides[this.idx];
      const b = c.sides[this.idx + 1];
      const est = this.ms * ((b * b) / (a * a));
      if (est < (this.idx < c.floorIdx ? c.emergencyMs * 0.75 : c.upMs)) {
        this.goodFor += dt;
        if (this.goodFor >= this.upWait && (!this.allow || this.allow(this.idx + 1))) {
          this.idx++;
          this.lastUpAt = nowSec;
          return this.changed(nowSec);
        }
      } else this.goodFor = Math.max(0, this.goodFor - dt);
    }
    return false;
  }

  private changed(nowSec: number): boolean {
    this.badFor = 0;
    this.goodFor = 0;
    this.ms = 0;
    this.skip = 1;
    this.cooldownUntil = nowSec + this.cfg.cooldownSec;
    return true;
  }
}
