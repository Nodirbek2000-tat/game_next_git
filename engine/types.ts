// Shared engine types. Coordinates handed to games are in STAGE pixels (CSS px of the full-screen play area),
// already mirrored (screen-left == the user's left) and mapped with "cover" fit over the camera image.

import type { ComponentType } from "react";
import type { EngineConfig } from "./config";

export interface Pt {
  x: number;
  y: number;
}
/** Landmark in stage pixels; `v` is MediaPipe visibility (0..1). */
export interface Lm extends Pt {
  v: number;
}
/** Raw MediaPipe landmark (normalised 0..1 in the un-mirrored camera image). */
export interface NormLm {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}
export interface PoseResultLike {
  landmarks: NormLm[][];
  worldLandmarks?: NormLm[][];
}
export interface HandResultLike {
  landmarks: NormLm[][];
}
/** What a detector / `window.__fake` returns for one camera frame. */
export interface DetectionResult {
  pose: PoseResultLike | null;
  hand: HandResultLike | null;
}

export interface Fit {
  ox: number;
  oy: number;
  dw: number;
  dh: number;
  W: number;
  H: number;
}

export interface Person {
  idx: number;
  /** Normalised camera landmarks (for sampling colours from the camera frame). */
  norm: NormLm[];
  /** Unfiltered landmarks in stage px. */
  lm: Lm[];
  world: NormLm[] | null;
  center: Pt;
  scale: number;
  hist: Float32Array | null;
}

export type HandShape = "fist" | "open" | "point" | "gun" | "peace" | "other";
export interface HandInfo {
  pts: Pt[];
  size: number;
  shape: HandShape;
  pinchD: number;
  palm: Pt;
}

/** A fast, low-latency hand point (index fingertip when the hand model is on, else pose index/wrist). */
export interface Blade {
  active: boolean;
  side: "L" | "R";
  x: number;
  y: number;
  px: number;
  py: number;
  /** px/s */
  vx: number;
  vy: number;
  /** screen heights per second */
  speed: number;
}

export type SwipeDir = "left" | "right" | "up" | "down";
export interface SwipeEvent {
  /** true only on the frame the swipe is detected */
  fired: boolean;
  dir: SwipeDir;
  speed: number;
}

export interface GestureState {
  /** both wrists above the head (stable + hysteresis) */
  handsAboveHead: boolean;
  /** wrist above the shoulder, per side */
  handUp: { L: boolean; R: boolean };
  /** knee raised (from leg calibration), per side */
  kneeUp: { L: boolean; R: boolean };
  /** stable hand shape per side (needs the hand model) */
  shape: { L: HandShape; R: HandShape };
  /** circles per second drawn in the air by each hand */
  crank: { L: number; R: number };
  /** wrist velocity in screen heights per second */
  wristVel: { L: Pt; R: Pt };
  swipe: { L: SwipeEvent; R: SwipeEvent };
  /** Human readable name of the strongest current gesture (debug panel). */
  name: string;
}

export interface LegState {
  /** 0..1 right knee lift (gas) */
  gas: number;
  /** 0..1 left knee lift (brake) */
  brake: number;
  /** both legs visible */
  ok: boolean;
  /** calibrated rest value (knee-hip distance / body scale of the standing leg) */
  rest: number;
}

/** One entry per active player. The object and all its arrays are reused every frame (no allocation). */
export interface PlayerFrame {
  slot: number;
  /** "#2fa8ff" (player 1) / "#ffc83d" (player 2) */
  color: string;
  present: boolean;
  /** seconds since the player disappeared (0 while present) */
  lostFor: number;
  /** filtered landmarks, extrapolated to the render time (stage px) */
  lm: Lm[];
  /** latest unfiltered landmarks (stage px) */
  raw: Lm[];
  center: Pt;
  scale: number;
  headR: number;
  hands: { L: HandInfo | null; R: HandInfo | null };
  blades: [Blade, Blade];
  legs: LegState;
  gestures: GestureState;
  /** world landmarks (metres) if the model provides them */
  world: NormLm[] | null;
  /** "L"/"R": the dominant hand according to the left-handed setting */
  dominant: "L" | "R";
  /** how the player was locked: scan (clothing colour) or nearest person */
  lockMode: "none" | "locked" | "nearest";
}

export type RunState =
  | "camera"
  | "loading"
  | "scan"
  | "ready"
  | "preparing"
  | "countdown"
  | "play"
  | "pause"
  | "results"
  | "error";

export type QualityLevel = "high" | "medium" | "low";
export interface QualityParams {
  level: QualityLevel;
  /** device pixel ratio cap for the 3D canvas (already multiplied by the dynamic resolution scale) */
  pixelRatio: number;
  shadows: boolean;
  postfx: boolean;
  /** 0..1 multiplier for far plane / chunk streaming distance */
  viewDistance: number;
  /** 0..1 multiplier for particle counts */
  particles: number;
  /** dynamic resolution scale applied (0.6 .. 1) */
  resolutionScale: number;
}

export interface GameResult {
  score: number;
  /** label/value rows shown on the results screen */
  lines: [string, string | number][];
  /** optional per-player scores for 2 player games (winner is shown) */
  players?: { score: number; label?: string }[];
  stats?: Record<string, number | string>;
}

