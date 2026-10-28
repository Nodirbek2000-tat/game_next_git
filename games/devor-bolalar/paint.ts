// Drawing of "Devordan o‘tamiz": plain 2D, no gradients / shadows, nothing allocated per frame.
//  - the wall is painted ONCE per wall into a small offscreen canvas (bricks + the pose-shaped holes); every frame it is only
//    one drawImage that grows from the centre (perspective: slow far away, fast at the end) and flies through at the end
//  - two big pictogram cards (left and right) show the pose the whole time, three dots light up with the countdown chimes
//  - a green check above a child who holds the pose, sparks + ring + star badge for those who passed, a soft "💫" bump for the rest

import { KID_COLORS } from "../bogcha/common";
import type { KidSlot } from "../bogcha/common";
import { FIG_H, drawFigure, figMid, type PoseDef } from "./poses";
import { ROUND_CFG, SLOTS, type Round } from "./round";

const TAU = Math.PI * 2;
const TEX_W = 720;
const MAX_SPARKS = 72;
/** perspective strength of the approach: the wall starts at 1 / (1 + D) of its final size */
export const FAR = 5;

const BRICKS = ["#d4683e", "#c45a33", "#dd7a4d", "#b84f2d"] as const;
const MORTAR = "#f0d6ae";
const RIM = "#fff3d6";
const BODY = "#ff7a3d";
const HEAD = "#ffb703";
const PALETTE: readonly string[] = [...KID_COLORS, "#ffd23d", "#ffffff", "#4fe069", "#ff6b8a"];
const C_GOLD = 5;
const C_WHITE = 6;
const C_GREEN = 7;
const C_PINK = 8;

const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

/** wall scale (1 = covers the stage) while it comes: p = 0..1 */
export function approachScale(p: number): number {
  return 1 / (1 + FAR * (1 - Math.max(0, Math.min(1, p))));
}

/** wall scale while it flies through: q = 0..1 */
export function throughScale(q: number): number {
  return 1 + 1.7 * q * q;
}

