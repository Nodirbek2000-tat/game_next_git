// The sparring partner's animation as plain numbers (no three.js): idle sway, guard, holding pads, wind-up, strike, recover,
// hit reaction and knockdown. The 3D rig (partner3d.ts) only applies these numbers. Partner-local axes: x = world x, y up, z towards the player. Hand 0 is the hand with x < 0 (the screen-left glove), hand 1 x > 0.

import { RECOVER_SEC, STRIKE_SEC } from "./config";
import type { AttackKind } from "./combat";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeIn = (k: number): number => k * k;
const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);

// ------------------------------------------------------------------------------------------------ two-bone IK

/**
 * Two-bone IK (arm or leg): shoulder S, target T, bone lengths a (upper) and b (lower), `pole` = where the joint bends towards
 * (a direction). Writes the joint (elbow / knee) to out[0..2] and the end point actually reached (T, or the point on the way
 * to it when it is too far / too near) to out[3..5].
 */
export function ik2(
  sx: number, sy: number, sz: number,
  tx: number, ty: number, tz: number,
  a: number, b: number,
  px: number, py: number, pz: number,
  out: Float64Array,
): void {
  let dx = tx - sx;
  let dy = ty - sy;
  let dz = tz - sz;
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1e-6;
  }
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  const lo = Math.abs(a - b) + 1e-3;
  const hi = a + b - 1e-3;
  const dd = d < lo ? lo : d > hi ? hi : d;
  // distance along the line to the joint's foot point, and the height of the joint over the line
  const x = (a * a - b * b + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  // pole made perpendicular to the line
  const pd = px * ux + py * uy + pz * uz;
  let qx = px - pd * ux;
  let qy = py - pd * uy;
  let qz = pz - pd * uz;
  let ql = Math.hypot(qx, qy, qz);
  if (ql < 1e-6) {
    // pole parallel to the line: any perpendicular
    qx = uy;
    qy = -ux;
    qz = 0;
    ql = Math.hypot(qx, qy, qz) || 1;
  }
  qx /= ql;
  qy /= ql;
  qz /= ql;
  out[0] = sx + ux * x + qx * h;
  out[1] = sy + uy * x + qy * h;
  out[2] = sz + uz * x + qz * h;
  out[3] = sx + ux * dd;
  out[4] = sy + uy * dd;
  out[5] = sz + uz * dd;
}

// ------------------------------------------------------------------------------------------------ strike path

/**
 * The glove's way from the shoulder to the player's face: `s` 0..1 (0 = start, 1 = the glove touches the face),
 * `from` = -1 / +1 the side of the screen it comes from, end point E in partner-local space. Straight: a short line with a
 * small arc; hook: a wide swing from the side.
 */
export function strikePath(kind: AttackKind, from: -1 | 1, s: number, ex: number, ey: number, ez: number, out: Float64Array): void {
  const k = clamp01(s);
  if (kind === "straight") {
    const sx = from * 0.2;
    const sy = 1.5;
    const sz = 0.15;
    out[0] = sx + (ex - sx) * k;
    out[1] = sy + (ey - sy) * k + 0.05 * Math.sin(Math.PI * k);
    out[2] = sz + (ez - sz) * k;
    return;
  }
  // hook: quadratic bezier S -> C -> E'
  const sx = from * 0.6;
  const sy = 1.5;
  const sz = 0.25;
  const cx = from * 0.9;
  const cy = 1.55;
  const cz = (0.25 + ez) * 0.55;
  const fx = ex + from * 0.12;
  const fz = ez + 0.08;
  const u = 1 - k;
  out[0] = u * u * sx + 2 * u * k * cx + k * k * fx;
  out[1] = u * u * sy + 2 * u * k * cy + k * k * ey;
  out[2] = u * u * sz + 2 * u * k * cz + k * k * fz;
}

// ------------------------------------------------------------------------------------------------ the partner

export interface PadTarget {
  on: boolean;
  /** partner-local position of the pad's centre */
  x: number;
  y: number;
  z: number;
  /** 0..1 recoil after a hit (the pad is pushed back) */
  recoil: number;
}

export interface AnimAttack {
  active: boolean;
  kind: AttackKind;
  from: -1 | 1;
  t: number;
  windup: number;
}

