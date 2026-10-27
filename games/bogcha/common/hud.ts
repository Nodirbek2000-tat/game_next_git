// Shared HUD for the kids games, drawn on the 2D overlay: ONE big star counter for the whole group (no lives, no losing,
// numbers are optional), a shrinking round-timer bar with a little sun, and the voice-prompt banner (big icon + text).

import type { Banner } from "./voice";

const TAU = Math.PI * 2;
const STAR_COS = new Float32Array(10);
const STAR_SIN = new Float32Array(10);
for (let i = 0; i < 10; i++) {
  STAR_COS[i] = Math.cos(-Math.PI / 2 + (i * Math.PI) / 5);
  STAR_SIN[i] = Math.sin(-Math.PI / 2 + (i * Math.PI) / 5);
}

/** 5-point star path (does not fill). */
export function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i & 1 ? R * 0.45 : R;
    const x = cx + STAR_COS[i] * r;
    const y = cy + STAR_SIN[i] * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Rounded bar path without ctx.roundRect (old browsers). */
export function pillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = Math.min(h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
}

export class KidsHud {
  /** group stars */
  stars = 0;
  /** 0..1 pop animation after a star */
  pulse = 0;
  /** remaining round time 0..1 */
  left = 1;
  private w = 0;
  private h = 0;
  private starText = "0";
  private fontNum = "";
  private fontIcon = "";
  private fontText = "";

  addStars(n: number): void {
    this.stars += n;
    this.starText = String(this.stars);
    this.pulse = 1;
  }

  reset(): void {
    this.stars = 0;
    this.starText = "0";
    this.pulse = 0;
    this.left = 1;
  }

  update(dt: number): void {
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3.2);
  }

  private layout(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const R = Math.max(26, h * 0.055);
    this.fontNum = `800 ${Math.round(R * 0.95)}px system-ui, "Segoe UI", sans-serif`;
    this.fontIcon = `${Math.round(h * 0.1)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    this.fontText = `800 ${Math.round(h * 0.055)}px system-ui, "Segoe UI", sans-serif`;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, banner?: Banner, showTimer = true): void {
    if (w !== this.w || h !== this.h) this.layout(w, h);
    const pad = Math.max(12, h * 0.025);
    const R = Math.max(26, h * 0.055);
    // ---- star badge + mini stars (one lap = 10 stars)
    const k = 1 + this.pulse * 0.28;
    const bx = pad + R;
    const by = pad + R;
    starPath(ctx, bx, by, R * k);
    ctx.fillStyle = "#ffd23d";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ff9f1c";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.font = this.fontNum;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#7a3b00";
    ctx.fillText(this.starText, bx, by + R * 0.12);
    const filled = this.stars === 0 ? 0 : ((this.stars - 1) % 10) + 1;
    const mr = R * 0.36;
    for (let i = 0; i < 10; i++) {
      starPath(ctx, bx + R * 1.5 + i * mr * 2.15, by, mr);
      ctx.fillStyle = i < filled ? "#ffd23d" : "rgba(255,255,255,.28)";
      ctx.fill();
    }
    // ---- round timer: a bar that shrinks, with a sun at its end
    if (showTimer) {
      const bw = Math.min(w * 0.3, 560);
      const bh = Math.max(12, h * 0.024);
      const x = w - pad - bw - R;
      const y = pad + R - bh / 2;
      pillPath(ctx, x, y, bw, bh);
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fill();
      const f = Math.max(0, Math.min(1, this.left));
      if (f > 0.01) {
        pillPath(ctx, x, y, Math.max(bh, bw * f), bh);
        ctx.fillStyle = f > 0.35 ? "#4fe069" : f > 0.15 ? "#ffb13b" : "#ff6b8a";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x + Math.max(bh, bw * f) - bh / 2, y + bh / 2, bh * 0.95, 0, TAU);
      ctx.fillStyle = "#ffe066";
      ctx.fill();
    }
    // ---- prompt banner
    if (banner && now < banner.until) {
      const a = Math.min(1, (banner.until - now) / 400);
      const bw = Math.min(w * 0.78, 980);
      const bh = Math.max(70, h * 0.15);
      const x = (w - bw) / 2;
      const y = pad + R * 2 + pad * 0.8;
      ctx.globalAlpha = a;
      pillPath(ctx, x, y, bw, bh);
      ctx.fillStyle = "rgba(255,255,255,.93)";
      ctx.fill();
      ctx.font = this.fontIcon;
      ctx.fillStyle = "#000";
      ctx.fillText(banner.icon, x + bh * 0.75, y + bh * 0.54);
      ctx.font = this.fontText;
      ctx.fillStyle = "#3a2a6b";
      ctx.fillText(banner.text, x + bh * 1.35 + (bw - bh * 1.5) / 2, y + bh * 0.52);
      ctx.globalAlpha = 1;
    }
  }
}
