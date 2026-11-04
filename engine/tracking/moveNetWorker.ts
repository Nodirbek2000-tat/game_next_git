import type { DetectionResult } from "../types";
import { CROWD_CFG } from "./crowdConfig";
import { decodeMultiPose, inputGeo, PosePool, SizeController, type InputGeo } from "./moveNetCore";
import { geoKey, WARM_PCT, type FromWorker, type MoveNetCreateOptions, type MoveNetStats, type PoseDetectorLike, type ToWorker } from "./moveNetProtocol";

// MoveNet MultiPose on a worker: the page only grabs a scaled copy of the camera picture (createImageBitmap: asynchronous, GPU side, no
// canvas, no pixel read-back), moves it to the worker and decodes 336 numbers when the answer comes back. The model (upload, ~100 GPU
// ops, the read-back that blocks inside tfjs) runs in tracking/movenet.worker.ts, so the page keeps its 60 fps whatever the GPU is
// doing; a slow device only gets fewer detections per second (the animals keep moving between them).
//
// Output: a DetectionResult exactly like the MediaPipe worker's: `pose.landmarks` = people with 33 MediaPipe-indexed landmarks
// normalised to the whole un-mirrored camera picture. Mirroring and the cover fit are done by tracking/people.ts for both detectors.

export interface WorkerLike {
  postMessage(msg: ToWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", f: (e: { data: FromWorker }) => void): void;
  addEventListener(type: "error", f: (e: { message?: string }) => void): void;
  terminate(): void;
}

export interface MoveNetWorkerOptions extends MoveNetCreateOptions {
  /** tests: a stand-in for the Worker */
  makeWorker?: () => WorkerLike;
  /** tests: a stand-in for createImageBitmap */
  grab?: (video: HTMLVideoElement, rw: number, rh: number) => Promise<ImageBitmap>;
}

/** Why the worker path cannot be used here (the runtime falls back to MediaPipe). */
export class MoveNetUnsupported extends Error {}

/** The literal `new Worker(new URL(...))` is what the bundler recognises: keep it in this one expression. */
function spawn(): WorkerLike {
  return new Worker(new URL("./movenet.worker.ts", import.meta.url), { type: "module", name: "movenet" }) as unknown as WorkerLike;
}

function grabBitmap(video: HTMLVideoElement, rw: number, rh: number): Promise<ImageBitmap> {
  return createImageBitmap(video, { resizeWidth: rw, resizeHeight: rh, resizeQuality: "low" });
}

interface Pending {
  id: number;
  resolve: (r: DetectionResult | null) => void;
  reject: (e: Error) => void;
  t0: number;
  geo: InputGeo;
  /** ms spent on the main thread so far (grab call + posting) */
  block: number;
  /** how long (ms) the worker may stay silent: longer for the first picture of a new size (its shaders are compiled first) */
  limit: number;
  /** sent with a size that was not compiled yet: its round trip includes the compile, so it is no measure of the device */
  cold: boolean;
}

export class MoveNetWorkerDetector implements PoseDetectorLike {
  readonly kind = "MoveNet";
  readonly where = "worker";
  backend = "";
  maxPeople: number;
  broken = false;
  readonly stats: MoveNetStats = { side: 0, ms: 0, blockMs: 0, workerMs: 0, people: 0 };
  private closed = false;
  private fails = 0;
  private nextId = 1;
  private pending: Pending | null = null;
  private readonly size: SizeController;
  private readonly pools = [new PosePool(), new PosePool()];
  private flip = 0;
  private readonly results: DetectionResult[];
  private lastLut: Uint8Array | null = null;
  /** picture geometries (geoKey) whose shaders the worker has compiled: any other one stalls the worker for seconds on its first picture */
  private readonly compiled = new Set<string>();
  private vw = 0;
  private vh = 0;
  private tensors = 0;
  private bytes = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private readonly grab: (video: HTMLVideoElement, rw: number, rh: number) => Promise<ImageBitmap>;
  /** the page-side handlers of the worker's messages while it is starting up */
  private onInit: ((m: FromWorker) => void) | null = null;
  private onCrash: ((message: string) => void) | null = null;

  private constructor(
    private readonly worker: WorkerLike,
    o: MoveNetWorkerOptions,
  ) {
    this.maxPeople = o.maxPeople;
    this.size = typeof o.side === "number" && o.side > 0 ? SizeController.fixedAt(o.side) : new SizeController();
    this.results = this.pools.map((p) => ({ pose: { landmarks: p.view }, hand: null }));
    this.stats.side = this.size.side;
    // the ladder steps only to sizes the worker has compiled (reported by it, or already answered): a size change never stalls detection
    this.size.allow = (idx) => this.vw > 0 && this.compiled.has(geoKey(inputGeo(this.vw, this.vh, this.size.sideAt(idx))));
    this.grab = o.grab ?? grabBitmap;
    worker.addEventListener("message", (e) => this.onMessage(e.data));
    worker.addEventListener("error", (e) => this.crash(e.message || "worker error"));
  }

