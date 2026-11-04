// The art of the five cartoon animals (quyon, ayiq, mushuk, kuchuk, baqa): heads, bodies, paws, feet and tails, drawn with plain canvas 2D
// paths and gradients. Nothing here is used per frame: avatar.ts renders every part ONCE into a small offscreen canvas (a "sprite", see
// avatar.ts) and then only draws images. All painters draw at exact pixel sizes around a local origin, with no transforms of their own,
// so the same code also works directly on any context (tests, a canvas that cannot make sprites).
//
// This file has no imports on purpose (the colours come in as strings).

export type AnimalId = "quyon" | "ayiq" | "mushuk" | "kuchuk" | "baqa";

/** index of an animal in every per-animal table */
export function animalIndex(id: AnimalId): number {
  switch (id) {
    case "quyon":
      return 0;
    case "ayiq":
      return 1;
    case "mushuk":
      return 2;
    case "kuchuk":
      return 3;
    default:
      return 4;
  }
}

/** 0 = calm, 1 = happy (open mouth), 2 = blink */
export type Mood = 0 | 1 | 2;

const TAU = Math.PI * 2;
const INK = "#33232a";

// ------------------------------------------------------------------------------------------------ colours

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` mixed with `b` (t = 0 -> a, 1 -> b), as "#rrggbb" */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = (i: number): string => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, "0");
  return `#${c(0)}${c(1)}${c(2)}`;
}
export const lighten = (c: string, t: number): string => mix(c, "#ffffff", t);
export const darken = (c: string, t: number): string => mix(c, "#2a1218", t);

export interface Pal {
  body: string;
  bodyHi: string;
  bodyLo: string;
  /** outline of the body and the limbs */
  line: string;
  head: string;
  headHi: string;
  headLo: string;
  headLine: string;
  inner: string;
  innerHi: string;
  innerLo: string;
}

/** The shades of one animal, from its three base colours (KidAnimal.body / head / inner). */
export function makePal(body: string, head: string, inner: string): Pal {
  return {
    body,
    bodyHi: lighten(body, 0.32),
    bodyLo: darken(body, 0.16),
    line: darken(body, 0.42),
    head,
    headHi: lighten(head, 0.38),
    headLo: darken(head, 0.12),
    headLine: darken(head, 0.4),
    inner,
    innerHi: lighten(inner, 0.4),
    innerLo: darken(inner, 0.14),
  };
}

// ------------------------------------------------------------------------------------------------ small helpers

/** radial gradient lit from the upper left; a plain colour when the context cannot make gradients */
function shade(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hi: string, lo: string): CanvasGradient | string {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.08, x, y, r * 1.1) as CanvasGradient | undefined;
  if (!g || typeof g.addColorStop !== "function") return lo;
  g.addColorStop(0, hi);
  g.addColorStop(1, lo);
  return g;
}

function ell(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string | CanvasGradient, line?: string, lw = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (line && lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = line;
    ctx.stroke();
  }
}

/** a lit ellipse with an outline */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, hi: string, lo: string, line: string, lw: number): void {
  ell(ctx, x, y, rx, ry, rot, shade(ctx, x, y, Math.max(rx, ry), hi, lo), line, lw);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

/** a soft rosy cheek */
function blush(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r) as CanvasGradient | undefined;
  if (!g || typeof g.addColorStop !== "function") {
    dot(ctx, x, y, r * 0.7, "rgba(255,110,140,.35)");
    return;
  }
  g.addColorStop(0, "rgba(255,105,135,.62)");
  g.addColorStop(1, "rgba(255,105,135,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** a pair of eyes (or closed eyes for a blink), centred on x, both `dx` away from it */
function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, r: number, mood: Mood): void {
  for (let s = -1; s <= 1; s += 2) {
    const ex = x + s * dx;
    if (mood === 2) {
      ctx.beginPath();
      ctx.arc(ex, y - r * 0.15, r * 0.95, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, r * 0.4);
      ctx.lineCap = "round";
      ctx.stroke();
    } else {
      ell(ctx, ex, y, r, r * 1.2, 0, INK);
      dot(ctx, ex - r * 0.32, y - r * 0.42, r * 0.4, "#ffffff");
      dot(ctx, ex + r * 0.38, y + r * 0.4, r * 0.18, "rgba(255,255,255,.8)");
    }
  }
}

/** open mouth: a half disc hanging from (x, y), with a tongue */
function openMouth(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, tongue: string): void {
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.arc(x, y, w, Math.PI, 0, true);
  ctx.quadraticCurveTo(x, y + w * 0.35, x - w, y);
  ctx.closePath();
  ctx.fillStyle = "#b8283f";
  ctx.fill();
  ell(ctx, x, y + w * 0.62, w * 0.5, w * 0.3, 0, tongue);
}

/** the "w" mouth of a cat / rabbit / bear / dog, hanging from the nose at (x, y) */
function smile(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lw: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + r * 0.7);
  ctx.moveTo(x, y + r * 0.7);
  ctx.arc(x - r, y + r * 0.7, r, 0, Math.PI);
  ctx.moveTo(x, y + r * 0.7);
  ctx.arc(x + r, y + r * 0.7, r, Math.PI, 0, true);
  ctx.stroke();
}

