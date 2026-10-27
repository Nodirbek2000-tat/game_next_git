// Baliqcha painter: flat 2D shapes only (no images, no gradients, no shadows), nothing allocated per frame.
// drawBack: sky, clouds, water, swimming fish (behind the children's avatars).
// drawFront: rods, lines, floats, fish that bite / fly, splashes, the shared basket, per-child catch badges and hints.

import type { KidSlot } from "@/engine/tracking/kids";
import { MAX_KIDS } from "@/engine/tracking/kids";
import { pillPath, starPath } from "../bogcha/common";
import { ST, TUNE } from "./angler";
import type { Baliqcha } from "./game";
import { BASKET, FM, GOLDEN, N_FISH, WATER_TOP, jumpLift } from "./pond";

const TAU = Math.PI * 2;
const EMOJI = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";

const BODY = ["#ff7aa8", "#ff9a3d", "#b07cff", "#5fdc7a", "#3fd0ff", "#ff5a5a", "#b6e03b", "#6f8bff", "#ffd23d"];
const DARK = ["#e0507f", "#e07414", "#8a54e0", "#34b955", "#1fa9d9", "#d63a3a", "#8fb81c", "#4a64e0", "#f0a800"];
const LIGHT = ["#ffd0df", "#ffd6a8", "#e1ceff", "#c6f5cf", "#c2f0ff", "#ffc2c2", "#e6f7a6", "#ccd6ff", "#fff3b0"];

/** "×n" labels, built once */
const COUNT_TXT: string[] = Array.from({ length: 100 }, (_, i) => "×" + i);

const DROP_COS = new Float32Array(6);
const DROP_SIN = new Float32Array(6);
for (let i = 0; i < 6; i++) {
  DROP_COS[i] = Math.cos(-Math.PI * (0.15 + (0.7 * i) / 5));
  DROP_SIN[i] = Math.sin(-Math.PI * (0.15 + (0.7 * i) / 5));
}

/** scratch point (no allocation) */
const P = { x: 0, y: 0 };

/** One cartoon fish centred at (x, y), `len` px long, facing `dir` (+1 right, -1 left). ~17 canvas calls. */
export function drawFish(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, dir: number, wag: number, ci: number, open: boolean): void {
  const L = len;
  const H = len * 0.44;
  const tw = Math.sin(wag) * L * 0.13;
  ctx.fillStyle = DARK[ci];
  ctx.beginPath();
  ctx.moveTo(x - dir * L * 0.34, y);
  ctx.lineTo(x - dir * L * 0.74, y - H * 0.75 + tw);
  ctx.lineTo(x - dir * L * 0.74, y + H * 0.75 + tw);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - dir * L * 0.12, y - H * 0.4);
  ctx.lineTo(x + dir * L * 0.02, y - H * 0.88);
  ctx.lineTo(x + dir * L * 0.22, y - H * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BODY[ci];
  ctx.beginPath();
  ctx.ellipse(x, y, L * 0.5, H * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = LIGHT[ci];
  ctx.beginPath();
  ctx.ellipse(x + dir * L * 0.04, y + H * 0.14, L * 0.34, H * 0.19, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x + dir * L * 0.28, y - H * 0.12, H * 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#2b2140";
  ctx.beginPath();
  ctx.arc(x + dir * L * 0.31, y - H * 0.12, H * 0.09, 0, TAU);
  ctx.fill();
  if (open) {
    ctx.fillStyle = "#b02a4a";
    ctx.beginPath();
    ctx.arc(x + dir * L * 0.46, y + H * 0.1, H * 0.13, 0, TAU);
    ctx.fill();
  }
}

function drawFloat(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x - r * 0.14, y - r * 1.7, r * 0.28, r * 0.8);
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI);
  ctx.fill();
}

export class Painter {
  private w = 0;
  private h = 0;
  private fontHint = "";
  private fontCount = "";
  private fontBang = "";

  constructor(private g: Baliqcha) {}

  private layout(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.fontHint = `${Math.round(h * 0.075)}px ${EMOJI}`;
    this.fontBang = `${Math.round(h * 0.06)}px ${EMOJI}`;
    this.fontCount = `800 ${Math.round(Math.max(16, h * 0.034))}px system-ui, 'Segoe UI', sans-serif`;
  }

