/* Harakat o'yinlari — tracking worker (classic worker, see engine/tracking/detector.ts).
 *
 * Runs MediaPipe PoseLandmarker / HandLandmarker off the main thread. It must be a *classic* worker because
 * the MediaPipe wasm loader uses importScripts(). Everything is self-hosted (/mediapipe, /models);
 * nothing is loaded from a CDN. Camera frames arrive as ImageBitmaps and never leave the device.
 *
 * Protocol (main -> worker):  {type:'init', origin, pose:'lite'|'full', hands:boolean, numPoses?:number, conf?:number, delegate?:'auto'|'GPU'|'CPU'}
 *                             {type:'delegate', to:'CPU'}   (leave the GPU delegate)
 *                             {type:'poses', n}   (how many bodies to follow; fewer = faster)
 *                             {type:'frame', id, bitmap, ts, hands:boolean}
 *                             {type:'setHands', on:boolean}  {type:'close'}
 *                             {type:'confidence', det, pres, track}   (lower thresholds when the picture is dark)
 * Protocol (worker -> main):  {type:'progress', label, pct}  {type:'ready', delegate:{pose,hand}, bench:{gpu,cpu}|null}  {type:'delegate', pose}
 *                             {type:'result', id, pose, hand, ms}  {type:'error', message}
 */
/* eslint-disable no-restricted-globals */

// MediaPipe sends a small usage log to odml.pa.googleapis.com when a task is closed. Nothing may leave the device (and a closed
// task is normal now: the loser of the delegate benchmark / the GPU delegate that was replaced), so cross-origin fetches are dropped here.
const nativeFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  try {
    const url = new URL(typeof input === "string" ? input : input.url, self.location.href);
    if (url.origin !== self.location.origin) return Promise.resolve(new Response(null, { status: 204 }));
  } catch (e) { /* relative or odd input: let the browser decide */ }
  return nativeFetch(input, init);
};
let ORIGIN = "";
let pose = null;
let hand = null;
let fileset = null;
const delegate = { pose: "GPU", hand: "GPU" };
let lastTs = 0;
let NUM_POSES = 4;
let CONF = 0.5;
let POSE_BUF = null;
let BENCH = null;
let POSE_WHICH = "lite";

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

async function fetchBuffer(url, label, base, span) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("model " + url + " " + res.status);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) {
    const b = new Uint8Array(await res.arrayBuffer());
    post({ type: "progress", label, pct: base + span });
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
    post({ type: "progress", label, pct: base + span * Math.min(1, got / total) });
  }
  return out;
}

function poseOptions(d) {
  return { baseOptions: { modelAssetBuffer: POSE_BUF, delegate: d }, runningMode: "VIDEO", numPoses: NUM_POSES, minPoseDetectionConfidence: CONF, minPosePresenceConfidence: CONF, minTrackingConfidence: CONF };
}

async function create(Cls, buffer, extra, key, prefer) {
  const mk = (d) => Cls.createFromOptions(fileset, Object.assign({ baseOptions: { modelAssetBuffer: buffer, delegate: d }, runningMode: "VIDEO" }, extra));
  const order = prefer === "CPU" ? ["CPU", "GPU"] : ["GPU", "CPU"];
  try {
    const t = await mk(order[0]);
    delegate[key] = order[0];
    return t;
  } catch (e) {
    delegate[key] = order[1];
    return mk(order[1]);
  }
}

/** A synthetic 256x144 test picture (gradient + noise + a crude figure): the models run their full path on it. */
function benchFrame() {
  const c = new OffscreenCanvas(256, 144);
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 256, 144);
  gr.addColorStop(0, "#6a7a8a");
  gr.addColorStop(1, "#c8b9a6");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 144);
  g.fillStyle = "#3b4a6b";
  g.fillRect(100, 50, 56, 90);
  g.fillStyle = "#e0b090";
  g.beginPath();
  g.arc(128, 36, 14, 0, 6.3);
  g.fill();
  return c;
}

/** Median ms of a few detectForVideo calls (the first ones also compile shaders / warm up and are ignored). */
function timeIt(landmarker, frame) {
  const times = [];
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    try { landmarker.detectForVideo(frame, benchTs += 40); } catch (e) { return Infinity; }
    if (i >= 2) times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1];
}
let benchTs = 1;

/**
 * Pose model on the faster delegate. "auto" measures the CPU delegate first (cheap, ~0.5 s): when it is fast enough for 30 detections a
 * second it is kept and the GPU is never touched (the GPU is needed to draw the game; on integrated GPUs the GPU delegate can take 100+ ms
 * per frame and stalls for seconds when the game draws). Only a slow CPU (phones, old PCs) also tries the GPU delegate (its first frames
 * compile shaders, a few seconds, once: the choice is remembered by the page) and keeps it only when it is clearly faster.
 */
