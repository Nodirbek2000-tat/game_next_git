// Public surface for game modules (games/<slug>/). Import from "@/engine" instead of reaching into folders.
export type {
  AudioApi,
  Blade,
  DrawFn,
  EngineApi,
  FxApi,
  GameMeta,
  GameModule,
  GameResult,
  GestureState,
  HandInfo,
  HudApi,
  HudValues,
  LegState,
  Lm,
  PlayerFrame,
  Pt,
  QualityParams,
  RunState,
  SceneProps,
  WorldPoint,
} from "./types";
export { KID_ANIMALS, KID_COLORS, MAX_KIDS } from "./tracking/kids";
export type { KidAnimal, KidPoints, KidPt, KidSignals, KidSlot } from "./tracking/kids";
export { useEngine, useGameFrame, useOverlayDraw } from "./game/context";
export { drawRingProgress, drawSkeleton, drawText, drawTrail } from "./fx/fx2d";
export { angDeg, clamp, dist, easeOut, lerp, pick, pointInPoly, rnd, rndi, segPointDist, TAU } from "./math";
export { disposeTree } from "./ui/PlayStage";
