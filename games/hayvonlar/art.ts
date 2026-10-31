// The six cartoon animals that DO the moves (no stick figure): round friendly shapes drawn with canvas paths, with the
// moving parts (ears, wings, arms, flippers, legs, head) drawn live from the pooled `Motion`, and the static parts (body,
// head with the face) painted ONCE into small cached canvases. No gradients, no shadows, nothing allocated per frame.
//
// Local space of every animal: x centred, y = 0 on the ground and about -2 at the top (so 1 unit = half the height). The
// painter scales it to the stage. All animals look at the viewer except the turtle (side view, looks to +x).

import type { AnimalId } from "./animals";
import type { Motion } from "./motion";

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
const HALF = Math.PI / 2;
const OUT = "#3a2a6b";
const LW = 0.05;

/** Colour of the name banner / ring of each animal. */
export const ACCENT: Record<AnimalId, string> = {
  quyon: "#e0488f",
  qush: "#1f86d6",
  baqa: "#2a9d3f",
  ayiq: "#9a5a2a",
  pingvin: "#3b4a8c",
  toshbaqa: "#1f8a55",
};

// ------------------------------------------------------------------ drawing helpers (local units)
function oval(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rot = 0, line = true): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
  c.fillStyle = fill;
  c.fill();
  if (line) {
    c.lineWidth = LW;
    c.strokeStyle = OUT;
    c.stroke();
  }
}

function disc(c: Ctx, x: number, y: number, r: number, fill: string, line = true): void {
  oval(c, x, y, r, r, fill, 0, line);
}

/** a rounded limb starting at (x, y) pointing in direction `ang` */
function limb(c: Ctx, x: number, y: number, ang: number, len: number, wid: number, fill: string, line = true): void {
  oval(c, x + (Math.cos(ang) * len) / 2, y + (Math.sin(ang) * len) / 2, len / 2, wid / 2, fill, ang, line);
}

function eye(c: Ctx, x: number, y: number, r: number): void {
  disc(c, x, y, r, "#ffffff");
  disc(c, x + r * 0.12, y + r * 0.1, r * 0.58, "#2b1d4a", false);
  disc(c, x - r * 0.08, y - r * 0.2, r * 0.22, "#ffffff", false);
}

function smile(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0.15 * Math.PI, 0.85 * Math.PI);
  c.lineWidth = 0.04;
  c.lineCap = "round";
  c.strokeStyle = OUT;
  c.stroke();
}

// ------------------------------------------------------------------ cached static layers
/** A static picture in local units (box = x0, y0, w, h). Cached on an offscreen canvas; drawn directly when there is none. */
export class Layer {
  private cv: HTMLCanvasElement | null = null;
  private q = 0;
  private failed = false;
  /** canvases built so far (tests / debug) */
  builds = 0;

  constructor(
    private x0: number,
    private y0: number,
    private w: number,
    private h: number,
    private paint: (c: Ctx) => void,
    private enabled: boolean,
  ) {}

  /** `px` = pixels per local unit on the stage (the cache is rebuilt only when it changes by a bucket of 32) */
  draw(c: Ctx, px: number): void {
    if (this.enabled && !this.failed && typeof document !== "undefined") {
      const q = Math.min(480, Math.max(48, Math.ceil(px / 32) * 32));
      if (!this.cv || this.q !== q) this.build(q);
      if (this.cv) {
        c.drawImage(this.cv, this.x0, this.y0, this.w, this.h);
        return;
      }
    }
    this.paint(c);
  }

  private build(q: number): void {
    const cv = this.cv ?? document.createElement("canvas");
    cv.width = Math.ceil(this.w * q);
    cv.height = Math.ceil(this.h * q);
    const g = cv.getContext("2d");
    if (!g) {
      this.failed = true;
      this.cv = null;
      return;
    }
    g.lineJoin = "round";
    g.lineCap = "round";
    g.scale(cv.width / this.w, cv.height / this.h);
    g.translate(-this.x0, -this.y0);
    this.paint(g);
    this.cv = cv;
    this.q = q;
    this.builds++;
  }
}

interface Layers {
  body: Layer;
  head: Layer;
}

