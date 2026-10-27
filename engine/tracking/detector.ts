import type { DetectionResult, HandResultLike, PoseResultLike } from "../types";
import { applyLut, type Confidence } from "./lowLight";

export type PoseModelName = "lite" | "full";
export type Delegate = "GPU" | "CPU";

export interface DetectorInfo {
  where: "worker" | "main";
  poseModel: PoseModelName;
  delegate: { pose: Delegate; hand: Delegate | null };
  hands: boolean;
}

export interface DetectorOptions {
  poseModel: PoseModelName;
  hands: boolean;
  /** try a Web Worker first (falls back to the main thread when the worker cannot start) */
  preferWorker: boolean;
  onProgress?: (pct: number, label: string) => void;
}

/** Per frame options (chosen by the runtime from the measured light and CPU load). */
export interface DetectOptions {
  /** longest side of the image sent to the model (default 640; the pose models work on 256 px internally) */
  maxSide?: number;
  /** brighten the frame with this lookup table first (dim camera), see lowLight.ts */
  lut?: Uint8Array | null;
}

/** Common surface of the two back-ends. */
interface Backend {
  readonly info: DetectorInfo;
  /** resolves null when the back-end is still busy with the previous frame */
  detect(video: HTMLVideoElement, ts: number, wantHands: boolean, opts?: DetectOptions): Promise<DetectionResult | null>;
  setConfidence(c: Confidence): void;
  close(): void;
}

const MAX_SIDE = 640;

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
    const k = Math.min(1, side / Math.max(vw, vh));
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

  private constructor(worker: Worker, info: DetectorInfo) {
    this.worker = worker;
    this.info = info;
    worker.addEventListener("message", (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "result" && this.pending && this.pending.id === m.id) {
        const p = this.pending;
        this.pending = null;
        p.resolve({ pose: m.pose as PoseResultLike | null, hand: m.hand as HandResultLike | null });
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
      }, 45000);
      const onMsg = (e: MessageEvent): void => {
        const m = e.data;
        if (m.type === "progress") opts.onProgress?.(m.pct, m.label);
        else if (m.type === "ready") {
          clearTimeout(timer);
          worker.removeEventListener("message", onMsg);
          worker.removeEventListener("error", onErr);
          resolve(new WorkerBackend(worker, { where: "worker", poseModel: opts.poseModel, delegate: { pose: m.delegate.pose, hand: opts.hands ? m.delegate.hand : null }, hands: opts.hands }));
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
      worker.postMessage({ type: "init", origin: location.origin, pose: opts.poseModel, hands: opts.hands });
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

  setConfidence(c: Confidence): void {
    this.worker.postMessage({ type: "confidence", det: c.det, pres: c.pres, track: c.track });
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

  private constructor(
    private pose: Landmarker,
    private hand: Landmarker | null,
    info: DetectorInfo,
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
    const pose = (await make(vision.PoseLandmarker, poseBuf, { numPoses: 4, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 }, "pose")) as unknown as Landmarker;
    let hand: Landmarker | null = null;
    if (opts.hands) {
      const handBuf = await fetchWithProgress("/models/hand_landmarker.task", "Qo‘l modeli", 65, 25, opts.onProgress);
      hand = (await make(vision.HandLandmarker, handBuf, { numHands: 6, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }, "hand")) as unknown as Landmarker;
    }
    opts.onProgress?.(100, "Tayyor");
    return new MainBackend(pose, hand, { where: "main", poseModel: opts.poseModel, delegate, hands: opts.hands });
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

  setConfidence(c: Confidence): void {
    void this.pose.setOptions({ minPoseDetectionConfidence: c.det, minPosePresenceConfidence: c.pres, minTrackingConfidence: c.track }).catch(() => undefined);
    void this.hand?.setOptions({ minHandDetectionConfidence: c.det, minHandPresenceConfidence: c.pres, minTrackingConfidence: c.track }).catch(() => undefined);
  }

  close(): void {
    try {
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

  /** MediaPipe confidence thresholds (lowered a little when the picture is dark). */
  setConfidence(c: Confidence): void {
    this.backend.setConfidence(c);
  }

  close(): void {
    this.backend.close();
  }
}
