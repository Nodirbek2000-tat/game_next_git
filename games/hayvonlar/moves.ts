// Per-child decision "did this child do the animal's movement?" from the kit signals. Pure and allocation-free:
// one KidProgress per kid slot, reset at the start of every challenge. Thresholds are generous on purpose (ages 3-6):
// the kit signals are already tuned for small bodies, here we only add short holds / accumulation so a flickering
// detection (weak PC, 15 detections per second) still counts, and nothing ever punishes a child.

import type { KidSignals, KidSlot } from "../bogcha/common";
import type { Move } from "./animals";

export type MoveSignals = Pick<KidSignals, "jumpFired" | "squat" | "clapFired" | "handsUp" | "handUp" | "wave" | "armsOut">;

export const MOVE_CFG = {
  /** flap: seconds of "arms out / waving" needed (a real flap shows armsOut only part of the time) */
  flapNeed: 0.6,
  /** how fast the accumulated time drains while the child does not show the pose (relative to real time) */
  drain: 0.25,
  /** frog: squat at least this long, then a jump within `frogWindow` s counts */
  frogSquat: 0.15,
  frogWindow: 1.8,
  /** bear: both hands up this long ... */
  handsNeed: 0.35,
  /** ... or one hand up this long */
  oneHandNeed: 1.2,
  /** turtle: squat held this long (slow, not a jump) */
  turtleNeed: 0.6,
} as const;

/** hands up judged with a lower visibility bar (far children: the kit's own `handUp` needs well seen wrists) */
export interface SoftHands {
  L: boolean;
  R: boolean;
}

/** fills `out`: a wrist (seen from 0.1) is clearly above the nose. Without a seen head nothing is claimed. */
export function softHands(pts: KidSlot["pts"], scale: number, out: SoftHands): SoftHands {
  const { head, lw, rw } = pts;
  const sc = Math.max(20, scale);
  const ok = head.v >= 0.1;
  out.L = ok && lw.v >= 0.1 && lw.y < head.y - 0.15 * sc;
  out.R = ok && rw.v >= 0.1 && rw.y < head.y - 0.15 * sc;
  return out;
}

export class KidProgress {
  /** the child completed the current challenge (a star was given) */
  done = false;
  /** accumulated time of the main pose */
  acc = 0;
  /** accumulated time of the weaker pose (bear: one hand) */
  acc2 = 0;
  /** frog: squat time so far / seconds left in which a jump counts */
  squatFor = 0;
  armed = 0;

  reset(): void {
    this.done = false;
    this.acc = 0;
    this.acc2 = 0;
    this.squatFor = 0;
    this.armed = 0;
  }

  /** One frame of a present child. Returns true on the frame the child completes the move (only once per challenge). */
  step(move: Move, sg: MoveSignals, dt: number, soft?: SoftHands): boolean {
    if (this.done) return false;
    const c = MOVE_CFG;
    let ok = false;
    switch (move) {
      case "jump":
        ok = sg.jumpFired;
        break;
      case "clap":
        ok = sg.clapFired;
        break;
      case "flap":
        this.acc = sg.armsOut || sg.wave ? this.acc + dt : Math.max(0, this.acc - dt * c.drain);
        ok = this.acc >= c.flapNeed;
        break;
      case "froghop":
        if (sg.squat) {
          this.squatFor += dt;
          if (this.squatFor >= c.frogSquat) this.armed = c.frogWindow;
        } else {
          this.squatFor = 0;
          this.armed = Math.max(0, this.armed - dt);
        }
        ok = this.armed > 0 && sg.jumpFired;
        break;
      case "handsUp": {
        const one = sg.handUp.L || sg.handUp.R || (soft !== undefined && (soft.L || soft.R));
        const both = sg.handsUp || (soft !== undefined && soft.L && soft.R);
        this.acc = both ? this.acc + dt : Math.max(0, this.acc - dt * c.drain);
        this.acc2 = one ? this.acc2 + dt : Math.max(0, this.acc2 - dt * c.drain);
        ok = this.acc >= c.handsNeed || this.acc2 >= c.oneHandNeed;
        break;
      }
      case "slowSquat":
        this.acc = sg.squat ? this.acc + dt : Math.max(0, this.acc - dt * c.drain);
        ok = this.acc >= c.turtleNeed;
        break;
    }
    if (ok) this.done = true;
    return ok;
  }
}
