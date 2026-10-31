import type { DetectionResult, HandResultLike, PoseResultLike, TileOutput } from "../types";
import { CROWD_CFG } from "./crowdConfig";
import { applyLut, type Confidence } from "./lowLight";
import { tileOutSize, tileRectPx, type PxRect, type Tile } from "./tiles";

export type PoseModelName = "lite" | "full";
export type Delegate = "GPU" | "CPU";

export interface DetectorInfo {
  where: "worker" | "main";
  poseModel: PoseModelName;
  delegate: { pose: Delegate; hand: Delegate | null };
  hands: boolean;
  /** startup benchmark of the worker (median ms per frame of each delegate; null = not measured, Infinity = failed) */
  bench?: { gpu: number | null; cpu: number | null } | null;
}

export interface DetectorOptions {
  poseModel: PoseModelName;
  hands: boolean;
  /** how many bodies the pose model follows (default 4; crowd / Bog‘cha games ask for 5) */
  numPoses?: number;
  /** MediaPipe pose confidence (detection / presence / tracking), default 0.5; crowd games lower it for small bodies */
  minConf?: number;
  /** "auto" (default) benchmarks the GPU and the CPU delegate at startup and keeps the faster one; a fixed value skips the benchmark */
  delegate?: "auto" | Delegate;
  /** try a Web Worker first (falls back to the main thread when the worker cannot start) */
  preferWorker: boolean;
  onProgress?: (pct: number, label: string) => void;
}

/** Per frame options (chosen by the runtime from the measured light and CPU load). */
export interface DetectOptions {
  /** longest side of the image sent to the model (default 480; the pose models work on 256 px internally) */
  maxSide?: number;
  /** brighten the frame with this lookup table first (dim camera), see lowLight.ts */
  lut?: Uint8Array | null;
  /** crop detection only: longest side (px) of the picture sent to the model for a crop (default CROWD_CFG.tiles.side) */
  tileSide?: number;
}

/** Common surface of the two back-ends. */
interface Backend {
  readonly info: DetectorInfo;
  /** resolves null when the back-end is still busy with the previous frame */
  detect(video: HTMLVideoElement, ts: number, wantHands: boolean, opts?: DetectOptions): Promise<DetectionResult | null>;
  /**
   * Crowd games: analyse crops of the camera picture (cut from the full-resolution frame, each one shown to the model on its own).
   * Resolves null when busy or when a crop has no model; the outputs carry landmarks normalised to the crop.
   */
  detectTiles(video: HTMLVideoElement, ts: number, tiles: readonly Tile[], opts?: DetectOptions): Promise<TileOutput[] | null>;
  /** Make ready the models for `n` crops (the first one is the normal pose model); `tilesReady` tells when. Safe to call again. */
  prepareTiles(n: number): void;
  /** how many crops can be analysed right now (0 = none, use `detect`) */
  readonly tilesReady: number;
  setConfidence(c: Confidence): void;
  /** how many bodies the pose model follows (fewer = faster) */
  setPoses(n: number): void;
  /** leave the GPU delegate (it is slow on this machine right now); resolves nothing, `info.delegate.pose` changes when done */
  useCpu(): void;
  close(): void;
}

const MAX_SIDE = 480;
/** The brightening pass (CPU, main thread) never works on more than this many px: the pose models look at 256 px anyway. */
const ENHANCE_SIDE = 320;

/** Scratch canvas for the brightened frame (the camera picture is never modified, only the copy sent to the model). */
class Enhancer {
  private c: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.c = document.createElement("canvas");
    const ctx = this.c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d canvas unavailable");
    this.ctx = ctx;
  }

  /** Draw the video scaled to `side` px (longest edge) and push it through the LUT. */
  render(video: HTMLVideoElement, side: number, lut: Uint8Array): { canvas: HTMLCanvasElement; image: ImageData } {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const k = Math.min(1, Math.min(side, ENHANCE_SIDE) / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * k));
    const h = Math.max(2, Math.round(vh * k));
    if (this.c.width !== w || this.c.height !== h) {
      this.c.width = w;
      this.c.height = h;
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    const image = this.ctx.getImageData(0, 0, w, h);
    applyLut(image.data, lut);
    return { canvas: this.c, image };
  }

  /** The same for a crop of the video (source pixels `r`), drawn `w` x `h` px. */
  renderCrop(video: HTMLVideoElement, r: PxRect, w: number, h: number, lut: Uint8Array): { canvas: HTMLCanvasElement; image: ImageData } {
    if (this.c.width !== w || this.c.height !== h) {
      this.c.width = w;
      this.c.height = h;
    }
    this.ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    const image = this.ctx.getImageData(0, 0, w, h);
    applyLut(image.data, lut);
    return { canvas: this.c, image };
  }
}

