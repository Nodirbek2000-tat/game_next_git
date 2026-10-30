// Pure rules of "Baliq ovi": cast, strike, fight/tension/line break, scoring, partner help and the winner.
// Numbers are the prototype's (docs/prototype/harakat-oyinlari.html, class Fishing) and are all configurable.

import type { Rng, SpeciesDef } from "./species";
import { isJunk } from "./species";

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export type GameMode = "yolgiz" | "birgalikda" | "musobaqa";

export interface Tuning {
  kids: boolean;
  /** 0.5 .. 1.5, bigger = easier to trigger gestures */
  sensitivity: number;
}

export const TUNING = {
  cast: {
    /** downward wrist speed (screen heights / s) that counts as the forward flick */
    swingSpeed: 0.95,
    kidsSwingSpeed: 0.7,
    /** the raised hand stays "armed" this long (s) */
    armWindow: 1.6,
    /** minimum time between casts (s) */
    cooldown: 0.6,
    peakMax: 2.6,
    minPower: 0.3,
    baseDist: 8,
    powerDist: 28,
    kidsPowerDist: 18,
    maxYawDeg: 22,
    yawGain: 13,
    flyBase: 0.7,
    flyPower: 0.6,
  },
  strike: { upSpeed: 1.05, kidsUpSpeed: 0.8, window: 0.95, kidsWindow: 1.7, cooldown: 0.6 },
  fight: {
    limit: 1,
    kidsLimit: 1.35,
    // seconds over the limit before the line snaps (the red line is a warning, not an instant loss)
    breakAfter: 1.4,
    /** right after the strike the line forgives more (s): a big fish's first rush does not snap it at once */
    graceT: 3,
    escapeExtra: 18,
    landDist: 1.6,
    netDist: 5,
    // metres of line per reel turn and second: slow enough that a fish comes in bit by bit, not in one go
    reelGain: 0.8,
    kidsPull: 0.6,
    pumpPull: 0.45,
  },
  pump: { upSpeed: 0.9, downSpeed: 0.5, window: 1.2, lowerBonus: 1.6 },
  net: { downWindow: 1.6, hipTol: 0.1, upLift: 0.25, cooldown: 1.2 },
  nibble: { min: 1, max: 3 },
  friendBonus: 200,
  coopGoalKg: 15,
  coopSeconds: 300,
  duelSeconds: 180,
  soloSeconds: 180,
} as const;

const sens = (base: number, s: number): number => base / clamp(s, 0.5, 1.5);

// ---------------------------------------------------------------- cast

export function castPower(peak: number, kids = false): number {
  void kids;
  return clamp(peak / TUNING.cast.peakMax, TUNING.cast.minPower, 1);
}
export function castDistance(power: number, kids: boolean, maxCast = 36): number {
  return Math.min(maxCast, TUNING.cast.baseDist + power * (kids ? TUNING.cast.kidsPowerDist : TUNING.cast.powerDist));
}
/** Hand sideways offset (in shoulder-widths-ish, normalised by body scale) -> cast direction in radians (+ = to the right). */
export function castYaw(yawNorm: number): number {
  return (clamp(yawNorm * TUNING.cast.yawGain, -TUNING.cast.maxYawDeg, TUNING.cast.maxYawDeg) * Math.PI) / 180;
}
export function castFlightTime(power: number): number {
  return TUNING.cast.flyBase + power * TUNING.cast.flyPower;
}

export interface CastResult {
  fired: boolean;
  power: number;
}

/** Raise the rod hand above the shoulder, then flick it forward (downwards in the camera image). */
export class CastDetector {
  armed = false;
  private armedT = 0;
  private peak = 0;
  private since = 10;
  readonly out: CastResult = { fired: false, power: 0 };

  reset(): void {
    this.armed = false;
    this.armedT = 0;
    this.peak = 0;
    this.since = 0;
  }