/** draws a head layer centred on (x, y), tilted by `rot` */
function headAt(c: Ctx, l: Layer, px: number, x: number, y: number, rot: number): void {
  c.save();
  c.translate(x, y);
  if (rot !== 0) c.rotate(rot);
  l.draw(c, px);
  c.restore();
}

// ------------------------------------------------------------------ quyon (rabbit): jumps, ears bounce
const FUR = "#f6f1ff";
const PINK = "#ff9ec2";

function quyonBody(c: Ctx): void {
  oval(c, 0, -0.6, 0.5, 0.52, FUR);
  oval(c, 0, -0.52, 0.3, 0.36, "#ffffff", 0, false);
  oval(c, -0.28, -0.1, 0.28, 0.11, FUR);
  oval(c, 0.28, -0.1, 0.28, 0.11, FUR);
  oval(c, -0.28, -0.1, 0.13, 0.05, PINK, 0, false);
  oval(c, 0.28, -0.1, 0.13, 0.05, PINK, 0, false);
}

function quyonHead(c: Ctx): void {
  oval(c, 0, 0, 0.48, 0.42, FUR);
  oval(c, -0.29, 0.1, 0.1, 0.07, PINK, 0, false);
  oval(c, 0.29, 0.1, 0.1, 0.07, PINK, 0, false);
  eye(c, -0.17, -0.06, 0.1);
  eye(c, 0.17, -0.06, 0.1);
  oval(c, 0, 0.07, 0.06, 0.045, "#ff6b9a");
  smile(c, -0.05, 0.1, 0.06);
  smile(c, 0.05, 0.1, 0.06);
}

function drawQuyon(c: Ctx, L: Layers, m: Motion, t: number, px: number): void {
  const e = 0.1 + m.ear + 0.05 * Math.sin(t * 3);
  for (let s = -1; s <= 1; s += 2) {
    const ang = -HALF + s * e;
    limb(c, s * 0.16, -1.5, ang, 0.58, 0.28, FUR);
    limb(c, s * 0.16 + Math.cos(ang) * 0.08, -1.5 + Math.sin(ang) * 0.08, ang, 0.4, 0.14, PINK, false);
  }
  L.body.draw(c, px);
  const a = 0.25 + 1.1 * m.lift;
  for (let s = -1; s <= 1; s += 2) limb(c, s * 0.4, -0.82, HALF - s * a, 0.36, 0.18, FUR);
  headAt(c, L.head, px, 0, -1.22, m.ear * 0.12);
}

// ------------------------------------------------------------------ qush (bird): flaps its wings
const BLUE = "#4cc3ff";
const BLUE_DARK = "#2b8fe0";
const ORANGE = "#ff9f1c";

function qushBody(c: Ctx): void {
  oval(c, 0, -0.72, 0.62, 0.58, BLUE);
  oval(c, 0, -0.6, 0.4, 0.4, "#e8fbff", 0, false);
  oval(c, -0.22, -0.07, 0.17, 0.07, ORANGE);
  oval(c, 0.22, -0.07, 0.17, 0.07, ORANGE);
}

function qushHead(c: Ctx): void {
  oval(c, -0.1, -0.5, 0.06, 0.14, BLUE_DARK, -0.35);
  oval(c, 0, -0.54, 0.06, 0.16, BLUE_DARK);
  oval(c, 0.1, -0.5, 0.06, 0.14, BLUE_DARK, 0.35);
  oval(c, 0, 0, 0.5, 0.46, BLUE);
  oval(c, -0.3, 0.1, 0.09, 0.06, PINK, 0, false);
  oval(c, 0.3, 0.1, 0.09, 0.06, PINK, 0, false);
  eye(c, -0.2, -0.04, 0.11);
  eye(c, 0.2, -0.04, 0.11);
  oval(c, 0, 0.12, 0.11, 0.08, ORANGE);
}

function drawQush(c: Ctx, L: Layers, m: Motion, t: number, px: number): void {
  L.body.draw(c, px);
  const th = m.arm * Math.PI;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  for (let s = -1; s <= 1; s += 2) {
    const ang = Math.atan2(cs, s * sn);
    limb(c, s * 0.56, -0.95, ang, 0.85, 0.36, BLUE_DARK);
    limb(c, s * 0.56 + Math.cos(ang) * 0.4, -0.95 + Math.sin(ang) * 0.4, ang, 0.45, 0.22, "#8fdcff", false);
  }
  headAt(c, L.head, px, 0, -1.4 + 0.03 * Math.abs(Math.sin(t * 9)), 0);
}