/** Longest side (px) of a crop picture; smaller when it is brightened on the main thread. */
function cropSide(opts: DetectOptions | undefined): number {
  const base = opts?.tileSide ?? CROWD_CFG.tiles.side;
  return opts?.lut ? Math.min(base, CROWD_CFG.tiles.sideDark) : base;
}

async function fetchWithProgress(url: string, label: string, base: number, span: number, onProgress?: (pct: number, label: string) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model ${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) {
    const b = new Uint8Array(await res.arrayBuffer());
    onProgress?.(base + span, label);
    return b;
  }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got);
    got += value.length;
    onProgress?.(base + span * Math.min(1, got / total), label);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Worker back-end
// ---------------------------------------------------------------------------------------------
class WorkerBackend implements Backend {
  info: DetectorInfo;
  private worker: Worker;
  private nextId = 1;
  private pending: { id: number; resolve: (r: DetectionResult | null) => void } | null = null;
  private enhancer: Enhancer | null = null;
  private tiles = 0;

  private constructor(worker: Worker, info: DetectorInfo) {
    this.worker = worker;
    this.info = info;
    worker.addEventListener("message", (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "result" && this.pending && this.pending.id === m.id) {
        const p = this.pending;
        this.pending = null;
        p.resolve({ pose: m.pose as PoseResultLike | null, hand: m.hand as HandResultLike | null, tiles: m.tiles as TileOutput[] | undefined });
      } else if (m.type === "tilesReady") {
        this.tiles = Number(m.n) || 0;
      } else if (m.type === "delegate") {
        this.info = { ...this.info, delegate: { ...this.info.delegate, pose: m.pose as Delegate } };
      } else if (m.type === "error") {
        console.warn("tracking worker:", m.message);
        if (this.pending) {
          this.pending.resolve(null);
          this.pending = null;
        }
      }
    });
  }

  static start(opts: DetectorOptions): Promise<WorkerBackend> {
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker("/engine/tracking-worker.js");
      } catch (e) {
        reject(e);
        return;
      }
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error("worker timeout"));
      }, 60000);
      const onMsg = (e: MessageEvent): void => {
        const m = e.data;
        if (m.type === "progress") opts.onProgress?.(m.pct, m.label);
        else if (m.type === "ready") {
          clearTimeout(timer);
          worker.removeEventListener("message", onMsg);
          worker.removeEventListener("error", onErr);
          resolve(new WorkerBackend(worker, { where: "worker", poseModel: opts.poseModel, delegate: { pose: m.delegate.pose, hand: opts.hands ? m.delegate.hand : null }, hands: opts.hands, bench: m.bench ?? null }));
        } else if (m.type === "error") {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(m.message));
        }
      };
      const onErr = (e: ErrorEvent): void => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(e.message || "worker error"));
      };
      worker.addEventListener("message", onMsg);
      worker.addEventListener("error", onErr);
      worker.postMessage({ type: "init", origin: location.origin, pose: opts.poseModel, hands: opts.hands, numPoses: opts.numPoses ?? 2, conf: opts.minConf ?? 0.5, delegate: opts.delegate ?? "auto" });
    });
  }

  async detect(video: HTMLVideoElement, ts: number, wantHands: boolean, opts?: DetectOptions): Promise<DetectionResult | null> {
    if (this.pending) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const side = opts?.maxSide ?? MAX_SIDE;
    let bitmap: ImageBitmap | null = null;
    if (opts?.lut) {
      try {
        this.enhancer ??= new Enhancer();
        bitmap = await createImageBitmap(this.enhancer.render(video, side, opts.lut).image);
      } catch {
        bitmap = null; // fall through to the plain copy
      }
    }
    if (!bitmap) {
      const k = Math.min(1, side / Math.max(vw, vh));
      bitmap = await createImageBitmap(video, k < 1 ? { resizeWidth: Math.round(vw * k), resizeHeight: Math.round(vh * k), resizeQuality: "low" } : undefined);
    }
    if (this.pending) {
      bitmap.close();
      return null;
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending = { id, resolve };
      this.worker.postMessage({ type: "frame", id, bitmap, ts, hands: wantHands && this.info.hands }, [bitmap]);
    });
  }

  get tilesReady(): number {
    return this.tiles;
  }

  prepareTiles(n: number): void {
    this.worker.postMessage({ type: "prepareTiles", n });
  }

  /** One picture per crop, cut from the full-resolution video frame and sent to the worker (ImageBitmaps are moved, not copied). */
  async detectTiles(video: HTMLVideoElement, ts: number, tiles: readonly Tile[], opts?: DetectOptions): Promise<TileOutput[] | null> {
    if (this.pending || tiles.length === 0) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || tiles.some((t) => t.index >= this.tiles)) return null;
    const side = cropSide(opts);
    const bitmaps: ImageBitmap[] = [];
    try {
      for (const t of tiles) bitmaps.push(await this.cropBitmap(video, tileRectPx(t, vw, vh), side, opts?.lut ?? null));
    } catch (e) {
      for (const b of bitmaps) b.close();
      throw e;
    }
    if (this.pending) {
      for (const b of bitmaps) b.close();
      return null;
    }
    const id = this.nextId++;
    const items = tiles.map((t, i) => ({ tile: t.index, bitmap: bitmaps[i] }));
    const res = await new Promise<DetectionResult | null>((resolve) => {
      this.pending = { id, resolve };
      this.worker.postMessage({ type: "tiles", id, items, ts }, bitmaps);
    });
    return res?.tiles ?? null;
  }

  private async cropBitmap(video: HTMLVideoElement, r: PxRect, side: number, lut: Uint8Array | null): Promise<ImageBitmap> {
    const o = tileOutSize(r.sw, r.sh, side);
    if (lut) {
      try {
        this.enhancer ??= new Enhancer();
        return await createImageBitmap(this.enhancer.renderCrop(video, r, o.w, o.h, lut).image);
      } catch {
        /* fall through to the plain crop */
      }
    }
    return createImageBitmap(video, r.sx, r.sy, r.sw, r.sh, o.scaled ? { resizeWidth: o.w, resizeHeight: o.h, resizeQuality: "low" } : undefined);
  }

  setConfidence(c: Confidence): void {
    this.worker.postMessage({ type: "confidence", det: c.det, pres: c.pres, track: c.track });
  }

  setPoses(n: number): void {
    this.worker.postMessage({ type: "poses", n });
  }

  useCpu(): void {
    this.worker.postMessage({ type: "delegate", to: "CPU" });
  }

  close(): void {
    try {
      this.worker.postMessage({ type: "close" });
    } catch {
      /* worker already gone */
    }
    setTimeout(() => this.worker.terminate(), 200);
  }
}