  /** `down` is the rod wrist speed in screen heights/s (positive = moving down), `key` the keyboard flick. */
  update(dt: number, handUp: boolean, down: number, t: Tuning, key = false): CastResult {
    const c = TUNING.cast;
    const o = this.out;
    o.fired = false;
    o.power = 0;
    this.since += dt;
    if (handUp || key) {
      this.armed = true;
      this.armedT = 0;
    }
    if (this.armed) {
      this.armedT += dt;
      this.peak = Math.max(this.peak, down);
      if (this.armedT > c.armWindow) {
        this.armed = false;
        this.peak = 0;
      }
    }
    const thr = sens(t.kids ? c.kidsSwingSpeed : c.swingSpeed, t.sensitivity);
    if (this.armed && (down > thr || key) && this.since > c.cooldown) {
      o.fired = true;
      o.power = castPower(Math.max(this.peak, down, key ? 2 : 0), t.kids);
      this.armed = false;
      this.peak = 0;
      this.since = 0;
    }
    return o;
  }
}

// ---------------------------------------------------------------- strike

/** Sharp upward pull of the rod hand (`up` = upward speed in screen heights/s). */
export class StrikeDetector {
  private since = 10;
  reset(): void {
    this.since = 10;
  }
  update(dt: number, up: number, t: Tuning, key = false): boolean {
    this.since += dt;
    if ((up > sens(t.kids ? TUNING.strike.kidsUpSpeed : TUNING.strike.upSpeed, t.sensitivity) || key) && this.since > TUNING.strike.cooldown * 0.4) {
      this.since = 0;
      return true;
    }
    return false;
  }
}

export const strikeWindow = (kids: boolean): number => (kids ? TUNING.strike.kidsWindow : TUNING.strike.window);

// ---------------------------------------------------------------- pumping

export interface PumpState {
  /** extra pull while the rod goes up (tension rises, fish comes closer) */
  lift: number;
  /** multiplier on reel speed right after a lift, while the rod comes down and the player keeps reeling */
  lower: number;
}

/** Pumping: rod hand up, then down while reeling. */
export class PumpTracker {
  readonly out: PumpState = { lift: 0, lower: 1 };
  private armedT = 0;
  private liftT = 0;
  reset(): void {
    this.armedT = 0;
    this.liftT = 0;
    this.out.lift = 0;
    this.out.lower = 1;
  }
  /** `vy` = rod wrist velocity in screen heights/s (negative = up). */
  update(dt: number, vy: number, crank: number, t: Tuning, key = false): PumpState {
    const p = TUNING.pump;
    const o = this.out;
    this.armedT = Math.max(0, this.armedT - dt);
    this.liftT = Math.max(0, this.liftT - dt);
    const upThr = sens(p.upSpeed, t.sensitivity);
    o.lift = 0;
    o.lower = 1;
    if (-vy > upThr || key) {
      o.lift = TUNING.fight.pumpPull;
      this.armedT = p.window;
      this.liftT = 0.4;
    } else if (this.armedT > 0 && vy > sens(p.downSpeed, t.sensitivity) && crank > 0.3) {
      o.lower = p.lowerBonus;
    }
    return o;
  }
}

// ---------------------------------------------------------------- fight

export type FightEvent = "none" | "break" | "escape" | "land";

export interface FightParams {
  species: SpeciesDef;
  weight: number;
  startD: number;
  kids: boolean;
  rng: Rng;
}

export interface FightInput {
  /** reel circles per second */
  crank: number;
  /** extra tension from a rod lift (0 or TUNING.fight.pumpPull) */
  pump: number;
  /** reel speed multiplier (pumping bonus) */
  reelMul: number;
  /** rod hand sideways, -1 (left) .. 1 (right): leaning AGAINST a running fish calms it (optional) */
  side?: number;
}

/** 0..1: how well the rod hand leans against the side the fish runs to (hand to the opposite side of the run). */
export function counterPull(runDir: number, side: number): number {
  return clamp((-runDir * side - 0.3) / 0.7, 0, 1);
}

