import type { EngineConfig } from "../config";
import type { Lm, LegState } from "../types";

/**
 * Knee-lift pedals (right knee = gas, left knee = brake), built so that a pedal can NEVER fire by itself.
 *
 * Why the old version fired by itself: one shared "rest" height (the lower of the two knees) was used for both legs.
 * Any natural asymmetry of the stance (a leg a bit forward, the hips tilted, the body turned, a slightly bent knee) made the
 * higher-reading knee look "lifted" for good, and while one leg was raised for real the shared rest lagged behind as well.
 * A twist of the shoulders (the body scale comes from the shoulder width) moved both knees at once, too.
 *
 * What this does instead:
 *  - a short calibration with both legs on the floor measures each leg's OWN rest height (median of ~1 s, must be still);
 *    starting with one leg already raised works too (the standing leg gives both rests until the other one is seen down);
 *  - lift = (rest - knee) / range, hip-normalised (the hip is the reference of the same leg, scale = body scale);
 *  - the rest of a leg follows slowly only while that leg is clearly down; a lower reading than the rest is never absorbed
 *    while the leg is lifted, a higher reading (leg lower than thought) is followed quickly;
 *  - dead zone with hysteresis, a noise adaptive floor (dim light = jittery knees = larger dead zone) and a ~50 ms debounce;
 *  - the knee must be visible with confidence (hysteresis) or that pedal is 0, there is no hold and no default;
 *  - the leg labels may swap (MediaPipe does that when a knee comes up in front of the other leg): the roles are assigned by
 *    the x order of the knees, not by the label;
 *  - cross checks: the weaker leg is ignored when the other one is lifted much higher; both legs dropping by the same small
 *    amount (a twist, a crouch, a scale jump) is a posture change, not a pedal, and re-bases the rests;
 *  - standing only: a lifted knee must be accompanied by a lifted ankle (a knee that moves alone is noise or a lean).
 */
export interface LegTuning {
  /** sitting on a chair: knee y relative to the hip, no lower clamp, absolute range */
  seated: boolean;
  /** standing: lift (fraction of the leg's own rest height) that means a full pedal */
  range: number;
  /** seated: lift (in body scales) that means a full pedal */
  seatedRange: number;
  /** fraction of a full pedal needed to engage (the noise floor can raise it, never lower it) */
  dead: number;
  minVis: number;
  /** a landmark that was visible stays visible down to this value */
  lostVis: number;
  /** seconds of stillness with both legs down that finish the calibration */
  calibSec: number;
  /** seconds a lift must persist before the pedal engages */
  engageSec: number;
}

export const LEG_TUNING: LegTuning = { seated: false, range: 0.8, seatedRange: 0.3, dead: 0.14, minVis: 0.5, lostVis: 0.35, calibSec: 1, engageSec: 0.05 };

interface Lmk {
  x: number;
  y: number;
  v: number;
}

/** One physical leg (role: left = brake, right = gas). */
class Leg {
  vis = false;
  aVis = false;
  rel = 0;
  aRel = 0;
  base = 0;
  aBase = NaN;
  noise = 0;
  /** lift 0..1 before the dead zone (after the ankle check) */
  k = 0;
  /** lift 0..1 as the camera reads it, for the HUD */
  kShow = 0;
  engT = 0;
  active = false;
  out = 0;
  /** the rest height was seen with this leg down (false right after a raised-leg start) */
  confirmed = true;
  downT = 0;
  overT = 0;
  floor = 0;
  veto = false;
  reset(): void {
    this.vis = this.aVis = false;
    this.base = 0;
    this.aBase = NaN;
    this.noise = 0;
    this.k = this.kShow = 0;
    this.engT = 0;
    this.active = false;
    this.out = 0;
    this.confirmed = true;
    this.downT = this.overT = 0;
    this.floor = 0;
    this.veto = false;
  }
}

/** Landmarks of one label-side leg and their sticky visibility. */
class Pair {
  hip = false;
  knee = false;
  ank = false;
  vis = false;
  aVis = false;
  rel = 0;
  aRel = 0;
  x = 0;
  reset(): void {
    this.hip = this.knee = this.ank = this.vis = this.aVis = false;
  }
}

const CAL_CAP = 200;
const median = (a: Float64Array, n: number): number => {
  const t = Array.from(a.subarray(0, n)).sort((p, q) => p - q);
  return t[n >> 1];
};

