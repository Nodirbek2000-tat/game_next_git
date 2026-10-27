// The fish of the pond. Pure logic, positions are fractions of the stage (x: 0..1 of the width, y: 0..1 of the height),
// typed arrays only, nothing is allocated after construction (no per-frame allocation, weak PCs).

export const N_FISH = 12;
/** index of the one golden fish (rare: it is picked as the biting fish only now and then) */
export const GOLDEN = 0;
/** the surface of the water (fraction of the stage height) */
export const WATER_TOP = 0.46;
/** swimming lanes */
export const LANE_MIN = 0.54;
export const LANE_MAX = 0.86;
/** the shared basket (centre, fractions) */
export const BASKET = { x: 0.5, y: 0.9 } as const;
/** colour table size (see draw.ts), the golden fish is the last one */
export const N_COLORS = 9;
export const GOLD_COLOR = 8;
export const JUMP_LEN = 0.85;

export const FM = { swim: 0, come: 1, hook: 2, fly: 3 } as const;

export class Pond {
  readonly x = new Float32Array(N_FISH);
  readonly y = new Float32Array(N_FISH);
  /** lane (the y the fish swims around) */
  readonly lane = new Float32Array(N_FISH);
  readonly dir = new Float32Array(N_FISH);
  readonly speed = new Float32Array(N_FISH);
  readonly size = new Float32Array(N_FISH);
  readonly phase = new Float32Array(N_FISH);
  readonly color = new Uint8Array(N_FISH);
  readonly mode = new Uint8Array(N_FISH);
  readonly owner = new Int8Array(N_FISH);
  readonly t = new Float32Array(N_FISH);
  readonly dur = new Float32Array(N_FISH);
  readonly sx = new Float32Array(N_FISH);
  readonly sy = new Float32Array(N_FISH);
  readonly tx = new Float32Array(N_FISH);
  readonly ty = new Float32Array(N_FISH);
  /** < 0: no jump; else seconds into the little jump out of the water */
  readonly jump = new Float32Array(N_FISH);
  /** the fish each slot is dealing with (-1: none) */
  readonly fishOf = new Int8Array(8).fill(-1);

  constructor(private rand: () => number = Math.random) {
    for (let i = 0; i < N_FISH; i++) {
      const g = i === GOLDEN;
      this.x[i] = this.rand();
      this.lane[i] = LANE_MIN + this.rand() * (LANE_MAX - LANE_MIN);
      this.y[i] = this.lane[i];
      this.dir[i] = this.rand() < 0.5 ? -1 : 1;
      this.size[i] = g ? 1.45 : 0.7 + this.rand() * 0.8;
      this.speed[i] = g ? 0.1 : 0.03 + this.rand() * 0.07;
      this.phase[i] = this.rand() * 6.28;
      this.color[i] = g ? GOLD_COLOR : i % (N_COLORS - 1);
      this.mode[i] = FM.swim;
      this.owner[i] = -1;
      this.jump[i] = -1;
    }
  }

  isGolden(i: number): boolean {
    return i === GOLDEN;
  }

  /** a free swimming fish (the golden one now and then), or -1 */
  pick(): number {
    if (this.mode[GOLDEN] === FM.swim && this.rand() < 0.12) return GOLDEN;
    const n = N_FISH - 1;
    const start = 1 + Math.floor(this.rand() * n);
    for (let k = 0; k < n; k++) {
      const i = 1 + ((start - 1 + k) % n);
      if (this.mode[i] === FM.swim) return i;
    }
    return this.mode[GOLDEN] === FM.swim ? GOLDEN : -1;
  }

  /** a fish swims to the float of `slot` (lands at fraction (tx, ty)) and arrives after `dur` seconds. Returns the fish or -1. */
  send(slot: number, tx: number, ty: number, dur: number): number {
    this.release(slot);
    const i = this.pick();
    if (i < 0) return -1;
    this.mode[i] = FM.come;
    this.owner[i] = slot;
    this.fishOf[slot] = i;
    this.t[i] = 0;
    this.dur[i] = Math.max(0.3, dur);
    this.sx[i] = this.x[i];
    this.sy[i] = this.y[i];
    this.tx[i] = tx;
    this.ty[i] = ty + 0.03;
    this.dir[i] = tx >= this.x[i] ? 1 : -1;
    this.jump[i] = -1;
    return i;
  }

