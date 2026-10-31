// 2D painter of "Hayvonlardek harakat": ONE big cartoon animal (about a third of the stage height, on the side where the
// children are fewest) that performs the move itself in time with `motionAt`, a name banner under it ("Quyoncha") and a
// green check above every child who did it. Nothing to read. Allocation-free per frame: the static parts of the animals
// live on cached canvases (art.ts), everything else is plain paths.

import { pillPath, type KidSlot } from "../bogcha/common";
import { type AnimalDef } from "./animals";
import { ACCENT, AnimalArt } from "./art";
import { motionAt, newMotion, type Motion } from "./motion";
import { ROUND_CFG, type Round } from "./round";

const TAU = Math.PI * 2;
/** seconds of the bouncy pop-in when an animal comes out */
const POP = 0.45;

const easeOutBack = (u: number): number => {
  const c1 = 1.9;
  const v = u - 1;
  return 1 + (c1 + 1) * v * v * v + c1 * v * v;
};

function check(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#2fcf5a";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
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

/** Praise: the animal cheers (happy hops, arms and flippers waving, ears flapping). */
function cheer(m: Motion, rt: number): void {
  const hop = Math.abs(Math.sin(rt * 9));
  m.dy = -0.12 * hop;
  m.rot = 0.12 * Math.sin(rt * 14);
  m.sx = m.sy = 1.05;
  m.arm = 0.65 + 0.3 * Math.sin(rt * 14);
  m.hands = 0.5 + 0.5 * Math.sin(rt * 18);
  m.crouch = 0;
  m.lift = hop;
  m.ear = 0.4 * Math.sin(rt * 12);
}

export class Painter {
  private art: AnimalArt;
  private mo = newMotion();
  /** the animal stands on the left (true) or the right of the stage; chosen once per animal */
  private left = true;
  private sideFor = -2;
  private fontPx = 0;
  private font = "";

  /** `cache=false` draws the animals as plain paths every frame (tests) */
  constructor(cache = true) {
    this.art = new AnimalArt(cache);
  }

  /** cached animal canvases built so far (tests / debug) */
  get builds(): number {
    return this.art.builds;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, round: Round, kids: readonly KidSlot[]): void {
    if (round.index < 0) return;
    const a = round.animal;
    const praise = round.phase === "praise";
    const R = Math.min(h * 0.17, w * 0.15);
    const pad = Math.max(12, h * 0.025);
    const half = R * 1.9; // the turtle is the widest animal
    if (this.sideFor !== round.index) {
      this.sideFor = round.index;
      this.left = this.pickSide(w, half + pad, kids, round.index);
    }
    const cx = this.left ? pad + half : w - pad - half;
    const gy = h * 0.84;
    this.animal(ctx, cx, gy, R, a, round, praise);
    this.banner(ctx, cx, gy + R * 0.12, h, a, round, praise);
    // a check above every child who did it
    const pulse = 1 + 0.12 * Math.sin(now / 140);
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (!k.active || !round.progress[k.slot].done) continue;
      const r = Math.max(20, k.headR * 0.8, h * 0.03) * pulse;
      check(ctx, k.pts.head.x, k.pts.head.y - k.headR * 2.3 - r * 0.4, r);
    }
  }

  /** the side whose animal spot is farther from every child (so the children stay visible); alternates in an empty room */
  private pickSide(w: number, edge: number, kids: readonly KidSlot[], index: number): boolean {
    let dl = 1e9;
    let dr = 1e9;
    let any = false;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (!k.active) continue;
      any = true;
      dl = Math.min(dl, Math.abs(k.center.x - edge));
      dr = Math.min(dr, Math.abs(k.center.x - (w - edge)));
    }
    return any ? dl >= dr : index % 2 === 0;
  }

  private animal(ctx: CanvasRenderingContext2D, cx: number, gy: number, R: number, a: AnimalDef, round: Round, praise: boolean): void {
    const m = motionAt(a.move, praise ? 0 : round.t, this.mo);
    if (praise) cheer(m, round.t);
    else if (round.t < POP) {
      const s = easeOutBack(round.t / POP);
      m.sx *= s;
      m.sy *= s;
    }
    // the feet stay on the ground line: only upward hops move the animal
    if (m.dy > 0) m.dy = 0;
    const up = Math.min(1, -m.dy / 0.25);
    // soft round backdrop (so the animal stands out of the camera picture) and the time ring of this challenge
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, gy - R, R * 1.12, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(cx, gy + R * 0.02, R * 0.85 * (1 - 0.35 * up), R * 0.1 * (1 - 0.3 * up), 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!praise) {
      const f = Math.max(0, 1 - round.t / ROUND_CFG.act);
      ctx.lineWidth = Math.max(6, R * 0.07);
      ctx.lineCap = "round";
      ctx.strokeStyle = f > 0.3 ? "#4fe069" : "#ffb13b";
      ctx.beginPath();
      ctx.arc(cx, gy - R, R * 1.12, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      ctx.stroke();
    }
    // looks towards the middle of the stage
    this.art.draw(ctx, a.id, cx, gy + m.dy * 2 * R, R, m, round.t, this.left ? 1 : -1);
  }

  /** the animal's name in a pill under it */
  private banner(ctx: CanvasRenderingContext2D, cx: number, top: number, h: number, a: AnimalDef, round: Round, praise: boolean): void {
    const px = Math.round(Math.max(22, h * 0.05));
    if (px !== this.fontPx) {
      this.fontPx = px;
      this.font = `800 ${px}px system-ui, "Segoe UI", sans-serif`;
    }
    const bw = a.name.length * px * 0.62 + px * 1.4;
    const bh = px * 1.5;
    ctx.globalAlpha = praise ? 1 : Math.min(1, round.t / 0.25);
    pillPath(ctx, cx - bw / 2, top, bw, bh);
    ctx.fillStyle = "rgba(255,255,255,.94)";
    ctx.fill();
    ctx.lineWidth = Math.max(3, px * 0.1);
    ctx.strokeStyle = ACCENT[a.id];
    ctx.stroke();
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ACCENT[a.id];
    ctx.fillText(a.name, cx, top + bh * 0.54);
    ctx.globalAlpha = 1;
  }
}
