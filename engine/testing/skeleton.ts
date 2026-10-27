// Synthetic MediaPipe-style skeletons for tests and for the `window.__fake` autopilot.
// `makeSkeleton` is deliberately self-contained (no imports, no closures) so that e2e tests can inject it
// into the page with `fn.toString()`.

export interface SkeletonOpts {
  /** horizontal centre in the un-mirrored camera image (0..1) */
  cx?: number;
  /** y of the top of the head (0..1) */
  top?: number;
  /** full body height as a fraction of the image height */
  h?: number;
  /** "up" = wrist above the head, "down" = by the hip; or explicit [x, y] in the normalised image */
  armL?: "up" | "down" | "shoulder" | [number, number];
  armR?: "up" | "down" | "shoulder" | [number, number];
  /** knee lift 0..1 (0 = standing) */
  kneeL?: number;
  kneeR?: number;
  /** visibility of the lower body (hips, knees, ankles) */
  legsVisible?: boolean;
}

export interface FakeLm {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export function makeSkeleton(o: SkeletonOpts = {}): FakeLm[] {
  const cx = o.cx ?? 0.5;
  const top = o.top ?? 0.12;
  const h = o.h ?? 0.8;
  const legsVisible = o.legsVisible ?? true;
  const lms: FakeLm[] = [];
  for (let i = 0; i < 33; i++) lms.push({ x: cx, y: top + h * 0.5, z: 0, visibility: 0.99 });
  const set = (i: number, x: number, y: number, vis?: number): void => {
    lms[i].x = x;
    lms[i].y = y;
    if (vis !== undefined) lms[i].visibility = vis;
  };
  const sw = h * 0.2; // shoulder width
  const shoulderY = top + h * 0.17;
  const hipY = top + h * 0.5;
  const kneeY = top + h * 0.72;
  const ankleY = top + h * 0.95;
  const legVis = legsVisible ? 0.99 : 0.05;
  set(0, cx, top + h * 0.05);
  set(7, cx + sw * 0.25, top + h * 0.05);
  set(8, cx - sw * 0.25, top + h * 0.05);
  // MediaPipe "left" is on the image-right when the person faces the camera
  set(11, cx + sw / 2, shoulderY);
  set(12, cx - sw / 2, shoulderY);
  set(23, cx + sw * 0.3, hipY, legVis);
  set(24, cx - sw * 0.3, hipY, legVis);
  const arm = (side: "L" | "R", spec: SkeletonOpts["armL"]): void => {
    const sgn = side === "L" ? 1 : -1;
    const sx = cx + (sgn * sw) / 2;
    const wi = side === "L" ? 15 : 16;
    const ei = side === "L" ? 13 : 14;
    const ii = side === "L" ? 19 : 20;
    let wx = sx + sgn * 0.02;
    let wy = hipY;
    if (spec === "up") {
      wx = sx + sgn * 0.03;
      wy = top - h * 0.1;
    } else if (spec === "shoulder") {
      wx = sx + sgn * h * 0.25;
      wy = shoulderY;
    } else if (Array.isArray(spec)) {
      wx = spec[0];
      wy = spec[1];
    }
    set(wi, wx, wy);
    set(ei, (sx + wx) / 2 + sgn * 0.01, (shoulderY + wy) / 2);
    set(ii, wx, wy - 0.015);
  };
  arm("L", o.armL ?? "down");
  arm("R", o.armR ?? "down");
  const lift = (k: number | undefined): number => (k ?? 0) * h * 0.2;
  set(25, cx + sw * 0.3, kneeY - lift(o.kneeL), legVis);
  set(26, cx - sw * 0.3, kneeY - lift(o.kneeR), legVis);
  set(27, cx + sw * 0.3, ankleY - lift(o.kneeL) * 0.5, legVis);
  set(28, cx - sw * 0.3, ankleY - lift(o.kneeR) * 0.5, legVis);
  set(31, cx + sw * 0.4, ankleY + 0.01, legVis);
  set(32, cx - sw * 0.4, ankleY + 0.01, legVis);
  return lms;
}

/** Build a 160x90 RGBA frame where each person's torso region has the given colour. */
export function makeSmallFrame(people: { cx: number; top: number; h: number; rgb: [number, number, number] }[]): Uint8ClampedArray {
  const W = 160;
  const H = 90;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 60;
    data[i + 1] = 60;
    data[i + 2] = 60;
    data[i + 3] = 255;
  }
  for (const p of people) {
    const sw = p.h * 0.2;
    const x0 = Math.floor((p.cx - sw / 2 - 0.02) * W);
    const x1 = Math.ceil((p.cx + sw / 2 + 0.02) * W);
    const y0 = Math.floor((p.top + p.h * 0.15) * H);
    const y1 = Math.ceil((p.top + p.h * 0.52) * H);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = (y * W + x) * 4;
        data[k] = p.rgb[0];
        data[k + 1] = p.rgb[1];
        data[k + 2] = p.rgb[2];
      }
    }
  }
  return data;
}
