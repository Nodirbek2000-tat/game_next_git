// Sanaymiz: pure, allocation-free logic (round plan, counting, balloons, round clock). The game (game.ts) only paints.

export const SLOTS = 5;

export type RoundKind = "jump" | "clap" | "colour";
export interface Round {
  kind: RoundKind;
  /** 1..5 for jump / clap rounds */
  n: number;
  /** 0..3 (index into COLOURS) for colour rounds */
  colour: number;
}

export interface Colour {
  /** "Qizil" */
  name: string;
  /** "Qizil sharni ushlang!" */
  prompt: string;
  hex: string;
  icon: string;
}
export const COLOURS: readonly Colour[] = [
  { name: "Qizil", prompt: "Qizil sharni ushlang!", hex: "#ff3b3b", icon: "🔴" },
  { name: "Sariq", prompt: "Sariq sharni ushlang!", hex: "#ffd60a", icon: "🟡" },
  { name: "Ko‘k", prompt: "Ko‘k sharni ushlang!", hex: "#2f7dff", icon: "🔵" },
  { name: "Yashil", prompt: "Yashil sharni ushlang!", hex: "#2fcf5a", icon: "🟢" },
];

/** the number words (spoken when a count is reached) */
export const NUMBER_WORDS: readonly string[] = ["Bir", "Ikki", "Uch", "To‘rt", "Besh"];

export function roundText(r: Round): { text: string; icon: string } {
  if (r.kind === "colour") return { text: COLOURS[r.colour].prompt, icon: COLOURS[r.colour].icon };
  if (r.kind === "jump") return { text: `${r.n} marta sakrang!`, icon: "🐰" };
  return { text: `${r.n} marta qarsak!`, icon: "👏" };
}

/** Test / teacher aid: "jump3,col0,clap2" -> rounds. Unknown tokens are skipped. */
export function parseSeq(s: string | null): Round[] {
  const out: Round[] = [];
  if (!s) return out;
  for (const tok of s.split(",")) {
    const m = /^(jump|clap)([1-5])$/.exec(tok.trim());
    if (m) {
      out.push({ kind: m[1] as RoundKind, n: Number(m[2]), colour: 0 });
      continue;
    }
    const c = /^col([0-3])$/.exec(tok.trim());
    if (c) out.push({ kind: "colour", n: 0, colour: Number(c[1]) });
  }
  return out;
}

/**
 * The plan of a game: counting rounds (jumps and claps, numbers 1..5) alternate with colour rounds (all four colours come
 * round). The first counting rounds are easy (1..3), the same number never comes twice in a row.
 */
