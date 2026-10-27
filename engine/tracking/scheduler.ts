import type { QualityLevel } from "../types";

/** Detection rates the scheduler steps through (per second). */
export const RATE_LADDER = [60, 45, 30, 24, 20, 15] as const;
/** Longest side (px) of the image sent to the model for each rung. */
const SIDE_LADDER = [640, 640, 576, 512, 448, 416] as const;

export interface SchedulerOptions {
  /** navigator.hardwareConcurrency */
  cores: number;
  /** quality level the session starts on (from detect-gpu) */
  level: QualityLevel;
  /** the model runs on the main thread (blocks rendering while it works) */
  mainThread: boolean;
  /** render fps the game aims for */
  targetFps?: number;
  /** seconds of low fps before the detection rate is lowered (default 2) */
  downAfter?: number;
  /** seconds of good fps before it is raised again (default 10) */
  upAfter?: number;
}

/** Where a device should start on the ladder. Pure. */
export function initialRung(cores: number, level: QualityLevel, mainThread: boolean): number {
  let i = 0;
  if (cores <= 2) i = 4;
  else if (cores <= 4) i = 2;
  else if (cores <= 6 && level === "low") i = 1;
  if (mainThread) i = Math.max(i, 2);
  return i;
}

/**
 * How often the camera is analysed.
 *
 * Tracking is the priority, so the rate starts as high as the CPU class allows and a lower rate is only taken when
 * rendering suffers although the graphics are already at their cheapest (or when the model blocks the main thread).
 * It climbs back one rung after a long stable spell. A single frame is never queued: the caller skips the camera
 * frames that arrive while the model is busy, so the model always sees the newest one.
 */
export class DetectionScheduler {
  private idx: number;
  private readonly ceil: number;
  private lowFor = 0;
  private highFor = 0;
  private cooldown = 0;
  private lastT: number | null = null;
  private readonly target: number;
  private readonly down: number;
  private readonly up: number;

  constructor(private o: SchedulerOptions) {
    this.idx = this.ceil = initialRung(o.cores, o.level, o.mainThread);
    this.target = o.targetFps ?? 60;
    this.down = o.downAfter ?? 2;
    this.up = o.upAfter ?? 10;
  }

  /** current cap, detections per second */
  get capFps(): number {
    return RATE_LADDER[this.idx];
  }

  /** longest image side for the model at the current rung */
  get maxSide(): number {
    return SIDE_LADDER[this.idx];
  }

  /** Minimal time between two detection starts (ms). The model's own run time also bounds it on the main thread. */
  minIntervalMs(inferMs: number): number {
    const base = 1000 / this.capFps;
    return this.o.mainThread ? Math.max(base, inferMs * 2.2) : base;
  }

  /**
   * Feed the smoothed render fps (about once per frame or per second). `now` in seconds.
   * @param graphicsAtFloor the quality controller has nothing cheaper left to try
   * @returns true when the rate changed
   */
  sample(renderFps: number, graphicsAtFloor: boolean, now: number): boolean {
    const dt = this.lastT === null ? 0 : Math.min(1, now - this.lastT);
    this.lastT = now;
    if (renderFps <= 0 || now < this.cooldown) return false;
    if (renderFps < this.target * 0.82 && (graphicsAtFloor || this.o.mainThread)) {
      this.lowFor += dt;
      this.highFor = 0;
      if (this.lowFor >= this.down && this.idx < RATE_LADDER.length - 1) {
        this.idx++;
        this.lowFor = 0;
        this.cooldown = now + 4;
        return true;
      }
    } else if (renderFps > this.target * 0.97) {
      this.highFor += dt;
      this.lowFor = 0;
      if (this.highFor >= this.up && this.idx > this.ceil) {
        this.idx--;
        this.highFor = 0;
        this.cooldown = now + 4;
        return true;
      }
    } else {
      this.lowFor = Math.max(0, this.lowFor - dt);
      this.highFor = Math.max(0, this.highFor - dt);
    }
    return false;
  }
}
