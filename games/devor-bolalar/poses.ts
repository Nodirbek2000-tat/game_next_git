// "Devordan o‘tamiz": the five poses (the silhouette in the wall) and the generous matching of a child's body against them.
// Pure functions of the kit's key points (stage px, `scale` = shoulder width) and signals; allocation-free.
//
// An arm is described by the direction shoulder -> wrist, measured from "straight down" (0) through "out sideways" (90) to
// "straight up" (180), `outward` being away from the body. The matching tolerance is wide (children, noisy tracking): a score
// of 1 inside +-35 degrees, falling to 0 at 75; a pose "matches" from score 0.5 (= about +-55 degrees).

export type PoseId = "handsUp" | "armsOut" | "star" | "squat" | "oneHand";

export interface PoseDef {
  id: PoseId;
  /** id in the kit's PROMPTS table (registered by registerPrompts) */
  promptId: string;
  text: string;
  icon: string;
  /** target direction of the two arms (degrees from straight down; the pictogram shows arms[0] on the left of the picture) */
  arms: readonly [number, number];
  /** 0 = legs together, 1 = wide apart (star) */
  spread: number;
  squat: boolean;
}

export const POSES: readonly PoseDef[] = [
  { id: "handsUp", promptId: "dv-handsUp", text: "Qo‘llarni tepaga!", icon: "🙌", arms: [176, 176], spread: 0.1, squat: false },
  { id: "armsOut", promptId: "dv-armsOut", text: "Qo‘llarni yoying!", icon: "🦅", arms: [90, 90], spread: 0.1, squat: false },
  { id: "star", promptId: "dv-star", text: "Yulduz bo‘ling!", icon: "⭐", arms: [135, 135], spread: 1, squat: false },
  { id: "squat", promptId: "dv-squat", text: "O‘tirib oling!", icon: "🐣", arms: [55, 55], spread: 0.6, squat: true },
  { id: "oneHand", promptId: "dv-oneHand", text: "Bitta qo‘lni ko‘taring!", icon: "🙋", arms: [176, 8], spread: 0.1, squat: false },
];

export const POSE_IDS: readonly PoseId[] = POSES.map((p) => p.id);

export function poseById(id: PoseId): PoseDef {
  for (let i = 0; i < POSES.length; i++) if (POSES[i].id === id) return POSES[i];
  return POSES[0];
}

/** Adds the pose prompts (and the round prompts) to the kit's prompt table (idempotent). */
export function registerPrompts(table: Record<string, { text: string; icon: string }>): void {
  for (const p of POSES) table[p.promptId] = { text: p.text, icon: p.icon };
  table["dv-again"] = { text: "Yana bir marta!", icon: "🔁" };
  table["dv-all"] = { text: "Hammamiz o‘tdik!", icon: "🎉" };
}

export interface PtV {
  x: number;
  y: number;
  v: number;
}

/** The part of a kit KidSlot the matching needs. */
export interface PoseKid {
  scale: number;
  pts: { ls: PtV; rs: PtV; lw: PtV; rw: PtV; la: PtV; ra: PtV };
  signals: { squat: boolean; armsOut: boolean; handsUp: boolean; handUp: { L: boolean; R: boolean } };
}

export const MIN_VIS = 0.25;
/** a pose matches from this score */
export const MATCH_MIN = 0.5;
const RAD = 180 / Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** smallest difference between two directions in degrees (0..180) */
export function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** direction of the arm shoulder -> wrist in degrees from straight down; `outward` = +1 when "away from the body" is +x */
export function armAngle(sh: PtV, wr: PtV, outward: number): number {
  return Math.atan2((wr.x - sh.x) * outward, wr.y - sh.y) * RAD;
}

/** 0..1: how well one arm points at `target` (a raised arm must also be stretched, not folded at the shoulder) */
export function armScore(sh: PtV, wr: PtV, outward: number, scale: number, target: number, full = 35, zero = 75): number {
  if (sh.v < MIN_VIS || wr.v < MIN_VIS || scale <= 0) return 0;
  const dx = (wr.x - sh.x) * outward;
  const dy = wr.y - sh.y;
  const d = angDiff(Math.atan2(dx, dy) * RAD, target);
  let s = clamp01(1 - (d - full) / (zero - full));
  if (target >= 60) s *= clamp01((Math.hypot(dx, dy) / scale - 0.5) / 0.4);
  return s;
}

/** the arm is "not raised": hanging or only a bit out (an unseen wrist counts as hanging) */
function lowScore(sh: PtV, wr: PtV, outward: number, scale: number): number {
  if (wr.v < MIN_VIS || sh.v < MIN_VIS) return 1;
  return armScore(sh, wr, outward, scale, 0, 45, 85);
}

