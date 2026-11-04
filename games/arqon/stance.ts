// Body stance from the filtered landmarks: calibrated standing level, jump and duck detection, calm (dead-zone) smoothing.
// Pure code, no engine imports, no allocation per frame. Same file lives in games/arqon and games/engash-sakra.

export interface LmLike {
  x: number;
  y: number;
  v: number;
}

export const MIN_VIS = 0.3;

/** a jump: the body (hips + shoulders) is this many body scales above the standing level ... */
export const JUMP_ON = 0.24;
/** ... and the air state ends when it is back below this */
export const JUMP_OFF = 0.1;
/** ... and it rose by at least this much within GAIN_WIN seconds (a quick move, not a slow drift) */
export const JUMP_GAIN = 0.17;
export const GAIN_WIN = 0.3;
/** the rise must hold for this long (rejects a one frame noise spike) */
export const JUMP_HOLD = 0.04;
export const AIR_MAX = 0.8;
export const DEBOUNCE = 0.12;
/** a duck: head / shoulders this many body scales below the standing level, held for DUCK_HOLD seconds */
export const DUCK_ON = 0.42;
export const DUCK_OFF = 0.25;
export const DUCK_HOLD = 0.09;
export const DUCK_AFTER_LAND = 0.15;
/** calibration: CAL_N samples, one every CAL_DT seconds (about 1.1 s of standing still) */
export const CAL_N = 24;
export const CAL_DT = 0.045;

const HIP = 0;
const SH = 1;
const HEAD = 2;
const FOOT = 3;
const CX = 4;
const NCH = 5;
const W = NCH + 1; // + the body scale
/** a calibration channel counts as steady when its range stays within this many body scales */
const STEADY = [0.12, 0.12, 0.2, 9, 0.5];
const FEET = [27, 28, 31, 32];
const TAU_UP = 0.035;
const HN = 16;

const seen = (p: LmLike | undefined): p is LmLike => !!p && p.v >= MIN_VIS;

/** Hip / shoulder / nose / lowest foot y and the body centre x (px) into `out`; NaN where the part is not seen. */
export function readBody(lm: ArrayLike<LmLike>, out: Float64Array): void {
  const ls = lm[11];
  const rs = lm[12];
  const lh = lm[23];
  const rh = lm[24];
  const nose = lm[0];
  const sh = seen(ls) && seen(rs);
  const hip = seen(lh) && seen(rh);
  out[SH] = sh ? (ls.y + rs.y) / 2 : NaN;
  out[HIP] = hip ? (lh.y + rh.y) / 2 : NaN;
  out[HEAD] = seen(nose) ? nose.y : NaN;
  let f = NaN;
  for (let i = 0; i < FEET.length; i++) {
    const p = lm[FEET[i]];
    if (seen(p) && (f !== f || p.y > f)) f = p.y;
  }
  out[FOOT] = f;
  out[CX] = sh && hip ? (ls.x + rs.x + lh.x + rh.x) / 4 : sh ? (ls.x + rs.x) / 2 : hip ? (lh.x + rh.x) / 2 : NaN;
}

/**
 * Follows a value but ignores changes smaller than a dead zone, so a standing person gives a perfectly still picture,
 * while a real move is followed within about 100 ms.
 */
export class Calm {
  v = NaN;
  update(target: number, dead: number, dt: number, tau = 0.045): number {
    if (!(target === target)) return this.v;
    if (!(this.v === this.v)) {
      this.v = target;
      return target;
    }
    const d = target - this.v;
    const ad = d < 0 ? -d : d;
    if (ad <= dead) return this.v;
    const goal = target - (d < 0 ? -dead : dead) * 0.5;
    this.v += (goal - this.v) * Math.min(1, dt / tau);
    return this.v;
  }
  reset(): void {
    this.v = NaN;
  }
}

export class Stance {
  /** the standing level is known */
  ready = false;
  /** there are body levels at all (false when only the keyboard is used) */
  hasBody = false;
  /** calibration progress 0..1 */
  progress = 0;
  /** body scale (px) the levels are divided by */
  ref = 60;
  time = 0;
  /** how far the body is above the standing level (body scales), lightly smoothed */
  up = 0;
  /** how far head / shoulders are below the standing level (body scales), lightly smoothed */
  depth = 0;
  /** how much `up` rose within the last GAIN_WIN seconds */
  gain = 0;
  air = false;
  airT0 = -99;
  airEnd = -99;
  peak = 0;
  duck = false;
  duckT0 = -99;
  duckEnd = -99;
  /** one frame events */
  jumpFired = false;
  landFired = false;
  duckFired = false;
  /** standing levels (px) */
  readonly base = new Float64Array(NCH);
  private readonly use = [false, false, false, false, false];
  private readonly cur = new Float64Array(NCH);
  private readonly ring = new Float64Array(CAL_N * W);
  private n = 0;
  private acc = 0;
  private calibT = 0;
  private footGap = NaN;
  private readonly ht = new Float64Array(HN);
  private readonly hv = new Float64Array(HN);
  private hi = 0;
  private holdUp = 0;
  private holdDuck = 0;
  private offT = 0;
  private forcedUntil = -1;
  private kJump = false;
  private kDuck = false;