/** the head outline width */
const lw = (R: number): number => Math.max(1.2, R * 0.055);

// ------------------------------------------------------------------------------------------------ heads

/** Furthest reach of a head from its centre, in head radii (the sprite box): left/right, up, down. */
export const HEAD_BOX = { x: 1.5, up: 2.55, down: 1.15 } as const;

/** One head (ears included) centred on (cx, cy), radius R. */
export function paintHead(ctx: CanvasRenderingContext2D, a: number, p: Pal, cx: number, cy: number, R: number, mood: Mood): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (a) {
    case 0:
      headQuyon(ctx, p, cx, cy, R, mood);
      break;
    case 1:
      headAyiq(ctx, p, cx, cy, R, mood);
      break;
    case 2:
      headMushuk(ctx, p, cx, cy, R, mood);
      break;
    case 3:
      headKuchuk(ctx, p, cx, cy, R, mood);
      break;
    default:
      headBaqa(ctx, p, cx, cy, R, mood);
  }
}

function headQuyon(ctx: CanvasRenderingContext2D, p: Pal, cx: number, cy: number, R: number, mood: Mood): void {
  const w = lw(R);
  const rose = "#ff8fb0";
  for (let s = -1; s <= 1; s += 2) {
    const tilt = s * (s > 0 ? 0.3 : 0.14);
    const len = s > 0 ? 0.88 : 0.97;
    const ex = cx + s * R * 0.5;
    const ey = cy - R * (0.35 + len);
    blob(ctx, ex, ey, R * 0.29, R * len, tilt, p.headHi, p.headLo, p.headLine, w);
    ell(ctx, ex + s * R * 0.02, ey + R * 0.04, R * 0.16, R * len * 0.72, tilt, shade(ctx, ex, ey, R * 0.7, p.innerHi, p.inner));
  }
  blob(ctx, cx, cy, R * 1.03, R * 0.97, 0, p.headHi, p.headLo, p.headLine, w);
  blush(ctx, cx - R * 0.68, cy + R * 0.2, R * 0.26);
  blush(ctx, cx + R * 0.68, cy + R * 0.2, R * 0.26);
  ell(ctx, cx, cy + R * 0.3, R * 0.36, R * 0.27, 0, "rgba(255,200,215,.55)");
  eyes(ctx, cx, cy - R * 0.1, R * 0.4, R * 0.13, mood);
  // heart-shaped nose
  ell(ctx, cx, cy + R * 0.17, R * 0.095, R * 0.07, 0, rose, "#c25679", Math.max(1, R * 0.02));
  if (mood === 1) {
    openMouth(ctx, cx, cy + R * 0.3, R * 0.16, "#ff8fa8");
  } else {
    smile(ctx, cx, cy + R * 0.24, R * 0.09, Math.max(1.3, R * 0.045));
  }
  // two front teeth
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#c9a1ae";
  ctx.lineWidth = Math.max(1, R * 0.03);
  const ty = cy + R * (mood === 1 ? 0.3 : 0.42);
  for (let s = -1; s <= 1; s += 2) {
    ctx.beginPath();
    ctx.rect(cx + (s < 0 ? -R * 0.095 : R * 0.005), ty, R * 0.09, R * 0.12);
    ctx.fill();
    ctx.stroke();
  }
}

