// 2D painter of "Hayvonlardek harakat": the big animal (left) that does the move, a stick-figure pictogram of the move
// (right) and a green check above every child who did it. Nothing to read. Allocation-free per frame: the animal emoji are
// rendered once into small cached canvases (cheap drawImage on weak PCs), all other shapes are plain paths.

import type { KidSlot } from "../bogcha/common";
import { type AnimalDef } from "./animals";
import { motionAt, newMotion, type Motion } from "./motion";
import { ROUND_CFG, type Round } from "./round";

const TAU = Math.PI * 2;
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

interface Sprite {
  c: HTMLCanvasElement;
  px: number;
}

/** Emoji -> small canvas, rebuilt only when the stage size changes noticeably. */
export class SpriteCache {
  private m = new Map<string, Sprite>();

  constructor(private enabled = true) {}

  get(emoji: string, size: number): CanvasImageSource | null {
    if (!this.enabled || typeof document === "undefined") return null;
    const px = Math.max(64, Math.ceil(size / 32) * 32);
    const hit = this.m.get(emoji);
    if (hit && hit.px === px) return hit.c;
    const c = hit?.c ?? document.createElement("canvas");
    c.width = px;
    c.height = px;
    const x = c.getContext("2d");
    if (!x) return null;
    x.clearRect(0, 0, px, px);
    x.font = `${Math.round(px * 0.8)}px ${EMOJI_FONT}`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(emoji, px / 2, px / 2 + px * 0.04);
    this.m.set(emoji, { c, px });
    return c;
  }
}

const easeOutBack = (u: number): number => {
  const c1 = 1.9;
  const v = u - 1;
  return 1 + (c1 + 1) * v * v * v + c1 * v * v;
};

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Little stick figure doing the move. `S` = figure height. */
function figure(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, m: Motion): void {
  const baseY = cy + S * 0.5 - m.lift * S * 0.22;
  const hipY = baseY - S * (0.4 - 0.18 * m.crouch);
  const shY = hipY - S * (0.28 - 0.06 * m.crouch);
  const headR = S * 0.12;
  const headY = shY - S * 0.04 - headR;
  const kneeSpread = S * (0.1 + 0.16 * m.crouch);
  const lw = Math.max(4, S * 0.07);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#3a2a6b";
  ctx.lineWidth = lw;
  ctx.beginPath();
  // spine
  ctx.moveTo(cx, shY);
  ctx.lineTo(cx, hipY);
  // legs: hip -> knee -> foot
  const kneeY = (hipY + baseY) / 2;
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx - kneeSpread, kneeY);
  ctx.lineTo(cx - S * 0.12, baseY);
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx + kneeSpread, kneeY);
  ctx.lineTo(cx + S * 0.12, baseY);
  // arms
  const armLen = S * 0.3;
  if (m.hands >= 0) {
    const hx = S * (0.04 + 0.2 * m.hands);
    const hy = shY + S * 0.1;
    ctx.moveTo(cx - S * 0.02, shY);
    ctx.lineTo(cx - hx, hy);
    ctx.moveTo(cx + S * 0.02, shY);
    ctx.lineTo(cx + hx, hy);
  } else {
    const th = m.arm * Math.PI;
    const ax = Math.sin(th) * armLen;
    const ay = Math.cos(th) * armLen;
    ctx.moveTo(cx, shY);
    ctx.lineTo(cx - ax, shY + ay);
    ctx.moveTo(cx, shY);
    ctx.lineTo(cx + ax, shY + ay);
  }
  ctx.stroke();
  // head
  ctx.fillStyle = "#ffcf5c";
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, TAU);
  ctx.fill();
  ctx.lineWidth = Math.max(3, S * 0.04);
  ctx.stroke();
}

