// Baliqcha game logic (no canvas, no browser APIs): one `Angler` per kid slot, the pond with its fish, the shared basket,
// the splashes. The kit's `KidSlot`s are only read. All output goes through the `Sink` (sounds, stars) so it is testable.

import type { KidSlot } from "@/engine/tracking/kids";
import { MAX_KIDS } from "@/engine/tracking/kids";
import { Angler, EV, ST, TUNE, type AnglerInput } from "./angler";
import { BASKET, FM, GOLDEN, Pond } from "./pond";
import { GroupVoice } from "./voiceGroup";

/** shoulders / head are trusted from this visibility on */
const MIN_VIS = 0.15;
/** a hand is trusted from here: a far child's wrists are seen poorly but still move clearly */
const HAND_VIS = 0.1;
/** floats of two children are at least this far apart (fraction of the stage width) */
export const FLOAT_GAP = 0.1;

/** where the float of each slot lands (fraction of the stage height): staggered so floats of neighbours do not overlap */
export const FLOAT_LANE: readonly number[] = [0.58, 0.7, 0.6, 0.72, 0.64];

export interface Sink {
  /** the line is thrown (float starts flying) */
  cast?(slot: number): void;
  /** the float landed at stage fractions (x, y) */
  land?(slot: number, x: number, y: number): void;
  /** the fish bites */
  bite?(slot: number, x: number, y: number): void;
  /** the fish is pulled out of the water */
  pull?(slot: number, x: number, y: number): void;
  /** the fish arrived in the basket; `golden` = the rare golden fish; `stars` to give */
  caught?(slot: number, golden: boolean, stars: number): void;
}

/**
 * Height of the child's best hand above the shoulder line, in shoulder widths (negative = below the shoulders).
 * Very tolerant: a hand that left the picture at the top counts through the elbow; without shoulders the head is used.
 */
export function handHeight(k: KidSlot): number {
  const p = k.pts;
  // a tiny shoulder width would blow up every noise pixel: never below 12 px
  const scale = Math.max(12, k.scale);
  let sy: number;
  if (p.ls.v >= MIN_VIS && p.rs.v >= MIN_VIS) sy = (p.ls.y + p.rs.y) / 2;
  else if (p.ls.v >= MIN_VIS) sy = p.ls.y;
  else if (p.rs.v >= MIN_VIS) sy = p.rs.y;
  else sy = p.head.y + k.headR * 2;
  let best = -9;
  if (p.lw.v >= HAND_VIS) best = (sy - p.lw.y) / scale;
  if (p.rw.v >= HAND_VIS) {
    const u = (sy - p.rw.y) / scale;
    if (u > best) best = u;
  }
  if (best < TUNE.upOn) {
    // the wrist is hidden / left the picture: a raised elbow still means "hand up"
    if (p.le.v >= HAND_VIS) {
      const u = ((sy - p.le.y) / scale) * 1.8;
      if (u > best && u > 0.3) best = u;
    }
    if (p.re.v >= HAND_VIS) {
      const u = ((sy - p.re.y) / scale) * 1.8;
      if (u > best && u > 0.3) best = u;
    }
  }
  return best;
}

export const N_SPLASH = 16;

export class Baliqcha {
  readonly anglers: Angler[] = [];
  readonly pond: Pond;
  readonly voice = new GroupVoice();
  /** fish of each slot (shown on the avatar) */
  readonly catches = new Int16Array(MAX_KIDS);
  /** where each float lands (fractions) */
  readonly floatX = new Float32Array(MAX_KIDS);
  readonly floatY = new Float32Array(MAX_KIDS);
  /** fish in the shared basket and the colours of the latest ones */
  basket = 0;
  readonly basketCol = new Uint8Array(6);
  /** 1 -> 0 pulse of the basket when a fish arrives */
  basketPulse = 0;
  /** splash pool (ring): fractions, age (s), big */
  readonly spX = new Float32Array(N_SPLASH);
  readonly spY = new Float32Array(N_SPLASH);
  readonly spT = new Float32Array(N_SPLASH).fill(99);
  readonly spBig = new Uint8Array(N_SPLASH);
  private spNext = 0;
  private readonly inp: AnglerInput = { present: false, up: -1, voiceCast: false, voicePull: false };
  private readonly vOut = { cast: false, pull: false };

  constructor(
    private kids: readonly KidSlot[],
    private sink: Sink = {},
    rand: () => number = Math.random,
  ) {
    for (let i = 0; i < MAX_KIDS; i++) {
      this.anglers.push(new Angler(rand));
      this.floatX[i] = 0.5;
      this.floatY[i] = FLOAT_LANE[i] ?? 0.62;
    }
    this.pond = new Pond(rand);
  }