function headAyiq(ctx: CanvasRenderingContext2D, p: Pal, cx: number, cy: number, R: number, mood: Mood): void {
  const w = lw(R);
  for (let s = -1; s <= 1; s += 2) {
    const ex = cx + s * R * 0.76;
    const ey = cy - R * 0.76;
    blob(ctx, ex, ey, R * 0.37, R * 0.37, 0, p.head, p.headLo, p.headLine, w);
    ell(ctx, ex, ey + R * 0.03, R * 0.21, R * 0.2, 0, shade(ctx, ex, ey, R * 0.3, p.innerHi, p.inner));
  }
  blob(ctx, cx, cy, R * 1.04, R * 0.98, 0, p.headHi, p.headLo, p.headLine, w);
  blush(ctx, cx - R * 0.7, cy + R * 0.18, R * 0.24);
  blush(ctx, cx + R * 0.7, cy + R * 0.18, R * 0.24);
  // muzzle
  blob(ctx, cx, cy + R * 0.34, R * 0.47, R * 0.37, 0, p.innerHi, p.inner, p.innerLo, Math.max(1, R * 0.03));
  eyes(ctx, cx, cy - R * 0.14, R * 0.43, R * 0.1, mood);
  // nose
  ell(ctx, cx, cy + R * 0.2, R * 0.17, R * 0.115, 0, "#4a2f27");
  ell(ctx, cx - R * 0.06, cy + R * 0.16, R * 0.055, R * 0.025, -0.3, "rgba(255,255,255,.7)");
  if (mood === 1) openMouth(ctx, cx, cy + R * 0.36, R * 0.17, "#ff8fa0");
  else smile(ctx, cx, cy + R * 0.3, R * 0.1, Math.max(1.3, R * 0.045));
}

function headMushuk(ctx: CanvasRenderingContext2D, p: Pal, cx: number, cy: number, R: number, mood: Mood): void {
  const w = lw(R);
  const pinkEar = mix(p.inner, "#ff8fa3", 0.55);
  for (let s = -1; s <= 1; s += 2) {
    ctx.beginPath();
    ctx.moveTo(cx + s * R * 1.0, cy - R * 0.02);
    ctx.quadraticCurveTo(cx + s * R * 1.0, cy - R * 0.95, cx + s * R * 0.82, cy - R * 1.32);
    ctx.quadraticCurveTo(cx + s * R * 0.42, cy - R * 1.12, cx + s * R * 0.1, cy - R * 0.86);
    ctx.closePath();
    ctx.fillStyle = shade(ctx, cx + s * R * 0.7, cy - R * 0.8, R * 0.7, p.headHi, p.headLo);
    ctx.fill();
    ctx.lineWidth = w;
    ctx.strokeStyle = p.headLine;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * R * 0.86, cy - R * 0.28);
    ctx.quadraticCurveTo(cx + s * R * 0.88, cy - R * 0.78, cx + s * R * 0.76, cy - R * 1.04);
    ctx.quadraticCurveTo(cx + s * R * 0.5, cy - R * 0.9, cx + s * R * 0.3, cy - R * 0.72);
    ctx.closePath();
    ctx.fillStyle = pinkEar;
    ctx.fill();
  }
  blob(ctx, cx, cy, R * 1.06, R * 0.94, 0, p.headHi, p.headLo, p.headLine, w);
  // forehead stripes
  ctx.strokeStyle = darken(p.body, 0.18);
  ctx.lineWidth = Math.max(1.5, R * 0.07);
  ctx.beginPath();
  ctx.moveTo(cx, cy - R * 0.9);
  ctx.lineTo(cx, cy - R * 0.62);
  for (let s = -1; s <= 1; s += 2) {
    ctx.moveTo(cx + s * R * 0.24, cy - R * 0.88);
    ctx.lineTo(cx + s * R * 0.19, cy - R * 0.66);
  }
  ctx.stroke();
  blush(ctx, cx - R * 0.7, cy + R * 0.2, R * 0.24);
  blush(ctx, cx + R * 0.7, cy + R * 0.2, R * 0.24);
  // whiskers
  ctx.strokeStyle = "rgba(90,55,35,.55)";
  ctx.lineWidth = Math.max(1, R * 0.03);
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    ctx.moveTo(cx + s * R * 0.58, cy + R * 0.2);
    ctx.lineTo(cx + s * R * 1.22, cy + R * 0.1);
    ctx.moveTo(cx + s * R * 0.58, cy + R * 0.3);
    ctx.lineTo(cx + s * R * 1.22, cy + R * 0.34);
  }
  ctx.stroke();
  // muzzle
  ell(ctx, cx - R * 0.15, cy + R * 0.31, R * 0.21, R * 0.16, 0, "#fff6ea");
  ell(ctx, cx + R * 0.15, cy + R * 0.31, R * 0.21, R * 0.16, 0, "#fff6ea");
  eyes(ctx, cx, cy - R * 0.1, R * 0.4, R * 0.135, mood);
  // nose: a small pink triangle
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.09, cy + R * 0.17);
  ctx.lineTo(cx + R * 0.09, cy + R * 0.17);
  ctx.lineTo(cx, cy + R * 0.26);
  ctx.closePath();
  ctx.fillStyle = "#ff7d98";
  ctx.fill();
  if (mood === 1) openMouth(ctx, cx, cy + R * 0.34, R * 0.15, "#ff8fa8");
  else smile(ctx, cx, cy + R * 0.26, R * 0.09, Math.max(1.3, R * 0.04));
}

