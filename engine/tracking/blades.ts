import type { EngineConfig } from "../config";
import { clamp, lerp } from "../math";
import type { Blade, HandInfo, Lm } from "../types";
import { leadMs, predictAccel, velAlpha } from "./prediction";

export const newBlade = (side: "L" | "R"): Blade => ({ active: false, side, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, speed: 0 });

interface State {
  x: number;
  y: number;
  t: number;
  seen: number;
  /** a hand has been seen since the last reset (timestamps may legitimately be 0 in tests) */
  has: boolean;
}

/**
 * Hand "blades": the fast, low-latency hand points games use for slicing / pointing.
 * Source: index fingertip of the hand model if present, else pose index finger / wrist.
 * Short dropouts (<= 140 ms) are bridged by continuing along the last velocity (damped).
 *
 * `update` runs per detection and takes the CAMERA CAPTURE time of the frame, so velocities are real hand speeds
 * (not arrival jitter). `extrapolate` runs per render frame and moves the blade to where the hand is NOW:
 * `capture position + velocity * (now - capture + display lead)`. It also keeps the previous render position so
 * the sweep `px,py -> x,y` the games hit-test is continuous across detections.
 */
export class BladeTracker {
  private st: State[] = [
    { x: 0, y: 0, t: 0, seen: 0, has: false },
    { x: 0, y: 0, t: 0, seen: 0, has: false },
  ];
  // last detection position/velocity (capture time), used for render-rate extrapolation
  private base = [
    { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, k: 0, t: 0 },
    { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, k: 0, t: 0 },
  ];
  // position drawn in the previous frame (start of the next sweep)
  private rx = [0, 0];
  private ry = [0, 0];
  private minVisScale = 1;

  constructor(private cfg: EngineConfig["blade"]) {}

  reset(): void {
    this.st.forEach((s) => ((s.t = 0), (s.seen = 0), (s.has = false)));
  }

  /** 0 (good light) .. 1 (very dark): the pose model reports lower visibility in the dark, accept less. */
  setDarkness(d: number): void {
    this.minVisScale = 1 - 0.4 * clamp(d, 0, 1);
  }

  update(blades: [Blade, Blade], raw: Lm[], hands: { L: HandInfo | null; R: HandInfo | null }, present: boolean, t: number, H: number): void {
    const c = this.cfg;
    const minVis = c.minVis * this.minVisScale;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? "L" : "R";
      const b = blades[i];
      const s = this.st[i];
      const base = this.base[i];
      let px: number | null = null;
      let py: number | null = null;
      if (present) {
        const h = hands[side];
        if (h) {
          px = h.pts[8].x;
          py = h.pts[8].y;
        } else {
          const idx = raw[side === "L" ? 19 : 20];
          const wr = raw[side === "L" ? 15 : 16];
          if (idx.v > minVis) [px, py] = [idx.x, idx.y];
          else if (wr.v > minVis) [px, py] = [wr.x, wr.y];
        }
      }
      if (px !== null && py !== null) {
        let fresh = !b.active;
        if (s.has && t - s.t < c.maxGapMs) {
          const dt = Math.max(0.001, (t - s.t) / 1000);
          const ivx = (px - s.x) / dt;
          const ivy = (py - s.y) / dt;
          let a = velAlpha(dt, c.velTauMs);
          // the hand turned around: trust the new direction at once (less overshoot of the prediction)
          if (b.vx * ivx + b.vy * ivy < 0) a = Math.max(a, 0.92);
          const ovx = b.vx;
          const ovy = b.vy;
          b.vx = lerp(b.vx, ivx, a);
          b.vy = lerp(b.vy, ivy, a);
          // acceleration from the change of the (smoothed) velocity: lets the prediction follow a flick that is still speeding up / braking
          const aa = velAlpha(dt, c.accelTauMs);
          base.ax = lerp(base.ax, (b.vx - ovx) / dt, aa);
          base.ay = lerp(base.ay, (b.vy - ovy) / dt, aa);
        } else {
          b.vx = b.vy = 0;
          base.ax = base.ay = 0;
          fresh = true;
        }
        s.x = px;
        s.y = py;
        s.t = s.seen = t;
        s.has = true;
        base.x = px;
        base.y = py;
        if (fresh) {
          // a new hand: no sweep from wherever the blade was before
          b.x = b.px = this.rx[i] = px;
          b.y = b.py = this.ry[i] = py;
        }
        b.active = true;
      } else if (s.has && t - s.seen < c.dropoutMs) {
        const dt = (t - s.t) / 1000;
        s.x += b.vx * dt * c.dropoutGain;
        s.y += b.vy * dt * c.dropoutGain;
        s.t = t;
        base.x = s.x;
        base.y = s.y;
        b.active = true;
      } else {
        b.active = false;
      }
      b.speed = Math.hypot(b.vx, b.vy) / H;
      // soft dead zone for the PREDICTION only: a resting hand has a little velocity noise which, multiplied by the
      // look-ahead, would make the blade tremble; a moving hand (> ~0.6 screen heights / s) is predicted in full
      base.k = clamp((b.speed - 0.2) / 0.4, 0, 1);
      base.vx = b.vx;
      base.vy = b.vy;
      base.t = s.has ? s.t : t;
    }
  }

  /**
   * Render-rate update: move the blade to where the hand is at `now` (velocity extrapolation, capped at `maxMs`).
   * `lead` is the display latency added on top of the age of the detection.
   */
  extrapolate(blades: [Blade, Blade], now: number, maxMs: number, gain: number, lead = 0): void {
    for (let i = 0; i < 2; i++) {
      const b = blades[i];
      if (!b.active) continue;
      const base = this.base[i];
      const dtMs = leadMs(now, base.t, lead, maxMs);
      const k = base.k;
      const nx = predictAccel(base.x, base.vx * k, base.ax * k, dtMs, gain, this.cfg.accelGain);
      const ny = predictAccel(base.y, base.vy * k, base.ay * k, dtMs, gain, this.cfg.accelGain);
      b.px = this.rx[i];
      b.py = this.ry[i];
      b.x = this.rx[i] = nx;
      b.y = this.ry[i] = ny;
    }
  }
}