  /**
   * Starts the worker and waits until the model is loaded and the shaders are compiled.
   * Throws MoveNetUnsupported when this browser cannot do it (no module worker / OffscreenCanvas WebGL / ImageBitmap) and Error when
   * it does not start in time or fails: the caller falls back to MediaPipe either way.
   */
  static async create(o: MoveNetWorkerOptions): Promise<MoveNetWorkerDetector> {
    if (!o.makeWorker && (typeof Worker === "undefined" || typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined")) {
      throw new MoveNetUnsupported("worker / OffscreenCanvas / ImageBitmap unavailable");
    }
    if (o.signal?.aborted) throw new Error("MoveNet start cancelled");
    o.onProgress?.(2, "MoveNet dvigateli");
    const worker = (o.makeWorker ?? spawn)();
    const det = new MoveNetWorkerDetector(worker, o);
    // leaving the game while this loads: close() ends start() at once and terminates the worker (no compile left running on the GPU)
    const cancel = (): void => det.close();
    o.signal?.addEventListener("abort", cancel, { once: true });
    try {
      await det.start(o);
      det.watch();
    } catch (e) {
      det.close();
      throw e;
    } finally {
      o.signal?.removeEventListener("abort", cancel);
    }
    o.onProgress?.(100, "Tayyor");
    return det;
  }

  private start(o: MoveNetWorkerOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const arm = (limit: number): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => done(new Error("MoveNet worker did not start in time")), limit);
      };
      const done = (err?: Error): void => {
        if (timer) clearTimeout(timer);
        this.onInit = null;
        this.onCrash = null;
        if (err) reject(err);
        else resolve();
      };
      // from the shader compile on, the worker makes long silent calls until "ready" (compile pass, then the first real run)
      let warming = false;
      this.onInit = (m) => {
        // any sign of life restarts the wait (a slow download is not a hang)
        if (m.type === "progress" && m.pct >= WARM_PCT) warming = true;
        arm(warming ? CROWD_CFG.movenet.warmTimeoutMs : CROWD_CFG.movenet.initTimeoutMs);
        if (m.type === "progress") o.onProgress?.(2 + m.pct * 0.9, m.label);
        else if (m.type === "ready") {
          this.backend = m.backend;
          done();
        } else if (m.type === "unsupported") done(new MoveNetUnsupported(m.reason));
        else if (m.type === "error") done(new Error(m.message));
      };
      this.onCrash = (message) => done(new Error(message));
      arm(CROWD_CFG.movenet.initTimeoutMs);
      this.post({ type: "init", modelUrl: location.origin + CROWD_CFG.movenet.modelUrl, geos: this.startGeos(o.camera) });
    });
  }

  /**
   * The sizes compiled during loading, starting size first: a fixed size alone; adaptive = the rungs from the lowest up to one above the
   * start (bigger ones would cost every device seconds of loading for a size only a strong GPU reaches; the ladder never steps to them).
   */
  private startGeos(camera: MoveNetCreateOptions["camera"]): InputGeo[] {
    const w = camera && camera.w > 0 && camera.h > 0 ? camera.w : 1280;
    const h = camera && camera.w > 0 && camera.h > 0 ? camera.h : 720;
    const idx = this.size.idx;
    const rungs = this.size.fixed ? [idx] : [idx, ...this.size.ladder.map((_, i) => i).filter((i) => i !== idx && i <= idx + 1)];
    return rungs.map((i) => ({ ...inputGeo(w, h, this.size.sideAt(i)) }));
  }

  /** the rungs next to the current one for this camera shape that are not compiled (adaptive only) */
  private missingNeighbours(vw: number, vh: number): InputGeo[] {
    if (this.size.fixed) return [];
    const out: InputGeo[] = [];
    for (const i of [this.size.idx - 1, this.size.idx + 1]) {
      if (i < 0 || i >= this.size.ladder.length) continue;
      const g = { ...inputGeo(vw, vh, this.size.sideAt(i)) };
      if (!this.compiled.has(geoKey(g))) out.push(g);
    }
    return out;
  }

  private post(m: ToWorker, transfer?: Transferable[]): void {
    this.worker.postMessage(m, transfer);
  }

  private onMessage(m: FromWorker): void {
    if (this.closed) return;
    if (m.type === "compiled") this.compiled.add(m.key);
    if (this.onInit) {
      this.onInit(m);
      return;
    }
    const p = this.pending;
    switch (m.type) {
      case "result":
        if (p && p.id === m.id) this.finish(p, m);
        return;
      case "skipped":
        if (p && p.id === m.id) {
          this.pending = null;
          p.resolve(null);
        }
        return;
      case "error":
        if (m.fatal) this.crash(m.message);
        else if (p && (m.id === undefined || p.id === m.id)) {
          this.pending = null;
          if (++this.fails >= 8) this.broken = true;
          p.reject(new Error(m.message));
        }
        return;
      default:
        return;
    }
  }

  /** The worker died / lost its WebGL context / never started. */
  private crash(message: string): void {
    if (this.onCrash) {
      this.onCrash(message); // still starting up: create() fails, nothing is running yet
      return;
    }
    if (this.closed || this.broken) return;
    this.broken = true;
    console.warn("MoveNet worker:", message);
    this.settle(null);
  }

  private settle(r: DetectionResult | null): void {
    const p = this.pending;
    this.pending = null;
    p?.resolve(r);
  }

  private finish(p: Pending, m: Extract<FromWorker, { type: "result" }>): void {
    this.pending = null;
    this.compiled.add(geoKey(p.geo));
    const t1 = performance.now();
    this.flip ^= 1;
    const pool = this.pools[this.flip];
    const n = decodeMultiPose(m.data, p.geo, pool, this.maxPeople);
    const t2 = performance.now();
    this.fails = 0;
    this.tensors = m.tensors;
    this.bytes = m.bytes;
    const s = this.stats;
    const k = CROWD_CFG.movenet.emaK;
    const rtt = t1 - p.t0;
    const block = p.block + (t2 - t1);
    s.people = n;
    // a picture that waited for a shader compile says nothing about the device: it must not push the ladder down (nor fill the stats)
    if (p.cold) {
      p.resolve(this.results[this.flip]);
      return;
    }
    s.ms = s.ms > 0 ? s.ms + (rtt - s.ms) * k : rtt;
    s.blockMs = s.blockMs > 0 ? s.blockMs + (block - s.blockMs) * k : block;
    s.workerMs = s.workerMs > 0 ? s.workerMs + (m.ms - s.workerMs) * k : m.ms;
    if (this.size.report(t2 / 1000, rtt)) {
      s.ms = 0;
      s.blockMs = 0;
      s.workerMs = 0;
      s.side = this.size.side;
    }
    p.resolve(this.results[this.flip]);
  }

  /**
   * Analyse the current camera picture. Resolves null when a call is still running (never queued), the video has no picture yet or the
   * detector is closed / broken. The returned object is reused: it is valid until the call after the next one (two buffers).
   */
  async detect(video: HTMLVideoElement, opts?: { lut?: Uint8Array | null }): Promise<DetectionResult | null> {
    if (this.pending || this.closed || this.broken) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const t0 = performance.now();
    const geo = inputGeo(vw, vh, this.size.side);
    let resolve!: Pending["resolve"];
    let reject!: Pending["reject"];
    const result = new Promise<DetectionResult | null>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // reserved at once: a second detect() while the picture is being grabbed must find the slot taken
    this.vw = vw;
    this.vh = vh;
    const cold = !this.compiled.has(geoKey(geo));
    const limit = cold ? CROWD_CFG.movenet.warmTimeoutMs : CROWD_CFG.movenet.watchdogMs;
    const p: Pending = { id: this.nextId++, resolve, reject, t0, geo, block: 0, limit, cold };
    this.pending = p;
    let bitmap: ImageBitmap;
    try {
      const g0 = performance.now();
      const grabbing = this.grab(video, geo.rw, geo.rh);
      p.block = performance.now() - g0;
      bitmap = await grabbing;
    } catch (e) {
      if (this.pending === p) this.pending = null;
      if (++this.fails >= 8) this.broken = true;
      throw e;
    }
    if (this.pending !== p) {
      // closed / crashed while the picture was being grabbed: settle() already answered null
      bitmap.close();
      return result;
    }
    const g1 = performance.now();
    this.syncLut(opts?.lut ?? null);
    // a camera shape not seen at start (the device was turned...): its neighbouring rungs are compiled in the same pass, or the ladder
    // could never move for this shape
    const also = cold ? this.missingNeighbours(vw, vh) : [];
    this.post({ type: "frame", id: p.id, bitmap, rw: geo.rw, rh: geo.rh, pw: geo.pw, ph: geo.ph, ...(also.length ? { also } : {}) }, [bitmap]);
    p.block += performance.now() - g1;
    return result;
  }

  /** The table lives in the worker; it is sent only when it differs from the one sent last (the runtime mutates one array in place). */
  private syncLut(lut: Uint8Array | null): void {
    if (!lut) {
      if (this.lastLut) {
        this.lastLut = null;
        this.post({ type: "lut", lut: null });
      }
      return;
    }
    if (this.lastLut && sameTable(this.lastLut, lut)) return;
    this.lastLut = lut.slice();
    this.post({ type: "lut", lut: lut.slice() });
  }

  /** debug: live tensors / bytes held by tfjs in the worker (must stay flat) */
  memory(): { tensors: number; bytes: number } {
    return { tensors: this.tensors, bytes: this.bytes };
  }

  setMaxPeople(n: number): void {
    this.maxPeople = Math.max(1, Math.min(6, Math.floor(n)));
  }

  /** Starts the silence check: a picture that gets no answer for `watchdogMs` means a stuck worker. */
  watch(): void {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      const p = this.pending;
      if (p && performance.now() - p.t0 > p.limit) this.crash("no answer from the worker");
    }, 500);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.onCrash?.("closed");
    this.settle(null);
    try {
      this.post({ type: "close" });
    } catch {
      /* worker already gone */
    }
    // the worker disposes the model / tensors and closes itself; this is only the safety net (a context that is stuck)
    setTimeout(() => this.worker.terminate(), 500);
  }
}

function sameTable(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
