// Darvozabon: pure logic (smoothing of the keeper's hands / feet, shot targets across the whole goal, flight with perspective,
// saves and goals). No engine imports, no allocation after construction.

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

// ------------------------------------------------------------------ smoothing of the markers (gloves, boots, body)

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

/** Foot point: between the ankle and the tip of the foot. */
export function footPoint(lm: ArrayLike<LmLike>, left: boolean, out: XY): boolean {
  const a = lm[left ? 27 : 28];
  const t = lm[left ? 31 : 32];
  const av = !!a && a.v >= MIN_VIS;
  const tv = !!t && t.v >= MIN_VIS;
  if (av && tv) {
    out.x = a.x + (t.x - a.x) * 0.5;
    out.y = a.y + (t.y - a.y) * 0.5;
    return true;
  }
  if (av) {
    out.x = a.x;
    out.y = a.y;
    return true;
  }
  if (tv) {
    out.x = t.x;
    out.y = t.y;
    return true;
  }
  return false;
}

/** Where the keeper stands: middle of the hips, else the shoulders, else the engine's centre. */
export function bodyX(lm: ArrayLike<LmLike>, fallback: number): number {
  const a = lm[23];
  const b = lm[24];
  if (a && b && a.v >= MIN_VIS && b.v >= MIN_VIS) return (a.x + b.x) / 2;
  const c = lm[11];
  const d = lm[12];
  if (c && d && c.v >= MIN_VIS && d.v >= MIN_VIS) return (c.x + d.x) / 2;
  return fallback;
}

// ------------------------------------------------------------------ where the shots go

/**
 * Horizontal target of a shot, in [xMin, xMax]. `px` = where the keeper stands, `reach` = how far his hands reach from there.
 * Most shots land beyond the reach (to the left or right of the keeper, mostly on the side he is NOT on), some go to the very
 * edges of the goal. `diff` 0..1 makes the sideways distance bigger. A target too close to the previous one is re-rolled.
 */
export function pickX(rand: () => number, px: number, reach: number, xMin: number, xMax: number, diff: number, prevX: number): number {
  const span = xMax - xMin;
  const mid = (xMin + xMax) / 2;
  let x = mid;
  for (let tries = 0; tries < 4; tries++) {
    if (rand() < 0.17 + 0.2 * diff) {
      const left = px > mid ? rand() < 0.72 : rand() < 0.28;
      const f = rand() * 0.07;
      x = left ? xMin + f * span : xMax - f * span;
    } else {
      const right = px < mid ? rand() < 0.65 : rand() < 0.35;
      const dist = reach * (1.1 + rand() * (0.8 + diff));
      const s = right ? 1 : -1;
      x = px + s * dist;
      if (x < xMin || x > xMax) x = px - s * dist;
      x = clamp(x, xMin, xMax);
    }
    if (Math.abs(x - prevX) >= 0.14 * span) return x;
  }
  return x;
}

/** Height of a shot: low (about the ankles, for the feet), at the hands, or high (above the head). `lowOk` = the legs are visible. */
export function pickY(rand: () => number, nose: number, shoulder: number, hip: number, ankle: number, lowOk: boolean, yMin: number, yMax: number): number {
  const r = rand();
  let y: number;
  if (lowOk && r < 0.3) y = ankle - rand() * (ankle - hip) * 0.3;
  else if (r < 0.74) y = shoulder + rand() * ((lowOk ? hip : hip + (hip - shoulder) * 0.5) - shoulder);
  else {
    const top = nose - (shoulder - nose) * 1.2;
    y = top + rand() * (shoulder - top);
  }
  return clamp(y, yMin, yMax);
}

// ------------------------------------------------------------------ shots

/** depth at the end of the flight (1 = far, ZN = at the keeper): the ball is 1/ZN times bigger when it arrives */
export const ZN = 0.2;
/** a ball can be stopped once it has flown this far (0..1 of the flight time) */
export const SAVE_FROM = 0.7;

/** 0 at the striker, 1 at the target, with perspective: slow in the distance, fast at the end */
export function depth(k: number): number {
  const z = 1 - (1 - ZN) * k;
  return (1 / z - 1) / (1 / ZN - 1);
}
/** apparent radius at flight progress k (rMax when it arrives) */
export function ballR(k: number, rMax: number): number {
  return (rMax * ZN) / (1 - (1 - ZN) * k);
}

/** distance from point (px,py) to the segment a-b */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-6 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** shot states */
export const WINDUP = 0;
export const FLYING = 1;
export const SAVED = 2;
export const GOAL = 3;
export interface Shot {
  active: boolean;
  /** WINDUP | FLYING | SAVED | GOAL */
  state: number;
  /** seconds of windup left (the target is already shown, the ball not yet flying) */
  wind: number;
  windTotal: number;
  t: number;
  dur: number;
  /** 0..1 flight progress */
  k: number;
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  /** sideways bulge (px) in the middle of the flight, and lob height (px) */
  curve: number;
  lob: number;
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  spin: number;
  vx: number;
  vy: number;
  hold: number;
  holdTotal: number;
}

/** event types */
export const EV_KICK = 0;
export const EV_SAVE = 1;
export const EV_GOAL = 2;
export interface Ev {
  type: number;
  x: number;
  y: number;
  r: number;
  /** a save made with a foot */
  foot: boolean;
  /** index of the blocker that made the save */
  who: number;
}

