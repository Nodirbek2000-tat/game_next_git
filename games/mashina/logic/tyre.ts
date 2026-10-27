import { clamp } from "@/engine/math";
import type { CarSpec } from "../config";

/**
 * Tyre grip model (pure). Rapier's raycast vehicle limits the tyre force of a wheel to `frictionSlip * load`;
 * we change `frictionSlip` per axle every step:
 *   - the surface (asphalt / grass / wet) scales everything,
 *   - the handbrake and (for rear-wheel-drive cars) a lot of gas take grip from the REAR axle only -> the tail steps out,
 *   - once the rear slides, grip falls further with the slip angle (that is what makes a drift hold),
 *   - the front axle keeps its grip so the car can be steered out of the slide.
 */
export interface GripInput {
  car: CarSpec;
  /** surface grip: asphalt 1, concrete 0.95, grass 0.55 */
  surface: number;
  /** 0 dry .. 1 heavily wet */
  wet: number;
  handbrake: boolean;
  /** 0..1 */
  throttle: number;
  /** body angle against the velocity, rad (absolute) */
  slip: number;
  /** m/s */
  speed: number;
}

export interface Grip {
  front: number;
  rear: number;
}

/** Multiplier of the car's base friction for the front / rear axle. */
export function axleGrip(i: GripInput, out: Grip = { front: 1, rear: 1 }): Grip {
  const base = i.car.grip * i.surface * (1 - 0.35 * clamp(i.wet, 0, 1));
  const bias = i.car.driftBias;
  let rear = 1;
  if (i.handbrake) rear *= 0.6 - 0.2 * bias;
  // power oversteer: only rear-driven cars lose rear grip under heavy throttle at speed
  const power = i.throttle * i.car.driveRear * clamp((i.speed - 6) / 14, 0, 1);
  rear *= 1 - 0.3 * bias * power;
  // sliding already: the tyre gives less (progressive), but never below a floor so the car stays controllable
  // (a dip at moderate slip angles that recovers again when the car is sideways: keeps a slide controllable instead of a spin)
  const slideLoss = clamp((i.slip - 0.15) / 0.3, 0, 1) * (1 - clamp((i.slip - 0.7) / 0.5, 0, 1));
  rear *= 1 - (0.15 + 0.2 * bias) * slideLoss;
  const front = 1 - 0.08 * slideLoss;
  out.front = base * front;
  out.rear = base * Math.max(0.1, rear);
  return out;
}

/** Steering lock as a function of speed (m/s): full lock at a crawl, ~12 % at 40 m/s. */
export function steerLimit(car: CarSpec, speed: number): number {
  return car.steerMax / (1 + (speed / 16) * (speed / 16) * 1.5);
}

/** Engine force factor 0..1 as a function of speed: full at standstill, 0 at the top speed (with a soft knee). */
export function engineCurve(speed: number, top: number): number {
  const r = clamp(Math.abs(speed) / top, 0, 1);
  return 1 - r * r * r;
}

/** Body angle between where the car points and where it moves, rad, signed (0 when almost standing still). */
export function slipAngle(fx: number, fz: number, vx: number, vz: number): number {
  const sp = Math.hypot(vx, vz);
  if (sp < 1) return 0;
  const dot = clamp((fx * vx + fz * vz) / sp, -1, 1);
  const cross = fx * vz - fz * vx;
  const a = Math.acos(dot);
  return cross >= 0 ? a : -a;
}
