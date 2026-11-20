// Nurli tor: pure logic (no engine, no audio, no drawing) — easy to test.
//
//  * HandTracks: the hands of the hand model keep their identity from frame to frame and are moved forward to "now" by their
//    speed (the picture the model saw is 30..60 ms old: drawn where the finger IS, not where it was).
//  * Board: the strings. Pinch thumb + index on both hands = a new string between them; open the fingers = the string stays there
//    in the air. Pinch near an end of a string = grab that end (stretch it; ends brought together = it is removed), pinch on the
//    string itself = move it. A fingertip that touches or crosses a string plucks it. Like a real string: SHORT = HIGH, LONG = LOW.

import type { Instrument, Note } from "./instruments";

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** thumb–index distance / hand size: below CLOSE = pinched, above OPEN = released (hysteresis, no flicker) */
export const PINCH_CLOSE = 0.36;
export const PINCH_OPEN = 0.55;

export class Pinch {
  on = false;
  update(d: number | null): boolean {
    this.on = d === null ? false : this.on ? d < PINCH_OPEN : d < PINCH_CLOSE;
    return this.on;
  }
}

// ------------------------------------------------------------------------------------------- notes

/** string length as a part of the shorter screen side: this long = the lowest note, this short = the highest */
export const LEN_LONG = 0.95;
export const LEN_SHORT = 0.12;
/** shorter than this (part of the screen side) is no string: not placed / removed */
export const LEN_MIN = 0.07;

/** the note (index into a scale of `count` notes) of a string: pitch goes with 1 / length (logarithmic ladder), snapped */
export function noteForLength(len: number, ref: number, count: number): number {
  const f = Math.max(1e-6, len / Math.max(1, ref));
  const t = Math.log(LEN_LONG / f) / Math.log(LEN_LONG / LEN_SHORT);
  return Math.round(Math.max(0, Math.min(1, t)) * (count - 1));
}

/** distance of `p` from the segment a–b and the place along it (0..1) */
export function segDist(p: Pt, a: Pt, b: Pt): { d: number; u: number } {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const l2 = sx * sx + sy * sy || 1;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * sx + (p.y - a.y) * sy) / l2));
  return { d: Math.hypot(p.x - a.x - sx * u, p.y - a.y - sy * u), u };
}

/**
 * Does the move p0 -> p1 cross the segment a–b? Returns the place along a–b (0..1) or -1. The very ends do not count (the orbs
 * there are handles, not the string).
 */
export function crossAt(p0: Pt, p1: Pt, a: Pt, b: Pt, margin = 0.04): number {
  const rx = p1.x - p0.x;
  const ry = p1.y - p0.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const qx = a.x - p0.x;
  const qy = a.y - p0.y;
  const u = (qx * ry - qy * rx) / den; // along the string
  const t = (qx * sy - qy * sx) / den; // along the finger move
  if (t < 0 || t > 1 || u < margin || u > 1 - margin) return -1;
  return u;
}

// ------------------------------------------------------------------------------------------- hands

export interface HandSample {
  /** 21 points, stage px */
  pts: Pt[];
  /** wrist .. middle finger base (px) */
  size: number;
  /** thumb–index distance / size */
  pinchD: number;
}

export interface Hand {
  id: number;
  /** points moved forward to "now" (stage px) */
  pts: Pt[];
  size: number;
  pinchD: number;
  pinch: Pinch;
  /** the pinch point (between thumb and index tip), "now" */
  at: Pt;
  /** fingertips one draw frame ago (for plucking) */
  prevTips: Pt[];
  /** detection: points, velocity (px/s), capture time */
  raw: Pt[];
  vel: Pt[];
  t: number;
  /** the hand moved on a new detection this frame */
  seen: boolean;
  /** it jumped far since the last picture (maybe another hand): no pluck from that move */
  jumped: boolean;
}

export const TIPS = [4, 8, 12, 16, 20];
/** how far ahead (s) a hand is moved at most: the model is 30..60 ms behind, more would overshoot */
const LEAD_MAX = 0.07;
/** a hand not seen for this long (ms) is gone */
const KEEP_MS = 250;

export class HandTracks {
  hands: Hand[] = [];
  private nextId = 1;
  private lastAt = -1;

