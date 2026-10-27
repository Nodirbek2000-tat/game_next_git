import { clamp, dist, lerp } from "../math";
import type { Fit, Lm, NormLm, Person, PoseResultLike } from "../types";

export const SMALL_W = 160;
export const SMALL_H = 90;
export const HIST_BINS = 19;

/** "cover" fit of the camera image over the stage. */
export function computeFit(W: number, H: number, camW: number, camH: number): Fit {
  const s = Math.max(W / camW, H / camH);
  const dw = camW * s;
  const dh = camH * s;
  return { ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh, W, H };
}

/** Normalised camera landmark -> mirrored stage pixels. */
export function toStage(p: NormLm, fit: Fit, out: Lm): Lm {
  out.x = fit.W - (fit.ox + p.x * fit.dw);
  out.y = fit.oy + p.y * fit.dh;
  out.v = p.visibility ?? 1;
  return out;
}

export function mapLandmarks(norm: NormLm[], fit: Fit): Lm[] {
  return norm.map((p) => toStage(p, fit, { x: 0, y: 0, v: 1 }));
}

export function buildPeople(res: PoseResultLike | null | undefined, fit: Fit): Person[] {
  const out: Person[] = [];
  if (!res || !res.landmarks) return out;
  res.landmarks.forEach((norm, idx) => {
    if (norm.length < 33) return;
    const lm = mapLandmarks(norm, fit);
    const ls = lm[11];
    const rs = lm[12];
    const sw = dist(ls, rs);
    const hipsOk = lm[23].v > 0.4 && lm[24].v > 0.4;
    const cx = (ls.x + rs.x) / 2;
    const cy = (ls.y + rs.y) / 2;
    const torso = hipsOk ? Math.hypot(cx - (lm[23].x + lm[24].x) / 2, cy - (lm[23].y + lm[24].y) / 2) : 0;
    const scale = Math.max(30, sw, torso * 0.62, dist(lm[7], lm[8]) * 1.7);
    out.push({ idx, norm, lm, world: res.worldLandmarks?.[idx] ?? null, center: { x: cx, y: cy }, scale, hist: null });
  });
  return out;
}

/** A 160x90 RGBA snapshot of the (un-mirrored) camera frame. */
export interface SmallFrame {
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * Clothing colour histogram sampled on the torso (6x6 grid between shoulders and hips).
 * 19 bins: 16 hue/brightness bins + 3 grey levels. Ported from the prototype.
 */
export function colorHist(norm: NormLm[], small: SmallFrame | null): Float32Array | null {
  if (!small) return null;
  const data = small.data;
  const vis = (i: number): boolean => !!norm[i] && (norm[i].visibility ?? 1) > 0.45;
  if (!vis(11) || !vis(12)) return null;
  const px = (i: number) => ({ x: norm[i].x * SMALL_W, y: norm[i].y * SMALL_H });
  const LS = px(11);
  const RS = px(12);
  const sw = Math.hypot(LS.x - RS.x, LS.y - RS.y);
  const LH = vis(23) ? px(23) : { x: LS.x, y: LS.y + sw * 1.2 };
  const RH = vis(24) ? px(24) : { x: RS.x, y: RS.y + sw * 1.2 };
  const h = new Float32Array(HIST_BINS);
  let n = 0;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const u = 0.15 + i * 0.14;
      const w = 0.12 + j * 0.13;
      const tx = lerp(LS.x, RS.x, u);
      const ty = lerp(LS.y, RS.y, u);
      const bx = lerp(LH.x, RH.x, u);
      const by = lerp(LH.y, RH.y, u);
      const x = Math.round(lerp(tx, bx, w));
      const y = Math.round(lerp(ty, by, w));
      if (x < 0 || y < 0 || x >= SMALL_W || y >= SMALL_H) continue;
      const k = (y * SMALL_W + x) * 4;
      const r = data[k] / 255;
      const g = data[k + 1] / 255;
      const b = data[k + 2] / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const d = mx - mn;
      const s = mx ? d / mx : 0;
      let bin: number;
      if (s < 0.25 || mx < 0.18) bin = 16 + (mx < 0.33 ? 0 : mx < 0.66 ? 1 : 2);
      else {
        let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hh = (hh * 60 + 360) % 360;
        bin = Math.floor(hh / 45) * 2 + (mx < 0.55 ? 0 : 1);
      }
      h[bin] += 1;
      n++;
    }
  }
  if (n < 8) return null;
  for (let i = 0; i < HIST_BINS; i++) h[i] = (h[i] + 0.05) / (n + 0.95);
  return h;
}

/** Bhattacharyya similarity of two histograms (1 = identical, 0.5 when unknown). */
export function histSim(a: Float32Array | null, b: Float32Array | null): number {
  if (!a || !b) return 0.5;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i]);
  return s;
}

/** Mean luminance (0..1) of a small frame. */
export function meanLuma(small: SmallFrame | null): number | null {
  if (!small) return null;
  const d = small.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    n++;
  }
  return n ? clamp(sum / n, 0, 1) : null;
}

export const HAND_CONN: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
export const POSE_CONN: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [15, 19], [16, 20], [27, 31], [28, 32],
];