export class LegPedals {
  gas = 0;
  brake = 0;
  /** camera reading of the right / left knee lift 0..1 (for the HUD; 0 when the leg is not seen) */
  gasRaw = 0;
  brakeRaw = 0;
  /** dead-zone threshold (0..1) currently in force for each pedal (HUD tick) */
  gasThr = 0;
  brakeThr = 0;
  /** both legs seen right now */
  ok = false;
  /** each leg seen right now */
  okL = false;
  okR = false;
  /** the calibration is done (pedals are 0 until it is) */
  ready = false;
  /** calibration progress 0..1 */
  calib = 0;
  /** standing mode but both knees are at hip height: the player sits */
  sitting = false;
  readonly L = new Leg();
  readonly R = new Leg();

  private t: LegTuning;
  private A = new Pair();
  private B = new Pair();
  private swapped = false;
  // calibration ring
  private n = 0;
  private ct = new Float64Array(CAL_CAP);
  private cl = new Float64Array(CAL_CAP);
  private cr = new Float64Array(CAL_CAP);
  private cal = new Float64Array(CAL_CAP);
  private car = new Float64Array(CAL_CAP);
  private tmp = new Float64Array(CAL_CAP);
  private clock = 0;
  private invT = 0;
  private liftedT = 0;
  private prov = 0;
  private waitT = 0;
  private lostT = 0;
  private cmT = 0;
  private cmOn = false;

  constructor(tuning: Partial<LegTuning> = {}) {
    this.t = { ...LEG_TUNING, ...tuning };
  }

  get seated(): boolean {
    return this.t.seated;
  }

  /** The mean rest height of both legs (0 until calibrated). */
  get rest(): number {
    return this.ready ? (this.L.base + this.R.base) / 2 : 0;
  }

  /** Switch standing / seated. A change of mode needs a new calibration, no change leaves everything as it is. */
  setSeated(seated: boolean): void {
    if (seated === this.t.seated) return;
    this.t.seated = seated;
    this.reset();
  }

  reset(): void {
    this.gas = this.brake = this.gasRaw = this.brakeRaw = 0;
    this.ok = this.okL = this.okR = false;
    this.ready = false;
    this.calib = 0;
    this.sitting = false;
    this.L.reset();
    this.R.reset();
    this.A.reset();
    this.B.reset();
    this.swapped = false;
    this.n = 0;
    this.clock = 0;
    this.invT = this.liftedT = this.waitT = this.lostT = this.cmT = 0;
    this.cmOn = false;
    this.prov = 0;
  }

  /** No player in the picture this frame: pedals 0; after a few seconds the next player has to calibrate again. */
  absent(dt: number): void {
    this.gas = this.brake = this.gasRaw = this.brakeRaw = 0;
    this.ok = this.okL = this.okR = false;
    this.L.out = this.R.out = 0;
    this.L.active = this.R.active = false;
    this.L.engT = this.R.engT = 0;
    this.lostT += dt;
    if (this.lostT > 4 && this.ready) this.reset();
  }

  private seen(was: boolean, v: number): boolean {
    return was ? v >= this.t.lostVis : v >= this.t.minVis;
  }

  private measure(p: Pair, lm: ArrayLike<Lmk>, s: number, hip: number, knee: number, ank: number): void {
    const H = lm[hip];
    const K = lm[knee];
    const A = lm[ank];
    const t0 = this.t.minVis;
    p.hip = this.seen(p.hip, H.v);
    p.knee = this.seen(p.knee, K.v);
    // the ankle is only trusted when it is seen clearly (it vetoes a lift, so a shaky ankle must not decide)
    p.ank = p.ank ? A.v >= t0 : A.v >= t0 + 0.15;
    p.rel = (K.y - H.y) / s;
    p.aRel = (A.y - H.y) / s;
    p.x = K.x;
    p.vis = p.hip && p.knee && Number.isFinite(p.rel);
    p.aVis = p.hip && p.ank && Number.isFinite(p.aRel);
  }