  /** `samples` = the hands of the last detection, `at` = its capture time (ms), `now` = draw time (ms) */
  update(samples: readonly HandSample[], at: number, now: number): void {
    if (at !== this.lastAt) {
      this.lastAt = at;
      this.ingest(samples, at);
    } else for (const h of this.hands) h.seen = false;
    this.hands = this.hands.filter((h) => now - h.t < KEEP_MS);
    for (const h of this.hands) {
      for (let i = 0; i < TIPS.length; i++) {
        const p = h.pts[TIPS[i]];
        h.prevTips[i].x = p.x;
        h.prevTips[i].y = p.y;
      }
      const lead = Math.max(0, Math.min(LEAD_MAX, (now - h.t) / 1000));
      for (let i = 0; i < 21; i++) {
        h.pts[i].x = h.raw[i].x + h.vel[i].x * lead;
        h.pts[i].y = h.raw[i].y + h.vel[i].y * lead;
      }
      if (h.jumped) {
        h.jumped = false;
        for (let i = 0; i < TIPS.length; i++) Object.assign(h.prevTips[i], h.pts[TIPS[i]]);
      }
      h.at.x = (h.pts[4].x + h.pts[8].x) / 2;
      h.at.y = (h.pts[4].y + h.pts[8].y) / 2;
    }
  }

  private ingest(samples: readonly HandSample[], at: number): void {
    const free = new Set(this.hands);
    for (const s of samples) {
      if (s.pts.length < 21) continue;
      // the same hand = the nearest wrist of the last frame
      let best: Hand | null = null;
      let bd = Infinity;
      for (const h of free) {
        const d = dist(h.raw[0], s.pts[0]);
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
      if (best && bd < Math.max(120, s.size * 5)) {
        free.delete(best);
        best.jumped = bd > s.size * 3;
        const dt = Math.max(0.008, (at - best.t) / 1000);
        // speed with a little smoothing; a still hand stays still (no jitter pushed forward)
        const still = s.size * 0.25;
        for (let i = 0; i < 21; i++) {
          const vx = (s.pts[i].x - best.raw[i].x) / dt;
          const vy = (s.pts[i].y - best.raw[i].y) / dt;
          const fast = Math.hypot(vx, vy) > still;
          best.vel[i].x = fast && dt < 0.15 ? best.vel[i].x * 0.35 + vx * 0.65 : 0;
          best.vel[i].y = fast && dt < 0.15 ? best.vel[i].y * 0.35 + vy * 0.65 : 0;
          best.raw[i].x = s.pts[i].x;
          best.raw[i].y = s.pts[i].y;
        }
        best.size = s.size;
        best.pinchD = s.pinchD;
        best.t = at;
        best.seen = true;
        best.pinch.update(s.pinchD);
      } else {
        const h: Hand = {
          id: this.nextId++,
          pts: s.pts.map((p) => ({ x: p.x, y: p.y })),
          raw: s.pts.map((p) => ({ x: p.x, y: p.y })),
          vel: s.pts.map(() => ({ x: 0, y: 0 })),
          prevTips: TIPS.map((i) => ({ x: s.pts[i].x, y: s.pts[i].y })),
          size: s.size,
          pinchD: s.pinchD,
          pinch: new Pinch(),
          at: { x: 0, y: 0 },
          t: at,
          seen: true,
          jumped: false,
        };
        h.pinch.update(s.pinchD);
        this.hands.push(h);
      }
    }
    for (const h of free) h.seen = false;
  }
}

// ------------------------------------------------------------------------------------------- strings

export interface Str {
  id: number;
  a: Pt;
  b: Pt;
  note: Note;
  /** the instrument whose sound it has */
  inst: string;
  /** a string of a ready instrument: its note stays when it is moved or stretched */
  fixed: boolean;
  /** vibration (px), set by a pluck, decays */
  amp: number;
  /** ms of the last pluck */
  plucked: number;
}

export type BoardEvent =
  | { type: "place"; s: Str }
  | { type: "remove"; s: Str }
  | { type: "tune"; s: Str }
  | { type: "grab"; s: Str }
  | { type: "pluck"; s: Str; vel: number; at: Pt };

export const MAX_STRINGS = 16;
/** a string can be plucked again after this long (ms); several fingers in one stroke are one pluck */
const PLUCK_GAP = 70;

interface Grab {
  s: Str;
  /** an end, or the whole string ("mid": it moves with the hand; oa / ob = hand to end a / end b) */
  end: "a" | "b" | "mid";
  oa: Pt;
  ob: Pt;
}

export class Board {
  strings: Str[] = [];
  /** the string being pulled out between two pinched hands (not placed yet) */
  draft: { s: Str; ha: number; hb: number } | null = null;
  private grabs = new Map<number, Grab>();
  private wasOn = new Map<number, boolean>();
  /** fingertip on a string (hand:tip:string): it plays again only after it left the string */
  private touch = new Map<string, boolean>();
  private nextId = 1;
  private lastNow = 0;
  plucks = 0;

