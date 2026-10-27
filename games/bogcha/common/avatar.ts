// Cartoon animal avatars drawn on the engine's 2D overlay: each child becomes 🐰 🐻 🐱 🐶 🐸 over their own body
// (mirrored with the camera, because the kid slots are already in mirrored stage px). Plain 2D paths, ~30 canvas calls per
// child, no allocations, no gradients, no shadows, no images.

import type { KidSlot, KidPt } from "@/engine/tracking/kids";

const TAU = Math.PI * 2;
const SKIN_DARK = "#3b2a28";
const MIN_V = 0.25;

const ok = (p: KidPt): boolean => p.v >= MIN_V;

function limb(ctx: CanvasRenderingContext2D, a: KidPt, b: KidPt, c: KidPt | null, w: number): void {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  if (c && ok(b)) {
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
  } else if (c) ctx.lineTo(c.x, c.y);
  else ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function ears(ctx: CanvasRenderingContext2D, id: KidSlot["animal"]["id"], hx: number, hy: number, R: number, head: string, inner: string, body: string): void {
  for (let s = -1; s <= 1; s += 2) {
    switch (id) {
      case "quyon":
        ellipse(ctx, hx + s * R * 0.5, hy - R * 1.35, R * 0.3, R * 0.95, s * 0.18, head);
        ellipse(ctx, hx + s * R * 0.5, hy - R * 1.3, R * 0.15, R * 0.65, s * 0.18, inner);
        break;
      case "ayiq":
        circle(ctx, hx + s * R * 0.78, hy - R * 0.8, R * 0.4, head);
        circle(ctx, hx + s * R * 0.78, hy - R * 0.8, R * 0.2, inner);
        break;
      case "mushuk":
        ctx.fillStyle = head;
        ctx.beginPath();
        ctx.moveTo(hx + s * R * 0.98, hy - R * 0.1);
        ctx.lineTo(hx + s * R * 0.78, hy - R * 1.28);
        ctx.lineTo(hx + s * R * 0.15, hy - R * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = inner;
        ctx.beginPath();
        ctx.moveTo(hx + s * R * 0.8, hy - R * 0.35);
        ctx.lineTo(hx + s * R * 0.7, hy - R * 0.98);
        ctx.lineTo(hx + s * R * 0.35, hy - R * 0.78);
        ctx.closePath();
        ctx.fill();
        break;
      case "kuchuk":
        ellipse(ctx, hx + s * R * 1.0, hy + R * 0.05, R * 0.32, R * 0.7, s * 0.25, inner);
        break;
      case "baqa":
        circle(ctx, hx + s * R * 0.55, hy - R * 0.85, R * 0.42, head);
        break;
    }
  }
  void body;
}

function face(ctx: CanvasRenderingContext2D, k: KidSlot, hx: number, hy: number, R: number, open: boolean): void {
  const a = k.animal;
  if (a.id === "baqa") {
    // big eyes on the bumps
    for (let s = -1; s <= 1; s += 2) {
      circle(ctx, hx + s * R * 0.55, hy - R * 0.85, R * 0.3, "#ffffff");
      circle(ctx, hx + s * R * 0.55, hy - R * 0.83, R * 0.14, SKIN_DARK);
    }
  } else {
    for (let s = -1; s <= 1; s += 2) {
      circle(ctx, hx + s * R * 0.38, hy - R * 0.1, R * 0.15, SKIN_DARK);
      circle(ctx, hx + s * R * 0.34, hy - R * 0.15, R * 0.05, "#ffffff");
      circle(ctx, hx + s * R * 0.62, hy + R * 0.2, R * 0.14, "rgba(255,110,140,.45)");
    }
    ellipse(ctx, hx, hy + R * 0.17, R * 0.14, R * 0.1, 0, a.id === "ayiq" || a.id === "kuchuk" ? SKIN_DARK : "#ff7a9e");
  }
  const my = hy + R * (a.id === "baqa" ? 0.1 : 0.3);
  if (open) {
    ctx.fillStyle = "#c62f4f";
    ctx.beginPath();
    ctx.arc(hx, my, R * 0.26, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = SKIN_DARK;
    ctx.lineWidth = Math.max(2, R * 0.07);
    ctx.beginPath();
    ctx.arc(hx, my - R * 0.08, R * (a.id === "baqa" ? 0.55 : 0.26), 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
  }
  if (a.id === "mushuk") {
    ctx.strokeStyle = SKIN_DARK;
    ctx.lineWidth = Math.max(1.5, R * 0.04);
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      ctx.moveTo(hx + s * R * 0.35, hy + R * 0.2);
      ctx.lineTo(hx + s * R * 0.95, hy + R * 0.12);
      ctx.moveTo(hx + s * R * 0.35, hy + R * 0.3);
      ctx.lineTo(hx + s * R * 0.95, hy + R * 0.38);
    }
    ctx.stroke();
  }
}

/** Draws one child as a cartoon animal. `t` = performance.now() (ms), only used for the little idle blink. */
export function drawKid(ctx: CanvasRenderingContext2D, k: KidSlot, t = 0): void {
  const P = k.pts;
  const sc = Math.max(24, k.scale);
  const a = k.animal;
  const shOk = ok(P.ls) && ok(P.rs);
  const headOk = ok(P.head);
  if (!shOk && !headOk) return;
  const R = Math.max(14, k.headR * 1.35);
  // shoulders / hips (estimated when out of the picture)
  const sx = shOk ? (P.ls.x + P.rs.x) / 2 : P.head.x;
  const sy = shOk ? (P.ls.y + P.rs.y) / 2 : P.head.y + R * 1.5;
  const hipsOk = ok(P.lh) && ok(P.rh);
  const hx = hipsOk ? (P.lh.x + P.rh.x) / 2 : sx;
  const hy = hipsOk ? (P.lh.y + P.rh.y) / 2 : sy + sc * 1.7;
  const body = a.body;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // legs
  ctx.strokeStyle = body;
  if (hipsOk) {
    if (ok(P.lk)) limb(ctx, P.lh, P.lk, ok(P.la) ? P.la : null, sc * 0.4);
    if (ok(P.rk)) limb(ctx, P.rh, P.rk, ok(P.ra) ? P.ra : null, sc * 0.4);
    if (ok(P.la)) ellipse(ctx, P.la.x, P.la.y + sc * 0.08, sc * 0.36, sc * 0.2, 0, a.inner);
    if (ok(P.ra)) ellipse(ctx, P.ra.x, P.ra.y + sc * 0.08, sc * 0.36, sc * 0.2, 0, a.inner);
  }
  // torso blob + belly
  const phi = Math.atan2(hx - sx, hy - sy);
  const tcx = (sx + hx) / 2;
  const tcy = (sy + hy) / 2;
  const rx = Math.max(sc * 0.75, (shOk ? Math.abs(P.ls.x - P.rs.x) : sc) * 0.62);
  const ry = Math.abs(hy - sy) * 0.58 + sc * 0.3;
  ellipse(ctx, tcx, tcy, rx, ry, -phi, body);
  ellipse(ctx, tcx, tcy + ry * 0.1, rx * 0.55, ry * 0.55, -phi, a.head);
  // arms
  ctx.strokeStyle = body;
  if (shOk) {
    if (ok(P.lw)) limb(ctx, P.ls, P.le, P.lw, sc * 0.34);
    if (ok(P.rw)) limb(ctx, P.rs, P.re, P.rw, sc * 0.34);
  }
  // head: ears behind, then the face
  const cx = headOk ? P.head.x : sx;
  const cy = (headOk ? P.head.y : sy - R * 1.4) - R * 0.12;
  ears(ctx, a.id, cx, cy, R, a.head, a.inner, body);
  circle(ctx, cx, cy, R, a.head);
  const sg = k.signals;
  const blink = (t % 3200) < 110;
  if (blink && a.id !== "baqa") {
    // closed eyes for a moment: skip the open-eye drawing by painting the face over a thin line
    face(ctx, k, cx, cy, R, sg.jump || sg.clap || sg.handsUp);
    ctx.strokeStyle = a.head;
    ctx.lineWidth = R * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.55, cy - R * 0.12);
    ctx.lineTo(cx - R * 0.2, cy - R * 0.12);
    ctx.moveTo(cx + R * 0.2, cy - R * 0.12);
    ctx.lineTo(cx + R * 0.55, cy - R * 0.12);
    ctx.stroke();
  } else face(ctx, k, cx, cy, R, sg.jump || sg.clap || sg.handsUp);
  // paws follow the wrists
  if (ok(P.lw)) paw(ctx, P.lw, sc, a.head, a.inner);
  if (ok(P.rw)) paw(ctx, P.rw, sc, a.head, a.inner);
}

function paw(ctx: CanvasRenderingContext2D, w: KidPt, sc: number, head: string, inner: string): void {
  circle(ctx, w.x, w.y, sc * 0.3, head);
  circle(ctx, w.x, w.y + sc * 0.05, sc * 0.14, inner);
}

/** Draws every child who is on screen. */
export function drawKids(ctx: CanvasRenderingContext2D, kids: readonly KidSlot[], t = 0): void {
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.active && k.present) drawKid(ctx, k, t);
  }
}