/** dir -1 = pointing up, 1 = pointing down */
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dir: -1 | 1): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ff7a3d";
  ctx.fillStyle = "#ff7a3d";
  ctx.lineWidth = Math.max(5, size * 0.28);
  ctx.beginPath();
  ctx.moveTo(x, y - dir * size * 0.5);
  ctx.lineTo(x, y + dir * size * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + dir * size);
  ctx.lineTo(x - size * 0.55, y + dir * size * 0.25);
  ctx.lineTo(x + size * 0.55, y + dir * size * 0.25);
  ctx.closePath();
  ctx.fill();
}

function check(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  disc(ctx, x, y, r, "#2fcf5a", 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(4, r * 0.28);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.45, y + r * 0.02);
  ctx.lineTo(x - r * 0.1, y + r * 0.38);
  ctx.lineTo(x + r * 0.48, y - r * 0.32);
  ctx.stroke();
}

export class Painter {
  private sprites: SpriteCache;
  private mo = newMotion();
  private fig = newMotion();

  constructor(useSprites = true) {
    this.sprites = new SpriteCache(useSprites);
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, round: Round, kids: readonly KidSlot[]): void {
    if (round.index < 0) return;
    const a = round.animal;
    const praise = round.phase === "praise";
    const t = now / 1000;
    const S = Math.min(h * 0.26, w * 0.22);
    const pad = Math.max(12, h * 0.025);
    const cy = h * 0.34 + S * 0.62;
    this.animalPanel(ctx, pad + S * 0.62, cy, S, t, a, round, praise);
    this.figurePanel(ctx, w - pad - S * 0.62, cy, S, t, a);
    // a check above every child who did it
    const pulse = 1 + 0.12 * Math.sin(now / 140);
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (!k.active || !k.present || !round.progress[k.slot].done) continue;
      const r = Math.max(20, k.headR * 0.8) * pulse;
      check(ctx, k.pts.head.x, k.pts.head.y - k.headR * 2.3 - r * 0.4, r);
    }
  }

  private animalPanel(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, t: number, a: AnimalDef, round: Round, praise: boolean): void {
    disc(ctx, cx, cy, S * 0.62, "#ffffff", 0.88);
    if (!praise) {
      // time left of this challenge: a ring that unwinds
      const f = Math.max(0, 1 - round.t / ROUND_CFG.act);
      ctx.lineWidth = Math.max(6, S * 0.05);
      ctx.lineCap = "round";
      ctx.strokeStyle = f > 0.3 ? "#4fe069" : "#ffb13b";
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.62, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      ctx.stroke();
    }
    const m = motionAt(a.move, t, this.mo);
    let dy = m.dy;
    let rot = m.rot;
    let sx = m.sx;
    let sy = m.sy;
    if (praise) {
      // cheering: happy hops
      dy = -0.12 * Math.abs(Math.sin(round.t * 9));
      rot = 0.12 * Math.sin(round.t * 14);
      sx = sy = 1.05;
    } else if (round.t < 0.45) {
      // pop in
      const s = easeOutBack(round.t / 0.45);
      sx *= s;
      sy *= s;
    }
    const size = S * 0.95;
    ctx.save();
    ctx.translate(cx, cy + dy * size);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    const img = this.sprites.get(a.emoji, size);
    if (img) ctx.drawImage(img, -size / 2, -size / 2, size, size);
    else {
      ctx.font = `${Math.round(size * 0.8)}px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#000";
      ctx.fillText(a.emoji, 0, size * 0.04);
    }
    ctx.restore();
  }

  private figurePanel(ctx: CanvasRenderingContext2D, cx: number, cy: number, S: number, t: number, a: AnimalDef): void {
    disc(ctx, cx, cy, S * 0.62, "#ffffff", 0.88);
    const m = motionAt(a.move, t, this.fig);
    figure(ctx, cx - S * 0.06, cy - S * 0.02, S * 0.9, m);
    if (m.arrow !== 0) {
      const bob = Math.sin(t * 7) * S * 0.03;
      arrow(ctx, cx + S * 0.38, cy + bob * m.arrow, S * 0.15, m.arrow);
    }
  }
}