  /** remove every string */
  clear(): Str[] {
    const out = this.strings;
    this.strings = [];
    this.draft = null;
    this.grabs.clear();
    this.touch.clear();
    return out;
  }

  /** the ready strings of an instrument (screen W x H) */
  placeLayout(inst: Instrument, W: number, H: number, noteOf: (semi: number) => Note): Str[] {
    const out: Str[] = [];
    for (const p of inst.layout) {
      const s: Str = { id: this.nextId++, a: { x: p.ax * W, y: p.ay * H }, b: { x: p.bx * W, y: p.by * H }, note: noteOf(p.semi), inst: inst.id, fixed: true, amp: 0, plucked: 0 };
      this.strings.push(s);
      out.push(s);
    }
    return out;
  }

  /** `ref` = shorter screen side (px), `W`/`H` the screen, `now` ms, `inst` = the instrument of new strings */
  update(hands: readonly Hand[], ref: number, W: number, H: number, now: number, inst: Instrument): BoardEvent[] {
    const ev: BoardEvent[] = [];
    const dt = this.lastNow ? Math.max(0.004, Math.min(0.1, (now - this.lastNow) / 1000)) : 1 / 60;
    this.lastNow = now;
    const ids = new Set(hands.map((h) => h.id));
    const byId = new Map(hands.map((h) => [h.id, h]));

    // hands that let go (fingers opened or the hand left the picture)
    for (const [id, was] of this.wasOn) {
      const h = byId.get(id);
      if (was && (!h || !h.pinch.on)) this.release(id, ref, W, H, ev);
      if (!ids.has(id)) this.wasOn.delete(id);
    }
    // hands that pinch now: grab an end, else the string itself, else wait for the other hand (a new string)
    for (const h of hands) {
      const on = h.pinch.on;
      if (on && !this.wasOn.get(h.id)) {
        const g = this.grabAt(h.at, Math.max(ref * 0.075, h.size * 0.9));
        if (g) {
          this.grabs.set(h.id, g);
          ev.push({ type: "grab", s: g.s });
        }
      }
      this.wasOn.set(h.id, on);
    }
    // a new string: two pinching hands that hold nothing
    if (!this.draft) {
      const freeP = hands.filter((h) => h.pinch.on && !this.grabs.has(h.id));
      if (freeP.length >= 2) {
        const [ha, hb] = freeP;
        const note = inst.scale[noteForLength(dist(ha.at, hb.at), ref, inst.scale.length)];
        const s: Str = { id: this.nextId++, a: { ...ha.at }, b: { ...hb.at }, note, inst: inst.id, fixed: false, amp: 0, plucked: 0 };
        this.draft = { s, ha: ha.id, hb: hb.id };
        ev.push({ type: "tune", s });
      }
    }
    // held ends follow the fingers; the note of a free string follows its length
    if (this.draft) {
      const { s } = this.draft;
      const ha = byId.get(this.draft.ha);
      const hb = byId.get(this.draft.hb);
      if (ha) Object.assign(s.a, ha.at);
      if (hb) Object.assign(s.b, hb.at);
      this.retune(s, ref, inst, ev);
    }
    for (const [id, g] of this.grabs) {
      const h = byId.get(id);
      if (!h) continue;
      if (g.end === "mid") {
        g.s.a.x = h.at.x + g.oa.x;
        g.s.a.y = h.at.y + g.oa.y;
        g.s.b.x = h.at.x + g.ob.x;
        g.s.b.y = h.at.y + g.ob.y;
      } else {
        Object.assign(g.s[g.end], h.at);
        this.retune(g.s, ref, inst, ev);
      }
    }
    // plucking: a fingertip touches a string, or crosses it between two frames (a fast stroke)
    if (this.touch.size > 4000) this.touch.clear();
    for (const h of hands) {
      if (this.holding(h.id)) continue;
      const rIn = Math.max(9, h.size * 0.16);
      const rOut = rIn * 1.9;
      for (let i = 0; i < TIPS.length; i++) {
        // thumb and index tip of a pinch are together: not a pluck
        if (h.pinch.on && i < 2) continue;
        const p0 = h.prevTips[i];
        const p1 = h.pts[TIPS[i]];
        const moved = dist(p0, p1);
        for (const s of this.strings) {
          if (this.held(s)) continue;
          const key = `${h.id}:${i}:${s.id}`;
          const was = this.touch.get(key) ?? false;
          const { d, u } = segDist(p1, s.a, s.b);
          const onString = u > 0.03 && u < 0.97;
          let hit = -1;
          if (!was) {
            if (onString && d < rIn) hit = u;
            else if (moved > 0.5) hit = crossAt(p0, p1, s.a, s.b);
          }
          this.touch.set(key, was ? d < rOut && onString : hit >= 0 && d < rOut);
          if (hit < 0 || now - s.plucked < PLUCK_GAP) continue;
          s.plucked = now;
          // finger speed (hand sizes per second) -> 0..1
          const vel = Math.max(0.3, Math.min(1, moved / dt / Math.max(40, h.size * 9)));
          s.amp = Math.max(s.amp, 5 + vel * ref * 0.03);
          this.plucks++;
          ev.push({ type: "pluck", s, vel, at: { x: s.a.x + (s.b.x - s.a.x) * hit, y: s.a.y + (s.b.y - s.a.y) * hit } });
        }
      }
    }
    return ev;
  }

