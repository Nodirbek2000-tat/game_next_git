// All tunable numbers of the engine. The defaults are the values that were tested in the prototype
// (docs/prototype/harakat-oyinlari.html); they can be overridden per game or via the sensitivity setting.

export interface EngineConfig {
  filter: { minCutoff: number; beta: number; dCutoff: number };
  cursorFilter: { minCutoff: number; beta: number; dCutoff: number };
  /** Upper limit of camera analyses per second (the scheduler lowers it on weak CPUs); rendering runs at display rate. */
  analysisFps: number;
  /**
   * Render-rate prediction. A detection is extrapolated along the velocity by `now - captureTime + leadMs`
   * (capped at `maxMs`), `leadMs` being the display latency of the last mile (vsync + compositor).
   */
  extrapolation: { maxMs: number; gain: number; leadMs: number };
  lock: {
    /** Hands above head must be held this long (s) to lock a player. */
    scanHoldSec: number;
    /** A player seen within this time (s) is matched by position first. */
    continuitySec: number;
    /** Max normalised distance (in body scales) for position continuity. */
    continuityDist: number;
    /** Minimum clothing similarity to re-acquire a player who was away. */
    histMin: number;
    /** Even while a player is "recently seen", a person whose clothing is less similar than this is not accepted. */
    continuityMinSim: number;
    histAdaptAbove: number;
    histAdaptRate: number;
    colorWeight1: number;
    colorWeight2: number;
    /** Pause the game when a locked player is missing longer than this (s). */
    lostPauseSec: number;
    /** Auto resume after the player has been back this long (s). */
    resumeSec: number;
  };
  blade: { dropoutMs: number; dropoutGain: number; velSmooth: number; velTauMs: number; accelTauMs: number; accelGain: number; maxGapMs: number; minVis: number };
  gestures: {
    stableFrames: number;
    handUpEnter: number;
    handUpExit: number;
    aboveHeadEnter: number;
    aboveHeadExit: number;
    swipeSpeed: number;
    swipeCooldownMs: number;
    crankRadius: number;
    crankTau: number;
    crankMaxStep: number;
    crankSmooth: number;
    crankMax: number;
  };
  legs: { minRest: number; defaultRest: number; riseLerp: number; decay: number; deadZone: number; range: number; minVis: number };
  cursor: { reach: number; dwellMs: number; cooldownMs: number };
  calibration: { totalSec: number; darkLuma: number; brightLuma: number; nearFrac: number; farFrac: number; edgeMargin: number };
}

export const DEFAULT_CONFIG: EngineConfig = {
  // One Euro: low cut-off keeps a resting hand still, the high beta opens the filter as soon as the hand speeds up
  // (cut-off = minCutoff + beta * speed in screen heights / s), dCutoff 4 lets the speed estimate react within a frame.
  // Simulated sweep error 0.055 -> 0.013 screen heights at the same jitter when resting (see oneEuro.test.ts).
  filter: { minCutoff: 1.2, beta: 10, dCutoff: 4 },
  cursorFilter: { minCutoff: 1.0, beta: 6, dCutoff: 3 },
  analysisFps: 60,
  extrapolation: { maxMs: 120, gain: 0.9, leadMs: 8 },
  lock: {
    scanHoldSec: 1.4,
    continuitySec: 0.6,
    continuityDist: 1.3,
    histMin: 0.62,
    continuityMinSim: 0.45,
    histAdaptAbove: 0.7,
    histAdaptRate: 0.02,
    colorWeight1: 1.5,
    colorWeight2: 3,
    lostPauseSec: 1.2,
    resumeSec: 0.7,
  },
  blade: { dropoutMs: 140, dropoutGain: 0.7, velSmooth: 0.75, velTauMs: 12, accelTauMs: 35, accelGain: 0.8, maxGapMs: 200, minVis: 0.35 },
  gestures: {
    stableFrames: 3,
    handUpEnter: 0.25,
    handUpExit: 0.1,
    aboveHeadEnter: 0.05,
    aboveHeadExit: -0.1,
    swipeSpeed: 1.0,
    swipeCooldownMs: 250,
    crankRadius: 0.12,
    crankTau: 0.45,
    crankMaxStep: 1.4,
    crankSmooth: 0.12,
    crankMax: 2.6,
  },
  legs: { minRest: 0.45, defaultRest: 0.6, riseLerp: 0.25, decay: 0.01, deadZone: 0.12, range: 0.8, minVis: 0.5 },
  cursor: { reach: 1.45, dwellMs: 1100, cooldownMs: 900 },
  calibration: { totalSec: 10, darkLuma: 0.16, brightLuma: 0.92, nearFrac: 0.97, farFrac: 0.45, edgeMargin: 0.015 },
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Merge overrides over the defaults and apply the user's sensitivity (0.5 .. 1.5, 1 = prototype). */
export function makeConfig(overrides: DeepPartial<EngineConfig> = {}, sensitivity = 1): EngineConfig {
  const base = structuredClone(DEFAULT_CONFIG) as EngineConfig;
  for (const k of Object.keys(overrides) as (keyof EngineConfig)[]) {
    const o = overrides[k];
    if (o && typeof o === "object") Object.assign(base[k] as object, o);
    else if (o !== undefined) (base as unknown as Record<string, unknown>)[k] = o;
  }
  const s = Math.min(1.5, Math.max(0.5, sensitivity));
  base.gestures.swipeSpeed /= s;
  base.gestures.crankRadius /= s;
  base.gestures.handUpEnter /= Math.sqrt(s);
  base.legs.deadZone /= s;
  return base;
}
