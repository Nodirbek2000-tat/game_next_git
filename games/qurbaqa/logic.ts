// Pure helpers of "Qurbaqa sakrashi" (a log rolls across the screen, children jump over it).

/** x of the log centre after `t` of `dur` seconds, going right (dir 1) or left (dir -1); starts and ends fully off screen */
export function logX(t: number, dur: number, dir: 1 | -1, stageW: number, logW: number): number {
  const p = Math.min(1, Math.max(0, t / dur));
  const from = dir === 1 ? -logW / 2 : stageW + logW / 2;
  const to = dir === 1 ? stageW + logW / 2 : -logW / 2;
  return from + (to - from) * p;
}

/** the log is "at" a child when its body (half width) plus the child's reach covers the child's x */
export const logReach = (scale: number, stageW: number, logW: number): number => logW / 2 + Math.max(scale * 1.2, stageW * 0.05);

export const logAtKid = (logCx: number, kidX: number, reach: number): boolean => Math.abs(logCx - kidX) <= reach;

/** a jump counts when it happened up to `windowSec` before now (a short jump before the log arrives still counts) */
export const jumpedRecently = (now: number, lastJump: number, windowSec = 0.5): boolean => now - lastJump >= 0 && now - lastJump <= windowSec;

export const slotBit = (slot: number): number => 1 << slot;
