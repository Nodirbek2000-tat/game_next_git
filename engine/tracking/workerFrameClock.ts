// Imported FIRST by movenet.worker.ts, before TensorFlow.js: tfjs picks its "next frame" function (requestAnimationFrame) once, when
// tfjs-core loads, and polls the parallel shader compile with it. In a worker, requestAnimationFrame follows the page's rendering, so
// while the tab is hidden the compile would never finish (the start-up times out and the game falls back to MediaPipe). A timer
// keeps running in a hidden tab (throttled, but running).

const scope = self as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number };
scope.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;

export {};
