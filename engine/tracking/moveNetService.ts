import type { GraphModel } from "@tensorflow/tfjs-converter";
import type { Tensor, Tensor3D } from "@tensorflow/tfjs-core";
import { geoKey, WARM_PCT, type FromWorker, type ToWorker } from "./moveNetProtocol";

// The part of MoveNet that runs inside the worker (tracking/movenet.worker.ts is only the glue: it imports TensorFlow.js and wires the
// message port). tfjs and the clock are injected so the whole protocol is testable without a GPU or a real Worker.

export type Core = typeof import("@tensorflow/tfjs-core");
export type Converter = typeof import("@tensorflow/tfjs-converter");

export interface PadGeo {
  rw: number;
  rh: number;
  pw: number;
  ph: number;
}

/**
 * Camera picture tensor (int32 [h, w, 3], 0..255) -> the model input [1, ph, pw, 3] int32: optionally brightened with the table
 * `lutT` (int32 [256]), padded (bottom / right, black) up to multiples of 32. Only GPU ops, no read-back. Call inside tf.tidy.
 */
export function modelInput(tf: Core, px: Tensor3D, g: PadGeo, lutT: Tensor | null): Tensor {
  let x: Tensor = px;
  if (lutT) x = tf.gather(lutT, tf.cast(x, "int32"));
  if (g.pw > g.rw || g.ph > g.rh) x = tf.pad(x as Tensor3D, [[0, g.ph - g.rh], [0, g.pw - g.rw], [0, 0]]);
  return tf.expandDims(x, 0);
}

export interface ServiceDeps {
  tf: Core;
  conv: Converter;
  /** posts to the page; `transfer` = buffers to move instead of copy */
  post: (msg: FromWorker, transfer?: Transferable[]) => void;
  /** can this context make a WebGL context in a worker (OffscreenCanvas)? */
  canWebgl: () => boolean;
  now?: () => number;
  /** called when the service is closed (the worker closes itself) */
  onClosed?: () => void;
}

type Backend = {
  gpgpu?: { gl?: { canvas?: { addEventListener?: (t: string, f: () => void) => void } } };
  checkCompileCompletionAsync?: () => Promise<boolean[]>;
  getUniformLocations?: () => void;
};

/** The state machine of the worker: init -> ready -> frames -> close. Frames are handled one at a time. */
export class MoveNetService {
  private model: GraphModel | null = null;
  private lutT: Tensor | null = null;
  private ready = false;
  /** picture geometries whose shaders are compiled (a new size = new programs) */
  private readonly compiled = new Set<string>();
  private busy = false;
  private closed = false;
  private readonly now: () => number;

  constructor(private readonly d: ServiceDeps) {
    this.now = d.now ?? (() => performance.now());
  }

  async handle(msg: ToWorker): Promise<void> {
    switch (msg.type) {
      case "init":
        return this.init(msg.modelUrl, msg.geos);
      case "frame":
        return this.frame(msg);
      case "lut":
        this.setLut(msg.lut);
        return;
      case "close":
        this.close();
        return;
    }
  }

  private async init(modelUrl: string, geos: PadGeo[]): Promise<void> {
    const { tf, conv, post } = this.d;
    try {
      if (!this.d.canWebgl()) {
        post({ type: "unsupported", reason: "nowebgl" });
        return;
      }
      post({ type: "progress", pct: 5, label: "MoveNet dvigateli" });
      if (!(await tf.setBackend("webgl"))) {
        post({ type: "unsupported", reason: "backend" });
        return;
      }
      await tf.ready();
      // NOT WEBGL_CPU_FORWARD=false: with the default (true) the tiny shape tensors of the graph stay on the CPU; false sends them to the
      // GPU and reads them back one by one (measured: ~40 sync read-backs per call)
      tf.env().set("TOPK_LAST_DIM_CPU_HANDOFF_SIZE_THRESHOLD", 0);
      post({ type: "progress", pct: 10, label: "MoveNet modeli" });
      // onProgress fires only when a whole weight file has arrived; on a slow connection that is minutes of silence, which the page
      // takes for a hang. Every chunk of bytes is a sign of life too (same percent, so only the page's wait restarts).
      let pct = 10;
      let lastBeat = 0;
      const beat = (): void => {
        const t = this.now();
        if (t - lastBeat < 250) return;
        lastBeat = t;
        post({ type: "progress", pct, label: "MoveNet modeli" });
      };
      const model = await conv.loadGraphModel(modelUrl, {
        onProgress: (f: number) => {
          pct = 10 + f * 75;
          post({ type: "progress", pct, label: "MoveNet modeli" });
        },
        fetchFunc: (url: RequestInfo | URL, init?: RequestInit) => heartbeatFetch(fetch, url, init, beat),
      });
      if (this.closed) {
        model.dispose();
        return;
      }
      this.model = model;
      post({ type: "progress", pct: WARM_PCT, label: "MoveNet tayyorlanmoqda" });
      await this.warm(geos);
      this.watchContext();
      this.ready = true;
      post({ type: "ready", backend: tf.getBackend() });
    } catch (e) {
      post({ type: "error", message: errText(e), fatal: true });
    }
  }