  /** the fish took the bait */
  hook(slot: number): number {
    const i = this.fishOf[slot];
    if (i < 0) return -1;
    this.mode[i] = FM.hook;
    this.x[i] = this.tx[i];
    this.y[i] = this.ty[i];
    this.t[i] = 0;
    return i;
  }

  /** the fish flies to the basket in `dur` seconds */
  reel(slot: number, dur: number): number {
    const i = this.fishOf[slot];
    if (i < 0) return -1;
    this.mode[i] = FM.fly;
    this.t[i] = 0;
    this.dur[i] = Math.max(0.2, dur);
    this.sx[i] = this.x[i];
    this.sy[i] = this.y[i];
    return i;
  }

  /** the fish arrived in the basket: it is replaced by a swimmer entering from the side. Returns the fish index. */
  land(slot: number): number {
    const i = this.fishOf[slot];
    if (i < 0) return -1;
    this.respawn(i);
    return i;
  }

  /** the child left / the line was reset: the fish just swims on */
  release(slot: number): void {
    const i = this.fishOf[slot];
    if (i < 0) return;
    this.mode[i] = FM.swim;
    this.owner[i] = -1;
    this.fishOf[slot] = -1;
    this.lane[i] = Math.min(LANE_MAX, Math.max(LANE_MIN, this.y[i]));
  }

  private respawn(i: number): void {
    const slot = this.owner[i];
    if (slot >= 0) this.fishOf[slot] = -1;
    this.owner[i] = -1;
    this.mode[i] = FM.swim;
    const left = this.rand() < 0.5;
    this.x[i] = left ? -0.12 : 1.12;
    this.dir[i] = left ? 1 : -1;
    this.lane[i] = LANE_MIN + this.rand() * (LANE_MAX - LANE_MIN);
    this.y[i] = this.lane[i];
    this.jump[i] = -1;
  }

  update(dt: number): void {
    for (let i = 0; i < N_FISH; i++) {
      switch (this.mode[i]) {
        case FM.swim: {
          this.x[i] += this.dir[i] * this.speed[i] * dt;
          this.phase[i] += dt * (2 + this.speed[i] * 14);
          this.y[i] = this.lane[i] + Math.sin(this.phase[i]) * 0.012;
          if (this.x[i] > 1.14 && this.dir[i] > 0) this.turn(i, -1);
          else if (this.x[i] < -0.14 && this.dir[i] < 0) this.turn(i, 1);
          if (this.jump[i] >= 0) {
            this.jump[i] += dt;
            if (this.jump[i] > JUMP_LEN) this.jump[i] = -1;
          } else if (this.x[i] > 0.08 && this.x[i] < 0.92 && this.rand() < 0.04 * dt) this.jump[i] = 0;
          break;
        }
        case FM.come: {
          this.t[i] += dt;
          const p = Math.min(1, this.t[i] / this.dur[i]);
          const s = p * p * (3 - 2 * p);
          this.x[i] = this.sx[i] + (this.tx[i] - this.sx[i]) * s;
          this.y[i] = this.sy[i] + (this.ty[i] - this.sy[i]) * s;
          this.phase[i] += dt * 9;
          break;
        }
        case FM.hook:
          this.t[i] += dt;
          this.phase[i] += dt * 22;
          break;
        case FM.fly: {
          this.t[i] += dt;
          const p = Math.min(1, this.t[i] / this.dur[i]);
          this.x[i] = this.sx[i] + (BASKET.x - this.sx[i]) * p;
          this.y[i] = this.sy[i] + (BASKET.y - 0.05 - this.sy[i]) * p;
          break;
        }
      }
    }
  }

  private turn(i: number, d: number): void {
    this.dir[i] = d;
    this.lane[i] = LANE_MIN + this.rand() * (LANE_MAX - LANE_MIN);
  }
}

/** height (fraction of the stage) a fish is above its lane while jumping, 0 when not jumping */
export function jumpLift(j: number): number {
  if (j < 0) return 0;
  return Math.sin((Math.PI * j) / JUMP_LEN) * 0.16;
}