// ------------------------------------------------------------------ baqa (frog): crouches and hops
const GREEN = "#5bd35b";
const GREEN_DARK = "#3fb84a";

function baqaBody(c: Ctx): void {
  oval(c, 0, -0.55, 0.72, 0.5, GREEN);
  oval(c, 0, -0.45, 0.5, 0.34, "#e2ffa8", 0, false);
}

function baqaHead(c: Ctx): void {
  disc(c, -0.38, -0.42, 0.27, GREEN);
  disc(c, 0.38, -0.42, 0.27, GREEN);
  oval(c, 0, 0, 0.68, 0.46, GREEN);
  eye(c, -0.38, -0.44, 0.19);
  eye(c, 0.38, -0.44, 0.19);
  disc(c, -0.07, 0.0, 0.025, OUT, false);
  disc(c, 0.07, 0.0, 0.025, OUT, false);
  smile(c, 0, -0.02, 0.34);
  oval(c, -0.52, 0.12, 0.1, 0.07, "#ff9ec2", 0, false);
  oval(c, 0.52, 0.12, 0.1, 0.07, "#ff9ec2", 0, false);
}

function drawBaqa(c: Ctx, L: Layers, m: Motion, _t: number, px: number): void {
  for (let s = -1; s <= 1; s += 2) {
    oval(c, s * 0.66, -0.42, 0.3, 0.25, GREEN_DARK);
    oval(c, s * (0.8 + 0.1 * m.crouch), -0.1 + 0.22 * m.lift, 0.34, 0.1, GREEN_DARK, s * (0.12 + 0.4 * m.lift));
  }
  L.body.draw(c, px);
  headAt(c, L.head, px, 0, -1.02 + 0.06 * m.crouch, 0);
  const a = 0.15 + 0.6 * m.lift;
  for (let s = -1; s <= 1; s += 2) {
    const ang = HALF - s * a;
    limb(c, s * 0.4, -0.62, ang, 0.42, 0.2, GREEN);
    disc(c, s * 0.4 + Math.cos(ang) * 0.42, -0.62 + Math.sin(ang) * 0.42, 0.1, "#e2ffa8");
  }
}

// ------------------------------------------------------------------ ayiq (bear): paws up high
const BROWN = "#b87a4b";
const TAN = "#f2d2a9";

function ayiqBody(c: Ctx): void {
  oval(c, 0, -0.78, 0.7, 0.68, BROWN);
  oval(c, 0, -0.7, 0.45, 0.5, TAN, 0, false);
  oval(c, -0.34, -0.1, 0.3, 0.12, BROWN);
  oval(c, 0.34, -0.1, 0.3, 0.12, BROWN);
  oval(c, -0.34, -0.1, 0.15, 0.06, TAN, 0, false);
  oval(c, 0.34, -0.1, 0.15, 0.06, TAN, 0, false);
}

function ayiqHead(c: Ctx): void {
  disc(c, -0.36, -0.4, 0.17, BROWN);
  disc(c, 0.36, -0.4, 0.17, BROWN);
  disc(c, -0.36, -0.4, 0.085, TAN, false);
  disc(c, 0.36, -0.4, 0.085, TAN, false);
  oval(c, 0, 0, 0.5, 0.46, BROWN);
  oval(c, 0, 0.13, 0.24, 0.18, TAN);
  oval(c, 0, 0.05, 0.08, 0.055, "#3a2a2a");
  smile(c, 0, 0.12, 0.09);
  eye(c, -0.2, -0.09, 0.09);
  eye(c, 0.2, -0.09, 0.09);
  oval(c, -0.38, 0.12, 0.08, 0.055, "#ff9ec2", 0, false);
  oval(c, 0.38, 0.12, 0.08, 0.055, "#ff9ec2", 0, false);
}