/** height of the wall texture for a stage of w x h (same aspect, so circles stay round) */
export const texHeight = (w: number, h: number): number => Math.max(200, Math.min(1200, Math.round((TEX_W * h) / w)));

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Painter {
  private tex: HTMLCanvasElement | null = null;
  private texKey = -1;
  private texOk = false;
  // sparks (pooled)
  private readonly sx = new Float32Array(MAX_SPARKS);
  private readonly sy = new Float32Array(MAX_SPARKS);
  private readonly svx = new Float32Array(MAX_SPARKS);
  private readonly svy = new Float32Array(MAX_SPARKS);
  private readonly sl = new Float32Array(MAX_SPARKS);
  private readonly sc = new Uint8Array(MAX_SPARKS);
  private cursor = 0;
  private lastDraw = 0;
  private dt = 0;
  private fw = 0;
  private fh = 0;
  private fontEmoji = "";
  private fontBig = "";

  constructor(private readonly rnd: () => number = Math.random) {}

  /** live sparks (for tests / debug) */
  get sparkCount(): number {
    let n = 0;
    for (let i = 0; i < MAX_SPARKS; i++) if (this.sl[i] > 0) n++;
    return n;
  }

  private emit(x: number, y: number, vx: number, vy: number, life: number, col: number): void {
    const i = this.cursor;
    this.cursor = (i + 1) % MAX_SPARKS;
    this.sx[i] = x;
    this.sy[i] = y;
    this.svx[i] = vx;
    this.svy[i] = vy;
    this.sl[i] = life;
    this.sc[i] = col;
  }

  /** a small burst of sparks around a child's head */
  burst(x: number, y: number, n: number, col: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * TAU;
      const v = speed * (0.4 + this.rnd() * 0.6);
      this.emit(x, y, Math.cos(a) * v, Math.sin(a) * v - speed * 0.3, 0.7 + this.rnd() * 0.5, i % 3 === 0 ? C_GOLD : col);
    }
  }

  /** confetti falling from the top ("Hammamiz o‘tdik!") */
  confetti(w: number, h: number): void {
    for (let i = 0; i < 40; i++) this.emit(w * (0.08 + this.rnd() * 0.84), h * 0.12, (this.rnd() - 0.5) * w * 0.2, h * (0.05 + this.rnd() * 0.25), 1.2 + this.rnd() * 0.8, [C_GOLD, C_PINK, C_GREEN, 0, 3][i % 5]);
  }

  private layout(w: number, h: number): void {
    this.fw = w;
    this.fh = h;
    this.fontEmoji = `${Math.round(h * 0.09)}px ${EMOJI}`;
    this.fontBig = `${Math.round(h * 0.2)}px ${EMOJI}`;
  }

  /** paints the wall of the current pose into the offscreen canvas (once per wall) */
  private build(w: number, h: number, r: Round): void {
    const th = texHeight(w, h);
    this.texKey = r.index * 100000 + th;
    if (!this.tex) this.tex = document.createElement("canvas");
    const c = this.tex.getContext("2d");
    if (!c) {
      this.texOk = false;
      return;
    }
    if (this.tex.width !== TEX_W || this.tex.height !== th) {
      this.tex.width = TEX_W;
      this.tex.height = th;
    }
    this.texOk = true;
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, TEX_W, th);
    c.fillStyle = MORTAR;
    c.fillRect(0, 0, TEX_W, th);
    const rows = 12;
    const bh = th / rows;
    const bw = TEX_W / 9;
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? -bw / 2 : 0;
      for (let col = 0; col < 11; col++) {
        const hsh = Math.imul(row * 7 + col * 13 + r.index * 5 + 1, 2654435761) >>> 28;
        c.fillStyle = BRICKS[hsh & 3];
        c.fillRect(off + col * bw + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
    c.lineWidth = 10;
    c.strokeStyle = "#8f3c22";
    c.strokeRect(5, 5, TEX_W - 10, th - 10);
    // the holes: a pale rim first, then the silhouette is cut out
    const n = r.holes;
    const p: PoseDef = r.pose;
    const u = Math.min((th * 0.8) / FIG_H, ((TEX_W / n) * 0.86) / 4.9);
    const oy = th * 0.5 - figMid(p) * u;
    for (let i = 0; i < n; i++) drawFigure(c, p, (TEX_W * (i + 0.5)) / n, oy, u, 1.45, RIM, RIM);
    c.globalCompositeOperation = "destination-out";
    for (let i = 0; i < n; i++) drawFigure(c, p, (TEX_W * (i + 0.5)) / n, oy, u, 1.12, "#000", "#000");
    c.globalCompositeOperation = "source-over";
  }

  private card(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, p: PoseDef, pop: number): void {
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    ctx.scale(pop, pop);
    ctx.translate(-s / 2, -s / 2);
    roundRectPath(ctx, 0, 0, s, s, s * 0.14);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fill();
    ctx.lineWidth = Math.max(3, s * 0.03);
    ctx.strokeStyle = "#ffb703";
    ctx.stroke();
    const u = (s * 0.82) / FIG_H;
    drawFigure(ctx, p, s / 2, s * 0.5 - figMid(p) * u, u, 1, BODY, HEAD);
    ctx.restore();
  }

  /** the wall: behind the children */
  drawBack(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, r: Round): void {
    this.dt = this.lastDraw ? Math.min(0.05, (now - this.lastDraw) / 1000) : 0;
    this.lastDraw = now;
    if (w !== this.fw || h !== this.fh) this.layout(w, h);
    if (r.phase === "gap" || r.index < 0) return;
    if (this.texKey !== r.index * 100000 + texHeight(w, h)) this.build(w, h, r);
    const t = r.t;
    let s: number;
    let a = 1;
    if (r.phase === "approach") s = approachScale(t / ROUND_CFG.approach);
    else {
      const q = clamp01(t / ROUND_CFG.result);
      s = throughScale(q);
      a = 1 - clamp01((q - 0.3) / 0.6);
    }
    if (this.texOk && this.tex && a > 0.01) {
      ctx.globalAlpha = a;
      ctx.drawImage(this.tex, w * 0.5 - (w * s) / 2, h * 0.52 - (h * s) / 2, w * s, h * s);
      ctx.globalAlpha = 1;
    }
  }

  private badge(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number): void {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fillStyle = "#3ad06a";
    ctx.fill();
    ctx.lineWidth = Math.max(3, rad * 0.16);
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x - rad * 0.45, y + rad * 0.02);
    ctx.lineTo(x - rad * 0.12, y + rad * 0.38);
    ctx.lineTo(x + rad * 0.5, y - rad * 0.32);
    ctx.lineWidth = Math.max(4, rad * 0.3);
    ctx.stroke();
  }

  /** the two big pictogram cards (left and right) and the countdown dots: over the children, always visible */
  private drawCards(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, r: Round): void {
    if (r.phase !== "approach") return;
    const t = r.t;
    const pad = Math.max(12, h * 0.025);
    const size = h * 0.26;
    const k = clamp01(t / 0.45);
    const pop = k < 1 ? 1 - Math.pow(1 - k, 3) * Math.cos(k * 9) : 1 + (r.progress > 0.55 ? 0.035 * Math.sin(now / 160) : 0);
    this.card(ctx, pad, h * 0.17, size, r.pose, pop);
    this.card(ctx, w - pad - size, h * 0.17, size, r.pose, pop);
    // countdown dots
    const dr = h * 0.016;
    for (let side = 0; side < 2; side++) {
      const cx = side === 0 ? pad + size / 2 : w - pad - size / 2;
      for (let i = 0; i < 3; i++) {
        const on = i < r.lit;
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * dr * 3.2, h * 0.17 + size + dr * 2.2, on ? dr * 1.25 : dr, 0, TAU);
        ctx.fillStyle = on ? "#ffd23d" : "rgba(255,255,255,.45)";
        ctx.fill();
      }
    }
  }

  /** over the children: checks, rings, bumps, sparks, the big party emoji */
  drawFront(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, r: Round, kids: readonly KidSlot[]): void {
    const dt = this.dt;
    if (w !== this.fw || h !== this.fh) this.layout(w, h);
    this.drawCards(ctx, w, h, now, r);
    const q = r.phase === "result" ? clamp01(r.t / ROUND_CFG.result) : 0;
    const sr = Math.max(3, h * 0.0085);
    for (let i = 0; i < SLOTS; i++) {
      const k = kids[i];
      if (!k.active) continue;
      const hx = k.pts.head.x;
      const hy = k.pts.head.y - k.headR * 2.7;
      if (r.phase === "approach") {
        if (r.gates[i].ok && r.progress >= ROUND_CFG.armFrac) this.badge(ctx, hx, hy, Math.max(16, k.headR * 0.95));
      } else if (r.phase === "result") {
        const res = r.results[i];
        if (res === 1) {
          const pop = 1 + 0.35 * Math.max(0, 1 - q * 4);
          this.badge(ctx, hx, hy, Math.max(18, k.headR * 1.1) * pop);
          ctx.globalAlpha = 1 - q;
          ctx.beginPath();
          ctx.arc(k.pts.head.x, k.pts.head.y, k.headR * (2.2 + q * 5), 0, TAU);
          ctx.lineWidth = Math.max(3, k.headR * 0.35);
          ctx.strokeStyle = k.color;
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (res === 2) {
          ctx.font = this.fontEmoji;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.globalAlpha = 1 - clamp01((q - 0.6) / 0.4);
          ctx.fillStyle = "#000";
          ctx.fillText("💫", hx + Math.sin(now / 55) * k.headR * 0.5 * (1 - q), hy);
          ctx.globalAlpha = 1;
        }
      }
    }
    // all together: a big party emoji
    if (r.phase === "result" && r.allPassed) {
      const pop = 0.7 + 0.45 * Math.min(1, q * 5) - 0.15 * q;
      ctx.save();
      ctx.translate(w / 2, h * 0.42);
      ctx.scale(pop, pop);
      ctx.font = this.fontBig;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 1 - clamp01((q - 0.7) / 0.3);
      ctx.fillStyle = "#000";
      ctx.fillText("🎉", 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // sparks
    const g = h * 0.9;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const life = this.sl[i];
      if (life <= 0) continue;
      this.sl[i] = life - dt;
      this.svy[i] += g * dt;
      this.sx[i] += this.svx[i] * dt;
      this.sy[i] += this.svy[i] * dt;
      if (this.sl[i] <= 0) continue;
      ctx.globalAlpha = Math.min(1, life * 1.6);
      ctx.fillStyle = PALETTE[this.sc[i]];
      ctx.fillRect(this.sx[i] - sr, this.sy[i] - sr, sr * 2, sr * 2);
    }
    ctx.globalAlpha = 1;
  }
}

export { C_GOLD, C_WHITE, C_GREEN, C_PINK };
