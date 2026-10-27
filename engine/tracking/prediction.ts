import { clamp } from "../math";

/**
 * Motion-to-screen latency helpers.
 *
 * A detection describes where the hand was when the camera captured the frame (`captureTs`), not when the
 * result arrived. By the time it is drawn the hand has moved on, so the render loop extrapolates every
 * point along its velocity by `now - captureTs + displayLead` (capped). All stamps are performance.now() ms.
 */

/** Frame-rate independent smoothing factor for a time constant `tauMs` and a step of `dtSec`. */
export const velAlpha = (dtSec: number, tauMs: number): number => 1 - Math.exp((-dtSec * 1000) / Math.max(1, tauMs));

/** How far (ms) a detection taken at `captureTs` has to be extrapolated to show the state at `now`. */
export const leadMs = (now: number, captureTs: number, displayLeadMs: number, maxMs: number): number => clamp(now - captureTs + displayLeadMs, 0, maxMs);

/**
 * Sanity check for the browser's camera capture time (requestVideoFrameCallback metadata).
 * Some drivers report nonsense; then the time the callback ran is the best estimate.
 */
export function sanitizeCaptureTs(captureTime: number | undefined, tickNow: number, now: number, maxAgeMs = 400): number {
  if (captureTime && captureTime > 0 && captureTime <= tickNow + 1 && now - captureTime <= maxAgeMs) return captureTime;
  return tickNow;
}

/**
 * Constant-acceleration prediction (one axis). A decelerating hand stops at the predicted standstill instead of
 * flying back, so the blade never overshoots into the opposite direction. `accelGain` < 1 keeps sensor noise
 * in the acceleration estimate from showing.
 */
export function predictAccel(x: number, v: number, a: number, dtMs: number, gain: number, accelGain: number): number {
  const t = dtMs / 1000;
  const ae = a * accelGain;
  let ta = t;
  if (ae !== 0 && v * ae < 0) ta = Math.min(t, -v / ae);
  return x + v * ta * gain + 0.5 * ae * ta * ta;
}

export interface LatencyBreakdown {
  /** capture -> on screen (includes the display lead) */
  total: number;
  /** capture -> detection started (camera/driver + waiting for the previous frame) */
  wait: number;
  /** detection started -> result (image copy + model) */
  infer: number;
  /** result -> applied by the tracker */
  apply: number;
}

/** Exponential moving averages of the stages of the camera -> screen path. */
export class LatencyTracker {
  total = 0;
  wait = 0;
  infer = 0;
  apply = 0;
  /** slowly decaying maximum of `total` (spikes) */
  peak = 0;
  samples = 0;

  constructor(
    private displayLeadMs = 8,
    private k = 0.1,
  ) {}

  record(captureTs: number, startTs: number, doneTs: number, appliedTs: number): void {
    const wait = Math.max(0, startTs - captureTs);
    const infer = Math.max(0, doneTs - startTs);
    const apply = Math.max(0, appliedTs - doneTs);
    const total = Math.max(0, appliedTs - captureTs) + this.displayLeadMs;
    if (!this.samples) {
      this.wait = wait;
      this.infer = infer;
      this.apply = apply;
      this.total = total;
      this.peak = total;
    } else {
      const k = this.k;
      this.wait += (wait - this.wait) * k;
      this.infer += (infer - this.infer) * k;
      this.apply += (apply - this.apply) * k;
      this.total += (total - this.total) * k;
      this.peak = Math.max(total, this.peak * 0.98);
    }
    this.samples++;
  }

  get breakdown(): LatencyBreakdown {
    return { total: this.total, wait: this.wait, infer: this.infer, apply: this.apply };
  }
}

/** Position `dtMs` ahead along `v` (px/s), damped by `gain` (< 1 trades a little lag for less overshoot at reversals). */
export const predict = (x: number, v: number, dtMs: number, gain: number): number => x + v * (dtMs / 1000) * gain;