export interface AnimInput {
  /** hand 0 / hand 1 */
  pad: [PadTarget, PadTarget];
  attack: AnimAttack;
  /** the player's head (the strike's goal) relative to the partner's root, WITHOUT the partner's lunge */
  faceX: number;
  faceY: number;
  faceZ: number;
  /** knocked down and lying (true) / getting up (false after a knockdown) */
  down: boolean;
}

const GUARD_Y = 1.5;

export class PartnerAnim {
  // ---- outputs (partner-local)
  /** pelvis height offset (bounce, ducking) */
  bob = 0;
  /** root offsets */
  swayX = 0;
  lunge = 0;
  /** chest pitch (+ forward), yaw, roll */
  lean = 0;
  twist = 0;
  roll = 0;
  /** head pitch (+ down) and yaw */
  nod = 0;
  headYaw = 0;
  /** whole body pitched backwards (negative radians) and lowered / pushed back while down */
  fall = 0;
  fallY = 0;
  fallZ = 0;
  /** 0..1 how loaded the punch is (the glove glows red) and which hand */
  glow = 0;
  glowHand = 0;
  /** feet (root-local), lifted a little while stepping */
  footL = new Float64Array(3);
  footR = new Float64Array(3);
  hand: [Float64Array, Float64Array] = [new Float64Array(3), new Float64Array(3)];
  /** phase name for the probe */
  phase: "idle" | "pads" | "windup" | "strike" | "recover" | "down" | "getup" = "idle";

  private flinch = 0;
  private flinchDir = 1;
  private downK = 0;
  private lungeT = 0;
  private scratch = new Float64Array(3);
  private ready = false;

  constructor() {
    this.hand[0].set([-0.2, GUARD_Y, 0.38]);
    this.hand[1].set([0.2, GUARD_Y, 0.38]);
    this.footL.set([-0.2, 0, 0.12]);
    this.footR.set([0.2, 0, -0.12]);
  }

  /** the pad on this side was hit, or the partner took a punch: a short flinch */
  hit(side: 0 | 1): void {
    this.flinch = 1;
    this.flinchDir = side === 0 ? 1 : -1;
  }

  get downProgress(): number {
    return this.downK;
  }

