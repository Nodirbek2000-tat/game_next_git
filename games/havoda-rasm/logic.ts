// Havoda rasm: pure, allocation-free logic (stroke buffering, guide shapes + matching, prompt schedule, sparks).
// The game (game.ts) only paints. Everything here works on typed arrays that are created once.

export const SLOTS = 5;
/** 2 wrists per child */
export const WRISTS = SLOTS * 2;
/** hard cap of segments painted onto the picture in ONE frame (all children together) */
export const MAX_SEG_PER_FRAME = 12;

export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Turns wrist positions into short pen segments. Per wrist it remembers only the last pen point, so memory is O(1):
 * the picture itself is the history. Segments are skipped when the wrist barely moved, a jump (tracking glitch, a
 * child who just appeared) starts a new stroke instead of drawing a long line, and a per-frame budget caps the work.
 */
export class StrokeBuffer {
  readonly px = new Float32Array(WRISTS);
  readonly py = new Float32Array(WRISTS);
  readonly has = new Uint8Array(WRISTS);
  /** path length of the current stroke of each wrist (px), used to cycle the colour shades */
  readonly dist = new Float32Array(WRISTS);
  /** the segment filled by the last successful `move()` */
  readonly seg: Seg = { x0: 0, y0: 0, x1: 0, y1: 0 };
  budget = MAX_SEG_PER_FRAME;
  /** segments handed out since creation (tests / debug) */
  segCount = 0;
  /** segments that had to wait because the frame budget was used up */
  deferred = 0;

  constructor(
    /** movements shorter than this (px) are ignored */
    public minStep = 2,
    /** jumps longer than this (px) start a new stroke */
    public maxJump = 360,
    /** 0..1, how far the pen follows the wrist in one step (1 = no smoothing) */
    public follow = 0.6,
  ) {}

  beginFrame(): void {
    this.budget = MAX_SEG_PER_FRAME;
  }

  /** the pen of wrist `w` is up (hand lowered / child gone) */
  lift(w: number): void {
    this.has[w] = 0;
    this.dist[w] = 0;
  }

  /** pen down at (x, y); true when `seg` holds a segment to paint */
  move(w: number, x: number, y: number): boolean {
    if (!this.has[w]) {
      this.px[w] = x;
      this.py[w] = y;
      this.has[w] = 1;
      return false;
    }
    const dx = x - this.px[w];
    const dy = y - this.py[w];
    const d2 = dx * dx + dy * dy;
    if (d2 > this.maxJump * this.maxJump) {
      this.px[w] = x;
      this.py[w] = y;
      this.dist[w] = 0;
      return false;
    }
    if (d2 < this.minStep * this.minStep) return false;
    if (this.budget <= 0) {
      this.deferred++;
      return false; // the pen stays; the segment is painted in a later frame
    }
    this.budget--;
    const f = this.follow;
    const s = this.seg;
    s.x0 = this.px[w];
    s.y0 = this.py[w];
    s.x1 = s.x0 + dx * f;
    s.y1 = s.y0 + dy * f;
    this.px[w] = s.x1;
    this.py[w] = s.y1;
    this.dist[w] += Math.sqrt(d2) * f;
    this.segCount++;
    return true;
  }
}

// ------------------------------------------------------------------------------------------ guide shapes

export type ShapeId = "sun" | "rain" | "wave" | "rainbow";
export const SHAPES: readonly ShapeId[] = ["sun", "rain", "wave", "rainbow"];
export const GUIDE_MAX = 64;

export interface ShapeInfo {
  /** banner text (Uzbek Latin) and icon */
  text: string;
  icon: string;
}
export const SHAPE_INFO: Record<ShapeId, ShapeInfo> = {
  sun: { text: "Quyosh chizamiz!", icon: "☀️" },
  rain: { text: "Yomg‘ir chizamiz!", icon: "🌧️" },
  wave: { text: "To‘lqin chizamiz!", icon: "🌊" },
  rainbow: { text: "Kamalak chizamiz!", icon: "🌈" },
};

/** how close (px) a pen has to come to a guide point: very tolerant */
export const guideTol = (w: number, h: number): number => Math.min(w, h) * 0.1;

/** A guide is a list of sample points along the shape; a point is "covered" when a pen passes near it. */
export class Guide {
  readonly x = new Float32Array(GUIDE_MAX);
  readonly y = new Float32Array(GUIDE_MAX);
  /** 1 = this point starts a new sub-path (a new rain line) */
  readonly brk = new Uint8Array(GUIDE_MAX);
  readonly covered = new Uint8Array(GUIDE_MAX);
  /** slot of the child who covered the point, -1 = nobody */
  readonly owner = new Int8Array(GUIDE_MAX);
  /** indexes covered by the last `hitSeg()` */
  readonly fresh = new Int16Array(GUIDE_MAX);
  n = 0;
  coveredCount = 0;
  shape: ShapeId = "sun";

