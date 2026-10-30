// Car physics for the open city: a planar two-axle vehicle model (bicycle model with load transfer, saturating tyre
// forces, a torque curve with an automatic gearbox, drag, rolling resistance, brakes with a simple ABS, handbrake on the
// rear axle) and collisions against the city plan (buildings as boxes, trees / poles as circles). Pure TS, no three.js.
// Heading h: forward = (sin h, cos h); the car's right = (-cos h, sin h) (x is the car's left, the game convention).

import { clamp } from "@/engine/math";
import { type Box, type Post, groundY } from "./city";

export interface Phys {
  mass: number;
  /** cg to front / rear axle (m) */
  a: number;
  b: number;
  cgH: number;
  width: number;
  len: number;
  wheelR: number;
  /** tyre friction coefficient */
  mu: number;
  /** cornering stiffness per axle (N/rad) */
  cf: number;
  cr: number;
  /** Nm at the crank, rpm */
  torque: number;
  maxRpm: number;
  idleRpm: number;
  gears: number[];
  final: number;
  /** 0..1 share of drive on the rear axle */
  rearDrive: number;
  /** aero: 0.5 * rho * Cd * A */
  drag: number;
  roll: number;
  brake: number;
  /** max road wheel angle at standstill (rad) */
  steer: number;
}

export interface Controls {
  gas: number;
  brake: number;
  /** -1 left .. 1 right */
  steer: number;
  handbrake: boolean;
  reverse: boolean;
}

export interface Hit {
  /** impact speed (m/s) along the contact normal */
  speed: number;
  x: number;
  z: number;
  kind: "wall" | "tree" | "car";
}

const G = 9.81;

export class Car {
  x = 0;
  z = 0;
  y = 0;
  h = 0;
  vx = 0;
  vz = 0;
  /** yaw rate (rad/s, + = turning left) */
  w = 0;
  /** actual road wheel angle (+ = right) */
  delta = 0;
  gear = 1;
  rpm = 900;
  /** forward / lateral speed in the car frame */
  vLong = 0;
  vLat = 0;
  /** accelerations in the car frame (for body pitch / roll and the camera) */
  aLong = 0;
  aLat = 0;
  /** tyre slip for sound / skid marks: 0..1 */
  slip = 0;
  /** slip angles of the rear / front axle (rad) */
  slipR = 0;
  slipF = 0;
  wheelspin = 0;
  shiftT = 0;
  odo = 0;
  /** traction + stability control (on by default; drifting fans can switch it off) */
  assist = true;
  /** ground height under a point (the world may be a warped plan) */
  ground: (x: number, z: number) => number = groundY;

  constructor(public p: Phys) {}

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  place(x: number, z: number, h: number): void {
    this.x = x;
    this.z = z;
    this.h = h;
    this.vx = this.vz = this.w = 0;
    this.gear = 1;
  }

  private torqueAt(rpm: number): number {
    const p = this.p;
    const t = clamp((rpm - p.idleRpm) / (p.maxRpm - p.idleRpm), 0, 1);
    // broad curve: 70 % at idle, peak around 65 %, falling towards the limiter
    return p.torque * (0.7 + 0.3 * Math.sin(Math.PI * Math.min(1, t * 0.78 + 0.1)) - (t > 0.95 ? (t - 0.95) * 6 : 0));
  }

