// Pure helpers of "Shamol" (waving arms fast blows the clouds above a child away).

export const CLOUDS = 3;
export const MAX_FLY = 14;

/** wrist speed in body scales per second */
export function wristSpeed(dx: number, dy: number, dt: number, scale: number): number {
  if (dt <= 0) return 0;
  return Math.sqrt(dx * dx + dy * dy) / dt / Math.max(scale, 1);
}

/** exponential smoothing that does not depend on the frame rate */
export const smooth = (prev: number, next: number, dt: number, rate = 10): number => prev + (next - prev) * (1 - Math.exp(-rate * dt));

/** how fast the "wind charge" grows per second (1 = one cloud per second); a slow hand does nothing */
export function windGain(speed: number, waving: boolean): number {
  const g = Math.min(1.2, Math.max(0, (speed - 1.5) / 3));
  return waving ? g + 0.5 : g;
}

/** where cloud `i` (0..CLOUDS-1) hangs above a child; writes into `out` */
export function cloudSpot(out: { x: number; y: number }, headX: number, headY: number, headR: number, scale: number, i: number): void {
  out.x = headX + (i - 1) * scale * 2.4;
  out.y = headY - headR * 3 - scale * 0.4 - (i === 1 ? scale * 0.6 : 0);
}