function headKuchuk(ctx: CanvasRenderingContext2D, p: Pal, cx: number, cy: number, R: number, mood: Mood): void {
  const w = lw(R);
  // floppy ears
  for (let s = -1; s <= 1; s += 2) blob(ctx, cx + s * R * 1.0, cy + R * 0.1, R * 0.3, R * 0.68, -s * 0.22, p.innerHi, p.innerLo, darken(p.inner, 0.4), w);
  blob(ctx, cx, cy, R * 1.0, R * 0.96, 0, p.headHi, p.headLo, p.headLine, w);
  // a brown patch round one eye
  ell(ctx, cx - R * 0.42, cy - R * 0.12, R * 0.3, R * 0.33, 0.3, shade(ctx, cx - R * 0.42, cy - R * 0.12, R * 0.3, p.innerHi, p.inner));
  blush(ctx, cx + R * 0.72, cy + R * 0.2, R * 0.22);
  // brow dots
  ell(ctx, cx - R * 0.4, cy - R * 0.42, R * 0.075, R * 0.045, 0, p.innerLo);
  ell(ctx, cx + R * 0.4, cy - R * 0.42, R * 0.075, R * 0.045, 0, p.inner);
  // muzzle
  blob(ctx, cx, cy + R * 0.34, R * 0.5, R * 0.38, 0, "#fffaf0", "#f6e6cc", p.headLine, Math.max(1, R * 0.025));
  eyes(ctx, cx, cy - R * 0.12, R * 0.4, R * 0.105, mood);
  ell(ctx, cx, cy + R * 0.16, R * 0.2, R * 0.14, 0, shade(ctx, cx, cy + R * 0.16, R * 0.2, "#6a5a63", "#2b1d22"));
  ell(ctx, cx - R * 0.07, cy + R * 0.11, R * 0.06, R * 0.03, -0.3, "rgba(255,255,255,.75)");
  if (mood === 1) openMouth(ctx, cx, cy + R * 0.36, R * 0.2, "#ff6f8a");
  else smile(ctx, cx, cy + R * 0.3, R * 0.12, Math.max(1.4, R * 0.045));
}