  step(dt: number, c: Controls): void {
    const p = this.p;
    const fx = Math.sin(this.h);
    const fz = Math.cos(this.h);
    const rx = -fz;
    const rz = fx;
    let vLong = this.vx * fx + this.vz * fz;
    const vLat = this.vx * rx + this.vz * rz;
    const speed = Math.hypot(vLong, vLat);
    // ---- steering: less lock at speed, the wheel turns at a finite rate
    // speed-sensitive steering (as a real steering rack + driver do): a full, sudden lock asks for ~1.25x the grip
    // (the tyres slide: smoke, marks), half a lock stays well inside it
    const lock = speed > 4 ? Math.min(p.steer, Math.max(0.035, (1.25 * p.mu * G * (p.a + p.b)) / (speed * speed))) : p.steer;
    const target = clamp(c.steer, -1, 1) * lock;
    this.delta += clamp(target - this.delta, -2.6 * dt, 2.6 * dt);
    // ---- gearbox (automatic; R from the controls)
    const reverse = c.reverse;
    if (reverse) this.gear = -1;
    else if (this.gear < 1) this.gear = 1;
    const ratio = this.gear < 0 ? p.gears[0] * 1.1 : p.gears[this.gear - 1];
    const wheelRpm = (Math.abs(vLong) / p.wheelR) * (60 / (2 * Math.PI));
    const engRpm = Math.max(p.idleRpm, wheelRpm * ratio * p.final);
    this.shiftT = Math.max(0, this.shiftT - dt);
    if (this.gear > 0 && this.shiftT <= 0) {
      if (engRpm > p.maxRpm * 0.93 && this.gear < p.gears.length) {
        this.gear++;
        this.shiftT = 0.25;
      } else if (engRpm < p.maxRpm * 0.42 && this.gear > 1) {
        this.gear--;
        this.shiftT = 0.25;
      }
    }
    this.rpm += (Math.min(p.maxRpm, engRpm + (c.gas > 0.05 && speed < 3 ? c.gas * 2500 : 0)) - this.rpm) * (1 - Math.exp(-10 * dt));
    // ---- loads (static + longitudinal transfer from the last step)
    const L = p.a + p.b;
    const m = p.mass;
    const fzF = Math.max(0.15 * m * G, (m * G * p.b) / L - (m * this.aLong * p.cgH) / L);
    const fzR = Math.max(0.15 * m * G, (m * G * p.a) / L + (m * this.aLong * p.cgH) / L);
    // ---- tyre lateral forces (saturating)
    const vl = Math.max(Math.abs(vLong), 1.2);
    const latF = vLat - this.w * p.a;
    const latR = vLat + this.w * p.b;
    const aF = Math.atan2(latF, vl) - this.delta * Math.sign(vLong || 1);
    const aR = Math.atan2(latR, vl);
    const muR = c.handbrake ? p.mu * 0.45 : p.mu;
    const FyF = -p.mu * fzF * Math.tanh((p.cf * aF) / (p.mu * fzF));
    let FyR = -muR * fzR * Math.tanh((p.cr * aR) / (muR * fzR));
    // ---- longitudinal: drive (with traction limit), brakes (ABS-like limit), handbrake, rolling, drag
    const shifting = this.shiftT > 0.12;
    const tq = shifting ? 0 : this.torqueAt(this.rpm) * clamp(c.gas, 0, 1);
    let drive = (tq * ratio * p.final * 0.88) / p.wheelR * (this.gear < 0 ? -1 : 1);
    if (this.rpm >= p.maxRpm * 0.995 && this.gear > 0) drive *= 0.2;
    const driveR = drive * p.rearDrive;
    const driveF = drive - driveR;
    const capR = Math.sqrt(Math.max(0, (muR * fzR) ** 2 - FyR * FyR));
    const capF = Math.sqrt(Math.max(0, (p.mu * fzF) ** 2 - FyF * FyF));
    const dir = Math.abs(vLong) > 0.3 ? Math.sign(vLong) : 0;
    let brakeF = c.brake * p.brake;
    // traction control (as in every modern car): the rear wheels get at most ~85 % of the grip that is left, so
    // the tail does not step out just because the throttle is floored in a bend
    let FxR = this.assist ? clamp(driveR, -capR * 0.85, capR * 0.85) : clamp(driveR, -capR, capR);
    let FxF = clamp(driveF, -capF, capF);
    // (with traction control the drive never exceeds the grip: no real wheelspin)
    this.wheelspin = this.assist ? 0 : clamp((Math.abs(driveR) - capR) / Math.max(1, capR), 0, 1);
    if (brakeF > 0 && dir !== 0) {
      FxF -= dir * Math.min(brakeF * 0.62, capF);
      FxR -= dir * Math.min(brakeF * 0.38, capR);
    } else if (brakeF > 0) brakeF = 0;
    if (c.handbrake && dir !== 0) FxR -= dir * Math.min(m * G * 0.5, capR);
    // when the grip goes into braking / drive, the lateral grip of that axle shrinks (friction circle)
    const useR = Math.min(1, Math.abs(FxR) / Math.max(1, muR * fzR));
    FyR *= Math.sqrt(Math.max(0.05, 1 - useR * useR));
    const fRoll = -p.roll * m * G * Math.tanh(vLong * 2);
    const fDrag = -p.drag * vLong * speed;
    const cd = Math.cos(this.delta);
    const sd = Math.sin(this.delta);
    let Flong = FxR + FxF * cd - FyF * sd + fRoll + fDrag;
    const Flat = FyR + FyF * cd + FxF * sd;
    // standing still: no creep, no jitter
    if (speed < 0.4 && c.gas < 0.05) {
      Flong = -vLong * m * 4;
      this.w *= 0.8;
    }
    // ---- integrate (world frame)
    const ax = (Flong * fx + Flat * rx) / m;
    const az = (Flong * fz + Flat * rz) / m;
    this.vx += ax * dt;
    this.vz += az * dt;
    const I = m * (L * L + p.width * p.width) / 12 * 1.15;
    let torque = -p.a * FyF * cd + p.b * FyR;
    // stability control (ESC): the yaw rate the driver asks for (steering x speed, capped by the grip); when the car
    // rotates faster than that (oversteer / a spin) a counter torque brings it back, like ESC braking one wheel
    // (pulling the handbrake overrides it, as in a sport mode: handbrake drifts stay possible)
    if (this.assist && speed > 4 && !c.handbrake) {
      const want = clamp((-vLong * Math.tan(this.delta)) / L, -(p.mu * G) / speed, (p.mu * G) / speed);
      const err = this.w - want;
      if (Math.abs(err) > 0.08) torque -= err * I * 7;
      // and some straight-line calm: no steering -> the yaw dies out
      if (Math.abs(this.delta) < 0.01) torque -= this.w * I * 2.5;
    }
    this.w += (torque / I) * dt;
    if (speed < 2) this.w *= Math.exp(-8 * dt);
    this.h += this.w * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    vLong = this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
    this.vLong = vLong;
    this.vLat = this.vx * -Math.cos(this.h) + this.vz * Math.sin(this.h);
    this.aLong += (Flong / m - this.aLong) * (1 - Math.exp(-8 * dt));
    this.aLat += (Flat / m - this.aLat) * (1 - Math.exp(-8 * dt));
    this.slipR = Math.abs(aR);
    this.slipF = Math.abs(aF);
    this.slip = clamp(Math.max(Math.abs(aR), Math.abs(aF) * 0.6) * (speed > 6 ? 3 : 0) - 0.25 + this.wheelspin, 0, 1);
    this.odo += speed * dt;
    // curb: the body rides up onto the pavement
    const gy = this.ground(this.x, this.z);
    this.y += (gy - this.y) * (1 - Math.exp(-14 * dt));
  }

