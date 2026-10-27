// Pufakchalar: pure game logic (no canvas, no audio, no engine) so it can be tested in isolation.
// Everything is pooled in typed arrays: nothing is allocated while the game runs.

export const MAX_BUBBLES = 16;
export const MAX_SPARKS = 72;
export const MAX_RINGS = 16;
export const SLOTS = 5;

export const KIND_NORMAL = 0;
export const KIND_COLOUR = 1;
export const KIND_GOLD = 2;
export type BubbleKind = 0 | 1 | 2;

/** every Nth pop of a child earns that child one star */
export const POPS_PER_STAR = 3;
/** group bonus when a child pops the bubble of their own colour */
export const COLOUR_BONUS = 2;
/** seconds during which a touched golden bubble ignores the same hand (so one wave does not pop it twice) */
export const TOUCH_COOLDOWN = 0.45;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** How many bubbles may float at once: grows with the number of children, capped by the quality level (weak PCs). */
export function bubbleCap(level: string | undefined, kids: number): number {
  const byLevel = level === "low" ? 6 : level === "high" ? 12 : 9;
  const byKids = 3 + 2 * Math.max(1, kids);
  return Math.min(byLevel, byKids, MAX_BUBBLES);
}

/** sparkles per pop for the quality level */
export function sparkCount(level: string | undefined, golden: boolean): number {
  const n = level === "low" ? 6 : level === "high" ? 12 : 9;
  return golden ? n * 2 : n;
}

/** circle - circle overlap */
export function circleHit(bx: number, by: number, br: number, px: number, py: number, pr: number): boolean {
  const dx = bx - px;
  const dy = by - py;
  const rr = br + pr;
  return dx * dx + dy * dy <= rr * rr;
}

/** distance from the point (cx, cy) to the segment a-b is <= rad (a fast hand swipe cannot skip a bubble) */
export function segHit(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, rad: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-6 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - cx;
  const qy = ay + dy * t - cy;
  return qx * qx + qy * qy <= rad * rad;
}

/** radius of the "paw" of a child's hand, in px, from the shoulder width (small bodies get a generous reach) */
export function pawRadius(scale: number, stageH: number): number {
  return clamp(scale * 0.32, stageH * 0.03, stageH * 0.07);
}

// ------------------------------------------------------------------ bubbles
export class BubblePool {
  readonly x = new Float32Array(MAX_BUBBLES);
  readonly y = new Float32Array(MAX_BUBBLES);
  readonly x0 = new Float32Array(MAX_BUBBLES);
  readonly r = new Float32Array(MAX_BUBBLES);
  readonly vy = new Float32Array(MAX_BUBBLES);
  readonly amp = new Float32Array(MAX_BUBBLES);
  readonly freq = new Float32Array(MAX_BUBBLES);
  readonly phase = new Float32Array(MAX_BUBBLES);
  readonly age = new Float32Array(MAX_BUBBLES);
  /** 1 -> 0 after a touch (squash animation) */
  readonly hurt = new Float32Array(MAX_BUBBLES);
  /** touch cooldown (s) */
  readonly cool = new Float32Array(MAX_BUBBLES);
  readonly kind = new Uint8Array(MAX_BUBBLES);
  /** colour bubbles: the slot whose colour it has; otherwise -1 */
  readonly owner = new Int8Array(MAX_BUBBLES);
  /** touches left (golden: 2) */
  readonly hp = new Uint8Array(MAX_BUBBLES);
  /** who touched a golden bubble first, -1 = nobody yet */
  readonly first = new Int8Array(MAX_BUBBLES);
  /** pastel tint index of a normal bubble */
  readonly tint = new Uint8Array(MAX_BUBBLES);
  readonly alive = new Uint8Array(MAX_BUBBLES);
  count = 0;
  /** colour bubbles alive per slot (to never have two of the same colour) */
  readonly colourAlive = new Uint8Array(SLOTS);
  goldAlive = 0;

  /** Spawns a bubble into a free cell; returns its index or -1 when the pool is full / `cap` reached. */
  spawn(kind: BubbleKind, x: number, y: number, r: number, vy: number, owner: number, tint: number, amp: number, freq: number, phase: number, cap = MAX_BUBBLES): number {
    if (this.count >= cap) return -1;
    let i = 0;
    while (i < MAX_BUBBLES && this.alive[i]) i++;
    if (i >= MAX_BUBBLES) return -1;
    this.alive[i] = 1;
    this.count++;
    this.x[i] = x;
    this.x0[i] = x;
    this.y[i] = y;
    this.r[i] = r;
    this.vy[i] = vy;
    this.amp[i] = amp;
    this.freq[i] = freq;
    this.phase[i] = phase;
    this.age[i] = 0;
    this.hurt[i] = 0;
    this.cool[i] = 0;
    this.kind[i] = kind;
    this.owner[i] = owner;
    this.hp[i] = kind === KIND_GOLD ? 2 : 1;
    this.first[i] = -1;
    this.tint[i] = tint;
    if (kind === KIND_COLOUR && owner >= 0) this.colourAlive[owner]++;
    if (kind === KIND_GOLD) this.goldAlive++;
    return i;
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    if (this.kind[i] === KIND_COLOUR && this.owner[i] >= 0 && this.colourAlive[this.owner[i]] > 0) this.colourAlive[this.owner[i]]--;
    if (this.kind[i] === KIND_GOLD && this.goldAlive > 0) this.goldAlive--;
  }

