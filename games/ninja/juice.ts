import { TAU } from "@/engine/math";

// Juice: liquid-like fruit splash drawn on the 2D overlay. Fixed-size struct-of-arrays pools, nothing is allocated while
// playing. All counts scale with the quality level (engine.quality.particles) and can never exceed the pool.

export const DROP_CAP = 280;
export const STAIN_CAP = 12;
const SAT = 14;
const PALETTE_CAP = 24;

export enum Kind {
  Streak = 0,
  Mist = 1,
  Drop = 2,
  Spark = 3,
}

export class Juice {
  // droplets
  readonly x = new Float32Array(DROP_CAP);
  readonly y = new Float32Array(DROP_CAP);
  readonly vx = new Float32Array(DROP_CAP);
  readonly vy = new Float32Array(DROP_CAP);
  readonly size = new Float32Array(DROP_CAP);
  readonly life = new Float32Array(DROP_CAP);
  readonly max = new Float32Array(DROP_CAP);
  readonly col = new Uint8Array(DROP_CAP);
  readonly kind = new Uint8Array(DROP_CAP);
  n = 0;
  // screen splatter stains
  readonly sx = new Float32Array(STAIN_CAP);
  readonly sy = new Float32Array(STAIN_CAP);
  readonly sr = new Float32Array(STAIN_CAP);
  readonly sLife = new Float32Array(STAIN_CAP);
  readonly sMax = new Float32Array(STAIN_CAP);
  readonly sCol = new Uint8Array(STAIN_CAP);
  readonly sTail = new Float32Array(STAIN_CAP * 2); // drip x offset, drip length factor
  readonly sSat = new Float32Array(STAIN_CAP * SAT * 3); // satellite dx, dy, r
  stains = 0;
  /** 0..1 quality multiplier (engine.quality.particles) */
  scale = 1;
  gravity = 1500;

  private palette: string[] = [];
  private paletteIdx = new Map<string, number>();
  private seedV = 0x9e3779b9;
  private nextStain = 0;

  constructor(seed = 1) {
    this.seedV = (seed * 2654435761) >>> 0 || 1;
  }

  /** deterministic, allocation free */
  private r(): number {
    let s = this.seedV;
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    this.seedV = s;
    return s / 4294967296;
  }
  private rr(a: number, b: number): number {
    return a + this.r() * (b - a);
  }

  /** Effective pool sizes at the current quality. */
  get dropLimit(): number {
    return Math.max(8, Math.floor(DROP_CAP * Math.min(1, Math.max(0.05, this.scale))));
  }
  get stainLimit(): number {
    return Math.max(2, Math.floor(STAIN_CAP * Math.min(1, Math.max(0.2, this.scale))));
  }

  /** Palette index of a css colour (memoised, so spawning never allocates strings per droplet). */
  colour(c: string): number {
    const known = this.paletteIdx.get(c);
    if (known !== undefined) return known;
    if (this.palette.length >= PALETTE_CAP) return 0;
    this.palette.push(c);
    this.paletteIdx.set(c, this.palette.length - 1);
    return this.palette.length - 1;
  }

  private alloc(): number {
    if (this.n >= this.dropLimit) return -1;
    return this.n++;
  }

  private put(i: number, kind: Kind, x: number, y: number, vx: number, vy: number, size: number, life: number, col: number): void {
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.size[i] = size;
    this.life[i] = this.max[i] = life;
    this.col[i] = col;
    this.kind[i] = kind;
  }

  /**
   * The slice splash: fast streaks fan out sideways from the cut (perpendicular to the blade), heavier droplets lob
   * out and fall, a fine mist hangs for a moment, and a stain is thrown on the screen.
   * @param ang direction of the blade (rad) or NaN when unknown
   */
  splash(x: number, y: number, colour: string, rpx: number, ang: number, crit: boolean): void {
    const col = this.colour(colour);
    const k = rpx / 42;
    const base = Number.isNaN(ang) ? this.r() * TAU : ang;
    const nStreak = Math.round((crit ? 26 : 18) * this.scale);
    for (let s = 0; s < nStreak; s++) {
      const i = this.alloc();
      if (i < 0) break;
      const side = s & 1 ? 1 : -1;
      const a = base + side * (Math.PI / 2 + this.rr(-0.75, 0.75)) + (this.r() < 0.2 ? Math.PI * 0.5 * side : 0);
      const sp = this.rr(380, 1000) * k;
      this.put(i, Kind.Streak, x, y, Math.cos(a) * sp, Math.sin(a) * sp, this.rr(1.8, 4.6) * Math.max(0.7, k), this.rr(0.42, 0.85), col);
    }
    const nDrop = Math.round((crit ? 12 : 8) * this.scale);
    for (let s = 0; s < nDrop; s++) {
      const i = this.alloc();
      if (i < 0) break;
      const a = this.r() * TAU;
      const sp = this.rr(120, 460) * k;
      this.put(i, Kind.Drop, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 120 * k, this.rr(3.4, 7.5) * Math.max(0.7, k), this.rr(0.9, 1.5), col);
    }
    const nMist = Math.round(16 * this.scale);
    for (let s = 0; s < nMist; s++) {
      const i = this.alloc();
      if (i < 0) break;
      const a = this.r() * TAU;
      const sp = this.rr(40, 260) * k;
      this.put(i, Kind.Mist, x + Math.cos(a) * rpx * 0.3, y + Math.sin(a) * rpx * 0.3, Math.cos(a) * sp, Math.sin(a) * sp, this.rr(1, 2.8), this.rr(0.3, 0.65), col);
    }
    this.splat(x, y, rpx * (crit ? 1.9 : 1.45), colour);
  }