  update(lm: ArrayLike<Lmk>, scale: number, dt: number): void {
    const s = Math.max(1, scale);
    dt = Math.min(0.1, Math.max(0, dt));
    this.clock += dt;
    this.measure(this.A, lm, s, 23, 25, 27);
    this.measure(this.B, lm, s, 24, 26, 28);
    const A = this.A;
    const B = this.B;
    // both legs gone for a few seconds (the player stepped out or is cropped): the next sight calibrates again
    this.lostT = A.vis || B.vis ? 0 : this.lostT + dt;
    if (this.ready && this.lostT > 4) {
      this.reset();
      this.clock = 0;
    }
    // roles: the left leg (brake) is the one whose knee is on the left of the stage (stage is mirrored: person's left = smaller x)
    if (A.vis && B.vis) {
      const d = (A.x - B.x) / s;
      if (d > 0.2) this.swapped = true;
      else if (d < -0.2) this.swapped = false;
    }
    const pl = this.swapped ? B : A;
    const pr = this.swapped ? A : B;
    const L = this.L;
    const R = this.R;
    L.vis = pl.vis;
    L.rel = pl.rel;
    L.aVis = pl.aVis;
    L.aRel = pl.aRel;
    R.vis = pr.vis;
    R.rel = pr.rel;
    R.aVis = pr.aVis;
    R.aRel = pr.aRel;
    this.okL = L.vis;
    this.okR = R.vis;
    this.ok = L.vis && R.vis;

    if (!this.ready) {
      this.calibrate(dt);
      this.gas = this.brake = this.gasRaw = this.brakeRaw = 0;
      L.out = R.out = 0;
      return;
    }
    this.live(dt);
  }

  private plausible(rel: number): boolean {
    return this.t.seated ? rel > -0.9 && rel < 1.6 : rel > 0.3 && rel < 2.2;
  }

  /** both legs on the floor and still for `calibSec`: each leg's own rest height */
  private calibrate(dt: number): void {
    const t = this.t;
    const L = this.L;
    const R = this.R;
    L.k = R.k = L.kShow = R.kShow = 0;
    this.sitting = false;
    if (!(L.vis && R.vis)) {
      this.invT += dt;
      if (this.invT > 0.2) this.n = 0;
      this.liftedT = 0;
      this.calib = 0;
      return;
    }
    this.waitT += dt;
    const hi = Math.max(L.rel, R.rel);
    const lo = Math.min(L.rel, R.rel);
    this.sitting = !t.seated && hi < 0.3 && lo > -1;
    const asymMax = t.seated ? 0.6 * t.seatedRange : 0.24 * Math.max(hi, 0.3);
    const valid = this.plausible(L.rel) && this.plausible(R.rel) && hi - lo <= asymMax;
    if (valid) {
      this.invT = 0;
      this.liftedT = 0;
      if (this.n >= CAL_CAP) this.drop(1);
      const i = this.n++;
      this.ct[i] = this.clock;
      this.cl[i] = L.rel;
      this.cr[i] = R.rel;
      this.cal[i] = L.aVis ? L.aRel : NaN;
      this.car[i] = R.aVis ? R.aRel : NaN;
      // forget what is older than twice the window
      let old = 0;
      while (old < this.n && this.ct[old] < this.clock - t.calibSec * 2.2) old++;
      if (old) this.drop(old);
      const w0 = this.windowStart();
      const span = this.clock - this.ct[0];
      const stable = this.stable(w0);
      this.calib = Math.min(1, span / t.calibSec) * (stable ? 1 : 0.9);
      if (span >= t.calibSec * 0.95 && stable) this.finish(w0);
      else if (this.waitT > 8 && span >= 0.4) this.finish(w0);
      return;
    }
    // not both down: a persistently raised leg (the other one stands) = a raised-leg start
    this.invT += dt;
    if (this.invT > 0.2) this.n = 0;
    this.calib = 0;
    const bothPlausibleHi = this.plausible(hi);
    if (hi - lo > asymMax && bothPlausibleHi) {
      this.liftedT += dt;
      this.prov = this.prov === 0 ? hi : this.prov + (hi - this.prov) * (1 - Math.exp(-dt / 0.2));
      if (this.liftedT >= 0.5) this.finishProvisional();
    } else this.liftedT = 0;
  }

  private drop(k: number): void {
    const m = this.n - k;
    this.ct.copyWithin(0, k, this.n);
    this.cl.copyWithin(0, k, this.n);
    this.cr.copyWithin(0, k, this.n);
    this.cal.copyWithin(0, k, this.n);
    this.car.copyWithin(0, k, this.n);
    this.n = Math.max(0, m);
  }

  private windowStart(): number {
    const t0 = this.clock - this.t.calibSec;
    let i = 0;
    while (i < this.n - 1 && this.ct[i] < t0) i++;
    return i;
  }

