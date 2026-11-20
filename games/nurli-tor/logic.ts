// Nurli tor: pure logic (no engine, no audio, no drawing) — easy to test.
//
//  * HandTracks: the hands of the hand model keep their identity from frame to frame and are moved forward to "now" by their
//    speed (the picture the model saw is 30..60 ms old: drawn where the finger IS, not where it was).
//  * Board: the strings. Pinch thumb + index on both hands = a new string between them; open the fingers = the string stays there
//    in the air. Pinch near the ends of a string = grab it (move it, stretch it; ends brought together = it is removed).
//    A fingertip that crosses a string plucks it. Like a real string: SHORT = HIGH note, LONG = LOW note.

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

export interface Note {
  /** Uzbek solfège name shown on screen */
  name: string;
  freq: number;
  /** hue for the light (0..360) */
  hue: number;
}

// minor pentatonic on E (the guitar's own key) from E3 over two octaves + the top E: every combination sounds good
const NAMES = ["Mi", "Sol", "La", "Si", "Re"];
const SEMIS = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
export const NOTES: Note[] = SEMIS.map((s, i) => ({
  name: NAMES[i % 5],
  freq: 164.81 * Math.pow(2, s / 12),
  hue: 210 - (i / (SEMIS.length - 1)) * 210,
}));

/** string length as a part of the shorter screen side: this long = the lowest note, this short = the highest */
export const LEN_LONG = 0.95;
export const LEN_SHORT = 0.12;
/** shorter than this (part of the screen side) is no string: not placed / removed */
export const LEN_MIN = 0.07;

/** the note of a string: like a real string the pitch goes with 1 / length (logarithmic ladder), snapped to the scale */
export function noteForLength(len: number, ref: number): number {
  const f = Math.max(1e-6, len / Math.max(1, ref));
  const t = Math.log(LEN_LONG / f) / Math.log(LEN_LONG / LEN_SHORT);
  return Math.round(Math.max(0, Math.min(1, t)) * (NOTES.length - 1));
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
const KEEP_MS = 160;

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
  note: number;
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

export const MAX_STRINGS = 6;
/** a string can be plucked again after this long (ms): one finger, one note; five fingers in one stroke are one pluck too */
const PLUCK_GAP = 85;

interface Grab {
  s: Str;
  end: "a" | "b";
}

export class Board {
  strings: Str[] = [];
  /** the string being pulled out between two pinched hands (not placed yet) */
  draft: { s: Str; ha: number; hb: number } | null = null;
  private grabs = new Map<number, Grab>();
  private wasOn = new Map<number, boolean>();
  private nextId = 1;
  plucks = 0;

  /** `ref` = shorter screen side (px), `W`/`H` the screen, `now` ms */
  update(hands: readonly Hand[], ref: number, W: number, H: number, now: number): BoardEvent[] {
    const ev: BoardEvent[] = [];
    const ids = new Set(hands.map((h) => h.id));
    const byId = new Map(hands.map((h) => [h.id, h]));

    // hands that let go (fingers opened or the hand left the picture)
    for (const [id, was] of this.wasOn) {
      const h = byId.get(id);
      if (was && (!h || !h.pinch.on)) this.release(id, ref, W, H, ev);
      if (!ids.has(id)) this.wasOn.delete(id);
    }
    // hands that pinch now: grab the nearest end of a string, else wait for the other hand (a new string)
    for (const h of hands) {
      const on = h.pinch.on;
      if (on && !this.wasOn.get(h.id)) {
        const g = this.nearestEnd(h.at, Math.max(ref * 0.07, h.size * 0.9));
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
        const s: Str = { id: this.nextId++, a: { ...ha.at }, b: { ...hb.at }, note: noteForLength(dist(ha.at, hb.at), ref), amp: 0, plucked: 0 };
        this.draft = { s, ha: ha.id, hb: hb.id };
        ev.push({ type: "tune", s });
      }
    }
    // held ends follow the fingers; the note follows the length
    if (this.draft) {
      const { s } = this.draft;
      const ha = byId.get(this.draft.ha);
      const hb = byId.get(this.draft.hb);
      if (ha) Object.assign(s.a, ha.at);
      if (hb) Object.assign(s.b, hb.at);
      this.retune(s, ref, ev);
    }
    for (const [id, g] of this.grabs) {
      const h = byId.get(id);
      if (!h) continue;
      Object.assign(g.s[g.end], h.at);
      this.retune(g.s, ref, ev);
    }
    // plucking: a fingertip of a hand that is not pinching crosses a placed string
    for (const h of hands) {
      if (h.pinch.on) continue;
      for (let i = 0; i < TIPS.length; i++) {
        const p0 = h.prevTips[i];
        const p1 = h.pts[TIPS[i]];
        const moved = dist(p0, p1);
        if (moved < 0.5) continue;
        for (const s of this.strings) {
          if (this.held(s) || now - s.plucked < PLUCK_GAP) continue;
          const u = crossAt(p0, p1, s.a, s.b);
          if (u < 0) continue;
          s.plucked = now;
          // speed of the finger in hand sizes per draw frame -> 0..1
          const vel = Math.max(0.25, Math.min(1, moved / Math.max(8, h.size * 0.5)));
          s.amp = Math.max(s.amp, 6 + vel * ref * 0.035);
          this.plucks++;
          ev.push({ type: "pluck", s, vel, at: { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u } });
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

  private retune(s: Str, ref: number, ev: BoardEvent[]): void {
    const n = noteForLength(dist(s.a, s.b), ref);
    if (n !== s.note) {
      s.note = n;
      ev.push({ type: "tune", s });
    }
  }

  private nearestEnd(p: Pt, r: number): Grab | null {
    let best: Grab | null = null;
    let bd = r;
    for (const s of this.strings) {
      for (const end of ["a", "b"] as const) {
        const d = dist(p, s[end]);
        if (d < bd && ![...this.grabs.values()].some((g) => g.s === s && g.end === end)) {
          bd = d;
          best = { s, end };
        }
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
