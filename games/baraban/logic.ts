// Pure helpers of "Baraban" (two drums beside every child, hit the lit one in time with the beat).

export const BEAT = 0.8;
export const WINDOW = 0.4;
/** L = left drum, R = right drum, one letter per beat */
export const PATTERNS: readonly string[] = ["LRLR", "LLRR", "LRRL", "RLRL", "LRLL", "RRLR"];

/** the beat index whose window covers time `t` (seconds), or -1. Beats are numbered from 1 (at t = BEAT). */
export function activeBeat(t: number, interval = BEAT, win = WINDOW): number {
  const n = Math.round(t / interval);
  return n >= 1 && Math.abs(t - n * interval) <= win ? n : -1;
}

/** every 8 beats the pattern changes */
export const blockOf = (beat: number): number => Math.floor(beat / 8);

/** every third block the drums hang above the head */
export const isHighBlock = (block: number): boolean => block % 3 === 2;

/** 0 = left drum, 1 = right drum */
export const sideAt = (pattern: string, beat: number): 0 | 1 => (pattern[beat % pattern.length] === "R" ? 1 : 0);

/** a hit right on the beat */
export const isPerfect = (t: number, beat: number, interval = BEAT): boolean => Math.abs(t - beat * interval) <= 0.18;

export const drumRadius = (scale: number, minScale: number): number => Math.max(scale, minScale) * 0.75;

/** the hand came into the drum this frame (was outside, is inside): holding a hand on the drum is not hitting it */
export const enteredDrum = (prevDist: number, dist: number, r: number): boolean => dist < r && prevDist >= r;

/** drum centre beside a child; `high` puts it above the head instead of at shoulder height. Writes into `out`. */
export function drumSpot(out: { x: number; y: number }, headX: number, headY: number, headR: number, shoulderY: number, scale: number, side: 0 | 1, high: boolean): void {
  out.x = headX + (side === 0 ? -1 : 1) * scale * 2.1;
  out.y = high ? headY - headR * 2.2 : shoulderY + scale * 0.25;
}

/** radius of the ring that closes in on the lit drum; 0 once the beat has passed */
export function approachRing(timeToBeat: number, r: number, win = WINDOW): number {
  return timeToBeat <= 0 ? 0 : r * (1 + (Math.min(timeToBeat, win) / win) * 1.2);
}
