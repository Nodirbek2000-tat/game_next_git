import type { QualityLevel } from "@/engine/types";
import { effectiveLevel } from "@/games/poyga/config";

/**
 * What each quality level costs, in one table ("high" is the full look, "low" the lite mode for integrated GPUs and weak PCs).
 * The live numbers (view distance, haze, traffic, trees, rain, post effects) follow the quality controller while playing; what
 * is decided when the scene is built (texture maps, clear coat, which GLBs are fetched) uses the level the game started on,
 * and the controller never goes above it (see `effectiveLevel`).
 */
export interface Lod {
  /** engine/quality/controller.ts BASE.viewDistance of this level: the live viewDistance / this = the emergency squeeze */
  vd: number;
  /** haze start / end as fractions of the streamed world radius (the camera far plane follows the haze end) */
  fogNear: number;
  fogFar: number;
  /** AI cars and pedestrians alive around the player (cars = TrafficSim.density x 10) */
  density: number;
  peds: number;
  /** trees: real 3D models (nearest N, within the distance; 0 = no tree GLB is fetched), billboard impostors (cap per variant) */
  treeNear: number;
  treeNearDist: number;
  treeFar: number;
  /** street furniture models (benches, hydrants, shrubs, boxes) fetched and drawn; false = none */
  props: boolean;
  /** texture anisotropy cap */
  aniso: number;
  /** normal + roughness maps on asphalt, pavement, grass, concrete (two more texture reads per pixel) */
  pbrMaps: boolean;
  /** clear coat on the player's paint (a physical material) */
  clearcoat: boolean;
  /** image light from the HDR sky (a 1.4 MB download and a PMREM pass); false = a tiny gradient reflection cube instead */
  hdr: boolean;
  /** scene.environmentIntensity at noon (the game fades it with the daylight) */
  env: number;
  /** daylight strength of the sun and of the hemisphere light (1 = the base values in sky.ts); the lite level has no image light, so its lights carry the whole picture */
  sun: number;
  hemi: number;
  /** post effects (ambient occlusion, bloom, colour grade, vignette, SMAA): an extra full-screen pipeline, high only */
  post: boolean;
  /** rain streaks drawn at full rain, tyre smoke particles in the pool */
  rain: number;
  smoke: number;
  /** milliseconds per frame the game may spend building tiles, trees, props */
  workMs: number;
}

export const LOD: Record<QualityLevel, Lod> = {
  high: {
    vd: 1, fogNear: 0.42, fogFar: 0.97, density: 1, peds: 24, treeNear: 28, treeNearDist: 90, treeFar: 120, props: true,
    aniso: 8, pbrMaps: true, clearcoat: true, hdr: true, env: 0.6, sun: 1.9, hemi: 1, post: true, rain: 700, smoke: 120, workMs: 5,
  },
  medium: {
    vd: 0.75, fogNear: 0.36, fogFar: 0.95, density: 0.8, peds: 14, treeNear: 10, treeNearDist: 60, treeFar: 80, props: true,
    aniso: 4, pbrMaps: true, clearcoat: false, hdr: true, env: 0.6, sun: 1.9, hemi: 1, post: false, rain: 400, smoke: 70, workMs: 4,
  },
  low: {
    vd: 0.5, fogNear: 0.3, fogFar: 0.92, density: 0.5, peds: 8, treeNear: 0, treeNearDist: 0, treeFar: 50, props: false,
    aniso: 2, pbrMaps: false, clearcoat: false, hdr: false, env: 0.6, sun: 2.3, hemi: 1.9, post: false, rain: 160, smoke: 30, workMs: 3,
  },
};

/** Streamed world radius (m) for an engine viewDistance (0..1, already shortened by the emergency squeeze): 175 low, 237 medium, 300 high. */
export const loadMetres = (viewDistance: number): number => 50 + 250 * Math.min(1, Math.max(0.2, viewDistance));

export { effectiveLevel };

/** 0.3..1: how far the controller's emergency squeeze has shortened the view on top of the level (1 = not at all). */
export function squeeze(level: QualityLevel, viewDistance: number): number {
  return Math.min(1, Math.max(0.3, viewDistance / LOD[level].vd));
}