  /** A single heavy droplet that drips off a flying half. */
  drip(x: number, y: number, colour: string): void {
    const i = this.alloc();
    if (i < 0) return;
    this.put(i, Kind.Drop, x + this.rr(-8, 8), y + this.rr(-4, 8), this.rr(-30, 30), this.rr(0, 80), this.rr(2.4, 4.4), this.rr(0.5, 0.9), this.colour(colour));
  }

  /** true with probability p (deterministic stream, allocation free) */
  chance(p: number): boolean {
    return this.r() < p;
  }

  /** One spark flying up from a burning fuse. */
  fuseSpark(x: number, y: number): void {
    this.spark(x, y, this.rr(-110, 110), this.rr(-300, -60));
  }

  /** A bright spark (bomb fuse, explosion). */
  spark(x: number, y: number, vx: number, vy: number): void {
    const i = this.alloc();
    if (i < 0) return;
    this.put(i, Kind.Spark, x, y, vx, vy, this.rr(1.2, 2.6), this.rr(0.22, 0.45), 0);
  }

  /** Short-lived splatter on the "glass": a blob, satellites around it and a drip. Oldest stain is recycled when full. */
  splat(x: number, y: number, r: number, colour: string): void {
    const lim = this.stainLimit;
    let i: number;
    if (this.stains < lim) i = this.stains++;
    else {
      i = this.nextStain % lim;
      this.nextStain++;
    }
    this.sx[i] = x;
    this.sy[i] = y;
    this.sr[i] = r;
    this.sLife[i] = this.sMax[i] = this.rr(1.9, 2.8);
    this.sCol[i] = this.colour(colour);
    this.sTail[i * 2] = this.rr(-0.35, 0.35) * r;
    this.sTail[i * 2 + 1] = this.r() < 0.7 ? this.rr(0.5, 1.5) : 0;
    // lobes: bulges of the puddle that touch the centre, then loose droplets around it
    for (let s = 0; s < SAT; s++) {
      const a = this.r() * TAU;
      const lobe = s < 8;
      const d = r * (lobe ? this.rr(0.3, 0.62) : this.rr(0.85, 1.45));
      const o = (i * SAT + s) * 3;
      this.sSat[o] = Math.cos(a) * d;
      this.sSat[o + 1] = Math.sin(a) * d;
      this.sSat[o + 2] = r * (lobe ? this.rr(0.2, 0.38) : this.rr(0.05, 0.15));
    }
  }

  clear(): void {
    this.n = 0;
    this.stains = 0;
    this.nextStain = 0;
  }