  private stable(w0: number): boolean {
    // standard deviation of each leg's reading over the window: a still player (even with a jittery, dim-light picture) passes,
    // a player who is walking, swaying or lifting a leg does not
    const m = this.n - w0;
    for (const a of [this.cl, this.cr]) {
      let sum = 0;
      for (let i = w0; i < this.n; i++) sum += a[i];
      const mean = sum / m;
      let v = 0;
      for (let i = w0; i < this.n; i++) v += (a[i] - mean) * (a[i] - mean);
      const sd = Math.sqrt(v / m);
      const lim = this.t.seated ? 0.035 : 0.05 * Math.max(0.3, Math.abs(mean));
      if (sd > lim) return false;
    }
    return true;
  }

  private med(a: Float64Array, w0: number): number {
    let m = 0;
    for (let i = w0; i < this.n; i++) {
      const v = a[i];
      if (Number.isFinite(v)) this.tmp[m++] = v;
    }
    return m >= Math.max(3, (this.n - w0) * 0.6) ? median(this.tmp, m) : NaN;
  }

  private finish(w0: number): void {
    const L = this.L;
    const R = this.R;
    const m = this.n - w0;
    for (let i = 0; i < m; i++) this.tmp[i] = this.cl[w0 + i];
    L.base = median(this.tmp, m);
    for (let i = 0; i < m; i++) this.tmp[i] = this.cr[w0 + i];
    R.base = median(this.tmp, m);
    L.aBase = this.med(this.cal, w0);
    R.aBase = this.med(this.car, w0);
    L.confirmed = R.confirmed = true;
    L.noise = R.noise = 0.004;
    this.ready = true;
    this.calib = 1;
    this.n = 0;
  }

  /** started with a raised leg: the standing leg (the one with the larger rel) provides both rest heights for now */
  private finishProvisional(): void {
    const L = this.L;
    const R = this.R;
    const standingIsL = L.rel >= R.rel;
    const base = this.prov;
    L.base = R.base = base;
    const ank = standingIsL ? (L.aVis ? L.aRel : NaN) : R.aVis ? R.aRel : NaN;
    L.aBase = R.aBase = ank;
    L.confirmed = standingIsL;
    R.confirmed = !standingIsL;
    L.noise = R.noise = 0.004;
    L.downT = R.downT = 0;
    this.ready = true;
    this.calib = 1;
    this.n = 0;
  }

  private rangeOf(leg: Leg): number {
    return this.t.seated ? this.t.seatedRange : Math.max(0.2, leg.base * this.t.range);
  }

  /** baseline following + lift of one visible leg; returns nothing, fills leg.k / leg.kShow */
  private measureLift(leg: Leg, dt: number): void {
    const t = this.t;
    const range = this.rangeOf(leg);
    const lift = leg.base - leg.rel;
    const kRaw = Math.min(1, Math.max(0, lift / range));
    // ---- rest following
    const cap = t.seated ? leg.base + 0.35 : leg.base * 1.25;
    if (leg.rel > leg.base) {
      if (leg.rel <= cap) {
        leg.base += (leg.rel - leg.base) * (1 - Math.exp(-dt / 0.25));
        leg.overT = 0;
      } else leg.overT += dt;
    } else {
      leg.overT = 0;
      const limit = leg.confirmed ? 0.3 : 0.4;
      if (kRaw < limit && (!leg.active || !leg.confirmed)) leg.base += (leg.rel - leg.base) * (1 - Math.exp(-dt / (leg.confirmed ? 2.5 : 0.5)));
    }
    if (kRaw < 0.15) {
      leg.downT += dt;
      if (leg.downT >= 1) leg.confirmed = true;
    } else leg.downT = 0;
    // ---- ankle rest (standing only; follows the leg while it is down)
    if (!t.seated && leg.aVis && kRaw < 0.3 && !leg.active) {
      if (Number.isNaN(leg.aBase)) {
        if (leg.downT > 0.3) leg.aBase = leg.aRel;
      } else leg.aBase += (leg.aRel - leg.aBase) * (1 - Math.exp(-dt / 1.5));
    }
    // ---- noise (mean absolute deviation of a leg that is down)
    if (kRaw < 0.2) leg.noise += (Math.abs(leg.rel - leg.base) - leg.noise) * (1 - Math.exp(-dt / 1));
    const r2 = this.rangeOf(leg);
    leg.floor = Math.min(0.3, Math.max(t.dead, (3.5 * leg.noise) / r2));
    const k = Math.min(1, Math.max(0, (leg.base - leg.rel) / r2));
    leg.kShow = k;
    // ---- standing: a knee that is lifted alone (no ankle movement) is noise / a lean / a crouch, not a lifted leg
    leg.veto = false;
    let kk = k;
    if (!t.seated && k >= leg.floor && leg.aVis && Number.isFinite(leg.aBase)) {
      const kneeLift = leg.base - leg.rel;
      const ankleLift = leg.aBase - leg.aRel;
      if (ankleLift < (leg.active ? 0.08 : 0.15) * kneeLift) {
        leg.veto = true;
        kk = 0;
      }
    }
    leg.k = kk;
  }

