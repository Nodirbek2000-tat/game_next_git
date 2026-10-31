// Per-quality-level numbers of the Baliq ovi scene, in one table. "high" is the full look; "low" is the lite mode for
// integrated GPUs (impostor trees only, no grass, no reflection / refraction passes, no image light, cheap ground and
// mountain shading). Counts marked "live" can be changed while playing (the quality controller may step down at any
// time); the rest is decided when the scene is built.

import type { QualityLevel } from "@/engine/types";

export interface Lod {
  /** camera far plane (m); the sky dome is scaled to it (live) */
  far: number;
  /** far mountain ranges: azimuth cells, radial rows, outer radius (m) */
  mtn: { na: number; nr: number; rMax: number };
  /** cheap ground / mountain shading: no normal maps, no triplanar rock, one grass tile */
  lite: boolean;
  /** texture anisotropy cap */
  aniso: number;
  /** trees near the lake and on the side shores; the billboard-only forest on the plain behind the far shore (live, as a share) */
  trees: number;
  hillTrees: number;
  /** real fir models only within this distance of the eye (m), 0 = billboards only (live) */
  modelRadius: number;
  /** grass patches (live, as a share) */
  grass: number;
  /** shore + bed rocks, and whether they use the 900-triangle model instead of the 80-triangle icosahedron */
  rocks: number;
  rockModel: boolean;
  weeds: number;
  reeds: number;
  pads: number;
  clouds: number;
  /** water surface grid (cells per side) and the size of the ripple normal map */
  waterGrid: number;
  normalSize: number;
  /** reflection / refraction passes (render target sizes, the reflection is redrawn every `every`-th frame), null = no passes */
  passes: { refl: [number, number]; refr: [number, number]; every: number } | null;
  /** rain streaks (live) */
  rain: number;
  /** photo based image light (HDR -> PMREM) */
  env: boolean;
}

export const LOD: Record<QualityLevel, Lod> = {
  high: {
    far: 2200, mtn: { na: 560, nr: 72, rMax: 1580 }, lite: false, aniso: 8,
    trees: 560, hillTrees: 1344, modelRadius: 34, grass: 420, rocks: 60, rockModel: true, weeds: 150, reeds: 170, pads: 26, clouds: 14,
    waterGrid: 120, normalSize: 256, passes: { refl: [512, 256], refr: [384, 216], every: 2 }, rain: 520, env: true,
  },
  medium: {
    far: 1700, mtn: { na: 360, nr: 48, rMax: 1450 }, lite: true, aniso: 4,
    trees: 300, hillTrees: 540, modelRadius: 20, grass: 120, rocks: 30, rockModel: true, weeds: 80, reeds: 90, pads: 16, clouds: 10,
    waterGrid: 80, normalSize: 256, passes: { refl: [384, 192], refr: [288, 162], every: 3 }, rain: 300, env: true,
  },
  low: {
    far: 1300, mtn: { na: 200, nr: 26, rMax: 1150 }, lite: true, aniso: 1,
    trees: 110, hillTrees: 130, modelRadius: 0, grass: 0, rocks: 14, rockModel: false, weeds: 30, reeds: 30, pads: 8, clouds: 6,
    waterGrid: 48, normalSize: 128, passes: null, rain: 120, env: false,
  },
};

const ORDER: QualityLevel[] = ["low", "medium", "high"];

/** The level the scene can show now: the current quality, but never above what was built. */
export function effectiveLevel(built: QualityLevel, current: QualityLevel): QualityLevel {
  return ORDER[Math.min(ORDER.indexOf(built), ORDER.indexOf(current))];
}

/** `now`'s share of what was built for `built` (0..1) for a live count: the built meshes hold the `built` amount. */
export function liveShare(key: "hillTrees" | "grass" | "rocks" | "weeds" | "reeds" | "pads" | "clouds" | "rain", built: QualityLevel, now: QualityLevel): number {
  const b = LOD[built][key];
  return b > 0 ? Math.min(1, LOD[now][key] / b) : 0;
}
