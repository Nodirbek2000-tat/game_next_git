import type { GraphModel } from "@tensorflow/tfjs-converter";
import type { Tensor, Tensor3D } from "@tensorflow/tfjs-core";
import type { DetectionResult } from "../types";
import { CROWD_CFG } from "./crowdConfig";
import { decodeMultiPose, inputGeo, PosePool, SizeController, type InputGeo } from "./moveNetCore";
import type { MoveNetCreateOptions, MoveNetStats, PoseDetectorLike } from "./moveNetProtocol";
import { modelInput, type Core } from "./moveNetService";

// MoveNet MultiPose Lightning (TensorFlow.js) on the MAIN thread, WebGL back-end. A DEBUG / last-resort path: ?pose=movenet-main (see
// poseBackend.ts). The normal MoveNet path is the worker (tracking/moveNetWorker.ts); this one blocks the page ~17-25 ms per call on an
// Intel UHD (tfjs reads small GPU tensors back synchronously inside the graph), so the runtime gives it a main-thread scheduler (calls
// spaced by >= 2.2 x their own duration) and it never becomes the default.
//
// Compared with the first version: no CPU canvas (the video goes straight to a GPU texture with fromPixels and is scaled there),
// and tfjs keeps its default WEBGL_CPU_FORWARD (false would move the tiny shape tensors to the GPU and read them back one by one).
//
// tfjs is loaded with dynamic import() only when this detector starts: nobody else downloads it. The model is self-hosted
// (public/models/movenet-multipose, the official Google tfjs-format files).

export type { MoveNetStats } from "./moveNetProtocol";

export class MoveNetDetector implements PoseDetectorLike {
  readonly kind = "MoveNet";
  readonly where = "main";
  readonly backend: string;
  maxPeople: number;
  /** too many failures in a row (lost WebGL context...): the runtime goes back to MediaPipe */
  broken = false;
  readonly stats: MoveNetStats = { side: 0, ms: 0, blockMs: 0, workerMs: 0, people: 0 };
  private busy = false;
  private closed = false;
  private fails = 0;
  private readonly size: SizeController;
  private readonly geo: InputGeo = { rw: 0, rh: 0, pw: 0, ph: 0 };
  private readonly pools = [new PosePool(), new PosePool()];
  private flip = 0;
  private readonly results: DetectionResult[];
  private lutT: Tensor | null = null;
  private lastLut: Uint8Array | null = null;

  private constructor(
    private core: Core,
    private model: GraphModel,
    o: MoveNetCreateOptions,
  ) {
    this.maxPeople = o.maxPeople;
    this.backend = core.getBackend();
    this.size = typeof o.side === "number" && o.side > 0 ? SizeController.fixedAt(o.side) : new SizeController();
    this.results = this.pools.map((p) => ({ pose: { landmarks: p.view }, hand: null }));
    this.stats.side = this.size.side;
  }

  /** Loads tfjs + the model and compiles the shaders (a blank picture). Throws when WebGL / the model is not available: the caller falls back to MediaPipe. */
  static async create(o: MoveNetCreateOptions): Promise<MoveNetDetector> {
    o.onProgress?.(2, "MoveNet dvigateli");
    const core = await import("@tensorflow/tfjs-core");
    await import("@tensorflow/tfjs-backend-webgl");
    const conv = await import("@tensorflow/tfjs-converter");
    if (!(await core.setBackend("webgl"))) throw new Error("tfjs: WebGL back-end unavailable");
    await core.ready();
    // the model's TopK (≈ 1-6k values) is handed to the CPU below 100k by default: a sync GPU read-back
    core.env().set("TOPK_LAST_DIM_CPU_HANDOFF_SIZE_THRESHOLD", 0);
    o.onProgress?.(10, "MoveNet modeli");
    const model = await conv.loadGraphModel(CROWD_CFG.movenet.modelUrl, { onProgress: (f) => o.onProgress?.(10 + f * 80, "MoveNet modeli") });
    let det: MoveNetDetector;
    try {
      det = new MoveNetDetector(core, model, o);
      o.onProgress?.(92, "MoveNet tayyorlanmoqda");
      await det.warm();
    } catch (e) {
      model.dispose();
      throw e;
    }
    o.onProgress?.(100, "Tayyor");
    return det;
  }

