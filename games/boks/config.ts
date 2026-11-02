import type { QualityLevel } from "@/engine/types";

// ------------------------------------------------------------------------------------------------ rules

export const ROUNDS = 3;
/** seconds of one round (the page can shorten it for tests: ?duration=12) */
export const ROUND_SEC = 45;
export const REST_SEC = 5;
export const INTRO_SEC = 2.4;
/** the count after a knockdown before the round is over (seconds) */
export const KO_SEC = 3.2;

export const PLAYER_HP = 100;
export const STAMINA_MAX = 100;
/** a punch (also into the air) costs this much stamina; it comes back at STAMINA_REGEN per second */
export const PUNCH_COST = 5;
export const STAMINA_REGEN = 10;
/** below this fraction the player is tired: hits count less */
export const TIRED_AT = 0.15;

/** the partner's own stamina: a punch of his costs this, it comes back at ENEMY_REGEN per second */
export const ENEMY_PUNCH_COST = 18;
export const ENEMY_REGEN = 5;

/** length of a shoulder width in metres: converts "shoulder widths / s" into km/h (the prototype used the same 0.42) */
export const SW_METERS = 0.42;

export interface RoundSpec {
  /** seconds between the start of the telegraph and the glove arriving (about 0.7 s on average, easier early) */
  windup: number;
  /** seconds between two pads */
  padGap: [number, number];
  /** how long a pad stays */
  padLife: number;
  /** seconds between two attacks of the partner */
  attackGap: [number, number];
  /** chance that an attack is a quick double */
  double: number;
  /** chance that an attack is a hook (the rest are straight punches) */
  hook: number;
  /** health lost by a clean hit */
  damage: number;
}

export const ROUND_SPECS: readonly RoundSpec[] = [
  { windup: 0.85, padGap: [1.0, 1.5], padLife: 1.9, attackGap: [7, 10], double: 0, hook: 0.2, damage: 10 },
  { windup: 0.72, padGap: [0.85, 1.25], padLife: 1.6, attackGap: [5.5, 8], double: 0.15, hook: 0.35, damage: 13 },
  { windup: 0.6, padGap: [0.7, 1.1], padLife: 1.35, attackGap: [4, 6.5], double: 0.35, hook: 0.4, damage: 16 },
];

/** the strike itself and the time the glove needs to come back (seconds) */
export const STRIKE_SEC = 0.16;
export const RECOVER_SEC = 0.45;
/** the glove lands this long after the strike started */
export const IMPACT_AFTER_STRIKE = 0.1;

// ------------------------------------------------------------------------------------------------ the view

/** the first-person camera (no rotation: the screen <-> world conversions are plain arithmetic) */
export const CAM = { fov: 58, x: 0, y: 1.62, z: 0.25 };
export const PARTNER_Z = -1.85;
/** the plane the pads are held in (in front of the partner's chest) */
export const PAD_PLANE_Z = PARTNER_Z + 0.44;
/** the fighter's glove, in stage heights, moves this many pixels per shoulder width of the player's hand motion */
export const GLOVE_S = 0.2;
/** the screen height (fraction) at which a hand at shoulder level appears */
export const GLOVE_Y0 = 0.66;

// ------------------------------------------------------------------------------------------------ quality

/**
 * What each quality level costs (one table; "high" is the full look). Counts that are fixed when the scene is built
 * (materials, lights, crowd size) use the level the game started on; what is live (crowd animation, shadows, the post
 * pipeline, particles) follows the quality controller while playing and never goes above the built level.
 */
export interface Lod {
  /** 3D spectators (instanced); 0 = only the painted backdrop */
  crowd: number;
  /** spectators bob and cheer (their matrices are updated every other frame) */
  crowdAnim: boolean;
  /** coloured rim lights on top of the hemisphere + key light */
  rim: number;
  /** a shadow map from the key light (high only) */
  shadows: boolean;
  shadowMap: number;
  /** bloom + vignette + SMAA: an extra full-screen pipeline, high only */
  post: boolean;
  /** radial segments of the round shapes (body, gloves, ropes) */
  seg: number;
  /** size of the painted ring canvas */
  tex: number;
  /** Lambert materials instead of Standard ones (cheaper per pixel) */
  lambert: boolean;
  /** light cones above the ring */
  cones: boolean;
}

export const LOD: Record<QualityLevel, Lod> = {
  high: { crowd: 220, crowdAnim: true, rim: 2, shadows: true, shadowMap: 1024, post: true, seg: 14, tex: 1024, lambert: false, cones: true },
  medium: { crowd: 90, crowdAnim: false, rim: 1, shadows: false, shadowMap: 0, post: false, seg: 10, tex: 512, lambert: false, cones: true },
  low: { crowd: 0, crowdAnim: false, rim: 0, shadows: false, shadowMap: 0, post: false, seg: 7, tex: 256, lambert: true, cones: false },
};

const ORDER: QualityLevel[] = ["low", "medium", "high"];

/** The level the scene can show now: the current quality, but never above what it was built for. */
export function effectiveLevel(built: QualityLevel, current: QualityLevel): QualityLevel {
  return ORDER[Math.min(ORDER.indexOf(built), ORDER.indexOf(current))];
}