  /** where fish `i` is on the screen (px, into P), with the arc of a flying fish / the lift of a jumping one */
  private fishPx(i: number): void {
    const p = this.g.pond;
    let y = p.y[i] * this.h;
    if (p.mode[i] === FM.fly) {
      const t = Math.min(1, p.t[i] / p.dur[i]);
      y -= Math.sin(Math.PI * t) * 0.2 * this.h;
    } else if (p.mode[i] === FM.swim) y -= jumpLift(p.jump[i]) * this.h;
    P.x = p.x[i] * this.w;
    P.y = y;
  }

  private fishLen(i: number): number {
    const p = this.g.pond;
    let s = p.size[i];
    if (p.mode[i] === FM.fly) s *= 1 - 0.35 * Math.min(1, p.t[i] / p.dur[i]);
    return this.h * 0.082 * s;
  }

  private oneFish(ctx: CanvasRenderingContext2D, i: number, now: number): void {
    const p = this.g.pond;
    this.fishPx(i);
    if (P.x < -this.h * 0.2 || P.x > this.w + this.h * 0.2) return;
    const m = p.mode[i];
    const len = this.fishLen(i);
    drawFish(ctx, P.x, P.y, len, p.dir[i] >= 0 ? 1 : -1, p.phase[i] * (m === FM.swim ? 1 : 1.6), p.color[i], m === FM.hook || m === FM.fly);
    if (i === GOLDEN) {
      // sparkles around the golden fish
      const a = now * 0.004;
      ctx.fillStyle = "#fffbd0";
      starPath(ctx, P.x + Math.cos(a) * len * 0.7, P.y - len * 0.5 + Math.sin(a * 1.3) * len * 0.15, len * 0.14);
      ctx.fill();
      starPath(ctx, P.x - Math.cos(a * 0.8) * len * 0.6, P.y + len * 0.3 + Math.sin(a) * len * 0.12, len * 0.1);
      ctx.fill();
    }
  }

