// Yulduzcha mashqi (jumping jacks): pure logic - pose classification, rep counter, 10 s stages. No engine imports.

export interface LmLike {
  x: number;
  y: number;
  v: number;
}

const VIS = 0.35;

export interface Pose {
  /** both wrists above the head */
  up: boolean;
  /** both wrists below the shoulders */
  down: boolean;
  /** ankles wide apart */
  apart: boolean;
  /** ankles close together */
  together: boolean;
  /** both ankles seen (otherwise the arms alone decide) */
  legs: boolean;
}

export const STAGES = [5, 6, 7, 7, 8, 8];
export const STAGE_SEC = 10;

/** Classifies one frame. `stageH` = stage height: ankles below the screen are not "seen". */
export function classify(lm: ArrayLike<LmLike>, scale: number, stageH: number, out: Pose): Pose {
  const nose = lm[0];
  const ls = lm[11];
  const rs = lm[12];
  const lw = lm[15];
  const rw = lm[16];
  const la = lm[27];
  const ra = lm[28];
  const armsSeen = lw.v >= VIS && rw.v >= VIS && ls.v >= VIS && rs.v >= VIS;
  const shY = (ls.y + rs.y) / 2;
  out.up = armsSeen && lw.y < nose.y - 0.1 * scale && rw.y < nose.y - 0.1 * scale;
  out.down = armsSeen && lw.y > shY + 0.4 * scale && rw.y > shY + 0.4 * scale;
  out.legs = la.v >= VIS && ra.v >= VIS && la.y < stageH - 2 && ra.y < stageH - 2;
  const gap = Math.abs(la.x - ra.x) / scale;
  out.apart = out.legs && gap > 1.6;
  out.together = out.legs && gap < 1.0;
  return out;
}

/**
 * Open (arms up, legs apart) then closed again (arms down, legs together) = 1 rep. Without legs in the picture the arms alone count.
 * Returns true on the frame a rep is completed.
 */
export class JackCounter {
  open = false;
  reps = 0;
  private time = 0;
  private openT = 0;
  private lastRep = -99;
  update(dt: number, p: Pose): boolean {
    this.time += dt;
    const openNow = p.up && (p.apart || !p.legs);
    const closedNow = p.down && (p.together || !p.legs);
    if (!this.open) {
      if (openNow) {
        this.open = true;
        this.openT = this.time;
      }
    } else if (closedNow) {
      this.open = false;
      if (this.time - this.openT >= 0.15 && this.time - this.lastRep >= 0.3) {
        this.lastRep = this.time;
        this.reps++;
        return true;
      }
    }
    return false;
  }
}

/** Six stages in a row, each with a target count; `update` returns 1 the moment a stage target is reached, 2 when a stage ends short. */
export class Workout {
  stage = 0;
  /** reps in the current stage */
  count = 0;
  /** seconds left in the current stage */
  left: number;
  passed = 0;
  done = false;
  private reached = false;
  constructor(readonly stageSec = STAGE_SEC) {
    this.left = stageSec;
  }
  get target(): number {
    return STAGES[Math.min(this.stage, STAGES.length - 1)];
  }
  update(dt: number, rep: boolean): 0 | 1 | 2 {
    if (this.done) return 0;
    let res: 0 | 1 | 2 = 0;
    if (rep) {
      this.count++;
      if (!this.reached && this.count >= this.target) {
        this.reached = true;
        this.passed++;
        res = 1;
      }
    }
    this.left -= dt;
    if (this.left <= 0) {
      if (!this.reached) res = 2;
      this.stage++;
      this.count = 0;
      this.reached = false;
      this.left = this.stageSec;
      if (this.stage >= STAGES.length) this.done = true;
    }
    return res;
  }
}
