// The cast: a ballistic arc for the float / lure, the line that trails behind it while it flies, and the whip of the rod.
// Pure maths (numbers in, numbers out), unit tested; the Angler only feeds it positions and reads results.

import { clamp } from "./rules";

export interface CastPlan {
  /** launch point (rod tip) */
  x0: number;
  y0: number;
  z0: number;
  /** landing point on the water */
  tx: number;
  tz: number;
  waterY: number;
  /** flight time (s) */
  T: number;
  /** gravity used for the arc (m/s^2, tuned so apex and flight time match) */
  g: number;
  /** initial vertical speed */
  vy: number;
  /** apex height above the launch point (m) */
  apex: number;
  /** horizontal drag shape */
  drag: number;
  /** horizontal distance launch -> landing */
  dist: number;
}

export const newCastPlan = (): CastPlan => ({ x0: 0, y0: 0, z0: 0, tx: 0, tz: 0, waterY: 0, T: 1, g: 9.8, vy: 5, apex: 2, drag: 0.6, dist: 1 });

/** Flight time of a cast of `dist` metres (long casts hang in the air longer, but never forever). */
export const flightTime = (dist: number, power: number): number => clamp(0.9 + dist * 0.03 + power * 0.1, 0.9, 2.3);

/** Height of the arc above the launch point: long casts fly high like a real overhead cast. */
export const arcApex = (dist: number, power: number): number => 0.8 + dist * 0.15 + power * 1.0;

/**
 * Plan a cast from the rod tip to (tx, tz). The apex height and the flight time are fixed by the distance and power;
 * gravity and the launch speed are solved so the float lands exactly at `waterY` after `T`.
 */
export function planCast(x0: number, y0: number, z0: number, tx: number, tz: number, waterY: number, power: number, out: CastPlan = newCastPlan()): CastPlan {
  const dist = Math.max(0.5, Math.hypot(tx - x0, tz - z0));
  const T = flightTime(dist, power);
  const H = arcApex(dist, power);
  const drop = Math.max(0.2, y0 - waterY);
  // vy T - g T^2 / 2 = -drop, vy^2 = 2 g H  =>  sqrt(g) = (sqrt(2H) + sqrt(2H + 2 drop)) / T
  const s = (Math.sqrt(2 * H) + Math.sqrt(2 * H + 2 * drop)) / T;
  out.x0 = x0;
  out.y0 = y0;
  out.z0 = z0;
  out.tx = tx;
  out.tz = tz;
  out.waterY = waterY;
  out.T = T;
  out.g = s * s;
  out.vy = Math.sqrt(2 * out.g * H);
  out.apex = H;
  out.drag = 0.6;
  out.dist = dist;
  return out;
}

/** 0..1 progress of the horizontal motion (a little drag: fast at the start, slower at the end). */
export function horizontalProgress(u: number, drag: number): number {
  const k = clamp(u, 0, 1);
  if (drag < 1e-4) return k;
  return (1 - Math.exp(-drag * k)) / (1 - Math.exp(-drag));
}

/** Position of the float `t` seconds after the launch. Writes x, y, z into `out`. */
export function castPos(p: CastPlan, t: number, out: { x: number; y: number; z: number }): void {
  const tt = clamp(t, 0, p.T);
  const h = horizontalProgress(tt / p.T, p.drag);
  out.x = p.x0 + (p.tx - p.x0) * h;
  out.z = p.z0 + (p.tz - p.z0) * h;
  out.y = p.y0 + p.vy * tt - 0.5 * p.g * tt * tt;
}

const tmp = { x: 0, y: 0, z: 0 };

/**
 * The line while the float flies: it trails behind along the path the float has flown (point i is where the float was
 * at time t * i / (n - 1)), fixed to the rod tip at one end. Fills the arrays; returns the length of the polyline.
 */
export function fillTrail(p: CastPlan, t: number, tipX: number, tipY: number, tipZ: number, xs: Float32Array, ys: Float32Array, zs: Float32Array, n: number): number {
  const last = n - 1;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const k = i / last;
    castPos(p, t * k, tmp);
    // the rod tip moves during the whip: blend the offset out along the line
    const w = 1 - k;
    xs[i] = tmp.x + (tipX - p.x0) * w;
    ys[i] = tmp.y + (tipY - p.y0) * w;
    zs[i] = tmp.z + (tipZ - p.z0) * w;
    if (i > 0) len += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1], zs[i] - zs[i - 1]);
  }
  return len;
}

// ---------------------------------------------------------------- the rod whip

/**
 * Two damped springs: the blank's bend (negative = loaded backwards, positive = tip lowered) and the pitch kick of the
 * whole rod. `trigger(power)` loads the rod and releases it: it snaps forward, overshoots, rings and settles in ~1 s.
 */
export class RodWhip {
  bend = 0;
  bendV = 0;
  kick = 0;
  kickV = 0;
  /** seconds since the last trigger (large = at rest) */
  age = 99;

  reset(): void {
    this.bend = this.bendV = this.kick = this.kickV = 0;
    this.age = 99;
  }

  trigger(power: number): void {
    const p = clamp(power, 0, 1);
    this.bend = -(0.55 + 0.75 * p);
    this.bendV = 0;
    this.kick = 0;
    this.kickV = -(3.2 + 3.4 * p);
    this.age = 0;
  }

  /** The hook set: the blank is flung into a deeper bend (towards the fish) and settles on the load of the fight. */
  jerk(speed: number): void {
    this.bendV += speed;
    this.age = 0;
  }

  /** `bendTarget` is where the bend settles (the bend of a rod that carries a float / a fighting fish). */
  step(dt: number, bendTarget = 0, damping = 0.16): void {
    this.age += dt;
    // sub-steps keep the stiff spring stable at low frame rates
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const w = 21; // rad/s, ~3.3 Hz
      const z = damping;
      const a = -w * w * (this.bend - bendTarget) - 2 * z * w * this.bendV;
      this.bendV += a * h;
      this.bend += this.bendV * h;
      const w2 = 10;
      const z2 = 0.5;
      const a2 = -w2 * w2 * this.kick - 2 * z2 * w2 * this.kickV;
      this.kickV += a2 * h;
      this.kick += this.kickV * h;
    }
  }
}
