import type { QualityLevel, QualityParams } from "../types";

const ORDER: QualityLevel[] = ["low", "medium", "high"];

const BASE: Record<QualityLevel, Omit<QualityParams, "level" | "resolutionScale">> = {
  high: { pixelRatio: 1.5, shadows: true, postfx: true, viewDistance: 1, particles: 1 },
  medium: { pixelRatio: 1, shadows: false, postfx: false, viewDistance: 0.75, particles: 0.7 },
  low: { pixelRatio: 1, shadows: false, postfx: false, viewDistance: 0.5, particles: 0.4 },
};

/** Lowest render scale per level: the lowest level may go much lower (blurry but smooth beats sharp and choppy). */
const MIN_SCALE: Record<QualityLevel, number> = { high: 0.7, medium: 0.7, low: 0.5 };
/** Emergency steps below "low / lowest scale": fewer particles and a shorter view distance. */
const MAX_SQUEEZE = 2;

export interface QualityControllerOptions {
  /** level to start from (from detect-gpu or the user setting) */
  initial: QualityLevel;
  /** when false the level never changes (user forced a quality) */
  adaptive: boolean;
  /** the device pixel ratio of the screen; the level's pixel ratio is capped by it */
  devicePixelRatio?: number;
  targetFps?: number;
  /** seconds below the low threshold before reacting (default 1) */
  downAfter?: number;
  /** seconds above the high threshold before stepping up (default 12) */
  upAfter?: number;
}

export function levelFromTier(tier: number, isMobile: boolean): QualityLevel {
  if (isMobile) return "low"; // phones and tablets always start cheap; the controller raises them when the fps allows
  if (tier >= 3) return "high";
  if (tier >= 2) return "medium";
  return "low";
}

/**
 * Dynamic quality: shadows, post effects, pixel ratio and view distance follow the device tier and the
 * measured frame rate. Low fps must never last: it reacts within a second or two, recovers only slowly.
 *  - fps below 78 % of target for `downAfter` seconds: lower the render scale one step, after the scale floor drop a level
 *  - fps below 50 % of target (reacts after 0.75 s): drop a whole level at once (weak device, no time for baby steps)
 *  - on "low" at the lowest scale: squeeze particles / view distance as a last resort (`atFloor`)
 *  - fps above 96 % of target for `upAfter` seconds: raise the render scale, then the level (never above the initial)
 * After a downgrade the next upgrade waits twice as long (up to 4x), which prevents flapping.
 * `hold(until)` ignores the first seconds of a game (shader compilation hitches are not a reason to drop quality).
 */
export class QualityController {
  level: QualityLevel;
  scale = 1;
  /** 0..MAX_SQUEEZE emergency steps below the lowest level */
  squeeze = 0;
  private lowFor = 0;
  private highFor = 0;
  private upWait: number;
  private lastT: number | null = null;
  private readonly maxLevel: number;
  private readonly target: number;
  private readonly down: number;
  private readonly up: number;
  private readonly dpr: number;
  private cooldownUntil = 0;
  private holdUntil = 0;
  onChange?: (p: QualityParams) => void;

  constructor(private o: QualityControllerOptions) {
    this.level = o.initial;
    this.maxLevel = ORDER.indexOf(o.initial);
    this.target = o.targetFps ?? 60;
    this.down = o.downAfter ?? 1;
    this.up = o.upAfter ?? 12;
    this.upWait = this.up;
    this.dpr = o.devicePixelRatio ?? 2;
  }

  get params(): QualityParams {
    const b = BASE[this.level];
    const sq = this.squeeze;
    return {
      level: this.level,
      ...b,
      pixelRatio: Math.max(0.5, Math.min(b.pixelRatio, this.dpr) * this.scale),
      viewDistance: b.viewDistance * (1 - 0.25 * sq),
      particles: b.particles * (1 - 0.4 * sq),
      resolutionScale: this.scale,
    };
  }

  /** Nothing cheaper is left: the lowest level at the lowest scale with the emergency squeeze used up. */
  get atFloor(): boolean {
    return this.level === "low" && this.scale <= MIN_SCALE.low + 1e-6 && this.squeeze >= MAX_SQUEEZE;
  }

  /** Do not react before `untilSec` (same clock as `sample`). */
  hold(untilSec: number): void {
    this.holdUntil = Math.max(this.holdUntil, untilSec);
    this.lowFor = this.highFor = 0;
  }

  /** Feed the smoothed fps once per frame (or per second). `now` in seconds. Returns true if params changed. */
  sample(fps: number, now: number): boolean {
    const dt = this.lastT === null ? 0 : Math.min(1, now - this.lastT);
    this.lastT = now;
    if (!this.o.adaptive || fps <= 0 || now < this.cooldownUntil || now < this.holdUntil) return false;
    const ratio = fps / this.target;
    if (ratio < 0.78) {
      this.lowFor += dt;
      this.highFor = 0;
      const severe = ratio < 0.5 && this.lowFor >= this.down * 0.5;
      if (this.lowFor >= this.down || severe) return this.degrade(now, ratio < 0.5);
    } else if (ratio > 0.96) {
      this.highFor += dt;
      this.lowFor = 0;
      if (this.highFor >= this.upWait) return this.improve(now);
    } else {
      this.lowFor = Math.max(0, this.lowFor - dt);
      this.highFor = Math.max(0, this.highFor - dt);
    }
    return false;
  }

  private degrade(now: number, bigStep: boolean): boolean {
    this.lowFor = 0;
    this.cooldownUntil = now + 1;
    this.upWait = Math.min(this.up * 4, this.upWait * 2);
    const i = ORDER.indexOf(this.level);
    const min = MIN_SCALE[this.level];
    if (!bigStep && this.scale > min + 1e-6) {
      this.scale = Math.max(min, +(this.scale - 0.2).toFixed(2));
    } else if (i > 0) {
      this.level = ORDER[i - 1];
      this.scale = 1;
    } else if (this.scale > min + 1e-6) {
      this.scale = Math.max(min, +(this.scale - 0.15).toFixed(2));
    } else if (this.squeeze < MAX_SQUEEZE) {
      this.squeeze++;
    } else return false; // already at the floor
    this.onChange?.(this.params);
    return true;
  }

  private improve(now: number): boolean {
    this.highFor = 0;
    this.cooldownUntil = now + 2;
    if (this.squeeze > 0) this.squeeze--;
    else if (this.scale < 1) this.scale = Math.min(1, +(this.scale + 0.15).toFixed(2));
    else {
      const i = ORDER.indexOf(this.level);
      if (i >= this.maxLevel) return false;
      this.level = ORDER[i + 1];
    }
    this.onChange?.(this.params);
    return true;
  }
}
