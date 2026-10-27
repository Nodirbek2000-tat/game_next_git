import { TAU, rnd } from "../math";
import type { FxApi, Lm } from "../types";
import { POSE_CONN } from "../tracking/people";

type Kind = "dot" | "ring" | "text";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  size: number;
  col: string;
  kind: Kind;
  drag: number;
  glow: boolean;
  text: string;
  w: number;
}

const MAXP = 1800;

const FONT = "-apple-system,BlinkMacSystemFont,Inter,Segoe UI,sans-serif";

/**
 * 2D effects layer: particles, popups, rings, stains (juice splashes on a separate layer), screen shake and flash.
 * All units are CSS pixels; the canvases are scaled by the device pixel ratio by the owner.
 * Particles live in a fixed pool, nothing is allocated per frame.
 */
export class Fx2D implements FxApi {
  private pool: Particle[] = [];
  private n = 0;
  shakeT = 0;
  shakeA = 0;
  flashV = 0;
  flashCol = "255,255,255";
  /** particle count multiplier (quality level) */
  density = 1;
  private stainCtx: CanvasRenderingContext2D | null = null;
  private stainW = 0;
  private stainH = 0;

  constructor() {
    for (let i = 0; i < MAXP; i++) {
      this.pool.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, size: 4, col: "#fff", kind: "dot", drag: 0.985, glow: false, text: "", w: 6 });
    }
  }

  get count(): number {
    return this.n;
  }

  setStainLayer(ctx: CanvasRenderingContext2D | null, w: number, h: number): void {
    this.stainCtx = ctx;
    this.stainW = w;
    this.stainH = h;
  }

  clear(): void {
    this.n = 0;
    this.shakeT = this.shakeA = this.flashV = 0;
    this.stainCtx?.clearRect(0, 0, this.stainW, this.stainH);
  }

  private alloc(): Particle {
    if (this.n >= MAXP) {
      // drop the oldest 60 (swap-remove from the front)
      for (let i = 0; i < 60; i++) this.pool[i].life = 0;
      this.compact();
    }
    const p = this.pool[this.n++];
    p.x = p.y = p.vx = p.vy = p.g = 0;
    p.life = p.max = 1;
    p.size = 4;
    p.col = "#fff";
    p.kind = "dot";
    p.drag = 0.985;
    p.glow = false;
    p.text = "";
    p.w = 6;
    return p;
  }

  private compact(): void {
    let w = 0;
    for (let r = 0; r < this.n; r++) {
      const p = this.pool[r];
      if (p.life > 0) {
        if (w !== r) {
          this.pool[r] = this.pool[w];
          this.pool[w] = p;
        }
        w++;
      }
    }
    this.n = w;
  }

  particle(o: { x: number; y: number; vx?: number; vy?: number; life?: number; size?: number; col?: string; glow?: boolean }): void {
    const p = this.alloc();
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.life = p.max = o.life ?? 1;
    p.size = o.size ?? 4;
    p.col = o.col ?? "#fff";
    p.glow = o.glow ?? false;
  }

  burst(
    x: number,
    y: number,
    n: number,
    col: string | (() => string),
    speed: [number, number] = [3, 12],
    size: [number, number] = [2, 6],
    life: [number, number] = [0.4, 1],
    glow = true,
    gravity = 0.25,
  ): void {
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      const a = rnd(0, TAU);
      const s = rnd(speed[0], speed[1]);
      const p = this.alloc();
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.g = gravity;
      p.life = p.max = rnd(life[0], life[1]);
      p.size = rnd(size[0], size[1]);
      p.col = typeof col === "function" ? col() : col;
      p.glow = glow;
    }
  }

  popup(text: string, x: number, y: number, col = "#fff", size = 34, life = 0.9): void {
    const p = this.alloc();
    p.kind = "text";
    p.text = text;
    p.x = x;
    p.y = y;
    p.vy = -1.4;
    p.life = p.max = life;
    p.size = size;
    p.col = col;
    p.drag = 0.96;
  }

  ring(x: number, y: number, r: number, col = "255,255,255", life = 0.45, w = 6): void {
    const p = this.alloc();
    p.kind = "ring";
    p.x = x;
    p.y = y;
    p.size = r;
    p.life = p.max = life;
    p.col = col;
    p.w = w;
  }

  stain(x: number, y: number, r: number, col: string): void {
    const c = this.stainCtx;
    if (!c) return;
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = col;
    c.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = rnd(0, TAU);
      const rr = r * rnd(0.25, 0.7);
      c.moveTo(x + Math.cos(a) * r * 0.9 + rr, y + Math.sin(a) * r * 0.9);
      c.arc(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, rr, 0, TAU);
    }
    c.arc(x, y, r * 0.8, 0, TAU);
    c.fill();
    c.restore();
  }

  shake(amount: number, seconds = 0.3): void {
    this.shakeA = Math.max(this.shakeA, amount);
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  flash(rgb = "255,255,255", alpha = 0.5): void {
    this.flashCol = rgb;
    this.flashV = Math.max(this.flashV, alpha);
  }

  update(dt: number): void {
    const s = dt * 60;
    for (let i = 0; i < this.n; i++) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.g * s;
      const d = Math.pow(p.drag, s);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * s;
      p.y += p.vy * s;
    }
    this.compact();
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (!this.shakeT) this.shakeA = 0;
    this.flashV *= Math.pow(0.88, s);
    // stains slowly fade
    const c = this.stainCtx;
    if (c) {
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.globalAlpha = Math.min(1, dt * 0.45);
      c.fillRect(0, 0, this.stainW, this.stainH);
      c.restore();
    }
  }

  draw(c: CanvasRenderingContext2D): void {
    c.save();
    c.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.n; i++) {
      const p = this.pool[i];
      if (p.glow && p.kind === "dot") {
        const k = p.life / p.max;
        c.globalAlpha = k;
        c.fillStyle = p.col;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, TAU);
        c.fill();
      }
    }
    c.restore();
    c.save();
    for (let i = 0; i < this.n; i++) {
      const p = this.pool[i];
      const k = p.life / p.max;
      if (p.kind === "dot" && !p.glow) {
        c.globalAlpha = Math.min(1, k * 1.5);
        c.fillStyle = p.col;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, TAU);
        c.fill();
      } else if (p.kind === "ring") {
        c.globalAlpha = k;
        c.strokeStyle = `rgba(${p.col},${k})`;
        c.lineWidth = p.w * k + 1;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (1.6 - k * 0.6) * (1 + (1 - k) * 1.2), 0, TAU);
        c.stroke();
      } else if (p.kind === "text") {
        c.globalAlpha = Math.min(1, k * 2);
        const sc = 1 + (1 - Math.min(1, (p.max - p.life) / 0.12)) * 0.5;
        c.font = `900 ${p.size * sc}px ${FONT}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.lineWidth = p.size * 0.16;
        c.strokeStyle = "rgba(0,0,0,.65)";
        c.strokeText(p.text, p.x, p.y);
        c.fillStyle = p.col;
        c.fillText(p.text, p.x, p.y);
      }
    }
    c.restore();
  }
}

// ---------- drawing helpers shared by the engine UI and games ----------

export function drawSkeleton(c: CanvasRenderingContext2D, lm: Lm[], col = "rgba(120,230,255,.75)", lw = 3, joints = true): void {
  c.save();
  c.strokeStyle = col;
  c.lineWidth = lw;
  c.lineCap = "round";
  c.beginPath();
  for (const [a, b] of POSE_CONN) {
    if (lm[a].v < 0.4 || lm[b].v < 0.4) continue;
    c.moveTo(lm[a].x, lm[a].y);
    c.lineTo(lm[b].x, lm[b].y);
  }
  c.stroke();
  if (joints) {
    c.fillStyle = col;
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      if (lm[i].v > 0.4) {
        c.beginPath();
        c.arc(lm[i].x, lm[i].y, lw * 1.4, 0, TAU);
        c.fill();
      }
    }
  }
  c.restore();
}

/** Fading trail; `col` contains the letter "A" where the alpha goes, e.g. "rgba(160,240,255,A)". */
export function drawTrail(c: CanvasRenderingContext2D, pts: { x: number; y: number }[], col: string, w: number): void {
  if (pts.length < 2) return;
  c.save();
  c.globalCompositeOperation = "lighter";
  c.lineCap = "round";
  c.lineJoin = "round";
  for (let i = 1; i < pts.length; i++) {
    const k = i / pts.length;
    c.strokeStyle = col.replace("A", (k * 0.9).toFixed(2));
    c.lineWidth = w * k;
    c.beginPath();
    c.moveTo(pts[i - 1].x, pts[i - 1].y);
    c.lineTo(pts[i].x, pts[i].y);
    c.stroke();
  }
  c.restore();
}

export function drawText(c: CanvasRenderingContext2D, t: string, x: number, y: number, size = 20, col = "#fff", align: CanvasTextAlign = "center", weight = 800): void {
  c.save();
  c.font = `${weight} ${size}px ${FONT}`;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.lineWidth = size * 0.18;
  c.strokeStyle = "rgba(0,0,0,.6)";
  c.strokeText(t, x, y);
  c.fillStyle = col;
  c.fillText(t, x, y);
  c.restore();
}

export function drawRingProgress(c: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, col = "#fff"): void {
  c.save();
  c.lineCap = "round";
  c.strokeStyle = "rgba(0,0,0,.35)";
  c.lineWidth = 7;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.stroke();
  c.strokeStyle = col;
  c.lineWidth = 4.5;
  c.beginPath();
  c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * k);
  c.stroke();
  c.restore();
}
