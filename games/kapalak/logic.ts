// "Kapalak": flap detection (arms going up and down) and the climb of the butterfly.

export const FLAP_UP = 0.3;
export const FLAP_DOWN = 0.4;
export const FLAP_GAIN = 0.1;
export const SINK = 0.025;

/** Counts every swing of the arms between "above the shoulders" and "down by the sides". */
export class FlapDetector {
  private state = 0;

  /** `wristY`: mean wrist height, `shoulderY`, `scale` = shoulder width. Returns 1 when the arms just swung to the other side, else 0. */
  step(wristY: number, shoulderY: number, scale: number): number {
    const rel = (wristY - shoulderY) / scale;
    if (rel < -FLAP_UP) {
      const was = this.state;
      this.state = 1;
      return was === -1 ? 1 : 0;
    }
    if (rel > FLAP_DOWN) {
      const was = this.state;
      this.state = -1;
      return was === 1 ? 1 : 0;
    }
    return 0;
  }

  reset(): void {
    this.state = 0;
  }
}

/** New altitude 0..1 after `flaps` swings and `dt` seconds (it sinks slowly when nobody flaps). */
export function climb(alt: number, flaps: number, dt: number): number {
  const a = alt + flaps * FLAP_GAIN - SINK * dt;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/** screen y of the butterfly for an altitude */
export const altitudeY = (alt: number, groundY: number, flowerY: number): number => groundY + (flowerY - groundY) * alt;