  private live(dt: number): void {
    const L = this.L;
    const R = this.R;
    if (L.vis) this.measureLift(L, dt);
    else L.k = L.kShow = 0;
    if (R.vis) this.measureLift(R, dt);
    else R.k = R.kShow = 0;

    let kl = L.k;
    let kr = R.k;
    // ---- cross checks between the legs
    if (L.vis && R.vis) {
      const el = kl >= L.floor;
      const er = kr >= R.floor;
      const cmNow = el && er && Math.abs(kl - kr) < 0.2 && Math.max(kl, kr) < 0.6;
      // once a posture change is recognised it stays suppressed until both legs are back under their dead zones
      // (otherwise the leg that is a hair slower to settle would leak out as a pedal)
      const cmKeep = this.cmOn && (el || er) && Math.max(kl, kr) < 0.6;
      if (cmNow || cmKeep) {
        this.cmOn = true;
        // both legs dropped by the same small amount: posture (twist, crouch, scale jump), not two pedals
        this.cmT += dt;
        kl = kr = 0;
        if (this.cmT >= 0.35) {
          for (const g of [L, R]) g.base += (g.rel - g.base) * (1 - Math.exp(-dt / 0.35));
        }
      } else {
        this.cmOn = false;
        this.cmT = 0;
        if (el && er) {
          if (kl < 0.5 * kr) kl = 0;
          else if (kr < 0.5 * kl) kr = 0;
        }
      }
      // both legs far lower than their rests for a while (twist made the body scale small): re-base
      if (L.overT > 0.4 && R.overT > 0.4) {
        for (const g of [L, R]) g.base += (g.rel - g.base) * (1 - Math.exp(-dt / 0.2));
      }
    } else {
      this.cmT = 0;
      this.cmOn = false;
    }

    this.pedal(L, kl, dt);
    this.pedal(R, kr, dt);
    this.brake = L.out;
    this.gas = R.out;
    this.brakeRaw = L.vis ? L.kShow : 0;
    this.gasRaw = R.vis ? R.kShow : 0;
    this.brakeThr = L.floor;
    this.gasThr = R.floor;
  }

  /** hysteresis + debounce -> output */
  private pedal(leg: Leg, k: number, dt: number): void {
    if (!leg.vis) {
      leg.out = 0;
      leg.active = false;
      leg.engT = 0;
      return;
    }
    const enter = leg.floor;
    const exit = enter * 0.55;
    if (k >= enter) leg.engT += dt;
    else if (k < exit) {
      leg.engT = 0;
      leg.active = false;
    } else if (!leg.active) leg.engT = 0;
    if (!leg.active && leg.engT >= this.t.engageSec) leg.active = true;
    leg.out = leg.active ? Math.min(1, Math.max(0, (k - exit) / (1 - exit))) : 0;
  }
}

/**
 * The engine's per-player leg values (`PlayerFrame.legs`): the same robust pedals, in the engine's LegState shape.
 * `ok` = both legs seen; gas / brake stay 0 during the first second of calibration.
 */
export class LegCalibrator {
  private pedals: LegPedals;

  constructor(private cfg: EngineConfig["legs"]) {
    this.pedals = new LegPedals({ range: cfg.range, dead: cfg.deadZone + 0.02, minVis: cfg.minVis, lostVis: Math.max(0.2, cfg.minVis - 0.15) });
  }

  reset(): void {
    this.pedals.reset();
  }

  update(lm: Lm[], scale: number, dt: number, out: LegState): LegState {
    const p = this.pedals;
    p.update(lm, scale, dt);
    out.ok = p.ok;
    out.gas = p.gas;
    out.brake = p.brake;
    out.rest = p.ready ? p.rest : this.cfg.defaultRest;
    return out;
  }
}