  reset(): void {
    this.ready = false;
    this.hasBody = false;
    this.progress = 0;
    this.n = 0;
    this.acc = 0;
    this.calibT = 0;
    this.up = this.depth = this.gain = 0;
    this.air = this.duck = false;
    this.airT0 = this.airEnd = this.duckT0 = this.duckEnd = -99;
    this.holdUp = this.holdDuck = this.offT = 0;
    this.ht.fill(-99);
    this.hv.fill(0);
    this.use.fill(false);
  }

  /** the player is ducking (body or the down arrow key) */
  get isDuck(): boolean {
    return this.duck || this.kDuck;
  }

  /** standing x (px) */
  get x(): number {
    return this.use[CX] ? this.base[CX] : NaN;
  }
  /** standing nose y (px), NaN when unknown */
  get headY(): number {
    return this.use[HEAD] ? this.base[HEAD] : NaN;
  }
  /** standing hip y (px), NaN when unknown */
  get hipY(): number {
    return this.use[HIP] ? this.base[HIP] : NaN;
  }
  /** standing shoulder y (px), NaN when unknown */
  get shY(): number {
    return this.use[SH] ? this.base[SH] : NaN;
  }
  /** y (px) of the floor under the standing player; follows slow moves of the body, NaN without a body */
  get groundY(): number {
    const anchor = this.use[HIP] ? this.base[HIP] : this.use[SH] ? this.base[SH] : NaN;
    if (!(anchor === anchor)) return NaN;
    if (this.footGap === this.footGap) return anchor + this.footGap;
    return anchor + (this.use[HIP] ? 2.3 : 4.0) * this.ref;
  }

  /** Use the keyboard only (no calibration needed). */
  skipCalibration(): void {
    this.ready = true;
    this.progress = 1;
  }

  update(dt: number, lm: ArrayLike<LmLike> | null, scale: number, keyJump = false, keyDuck = false): void {
    this.time += dt;
    this.jumpFired = this.landFired = this.duckFired = false;
    this.kDuck = keyDuck;
    if (keyJump && !this.kJump) {
      this.forcedUntil = this.time + 0.45;
      if (!this.air) this.startAir();
    }
    this.kJump = keyJump;
    if (lm) readBody(lm, this.cur);
    else this.cur.fill(NaN);
    if (!this.ready) {
      if (lm) this.calibrate(dt, scale);
      if (!this.ready) {
        this.fsm(dt, 0);
        return;
      }
    }
    if (this.hasBody && lm) this.track(dt, scale);
    else this.fsm(dt, 0);
  }

  // ---------------------------------------------------------------- calibration
  private calibrate(dt: number, scale: number): void {
    this.calibT += dt;
    this.acc += dt;
    if (this.acc < CAL_DT) return;
    this.acc = this.acc > 2 * CAL_DT ? 0 : this.acc - CAL_DT;
    const o = (this.n % CAL_N) * W;
    for (let c = 0; c < NCH; c++) this.ring[o + c] = this.cur[c];
    this.ring[o + NCH] = scale;
    this.n++;
    const m = Math.min(this.n, CAL_N);
    this.progress = Math.min(0.98, m / CAL_N);
    if (this.tryCalibrate(false)) return;
    if (this.calibT > 4.5 && m >= 6) this.tryCalibrate(true);
  }