  drawBack(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
    if (w !== this.w || h !== this.h) this.layout(w, h);
    const top = h * WATER_TOP;
    // sky + a few slow clouds
    ctx.fillStyle = "rgba(150,215,255,.34)";
    ctx.fillRect(0, 0, w, top);
    ctx.fillStyle = "rgba(255,255,255,.7)";
    for (let c = 0; c < 3; c++) {
      const span = w + h * 0.8;
      const cx = ((now * (0.012 + c * 0.006) + c * span * 0.37) % span) - h * 0.4;
      const cy = h * (0.14 + c * 0.08);
      const r = h * 0.045;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.arc(cx + r * 1.1, cy - r * 0.4, r * 1.2, 0, TAU);
      ctx.arc(cx + r * 2.3, cy, r, 0, TAU);
      ctx.fill();
    }
    // water
    ctx.fillStyle = "rgba(34,142,228,.84)";
    ctx.fillRect(0, top, w, h - top);
    ctx.fillStyle = "rgba(10,72,176,.32)";
    ctx.fillRect(0, top + (h - top) * 0.55, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.5)";
    ctx.lineWidth = Math.max(2, h * 0.005);
    const step = Math.max(24, w / 28);
    for (let l = 0; l < 3; l++) {
      const y0 = top + l * (h - top) * 0.27 + 2;
      const amp = h * (l === 0 ? 0.007 : 0.005);
      ctx.beginPath();
      for (let x = 0; x <= w + step; x += step) {
        const y = y0 + Math.sin(x * 0.018 + now * 0.0017 * (1 + l * 0.4) + l * 2) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // swimming fish
    const p = this.g.pond;
    for (let i = 0; i < N_FISH; i++) if (p.mode[i] === FM.swim) this.oneFish(ctx, i, now);
  }

  drawFront(ctx: CanvasRenderingContext2D, now: number, kids: readonly KidSlot[], w: number, h: number): void {
    if (w !== this.w || h !== this.h) this.layout(w, h);
    const p = this.g.pond;
    // fish that come to the bait, hang on the line or fly to the basket
    for (let i = 0; i < N_FISH; i++) if (p.mode[i] !== FM.swim) this.oneFish(ctx, i, now);
    // rods, lines, floats
    for (let s = 0; s < MAX_KIDS; s++) {
      const k = kids[s];
      if (k?.active) this.gear(ctx, k, s, now);
    }
    this.splashes(ctx);
    this.basket(ctx, w, h);
    // catch badges and hints above the children
    for (let s = 0; s < MAX_KIDS; s++) {
      const k = kids[s];
      if (k?.active) this.badge(ctx, k, s, now);
    }
  }

  private gear(ctx: CanvasRenderingContext2D, k: KidSlot, s: number, now: number): void {
    const g = this.g;
    const ang = g.anglers[s];
    const w = this.w;
    const h = this.h;
    const sc = Math.max(26, k.scale);
    const hand = k.pts.rw.v >= 0.25 || k.pts.lw.v < 0.25 ? k.pts.rw : k.pts.lw;
    const hx = hand.v >= 0.25 ? hand.x : k.center.x;
    const hy = hand.v >= 0.25 ? hand.y : k.center.y;
    const side = hx < w * 0.5 ? 1 : -1;
    const len = Math.min(sc * 2.1, h * 0.3);
    const tx = hx + side * len * 0.45;
    const ty = hy - len * 0.9;
    // the rod, in the child's colour
    ctx.strokeStyle = k.color;
    ctx.lineWidth = Math.max(5, sc * 0.13);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = Math.max(2, h * 0.004);
    const fr = Math.max(9, h * 0.024);
    const fx = g.floatX[s] * w;
    const fy = g.floatY[s] * h;
    switch (ang.state) {
      case ST.idle: {
        // the float hangs from the rod and swings: "throw me!"
        const bx = tx + Math.sin(now * 0.004 + s) * fr * 0.5;
        const by = ty + sc * 0.9 + Math.sin(now * 0.003 + s) * fr * 0.3;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
        ctx.stroke();
        drawFloat(ctx, bx, by, fr * 0.8, k.color);
        break;
      }
      case ST.fly: {
        const t = Math.min(1, ang.t / TUNE.flyTime);
        const x = tx + (fx - tx) * t;
        const y = ty + (fy - ty) * t - Math.sin(Math.PI * t) * h * 0.2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo((tx + x) / 2, (ty + y) / 2 + h * 0.03, x, y);
        ctx.stroke();
        drawFloat(ctx, x, y, fr, k.color);
        break;
      }
      case ST.wait:
      case ST.bite: {
        const biting = ang.state === ST.bite;
        const bob = biting ? (0.5 + 0.5 * Math.sin(now * 0.032)) * fr * 1.1 + fr * 0.3 : Math.sin(now * 0.004 + s * 2) * fr * 0.25;
        const y = fy + bob;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        if (biting) ctx.lineTo(fx, y);
        else ctx.quadraticCurveTo((tx + fx) / 2, (ty + y) / 2 + Math.abs(fx - tx) * 0.08 + h * 0.02, fx, y);
        ctx.stroke();
        // ripples around the float
        const rp = (now * (biting ? 0.0035 : 0.0012) + s * 0.3) % 1;
        ctx.strokeStyle = "#fff";
        ctx.globalAlpha = 0.6 * (1 - rp);
        ctx.lineWidth = Math.max(2, h * 0.004);
        ctx.beginPath();
        ctx.ellipse(fx, fy + fr * 0.4, fr * (1.2 + rp * 2.4), fr * (0.4 + rp * 0.8), 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        drawFloat(ctx, fx, y, fr, k.color);
        if (biting) {
          ctx.font = this.fontBang;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#000";
          ctx.fillText("❗", fx, fy - fr * 3.4 - Math.abs(Math.sin(now * 0.012)) * fr);
        }
        break;
      }
      case ST.reel: {
        const f = g.pond.fishOf[s];
        if (f >= 0) {
          this.fishPx(f);
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(P.x, P.y);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.lineCap = "butt";
  }

  private splashes(ctx: CanvasRenderingContext2D): void {
    const g = this.g;
    const h = this.h;
    for (let i = 0; i < g.spT.length; i++) {
      const t = g.spT[i];
      if (t > 0.8) continue;
      const big = g.spBig[i] === 1;
      const p = t / 0.8;
      const x = g.spX[i] * this.w;
      const y = g.spY[i] * h;
      const R = h * (big ? 0.1 : 0.06);
      ctx.globalAlpha = 0.9 * (1 - p);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(2, h * 0.006);
      ctx.beginPath();
      ctx.ellipse(x, y, R * (0.3 + p), R * (0.3 + p) * 0.38, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      const dr = h * (big ? 0.012 : 0.008);
      const v = h * (big ? 0.62 : 0.4);
      ctx.beginPath();
      for (let d = 0; d < 6; d++) {
        const dx = x + DROP_COS[d] * v * t * 0.75;
        const dy = y + DROP_SIN[d] * v * t + h * 1.1 * t * t * 0.5;
        ctx.moveTo(dx + dr, dy);
        ctx.arc(dx, dy, dr, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private basket(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = this.g;
    const k = 1 + g.basketPulse * 0.16;
    const bw = Math.min(w * 0.22, h * 0.4) * k;
    const bh = bw * 0.52;
    const cx = BASKET.x * w;
    const cy = BASKET.y * h;
    const top = cy - bh * 0.5;
    // inside
    ctx.fillStyle = "#5a3a1a";
    ctx.beginPath();
    ctx.ellipse(cx, top, bw * 0.5, bh * 0.2, 0, 0, TAU);
    ctx.fill();
    // the latest fish peek out
    const n = Math.min(g.basket, g.basketCol.length);
    for (let j = 0; j < n; j++) {
      const col = g.basketCol[(g.basket - 1 - j + g.basketCol.length * 2) % g.basketCol.length];
      drawFish(ctx, cx + (j - (n - 1) / 2) * bw * 0.15, top - bh * 0.06 - (j & 1) * bh * 0.07, bw * 0.34, j & 1 ? -1 : 1, 0, col, false);
    }
    // front
    ctx.fillStyle = "#c98a4b";
    ctx.beginPath();
    ctx.moveTo(cx - bw * 0.5, top);
    ctx.lineTo(cx + bw * 0.5, top);
    ctx.lineTo(cx + bw * 0.4, cy + bh * 0.5);
    ctx.lineTo(cx - bw * 0.4, cy + bh * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#a8692e";
    ctx.lineWidth = Math.max(2, bw * 0.02);
    ctx.beginPath();
    ctx.moveTo(cx - bw * 0.46, cy - bh * 0.1);
    ctx.lineTo(cx + bw * 0.46, cy - bh * 0.1);
    ctx.moveTo(cx - bw * 0.43, cy + bh * 0.2);
    ctx.lineTo(cx + bw * 0.43, cy + bh * 0.2);
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(cx + i * bw * 0.2, top);
      ctx.lineTo(cx + i * bw * 0.16, cy + bh * 0.5);
    }
    ctx.stroke();
    ctx.lineWidth = Math.max(3, bw * 0.04);
    ctx.beginPath();
    ctx.ellipse(cx, top, bw * 0.5, bh * 0.2, 0, 0, Math.PI);
    ctx.stroke();
  }

  private badge(ctx: CanvasRenderingContext2D, k: KidSlot, s: number, now: number): void {
    const g = this.g;
    const h = this.h;
    const R = Math.max(14, k.headR);
    const n = g.catches[s];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (n > 0) {
      const bh = Math.max(26, h * 0.052);
      const bw = bh * 2.5;
      const x = k.pts.head.x;
      const y = Math.max(bh * 0.6, k.pts.head.y - R * 3.1);
      pillPath(ctx, x - bw / 2, y - bh / 2, bw, bh);
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = k.color;
      ctx.stroke();
      drawFish(ctx, x - bw * 0.26, y, bh * 0.62, 1, now * 0.01, (s * 3) % 8, false);
      ctx.font = this.fontCount;
      ctx.fillStyle = "#3a2a6b";
      ctx.fillText(COUNT_TXT[Math.min(n, 99)], x + bw * 0.17, y + 1);
    }
    // hint for children who cannot read: "pull!" hands while a fish bites, a rod while the line is free
    const ang = g.anglers[s];
    if (k.present && ang.state === ST.bite) {
      ctx.font = this.fontHint;
      ctx.fillStyle = "#000";
      ctx.fillText("🙌", k.pts.head.x + R * 2.6, k.pts.head.y - R * 1.2 - Math.abs(Math.sin(now * 0.01)) * R * 0.6);
    } else if (k.present && ang.state === ST.idle && ang.cool <= 0 && ang.idleT > 2.5) {
      ctx.font = this.fontHint;
      ctx.fillStyle = "#000";
      ctx.fillText("🎣", k.pts.head.x + R * 2.6, k.pts.head.y - R * 1.2 + Math.sin(now * 0.006) * R * 0.3);
    }
  }
}