/** feet apart (needs both ankles seen, otherwise it is not judged) */
export function legScore(k: PoseKid): number {
  const { la, ra } = k.pts;
  if (la.v < MIN_VIS || ra.v < MIN_VIS || k.scale <= 0) return 1;
  return clamp01((Math.abs(la.x - ra.x) / k.scale - 0.7) / 0.5);
}

/** 0..1 match of a child against a pose */
export function poseScore(id: PoseId, k: PoseKid): number {
  const { ls, rs, lw, rw } = k.pts;
  const sL = ls.x >= rs.x ? 1 : -1;
  const sR = -sL;
  const sc = k.scale;
  switch (id) {
    case "handsUp": {
      const a = Math.min(armScore(ls, lw, sL, sc, 176), armScore(rs, rw, sR, sc, 176));
      return k.signals.handsUp ? 1 : a;
    }
    case "armsOut": {
      const a = Math.min(armScore(ls, lw, sL, sc, 90), armScore(rs, rw, sR, sc, 90));
      return k.signals.armsOut ? 1 : a;
    }
    case "star": {
      const a = Math.min(armScore(ls, lw, sL, sc, 135, 25, 60), armScore(rs, rw, sR, sc, 135, 25, 60));
      return Math.min(a, legScore(k));
    }
    case "squat":
      return k.signals.squat ? 1 : 0;
    case "oneHand": {
      const upL = Math.max(armScore(ls, lw, sL, sc, 176), k.signals.handUp.L ? 1 : 0);
      const upR = Math.max(armScore(rs, rw, sR, sc, 176), k.signals.handUp.R ? 1 : 0);
      return Math.max(Math.min(upL, lowScore(rs, rw, sR, sc)), Math.min(upR, lowScore(ls, lw, sL, sc)));
    }
  }
}

export const poseMatches = (id: PoseId, k: PoseKid): boolean => poseScore(id, k) >= MATCH_MIN;

/**
 * Leaky "hold" integrator: the pose has to be kept for ~0.3 s (counted over the last second or so), a single frame of tracking
 * noise neither gives nor takes the pass. While the child is not seen the gate is frozen.
 */
export class HoldGate {
  hold = 0;

  constructor(
    readonly need = 0.3,
    readonly cap = 0.8,
    readonly decay = 0.6,
  ) {}

  step(match: boolean, present: boolean, dt: number): void {
    if (!present) return;
    this.hold = match ? Math.min(this.cap, this.hold + dt) : Math.max(0, this.hold - dt * this.decay);
  }

  get ok(): boolean {
    return this.hold >= this.need;
  }

  reset(): void {
    this.hold = 0;
  }
}

/** height of a figure in units (`u`) and the y (below the shoulders) of its middle: used to centre it in a card / in the wall */
export const FIG_H = 5.4;
export const figMid = (p: PoseDef): number => (p.squat ? 1.4 : 0.8);

/** Draws the pose as a figure (strokes + a head). Origin (cx, cy) = the shoulders' centre, `u` = the unit (about a shoulder width). */
export function drawFigure(ctx: CanvasRenderingContext2D, p: PoseDef, cx: number, cy: number, u: number, fat: number, body: string, head: string): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const sq = p.squat;
  const oy = sq ? 1.0 * u : 0;
  const hipY = cy + oy + (sq ? 0.9 : 1.45) * u;
  const hx = (sq ? 0.4 : 0.32) * u;
  const footX = (0.4 + 1.0 * p.spread) * u;
  // legs
  ctx.strokeStyle = body;
  ctx.lineWidth = 0.62 * u * fat;
  ctx.beginPath();
  for (let s = -1; s <= 1; s += 2) {
    ctx.moveTo(cx + s * hx, hipY);
    if (sq) {
      ctx.lineTo(cx + s * 1.2 * u, hipY + 0.5 * u);
      ctx.lineTo(cx + s * 0.75 * u, hipY + 1.3 * u);
    } else ctx.lineTo(cx + s * footX, cy + 3.3 * u);
  }
  ctx.stroke();
  // torso
  ctx.lineWidth = 1.05 * u * fat;
  ctx.beginPath();
  ctx.moveTo(cx, cy + oy + 0.15 * u);
  ctx.lineTo(cx, hipY - 0.1 * u);
  ctx.stroke();
  // arms
  ctx.lineWidth = 0.52 * u * fat;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    const a = (p.arms[i] * Math.PI) / 180;
    const sx = cx + s * 0.5 * u;
    ctx.moveTo(sx, cy + oy);
    ctx.lineTo(sx + s * Math.sin(a) * 1.9 * u, cy + oy + Math.cos(a) * 1.9 * u);
  }
  ctx.stroke();
  // head
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(cx, cy + oy - 0.92 * u, 0.52 * u * (0.9 + 0.1 * fat), 0, Math.PI * 2);
  ctx.fill();
}