  splash(x: number, y: number, big: boolean): void {
    const i = this.spNext;
    this.spNext = (i + 1) % N_SPLASH;
    this.spX[i] = x;
    this.spY[i] = y;
    this.spT[i] = 0;
    this.spBig[i] = big ? 1 : 0;
  }

  /** stage: size in px (only the width is used, to put the float in front of the child) */
  update(dt: number, stageW: number): void {
    const v = this.vOut;
    this.voice.update(dt);
    this.voice.take(v);
    let anyIdle = false;
    let anyBite = false;
    const inp = this.inp;
    for (let i = 0; i < MAX_KIDS; i++) {
      const k = this.kids[i];
      const ang = this.anglers[i];
      if (!k || !k.active || k.joined) {
        if (ang.state !== ST.idle || ang.cool > 0 || ang.idleT > 0) {
          this.pond.release(i);
          ang.reset();
        }
        if (k?.joined) this.catches[i] = 0;
        if (!k || !k.active) continue;
      }
      inp.present = k.present;
      inp.up = k.present ? handHeight(k) : -1;
      inp.voiceCast = v.cast;
      inp.voicePull = v.pull;
      const ev = ang.update(dt, inp);
      if (ev) this.onEvents(i, ev, ang, stageW, k);
      if (k.present && ang.state === ST.idle && ang.cool <= 0) anyIdle = true;
      if (ang.state === ST.bite) anyBite = true;
    }
    this.voice.anyIdle = anyIdle;
    this.voice.anyBite = anyBite;
    this.pond.update(dt);
    if (this.basketPulse > 0) this.basketPulse = Math.max(0, this.basketPulse - dt * 3);
    for (let i = 0; i < N_SPLASH; i++) if (this.spT[i] < 5) this.spT[i] += dt;
  }

  /** Free of every other busy float by at least FLOAT_GAP? */
  private floatFree(i: number, x: number): boolean {
    for (let j = 0; j < MAX_KIDS; j++) {
      if (j === i || this.anglers[j].state === ST.idle) continue;
      if (Math.abs(x - this.floatX[j]) < FLOAT_GAP - 1e-4) return false;
    }
    return true;
  }

  /** x (fraction) for the float of slot `i`: in front of the child, but never on top of another child's float */
  private floatSpot(i: number, x: number): number {
    const lo = 0.08;
    const hi = 0.92;
    const want = Math.min(hi, Math.max(lo, x));
    if (this.floatFree(i, want)) return want;
    // otherwise the nearest free place right next to one of the busy floats
    let best = want;
    let bestD = Infinity;
    for (let j = 0; j < MAX_KIDS; j++) {
      if (j === i || this.anglers[j].state === ST.idle) continue;
      for (let side = -1; side <= 1; side += 2) {
        const c = this.floatX[j] + side * FLOAT_GAP;
        if (c < lo || c > hi || !this.floatFree(i, c)) continue;
        const d = Math.abs(c - want);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  private onEvents(i: number, ev: number, ang: Angler, stageW: number, k: KidSlot): void {
    const pond = this.pond;
    if (ev & EV.cast) {
      this.floatX[i] = this.floatSpot(i, k.center.x / Math.max(1, stageW));
      this.floatY[i] = FLOAT_LANE[i] ?? 0.62;
      this.sink.cast?.(i);
    }
    if (ev & EV.land) {
      const x = this.floatX[i];
      const y = this.floatY[i];
      pond.send(i, x, y, ang.biteIn * 0.85);
      this.splash(x, y, false);
      this.sink.land?.(i, x, y);
    }
    if (ev & EV.bite) {
      pond.hook(i);
      this.splash(this.floatX[i], this.floatY[i], false);
      this.sink.bite?.(i, this.floatX[i], this.floatY[i]);
    }
    if (ev & EV.pull) {
      pond.reel(i, TUNE.reelTime);
      this.splash(this.floatX[i], this.floatY[i], true);
      this.sink.pull?.(i, this.floatX[i], this.floatY[i]);
    }
    if (ev & EV.catch) {
      const f = pond.fishOf[i];
      const golden = f === GOLDEN;
      const col = f >= 0 ? pond.color[f] : 0;
      pond.land(i);
      this.catches[i]++;
      this.basketCol[this.basket % this.basketCol.length] = col;
      this.basket++;
      this.basketPulse = 1;
      this.splash(BASKET.x, BASKET.y - 0.04, false);
      this.sink.caught?.(i, golden, golden ? 3 : 1);
    }
  }

  /** Is a fish of this slot on its way (shown, flying) — used by the painter */
  fishState(slot: number): number {
    const f = this.pond.fishOf[slot];
    return f >= 0 ? this.pond.mode[f] : FM.swim;
  }
}