  /** Push the car out of boxes / circles; returns the hardest hit (or null). */
  collide(boxes: readonly Box[], posts: readonly Post[]): Hit | null {
    const p = this.p;
    const fx = Math.sin(this.h);
    const fz = Math.cos(this.h);
    const r = p.width / 2;
    const offs = [p.len / 2 - r, 0, -(p.len / 2 - r)];
    let hit: Hit | null = null;
    for (const o of offs) {
      for (let pass = 0; pass < 2; pass++) {
        const cx = this.x + fx * o;
        const cz = this.z + fz * o;
        let nx = 0;
        let nz = 0;
        let pen = 0;
        let kind: Hit["kind"] = "wall";
        for (const b of boxes) {
          if (cx < b.x0 - r || cx > b.x1 + r || cz < b.z0 - r || cz > b.z1 + r) continue;
          const qx = clamp(cx, b.x0, b.x1);
          const qz = clamp(cz, b.z0, b.z1);
          let dx = cx - qx;
          let dz = cz - qz;
          let d = Math.hypot(dx, dz);
          if (d < 1e-6) {
            // centre inside the box: out through the nearest side
            const sides = [cx - b.x0, b.x1 - cx, cz - b.z0, b.z1 - cz];
            const k = sides.indexOf(Math.min(...sides));
            dx = k === 0 ? -1 : k === 1 ? 1 : 0;
            dz = k === 2 ? -1 : k === 3 ? 1 : 0;
            d = -sides[k];
          } else {
            dx /= d;
            dz /= d;
          }
          if (r - d > pen) {
            pen = r - d;
            nx = dx;
            nz = dz;
            kind = "wall";
          }
        }
        for (const c of posts) {
          if (c.r <= 0) continue;
          const dx = cx - c.x;
          const dz = cz - c.z;
          const d = Math.hypot(dx, dz);
          if (d < r + c.r && r + c.r - d > pen && d > 1e-6) {
            pen = r + c.r - d;
            nx = dx / d;
            nz = dz / d;
            kind = "tree";
          }
        }
        if (pen <= 0) break;
        this.x += nx * pen;
        this.z += nz * pen;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          // bounce a little, scrub speed along the wall, spin
          this.vx -= 1.25 * vn * nx;
          this.vz -= 1.25 * vn * nz;
          this.vx *= 0.88;
          this.vz *= 0.88;
          this.w += (o / Math.max(1, p.len)) * vn * 0.6 * (fx * nz - fz * nx);
          if (!hit || -vn > hit.speed) hit = { speed: -vn, x: cx - nx * r, z: cz - nz * r, kind };
        }
      }
    }
    return hit;
  }
}

/** Fake gearbox state for the HUD. */
export function gearLabel(c: Car): string {
  return c.gear < 0 ? "R" : c.speed < 0.3 && c.gear === 1 ? "N" : String(c.gear);
}
