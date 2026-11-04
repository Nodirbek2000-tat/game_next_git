// "Shar puflash": one pump = squat down and stand up again.

export const PUMPS = 5;
export const MIN_SQUAT_SEC = 0.12;

export class PumpCounter {
  private down = 0;

  /** Feed the squat state every frame; returns true at the moment the child stands up after a real squat. */
  step(squat: boolean, dt: number): boolean {
    if (squat) {
      this.down += dt;
      return false;
    }
    const pump = this.down >= MIN_SQUAT_SEC;
    this.down = 0;
    return pump;
  }

  reset(): void {
    this.down = 0;
  }
}

/** balloon radius for `pumps` pumps done, in px (never tiny for far children) */
export function balloonRadius(pumps: number, scale: number, stageH: number): number {
  const p = Math.min(1, Math.max(0, pumps / PUMPS));
  return Math.max(stageH * 0.04, scale * (0.3 + 0.85 * p));
}
