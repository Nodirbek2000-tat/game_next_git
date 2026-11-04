// Cartoon animal avatars drawn on the engine's 2D overlay: each child becomes 🐰 🐻 🐱 🐶 🐸 over their own body
// (mirrored with the camera, because the kid slots are already in mirrored stage px).
//
// The art lives in animals.ts. It is heavy to paint (gradients, outlines, ~100 canvas calls per head), so every static part -
// head (calm / happy / blink), torso, paw, foot, tail - is rendered ONCE per animal and size bucket into a small offscreen canvas
// ("sprite") and then only drawn with `drawImage` (scaled / rotated). Per frame a child costs ~15 draw calls + 4 stroked limbs, nothing
// is allocated, no shadows / filters. Without a real canvas (tests, a mocked context) the same painters draw straight onto the context.
//
// Every ACTIVE slot is drawn: a child who is lost for a moment (`present` false, up to ~2 s) glides to a stop and fades out; a far / tiny child gets a minimum avatar size (`minScaleFor`) and a small name tag, so the animal is always readable.

import type { KidSlot, KidPt } from "@/engine/tracking/kids";
import { HEAD_BOX, TAIL_BOX, animalIndex, makePal, paintFoot, paintHead, paintPaw, paintTail, paintTorso, type Mood, type Pal } from "./animals";
import { pillPath } from "./hud";

/** limbs are drawn when the landmark is seen at least this well (far children have low visibility) */
const MIN_V = 0.2;
/** head / shoulders only decide where the body is: even a poorly seen one is better than nothing */
const TORSO_V = 0.08;

const ok = (p: KidPt): boolean => p.v >= MIN_V;
const seen = (p: KidPt): boolean => p.v >= TORSO_V;

/** Smallest shoulder width (px) an avatar is drawn with: a child standing far away still gets a clear animal. */
export const minScaleFor = (stageH: number): number => Math.max(30, stageH * 0.06);

/**
 * alpha of a child who is lost for a moment, by `goneFor` (seconds since `present` turned false, whatever the hold time was): fades
 * from 0.85 to 0.2 over the next second, so a child who really left does not stand there as a frozen animal, and the fade never jumps.
 * (A shorter miss keeps full alpha.)
 */
export const lostAlpha = (goneFor: number): number => Math.min(0.85, Math.max(0.2, 0.85 - goneFor * 0.65));

// ------------------------------------------------------------------------------------------------ sprites

interface Sprite {
  c: CanvasImageSource;
  /** size of the sprite in px and the position of its origin in it */
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** the nominal size it was painted for (a head: radius) */
  base: number;
}

type CanvasFactory = (w: number, h: number) => HTMLCanvasElement | null;
let factory: CanvasFactory | null = null;

/** sprite sizes (px: head radius / torso half width / paw radius / foot half width / tail length); a part uses the smallest one that is big enough */
const BUCKETS = [12, 16, 21, 28, 38, 52, 70, 96] as const;
const NB = BUCKETS.length;
/** sprite slots per animal: head calm / happy / blink, torso, paw, foot, tail */
const S_HEAD = 0;
const S_TORSO = 3;
const S_PAW = 4;
const S_FOOT = 5;
const S_TAIL = 6;
const NS = 7;
const sprites: (Sprite | null | undefined)[] = new Array<Sprite | null | undefined>(5 * NS * NB).fill(undefined);
/** how many sprites exist (tests: it must stay constant while a scene is drawn) */
let spriteCount = 0;
const pals: (Pal | undefined)[] = [undefined, undefined, undefined, undefined, undefined];

const bucketOf = (v: number): number => {
  for (let i = 0; i < NB; i++) if (BUCKETS[i] >= v) return i;
  return NB - 1;
};

function palOf(k: KidSlot, a: number): Pal {
  let p = pals[a];
  if (!p) {
    p = makePal(k.animal.body, k.animal.head, k.animal.inner);
    pals[a] = p;
  }
  return p;
}

/** Tests: make sprites on a fake canvas (or `null`: back to "real canvas only"). */
export function setSpriteFactory(f: CanvasFactory | null): void {
  factory = f;
  clearAvatarSprites();
}