  /**
   * Compiles the shaders of these picture geometries now, not during the game: all of them in ONE pass of tfjs's compile-only mode (the
   * GPU driver compiles in parallel: ~100 programs one after the other took 15 s on an Intel UHD, in parallel ~2.5 s). Only a pass that
   * really finished is announced ("compiled"): the page steps to a size only after that. A failure is not fatal: the first real run of
   * that size compiles whatever is missing (slowly), and the page gives that picture the long wait.
   */
  private async compile(geos: readonly PadGeo[]): Promise<void> {
    const todo = geos.filter((g, i) => !this.compiled.has(geoKey(g)) && geos.findIndex((h) => geoKey(h) === geoKey(g)) === i);
    if (!todo.length || !(await this.doCompile(todo))) return;
    for (const g of todo) {
      const key = geoKey(g);
      this.compiled.add(key);
      if (!this.closed) this.d.post({ type: "compiled", key });
    }
  }

  private async doCompile(geos: readonly PadGeo[]): Promise<boolean> {
    const { tf } = this.d;
    const b = tf.backend() as unknown as Backend;
    if (!b.checkCompileCompletionAsync || !b.getUniformLocations) return false;
    try {
      tf.env().set("ENGINE_COMPILE_ONLY", true);
      try {
        for (const g of geos) this.blank(g).dispose();
      } finally {
        tf.env().set("ENGINE_COMPILE_ONLY", false);
      }
      await b.checkCompileCompletionAsync();
      b.getUniformLocations();
      return true;
    } catch {
      return false;
    }
  }

  /** The model on a blank picture of this geometry (the output is the caller's to dispose). */
  private blank(g: PadGeo): Tensor {
    const { tf } = this.d;
    return tf.tidy(() => this.model!.execute(modelInput(tf, tf.zeros([g.rh, g.rw, 3], "int32") as Tensor3D, g, null)) as Tensor);
  }

  /** Compile every size of the session, then one real run on a blank picture of the starting size (the first one). */
  private async warm(geos: readonly PadGeo[]): Promise<void> {
    if (!geos.length) throw new Error("MoveNet: no picture size to start with");
    await this.compile(geos);
    const g = geos[0];
    const out = this.blank(g);
    try {
      await out.data();
    } finally {
      out.dispose();
    }
    // the real run compiled whatever the compile-only pass missed: the starting size is ready either way
    const key = geoKey(g);
    if (!this.compiled.has(key)) {
      this.compiled.add(key);
      this.d.post({ type: "compiled", key });
    }
  }

  /** A lost WebGL context cannot be recovered here: tell the page, it goes back to MediaPipe. */
  private watchContext(): void {
    try {
      const b = this.d.tf.backend() as unknown as Backend;
      b.gpgpu?.gl?.canvas?.addEventListener?.("webglcontextlost", () => this.d.post({ type: "error", message: "webglcontextlost", fatal: true }));
    } catch {
      /* the page's watchdog and failure count cover it */
    }
  }

  private setLut(lut: Uint8Array | null): void {
    const { tf } = this.d;
    this.lutT?.dispose();
    this.lutT = null;
    if (lut && lut.length === 256) this.lutT = tf.tensor1d(Int32Array.from(lut), "int32");
  }

  private async frame(m: Extract<ToWorker, { type: "frame" }>): Promise<void> {
    const { tf, post } = this.d;
    const bitmap = m.bitmap;
    if (!this.ready || this.busy || this.closed || !this.model) {
      bitmap.close();
      post({ type: "skipped", id: m.id });
      return;
    }
    this.busy = true;
    let out: Tensor | null = null;
    try {
      const t0 = this.now();
      // the picture size changed (adaptive size): compile for it in parallel first instead of ~100 programs one by one in the first call
      await this.compile([m, ...(m.also ?? [])]);
      if (this.closed || !this.model) {
        bitmap.close();
        post({ type: "skipped", id: m.id });
        return;
      }
      out = tf.tidy(() => this.model!.execute(modelInput(tf, tf.browser.fromPixels(bitmap), m, this.lutT)) as Tensor);
      bitmap.close(); // uploaded to the GPU by fromPixels
      const raw = (await out.data()) as Float32Array;
      // ran once: its programs exist now, even when the compile-only pass could not be used (no second attempt per picture)
      this.compiled.add(geoKey(m));
      const data = raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength ? raw : raw.slice();
      const mem = tf.memory();
      post({ type: "result", id: m.id, data, ms: this.now() - t0, tensors: mem.numTensors, bytes: mem.numBytes }, [data.buffer as ArrayBuffer]);
    } catch (e) {
      post({ type: "error", id: m.id, message: errText(e), fatal: false });
    } finally {
      out?.dispose();
      try {
        bitmap.close();
      } catch {
        /* already closed */
      }
      this.busy = false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.lutT?.dispose();
    this.lutT = null;
    try {
      this.model?.dispose();
    } catch {
      /* already gone */
    }
    this.model = null;
    this.d.onClosed?.();
  }
}

/** fetch whose response body reports every chunk that arrives (`beat`), so a slow download shows signs of life */
export async function heartbeatFetch(f: typeof fetch, url: RequestInfo | URL, init: RequestInit | undefined, beat: () => void): Promise<Response> {
  const res = await f(url, init);
  if (!res.body) return res;
  const reader = res.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const r = await reader.read();
      if (r.done) ctl.close();
      else {
        beat();
        ctl.enqueue(r.value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