const newShot = (): Shot => ({
  active: false, state: WINDUP, wind: 0, windTotal: 1, t: 0, dur: 1, k: 0, ox: 0, oy: 0, tx: 0, ty: 0, curve: 0, lob: 0,
  x: 0, y: 0, px: 0, py: 0, r: 10, spin: 0, vx: 0, vy: 0, hold: 0, holdTotal: 1,
});

export class Shots {
  readonly pool: Shot[] = [];
  readonly ev: Ev[] = [];
  nEv = 0;
  constructor(n = 4) {
    for (let i = 0; i < n; i++) this.pool.push(newShot());
    for (let i = 0; i < 12; i++) this.ev.push({ type: EV_KICK, x: 0, y: 0, r: 0, foot: false, who: 0 });
  }
  private push(type: number, x: number, y: number, r: number, foot = false, who = 0): void {
    if (this.nEv >= this.ev.length) return;
    const e = this.ev[this.nEv++];
    e.type = type;
    e.x = x;
    e.y = y;
    e.r = r;
    e.foot = foot;
    e.who = who;
  }
  get busy(): number {
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i].active) n++;
    return n;
  }
  /** a shot from (ox,oy) to the target (tx,ty): `wind` seconds of windup (target shown), then `dur` seconds of flight */
  spawn(ox: number, oy: number, tx: number, ty: number, dur: number, wind: number, curve: number, lob: number): Shot | null {
    let s: Shot | null = null;
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) {
        s = this.pool[i];
        break;
      }
    }
    if (!s) return null;
    s.active = true;
    s.state = WINDUP;
    s.wind = s.windTotal = Math.max(0.05, wind);
    s.t = 0;
    s.k = 0;
    s.dur = Math.max(0.2, dur);
    s.ox = ox;
    s.oy = oy;
    s.tx = tx;
    s.ty = ty;
    s.curve = curve;
    s.lob = lob;
    s.x = s.px = ox;
    s.y = s.py = oy;
    s.r = 0;
    s.spin = 0;
    s.vx = s.vy = 0;
    s.hold = 0;
    return s;
  }
  /** position of the ball on its path at flight progress k */
  place(s: Shot, k: number): void {
    const w = depth(k);
    const bell = 4 * w * (1 - w);
    s.x = s.ox + (s.tx - s.ox) * w + s.curve * bell;
    s.y = s.oy + (s.ty - s.oy) * w - s.lob * bell;
  }
  /**
   * Advances every shot. Blockers (bx, by, reach br, foot flag) are the smoothed gloves / boots. Events (kick, save, goal) are
   * collected in `ev[0..nEv)`; the caller sets `nEv = 0` first.
   */
  update(dt: number, bx: ArrayLike<number>, by: ArrayLike<number>, br: ArrayLike<number>, bfoot: ArrayLike<number>, n: number, rMax: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const s = this.pool[i];
      if (!s.active) continue;
      s.spin += dt * (s.state === FLYING ? 5 : 3);
      if (s.state === WINDUP) {
        s.wind -= dt;
        s.r = ballR(0, rMax);
        if (s.wind <= 0) {
          s.state = FLYING;
          s.t = 0;
          this.push(EV_KICK, s.ox, s.oy, s.r);
        }
      } else if (s.state === FLYING) {
        s.t += dt;
        const k = Math.min(1, s.t / s.dur);
        s.px = s.x;
        s.py = s.y;
        s.k = k;
        this.place(s, k);
        s.r = ballR(k, rMax);
        if (k >= SAVE_FROM) {
          for (let j = 0; j < n; j++) {
            if (segDist(bx[j], by[j], s.px, s.py, s.x, s.y) < s.r * 0.8 + br[j]) {
              s.state = SAVED;
              s.hold = s.holdTotal = 0.55;
              let dx = s.x - bx[j];
              let dy = s.y - by[j];
              const l = Math.hypot(dx, dy);
              if (l > 1) {
                dx /= l;
                dy /= l;
              } else {
                dx = s.tx < s.ox ? -1 : 1;
                dy = 0;
              }
              s.vx = dx * 380 + (s.tx - s.ox) * 0.15;
              s.vy = dy * 260 - 360;
              this.push(EV_SAVE, s.x, s.y, s.r, bfoot[j] === 1, j);
              break;
            }
          }
        }
        if (s.state === FLYING && k >= 1) {
          s.state = GOAL;
          s.hold = s.holdTotal = 0.9;
          this.push(EV_GOAL, s.x, s.y, s.r);
        }
      } else if (s.state === SAVED) {
        s.hold -= dt;
        s.vy += 1200 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.hold <= 0) s.active = false;
      } else {
        s.hold -= dt;
        if (s.hold <= 0) s.active = false;
      }
    }
  }
}

// ------------------------------------------------------------------ difficulty

/** 0..1 from the number of shots already fired */
export const difficulty = (fired: number): number => clamp(fired / 30, 0, 1);
/** flight time of a shot (s) */
export const flightTime = (diff: number): number => 1.75 - 0.75 * diff;
/** time between two regular shots (s) */
export const shotGap = (diff: number): number => 2.6 - 1.1 * diff;
/** chance that a shot is followed by a second one right after it */
export const doubleChance = (fired: number, diff: number): number => (fired < 6 ? 0 : 0.1 + 0.18 * diff);