export function clearAvatarSprites(): void {
  sprites.fill(undefined);
  pals.fill(undefined);
  spriteCount = 0;
}

export const avatarSpriteCount = (): number => spriteCount;

/** True when `ctx` draws on a real canvas element (a mocked context has none) or sprites are made by a test factory. */
function canSprite(ctx: CanvasRenderingContext2D): boolean {
  if (factory) return true;
  return typeof HTMLCanvasElement !== "undefined" && ctx.canvas instanceof HTMLCanvasElement;
}

function newCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (factory) return factory(w, h);
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** The sprite of one part (made on first use), or null when no canvas can be made (then the part is drawn directly). */
function sprite(slot: number, a: number, b: number, pal: Pal): Sprite | null {
  const idx = (a * NS + slot) * NB + b;
  const have = sprites[idx];
  if (have !== undefined) return have;
  const B = BUCKETS[b];
  const pad = 3;
  let w: number;
  let h: number;
  let ox: number;
  let oy: number;
  if (slot < S_TORSO) {
    w = Math.ceil(B * HEAD_BOX.x * 2) + pad * 2;
    h = Math.ceil(B * (HEAD_BOX.up + HEAD_BOX.down)) + pad * 2;
    ox = w / 2;
    oy = B * HEAD_BOX.up + pad;
  } else if (slot === S_TORSO) {
    w = Math.ceil(B * 2) + pad * 2;
    h = Math.ceil(B * 2.7) + pad * 2;
    ox = w / 2;
    oy = h / 2;
  } else if (slot === S_PAW) {
    w = h = Math.ceil(B * 2.9) + pad * 2;
    ox = oy = w / 2;
  } else if (slot === S_FOOT) {
    w = Math.ceil(B * 2.4) + pad * 2;
    h = Math.ceil(B * 1.5) + pad * 2;
    ox = w / 2;
    oy = h / 2;
  } else {
    w = Math.ceil(B * (TAIL_BOX.back + TAIL_BOX.fwd)) + pad * 2;
    h = Math.ceil(B * (TAIL_BOX.up + TAIL_BOX.down)) + pad * 2;
    ox = B * TAIL_BOX.back + pad;
    oy = B * TAIL_BOX.up + pad;
  }
  const c = newCanvas(w, h);
  const x = c?.getContext("2d") ?? null;
  if (!c || !x) {
    sprites[idx] = null;
    return null;
  }
  x.save();
  x.translate(ox, oy);
  if (slot < S_TORSO) paintHead(x, a, pal, 0, 0, B, slot as Mood);
  else if (slot === S_TORSO) paintTorso(x, a, pal, B, B * 1.35);
  else if (slot === S_PAW) paintPaw(x, a, pal, B);
  else if (slot === S_FOOT) paintFoot(x, a, pal, B);
  else paintTail(x, a, pal, B);
  x.restore();
  const s: Sprite = { c, w, h, ox, oy, base: B };
  sprites[idx] = s;
  spriteCount++;
  return s;
}

// ------------------------------------------------------------------------------------------------ parts

function limb(ctx: CanvasRenderingContext2D, a: KidPt, b: KidPt, c: KidPt | null, w: number, pal: Pal): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  if (c && ok(b)) {
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
  } else if (c) ctx.lineTo(c.x, c.y);
  else ctx.lineTo(b.x, b.y);
  ctx.lineWidth = w + Math.max(2, w * 0.16);
  ctx.strokeStyle = pal.line;
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = pal.body;
  ctx.stroke();
  ctx.lineWidth = w * 0.3;
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.stroke();
}

/** Draws a head centred on (x, y), radius R. */
function head(ctx: CanvasRenderingContext2D, a: number, pal: Pal, x: number, y: number, R: number, mood: Mood, real: boolean): void {
  const s = real ? sprite(S_HEAD + mood, a, bucketOf(R), pal) : null;
  if (s) {
    const k = R / s.base;
    ctx.drawImage(s.c, x - s.ox * k, y - s.oy * k, s.w * k, s.h * k);
  } else paintHead(ctx, a, pal, x, y, R, mood);
}