  update(dt: number, t: number, inp: AnimInput): void {
    const atk = inp.attack;
    // ---- knockdown: falls in ~0.9 s, gets up in ~1.6 s
    if (inp.down) this.downK = Math.min(1, this.downK + dt / 0.9);
    else this.downK = Math.max(0, this.downK - dt / 1.6);
    const dk = easeInOut(this.downK);
    this.flinch = Math.max(0, this.flinch - dt / 0.38);
    const fl = easeOut(this.flinch);

    // ---- attack phases
    let ph: PartnerAnim["phase"] = "idle";
    let w = 0;
    let s = 0;
    let r = 0;
    const strikeEnd = atk.windup;
    if (atk.active) {
      if (atk.t < strikeEnd) {
        ph = "windup";
        w = clamp01(atk.t / Math.max(0.05, atk.windup));
      } else if (atk.t < strikeEnd + STRIKE_SEC) {
        ph = "strike";
        s = clamp01((atk.t - strikeEnd) / STRIKE_SEC);
      } else {
        ph = "recover";
        r = clamp01((atk.t - strikeEnd - STRIKE_SEC) / RECOVER_SEC);
      }
    } else if (inp.pad[0].on || inp.pad[1].on) ph = "pads";
    if (this.downK > 0.02) ph = inp.down ? "down" : "getup";
    this.phase = ph;
    const ah = atk.from < 0 ? 0 : 1;
    const sgn = atk.from;

    // ---- body
    const idle = 1 - dk;
    const bounce = Math.sin(t * 11) * 0.5 + 0.5;
    this.bob = (-0.02 - 0.03 * bounce) * idle;
    this.swayX = Math.sin(t * 0.9) * 0.07 * idle;
    const idleTwist = Math.sin(t * 1.3) * 0.08;
    const idleLean = 0.06 + Math.sin(t * 1.7) * 0.03;
    let lean = idleLean;
    let twist = idleTwist;
    let lunge = 0;
    let glow = 0;
    let duck = 0;
    if (ph === "windup") {
      const e = easeInOut(w);
      lean = idleLean - 0.16 * e;
      twist = sgn * 0.5 * e;
      lunge = -0.06 * e;
      duck = 0.05 * e;
      glow = easeIn(w);
    } else if (ph === "strike") {
      const e = easeOut(s);
      lean = -0.1 + 0.55 * e;
      twist = sgn * 0.5 - sgn * 0.95 * e;
      lunge = -0.06 + 0.6 * e;
      glow = 1;
    } else if (ph === "recover") {
      const e = easeInOut(r);
      lean = 0.45 + (idleLean - 0.45) * e;
      twist = -sgn * 0.45 + (idleTwist + sgn * 0.45) * e;
      lunge = 0.54 * (1 - e);
      glow = 1 - r;
    }
    this.glow = glow;
    if (ph === "windup" || ph === "strike" || ph === "recover") this.glowHand = ah;
    // the lunge is smoothed a little so it never jumps
    this.lungeT += (lunge - this.lungeT) * (1 - Math.exp(-dt * 24));
    this.lunge = this.lungeT * idle;
    this.lean = (lean - 0.28 * fl) * idle + dk * -0.2;
    this.twist = twist * idle + fl * 0.18 * this.flinchDir;
    this.roll = fl * 0.1 * this.flinchDir * idle;
    this.nod = (0.04 - 0.05 * fl + duck) * idle + dk * 0.15;
    this.headYaw = Math.sin(t * 0.7) * 0.1 * idle;
    this.bob -= duck;
    // knockdown: pitched backwards about the heels, pushed back and a little off the floor so the back lies on the canvas
    this.fall = -1.5 * dk;
    this.fallY = 0.2 * dk;
    this.fallZ = -0.55 * dk;

    // ---- feet: planted, the front one steps with the lunge
    const step = Math.max(0, this.lunge) * 0.8;
    const fl0 = this.footL;
    const fr0 = this.footR;
    fl0[0] = -0.2;
    fl0[1] = 0.03 * Math.max(0, Math.sin(t * 5.5)) * idle;
    fl0[2] = 0.16 + step * 0.3;
    fr0[0] = 0.2;
    fr0[1] = 0.03 * Math.max(0, Math.sin(t * 5.5 + Math.PI)) * idle;
    fr0[2] = -0.14 + step;
    if (dk > 0.3) {
      // lying: legs relaxed, a little apart
      fl0[0] = -0.28;
      fl0[1] = 0.02;
      fl0[2] = 0.1;
      fr0[0] = 0.28;
      fr0[1] = 0.02;
      fr0[2] = 0;
    }

    // ---- hands
    const k = 1 - Math.exp(-dt * 22);
    for (let i = 0; i < 2; i++) {
      const h = this.hand[i];
      const sg = i === 0 ? -1 : 1;
      const p = inp.pad[i];
      let tx = sg * 0.2;
      let ty = GUARD_Y + Math.sin(t * 11 + i) * 0.015 * idle;
      let tz = 0.38;
      let direct = false;
      if (dk > 0.05) {
        // arms go loose when the partner is down
        tx = sg * 0.42;
        ty = 0.95 - dk * 0.75;
        tz = 0.1 - dk * 0.15;
      } else if (atk.active && i === ah && ph !== "idle" && ph !== "pads") {
        direct = true;
        const sc = this.scratch;
        const ex = inp.faceX;
        const ey = inp.faceY - 0.08;
        const ez = inp.faceZ - this.lunge - 0.42;
        if (ph === "windup") {
          const e = easeInOut(w);
          const shiver = Math.sin(t * 70) * 0.012 * w;
          tx = sg * 0.2 + (sgn * 0.3 - sg * 0.2) * e + shiver;
          ty = GUARD_Y + 0.0 * e + shiver;
          tz = 0.38 + (0.0 - 0.38) * e;
        } else if (ph === "strike") {
          strikePath(atk.kind, atk.from, easeOut(s), ex, ey, ez, sc);
          tx = sc[0];
          ty = sc[1];
          tz = sc[2];
        } else {
          strikePath(atk.kind, atk.from, 1 - easeInOut(r), ex, ey, ez, sc);
          tx = sc[0];
          ty = sc[1];
          tz = sc[2];
        }
      } else if (p.on) {
        tx = p.x;
        ty = p.y;
        tz = p.z - 0.13 - 0.14 * p.recoil;
      }
      if (!this.ready || direct) {
        h[0] = tx;
        h[1] = ty;
        h[2] = tz;
      } else {
        h[0] += (tx - h[0]) * k;
        h[1] += (ty - h[1]) * k;
        h[2] += (tz - h[2]) * k;
      }
    }
    this.ready = true;
  }
}