// ---------------------------------------------------------------------------------------------
// Main-thread back-end (fallback)
// ---------------------------------------------------------------------------------------------
type Vision = typeof import("@mediapipe/tasks-vision");
interface Landmarker {
  detectForVideo(image: HTMLVideoElement | HTMLCanvasElement, ts: number): { landmarks: unknown; worldLandmarks?: unknown };
  setOptions(o: object): Promise<void>;
  close(): void;
}

class MainBackend implements Backend {
  info: DetectorInfo;
  private lastTs = 0;
  private enhancer: Enhancer | null = null;
  /** models of the crops 1.. (crop 0 is `pose`), created on demand */
  private extra: Landmarker[] = [];
  private tilesWanted = 0;
  private cropCanvas: HTMLCanvasElement | null = null;

  private constructor(
    private pose: Landmarker,
    private hand: Landmarker | null,
    info: DetectorInfo,
    private mkPose: () => Promise<Landmarker>,
  ) {
    this.info = info;
  }

  static async start(opts: DetectorOptions): Promise<MainBackend> {
    const vision: Vision = await import("@mediapipe/tasks-vision");
    opts.onProgress?.(5, "Dvigatel");
    const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe");
    opts.onProgress?.(15, "Dvigatel");
    const delegate = { pose: "GPU" as Delegate, hand: null as Delegate | null };
    const make = async <T, O>(Cls: { createFromOptions: (f: typeof fileset, o: O) => Promise<T> }, buf: Uint8Array, extra: object, key: "pose" | "hand"): Promise<T> => {
      const mk = (d: Delegate) => Cls.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: buf, delegate: d }, runningMode: "VIDEO", ...extra } as unknown as O);
      try {
        const t = await mk("GPU");
        delegate[key] = "GPU";
        return t;
      } catch {
        delegate[key] = "CPU";
        return mk("CPU");
      }
    };
    const poseBuf = await fetchWithProgress(`/models/pose_landmarker_${opts.poseModel}.task`, "Tana modeli", 15, 45, opts.onProgress);
    const poseExtra = { numPoses: opts.numPoses ?? 2, minPoseDetectionConfidence: opts.minConf ?? 0.5, minPosePresenceConfidence: opts.minConf ?? 0.5, minTrackingConfidence: opts.minConf ?? 0.5 };
    const mkPose = async (): Promise<Landmarker> => (await make(vision.PoseLandmarker, poseBuf, poseExtra, "pose")) as unknown as Landmarker;
    const pose = await mkPose();
    let hand: Landmarker | null = null;
    if (opts.hands) {
      const handBuf = await fetchWithProgress("/models/hand_landmarker.task", "Qo‘l modeli", 65, 25, opts.onProgress);
      hand = (await make(vision.HandLandmarker, handBuf, { numHands: 4, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }, "hand")) as unknown as Landmarker;
    }
    opts.onProgress?.(100, "Tayyor");
    return new MainBackend(pose, hand, { where: "main", poseModel: opts.poseModel, delegate, hands: opts.hands }, mkPose);
  }

  async detect(video: HTMLVideoElement, ts: number, wantHands: boolean, opts?: DetectOptions): Promise<DetectionResult | null> {
    const t = Math.max(Math.round(ts), this.lastTs + 1);
    this.lastTs = t;
    let pose: PoseResultLike | null = null;
    let hand: HandResultLike | null = null;
    let src: HTMLVideoElement | HTMLCanvasElement = video;
    if (opts?.lut && video.videoWidth) {
      try {
        this.enhancer ??= new Enhancer();
        const r = this.enhancer.render(video, opts.maxSide ?? MAX_SIDE, opts.lut);
        r.canvas.getContext("2d")?.putImageData(r.image, 0, 0);
        src = r.canvas;
      } catch {
        src = video;
      }
    }
    try {
      pose = this.pose.detectForVideo(src, t) as unknown as PoseResultLike;
    } catch (e) {
      console.warn(e);
    }
    if (wantHands && this.hand) {
      try {
        hand = this.hand.detectForVideo(src, t) as unknown as HandResultLike;
      } catch (e) {
        console.warn(e);
      }
    }
    return { pose, hand };
  }

  get tilesReady(): number {
    return this.tilesWanted >= 2 && this.extra.length >= this.tilesWanted - 1 ? this.tilesWanted : 0;
  }

  prepareTiles(n: number): void {
    const want = Math.max(1, Math.min(4, Math.floor(n)));
    if (want === this.tilesWanted) return;
    this.tilesWanted = want;
    void (async () => {
      try {
        while (this.extra.length < want - 1) this.extra.push(await this.mkPose());
      } catch (e) {
        console.warn("crop models unavailable:", e);
        for (const l of this.extra.splice(0)) {
          try {
            l.close();
          } catch {
            /* ignore */
          }
        }
        this.tilesWanted = 0;
      }
    })();
  }

  /** Same as the worker back-end, on the main thread: the crop is drawn onto a canvas that the model reads. */
  async detectTiles(video: HTMLVideoElement, ts: number, tiles: readonly Tile[], opts?: DetectOptions): Promise<TileOutput[] | null> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || tiles.length === 0 || tiles.some((t) => t.index >= this.tilesReady)) return null;
    const side = cropSide(opts);
    const out: TileOutput[] = [];
    for (const t of tiles) {
      const r = tileRectPx(t, vw, vh);
      const o = tileOutSize(r.sw, r.sh, side);
      let src: HTMLCanvasElement | null = null;
      try {
        if (opts?.lut) {
          this.enhancer ??= new Enhancer();
          const e = this.enhancer.renderCrop(video, r, o.w, o.h, opts.lut);
          e.canvas.getContext("2d")?.putImageData(e.image, 0, 0);
          src = e.canvas;
        } else {
          this.cropCanvas ??= document.createElement("canvas");
          const c = this.cropCanvas;
          if (c.width !== o.w || c.height !== o.h) {
            c.width = o.w;
            c.height = o.h;
          }
          c.getContext("2d")?.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, o.w, o.h);
          src = c;
        }
      } catch {
        src = null;
      }
      let pose: PoseResultLike | null = null;
      const lm = t.index === 0 ? this.pose : this.extra[t.index - 1];
      if (src && lm) {
        this.lastTs = Math.max(Math.round(ts), this.lastTs + 1);
        try {
          pose = lm.detectForVideo(src, this.lastTs) as unknown as PoseResultLike;
        } catch (e) {
          console.warn(e);
        }
      }
      out.push({ tile: t.index, pose });
    }
    return out;
  }

  setConfidence(c: Confidence): void {
    for (const l of this.extra) void l.setOptions({ minPoseDetectionConfidence: c.det, minPosePresenceConfidence: c.pres, minTrackingConfidence: c.track }).catch(() => undefined);
    void this.pose.setOptions({ minPoseDetectionConfidence: c.det, minPosePresenceConfidence: c.pres, minTrackingConfidence: c.track }).catch(() => undefined);
    void this.hand?.setOptions({ minHandDetectionConfidence: c.det, minHandPresenceConfidence: c.pres, minTrackingConfidence: c.track }).catch(() => undefined);
  }

  setPoses(n: number): void {
    for (const l of this.extra) void l.setOptions({ numPoses: n }).catch(() => undefined);
    void this.pose.setOptions({ numPoses: n }).catch(() => undefined);
  }

  useCpu(): void {
    /* the main-thread back-end keeps its delegate */
  }

  close(): void {
    try {
      for (const l of this.extra) l.close();
      this.pose.close();
      this.hand?.close();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * MediaPipe detector. Tries a Web Worker (GPU delegate, then CPU inside the worker); when the worker cannot
 * be started the same models run on the main thread (GPU, then CPU). Rendering is never blocked by the
 * worker path; the main-thread path costs ~10-25 ms per analysed frame.
 */
export class Detector {
  private constructor(private backend: Backend) {}

  static async create(opts: DetectorOptions): Promise<Detector> {
    if (opts.preferWorker && typeof Worker !== "undefined" && typeof createImageBitmap === "function") {
      try {
        return new Detector(await WorkerBackend.start(opts));
      } catch (e) {
        console.warn("Web Worker tracking unavailable, using the main thread:", e);
      }
    }
    return new Detector(await MainBackend.start(opts));
  }

  get info(): DetectorInfo {
    return this.backend.info;
  }

  detect(video: HTMLVideoElement, ts: number, wantHands: boolean, opts?: DetectOptions): Promise<DetectionResult | null> {
    return this.backend.detect(video, ts, wantHands, opts);
  }

  /** Crowd games: analyse crops of the camera picture (see Backend.detectTiles). */
  detectTiles(video: HTMLVideoElement, ts: number, tiles: readonly Tile[], opts?: DetectOptions): Promise<TileOutput[] | null> {
    return this.backend.detectTiles(video, ts, tiles, opts);
  }

  /** Make the models for `n` crops ready in the background (the full-frame `detect` keeps working meanwhile). */
  prepareTiles(n: number): void {
    this.backend.prepareTiles(n);
  }

  /** How many crops can be analysed right now (0 = none). */
  get tilesReady(): number {
    return this.backend.tilesReady;
  }

  /** Switch the pose model to the CPU delegate (worker back-end only). */
  useCpu(): void {
    this.backend.useCpu();
  }

  /** Number of bodies the pose model follows. */
  setPoses(n: number): void {
    this.backend.setPoses(n);
  }

  /** MediaPipe confidence thresholds (lowered a little when the picture is dark). */
  setConfidence(c: Confidence): void {
    this.backend.setConfidence(c);
  }

  close(): void {
    this.backend.close();
  }
}