  get progress(): number {
    return this.n ? this.coveredCount / this.n : 0;
  }

  private put(i: number, x: number, y: number, brk = 0): void {
    this.x[i] = x;
    this.y[i] = y;
    this.brk[i] = brk;
  }

  build(shape: ShapeId, w: number, h: number): void {
    this.shape = shape;
    this.covered.fill(0);
    this.owner.fill(-1);
    this.coveredCount = 0;
    let n = 0;
    const R = Math.min(h * 0.27, w * 0.25);
    if (shape === "sun") {
      const cx = w / 2;
      const cy = h * 0.5;
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2 - Math.PI / 2;
        this.put(n++, cx + Math.cos(a) * R, cy + Math.sin(a) * R, i === 0 ? 1 : 0);
      }
    } else if (shape === "rain") {
      for (let l = 0; l < 5; l++) {
        const x = w * (0.28 + l * 0.11);
        for (let i = 0; i < 8; i++) this.put(n++, x, h * (0.3 + i * 0.07), i === 0 ? 1 : 0);
      }
    } else if (shape === "wave") {
      for (let i = 0; i < 48; i++) {
        const u = i / 47;
        this.put(n++, w * (0.12 + 0.76 * u), h * 0.55 + Math.sin(u * Math.PI * 5) * h * 0.09, i === 0 ? 1 : 0);
      }
    } else {
      const cx = w / 2;
      const cy = h * 0.74;
      for (let i = 0; i < 36; i++) {
        const a = Math.PI + (i / 35) * Math.PI;
        this.put(n++, cx + Math.cos(a) * R * 1.3, cy + Math.sin(a) * R * 1.3, i === 0 ? 1 : 0);
      }
      for (let i = 0; i < 28; i++) {
        const a = Math.PI + (i / 27) * Math.PI;
        this.put(n++, cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95, i === 0 ? 1 : 0);
      }
    }
    this.n = n;
  }

  /** The pen moved from (x0,y0) to (x1,y1): marks every uncovered point within `tol` of the segment. Returns how many are new. */
  hitSeg(x0: number, y0: number, x1: number, y1: number, tol: number, slot: number): number {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    const t2 = tol * tol;
    let got = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.covered[i]) continue;
      const px = this.x[i] - x0;
      const py = this.y[i] - y0;
      let t = l2 > 1e-6 ? (px * dx + py * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - dx * t;
      const ey = py - dy * t;
      if (ex * ex + ey * ey <= t2) {
        this.covered[i] = 1;
        this.owner[i] = slot;
        this.fresh[got++] = i;
      }
    }
    this.coveredCount += got;
    return got;
  }
}

// ------------------------------------------------------------------------------------------ prompts

export interface ScheduledPrompt {
  start: number;
  end: number;
  shape: ShapeId;
}
export interface Schedule {
  prompts: ScheduledPrompt[];
  /** round time (s) at which the group picture is shown */
  galleryAt: number;
}

export const PROMPT_EVERY = 15;
export const PROMPT_WINDOW = 12;

/** A drawing prompt every ~15 s; the last seconds of the round show the picture. `?duration=` shortens everything. */
export function buildSchedule(roundSec: number, firstShape = 0): Schedule {
  const galleryLen = Math.min(6, roundSec * 0.3);
  const galleryAt = roundSec - galleryLen;
  const first = Math.min(3, roundSec * 0.1);
  const prompts: ScheduledPrompt[] = [];
  for (let k = 0; ; k++) {
    const start = first + k * PROMPT_EVERY;
    if (galleryAt - start < 4) break;
    prompts.push({ start, end: Math.min(start + PROMPT_WINDOW, galleryAt - 0.3), shape: SHAPES[(k + firstShape) % SHAPES.length] });
  }
  return { prompts, galleryAt };
}

/** Counts something per child and hands out a star every `per` units. */
export class Meter {
  readonly acc = new Float32Array(SLOTS);
  /** adds `v` for `slot`; returns the number of whole stars earned */
  add(slot: number, v: number, per: number): number {
    this.acc[slot] += v;
    let n = 0;
    while (this.acc[slot] >= per) {
      this.acc[slot] -= per;
      n++;
    }
    return n;
  }
}

// ------------------------------------------------------------------------------------------ sparks

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
