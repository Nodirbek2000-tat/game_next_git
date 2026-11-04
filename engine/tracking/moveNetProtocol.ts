import type { DetectionResult } from "../types";

// MoveNet in a worker: the messages between the page (tracking/moveNetWorker.ts) and the worker (tracking/movenet.worker.ts), and the
// surface both MoveNet detectors (worker, main-thread debug path) share with the runtime. Pure types: no DOM, no TensorFlow.

/** progress (percent) the worker reports when it starts compiling the shaders: long silent calls, the page waits longer from here until "ready" */
export const WARM_PCT = 88;

/** Key of a model picture geometry: a new one needs its own GPU programs (shader compile). */
export function geoKey(g: { rw: number; rh: number; pw: number; ph: number }): string {
  return `${g.rw}x${g.rh}x${g.pw}x${g.ph}`;
}

/** page -> worker */
export type ToWorker =
  /**
   * `geos` = the picture geometries the session may use (the ladder rungs for this camera); all of them are compiled while the loading
   * screen is up, in one parallel pass, so a size change during the game never stalls the worker. The first one is the starting size.
   */
  | { type: "init"; modelUrl: string; geos: { rw: number; rh: number; pw: number; ph: number }[] }
  /**
   * one camera picture, already scaled to rw x rh; the worker pads it to pw x ph (bottom / right, black). `bitmap` is transferred.
   * `also` = more geometries to compile in the same pass as this picture's own (the neighbouring rungs of a camera shape not seen at
   * start, e.g. after the device was turned): the picture waits for one compile pass, never for a second one later.
   */
  | { type: "frame"; id: number; bitmap: ImageBitmap; rw: number; rh: number; pw: number; ph: number; also?: { rw: number; rh: number; pw: number; ph: number }[] }
  /** the low-light brightening table (256 entries) or null = off; sent only when it changes */
  | { type: "lut"; lut: Uint8Array | null }
  | { type: "close" };

/** worker -> page */
export type FromWorker =
  | { type: "progress"; pct: number; label: string }
  | { type: "ready"; backend: string }
  /** the shaders of this picture geometry (geoKey) are compiled: a picture of that size no longer stalls the worker */
  | { type: "compiled"; key: string }
  /** this browser / GPU cannot run it in a worker: the page falls back (reason: "nowebgl" | "backend") */
  | { type: "unsupported"; reason: string }
  /** `data` = the model output [6 x 56] (transferred), `ms` = time in the worker, `tensors` / `bytes` = what tfjs holds (must stay flat) */
  | { type: "result"; id: number; data: Float32Array; ms: number; tensors: number; bytes: number }
  /** a picture that arrived while the worker was not ready or still busy: dropped */
  | { type: "skipped"; id: number }
  | { type: "error"; id?: number; message: string; fatal: boolean };

export interface MoveNetStats {
  /** model picture size (longest side, px) */
  side: number;
  /** round trip of a call: grab + worker (upload, GPU, read-back) + decode, ms (EMA) */
  ms: number;
  /** the part of it that kept the MAIN thread busy (grab call, posting, decode), ms (EMA). Worker path: ~0.2 ms. */
  blockMs: number;
  /** time inside the worker (EMA, ms); 0 on the main-thread path */
  workerMs: number;
  /** people returned by the latest call */
  people: number;
}

/** What the runtime needs from a MoveNet detector. */
export interface PoseDetectorLike {
  readonly kind: "MoveNet";
  /** "worker" | "main" */
  readonly where: "worker" | "main";
  readonly backend: string;
  maxPeople: number;
  /** too many failures / a silent worker / a lost WebGL context: the runtime goes back to MediaPipe */
  readonly broken: boolean;
  readonly stats: MoveNetStats;
  /** one call at a time: null when one is still running or the video has no picture yet */
  detect(video: HTMLVideoElement, opts?: { lut?: Uint8Array | null }): Promise<DetectionResult | null>;
  setMaxPeople(n: number): void;
  /** debug: live tensors / bytes held by tfjs (must stay flat) */
  memory(): { tensors: number; bytes: number };
  close(): void;
}

export interface MoveNetCreateOptions {
  /** most people returned (crowd games: MAX_KIDS) */
  maxPeople: number;
  /** fixed longest side of the model picture (?mnside=); null = adaptive */
  side?: number | null;
  /** the camera picture size, when already known: the shaders are compiled for exactly this shape (default 1280 x 720) */
  camera?: { w: number; h: number } | null;
  /** aborting stops the start-up (the game was left while loading): create() rejects and the worker is terminated */
  signal?: AbortSignal;
  onProgress?: (pct: number, label: string) => void;
}