/**
 * The fight: tension T (0..~1.2, red above 0.85), distance D (m) to the rod, fish stamina S, left/right runs and jumps.
 * Ported from the prototype (`Fishing.hook/fight`) with dt based smoothing.
 */
export class FightModel {
  D: number;
  T = 0.3;
  S = 1;
  run = true;
  runT: number;
  /** current retrieve speed (m/s), eased */
  reelV = 0;
  /** seconds since the strike */
  age = 0;
  runDir = 1;
  /** lateral offset of the fish from the casting line (m) */
  lat = 0;
  /** angle of the fish away from the casting line (rad, + = to the right): the rod and the line follow it */
  ang = 0;
  /** widest swing of this fish (rad): bigger and stronger fish pull wider */
  readonly maxAng: number;
  /** how well the player leans against the run right now (0..1) */
  counter = 0;
  /** > 0 while the fish is in the air (s) */
  jumpT = 0;
  /** true on the frame a jump started / a run started */
  jumped = false;
  ranNow = false;
  overT = 0;
  readonly pull: number;
  readonly limit: number;
  readonly startD: number;
  private wob: number;
  constructor(readonly p: FightParams) {
    const { species, weight, kids, rng } = p;
    this.pull = species.power * (0.55 + Math.min(1, weight / 14) * 0.5) * (kids ? TUNING.fight.kidsPull : 1);
    this.limit = kids ? TUNING.fight.kidsLimit : TUNING.fight.limit;
    this.D = this.startD = p.startD;
    this.runT = 1 + rng();
    this.wob = rng() * 6.28;
    this.runDir = rng() < 0.5 ? -1 : 1;
    this.maxAng = 0.1 + species.power * 0.3 + Math.min(1, weight / 10) * 0.1;
  }

  /** -1 / 0 / 1: the side the fish is pulling to right now (0 while it rests) */
  get pullDir(): number {
    return this.run && Math.abs(this.ang) > 0.04 ? Math.sign(this.ang) : 0;
  }

  /** current strain of the line relative to the break limit (1 = about to snap) */
  get strain(): number {
    return this.T / this.limit;
  }

  step(dt: number, inp: FightInput): FightEvent {
    const { kids, rng } = this.p;
    const F = TUNING.fight;
    this.jumped = false;
    this.ranNow = false;
    this.runT -= dt;
    if (this.runT <= 0) {
      this.run = !this.run;
      this.runT = this.run ? (0.9 + rng() * 1.3) * (0.6 + this.S * 0.6) : 1.3 + rng() * 1.7;
      if (this.run) {
        this.ranNow = true;
        this.runDir = rng() < 0.5 ? -this.runDir : this.runDir;
        // strong fish sometimes leap out of the water
        if (this.p.species.power > 0.45 && rng() < 0.25 + this.p.species.power * 0.3 && this.D > 3) {
          this.jumpT = 0.75;
          this.jumped = true;
        }
      }
    }
    this.jumpT = Math.max(0, this.jumpT - dt);
    const pullNow = this.pull * (this.run ? 0.75 + this.S * 0.55 : 0.28);
    const r = inp.crank;
    this.counter = this.run && !kids ? counterPull(this.runDir, inp.side ?? 0) : 0;
    if (this.counter > 0) this.runT -= dt * this.counter * 1.4; // a firm side pull tires the run out sooner
    const targetT = (pullNow * 0.8 + r * 0.26 * (this.run ? 1.25 : 1) + inp.pump + (this.jumpT > 0 ? r * 0.2 : 0)) * (1 - 0.3 * this.counter);
    this.T = lerp(this.T, targetT, 1 - Math.exp(-dt * 4));
    this.age += dt;
    // the line comes in smoothly (the spool speeds up / slows down, no jumps when the hand starts or stops)
    this.reelV = lerp(this.reelV, r * F.reelGain * inp.reelMul + inp.pump * 1.4, 1 - Math.exp(-dt * 3));
    const dD = -this.reelV + (this.run ? pullNow * 1.8 * (1 - Math.min(0.8, r * 0.3)) : 0);
    this.D = Math.max(0, this.D + dD * dt);
    this.S = Math.max(0, this.S - dt * (0.035 + this.T * 0.07));
    // left / right
    this.wob += dt * (this.run ? 3 : 1.2);
    const wide = this.maxAng * (0.45 + 0.55 * this.S);
    const targetAng = this.run ? this.runDir * wide + Math.sin(this.wob) * 0.3 * wide : Math.sin(this.wob) * wide * 0.3;
    this.ang = lerp(this.ang, targetAng, 1 - Math.exp(-dt * (this.run ? 3.2 : 1.8)));
    this.lat = Math.min(this.D, 40) * Math.sin(this.ang);
    // line break
    const grace = 1 + 0.6 * Math.max(0, 1 - this.age / F.graceT);
    if (this.T > this.limit * grace) this.overT += dt;
    else this.overT = Math.max(0, this.overT - dt * 2);
    if (!kids && this.overT > F.breakAfter) return "break";
    if (this.D > this.startD + F.escapeExtra) return "escape";
    if (this.D < F.landDist) return "land";
    return "none";
  }
}

