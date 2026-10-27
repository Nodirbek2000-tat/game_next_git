import { TAU, lerp } from "../math";

/**
 * One Euro filter (Casiez et al.) — ported 1:1 from the prototype.
 * `t` is in milliseconds; a gap larger than 500 ms resets the filter.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(
    public minCutoff = 1.5,
    public beta = 3,
    public dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const r = TAU * cutoff * dt;
    return r / (r + 1);
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  filter(x: number, t: number): number {
    if (this.x === null || t - this.t > 500) {
      this.x = x;
      this.t = t;
      this.dx = 0;
      return x;
    }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    this.dx = lerp(this.dx, (x - this.x) / dt, OneEuro.alpha(this.dCutoff, dt));
    this.x = lerp(this.x, x, OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt));
    return this.x;
  }
}