  clear(): void {
    for (let i = 0; i < MAX_BUBBLES; i++) this.kill(i);
  }

  /** float up with a gentle sway; bubbles that left the top are recycled quietly (nothing is ever "lost") */
  step(dt: number): void {
    for (let i = 0; i < MAX_BUBBLES; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      this.y[i] -= this.vy[i] * dt;
      this.x[i] = this.x0[i] + Math.sin(this.age[i] * this.freq[i] + this.phase[i]) * this.amp[i];
      if (this.hurt[i] > 0) this.hurt[i] = Math.max(0, this.hurt[i] - dt * 3);
      if (this.cool[i] > 0) this.cool[i] -= dt;
      if (this.y[i] < -this.r[i] * 1.5) this.kill(i);
    }
  }

  /**
   * A hand touched bubble `i`. Returns true when it popped (normal / colour: at once, golden: on the 2nd touch).
   * The first toucher of a golden bubble is remembered so that two children share the reward.
   */
  touch(i: number, slot: number): boolean {
    if (!this.alive[i] || this.cool[i] > 0) return false;
    if (this.first[i] < 0) this.first[i] = slot;
    if (this.hp[i] > 1) {
      this.hp[i]--;
      this.hurt[i] = 1;
      this.cool[i] = TOUCH_COOLDOWN;
      return false;
    }
    return true;
  }
}

// ------------------------------------------------------------------ spawner
export interface SpawnEnv {
  w: number;
  h: number;
  /** max bubbles now (quality / children) */
  cap: number;
  /** present children, compacted: kidX[0..nKids) */
  nKids: number;
  kidX: Float32Array;
  kidSlot: Int8Array;
}

export function makeEnv(): SpawnEnv {
  return { w: 1280, h: 720, cap: 9, nKids: 0, kidX: new Float32Array(SLOTS), kidSlot: new Int8Array(SLOTS) };
}

export class Spawner {
  cool = 0.3;
  goldT: number;
  colourT: number;
  private lane = 0;
  private colourCursor = 0;
  /** counters for tests / debug */
  spawned = 0;
  golds = 0;
  colours = 0;

  constructor(private rand: () => number = Math.random) {
    this.goldT = 14 + rand() * 6;
    this.colourT = 6 + rand() * 2;
  }

  /** x of a new bubble: mostly in front of the children (round robin, so everybody gets some), a bit anywhere */
  pickX(env: SpawnEnv, r: number): number {
    let x: number;
    if (env.nKids > 0 && this.rand() < 0.7) {
      this.lane = (this.lane + 1) % env.nKids;
      x = env.kidX[this.lane] + (this.rand() - 0.5) * env.w * 0.3;
    } else {
      x = this.rand() * env.w;
    }
    return clamp(x, r + 8, env.w - r - 8);
  }

  private make(pool: BubblePool, env: SpawnEnv, kind: BubbleKind, y: number): number {
    const h = env.h;
    const rand = this.rand;
    let r: number;
    let vy: number;
    let owner = -1;
    if (kind === KIND_GOLD) {
      r = h * 0.125;
      vy = h * 0.09;
    } else if (kind === KIND_COLOUR) {
      r = h * 0.095;
      vy = h * 0.12;
      // the next present child that has no colour bubble yet
      for (let n = 0; n < env.nKids; n++) {
        const c = (this.colourCursor + n) % env.nKids;
        const s = env.kidSlot[c];
        if (!pool.colourAlive[s]) {
          owner = s;
          this.colourCursor = c + 1;
          break;
        }
      }
      if (owner < 0) return -1;
    } else {
      r = h * (0.075 + rand() * 0.04);
      vy = h * (0.11 + rand() * 0.08);
    }
    const x = this.pickX(env, r);
    const sy = y < 0 ? h + r + 4 : y;
    const i = pool.spawn(kind, x, sy, r, vy, owner, Math.floor(rand() * 5), 6 + rand() * 18, 0.8 + rand() * 1.2, rand() * 6.28, env.cap);
    if (i >= 0) {
      this.spawned++;
      if (kind === KIND_GOLD) this.golds++;
      if (kind === KIND_COLOUR) this.colours++;
    }
    return i;
  }

  /** start of the round: the screen is not empty */
  prefill(pool: BubblePool, env: SpawnEnv): void {
    const n = Math.max(2, Math.round(env.cap * 0.6));
    for (let k = 0; k < n; k++) this.make(pool, env, KIND_NORMAL, env.h * (0.35 + this.rand() * 0.6));
  }