export interface HudValues {
  title?: string;
  score?: number;
  combo?: string | null;
  time?: number | null;
  timeLabel?: string;
  lives?: string | null;
  /** 0..1 progress bar under the title */
  bar?: number;
}

export interface HudApi {
  set(values: HudValues): void;
  /** per player HUD (2 players: shown on the left / right of the screen) */
  setPlayer(slot: number, values: { score?: number; label?: string; extra?: string }): void;
  show(on: boolean): void;
}

export interface AudioApi {
  readonly ready: boolean;
  /** true while the music loop is running */
  readonly musicOn: boolean;
  slice(): void;
  splat(): void;
  whoosh(v?: number): void;
  punch(): void;
  boom(big?: boolean): void;
  clash(): void;
  pew(): void;
  laser(): void;
  zap(): void;
  coin(): void;
  hurt(): void;
  beep(hi?: boolean): void;
  good(): void;
  bad(): void;
  combo(n: number): void;
  win(): void;
  lose(): void;
  click(): void;
  plop(): void;
  splash(big?: boolean): void;
  strain(v: number): void;
  crash(): void;
  horn(): void;
  screech(v: number): void;
  bird(): void;
  tone(f1: number, f2: number, dur: number, type?: OscillatorType, vol?: number, delay?: number): void;
  humStart(): void;
  humSet(level: number, swing: number): void;
  humStop(): void;
  engineStart(): void;
  engineSet(rpm: number, load: number): void;
  engineStop(): void;
  ambStart(kind: "water" | "wind"): void;
  ambStop(): void;
  musicStart(bpm?: number, style?: "drive" | "calm"): number;
  musicStop(): void;
}

export type DrawFn = (ctx: CanvasRenderingContext2D, engine: EngineApi, now: number) => void;

export interface FxApi {
  burst(
    x: number,
    y: number,
    n: number,
    col: string | (() => string),
    speed?: [number, number],
    size?: [number, number],
    life?: [number, number],
    glow?: boolean,
    gravity?: number,
  ): void;
  popup(text: string, x: number, y: number, col?: string, size?: number, life?: number): void;
  ring(x: number, y: number, r: number, col?: string, life?: number, w?: number): void;
  particle(o: { x: number; y: number; vx?: number; vy?: number; life?: number; size?: number; col?: string; glow?: boolean }): void;
  stain(x: number, y: number, r: number, col: string): void;
  shake(amount: number, seconds?: number): void;
  flash(rgb?: string, alpha?: number): void;
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** Everything a game can use. Created once per play session; fields are live (read them every frame). */
export interface EngineApi {
  readonly slug: string;
  readonly meta: GameMeta;
  readonly config: EngineConfig;
  readonly players: PlayerFrame[];
  readonly playerCount: 1 | 2;
  /** stage size in CSS px (== R3F canvas size) */
  readonly stage: { w: number; h: number; dpr: number };
  /** URL query of the play page (e.g. ?duration=10 lets tests shorten a game) */
  readonly query: URLSearchParams;
  readonly kids: boolean;
  readonly leftHanded: boolean;
  /** 0.5 .. 1.5 */
  readonly sensitivity: number;
  readonly quality: QualityParams;
  readonly state: RunState;
  /** seconds of real play time (excludes pause/countdown) */
  readonly time: number;
  readonly audio: AudioApi;
  readonly fx: FxApi;
  readonly hud: HudApi;
  /** keyboard fallback (keys currently held; letters are lower-case) */
  readonly keys: ReadonlySet<string>;
  say(text: string, sub?: string, ms?: number): void;
  /** Register a 2D overlay painter (drawn every frame on the fx canvas). Returns an unsubscribe function. */
  onDraw(fn: DrawFn): () => void;
  /** Game over: the engine shows "tugadi", then the results screen. Safe to call more than once (first wins). */
  finish(result: GameResult): void;
  /** Screen px -> world point on the plane z (AR overlay camera at z=10, fov 50). Writes into `out`. */
  screenToWorld(x: number, y: number, z: number, out: WorldPoint): void;
  /** World size of one screen pixel at plane z. */
  pxToWorld(z?: number): number;
}

export interface GameMeta {
  /** must equal the slug in lib/games.ts */
  slug: string;
  /** 1 = single player only, 2 = supports one or two players */
  maxPlayers: 1 | 2;
  /** needs the HandLandmarker (finger level tracking). Loaded only when true. */
  needsHands: boolean;
  /** requires the legs to be visible (calibration insists on full body) */
  needsLegs: boolean;
  /** true: own 3D world (camera becomes a small picture-in-picture). false: AR overlay over the mirrored camera. */
  world: boolean;
  /** brightness of the camera picture behind an AR game (0..1, default 0.62) */
  dim?: number;
  /** background music bpm hint, informational */
  musicBpm?: number;
}

export interface SceneProps {
  engine: EngineApi;
}

/** What `games/<slug>/index.ts` must default-export. */
export interface GameModule {
  meta: GameMeta;
  /** Rendered inside the engine's R3F <Canvas>. Mounted for every play session, unmounted on exit/replay. */
  Scene: ComponentType<SceneProps>;
}
