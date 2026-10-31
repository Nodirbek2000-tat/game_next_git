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
    /** the forward stroke of the arm starts when the hand moves down faster than this (screen heights / s) */
    swingSpeed: 1.0,
    kidsSwingSpeed: 0.7,
    /** a stroke counts only if its peak reaches this (a lazy drop of the arm stays under it); this peak = the shortest cast */
    minPeak: 1.25,
    kidsMinPeak: 0.9,
    /** stroke peak speed of a full power cast */
    peakMax: 2.6,
    /** the hand must come down at least this far (body scales) from its highest point during the stroke */
    minDrop: 0.35,
    /** the stroke ends (the line is released) when the speed falls under this part of its peak, or after maxStroke seconds */
    endFrac: 0.6,
    maxStroke: 0.4,
    /** the raised hand stays "armed" this long (s) */
    armWindow: 1.6,
    /** minimum time between casts (s) */
    cooldown: 0.6,
    /** the pose must be tracked this long (s) before a stroke counts (a hand that just came back into view jumps) */
    settle: 0.25,
    /** power of the keyboard flick */
    keyPower: 0.75,
    baseDist: 8,
    powerDist: 28,
    kidsPowerDist: 18,
    maxYawDeg: 22,
    yawGain: 13,
    flyBase: 0.7,
    flyPower: 0.6,
    /** the rod bends back by this much per (screen height / s) of downward hand speed */
    bendGain: 0.3,
  },
  strike: { upSpeed: 1.05, kidsUpSpeed: 0.8, window: 0.95, kidsWindow: 1.7, cooldown: 0.6, jerk: 9 },
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
    /** chance that the next run goes to the other side (runs alternate left / right more often than not) */
    flipChance: 0.75,
    /** run length factor: small fish (0) run short, big strong fish (1) run long */
    runLenSmall: 0.65,
    runLenBig: 1.35,
    /** rests between runs: small fish rest longer */
    restSmall: 1.15,
    restBig: 0.75,
    /** extra tension (x the fish's pull) while it pulls sideways and the player does not lean against it */
    sideTension: 0.3,
    /** extra line the fish takes while it pulls sideways and is not countered */
    sideOut: 0.35,
    /** a run counts as "surging" (splash) when its side pull passes this */
    surgeAt: 0.65,
    /** fish pull that counts as fully heavy for the reel */
    heavyRef: 1.1,
    /** how much less line one reel turn brings in against a fully heavy running fish */
    heavyDrag: 0.45,
  },
  /** steering the fish with the rod hand: the sideways shift of the hand (body scales) that counts as full, and how fast "neutral" follows the hand (s) */
  steer: { range: 0.5, tau: 6 },
  /** the reel crank, tracked from the circling hand (circles per second) */
  reel: {
    /** the circle centre follows the hand with this time constant (s) */
    centerTau: 0.35,
    /** the circle must be wider than this (body scales) */
    minRadius: 0.11,
    /** a larger turn between two frames (rad) is a tracking glitch */
    maxStep: 2.6,
    /** the turn speed estimate rises / falls with these time constants (s): stopping the hand stops the reel at once */
    attack: 0.12,
    release: 0.06,
    /** reeling starts above `on` circles/s and stops under `off` */
    on: 0.35,
    off: 0.2,
    max: 2.6,
    /** hand speed (body scales / s) under which the hand stands still */
    stillSpeed: 0.15,
    /** +1 / -1: which way the drawn reel handle turns for a clockwise circle of the hand (flip it if it looks reversed) */
    visualSign: 1,
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

/** Smallest stroke peak that counts as a cast (screen heights / s), with the sensitivity / kids setting applied. */
export function minStrokePeak(t: Tuning): number {
  return sens(t.kids ? TUNING.cast.kidsMinPeak : TUNING.cast.minPeak, t.sensitivity);
}
/** 0..1 cast power from the peak speed of the arm's forward stroke: a just-valid flick gives 0, `peakMax` and above gives 1. */
export function strokePower(peak: number, t: Tuning): number {
  const lo = minStrokePeak(t);
  return clamp((peak - lo) / Math.max(0.1, TUNING.cast.peakMax - lo), 0, 1);
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
  /** hand sideways offset averaged over the stroke (the aim) */
  aim: number;
  /** true for a real arm stroke (false for the keyboard flick): the rod animation starts from the live pose */
  viaHand: boolean;
}

/**
 * The overhead cast: the rod hand goes up and back (above the shoulder = "armed"), then whips forward (down in the camera
 * image). The stroke is measured from its start to its end: power comes from its peak speed, the aim from where the hand
 * was during the stroke. The line is released when the arm decelerates (the end of the stroke), like a real cast.
 * A lazy drop of the arm (low peak), a short jerk (hand did not come down far) or a one frame spike is not a cast.
 */
export class CastDetector {
  armed = false;
  /** a forward stroke is under way */
  stroking = false;
  private armedT = 0;
  private since = 10;
  private top = -9;
  private strokeT = 0;
  private peak = 0;
  private aimSum = 0;
  private aimN = 0;
  readonly out: CastResult = { fired: false, power: 0, aim: 0, viaHand: false };

  reset(): void {
    this.disarm();
    this.since = 0;
  }

  private disarm(): void {
    this.armed = false;
    this.stroking = false;
    this.armedT = 0;
    this.top = -9;
    this.peak = 0;
    this.strokeT = 0;
  }

  /**
   * `down`: rod wrist speed in screen heights/s (positive = moving down); `elev`: its height above the shoulder in body
   * scales; `aim`: its sideways offset from the shoulder in body scales; `key`: the keyboard flick.
   */
  update(dt: number, handUp: boolean, down: number, elev: number, aim: number, t: Tuning, key = false): CastResult {
    const c = TUNING.cast;
    const o = this.out;
    o.fired = false;
    o.power = 0;
    o.viaHand = false;
    this.since += dt;
    if (handUp || key) {
      this.armed = true;
      this.armedT = 0;
    }
    if (this.armed) {
      this.armedT += dt;
      this.top = Math.max(this.top, elev);
      if (this.armedT > c.armWindow) this.disarm();
    }
    if (key && this.since > c.cooldown) {
      o.fired = true;
      o.power = c.keyPower;
      o.aim = aim;
      this.disarm();
      this.since = 0;
      return o;
    }
    if (!this.armed || this.since <= c.cooldown) return o;
    if (!this.stroking && down > sens(t.kids ? c.kidsSwingSpeed : c.swingSpeed, t.sensitivity)) {
      this.stroking = true;
      this.strokeT = 0;
      this.peak = 0;
      this.aimSum = 0;
      this.aimN = 0;
    }
    if (this.stroking) {
      this.strokeT += dt;
      this.peak = Math.max(this.peak, down);
      this.aimSum += aim;
      this.aimN++;
      if (down < this.peak * c.endFrac || this.strokeT >= c.maxStroke) {
        const drop = this.top - elev;
        const real = this.peak >= minStrokePeak(t) && drop >= c.minDrop;
        this.stroking = false;
        if (real) {
          o.fired = true;
          o.viaHand = true;
          o.power = strokePower(this.peak, t);
          o.aim = this.aimSum / Math.max(1, this.aimN);
          this.disarm();
          this.since = 0;
        } else this.peak = 0; // noise or a lazy drop: still armed, try again
      }
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

/** Side pull of a run, 0..1: it builds up, peaks in the middle of the run and eases off (`u` = how far the run is, 0..1). */
export function surgeEnvelope(u: number): number {
  return Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.8);
}

/** 0..1: how much a fish of this pull (and the player's reeling) is "big and strong" (small fish run short and weak). */
export function bigness(pull: number): number {
  return clamp((pull - 0.2) / 0.8, 0, 1);
}

/**
 * The fight: tension T (0..~1.2, red above 0.85), distance D (m) to the rod, fish stamina S, left/right runs and jumps.
 * Ported from the prototype (`Fishing.hook/fight`) with dt based smoothing.
 *
 * Left / right: the fish runs to one side (`runDir`) with a side pull `surge` that builds up, peaks and fades during the run, then
 * rests, then usually runs to the other side. While the pull is not countered (rod hand moved to the opposite side) it adds
 * tension and takes line; countered it does not, and the run tires out sooner. Small fish run short and weak, big ones long and hard.
 */
export class FightModel {
  D: number;
  T = 0.3;
  S = 1;
  run = true;
  runT: number;
  /** length of the current run / rest (s) and the strength of this run (0.55..1) */
  private runLen: number;
  private runAmp: number;
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
  /** side pull right now, 0..1 (0 while it rests); with `runDir` it says which way and how hard the fish pulls */
  surge = 0;
  /** how hard the fish pulls against the reel right now, 0..1 (reeling is heavier and slower the bigger it is) */
  heavy = 0;
  /** > 0 while the fish is in the air (s) */
  jumpT = 0;
  /** true on the frame a jump started / a run started / the side pull peaked (splash) */
  jumped = false;
  ranNow = false;
  surged = false;
  overT = 0;
  readonly pull: number;
  readonly limit: number;
  readonly startD: number;
  /** 0..1: how big and strong this fish is */
  readonly big: number;
  private surgedRun = false;
  private wob: number;
  constructor(readonly p: FightParams) {
    const { species, weight, kids, rng } = p;
    const raw = species.power * (0.55 + Math.min(1, weight / 14) * 0.5);
    this.pull = raw * (kids ? TUNING.fight.kidsPull : 1);
    this.big = bigness(raw);
    this.limit = kids ? TUNING.fight.kidsLimit : TUNING.fight.limit;
    this.D = this.startD = p.startD;
    this.runT = this.runLen = 1 + rng();
    this.runAmp = 0.55 + rng() * 0.45;
    this.wob = rng() * 6.28;
    this.runDir = rng() < 0.5 ? -1 : 1;
    this.maxAng = 0.1 + species.power * 0.3 + Math.min(1, weight / 10) * 0.1;
  }

  /** -1 / 0 / 1: the side the fish is pulling to right now (0 while it rests or has not built up its pull yet) */
  get pullDir(): number {
    return this.run && this.surge > 0.12 ? this.runDir : 0;
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
    this.surged = false;
    this.runT -= dt;
    if (this.runT <= 0) {
      this.run = !this.run;
      this.runT = this.runLen = this.run
        ? (0.9 + rng() * 1.3) * (0.6 + this.S * 0.6) * lerp(F.runLenSmall, F.runLenBig, this.big)
        : (1.3 + rng() * 1.7) * lerp(F.restSmall, F.restBig, this.big);
      if (this.run) {
        this.ranNow = true;
        this.surgedRun = false;
        this.runAmp = 0.55 + rng() * 0.45;
        this.runDir = rng() < F.flipChance ? -this.runDir : this.runDir;
        // strong fish sometimes leap out of the water
        if (this.p.species.power > 0.45 && rng() < 0.25 + this.p.species.power * 0.3 && this.D > 3) {
          this.jumpT = 0.75;
          this.jumped = true;
        }
      }
    }
    this.jumpT = Math.max(0, this.jumpT - dt);
    // the side pull of this run: builds up, peaks, eases off
    const surgeTarget = this.run ? this.runAmp * surgeEnvelope(1 - this.runT / this.runLen) : 0;
    this.surge = lerp(this.surge, surgeTarget, 1 - Math.exp(-dt * 8));
    if (this.run && !this.surgedRun && this.surge > F.surgeAt) {
      this.surgedRun = true;
      this.surged = true;
    }
    const pullNow = this.pull * (this.run ? (0.75 + this.S * 0.55) * (0.82 + 0.36 * this.surge) : 0.28);
    const r = inp.crank;
    this.counter = this.run && !kids ? counterPull(this.runDir, inp.side ?? 0) : 0;
    if (this.counter > 0) this.runT -= dt * this.counter * 1.4; // a firm side pull tires the run out sooner
    // a pull to the side that is not countered adds tension (kids: only the cue, no penalty)
    const sideT = kids ? 0 : F.sideTension * pullNow * this.surge * (1 - this.counter);
    const targetT = (pullNow * 0.8 + r * 0.26 * (this.run ? 1.25 : 1) + inp.pump + (this.jumpT > 0 ? r * 0.2 : 0)) * (1 - 0.3 * this.counter) + sideT;
    this.T = lerp(this.T, targetT, 1 - Math.exp(-dt * 4));
    this.age += dt;
    // reeling against a hard pulling fish brings in less line per turn: it feels heavier
    this.heavy = clamp(pullNow / F.heavyRef, 0, 1);
    const reelEff = 1 - F.heavyDrag * this.heavy * (this.run ? 1 : 0.25);
    // the line comes in smoothly (the spool speeds up / slows down, no jumps when the hand starts or stops)
    this.reelV = lerp(this.reelV, r * F.reelGain * inp.reelMul * reelEff + inp.pump * 1.4, 1 - Math.exp(-dt * 3));
    const out = this.run ? pullNow * 1.8 * (1 - Math.min(0.8, r * 0.3)) * (1 + (kids ? 0 : F.sideOut * this.surge * (1 - this.counter))) : 0;
    this.D = Math.max(0, this.D + (-this.reelV + out) * dt);
    this.S = Math.max(0, this.S - dt * (0.035 + this.T * 0.07 + this.counter * 0.03));
    // left / right
    this.wob += dt * (this.run ? 3 : 1.2);
    const wide = this.maxAng * (0.45 + 0.55 * this.S);
    const targetAng = this.run ? this.runDir * wide * (0.25 + 0.75 * this.surge) + Math.sin(this.wob) * 0.25 * wide : Math.sin(this.wob) * wide * 0.3;
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
