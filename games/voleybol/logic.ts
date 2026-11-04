// Voleybol: pure logic - a ball with gravity, air drag, spin (Magnus), wind and walls, hit by hands / head; calm smoothed hand
// markers. No engine imports, no allocation after construction.

export interface LmLike {
  x: number;
  y: number;
  v: number;
}
export interface XY {
  x: number;
  y: number;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const MIN_VIS = 0.3;

// ------------------------------------------------------------------ calm markers

/** One smoothed point. `on` = it is shown (it survives a short dropout of the landmark). */
export interface Sm {
  x: number;
  y: number;
  /** px/s, low-passed */
  vx: number;
  vy: number;
  on: boolean;
  lost: number;
}
export const newSm = (): Sm => ({ x: 0, y: 0, vx: 0, vy: 0, on: false, lost: 0 });

/** a lost landmark is kept this long (s) before the marker disappears */
export const SM_HOLD = 0.18;
/** dead zone in body-scale units: the target has to move farther than this from the marker before the marker follows */
export const SM_DEAD = 0.07;

/**
 * Extra smoothing on top of the engine's One Euro landmarks. A target inside the dead zone does not move the marker at all
 * (a standing player is perfectly calm); outside it the marker follows fast (time constant 60 ms for small steps, 15 ms for
 * big ones), so a real move is at the marker within ~100 ms.
 */
export function smUpdate(s: Sm, ok: boolean, tx: number, ty: number, dt: number, scale: number, dead = SM_DEAD, tauSlow = 0.06, tauFast = 0.015): void {
  if (!ok) {
    s.lost += dt;
    if (s.lost > SM_HOLD) {
      s.on = false;
      s.vx = s.vy = 0;
    }
    return;
  }
  s.lost = 0;
  if (!s.on) {
    s.x = tx;
    s.y = ty;
    s.vx = s.vy = 0;
    s.on = true;
    return;
  }
  const dx = tx - s.x;
  const dy = ty - s.y;
  const d = Math.hypot(dx, dy);
  let mx = 0;
  let my = 0;
  if (d > dead * scale) {
    const e = d - dead * scale;
    const tau = tauSlow + (tauFast - tauSlow) * clamp(e / (scale * 0.4), 0, 1);
    const f = (e * (1 - Math.exp(-dt / tau))) / d;
    mx = dx * f;
    my = dy * f;
  }
  s.x += mx;
  s.y += my;
  if (dt > 0) {
    const a = 1 - Math.exp(-dt / 0.06);
    s.vx += (mx / dt - s.vx) * a;
    s.vy += (my / dt - s.vy) * a;
  }
}

/** Palm centre of one hand: between the wrist and the index finger. false when neither is visible. */
export function handPoint(lm: ArrayLike<LmLike>, left: boolean, out: XY): boolean {
  const w = lm[left ? 15 : 16];
  const i = lm[left ? 19 : 20];
  const wv = !!w && w.v >= MIN_VIS;
  const iv = !!i && i.v >= MIN_VIS;
  if (wv) {
    // the pull towards the finger fades in with the finger's visibility: no jump when the finger flickers in and out
    const t = iv ? 0.45 * clamp((i.v - MIN_VIS) / 0.4, 0, 1) : 0;
    out.x = w.x + (i.x - w.x) * t;
    out.y = w.y + (i.y - w.y) * t;
    return true;
  }
  if (iv) {
    out.x = i.x;
    out.y = i.y;
    return true;
  }
  return false;
}

/** Top of the head: nose averaged with the ears (steadier than the nose alone), a little above. */
export function headPoint(lm: ArrayLike<LmLike>, headR: number, out: XY): boolean {
  const n = lm[0];
  if (!n || n.v < MIN_VIS) return false;
  const a = lm[7];
  const b = lm[8];
  let x = n.x;
  let y = n.y;
  if (a && b && a.v >= MIN_VIS && b.v >= MIN_VIS) {
    x = (n.x + (a.x + b.x) / 2) / 2;
    y = (n.y + (a.y + b.y) / 2) / 2;
  }
  out.x = x;
  out.y = y - headR * 0.25;
  return true;
}

// ------------------------------------------------------------------ the ball

export interface Field {
  w: number;
  h: number;
  /** y of the floor line: the ball touches it at floor - r */
  floor: number;
}

export interface VBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** rad/s, positive = clockwise on the screen */
  spin: number;
  /** seconds until the ball can be hit again */
  cool: number;
  /** false after it dropped: it only bounces to rest */
  alive: boolean;
}

export const newBall = (): VBall => ({ x: 0, y: 0, vx: 0, vy: 0, r: 30, spin: 0, cool: 0, alive: true });

export function launch(b: VBall, x: number, y: number, vx: number, vy = 0): void {
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
  b.spin = 0;
  b.cool = 0;
  b.alive = true;
}

/** 0..1 from the number of touches: ball gets smaller, falls faster, wind appears */
export const difficulty = (touches: number): number => clamp(touches / 45, 0, 1);
/** gravity in stage heights per second squared */
export const gravity = (diff: number): number => 1.0 + 0.45 * clamp(diff, 0, 1);
/** ball radius factor (smaller when harder) */
export const ballScale = (diff: number): number => 1 - 0.22 * clamp(diff, 0, 1);
/** wind acceleration limit (stage heights / s^2) */
export const windMax = (diff: number): number => Math.max(0, (diff - 0.2) * 0.16);

