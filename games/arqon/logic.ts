// Arqon sakrash: the rope (timing, judging, speed). Body detection lives in ./stance. No engine imports, easy to test.

export { Calm, Stance, readBody, type LmLike } from "./stance";

/** seconds per rope turn: slow at the start, faster and faster until `horizon` seconds */
export function ropePeriod(sec: number, horizon = 45): number {
  const k = Math.max(0, Math.min(1, sec / horizon));
  return 1.5 + (0.85 - 1.5) * k;
}

/** seconds the rope lies still before the first swing */
export const LEAD_IN = 0.7;
/** the jump may have ended up to this long before the rope reaches the feet (camera delay) */
export const BEFORE = 0.08;
/** a jump that is detected up to this long after the rope reached the feet still saves the player (camera delay) */
export const AFTER = 0.22;
/** phase at which the "tick" cue plays (a little before the rope reaches the feet) */
export const CUE_PHASE = 0.3;
/** seconds the rope lies at the feet after a trip */
export const STALL = 0.6;

export type RopeEvent = 0 | 1 | 2;

/**
 * The rope. `phase`: 0 = over the head, 0.25 = in front at hand height, 0.5 = under the feet, 0.75 = behind at hand height.
 * It lies on the floor (phase 0.5) until the first swing. At 0.5 the player must be in the air (or have just landed / take off
 * within the grace time): `update` then returns 1 (cleared, `perfect` = in the air at that very moment) or 2 (tripped).
 * While the verdict is open the rope waits on the floor, so there is no visual jump afterwards.
 */
export class Rope {
  phase = 0.5;
  /** seconds since the rope started swinging */
  swing = 0;
  passes = 0;
  /** one frame flags */
  cue = false;
  crossed = false;
  perfect = false;
  /** seconds left of lying still after a trip */
  stall = 0;
  /** the rope waits at the feet for a verdict */
  waiting = false;
  private waitT = 0;
  private lastAir = -99;
  private clock = 0;
  private slow = false;
  private running = false;

  constructor(private readonly horizon = 45) {}

  update(dt: number, air: boolean, go: boolean): RopeEvent {
    this.clock += dt;
    this.cue = this.crossed = false;
    if (air) this.lastAir = this.clock;
    if (go && !this.running) this.running = true;
    let ev: RopeEvent = 0;

    if (this.waiting) {
      this.waitT += dt;
      if (air) {
        this.waiting = false;
        this.perfect = false;
        this.passes++;
        ev = 1;
      } else if (this.waitT >= AFTER) {
        this.waiting = false;
        this.stall = STALL;
        this.slow = true;
        ev = 2;
      }
      return ev;
    }
    if (this.stall > 0) {
      this.stall -= dt;
      this.phase = 0.5;
      return 0;
    }
    if (!this.running) return 0;

    this.swing += dt;
    const period = ropePeriod(this.swing, this.horizon) * (this.slow ? 1.3 : 1);
    const prev = this.phase;
    let ph = prev + dt / period;
    if (prev < CUE_PHASE && ph >= CUE_PHASE) this.cue = true;
    if (prev >= 0.5 && ph >= 1) {
      ph -= 1;
      if (ph >= CUE_PHASE) this.cue = true; // very slow frame
    }
    if (prev < 0.5 && ph >= 0.5) {
      // the rope reaches the feet
      this.slow = false;
      this.crossed = true;
      if (air || this.lastAir >= this.clock - BEFORE) {
        this.perfect = air;
        this.passes++;
        this.phase = ph;
        return 1;
      }
      this.phase = 0.5;
      this.waiting = true;
      this.waitT = 0;
      return 0;
    }
    this.phase = ph;
    return 0;
  }
}