// ---------------------------------------------------------------- scoring

export function pointsFor(s: SpeciesDef, weight: number): number {
  return Math.max(isJunk(s) ? 10 : 30, Math.round(weight * 100 * (s.bonus ?? 1)));
}

/** kg that count for the basket / the duel (junk does not count). */
export function basketKg(s: SpeciesDef, weight: number): number {
  return isJunk(s) ? 0 : weight;
}

export interface PlayerTally {
  score: number;
  kg: number;
  count: number;
  best: number;
  lost: number;
}
export const emptyTally = (): PlayerTally => ({ score: 0, kg: 0, count: 0, best: 0, lost: 0 });

export function addCatch(t: PlayerTally, s: SpeciesDef, weight: number): number {
  const pts = pointsFor(s, weight);
  t.score += pts;
  t.kg += basketKg(s, weight);
  if (!isJunk(s)) {
    t.count++;
    t.best = Math.max(t.best, weight);
  }
  return pts;
}

/** Duel: who has more weight (ties broken by score); -1 = draw. */
export function duelWinner(a: PlayerTally, b: PlayerTally): -1 | 0 | 1 {
  const ka = Math.round(a.kg * 100);
  const kb = Math.round(b.kg * 100);
  if (ka !== kb) return ka > kb ? 0 : 1;
  if (a.score !== b.score) return a.score > b.score ? 0 : 1;
  return -1;
}

// ---------------------------------------------------------------- partner help (landing net)

export interface NetHelpCtx {
  mode: GameMode;
  /** the partner is fighting a fish */
  partnerFighting: boolean;
  /** distance of the partner's fish to the partner's rod (m) */
  partnerD: number;
  /** the partner's catch is a real fish or any item (net helps with everything) */
  helperPresent: boolean;
}

/** The net gesture of one player lands the other's fish only in the co-op mode and only when the fish is within 5 m. */
export function netHelpApplies(c: NetHelpCtx): boolean {
  return c.mode === "birgalikda" && c.partnerFighting && c.helperPresent && c.partnerD <= TUNING.fight.netDist;
}

/** Is the partner's line in danger (red)? Used for the "Ehtiyot bo‘l!" warning. */
export function lineInDanger(strain: number): boolean {
  return strain > 0.85;
}

// ---------------------------------------------------------------- goals

export function coopProgress(totalKg: number, goalKg: number): number {
  return clamp(totalKg / goalKg, 0, 1);
}
export const coopDone = (totalKg: number, goalKg: number): boolean => totalKg + 1e-9 >= goalKg;
