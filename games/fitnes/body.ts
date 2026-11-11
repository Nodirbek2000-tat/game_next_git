// Fitnes: the player's body over the camera picture, and a steadier copy of the landmarks for the form checks.

import type { Lm } from "./form";

const VIS = 0.4;

/**
 * A steadier copy of the landmarks for counting and for the drawing: a short time-based average (fast enough for a jump, without the
 * last pixels of jitter), and a point that drops out for a moment (a hand in front of the body, a foot at the picture's edge) keeps
 * its last good position for up to HOLD seconds instead of flickering in and out, which would break a count or a hold timer.
 */
export class SteadyLandmarks {
  readonly out: Lm[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
  private readonly lost = new Float32Array(33).fill(99);
  private has = false;
  constructor(
    private readonly tau = 0.05,
    private readonly hold = 0.35,
  ) {}

  update(lm: ArrayLike<Lm>, dt: number): Lm[] {
    const k = this.has ? 1 - Math.exp(-dt / this.tau) : 1;
    const n = Math.min(33, lm.length);
    for (let i = 0; i < n; i++) {
      const p = lm[i];
      const o = this.out[i];
      if (p.v >= VIS) {
        const fresh = this.lost[i] > this.hold;
        o.x = fresh ? p.x : o.x + (p.x - o.x) * k;
        o.y = fresh ? p.y : o.y + (p.y - o.y) * k;
        o.v = p.v;
        this.lost[i] = 0;
      } else {
        this.lost[i] += dt;
        // keep the last good point a moment longer; afterwards it is honestly "not seen"
        o.v = this.lost[i] <= this.hold && o.v >= VIS ? VIS : p.v;
        if (this.lost[i] > this.hold) {
          o.x = p.x;
          o.y = p.y;
        }
      }
    }
    this.has = true;
    return this.out;
  }

  reset(): void {
    this.has = false;
    this.lost.fill(99);
  }
}

const LIMBS: [number, number][] = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 31],
  [28, 32],
];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/**
 * The body drawn clearly over the camera: a soft glow, thick rounded limbs, the torso filled, a ring for the head and a dot on
 * every joint. `col` is an "r,g,b" triple (green = right, orange = correct it). `w` = limb width in px.
 */
export function drawBody(c: CanvasRenderingContext2D, lm: ArrayLike<Lm>, col: string, w: number): void {
  const ok = (i: number): boolean => lm[i] && lm[i].v >= VIS;
  c.save();
  c.lineCap = "round";
  c.lineJoin = "round";
  // torso
  if (ok(11) && ok(12) && ok(23) && ok(24)) {
    c.fillStyle = `rgba(${col},.16)`;
    c.strokeStyle = `rgba(${col},.95)`;
    c.lineWidth = w * 0.8;
    c.beginPath();
    c.moveTo(lm[11].x, lm[11].y);
    c.lineTo(lm[12].x, lm[12].y);
    c.lineTo(lm[24].x, lm[24].y);
    c.lineTo(lm[23].x, lm[23].y);
    c.closePath();
    c.fill();
    c.stroke();
  }
  // limbs: a wide soft glow under a solid core
  const limbs = (width: number, style: string): void => {
    c.strokeStyle = style;
    c.lineWidth = width;
    c.beginPath();
    for (const [a, b] of LIMBS) {
      if (!ok(a) || !ok(b)) continue;
      c.moveTo(lm[a].x, lm[a].y);
      c.lineTo(lm[b].x, lm[b].y);
    }
    c.stroke();
  };
  limbs(w * 2.6, `rgba(${col},.22)`);
  limbs(w, `rgba(${col},.98)`);
  // head: a ring around the face, sized by the shoulders
  if (ok(0) && ok(11) && ok(12)) {
    const r = Math.max(w * 1.6, Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y) * 0.36);
    c.strokeStyle = `rgba(${col},.95)`;
    c.lineWidth = w * 0.7;
    c.beginPath();
    c.arc(lm[0].x, lm[0].y, r, 0, Math.PI * 2);
    c.stroke();
  }
  // joints
  for (const i of JOINTS) {
    if (!ok(i)) continue;
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(lm[i].x, lm[i].y, w * 0.62, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = `rgb(${col})`;
    c.beginPath();
    c.arc(lm[i].x, lm[i].y, w * 0.36, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}
