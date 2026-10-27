/* Harakat o'yinlari — tracking worker (classic worker, see engine/tracking/detector.ts).
 *
 * Runs MediaPipe PoseLandmarker / HandLandmarker off the main thread. It must be a *classic* worker because
 * the MediaPipe wasm loader uses importScripts(). Everything is self-hosted (/mediapipe, /models);
 * nothing is loaded from a CDN. Camera frames arrive as ImageBitmaps and never leave the device.
 *
 * Protocol (main -> worker):  {type:'init', origin, pose:'lite'|'full', hands:boolean}
 *                             {type:'frame', id, bitmap, ts, hands:boolean}
 *                             {type:'setHands', on:boolean}  {type:'close'}
 *                             {type:'confidence', det, pres, track}   (lower thresholds when the picture is dark)
 * Protocol (worker -> main):  {type:'progress', label, pct}  {type:'ready', delegate:{pose,hand}}
 *                             {type:'result', id, pose, hand, ms}  {type:'error', message}
 */
/* eslint-disable no-restricted-globals */
let ORIGIN = "";
let pose = null;
let hand = null;
let fileset = null;
const delegate = { pose: "GPU", hand: "GPU" };
let lastTs = 0;

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

async function create(Cls, buffer, extra, key) {
  const mk = (d) => Cls.createFromOptions(fileset, Object.assign({ baseOptions: { modelAssetBuffer: buffer, delegate: d }, runningMode: "VIDEO" }, extra));
  try {
    const t = await mk("GPU");
    delegate[key] = "GPU";
    return t;
  } catch (e) {
    delegate[key] = "CPU";
    return mk("CPU");
  }
}

async function loadPose(which) {
  const buf = await fetchBuffer(ORIGIN + "/models/pose_landmarker_" + which + ".task", "Tana modeli", 15, 45);
  const p = await create(Vision.PoseLandmarker, buf, { numPoses: 4, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 }, "pose");
  try { if (pose) pose.close(); } catch (e) { /* ignore */ }
  pose = p;
}

async function loadHand() {
  if (hand) return;
  const buf = await fetchBuffer(ORIGIN + "/models/hand_landmarker.task", "Qo‘l modeli", 65, 25);
  hand = await create(Vision.HandLandmarker, buf, { numHands: 6, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }, "hand");
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
      importScripts(ORIGIN + "/mediapipe/vision_bundle.js");
      post({ type: "progress", label: "Dvigatel", pct: 5 });
      // eslint-disable-next-line no-undef
      fileset = await Vision.FilesetResolver.forVisionTasks(ORIGIN + "/mediapipe");
      post({ type: "progress", label: "Dvigatel", pct: 15 });
      await loadPose(m.pose);
      if (m.hands) await loadHand();
      post({ type: "progress", label: "Tayyor", pct: 100 });
      post({ type: "ready", delegate });
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
