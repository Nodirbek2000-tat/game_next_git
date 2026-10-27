import { DRIFT_DEFAULTS, type DriftConfig } from "../config";

export interface DriftEvents {
  /** a chain was banked into the total (points added) */
  banked?: (points: number, combo: number, seconds: number) => void;
  /** a chain was lost (crash / spin out / off the drift area) */
  lost?: (points: number) => void;
  /** the combo level went up */
  combo?: (level: number) => void;
}

/**
 * Drift score. A "drift" is the car pointing away from where it travels (angle) at a decent speed.
 * Points per second = angle(deg) * speed(m/s) * k * comboLevel. The combo grows while the chain goes on and
 * the chain is banked after `graceSec` without drifting. A collision or leaving the drift zone loses it.
 */
export class DriftScorer {
  total = 0;
  chain = 0;
  combo = 1;
  chainTime = 0;
  drifting = false;
  bestChain = 0;
  chains = 0;
  /** current angle (deg) while drifting, for the HUD */
  angle = 0;
  private idle = 0;

  constructor(
    private cfg: DriftConfig = DRIFT_DEFAULTS,
    private ev: DriftEvents = {},
  ) {}

  reset(): void {
    this.total = this.chain = this.chainTime = this.bestChain = this.chains = this.idle = this.angle = 0;
    this.combo = 1;
    this.drifting = false;
  }

  /**
   * @param slipRad body angle against the velocity (rad, any sign)
   * @param speed m/s (forward speed magnitude)
   * @param grounded wheels on the ground (jumps do not count)
   * @param inZone inside the area where drifting is scored (Drift mode: the airfield)
   */
  update(dt: number, slipRad: number, speed: number, grounded: boolean, inZone: boolean): void {
    const c = this.cfg;
    const ang = (Math.abs(slipRad) * 180) / Math.PI;
    const on = grounded && inZone && speed > c.minSpeed && ang > c.minAngleDeg && ang < 150;
    this.drifting = on;
    this.angle = on ? ang : 0;
    if (on) {
      this.idle = 0;
      this.chainTime += dt;
      const lvl = Math.min(c.maxCombo, 1 + Math.floor(this.chainTime / c.comboEvery));
      if (lvl > this.combo) {
        this.combo = lvl;
        this.ev.combo?.(lvl);
      }
      this.chain += dt * ang * speed * c.k * this.combo;
    } else if (this.chain > 0 || this.chainTime > 0) {
      this.idle += dt;
      if (this.idle >= c.graceSec || !inZone) this.bank(!inZone);
    }
  }

  /** Banks the running chain (or throws it away if `lose`). */
  bank(lose = false): void {
    const pts = Math.round(this.chain);
    if (pts > 0) {
      if (lose) this.ev.lost?.(pts);
      else {
        this.total += pts;
        this.chains++;
        this.bestChain = Math.max(this.bestChain, pts);
        this.ev.banked?.(pts, this.combo, this.chainTime);
      }
    }
    this.chain = 0;
    this.chainTime = 0;
    this.combo = 1;
    this.idle = 0;
    this.drifting = false;
  }

  /** Crash: the running chain is lost. */
  crash(): void {
    this.bank(true);
  }

  get score(): number {
    return this.total + Math.round(this.chain);
  }
}
