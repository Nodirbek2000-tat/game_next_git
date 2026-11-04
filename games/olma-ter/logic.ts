// "Olma ter": pure helpers (apple places on the tree above a child, hit test).

export const APPLES = 3;
/** apple places relative to the head, in body scales (x right, y up) */
const OFFSET_X = [-1.25, 0, 1.25] as const;
const OFFSET_UP = [0.95, 1.5, 0.95] as const;

/** Where apple `i` hangs for a child whose head is at (hx, hy); never above `minY` (under the HUD). */
export function applePlace(hx: number, hy: number, scale: number, i: number, minY: number, out: { x: number; y: number }): void {
  out.x = hx + OFFSET_X[i] * scale;
  out.y = Math.max(minY, hy - OFFSET_UP[i] * scale);
}

/** A raised hand (visible) close enough to the apple picks it. */
export function pickHit(wx: number, wy: number, wv: number, handUp: boolean, ax: number, ay: number, r: number): boolean {
  if (!handUp || wv < 0.15) return false;
  const dx = wx - ax;
  const dy = wy - ay;
  return dx * dx + dy * dy < r * r;
}

/** one star for every 2nd apple in the basket */
export const basketStar = (count: number): boolean => count > 0 && count % 2 === 0;