function headBaqa(ctx: CanvasRenderingContext2D, p: Pal, cx: number, cy: number, R: number, mood: Mood): void {
  const w = lw(R);
  // eye bumps first (the head covers their lower half)
  for (let s = -1; s <= 1; s += 2) blob(ctx, cx + s * R * 0.56, cy - R * 0.7, R * 0.4, R * 0.4, 0, p.headHi, p.headLo, p.headLine, w);
  blob(ctx, cx, cy + R * 0.05, R * 1.12, R * 0.88, 0, p.headHi, p.headLo, p.headLine, w);
  // lighter chin
  ell(ctx, cx, cy + R * 0.52, R * 0.72, R * 0.3, 0, "rgba(215,255,208,.5)");
  // spots
  dot(ctx, cx - R * 0.1, cy - R * 0.4, R * 0.06, "rgba(40,120,60,.28)");
  dot(ctx, cx + R * 0.15, cy - R * 0.5, R * 0.045, "rgba(40,120,60,.28)");
  dot(ctx, cx + R * 0.03, cy - R * 0.3, R * 0.035, "rgba(40,120,60,.28)");
  blush(ctx, cx - R * 0.78, cy + R * 0.27, R * 0.22);
  blush(ctx, cx + R * 0.78, cy + R * 0.27, R * 0.22);
  // big eyes
  for (let s = -1; s <= 1; s += 2) {
    const ex = cx + s * R * 0.56;
    const ey = cy - R * 0.72;
    if (mood === 2) {
      ctx.beginPath();
      ctx.arc(ex, ey, R * 0.22, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, R * 0.07);
      ctx.stroke();
    } else {
      dot(ctx, ex, ey, R * 0.29, "#ffffff");
      ctx.lineWidth = Math.max(1, R * 0.025);
      ctx.strokeStyle = p.headLine;
      ctx.stroke();
      ell(ctx, ex - s * R * 0.02, ey + R * 0.02, R * 0.15, R * 0.18, 0, INK);
      dot(ctx, ex - R * 0.06, ey - R * 0.05, R * 0.06, "#ffffff");
    }
  }
  dot(ctx, cx - R * 0.14, cy - R * 0.02, R * 0.035, "rgba(30,90,45,.7)");
  dot(ctx, cx + R * 0.14, cy - R * 0.02, R * 0.035, "rgba(30,90,45,.7)");
  if (mood === 1) {
    openMouth(ctx, cx, cy + R * 0.12, R * 0.5, "#ff7f98");
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy + R * 0.0, R * 0.6, 0.14 * Math.PI, 0.86 * Math.PI);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.6, R * 0.06);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------------------------------------ body, paws, feet, tails

/** Torso: an egg (narrow at the shoulders), centred on the origin, half sizes rx / ry. */
export function paintTorso(ctx: CanvasRenderingContext2D, a: number, p: Pal, rx: number, ry: number): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const w = Math.max(1.4, rx * 0.06);
  const egg = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, -ry);
    ctx.bezierCurveTo(rx * 0.62, -ry, rx, -ry * 0.4, rx, ry * 0.18);
    ctx.bezierCurveTo(rx, ry * 0.72, rx * 0.56, ry, 0, ry);
    ctx.bezierCurveTo(-rx * 0.56, ry, -rx, ry * 0.72, -rx, ry * 0.18);
    ctx.bezierCurveTo(-rx, -ry * 0.4, -rx * 0.62, -ry, 0, -ry);
    ctx.closePath();
  };
  egg();
  ctx.fillStyle = shade(ctx, 0, 0, Math.max(rx, ry * 0.8), p.bodyHi, p.bodyLo);
  ctx.fill();
  ctx.lineWidth = w;
  ctx.strokeStyle = p.line;
  ctx.stroke();
  // belly
  const belly = a === 1 ? p.inner : a === 2 ? p.inner : a === 4 ? p.inner : p.head;
  const bellyHi = a === 1 ? p.innerHi : a === 2 ? p.innerHi : a === 4 ? p.innerHi : p.headHi;
  ell(ctx, 0, ry * 0.2, rx * 0.56, ry * 0.58, 0, shade(ctx, 0, ry * 0.2, rx * 0.6, bellyHi, belly));
  if (a === 2) {
    // tabby stripes on the sides
    ctx.strokeStyle = darken(p.body, 0.2);
    ctx.lineWidth = Math.max(1.5, rx * 0.07);
    ctx.beginPath();
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 3; i++) {
        const y = -ry * 0.1 + i * ry * 0.3;
        ctx.moveTo(s * rx * 0.97, y);
        ctx.lineTo(s * rx * 0.74, y + ry * 0.05);
      }
    }
    ctx.stroke();
  } else if (a === 3) {
    // red collar with a golden tag
    ctx.beginPath();
    ctx.moveTo(-rx * 0.52, -ry * 0.78);
    ctx.quadraticCurveTo(0, -ry * 0.5, rx * 0.52, -ry * 0.78);
    ctx.strokeStyle = "#e5455a";
    ctx.lineWidth = Math.max(2, ry * 0.12);
    ctx.stroke();
    dot(ctx, 0, -ry * 0.56, Math.max(2, ry * 0.085), "#ffd23d");
  } else if (a === 4) {
    dot(ctx, -rx * 0.62, ry * 0.1, rx * 0.1, "rgba(30,110,50,.25)");
    dot(ctx, rx * 0.66, ry * 0.4, rx * 0.08, "rgba(30,110,50,.25)");
    dot(ctx, -rx * 0.5, ry * 0.58, rx * 0.07, "rgba(30,110,50,.25)");
  } else if (a === 0) {
    // little bow tie
    const by = -ry * 0.7;
    ctx.fillStyle = "#ff5c8a";
    ctx.beginPath();
    ctx.moveTo(0, by);
    ctx.lineTo(-rx * 0.24, by - ry * 0.1);
    ctx.lineTo(-rx * 0.24, by + ry * 0.1);
    ctx.closePath();
    ctx.moveTo(0, by);
    ctx.lineTo(rx * 0.24, by - ry * 0.1);
    ctx.lineTo(rx * 0.24, by + ry * 0.1);
    ctx.closePath();
    ctx.fill();
    dot(ctx, 0, by, Math.max(1.5, ry * 0.05), "#d93a6c");
  }
}

