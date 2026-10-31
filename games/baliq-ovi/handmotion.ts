// Hand motions of the angler that need their own tracking: the reel crank (a circle drawn in the air, with its direction)
// and the sideways steering of the rod hand. Pure (numbers in, numbers out), unit tested without a camera.

import { clamp, TUNING } from "./rules";

const TAU = Math.PI * 2;

/**
 * Reel crank: the signed turn speed of the hand circling around its own slowly moving centre.
 * `omega` is in circles per second, positive = clockwise on the screen; `rate` is the reeling speed (always >= 0): it is
 * proportional to the circle speed, rises and falls fast (stopping the hand stops the reel at once) and is exactly 0 for jitter,
 * small wiggles, a hand that stands still or one that only moves back and forth (the signed average cancels out).
 */
export class CrankReel {
  omega = 0;
  rate = 0;
  private cx = 0;
  private cy = 0;
  private px = 0;
  private py = 0;
  private has = false;
  private on = false;
  /** how long the position has been exactly the same (a repeated sample of a slower camera, not a stopped hand) */
  private same = 0;

  reset(): void {
    this.has = false;
    this.same = 0;
    this.omega = 0;
    this.rate = 0;
    this.on = false;
  }

  /** (x, y): hand position (stage px), `scale`: body scale (px), `dt`: seconds since the last call (real time), `sensitivity`: a higher one accepts smaller circles. */
  update(dt: number, x: number, y: number, visible: boolean, scale: number, sensitivity = 1): number {
    const R = TUNING.reel;
    if (dt < 0.002) return this.rate;
    if (!visible || scale < 1 || dt > 0.3) {
      this.has = false;
      this.relax(0, dt);
      return this.finish();
    }
    if (!this.has) {
      this.has = true;
      this.cx = this.px = x;
      this.cy = this.py = y;
      this.relax(0, dt);
      return this.finish();
    }
    if (x === this.px && y === this.py) {
      this.same += dt;
      if (this.same < 0.25) return this.rate;
      this.relax(0, dt);
      return this.finish();
    }
    // the time since the previous different sample (frames can repeat a sample of a slower camera)
    dt += this.same;
    this.same = 0;
    const k = 1 - Math.exp(-dt / R.centerTau);
    this.cx += (x - this.cx) * k;
    this.cy += (y - this.cy) * k;
    const ax = this.px - this.cx;
    const ay = this.py - this.cy;
    const bx = x - this.cx;
    const by = y - this.cy;
    const speed = Math.hypot(x - this.px, y - this.py) / dt / scale;
    this.px = x;
    this.py = y;
    let raw = 0;
    const wide = Math.min(Math.hypot(ax, ay), Math.hypot(bx, by)) > (R.minRadius / clamp(sensitivity, 0.5, 1.5)) * scale;
    if (wide && speed > R.stillSpeed) {
      // signed angle from the previous to the current position around the centre (positive = clockwise: y points down)
      const da = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      if (Math.abs(da) < R.maxStep) raw = da / dt / TAU;
    }
    this.relax(raw, dt);
    return this.finish();
  }

  /** Follow `raw` quickly when the turn gets faster and even quicker when it gets slower. */
  private relax(raw: number, dt: number): void {
    const R = TUNING.reel;
    const tau = Math.abs(raw) >= Math.abs(this.omega) && raw * this.omega >= 0 ? R.attack : R.release;
    this.omega += (raw - this.omega) * (1 - Math.exp(-dt / tau));
  }

  private finish(): number {
    const R = TUNING.reel;
    const a = Math.abs(this.omega);
    if (this.on ? a < R.off : a > R.on) this.on = !this.on;
    this.rate = this.on ? Math.min(a, R.max) : 0;
    return this.rate;
  }
}

/**
 * Steering: the sideways position of the rod hand relative to where it has been lately (its "neutral" follows slowly), so
 * it does not matter where the arm hangs. -1 = hand moved fully left, +1 = fully right (screen sides).
 */
export class SteerTracker {
  base = 0;
  side = 0;
  private has = false;

  reset(): void {
    this.has = false;
    this.side = 0;
  }

  /** `yawNorm`: hand offset from the shoulder in body scales; `sensitivity`: a higher value needs less movement. */
  update(dt: number, yawNorm: number, sensitivity = 1): number {
    const S = TUNING.steer;
    if (!this.has) {
      this.has = true;
      this.base = yawNorm;
    }
    this.base += (yawNorm - this.base) * (1 - Math.exp(-dt / S.tau));
    this.side = clamp((yawNorm - this.base) / (S.range / clamp(sensitivity, 0.5, 1.5)), -1, 1);
    return this.side;
  }
}