const DRAG_LIN = 0.05;
const DRAG_QUAD = 0.25;
/** fastest the ball can leave a hand (stage heights / s) */
export const V_MAX = 1.2;
export const HIT_COOL = 0.12;

/**
 * A hand / head at (tx, ty) moving with (tvx, tvy) px/s and reach tr touches the ball. Returns the strength 0..1 of the hit
 * (0 = no hit). The ball always leaves upward: the push direction is the contact normal tilted up (a ball hit on the side flies
 * sideways AND up). Speed = a base lift + a share of the fall speed + a share of the hand speed along the push, so a harder swing
 * sends it higher; a hand held still just bounces it. Spin comes from the sideways hand speed and the side struck.
 */
export function touch(b: VBall, tx: number, ty: number, tvx: number, tvy: number, tr: number, F: Field, head = false): number {
  if (!b.alive || b.cool > 0) return 0;
  const dx = b.x - tx;
  const dy = b.y - ty;
  const d = Math.hypot(dx, dy);
  if (d > b.r + tr) return 0;
  const H = F.h;
  const hx = Math.min(H, F.w * 1.1);
  const nx = d > 1e-3 ? dx / d : 0;
  const ny = d > 1e-3 ? dy / d : -1;
  let px = nx * 0.45;
  let py = Math.min(ny - 0.8, -0.5);
  const pl = Math.hypot(px, py);
  px /= pl;
  py /= pl;
  const push = Math.max(0, tvx * px + tvy * py);
  const fall = Math.max(0, b.vy);
  const out = Math.min(V_MAX * H, (head ? 0.66 : 0.6) * H + 0.25 * fall + 0.45 * push);
  b.vx = clamp(px * out + tvx * 0.3, -0.75 * hx, 0.75 * hx);
  b.vy = Math.min(py * out, -0.55 * H);
  b.spin = clamp((tvx / H) * 8 + nx * 4, -16, 16);
  b.cool = HIT_COOL;
  // out of the hand, so it is not inside it next frame
  b.x = tx + nx * (b.r + tr + 1);
  b.y = ty + ny * (b.r + tr + 1);
  return clamp((out - 0.55 * H) / (0.65 * H), 0.05, 1);
}

/** Highest point (y, px) the ball will reach if nothing touches it (its own y when it is falling). */
export function apexY(b: VBall, g: number, H: number): number {
  return b.vy < 0 ? b.y - (b.vy * b.vy) / (2 * g * H) : b.y;
}

/**
 * Moves the ball: gravity, air drag, wind `ax` (stage heights / s^2), spin curve (Magnus), side walls bounce (spin flips, some
 * speed is lost). The top is open (the ball may leave the screen). The floor bounces it weakly. Returns true when the ball struck
 * the floor in this step (only the first such call matters to the caller).
 */
export function step(b: VBall, dt: number, F: Field, g: number, ax = 0): boolean {
  const H = F.h;
  if (b.cool > 0) b.cool = Math.max(0, b.cool - dt);
  const sp = Math.hypot(b.vx, b.vy);
  const k = Math.max(0, 1 - (DRAG_LIN + (DRAG_QUAD * sp) / H) * dt);
  b.vx *= k;
  b.vy *= k;
  b.vx += (ax * H - 0.012 * b.spin * b.vy) * dt;
  b.vy += g * H * dt;
  b.spin *= Math.max(0, 1 - 0.35 * dt);
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < b.r) {
    b.x = b.r;
    b.vx = Math.abs(b.vx) * 0.8;
    b.spin *= -0.5;
  } else if (b.x > F.w - b.r) {
    b.x = F.w - b.r;
    b.vx = -Math.abs(b.vx) * 0.8;
    b.spin *= -0.5;
  }
  if (b.y < -2.4 * H) {
    b.y = -2.4 * H;
    b.vy = Math.abs(b.vy) * 0.5;
  }
  if (b.y > F.floor - b.r) {
    const hit = b.vy > 0;
    b.y = F.floor - b.r;
    if (hit) {
      b.vy = -b.vy * 0.45;
      if (Math.abs(b.vy) < 0.12 * H) b.vy = 0;
      b.vx *= 0.75;
    }
    return hit;
  }
  return false;
}

/** wind that changes slowly: a target that is re-rolled every 3..7 s and approached smoothly */
export class Wind {
  /** current acceleration (stage heights / s^2) */
  v = 0;
  private tgt = 0;
  private t = 0;
  update(dt: number, diff: number, rand: () => number): void {
    const m = windMax(diff);
    if (m <= 0) {
      this.tgt = 0;
    } else {
      this.t -= dt;
      if (this.t <= 0) {
        this.t = 3 + rand() * 4;
        this.tgt = (rand() < 0.5 ? -1 : 1) * m * (0.4 + 0.6 * rand());
      }
      this.tgt = clamp(this.tgt, -m, m);
    }
    this.v += (this.tgt - this.v) * (1 - Math.exp(-dt / 1.5));
  }
}