/** A hand (paw) of radius r, centred on the origin. */
export function paintPaw(ctx: CanvasRenderingContext2D, a: number, p: Pal, r: number): void {
  const w = Math.max(1.2, r * 0.1);
  if (a === 4) {
    // three round finger tips
    for (let i = -1; i <= 1; i++) blob(ctx, i * r * 0.56, -r * 0.78, r * 0.26, r * 0.26, 0, p.headHi, p.headLo, p.headLine, w);
  }
  blob(ctx, 0, 0, r, r, 0, p.headHi, p.headLo, p.headLine, w);
  if (a === 4) return;
  ell(ctx, 0, r * 0.25, r * 0.46, r * 0.36, 0, shade(ctx, 0, r * 0.25, r * 0.4, p.innerHi, p.inner));
  for (let i = -1; i <= 1; i++) dot(ctx, i * r * 0.36, -r * 0.2 - (i === 0 ? r * 0.1 : 0), r * 0.15, p.inner);
}

/** A foot of half width rx (half height 0.56 rx), centred on the origin. */
export function paintFoot(ctx: CanvasRenderingContext2D, a: number, p: Pal, rx: number): void {
  const ry = rx * 0.56;
  const w = Math.max(1.2, rx * 0.07);
  const fw = a === 4 ? 1.1 : 1;
  blob(ctx, 0, 0, rx * fw, ry, 0, p.headHi, p.headLo, p.headLine, w);
  for (let i = -1; i <= 1; i++) dot(ctx, i * rx * 0.45 * fw, ry * 0.4, rx * 0.13, a === 4 ? p.headLine : p.inner);
}

/** Longest reach of a tail from its root, in tail lengths: back, forward, up, down (the sprite box). */
export const TAIL_BOX = { back: 0.4, fwd: 1.6, up: 1.7, down: 0.5 } as const;

/** A tail rooted at the origin, pointing to +x / up. Frogs have none (draws nothing). */
export function paintTail(ctx: CanvasRenderingContext2D, a: number, p: Pal, L: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const w = Math.max(1.2, L * 0.07);
  switch (a) {
    case 0:
      blob(ctx, L * 0.5, -L * 0.05, L * 0.42, L * 0.42, 0, "#ffffff", p.headLo, p.headLine, w);
      break;
    case 1:
      blob(ctx, L * 0.38, 0, L * 0.34, L * 0.32, 0, p.bodyHi, p.bodyLo, p.line, w);
      break;
    case 2:
    case 3: {
      const cat = a === 2;
      const tw = L * (cat ? 0.36 : 0.32);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      if (cat) ctx.bezierCurveTo(L * 1.0, L * 0.15, L * 1.45, -L * 0.7, L * 0.95, -L * 1.4);
      else ctx.quadraticCurveTo(L * 0.9, -L * 0.1, L * 0.8, -L * 0.95);
      ctx.strokeStyle = cat ? p.line : darken(p.inner, 0.4);
      ctx.lineWidth = tw + w * 2;
      ctx.stroke();
      ctx.strokeStyle = cat ? p.body : p.inner;
      ctx.lineWidth = tw;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.28)";
      ctx.lineWidth = tw * 0.3;
      ctx.stroke();
      if (cat) {
        // pale tip
        dot(ctx, L * 0.95, -L * 1.4, tw * 0.52, p.headHi);
      }
      break;
    }
    default:
      break;
  }
}