function drawAyiq(c: Ctx, L: Layers, m: Motion, _t: number, px: number): void {
  L.body.draw(c, px);
  const th = m.arm * Math.PI * 0.94;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  for (let s = -1; s <= 1; s += 2) {
    const ang = Math.atan2(cs, s * sn);
    limb(c, s * 0.7, -1.1, ang, 0.74, 0.36, BROWN);
    disc(c, s * 0.7 + Math.cos(ang) * 0.62, -1.1 + Math.sin(ang) * 0.62, 0.12, TAN, false);
  }
  headAt(c, L.head, px, 0, -1.5, 0);
}

// ------------------------------------------------------------------ pingvin (penguin): claps its flippers
const NAVY = "#34406e";
const NAVY_LIGHT = "#4a5a9c";

function pingvinBody(c: Ctx): void {
  oval(c, 0, -0.95, 0.7, 0.9, NAVY);
  oval(c, 0, -0.85, 0.5, 0.72, "#ffffff", 0, false);
  oval(c, -0.3, -0.07, 0.3, 0.11, ORANGE);
  oval(c, 0.3, -0.07, 0.3, 0.11, ORANGE);
}

function pingvinHead(c: Ctx): void {
  oval(c, 0, 0, 0.46, 0.42, NAVY);
  oval(c, -0.15, 0.07, 0.2, 0.24, "#ffffff", 0, false);
  oval(c, 0.15, 0.07, 0.2, 0.24, "#ffffff", 0, false);
  eye(c, -0.17, -0.03, 0.1);
  eye(c, 0.17, -0.03, 0.1);
  oval(c, 0, 0.14, 0.11, 0.07, ORANGE);
  oval(c, -0.33, 0.12, 0.07, 0.05, "#ff9ec2", 0, false);
  oval(c, 0.33, 0.12, 0.07, 0.05, "#ff9ec2", 0, false);
}

const FLIP_TOGETHER = 0.488;
const FLIP_APART = 2.03;

function drawPingvin(c: Ctx, L: Layers, m: Motion, _t: number, px: number): void {
  L.body.draw(c, px);
  headAt(c, L.head, px, 0, -1.62, 0);
  const h = m.hands >= 0 ? m.hands : 1;
  const phi = FLIP_TOGETHER + (FLIP_APART - FLIP_TOGETHER) * h;
  limb(c, -0.66, -1.25, phi, 0.78, 0.3, NAVY_LIGHT);
  limb(c, 0.66, -1.25, Math.PI - phi, 0.78, 0.3, NAVY_LIGHT);
}

// ------------------------------------------------------------------ toshbaqa (turtle): slowly squats, tucks its head in
const SHELL = "#3fb36b";
const SKIN = "#a6e07a";

function toshbaqaBody(c: Ctx): void {
  c.beginPath();
  c.ellipse(-0.05, -0.42, 0.98, 0.95, 0, Math.PI, TAU);
  c.closePath();
  c.fillStyle = SHELL;
  c.fill();
  c.lineWidth = LW;
  c.strokeStyle = OUT;
  c.stroke();
  oval(c, -0.05, -0.4, 1.0, 0.14, "#ffe9a8");
  oval(c, -0.05, -0.95, 0.32, 0.22, "#7be09b", 0, false);
  oval(c, -0.58, -0.72, 0.2, 0.17, "#7be09b", -0.4, false);
  oval(c, 0.48, -0.72, 0.2, 0.17, "#7be09b", 0.4, false);
  oval(c, -0.05, -0.6, 0.2, 0.1, "#7be09b", 0, false);
}

function toshbaqaHead(c: Ctx): void {
  oval(c, 0, 0, 0.36, 0.32, SKIN);
  oval(c, 0.14, 0.1, 0.07, 0.05, "#ff9ec2", 0, false);
  eye(c, 0.12, -0.07, 0.1);
  smile(c, 0.1, 0.06, 0.1);
}

