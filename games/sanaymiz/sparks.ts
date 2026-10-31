// Pooled sparkles for Sanaymiz.

export const MAX_SPARKS = 160;

/** Pooled sparkles / fireworks (ring buffer: the oldest spark is reused when the pool is full). */
export class Sparks {
  readonly x = new Float32Array(MAX_SPARKS);
  readonly y = new Float32Array(MAX_SPARKS);
  readonly vx = new Float32Array(MAX_SPARKS);
  readonly vy = new Float32Array(MAX_SPARKS);
  /** remaining life 0..1 (0 = free) */
  readonly life = new Float32Array(MAX_SPARKS);
  readonly rate = new Float32Array(MAX_SPARKS);
  readonly size = new Float32Array(MAX_SPARKS);
  /** palette index */
  readonly col = new Uint8Array(MAX_SPARKS);
  private head = 0;
  count = 0;

  add(x: number, y: number, vx: number, vy: number, life: number, size: number, col: number): void {
    const i = this.head;
    this.head = (this.head + 1) % MAX_SPARKS;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = 1;
    this.rate[i] = 1 / Math.max(0.1, life);
    this.size[i] = size;
    this.col[i] = col;
  }

  /** fireworks: `n` sparks flying out in a ring (`speed` px/s); `rnd` is injectable for tests */
  burst(x: number, y: number, n: number, col: number, speed: number, size: number, rnd: () => number = Math.random): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
      const s = speed * (0.55 + rnd() * 0.45);
      this.add(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.9 + rnd() * 0.5, size * (0.7 + rnd() * 0.6), col);
    }
  }

  step(dt: number, gravity: number): void {
    let alive = 0;
    const drag = Math.max(0, 1 - dt * 1.6);
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * this.rate[i];
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        continue;
      }
      this.vx[i] *= drag;
      this.vy[i] = this.vy[i] * drag + gravity * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      alive++;
    }
    this.count = alive;
  }
}