  /** one frame of spawning: tops the pool up to `env.cap`, at most one new bubble per ~0.3 s */
  tick(dt: number, pool: BubblePool, env: SpawnEnv): void {
    this.cool -= dt;
    this.goldT -= dt;
    this.colourT -= dt;
    if (this.cool > 0 || pool.count >= env.cap) return;
    let kind: BubbleKind = KIND_NORMAL;
    if (this.goldT <= 0 && !pool.goldAlive && env.cap >= 5) kind = KIND_GOLD;
    else if (this.colourT <= 0 && env.nKids > 0) kind = KIND_COLOUR;
    let i = this.make(pool, env, kind, -1);
    if (i < 0 && kind !== KIND_NORMAL) {
      // no free colour: a normal bubble instead
      this.colourT = 1.5;
      i = this.make(pool, env, KIND_NORMAL, -1);
    }
    if (i < 0) return;
    if (kind === KIND_GOLD) this.goldT = 20 + this.rand() * 8;
    else if (kind === KIND_COLOUR) this.colourT = 9 + this.rand() * 4;
    // the emptier the sky, the faster the next one
    const deficit = 1 - pool.count / env.cap;
    this.cool = 0.18 + 0.35 * (1 - deficit) + this.rand() * 0.2;
  }
}

// ------------------------------------------------------------------ scoring
export class Scorer {
  readonly pops = new Int32Array(SLOTS);
  total = 0;
  goldPops = 0;
  colourBonuses = 0;
  /** result of the last pop() call */
  kidStars = 0;
  groupStars = 0;
  /** golden bubble shared with another child: stars for the one who touched it first */
  firstStars = 0;
  firstSlot = -1;

  /**
   * `popper` popped a bubble of `kind` (colour bubble: `owner` = whose colour it has, golden: `first` = first toucher).
   * Normal rule: every POPS_PER_STAR-th pop of a child gives that child a star. Colour bubble popped by its owner:
   * +COLOUR_BONUS stars for the whole group. Golden: 2 stars for the popper (3 when alone) + 1 for the first toucher.
   */
  pop(kind: number, owner: number, popper: number, first: number): void {
    this.kidStars = 0;
    this.groupStars = 0;
    this.firstStars = 0;
    this.firstSlot = -1;
    this.total++;
    this.pops[popper]++;
    if (kind === KIND_GOLD) {
      this.goldPops++;
      if (first >= 0 && first !== popper) {
        this.kidStars = 2;
        this.firstStars = 1;
        this.firstSlot = first;
      } else {
        this.kidStars = 3;
      }
      return;
    }
    if (this.pops[popper] % POPS_PER_STAR === 0) this.kidStars = 1;
    if (kind === KIND_COLOUR && owner === popper) {
      this.groupStars = COLOUR_BONUS;
      this.colourBonuses++;
    }
  }
}

// ------------------------------------------------------------------ effects
/** sparkle ring buffer: the oldest one is overwritten when full */
export class Sparks {
  readonly x = new Float32Array(MAX_SPARKS);
  readonly y = new Float32Array(MAX_SPARKS);
  readonly vx = new Float32Array(MAX_SPARKS);
  readonly vy = new Float32Array(MAX_SPARKS);
  readonly life = new Float32Array(MAX_SPARKS);
  readonly size = new Float32Array(MAX_SPARKS);
  readonly col = new Uint8Array(MAX_SPARKS);
  private cursor = 0;

  burst(x: number, y: number, n: number, col: number, speed: number, size: number, rand: () => number, white = 5): void {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_SPARKS;
      const a = (k / n) * 6.2832 + rand() * 0.6;
      const s = speed * (0.45 + rand() * 0.7);
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
      this.life[i] = 0.7 + rand() * 0.3;
      this.size[i] = size * (0.6 + rand() * 0.7);
      this.col[i] = k & 1 ? white : col;
    }
  }

  step(dt: number, gravity: number): void {
    const drag = Math.max(0, 1 - dt * 2.2);
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 1.7;
      this.vx[i] *= drag;
      this.vy[i] = this.vy[i] * drag + gravity * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }

  get active(): number {
    let n = 0;
    for (let i = 0; i < MAX_SPARKS; i++) if (this.life[i] > 0) n++;
    return n;
  }
}

/** expanding rings left by a pop */
export class Rings {
  readonly x = new Float32Array(MAX_RINGS);
  readonly y = new Float32Array(MAX_RINGS);
  readonly r0 = new Float32Array(MAX_RINGS);
  readonly r1 = new Float32Array(MAX_RINGS);
  /** 1 -> 0 */
  readonly life = new Float32Array(MAX_RINGS);
  readonly col = new Uint8Array(MAX_RINGS);
  private cursor = 0;

  add(x: number, y: number, r0: number, r1: number, col: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_RINGS;
    this.x[i] = x;
    this.y[i] = y;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.life[i] = 1;
    this.col[i] = col;
  }

  step(dt: number): void {
    for (let i = 0; i < MAX_RINGS; i++) if (this.life[i] > 0) this.life[i] -= dt * 3.2;
  }
}