function torso(ctx: CanvasRenderingContext2D, a: number, pal: Pal, x: number, y: number, rx: number, ry: number, phi: number, real: boolean): void {
  const s = real ? sprite(S_TORSO, a, bucketOf(rx), pal) : null;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-phi);
  if (s) ctx.drawImage(s.c, (-s.ox * rx) / s.base, (-s.oy * ry) / (s.base * 1.35), (s.w * rx) / s.base, (s.h * ry) / (s.base * 1.35));
  else paintTorso(ctx, a, pal, rx, ry);
  ctx.restore();
}

function paw(ctx: CanvasRenderingContext2D, a: number, pal: Pal, x: number, y: number, r: number, real: boolean): void {
  const s = real ? sprite(S_PAW, a, bucketOf(r), pal) : null;
  if (s) {
    const k = r / s.base;
    ctx.drawImage(s.c, x - s.ox * k, y - s.oy * k, s.w * k, s.h * k);
  } else {
    ctx.save();
    ctx.translate(x, y);
    paintPaw(ctx, a, pal, r);
    ctx.restore();
  }
}

function foot(ctx: CanvasRenderingContext2D, a: number, pal: Pal, x: number, y: number, rx: number, real: boolean): void {
  const s = real ? sprite(S_FOOT, a, bucketOf(rx), pal) : null;
  if (s) {
    const k = rx / s.base;
    ctx.drawImage(s.c, x - s.ox * k, y - s.oy * k, s.w * k, s.h * k);
  } else {
    ctx.save();
    ctx.translate(x, y);
    paintFoot(ctx, a, pal, rx);
    ctx.restore();
  }
}

/** Tail rooted at (x, y), turned by `ang`, on the side `side` (-1 left, 1 right). The frog has none. */
function tail(ctx: CanvasRenderingContext2D, a: number, pal: Pal, x: number, y: number, L: number, side: number, ang: number, real: boolean): void {
  if (a === 4) return;
  const s = real ? sprite(S_TAIL, a, bucketOf(L), pal) : null;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang * side);
  ctx.scale(side, 1);
  if (s) {
    const k = L / s.base;
    ctx.drawImage(s.c, -s.ox * k, -s.oy * k, s.w * k, s.h * k);
  } else paintTail(ctx, a, pal, L);
  ctx.restore();
}

/** tail wag: which side the tail sticks out, how fast and how far it swings (rabbit / bear: no wag) */
const TAIL_SIDE = [1, 1, -1, 1, 1] as const;
const TAIL_WAG = [0, 0, 0.16, 0.42, 0] as const;
const TAIL_RATE = [0, 0, 0.0022, 0.011, 0] as const;

/**
 * Draws one child as a cartoon animal. `t` = performance.now() (ms), only used for the idle blink and the tail.
 * `minScale`: minimum shoulder width in px (see `minScaleFor`), so small / far children keep a readable avatar.
 */
