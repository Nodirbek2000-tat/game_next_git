// "Soyabon": the rain cloud / sun cycle and the "stayed dry" rule (pure).

export const CROSS_SEC = 8;
export const SUN_SEC = 4;

export type Phase = "rain" | "sun";

/** a child is under the cloud when the centres are closer than the rain column's half width */
export const isUnder = (kidX: number, cloudX: number, halfW: number): boolean => Math.abs(kidX - cloudX) < halfW;

/** a star for a pass in which the child stood long enough under the cloud and was wet for less than 40 % of it */
export const passStar = (underSec: number, wetSec: number): boolean => underSec >= 0.8 && wetSec <= underSec * 0.4;

export class Weather {
  phase: Phase = "rain";
  x = 0;
  dir = 1;
  private sun = 0;

  /** the cloud starts off-screen on the left */
  reset(halfW: number): void {
    this.phase = "rain";
    this.dir = 1;
    this.x = -halfW;
    this.sun = 0;
  }

  /** Moves the weather. Returns 1 when the cloud has left (the sun comes), 2 when the sun is over (a new cloud comes), else 0. */
  step(dt: number, stageW: number, halfW: number): 0 | 1 | 2 {
    if (this.phase === "rain") {
      this.x += (this.dir * stageW * dt) / CROSS_SEC;
      if ((this.dir > 0 && this.x > stageW + halfW) || (this.dir < 0 && this.x < -halfW)) {
        this.phase = "sun";
        this.sun = 0;
        return 1;
      }
      return 0;
    }
    this.sun += dt;
    if (this.sun < SUN_SEC) return 0;
    this.phase = "rain";
    this.dir = -this.dir;
    this.x = this.dir > 0 ? -halfW : stageW + halfW;
    return 2;
  }
}