  private tryCalibrate(force: boolean): boolean {
    const m = Math.min(this.n, CAL_N);
    if (m < (force ? 6 : CAL_N)) return false;
    let ref = 0;
    for (let s = 0; s < m; s++) ref += this.ring[s * W + NCH];
    ref = Math.max(30, ref / m);
    let steadyAll = true;
    let any = false;
    const u = this.use;
    for (let c = 0; c < NCH; c++) {
      let cnt = 0;
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      for (let s = 0; s < m; s++) {
        const v = this.ring[s * W + c];
        if (v !== v) continue;
        cnt++;
        sum += v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const have = cnt >= (c === FOOT ? 0.6 : 0.8) * m;
      const range = (hi - lo) / ref;
      const steady = have && range <= STEADY[c];
      u[c] = have && (c === FOOT || c === CX || steady || force);
      this.base[c] = have ? sum / cnt : NaN;
      if (c === HIP || c === SH) {
        if (have) any = true;
        if (have && !steady) steadyAll = false;
        // the person is clearly moving about: start the window again
        if (have && range > STEADY[c] * 2.2 && !force) {
          this.n = 0;
          this.progress = 0;
          return false;
        }
      }
    }
    if (!any || (!steadyAll && !force)) return false;
    if (!u[HIP] && !u[SH]) return false;
    this.ref = ref;
    this.hasBody = true;
    this.ready = true;
    this.progress = 1;
    const anchor = u[HIP] ? this.base[HIP] : this.base[SH];
    this.footGap = u[FOOT] ? this.base[FOOT] - anchor : NaN;
    this.ht.fill(-99);
    this.hi = 0;
    this.up = this.depth = 0;
    return true;
  }

  // ---------------------------------------------------------------- tracking
  private track(dt: number, scale: number): void {
    const c = this.cur;
    const b = this.base;
    const use = this.use;
    const ref = this.ref;
    // how far above the standing level (+) or below (-), per part
    const rHip = use[HIP] && c[HIP] === c[HIP] ? (b[HIP] - c[HIP]) / ref : NaN;
    const rSh = use[SH] && c[SH] === c[SH] ? (b[SH] - c[SH]) / ref : NaN;
    const rHead = use[HEAD] && c[HEAD] === c[HEAD] ? (b[HEAD] - c[HEAD]) / ref : NaN;
    let u = NaN;
    if (rHip === rHip && rSh === rSh) u = (rHip + rSh) / 2;
    else if (rHip === rHip) u = rHip;
    else if (rSh === rSh) u = rSh;
    let d = NaN;
    if (rHead === rHead) d = rSh === rSh ? -(0.65 * rHead + 0.35 * rSh) : -rHead;
    else if (rSh === rSh) d = -rSh;
    const a = 1 - Math.exp(-dt / TAU_UP);
    if (u === u) this.up += (u - this.up) * a;
    if (d === d) this.depth += (d - this.depth) * a;
    this.fsm(dt, 1);

    // the standing level follows a slow drift (the player stepped closer / back), but not a jump or a duck
    const active = this.air || this.duck || this.time < this.forcedUntil;
    const off = Math.max(Math.abs(this.up), this.depth);
    if (!active && off < 0.45) {
      this.offT = 0;
      const tau = off < 0.12 ? 2.5 : 7;
      this.follow(dt / tau, scale);
    } else {
      this.offT += dt;
      if (this.offT > 2.5) {
        // the new height is permanent: take it over
        this.follow(dt / 0.4, scale);
        if (this.duck && this.depth < DUCK_ON) this.endDuck();
      }
    }
  }

  private follow(k: number, scale: number): void {
    const f = Math.min(1, k);
    const c = this.cur;
    const b = this.base;
    for (let i = 0; i < NCH; i++) if (this.use[i] && c[i] === c[i]) b[i] += (c[i] - b[i]) * f;
    if (scale > 0) this.ref += (Math.max(30, scale) - this.ref) * f * 0.5;
  }

  // ---------------------------------------------------------------- jump / duck state machines
  private startAir(): void {
    this.air = true;
    this.airT0 = this.time;
    this.peak = this.up;
    this.jumpFired = true;
    this.holdUp = 0;
  }

  private endDuck(): void {
    this.duck = false;
    this.duckEnd = this.time;
    this.holdDuck = 0;
  }

  private fsm(dt: number, bodyOn: number): void {
    const t = this.time;
    // recent history of `up` -> how much it rose lately
    this.ht[this.hi] = t;
    this.hv[this.hi] = this.up;
    this.hi = (this.hi + 1) % HN;
    let lo = this.up;
    for (let i = 0; i < HN; i++) if (this.ht[i] >= t - GAIN_WIN && this.hv[i] < lo) lo = this.hv[i];
    this.gain = this.up - lo;

    const forced = t < this.forcedUntil;
    if (!this.air) {
      if (bodyOn && this.up > JUMP_ON && this.gain > JUMP_GAIN && t - this.airEnd > DEBOUNCE) {
        this.holdUp += dt;
        if (this.holdUp >= JUMP_HOLD) this.startAir();
      } else this.holdUp = 0;
    } else {
      if (this.up > this.peak) this.peak = this.up;
      const long = t - this.airT0 > AIR_MAX;
      if (!forced && ((bodyOn && this.up < JUMP_OFF && t - this.airT0 > 0.08) || long || !bodyOn)) {
        this.air = false;
        this.airEnd = t;
        this.landFired = true;
        this.holdUp = 0;
      }
    }

    if (!bodyOn) return;
    if (!this.duck) {
      if (this.depth > DUCK_ON && !this.air && t - this.airEnd > DUCK_AFTER_LAND) {
        this.holdDuck += dt;
        if (this.holdDuck >= DUCK_HOLD) {
          this.duck = true;
          this.duckT0 = t;
          this.duckFired = true;
        }
      } else this.holdDuck = 0;
    } else if (this.depth < DUCK_OFF || this.air) this.endDuck();
  }
}
