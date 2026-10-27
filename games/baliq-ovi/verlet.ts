// Fishing line: a Verlet rope (20..40 segments). Pinned at the rod tip and at the float. It sags when slack,
// straightens under tension and trembles when a fish pulls. All typed arrays, nothing is allocated while stepping.

export interface LineOptions {
  /** number of segments (points = segments + 1) */
  segments: number;
  /** constraint iterations per step */
  iterations?: number;
  /** velocity damping per second (air) */
  damping?: number;
}

export class VerletLine {
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  /** total length of the paid-out line (m) */
  length = 1;
  /** water level callback (the part of the line that is slack lies on the surface) */
  surface: ((x: number, z: number) => number) | null = null;
  gravity = 9.8;
  /** horizontal drift (wind / current), m/s^2 equivalent */
  driftX = 0;
  driftZ = 0;
  private iter: number;
  private damp: number;
  private phase = 0;

  constructor(o: LineOptions) {
    this.n = o.segments + 1;
    this.iter = o.iterations ?? 14;
    this.damp = o.damping ?? 1.2;
    const m = this.n;
    this.x = new Float32Array(m);
    this.y = new Float32Array(m);
    this.z = new Float32Array(m);
    this.px = new Float32Array(m);
    this.py = new Float32Array(m);
    this.pz = new Float32Array(m);
  }

  /** Lay the rope straight between two points (e.g. on a cast or a reset). */
  reset(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    for (let i = 0; i < this.n; i++) {
      const k = i / (this.n - 1);
      this.x[i] = this.px[i] = ax + (bx - ax) * k;
      this.y[i] = this.py[i] = ay + (by - ay) * k;
      this.z[i] = this.pz[i] = az + (bz - az) * k;
    }
    this.length = Math.hypot(bx - ax, by - ay, bz - az);
  }

  /** Place point i by hand (no velocity): used while a cast flies and the line trails the float. */
  setPoint(i: number, x: number, y: number, z: number): void {
    this.x[i] = this.px[i] = x;
    this.y[i] = this.py[i] = y;
    this.z[i] = this.pz[i] = z;
  }

  /** distance between the two pinned ends */
  span(): number {
    const e = this.n - 1;
    return Math.hypot(this.x[e] - this.x[0], this.y[e] - this.y[0], this.z[e] - this.z[0]);
  }

  private spanTo(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    return Math.hypot(bx - ax, by - ay, bz - az);
  }

  /** Fraction of slack: 0 = taut, > 0 = sagging. */
  slack(): number {
    const sp = this.span();
    return sp > 1e-4 ? Math.max(0, this.length / sp - 1) : 0;
  }

  /**
   * One step. (ax,ay,az) = rod tip, (bx,by,bz) = float. `tremble` (0..1) shakes the middle of the line like a fighting fish.
   */
  step(dt: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, tremble = 0): void {
    const n = this.n;
    const e = n - 1;
    const { x, y, z, px, py, pz } = this;
    const seg = this.length / e;
    // fully taut: the rope is the straight line between the pins (no gravity stretch), only trembling remains
    if (this.length <= this.spanTo(ax, ay, az, bx, by, bz) * 1.0005) {
      for (let i = 0; i <= e; i++) {
        const k = i / e;
        x[i] = px[i] = ax + (bx - ax) * k;
        y[i] = py[i] = ay + (by - ay) * k;
        z[i] = pz[i] = az + (bz - az) * k;
      }
      if (tremble > 0.001) {
        this.phase += dt * 38;
        for (let i = 1; i < e; i++) {
          const k = Math.sin((i / e) * Math.PI);
          x[i] += Math.sin(this.phase + i * 1.7) * tremble * 0.012 * k;
          y[i] += Math.cos(this.phase * 1.3 + i * 2.1) * tremble * 0.01 * k;
        }
      }
      return;
    }
    const g = this.gravity * dt * dt;
    const damp = Math.exp(-this.damp * dt);
    this.phase += dt * 38;
    // integrate
    for (let i = 1; i < e; i++) {
      const vx = (x[i] - px[i]) * damp;
      const vy = (y[i] - py[i]) * damp;
      const vz = (z[i] - pz[i]) * damp;
      px[i] = x[i];
      py[i] = y[i];
      pz[i] = z[i];
      x[i] += vx + this.driftX * dt * dt;
      y[i] += vy - g;
      z[i] += vz + this.driftZ * dt * dt;
    }
    if (tremble > 0.001) {
      for (let i = 1; i < e; i++) {
        const k = Math.sin((i / e) * Math.PI);
        const s = Math.sin(this.phase + i * 1.7) * tremble * 0.012 * k;
        x[i] += s;
        y[i] += Math.cos(this.phase * 1.3 + i * 2.1) * tremble * 0.01 * k;
        z[i] += s * 0.5;
      }
    }
    // pins
    x[0] = ax; y[0] = ay; z[0] = az;
    x[e] = bx; y[e] = by; z[e] = bz;
    px[0] = ax; py[0] = ay; pz[0] = az;
    px[e] = bx; py[e] = by; pz[e] = bz;
    // constraints
    for (let k = 0; k < this.iter; k++) {
      for (let i = 0; i < e; i++) {
        const dx = x[i + 1] - x[i];
        const dy = y[i + 1] - y[i];
        const dz = z[i + 1] - z[i];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - seg) / d;
        // only pull when stretched or push when compressed (rope: compress is allowed to be soft)
        const w0 = i === 0 ? 0 : 0.5;
        const w1 = i + 1 === e ? 0 : 0.5;
        const sum = w0 + w1 || 1;
        const k0 = w0 / sum;
        const k1 = w1 / sum;
        x[i] += dx * diff * k0;
        y[i] += dy * diff * k0;
        z[i] += dz * diff * k0;
        x[i + 1] -= dx * diff * k1;
        y[i + 1] -= dy * diff * k1;
        z[i + 1] -= dz * diff * k1;
      }
      if (this.surface) {
        for (let i = 1; i < e; i++) {
          const w = this.surface(x[i], z[i]) + 0.012;
          if (y[i] < w) y[i] = w;
        }
      }
    }
  }
}