  update(dt: number): void {
    const g = this.gravity;
    let w = 0;
    // quality dropped: keep only what fits the current limit
    if (this.n > this.dropLimit) this.n = this.dropLimit;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const kind = this.kind[i];
      const drag = kind === Kind.Mist ? 0.9 : kind === Kind.Spark ? 0.96 : 1;
      const dd = Math.pow(drag, dt * 60);
      let vx = this.vx[i] * dd;
      let vy = this.vy[i] * dd + (kind === Kind.Mist ? g * 0.15 : kind === Kind.Spark ? g * 0.25 : g) * dt;
      if (kind === Kind.Streak) {
        // streaks slow down fast: they are thin jets of juice
        const f = Math.pow(0.935, dt * 60);
        vx *= f;
        vy = vy * f + g * dt * 0.1;
      }
      if (w !== i) {
        this.x[w] = this.x[i];
        this.y[w] = this.y[i];
        this.size[w] = this.size[i];
        this.max[w] = this.max[i];
        this.col[w] = this.col[i];
        this.kind[w] = kind;
      }
      this.x[w] += vx * dt;
      this.y[w] += vy * dt;
      this.vx[w] = vx;
      this.vy[w] = vy;
      this.life[w] = life;
      w++;
    }
    this.n = w;
    let sw = 0;
    for (let i = 0; i < this.stains; i++) {
      const life = this.sLife[i] - dt;
      if (life <= 0) continue;
      if (sw !== i) {
        this.sx[sw] = this.sx[i];
        this.sy[sw] = this.sy[i];
        this.sr[sw] = this.sr[i];
        this.sMax[sw] = this.sMax[i];
        this.sCol[sw] = this.sCol[i];
        this.sTail[sw * 2] = this.sTail[i * 2];
        this.sTail[sw * 2 + 1] = this.sTail[i * 2 + 1];
        for (let k = 0; k < SAT * 3; k++) this.sSat[sw * SAT * 3 + k] = this.sSat[i * SAT * 3 + k];
      }
      this.sLife[sw] = life;
      sw++;
    }
    this.stains = sw;
  }

  /** Stains go under the 3D fruit visually (the overlay is above the canvas, so they are kept soft), droplets on top. */
  draw(c: CanvasRenderingContext2D): void {
    c.save();
    c.lineCap = "round";
    // stains
    for (let i = 0; i < this.stains; i++) {
      const age = this.sMax[i] - this.sLife[i];
      const k = this.sLife[i] / this.sMax[i];
      const grow = 1 - Math.pow(1 - Math.min(1, age / 0.1), 3);
      const a = Math.min(1, k * 1.8) * 0.55;
      const r = this.sr[i] * (0.7 + 0.3 * grow) * 0.7;
      c.globalAlpha = a;
      c.fillStyle = this.palette[this.sCol[i]];
      c.beginPath();
      c.arc(this.sx[i], this.sy[i], r, 0, TAU);
      for (let s = 0; s < SAT; s++) {
        const o = (i * SAT + s) * 3;
        const sr = this.sSat[o + 2];
        c.moveTo(this.sx[i] + this.sSat[o] * grow + sr, this.sy[i] + this.sSat[o + 1] * grow);
        c.arc(this.sx[i] + this.sSat[o] * grow, this.sy[i] + this.sSat[o + 1] * grow, sr, 0, TAU);
      }
      c.fill();
      const tail = this.sTail[i * 2 + 1];
      if (tail > 0) {
        c.strokeStyle = this.palette[this.sCol[i]];
        c.lineWidth = r * 0.26;
        const len = r * tail * Math.min(1, age / 1.6);
        c.beginPath();
        c.moveTo(this.sx[i] + this.sTail[i * 2], this.sy[i] + r * 0.45);
        c.lineTo(this.sx[i] + this.sTail[i * 2], this.sy[i] + r * 0.45 + len);
        c.stroke();
      }
      c.globalAlpha = a * 0.7;
      c.fillStyle = "#fff";
      c.beginPath();
      c.ellipse(this.sx[i] - r * 0.28, this.sy[i] - r * 0.3, r * 0.2, r * 0.1, -0.7, 0, TAU);
      c.fill();
    }
    // droplets: stretched along their velocity, thinner as they age
    for (let i = 0; i < this.n; i++) {
      const kind = this.kind[i];
      if (kind === Kind.Spark) continue;
      const k = this.life[i] / this.max[i];
      const stretch = kind === Kind.Streak ? 0.05 : kind === Kind.Drop ? 0.012 : 0.006;
      const sz = this.size[i] * (kind === Kind.Mist ? 1 : 0.55 + 0.45 * Math.min(1, k * 2));
      c.globalAlpha = kind === Kind.Mist ? Math.min(0.5, k) : Math.min(1, k * 2.2) * 0.95;
      c.strokeStyle = this.palette[this.col[i]];
      c.lineWidth = sz * 2;
      c.beginPath();
      c.moveTo(this.x[i] - this.vx[i] * stretch, this.y[i] - this.vy[i] * stretch);
      c.lineTo(this.x[i], this.y[i]);
      c.stroke();
      if (kind === Kind.Drop && sz > 3) {
        c.globalAlpha = Math.min(1, k * 2) * 0.6;
        c.fillStyle = "#fff";
        c.beginPath();
        c.arc(this.x[i] - sz * 0.3, this.y[i] - sz * 0.35, sz * 0.28, 0, TAU);
        c.fill();
      }
    }
    // sparks glow
    c.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] !== Kind.Spark) continue;
      const k = this.life[i] / this.max[i];
      c.globalAlpha = Math.min(1, k * 2);
      c.strokeStyle = k > 0.5 ? "#fff3b0" : "#ff9a30";
      c.lineWidth = this.size[i] * 1.6;
      c.beginPath();
      c.moveTo(this.x[i] - this.vx[i] * 0.02, this.y[i] - this.vy[i] * 0.02);
      c.lineTo(this.x[i], this.y[i]);
      c.stroke();
    }
    c.restore();
  }
}