async function loadPose(which, prefer) {
  POSE_WHICH = which;
  POSE_BUF = await fetchBuffer(ORIGIN + "/models/pose_landmarker_" + which + ".task", "Tana modeli", 15, 45);
  let chosen = null;
  if (prefer === "CPU" || prefer === "GPU") {
    chosen = await create(Vision.PoseLandmarker, POSE_BUF, { numPoses: NUM_POSES, minPoseDetectionConfidence: CONF, minPosePresenceConfidence: CONF, minTrackingConfidence: CONF }, "pose", prefer);
  } else {
    BENCH = { gpu: null, cpu: null };
    post({ type: "progress", label: "Tezlik sinovi", pct: 60 });
    let cpu = null;
    try {
      cpu = await Vision.PoseLandmarker.createFromOptions(fileset, poseOptions("CPU"));
      BENCH.cpu = timeIt(cpu, benchFrame());
    } catch (e) {
      BENCH.cpu = Infinity;
      try { if (cpu) cpu.close(); } catch (e2) { /* ignore */ }
      cpu = null;
    }
    if (cpu && BENCH.cpu <= 32) {
      chosen = cpu;
      delegate.pose = "CPU";
    } else {
      let gpu = null;
      try {
        gpu = await Vision.PoseLandmarker.createFromOptions(fileset, poseOptions("GPU"));
        BENCH.gpu = timeIt(gpu, benchFrame());
      } catch (e) {
        BENCH.gpu = Infinity;
        try { if (gpu) gpu.close(); } catch (e2) { /* ignore */ }
        gpu = null;
      }
      if (gpu && (!cpu || BENCH.gpu < BENCH.cpu * 0.8)) {
        chosen = gpu;
        delegate.pose = "GPU";
        try { if (cpu) cpu.close(); } catch (e) { /* ignore */ }
      } else if (cpu) {
        chosen = cpu;
        delegate.pose = "CPU";
        try { if (gpu) gpu.close(); } catch (e) { /* ignore */ }
      }
    }
    if (!chosen) throw new Error("pose model could not start");
  }
  try { if (pose) pose.close(); } catch (e) { /* ignore */ }
  pose = chosen;
}

async function loadHand() {
  if (hand) return;
  const buf = await fetchBuffer(ORIGIN + "/models/hand_landmarker.task", "Qo‘l modeli", 65, 25);
  hand = await create(Vision.HandLandmarker, buf, { numHands: 4, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }, "hand", delegate.pose);
}

function plain(res) {
  if (!res || !res.landmarks) return null;
  const strip = (arr) => arr.map((l) => l.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })));
  return { landmarks: strip(res.landmarks), worldLandmarks: res.worldLandmarks ? strip(res.worldLandmarks) : undefined };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      ORIGIN = m.origin;
      NUM_POSES = Math.max(1, Math.min(6, m.numPoses | 0 || 4));
      CONF = typeof m.conf === "number" ? m.conf : 0.5;
      importScripts(ORIGIN + "/mediapipe/vision_bundle.js");
      post({ type: "progress", label: "Dvigatel", pct: 5 });
      // eslint-disable-next-line no-undef
      fileset = await Vision.FilesetResolver.forVisionTasks(ORIGIN + "/mediapipe");
      post({ type: "progress", label: "Dvigatel", pct: 15 });
      await loadPose(m.pose, m.delegate === "GPU" || m.delegate === "CPU" ? m.delegate : "auto");
      if (m.hands) await loadHand();
      post({ type: "progress", label: "Tayyor", pct: 100 });
      post({ type: "ready", delegate, bench: BENCH });
    } else if (m.type === "delegate") {
      // the GPU delegate turned out slow (the GPU is busy drawing): continue on the CPU
      if (m.to === "CPU" && delegate.pose !== "CPU") {
        await loadPose(POSE_WHICH, "CPU");
        post({ type: "delegate", pose: delegate.pose });
      }
    } else if (m.type === "poses") {
      const n = Math.max(1, Math.min(6, m.n | 0 || 1));
      if (n !== NUM_POSES) {
        NUM_POSES = n;
        try { if (pose) await pose.setOptions({ numPoses: n }); } catch (err) { /* keep the old value */ }
      }
    } else if (m.type === "setHands") {
      if (m.on) await loadHand();
    } else if (m.type === "confidence") {
      try { if (pose) await pose.setOptions({ minPoseDetectionConfidence: m.det, minPosePresenceConfidence: m.pres, minTrackingConfidence: m.track }); } catch (err) { /* keep the old thresholds */ }
      try { if (hand) await hand.setOptions({ minHandDetectionConfidence: m.det, minHandPresenceConfidence: m.pres, minTrackingConfidence: m.track }); } catch (err) { /* keep the old thresholds */ }
    } else if (m.type === "frame") {
      const t0 = performance.now();
      const ts = Math.max(Math.round(m.ts), lastTs + 1);
      lastTs = ts;
      let p = null;
      let h = null;
      try { p = plain(pose.detectForVideo(m.bitmap, ts)); } catch (err) { /* keep going */ }
      if (m.hands && hand) { try { h = plain(hand.detectForVideo(m.bitmap, ts)); } catch (err) { /* keep going */ } }
      try { m.bitmap.close(); } catch (err) { /* ignore */ }
      post({ type: "result", id: m.id, pose: p, hand: h, ms: performance.now() - t0 });
    } else if (m.type === "close") {
      try { if (pose) pose.close(); } catch (err) { /* ignore */ }
      try { if (hand) hand.close(); } catch (err) { /* ignore */ }
      self.close();
    }
  } catch (err) {
    post({ type: "error", message: String((err && err.message) || err) });
  }
};
