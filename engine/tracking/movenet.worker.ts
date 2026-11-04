import "./workerFrameClock"; // must stay the first import (see the file)
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import * as conv from "@tensorflow/tfjs-converter";
import type { FromWorker, ToWorker } from "./moveNetProtocol";
import { MoveNetService } from "./moveNetService";

// Module worker: MoveNet MultiPose on TensorFlow.js / WebGL (OffscreenCanvas), off the main thread. Bundled by Next / Turbopack from
// `new Worker(new URL("./movenet.worker.ts", import.meta.url))` (see moveNetWorker.ts), so tfjs never lands in the page's own bundle.
// All the logic is in moveNetService.ts; this file only connects it to the message port. No DOM here.
// (Typed by hand instead of the "webworker" lib: that lib conflicts with the "dom" lib the rest of the project is checked with.)

interface WorkerScope {
  onmessage: ((e: { data: ToWorker }) => void) | null;
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  close(): void;
}
const scope = self as unknown as WorkerScope;

function canWebgl(): boolean {
  try {
    if (typeof OffscreenCanvas === "undefined") return false;
    const c = new OffscreenCanvas(1, 1);
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext(); // the probe must not use up one of the page's few WebGL contexts
    return !!gl;
  } catch {
    return false;
  }
}

const service = new MoveNetService({
  tf,
  conv,
  post: (msg, transfer) => scope.postMessage(msg, transfer ?? []),
  canWebgl,
  onClosed: () => scope.close(),
});

scope.onmessage = (e) => {
  service.handle(e.data).catch((err: unknown) => {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err), fatal: false });
  });
};