  /** Runs the model once on a blank picture of the starting size: compiles the shaders now, not during the game. */
  private async warm(): Promise<void> {
    const g = inputGeo(1280, 720, this.size.side, this.geo);
    const core = this.core;
    const out = core.tidy(() => this.model.execute(modelInput(core, core.zeros([g.rh, g.rw, 3], "int32") as Tensor3D, g, null)) as Tensor);
    try {
      await out.data();
    } finally {
      out.dispose();
    }
  }

  /** Queues the model on the current video frame. Every tensor made here is disposed by tidy, except the returned output. */
  private run(video: HTMLVideoElement, g: InputGeo): Tensor {
    const core = this.core;
    return core.tidy(() => {
      let px = core.browser.fromPixels(video) as Tensor3D; // int32 [h, w, 3], 0..255, straight to a GPU texture
      if (px.shape[1] !== g.rw || px.shape[0] !== g.rh) px = core.cast(core.round(core.image.resizeBilinear(px, [g.rh, g.rw])), "int32") as Tensor3D;
      return this.model.execute(modelInput(core, px, g, this.lutT)) as Tensor; // [1, 6, 56]
    });
  }

  /** debug: live tensors / bytes held by tfjs (must stay flat) */
  memory(): { tensors: number; bytes: number } {
    const m = this.core.memory();
    return { tensors: m.numTensors, bytes: m.numBytes };
  }

  setMaxPeople(n: number): void {
    this.maxPeople = Math.max(1, Math.min(6, Math.floor(n)));
  }

  /** The brightening table is a tensor on the GPU; rebuilt only when it changes (the runtime mutates one array in place). */
  private syncLut(lut: Uint8Array | null): void {
    if (!lut) {
      this.lutT?.dispose();
      this.lutT = null;
      this.lastLut = null;
      return;
    }
    if (this.lutT && this.lastLut && this.lastLut.every((v, i) => v === lut[i])) return;
    this.lutT?.dispose();
    this.lastLut = lut.slice();
    this.lutT = this.core.tensor1d(Int32Array.from(lut), "int32");
  }

  /**
   * Analyse the current camera picture. Resolves null when a call is still running (never queued) or the video has no picture yet.
   * The returned object is reused: it is valid until the call after the next one (two buffers).
   */
  async detect(video: HTMLVideoElement, opts?: { lut?: Uint8Array | null }): Promise<DetectionResult | null> {
    if (this.busy || this.closed || this.broken) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    this.busy = true;
    try {
      const t0 = performance.now();
      const g = inputGeo(vw, vh, this.size.side, this.geo);
      this.syncLut(opts?.lut ?? null);
      const out = this.run(video, g);
      const t1 = performance.now();
      let data: Float32Array;
      try {
        data = (await out.data()) as Float32Array;
      } finally {
        out.dispose();
      }
      if (this.closed) return null;
      this.flip ^= 1;
      const pool = this.pools[this.flip];
      const n = decodeMultiPose(data, g, pool, this.maxPeople);
      const t2 = performance.now();
      this.fails = 0;
      this.note(t0, t1, t2, n);
      return this.results[this.flip];
    } catch (e) {
      if (++this.fails >= 8) this.broken = true;
      throw e;
    } finally {
      this.busy = false;
    }
  }

  private note(t0: number, t1: number, t2: number, people: number): void {
    const s = this.stats;
    const k = CROWD_CFG.movenet.emaK;
    s.ms = s.ms > 0 ? s.ms + (t2 - t0 - s.ms) * k : t2 - t0;
    s.blockMs = s.blockMs > 0 ? s.blockMs + (t1 - t0 - s.blockMs) * k : t1 - t0;
    s.people = people;
    if (this.size.report(t2 / 1000, t2 - t0)) {
      s.ms = 0;
      s.blockMs = 0;
      s.side = this.size.side;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lutT?.dispose();
    this.lutT = null;
    try {
      this.model.dispose();
    } catch {
      /* already gone */
    }
  }
}