function drawToshbaqa(c: Ctx, L: Layers, m: Motion, _t: number, px: number): void {
  const k = m.crouch;
  const far = 0.17 * (1 - 0.5 * k);
  const near = 0.2 * (1 - 0.55 * k);
  oval(c, -1.0, -0.3, 0.18, 0.09, SKIN, -0.35);
  oval(c, 0.15, -far, 0.17, far, "#8fcb5e");
  oval(c, -0.3, -far, 0.17, far, "#8fcb5e");
  // the head slides back into the shell as the turtle goes down
  const hx = 0.98 - 0.2 * k;
  const hy = -0.78 + 0.3 * k;
  const ang = Math.atan2(hy + 0.55, hx - 0.55);
  limb(c, 0.55, -0.55 + 0.22 * k, ang, Math.hypot(hx - 0.55, hy + 0.55) + 0.1, 0.36, SKIN);
  headAt(c, L.head, px, hx, hy, 0);
  c.save();
  c.translate(0, 0.22 * k);
  L.body.draw(c, px);
  c.restore();
  oval(c, 0.55, -near, 0.22, near, SKIN);
  oval(c, -0.6, -near, 0.22, near, SKIN);
}

// ------------------------------------------------------------------ the table
interface Spec {
  /** scale so every animal fills about the same height */
  fit: number;
  body: [number, number, number, number];
  bodyPaint: (c: Ctx) => void;
  head: [number, number, number, number];
  headPaint: (c: Ctx) => void;
  draw: (c: Ctx, L: Layers, m: Motion, t: number, px: number) => void;
}

const SPECS: Record<AnimalId, Spec> = {
  quyon: { fit: 1, body: [-0.9, -1.2, 1.8, 1.2], bodyPaint: quyonBody, head: [-0.6, -0.55, 1.2, 1.1], headPaint: quyonHead, draw: drawQuyon },
  qush: { fit: 1, body: [-0.8, -1.4, 1.6, 1.4], bodyPaint: qushBody, head: [-0.65, -0.8, 1.3, 1.4], headPaint: qushHead, draw: drawQush },
  baqa: { fit: 1.15, body: [-0.9, -1.1, 1.8, 1.1], bodyPaint: baqaBody, head: [-0.85, -0.95, 1.7, 1.5], headPaint: baqaHead, draw: drawBaqa },
  ayiq: { fit: 0.97, body: [-0.9, -1.5, 1.8, 1.5], bodyPaint: ayiqBody, head: [-0.7, -0.75, 1.4, 1.45], headPaint: ayiqHead, draw: drawAyiq },
  pingvin: { fit: 0.97, body: [-0.9, -1.95, 1.8, 1.95], bodyPaint: pingvinBody, head: [-0.6, -0.6, 1.2, 1.2], headPaint: pingvinHead, draw: drawPingvin },
  toshbaqa: { fit: 1.3, body: [-1.1, -1.5, 2.2, 1.5], bodyPaint: toshbaqaBody, head: [-0.5, -0.5, 1, 1], headPaint: toshbaqaHead, draw: drawToshbaqa },
};

/** All six animals with their cached layers. `cache=false`: always draw the paths directly (tests, mocked contexts). */
export class AnimalArt {
  private layers = {} as Record<AnimalId, Layers>;

  constructor(cache = true) {
    for (const id of Object.keys(SPECS) as AnimalId[]) {
      const s = SPECS[id];
      this.layers[id] = {
        body: new Layer(s.body[0], s.body[1], s.body[2], s.body[3], s.bodyPaint, cache),
        head: new Layer(s.head[0], s.head[1], s.head[2], s.head[3], s.headPaint, cache),
      };
    }
  }

  /** cached canvases built so far (tests / debug) */
  get builds(): number {
    let n = 0;
    for (const id of Object.keys(this.layers) as AnimalId[]) n += this.layers[id].body.builds + this.layers[id].head.builds;
    return n;
  }

  /**
   * Draws animal `id` with its feet on (x, y); `R` = half its height in px; `face` +1 / -1 mirrors it (the turtle looks
   * to +x). The pose comes from `m` (sx / sy squash about the feet, rot tilt) and `t` (idle sway, seconds).
   */
  draw(c: Ctx, id: AnimalId, x: number, y: number, R: number, m: Motion, t: number, face: 1 | -1): void {
    const s = SPECS[id];
    const u = R * s.fit;
    c.save();
    c.translate(x, y);
    c.scale(u * m.sx * face, u * m.sy);
    c.lineJoin = "round";
    c.lineCap = "round";
    if (m.rot !== 0) {
      c.translate(0, -0.8);
      c.rotate(m.rot);
      c.translate(0, 0.8);
    }
    s.draw(c, this.layers[id], m, t, u);
    c.restore();
  }
}