  held(s: Str): boolean {
    if (this.draft?.s === s) return true;
    for (const g of this.grabs.values()) if (g.s === s) return true;
    return false;
  }

  /** the hand holds a string (an end, the string, or one end of a new one) */
  private holding(id: number): boolean {
    return this.grabs.has(id) || this.draft?.ha === id || this.draft?.hb === id;
  }

  private retune(s: Str, ref: number, inst: Instrument, ev: BoardEvent[]): void {
    if (s.fixed) return;
    const n = inst.scale[noteForLength(dist(s.a, s.b), ref, inst.scale.length)];
    if (n.freq !== s.note.freq) {
      s.note = n;
      s.inst = inst.id;
      ev.push({ type: "tune", s });
    }
  }

  private grabAt(p: Pt, r: number): Grab | null {
    const taken = (s: Str, end: Grab["end"]): boolean => [...this.grabs.values()].some((g) => g.s === s && (g.end === end || g.end === "mid" || end === "mid"));
    let best: Grab | null = null;
    let bd = r;
    for (const s of this.strings) {
      for (const end of ["a", "b"] as const) {
        const d = dist(p, s[end]);
        if (d < bd && !taken(s, end)) {
          bd = d;
          best = { s, end, oa: { x: 0, y: 0 }, ob: { x: 0, y: 0 } };
        }
      }
    }
    if (best) return best;
    // on the string itself: the whole string moves with the hand
    bd = r * 0.7;
    for (const s of this.strings) {
      const { d } = segDist(p, s.a, s.b);
      if (d < bd && !this.held(s)) {
        bd = d;
        best = { s, end: "mid", oa: { x: s.a.x - p.x, y: s.a.y - p.y }, ob: { x: s.b.x - p.x, y: s.b.y - p.y } };
      }
    }
    return best;
  }

  private release(id: number, ref: number, W: number, H: number, ev: BoardEvent[]): void {
    if (this.draft && (this.draft.ha === id || this.draft.hb === id)) {
      const { s } = this.draft;
      this.draft = null;
      if (dist(s.a, s.b) >= ref * LEN_MIN) {
        this.strings.push(s);
        if (this.strings.length > MAX_STRINGS) ev.push({ type: "remove", s: this.strings.shift()! });
        ev.push({ type: "place", s });
      }
      return;
    }
    const g = this.grabs.get(id);
    if (!g) return;
    this.grabs.delete(id);
    const s = g.s;
    if (this.held(s)) return; // the other end is still held
    const off = (p: Pt): boolean => p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20;
    if (dist(s.a, s.b) < ref * LEN_MIN || (off(s.a) && off(s.b))) {
      this.strings = this.strings.filter((x) => x !== s);
      ev.push({ type: "remove", s });
    } else ev.push({ type: "place", s });
  }
}
