// Eng, sakra: the bars (spawning, speed, judging). Body detection lives in ./stance. No engine imports, easy to test.

export { Calm, Stance, readBody, type LmLike } from "./stance";

export type Kind = 0 | 1; // 0 = high bar (duck: ENG), 1 = low bar (jump: SAKRA)

export interface Gate {
  active: boolean;
  kind: Kind;
  /** seconds since the bar appeared at the horizon */
  t: number;
  /** seconds from appearing to reaching the player */
  dur: number;
  /** 0 = on its way, 1 = cleared, 2 = hit */
  state: 0 | 1 | 2;
  perfect: boolean;
  /** the warning sound / banner was started */
  warned: boolean;
  /** seconds since the verdict */
  since: number;
}

/** the warning ("ENG!" / "SAKRA!") starts this long before the bar arrives */
export const WARN = 1.0;
/** the action may have ended up to this long before the bar arrives (camera delay) */
export const BEFORE = 0.08;
/** an action detected up to this long after the bar arrived still counts (camera delay) */
export const AFTER = 0.22;
/** a jump this long before a high bar arrives spoils the duck */
const AIR_SPOIL = 0.05;
const WRONG_WIN = 0.3;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export type GateEvent = 0 | 1 | 2;

/**
 * Spawns bars (faster and more often as the round goes) and judges each one when it arrives.
 * High bar: needs a duck and no jump. Low bar: needs a jump. `update` returns 0 / 1 (cleared) / 2 (hit);
 * `last*` describe the bar judged.
 */
export class Gates {
  readonly pool: Gate[] = [];
  time = 0;
  lastKind: Kind = 0;
  lastPerfect = false;
  /** the opposite action was seen instead (jumped at a high bar / ducked at a low one) */
  lastWrong = false;
  /** kind of the bar whose warning started this frame, -1 = none */
  warnKind: -1 | Kind = -1;
  /** a bar reached the player this frame */
  arrived = false;
  /** bars spawned so far */
  count = 0;
  private nextAt = 0.9;
  private prevKind = -1;
  private run = 0;
  private queuedKind = -1;
  private queuedAt = 0;
  private clock = 0;
  private lastAir = -99;
  private lastDuck = -99;

  constructor(
    private readonly rand: () => number = Math.random,
    private readonly horizon = 45,
  ) {
    for (let i = 0; i < 6; i++) this.pool.push({ active: false, kind: 0, t: 0, dur: 1, state: 0, perfect: false, warned: false, since: 0 });
  }

  /** 0..1 how far the round has ramped up */
  get prog(): number {
    return Math.max(0, Math.min(1, this.time / this.horizon));
  }
  /** seconds a bar needs from the horizon to the player right now */
  get approach(): number {
    return lerp(1.9, 1.25, this.prog);
  }

  /** the bar that arrives next (not judged yet), null when none */
  next(): Gate | null {
    let best: Gate | null = null;
    for (const g of this.pool) if (g.active && g.state === 0 && g.t < g.dur + AFTER && (!best || g.dur - g.t < best.dur - best.t)) best = g;
    return best;
  }

  update(dt: number, air: boolean, duck: boolean, go = true): GateEvent {
    this.clock += dt;
    this.warnKind = -1;
    this.arrived = false;
    if (air) this.lastAir = this.clock;
    if (duck) this.lastDuck = this.clock;
    if (go) {
      this.time += dt;
      if (this.queuedKind >= 0 && this.time >= this.queuedAt) {
        this.spawn(this.queuedKind as Kind, this.approach);
        this.queuedKind = -1;
      }
      if (this.time >= this.nextAt) this.schedule();
    }
    let res: GateEvent = 0;
    for (const g of this.pool) {
      if (!g.active) continue;
      const before = g.t;
      g.t += dt;
      if (g.state !== 0) {
        g.since += dt;
        if (g.since > 0.45) g.active = false;
        continue;
      }
      if (!g.warned && g.t >= g.dur - WARN) {
        g.warned = true;
        this.warnKind = g.kind;
      }
      if (before < g.dur && g.t >= g.dur) this.arrived = true;
      if (g.t < g.dur) continue;
      // the bar is at the player: judge now if the action is already there, else give the camera delay as grace time
      const e = g.t - g.dur;
      const tArr = this.clock - e;
      const sawAir = this.lastAir >= tArr - (g.kind === 0 ? AIR_SPOIL : BEFORE);
      const sawDuck = this.lastDuck >= tArr - BEFORE;
      const ok = g.kind === 1 ? sawAir : sawDuck && !sawAir;
      if (ok || e >= AFTER) {
        g.state = ok ? 1 : 2;
        g.since = 0;
        g.perfect = ok && before < g.dur && (g.kind === 1 ? air : duck && !sawAir);
        this.lastKind = g.kind;
        this.lastPerfect = g.perfect;
        this.lastWrong = !ok && (g.kind === 0 ? this.lastAir >= tArr - WRONG_WIN : this.lastDuck >= tArr - WRONG_WIN);
        res = g.state;
      }
    }
    return res;
  }

  private schedule(): void {
    const prog = this.prog;
    const gap = lerp(2.5, 1.55, prog);
    const dur = this.approach;
    // from time to time a quick double: low bar, then a high one (or the other way round)
    if (this.count >= 4 && this.time > 14 && this.rand() < 0.18 + 0.2 * prog) {
      let first: Kind = this.rand() < 0.7 ? 1 : 0;
      if (this.run >= 2 && first === this.prevKind) first = first === 0 ? 1 : 0;
      const pairGap = lerp(1.1, 0.9, prog);
      this.spawn(first, dur);
      this.queuedKind = first === 1 ? 0 : 1;
      this.queuedAt = this.time + pairGap;
      this.nextAt = this.time + pairGap + gap;
      return;
    }
    this.nextAt = this.time + gap;
    let kind: Kind = this.count === 0 ? 0 : this.count === 1 ? 1 : this.rand() < 0.5 ? 0 : 1;
    if (this.run >= 2 && kind === this.prevKind) kind = kind === 0 ? 1 : 0;
    this.spawn(kind, dur);
  }

  private spawn(kind: Kind, dur: number): void {
    const g = this.pool.find((x) => !x.active);
    if (!g) return;
    this.run = kind === this.prevKind ? this.run + 1 : 1;
    this.prevKind = kind;
    this.count++;
    g.active = true;
    g.kind = kind;
    g.t = 0;
    g.dur = dur;
    g.state = 0;
    g.perfect = false;
    g.warned = false;
    g.since = 0;
  }
}