export function drawKid(ctx: CanvasRenderingContext2D, k: KidSlot, t = 0, minScale = 0): void {
  const P = k.pts;
  const sc = Math.max(24, k.scale, minScale);
  const an = k.animal;
  const ai = animalIndex(an.id);
  const pal = palOf(k, ai);
  const real = canSprite(ctx);
  const shOk = seen(P.ls) && seen(P.rs);
  const headOk = seen(P.head);
  const R = Math.max(14, k.headR * 1.35, minScale * 0.62);
  // shoulders / hips (estimated when out of the picture); without head and shoulders the body centre places the child
  const sx = shOk ? (P.ls.x + P.rs.x) / 2 : headOk ? P.head.x : k.center.x;
  const sy = shOk ? (P.ls.y + P.rs.y) / 2 : headOk ? P.head.y + R * 1.5 : k.center.y - sc * 0.4;
  const hipsOk = ok(P.lh) && ok(P.rh);
  const hx = hipsOk ? (P.lh.x + P.rh.x) / 2 : sx;
  const hy = hipsOk ? (P.lh.y + P.rh.y) / 2 : sy + sc * 1.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const phi = Math.atan2(hx - sx, hy - sy);
  const tcx = (sx + hx) / 2;
  const tcy = (sy + hy) / 2;
  const rx = Math.max(sc * 0.75, (shOk ? Math.abs(P.ls.x - P.rs.x) : sc) * 0.62);
  const ry = Math.abs(hy - sy) * 0.58 + sc * 0.3;
  // tail (behind everything)
  const side = TAIL_SIDE[ai];
  tail(ctx, ai, pal, hx + side * rx * 0.55, hy + ry * 0.12, sc * 0.55, side, TAIL_WAG[ai] * Math.sin(t * TAIL_RATE[ai] + k.slot * 1.7), real);
  // legs
  if (hipsOk) {
    if (ok(P.lk)) limb(ctx, P.lh, P.lk, ok(P.la) ? P.la : null, sc * 0.4, pal);
    if (ok(P.rk)) limb(ctx, P.rh, P.rk, ok(P.ra) ? P.ra : null, sc * 0.4, pal);
    if (ok(P.la)) foot(ctx, ai, pal, P.la.x, P.la.y + sc * 0.08, sc * 0.38, real);
    if (ok(P.ra)) foot(ctx, ai, pal, P.ra.x, P.ra.y + sc * 0.08, sc * 0.38, real);
  }
  // torso with belly
  torso(ctx, ai, pal, tcx, tcy, rx, ry, phi, real);
  // arms
  if (shOk) {
    if (ok(P.lw)) limb(ctx, P.ls, P.le, P.lw, sc * 0.34, pal);
    if (ok(P.rw)) limb(ctx, P.rs, P.re, P.rw, sc * 0.34, pal);
  }
  // head: ears are part of the sprite
  const cx = headOk ? P.head.x : sx;
  const cy = (headOk ? P.head.y : sy - R * 1.4) - R * 0.12;
  const sg = k.signals;
  const happy = sg.jump || sg.clap || sg.handsUp || sg.wave;
  const blink = (t % 3200) < 110;
  head(ctx, ai, pal, cx, cy, R, happy ? 1 : blink ? 2 : 0, real);
  // paws follow the wrists
  if (ok(P.lw)) paw(ctx, ai, pal, P.lw.x, P.lw.y, sc * 0.3, real);
  if (ok(P.rw)) paw(ctx, ai, pal, P.rw.x, P.rw.y, sc * 0.3, real);
}

/** Name tag under the child: colour + name of the animal ("quyoncha"). The width is estimated, nothing is measured. */
function nameTag(ctx: CanvasRenderingContext2D, k: KidSlot, stageH: number, stageW: number): void {
  const fs = Math.min(30, Math.max(16, stageH * 0.034));
  const name = k.animal.name;
  const w = name.length * fs * 0.58 + fs * 1.2;
  const h = fs * 1.5;
  const P = k.pts;
  const sc = Math.max(24, k.scale, minScaleFor(stageH));
  const x = Math.min(Math.max(k.center.x, w / 2 + 4), Math.max(w / 2 + 4, stageW - w / 2 - 4));
  // below the hips; when that is off the screen, just above the bottom edge
  const hipsY = ok(P.lh) && ok(P.rh) ? (P.lh.y + P.rh.y) / 2 : (seen(P.ls) ? P.ls.y : k.center.y) + sc * 1.7;
  const y = Math.min(hipsY + sc * 0.9, stageH - h * 0.8);
  pillPath(ctx, x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = k.color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.font = `800 ${Math.round(fs)}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#3a2a2a";
  ctx.fillText(name, x, y + 1);
}

/**
 * Draws every ACTIVE child (also while `present` is false for a moment: faded, at the last position).
 * `stageH` > 0 turns on the minimum avatar size and the name tag of new / far children (`stageW` keeps the tag on screen).
 */
export function drawKids(ctx: CanvasRenderingContext2D, kids: readonly KidSlot[], t = 0, stageH = 0, stageW = 0): void {
  const minScale = stageH > 0 ? minScaleFor(stageH) : 0;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (!k.active) continue;
    const faded = !k.present;
    if (faded) ctx.globalAlpha = lostAlpha(k.goneFor);
    drawKid(ctx, k, t, minScale);
    // new children and small / far ones get a name tag, so everybody knows which animal is theirs
    if (stageH > 0 && (k.seenFor < 5 || k.scale < minScale * 1.4)) nameTag(ctx, k, stageH, stageW || 1e5);
    if (faded) ctx.globalAlpha = 1;
  }
}