export function makeRounds(rnd: () => number = Math.random, total = 12): Round[] {
  const out: Round[] = [];
  let lastN = 0;
  let nCount = 0;
  let nColour = 0;
  let colours = [0, 1, 2, 3];
  for (let i = colours.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [colours[i], colours[j]] = [colours[j], colours[i]];
  }
  for (let i = 0; i < total; i++) {
    if (i % 2 === 1) {
      out.push({ kind: "colour", n: 0, colour: colours[nColour % 4] });
      nColour++;
      if (nColour % 4 === 0) colours = colours.slice().reverse();
      continue;
    }
    const maxN = nCount < 2 ? 3 : 5;
    let n = 1 + Math.floor(rnd() * maxN);
    if (n === lastN) n = (n % maxN) + 1;
    lastN = n;
    out.push({ kind: nCount % 2 === 0 ? "jump" : "clap", n, colour: 0 });
    nCount++;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ counting

/** Per-child count of jumps / claps in the current round. A child who reached the number is done; further moves are ignored. */
export class CountRound {
  readonly count = new Uint8Array(SLOTS);
  readonly done = new Uint8Array(SLOTS);
  n = 1;

  reset(n: number): void {
    this.n = Math.max(1, Math.min(5, n));
    this.count.fill(0);
    this.done.fill(0);
  }

  /** a jump / clap of `slot`: returns the new count (1..n), or 0 when ignored (the child is already done) */
  hit(slot: number): number {
    if (this.done[slot]) return 0;
    const c = ++this.count[slot];
    if (c >= this.n) this.done[slot] = 1;
    return c;
  }

  /** the best count of any child (for the row of objects) */
  best(): number {
    let b = 0;
    for (let i = 0; i < SLOTS; i++) if (this.count[i] > b) b = this.count[i];
    return b;
  }
}

/** true when at least one child is present and every present child is done */
export function allDone(present: ArrayLike<number>, done: ArrayLike<number>): boolean {
  let any = false;
  for (let i = 0; i < SLOTS; i++) {
    if (!present[i]) continue;
    any = true;
    if (!done[i]) return false;
  }
  return any;
}

// ------------------------------------------------------------------------------------------ round clock

export type Phase = "intro" | "play" | "praise";
export const EV_NONE = 0;
export const EV_PLAY = 1;
export const EV_PRAISE = 2;
export const EV_NEXT = 3;

/** intro (the task is shown) -> play (until everybody is done or the time is up) -> praise -> next round. Nothing is ever lost. */
export class RoundClock {
  phase: Phase = "intro";
  t = 0;
  maxPlay = 12;
  constructor(
    public introSec = 1.8,
    public praiseSec = 2.4,
  ) {}

  /** `maxPlay`: seconds of the play phase; the play timer only runs while somebody is there */
  begin(maxPlay: number): void {
    this.phase = "intro";
    this.t = 0;
    this.maxPlay = maxPlay;
  }

  tick(dt: number, everyoneDone: boolean, anyKid: boolean): number {
    if (this.phase === "intro") {
      this.t += dt;
      if (this.t >= this.introSec) {
        this.phase = "play";
        this.t = 0;
        return EV_PLAY;
      }
    } else if (this.phase === "play") {
      if (anyKid) this.t += dt;
      if (everyoneDone || this.t >= this.maxPlay) {
        this.phase = "praise";
        this.t = 0;
        return EV_PRAISE;
      }
    } else {
      this.t += dt;
      if (this.t >= this.praiseSec) return EV_NEXT;
    }
    return EV_NONE;
  }
}

/** seconds a counting round may last: 1 jump = ~1.6 s of a small child */
export const countMaxPlay = (n: number): number => 9 + 1.6 * n;
export const COLOUR_MAX_PLAY = 14;

// ------------------------------------------------------------------------------------------ geometry

/** does the segment (x0,y0)-(x1,y1) come within `rad` of the circle centre (cx,cy)? (a point when x0==x1 && y0==y1) */
export function segCircle(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, rad: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const px = cx - x0;
  const py = cy - y0;
  let t = l2 > 1e-6 ? (px * dx + py * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - dx * t;
  const ey = py - dy * t;
  return ex * ex + ey * ey <= rad * rad;
}

// ------------------------------------------------------------------------------------------ balloons

export const MAX_BALLOONS = 10;

export interface BalloonEnv {
  w: number;
  h: number;
  /** colour to catch, -1 = no colour round */
  target: number;
  /** how many balloons of the target colour should float at least */
  need: number;
  /** how many balloons float in total */
  cap: number;
  nKids: number;
  kidX: Float32Array;
}

export function makeEnv(): BalloonEnv {
  return { w: 1280, h: 720, target: -1, need: 0, cap: 8, nKids: 0, kidX: new Float32Array(SLOTS) };
}

/** Pooled balloons (struct of arrays). They rise slowly and sway; the ones that left the screen are freed. */
export class Balloons {
  readonly x = new Float32Array(MAX_BALLOONS);
  readonly y = new Float32Array(MAX_BALLOONS);
  readonly vx = new Float32Array(MAX_BALLOONS);
  readonly vy = new Float32Array(MAX_BALLOONS);
  readonly phase = new Float32Array(MAX_BALLOONS);
  readonly colour = new Uint8Array(MAX_BALLOONS);
  readonly alive = new Uint8Array(MAX_BALLOONS);
  count = 0;
  spawned = 0;
  /** balloon radius in px (horizontal); set from the stage height */
  r = 40;

  constructor(private readonly rnd: () => number = Math.random) {}

  clear(): void {
    this.alive.fill(0);
    this.count = 0;
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
  }

  targetAlive(target: number): number {
    let n = 0;
    for (let i = 0; i < MAX_BALLOONS; i++) if (this.alive[i] && this.colour[i] === target) n++;
    return n;
  }

  /** spawns one balloon; `high`: somewhere on the screen (round start / replacement), else under the bottom edge */
  spawn(env: BalloonEnv, colour: number, high: boolean): boolean {
    let slot = -1;
    for (let i = 0; i < MAX_BALLOONS; i++)
      if (!this.alive[i]) {
        slot = i;
        break;
      }
    if (slot < 0) return false;
    const rnd = this.rnd;
    const r = this.r;
    let x = env.w * (0.1 + rnd() * 0.8);
    // most of them rise in front of a child (hands can reach them)
    if (env.nKids > 0 && rnd() < 0.7) x = env.kidX[Math.floor(rnd() * env.nKids) % env.nKids] + (rnd() - 0.5) * env.w * 0.3;
    this.x[slot] = Math.min(env.w - r, Math.max(r, x));
    this.y[slot] = high ? env.h * (0.45 + rnd() * 0.55) : env.h + r * 1.5;
    this.vx[slot] = 0;
    this.vy[slot] = -env.h * (0.075 + rnd() * 0.05);
    this.phase[slot] = rnd() * 6.28;
    this.colour[slot] = colour;
    this.alive[slot] = 1;
    this.count++;
    this.spawned++;
    return true;
  }

  /** keeps `env.need` balloons of the target colour (and `env.cap` in total) floating; at most 2 spawns per call */
  refill(env: BalloonEnv, high: boolean): void {
    let budget = high ? MAX_BALLOONS : 2;
    while (budget-- > 0) {
      if (env.target >= 0 && this.targetAlive(env.target) < env.need) {
        if (!this.spawn(env, env.target, high)) return;
      } else if (this.count < env.cap) {
        let c = Math.floor(this.rnd() * 4) % 4;
        if (c === env.target) c = (c + 1 + Math.floor(this.rnd() * 3)) % 4; // fewer target-coloured ones than the others
        if (!this.spawn(env, c, high)) return;
      } else return;
    }
  }

  step(dt: number, t: number, env: BalloonEnv): void {
    const r = this.r;
    for (let i = 0; i < MAX_BALLOONS; i++) {
      if (!this.alive[i]) continue;
      this.vx[i] *= Math.max(0, 1 - dt * 2.5);
      this.x[i] += (this.vx[i] + Math.sin(t * 1.3 + this.phase[i]) * env.w * 0.012) * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.x[i] < r) this.x[i] = r;
      else if (this.x[i] > env.w - r) this.x[i] = env.w - r;
      if (this.y[i] < -r * 2) this.kill(i);
    }
  }
}
