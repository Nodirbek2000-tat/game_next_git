import { velAlpha } from "./prediction";
import { CROWD_CFG } from "./crowdConfig";
import type { Person } from "../types";

// "Bog‘cha" (kindergarten) crowd tracking: every detected person (2..5 children) is exposed as a stable "kid slot".
// No player lock, no scan: slots are assigned by left-to-right position and then kept by position continuity.
// Per kid: key points in stage px (filtered + lightly predicted) and simple signals (handsUp, jump, squat, clap, wave,
// stillness, armsOut) tuned for small, quickly moving bodies. Nothing is allocated after construction.
//
// Detections of a crowd game arrive unevenly (crops of the picture are analysed round-robin, so a child is refreshed every ~70-300 ms):
//  - the measured points are smoothed by the SIZE of their change (CROWD_CFG.smooth): a child who stands still does not shake, a child who
//    walks is followed at once; the body (shoulder centre) and the other points (offsets from the body) are filtered separately,
//  - the drawn points chase a target that coasts along the (gated) velocity (CROWD_CFG.motion): nothing freezes, nothing jumps,
//  - a child stays "present" (and keeps the slot) through short misses (CROWD_CFG.hold),
//  - a new child must be seen twice before it takes a slot, and never takes the slot of a child who was seen a moment ago,
//  - matching uses predicted positions and sizes and prefers slots that were seen recently (CROWD_CFG.match).

export const MAX_KIDS = 5;
/** a slot of a child who is gone is freed after this many seconds (at least; see CROWD_CFG.hold) */
export const FREE_AFTER_SEC = CROWD_CFG.hold.freeSec;
/** candidates looked at per detection: duplicates and false detections must not push real children out */
const CAND_MAX = MAX_KIDS * 2;
const PEND_MAX = 8;

export interface KidAnimal {
  id: "quyon" | "ayiq" | "mushuk" | "kuchuk" | "baqa";
  emoji: string;
  /** Uzbek name for prompts ("quyoncha") */
  name: string;
  /** body / head colours used by the avatar drawer */
  body: string;
  head: string;
  inner: string;
}

export const KID_ANIMALS: readonly KidAnimal[] = [
  { id: "quyon", emoji: "🐰", name: "quyoncha", body: "#ff8fb8", head: "#fff0f5", inner: "#ffb3cf" },
  { id: "ayiq", emoji: "🐻", name: "ayiqcha", body: "#b5733c", head: "#d79a62", inner: "#f0c9a0" },
  { id: "mushuk", emoji: "🐱", name: "mushukcha", body: "#ffa63d", head: "#ffcc80", inner: "#ffe3b8" },
  { id: "kuchuk", emoji: "🐶", name: "kuchukcha", body: "#6f9bff", head: "#f3e2c8", inner: "#c9a27a" },
  { id: "baqa", emoji: "🐸", name: "baqacha", body: "#4fc464", head: "#8ae37a", inner: "#d7ffd0" },
];
/** slot colours == the animal body colours */
export const KID_COLORS: readonly string[] = KID_ANIMALS.map((a) => a.body);

export interface KidPt {
  x: number;
  y: number;
  /** MediaPipe visibility 0..1 */
  v: number;
}

export interface KidPoints {
  head: KidPt;
  ls: KidPt;
  rs: KidPt;
  le: KidPt;
  re: KidPt;
  lw: KidPt;
  rw: KidPt;
  lh: KidPt;
  rh: KidPt;
  lk: KidPt;
  rk: KidPt;
  la: KidPt;
  ra: KidPt;
}

export interface KidSignals {
  /** both wrists above the head */
  handsUp: boolean;
  handUp: { L: boolean; R: boolean };
  /** hips clearly above the standing baseline (state) */
  jump: boolean;
  /** true during exactly one render frame at take-off */
  jumpFired: boolean;
  /** hips clearly below the standing baseline */
  squat: boolean;
  /** wrists together (state) */
  clap: boolean;
  /** true during exactly one render frame when the hands meet after being apart */
  clapFired: boolean;
  /** a raised hand swings left-right */
  wave: boolean;
  /** both arms stretched out sideways (aeroplane) */
  armsOut: boolean;
  /** whole body (almost) not moving */
  still: boolean;
  /** seconds the child has been still */
  stillFor: number;
  /** movement energy over the last ~0.5 s, in body scales per second (0 = frozen, 1 = walking, 3+ = dancing) */
  energy: number;
  /** monotonic event counters */
  jumps: number;
  claps: number;
}

export interface KidSlot {
  slot: number;
  color: string;
  animal: KidAnimal;
  /** this slot belongs to a child (also during the 2 s grace period after the child left) */
  active: boolean;
  /** seen recently (CROWD_CFG.hold.presentSec, longer when a detection round is long): through a short miss the child stays present at the held position */
  present: boolean;
  /** present, but not seen for the last moment: the points are extrapolated / held, not measured (undefined = false) */
  held?: boolean;
  /** seconds since the child was last seen */
  lostFor: number;
  /** seconds since `present` turned false (0 while present): what the fade of a lost child is timed from */
  goneFor: number;
  /** seconds since the slot was taken */
  seenFor: number;
  /** true during exactly one render frame when a child takes the slot / leaves it */
  joined: boolean;
  left: boolean;
  /** shoulder width in px (smoothed), the unit of all signal thresholds */
  scale: number;
  headR: number;
  center: { x: number; y: number };
  /** key points in stage px (mirrored, cover-fitted), filtered and lightly extrapolated to the render time */
  pts: KidPoints;
  signals: KidSignals;
}

export const KIDS_CFG = {
  /** visibility below which a landmark counts as unseen (small children / far away: lower than for adults) */
  minVis: 0.25,
  /** a detection is a child only when shoulders (mean) or the nose are seen this well */
  personVis: 0.2,
  // motion between detections, holding, joining and slot matching: CROWD_CFG (crowdConfig.ts)
  jump: { enter: 0.22, exit: 0.1, cooldownMs: 350, fastRise: 1.2, freezeMs: 800 },
  squat: { enter: 0.28, exit: 0.14 },
  baseline: { upTauMs: 1500, downTauMs: 4000 },
  handUp: { enter: 0.15, exit: -0.1 },
  clap: { together: 0.5, apart: 1.0, release: 0.8, withinMs: 700 },
  wave: { dead: 0.02, swing: 0.2, reversals: 3, windowMs: 1100 },
  armsOut: { enter: 3.0, exit: 2.5, yBand: 0.55 },
  still: { enter: 0.3, exit: 0.6, tauMs: 300 },
} as const;

// indices of the 13 tracked MediaPipe landmarks
const KP = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
const N_KP = KP.length;
/** index of the body anchor (shoulder centre) in the per-point arrays: one more "point" after the 13 landmarks */
const ANC = N_KP;
const N_ALL = N_KP + 1;
/** landmarks (index into KP) that form the rigid frame around the anchor: head, shoulders, hips; the others are limbs */
const IS_TORSO: readonly boolean[] = [true, true, true, false, false, false, false, true, true, false, false, false, false];
const LW = 5;
const RW = 6;
/** head, wrists, hips, ankles: the points whose motion counts for the "stillness" energy */
const MOTION_PTS = [0, 5, 6, 7, 8, 11, 12] as const;

const mkPt = (): KidPt => ({ x: 0, y: 0, v: 0 });

function mkSlot(i: number): KidSlot {
  const a = Array.from({ length: N_KP }, mkPt);
  return {
    slot: i,
    color: KID_COLORS[i] ?? "#ffffff",
    animal: KID_ANIMALS[i] ?? KID_ANIMALS[0],
    active: false,
    present: false,
    held: false,
    lostFor: 0,
    goneFor: 0,
    seenFor: 0,
    joined: false,
    left: false,
    scale: 60,
    headR: 24,
    center: { x: 0, y: 0 },
    pts: { head: a[0], ls: a[1], rs: a[2], le: a[3], re: a[4], lw: a[5], rw: a[6], lh: a[7], rh: a[8], lk: a[9], rk: a[10], la: a[11], ra: a[12] },
    signals: {
      handsUp: false,
      handUp: { L: false, R: false },
      jump: false,
      jumpFired: false,
      squat: false,
      clap: false,
      clapFired: false,
      wave: false,
      armsOut: false,
      still: false,
      stillFor: 0,
      energy: 0.6,
      jumps: 0,
      claps: 0,
    },
  };
}

interface Swing {
  lastX: number;
  startX: number;
  dir: number;
  /** capture times (ms) of the last reversals (ring of 3) */
  t: Float64Array;
  n: number;
  head: number;
}

/** Mutable per-slot state that games never see. */
class Internal {
  arr: KidPt[];
  /** smoothed state: [N_KP] = body anchor, [k] = offset of landmark k from the anchor (before the dead zone) */
  st = new Float32Array(N_ALL * 2);
  /** the same after the dead zone */
  out = new Float32Array(N_ALL * 2);
  /** filtered position of every point in stage px ([N_KP] = body anchor) */
  filt = new Float32Array(N_ALL * 2);
  /** smoothed velocity, px/s (what the signals use) */
  vel = new Float32Array(N_ALL * 2);
  /** positions and capture time at the last velocity update: velocities are measured over at least `velMinGapMs` */
  vref = new Float32Array(N_ALL * 2);
  velT = 0;
  hasVel = false;
  /** the velocity the drawn points are extrapolated along: `vel`, small drifts (noise) taken out */
  ev = new Float32Array(N_ALL * 2);
  /** drawn position of every point (chases the extrapolated target) */
  rx = new Float32Array(N_ALL * 2);
  rInit = false;
  lastRender = 0;
  /** smoothed time between two detections of this child, s */
  dtEma = 0.1;
  /** time between detections that sets the chase speed: the gap that just ended, relaxing back to `dtEma` (a catch-up after a hole is gentle) */
  chaseDt = 0.1;
  tDet = 0;
  hasDet = false;
  joinedAt = 0;
  lastSeenNow = 0;
  /** last matched centre (stage px) and its smoothed velocity (px/s) */
  cx = 0;
  cy = 0;
  vcx = 0;
  vcy = 0;
  // signal state
  baseline = 0;
  hasBase = false;
  usedHips = false;
  prevRef = 0;
  fastRiseAt = -1e9;
  jumpAt = -1e9;
  apartAt = -1e9;
  together = false;
  swing: [Swing, Swing] = [mkSwing(), mkSwing()];
  waveOn = false;
  armsOn = false;
  stillOn = false;
  handL = false;
  handR = false;
  squatOn = false;
  jumpOn = false;

  constructor(slot: KidSlot) {
    this.arr = [slot.pts.head, slot.pts.ls, slot.pts.rs, slot.pts.le, slot.pts.re, slot.pts.lw, slot.pts.rw, slot.pts.lh, slot.pts.rh, slot.pts.lk, slot.pts.rk, slot.pts.la, slot.pts.ra];
  }

  reset(): void {
    this.st.fill(0);
    this.out.fill(0);
    this.filt.fill(0);
    this.vel.fill(0);
    this.ev.fill(0);
    this.vref.fill(0);
    this.hasVel = false;
    this.rx.fill(0);
    this.rInit = false;
    this.lastRender = 0;
    this.dtEma = 0.1;
    this.chaseDt = 0.1;
    this.hasDet = false;
    this.vcx = this.vcy = 0;
    this.hasBase = false;
    this.fastRiseAt = this.jumpAt = this.apartAt = -1e9;
    this.together = this.waveOn = this.armsOn = this.stillOn = this.handL = this.handR = this.squatOn = this.jumpOn = false;
    for (const s of this.swing) {
      s.dir = 0;
      s.n = 0;
      s.head = 0;
      s.lastX = s.startX = 0;
    }
  }
}

function mkSwing(): Swing {
  return { lastX: 0, startX: 0, dir: 0, t: new Float64Array(3), n: 0, head: 0 };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * One smoothing step of a point (a body anchor or an offset from it), in stage px. `z` is the new measurement, `st` the smoothed state,
 * `out` the same after the dead zone (the output only moves once the state is more than `dead` x `sc` away from it).
 * The weight of a measurement is `g0` (the plain time-based smoothing, small) for a change far below `knee` (x `sc`) and rises steeply to 1
 * around `knee`: noise is averaged, real motion passes. Nothing is allocated.
 */
function smoothPt(st: Float32Array, out: Float32Array, k: number, zx: number, zy: number, g0: number, sc: number, knee: number, dead: number): void {
  const j = k * 2;
  let dx = zx - st[j];
  let dy = zy - st[j + 1];
  const n = Math.hypot(dx, dy) / (sc * knee);
  const n2 = n * n;
  const w = (n2 * n2) / (1 + n2 * n2);
  const g = g0 + (1 - g0) * w;
  st[j] += dx * g;
  st[j + 1] += dy * g;
  dx = st[j] - out[j];
  dy = st[j + 1] - out[j + 1];
  const d = Math.hypot(dx, dy);
  const lim = dead * sc;
  if (d > lim) {
    const f = (d - lim) / d;
    out[j] += dx * f;
    out[j + 1] += dy * f;
  }
}

/** Slow smoothing of a size (relative change): a change of the order of `knee` (relative) is real and passes at once. */
function smoothSize(cur: number, target: number, dtSec: number, tauMs: number, knee: number): number {
  const n = Math.abs(target / Math.max(1e-3, cur) - 1) / knee;
  const n2 = n * n;
  const w = (n2 * n2) / (1 + n2 * n2);
  const g0 = 1 - Math.exp((-dtSec * 1000) / tauMs);
  return cur + (target - cur) * (g0 + (1 - g0) * w);
}

/**
 * Turns the tracker's raw people into up to 5 stable kid slots (see file header).
 *
 *   update(people, now, capture, H)  per detection (30-60 Hz)
 *   extrapolate(now)                 per render frame: prediction, presence, frees slots of children who left
 *   endFrame()                       per render frame AFTER the game ran: clears the one-frame events
 */
export class KidTracker {
  readonly slots: KidSlot[] = Array.from({ length: MAX_KIDS }, (_, i) => mkSlot(i));
  /** children seen right now (present: includes the ones that are held through a short miss) */
  count = 0;
  private ints: Internal[] = this.slots.map((s) => new Internal(s));
  private cand: (Person | null)[] = new Array<Person | null>(CAND_MAX).fill(null);
  private candUsed = new Uint8Array(CAND_MAX);
  private slotTaken = new Uint8Array(MAX_KIDS);
  private order = new Uint8Array(CAND_MAX);
  private pend = Array.from({ length: PEND_MAX }, () => ({ on: false, x: 0, y: 0, n: 0, t: 0 }));
  private nc = 0;
  private W = 1280;
  /** how many slots may be used (meta.maxKids) */
  maxKids: number = MAX_KIDS;
  /**
   * Time (ms) one child needs to be refreshed (a full round over all crops of the picture; 0 = unknown / every detection).
   * The runtime sets it; the hold times grow with it so a child on a slow round does not flicker.
   */
  cycleMs = 0;

  reset(): void {
    for (let i = 0; i < MAX_KIDS; i++) this.free(i, false);
    for (const p of this.pend) p.on = false;
    this.count = 0;
  }

  /** seconds a child stays "present" after the last detection */
  private holdSec(): number {
    const H = CROWD_CFG.hold;
    return Math.min(2, Math.max(H.presentSec, (this.cycleMs / 1000) * H.cycleFactor));
  }

  private freeSec(hold: number): number {
    return Math.max(CROWD_CFG.hold.freeSec, hold + 1.2);
  }

  /** A person who is not matched to a slot becomes a child only after `join.confirm` detections at about the same place. */
  private confirmed(p: Person, now: number): boolean {
    const J = CROWD_CFG.join;
    if (J.confirm <= 1) return true;
    const lim = Math.max(60, p.scale * 1.5);
    let free = -1;
    let oldest = 0;
    let oldestT = Infinity;
    for (let j = 0; j < PEND_MAX; j++) {
      const e = this.pend[j];
      if (e.on && now - e.t > J.withinMs) e.on = false;
      if (!e.on) {
        if (free < 0) free = j;
        continue;
      }
      if (Math.hypot(e.x - p.center.x, e.y - p.center.y) < lim) {
        e.n++;
        e.x = p.center.x;
        e.y = p.center.y;
        e.t = now;
        if (e.n >= J.confirm) {
          e.on = false;
          return true;
        }
        return false;
      }
      if (e.t < oldestT) {
        oldestT = e.t;
        oldest = j;
      }
    }
    const e = this.pend[free >= 0 ? free : oldest];
    e.on = true;
    e.x = p.center.x;
    e.y = p.center.y;
    e.n = 1;
    e.t = now;
    return false;
  }

  private isKid(p: Person): boolean {
    const lm = p.lm;
    if (lm.length < 33) return false;
    const c = KIDS_CFG;
    return (lm[11].v + lm[12].v) / 2 >= c.personVis || lm[0].v >= c.personVis + 0.1;
  }

  private free(i: number, signal: boolean): void {
    const s = this.slots[i];
    if (s.active && signal) s.left = true;
    s.active = false;
    s.present = false;
    s.held = false;
    s.signals.jump = s.signals.squat = s.signals.clap = s.signals.wave = s.signals.armsOut = s.signals.handsUp = s.signals.still = false;
    s.signals.handUp.L = s.signals.handUp.R = false;
    this.ints[i].reset();
  }

  /**
   * The free slot that keeps the left-to-right order of the active ones. When all are taken: the slot of the child who has been gone
   * longest, but only if that child has really been gone for a while (never a child who was seen a moment ago).
   */
  private pickSlot(cx: number, now: number): number {
    let best = -1;
    let bestScore = Infinity;
    const n = this.maxKids;
    for (let s = 0; s < n; s++) {
      if (this.slots[s].active) continue;
      let score = 0;
      for (let j = 0; j < n; j++) {
        if (j === s || !this.slots[j].active) continue;
        const xj = this.ints[j].cx;
        if ((j < s && xj > cx) || (j > s && xj < cx)) score++;
      }
      score = score * 10 + s;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best >= 0) return best;
    let worst = -1;
    let wl: number = CROWD_CFG.hold.stealMinLostSec;
    for (let s = 0; s < n; s++) {
      const sl = this.slots[s];
      const lost = (now - this.ints[s].lastSeenNow) / 1000;
      if (!sl.present && lost > wl) {
        wl = lost;
        worst = s;
      }
    }
    return worst;
  }

  /**
   * @param people the tracker's people of this detection (stage px, mirrored). With crops of the picture analysed one after the other
   *   these are only the people of the crop analysed now: a slot that is not in the list is not "gone", it just keeps ageing.
   * @param now engine time (ms)
   * @param capture camera capture time (ms): filters and velocities run on it
   * @param W stage width (limits how far a child may "jump" between detections)
   */
  update(people: readonly Person[], now: number, capture: number = now, W = this.W): void {
    this.W = W;
    const n = this.maxKids;
    const M = CROWD_CFG.match;
    // 1) candidates
    let nc = 0;
    for (let i = 0; i < people.length && nc < CAND_MAX; i++) {
      if (this.isKid(people[i])) this.cand[nc++] = people[i];
    }
    this.nc = nc;
    this.candUsed.fill(0);
    this.slotTaken.fill(0);
    // 2) greedy global matching of active slots (also those whose child is briefly gone) to candidates: cheapest pair first.
    //    cost = distance to the slot's PREDICTED position / its allowed distance, higher for slots that were not seen for a while,
    //    so a child who is tracked right now wins against a slot that is only held.
    for (let iter = 0; iter < n; iter++) {
      let bs = -1;
      let bc = -1;
      let bcost = Infinity;
      for (let s = 0; s < n; s++) {
        const sl = this.slots[s];
        if (!sl.active || this.slotTaken[s]) continue;
        const it = this.ints[s];
        const away = Math.max(0, (now - it.lastSeenNow) / 1000);
        const gap = Math.min(M.predictMaxSec, away);
        const px = it.cx + it.vcx * gap;
        const py = it.cy + it.vcy * gap;
        const lim = Math.min(W * M.maxFrac, sl.scale * (M.scales + Math.min(M.growMax, M.growPerSec * away)));
        const stale = 1 + M.staleCost * Math.min(2, away);
        for (let c = 0; c < nc; c++) {
          if (this.candUsed[c]) continue;
          const p = this.cand[c] as Person;
          const ratio = p.scale / Math.max(1, sl.scale);
          if (ratio > M.scaleRatio || ratio < 1 / M.scaleRatio) continue;
          const d = Math.hypot(p.center.x - px, p.center.y - py);
          if (d >= lim) continue;
          const cost = (d / lim) * stale;
          if (cost < bcost) {
            bcost = cost;
            bs = s;
            bc = c;
          }
        }
      }
      if (bs < 0) break;
      this.slotTaken[bs] = 1;
      this.candUsed[bc] = 1;
      this.apply(bs, this.cand[bc] as Person, now, capture, false);
    }
    // 3) new children (seen twice), left to right
    let m = 0;
    for (let c = 0; c < nc; c++) if (!this.candUsed[c] && this.confirmed(this.cand[c] as Person, now)) this.order[m++] = c;
    for (let a = 1; a < m; a++) {
      const v = this.order[a];
      const vx = (this.cand[v] as Person).center.x;
      let b = a - 1;
      while (b >= 0 && (this.cand[this.order[b]] as Person).center.x > vx) {
        this.order[b + 1] = this.order[b];
        b--;
      }
      this.order[b + 1] = v;
    }
    for (let k = 0; k < m; k++) {
      const p = this.cand[this.order[k]] as Person;
      const s = this.pickSlot(p.center.x, now);
      if (s < 0) continue;
      if (this.slots[s].active) this.free(s, true); // takes over a slot whose child has been gone for a while
      this.slotTaken[s] = 1;
      this.apply(s, p, now, capture, true);
    }
    this.sweep(now);
  }

  /** Fill a slot from a person: filtered points, velocities, signals. */
  private apply(i: number, p: Person, now: number, cap: number, fresh: boolean): void {
    const sl = this.slots[i];
    const it = this.ints[i];
    const MO = CROWD_CFG.motion;
    if (fresh) {
      it.reset();
      sl.active = true;
      sl.joined = true;
      sl.seenFor = 0;
      sl.scale = p.scale;
      it.joinedAt = now;
      it.cx = p.center.x;
      it.cy = p.center.y;
      it.prevRef = 0;
      sl.signals.stillFor = 0;
      sl.signals.energy = 0.6;
    }
    const dtDet = it.hasDet ? Math.min(MO.maxDtSec, Math.max(0.001, (cap - it.tDet) / 1000)) : 1 / 30;
    // centre velocity (position continuity)
    if (!fresh) {
      const dtc = (now - it.lastSeenNow) / 1000;
      if (dtc >= 0.015) {
        const a = velAlpha(dtc, 120);
        it.vcx = lerp(it.vcx, (p.center.x - it.cx) / dtc, a);
        it.vcy = lerp(it.vcy, (p.center.y - it.cy) / dtc, a);
      }
    }
    it.cx = p.center.x;
    it.cy = p.center.y;
    it.lastSeenNow = now;
    const S = CROWD_CFG.smooth;
    // size: the unit of every threshold, smoothed slowly (a noisy size makes the animal pulse)
    sl.scale = fresh ? p.scale : smoothSize(sl.scale, p.scale, dtDet, S.scaleTauMs, S.scaleKnee);
    const headTarget = Math.max(sl.scale * 0.42, Math.hypot(p.lm[7].x - p.lm[8].x, p.lm[7].y - p.lm[8].y) * 0.75);
    sl.headR = fresh ? headTarget : smoothSize(sl.headR, headTarget, dtDet, S.scaleTauMs, S.scaleKnee);
    sl.present = true;
    sl.held = false;
    sl.lostFor = 0;
    sl.goneFor = 0;
    // two measurements (e.g. from two crops that both contain the child) closer than a few ms must not make a velocity out of noise
    if (it.hasDet && cap - it.tDet >= 4 && cap - it.tDet < 1000) {
      const gap = (cap - it.tDet) / 1000;
      it.dtEma += (gap - it.dtEma) * 0.2;
      it.chaseDt = Math.max(it.dtEma, gap);
    }
    const gapV = cap - it.velT;
    const measureVel = it.hasVel && gapV < MO.velGapMs;
    // measured over a baseline of at least `velMinGapMs`: two detections of one child a few ms apart (crops that overlap) are mostly noise
    const updVel = measureVel && gapV >= MO.velMinGapMs;
    const dtV = Math.max(0.001, Math.min(MO.maxDtSec, gapV / 1000));
    const sc = Math.max(20, sl.scale);
    const maxV = MO.maxSpeedScales * sc;
    const aUp = velAlpha(dtV, MO.velTauMs);
    const kn2 = MO.velKnee * MO.velKnee;
    // ---- 1) smoothing: the body anchor (shoulder centre), then every landmark as an offset from the filtered anchor
    const { st, out, filt: f, vel, ev } = it;
    const ax = (p.lm[11].x + p.lm[12].x) / 2;
    const ay = (p.lm[11].y + p.lm[12].y) / 2;
    const A = ANC * 2;
    if (!it.hasDet || cap - it.tDet > 1000) {
      // a new child, or one who was away for a long time: start at the measurement
      st[A] = out[A] = ax;
      st[A + 1] = out[A + 1] = ay;
      for (let k = 0; k < N_KP; k++) {
        const src = p.lm[KP[k]];
        st[k * 2] = out[k * 2] = src.x - ax;
        st[k * 2 + 1] = out[k * 2 + 1] = src.y - ay;
      }
    } else {
      const gB = 1 - Math.exp((-dtDet * 1000) / S.body.tauMs);
      const gT = 1 - Math.exp((-dtDet * 1000) / S.torso.tauMs);
      const gL = 1 - Math.exp((-dtDet * 1000) / S.limb.tauMs);
      smoothPt(st, out, ANC, ax, ay, gB, sc, S.body.knee, S.body.dead);
      const bx = out[A];
      const by = out[A + 1];
      for (let k = 0; k < N_KP; k++) {
        const src = p.lm[KP[k]];
        const bad = 1 + S.lowVisKnee * (1 - Math.min(1, Math.max(0, src.v)));
        if (IS_TORSO[k]) smoothPt(st, out, k, src.x - bx, src.y - by, gT, sc, S.torso.knee * bad, S.torso.dead);
        else smoothPt(st, out, k, src.x - bx, src.y - by, gL, sc, S.limb.knee * bad, S.limb.dead);
      }
    }
    // ---- 2) absolute filtered points and velocities (smoothed; the extrapolation velocity has small drifts taken out)
    for (let q = 0; q < N_ALL; q++) {
      const j = q * 2;
      const nx = q === ANC ? out[A] : out[A] + out[j];
      const ny = q === ANC ? out[A + 1] : out[A + 1] + out[j + 1];
      if (updVel) {
        const rvx = (nx - it.vref[j]) / dtV;
        const rvy = (ny - it.vref[j + 1]) / dtV;
        const a = Math.hypot(rvx, rvy) < Math.hypot(vel[j], vel[j + 1]) ? 1 : aUp; // slowing down is taken at once: no overshoot when a child stops
        let vx = lerp(vel[j], rvx, a);
        let vy = lerp(vel[j + 1], rvy, a);
        const sp = Math.hypot(vx, vy);
        if (sp > maxV) {
          vx *= maxV / sp;
          vy *= maxV / sp;
        }
        vel[j] = vx;
        vel[j + 1] = vy;
        const s2 = (Math.min(sp, maxV) / sc) * (Math.min(sp, maxV) / sc);
        const gate = s2 / (s2 + kn2);
        ev[j] = vx * gate;
        ev[j + 1] = vy * gate;
      } else if (!measureVel) {
        vel[j] = vel[j + 1] = ev[j] = ev[j + 1] = 0;
      }
      f[j] = nx;
      f[j + 1] = ny;
      if (q < N_KP) {
        const o = it.arr[q];
        o.x = nx;
        o.y = ny;
        o.v = p.lm[KP[q]].v;
      }
    }
    if (!measureVel || updVel) {
      for (let q = 0; q < N_ALL * 2; q++) it.vref[q] = f[q];
      it.velT = cap;
      it.hasVel = true;
    }
    // limbs swing back and forth: they are extrapolated less than the body (a waving hand must not fly past its turning point)
    for (let k = 0; k < N_KP; k++) {
      if (IS_TORSO[k]) continue;
      ev[k * 2] = ev[A] + (ev[k * 2] - ev[A]) * MO.limbGain;
      ev[k * 2 + 1] = ev[A + 1] + (ev[k * 2 + 1] - ev[A + 1]) * MO.limbGain;
    }
    sl.center.x = f[A];
    sl.center.y = f[A + 1];
    // the drawn points start at the measurement for a new child (or one who was away for a long time) and chase it otherwise
    if (!it.rInit || cap - it.tDet > 1000) {
      for (let q = 0; q < N_ALL * 2; q++) it.rx[q] = it.filt[q];
      it.rInit = true;
    }
    it.tDet = cap;
    it.hasDet = true;
    this.signals(sl, it, dtDet, cap);
  }

  private signals(sl: KidSlot, it: Internal, dt: number, cap: number): void {
    const c = KIDS_CFG;
    const sg = sl.signals;
    const sc = Math.max(20, sl.scale);
    const P = sl.pts;
    const mv = c.minVis;
    const f = it.filt;
    // ---- hands up (wrist above the nose)
    const headOk = P.head.v >= mv;
    const upL = headOk && P.lw.v >= mv && P.lw.y < P.head.y - (it.handL ? c.handUp.exit : c.handUp.enter) * sc;
    const upR = headOk && P.rw.v >= mv && P.rw.y < P.head.y - (it.handR ? c.handUp.exit : c.handUp.enter) * sc;
    it.handL = upL;
    it.handR = upR;
    sg.handUp.L = upL;
    sg.handUp.R = upR;
    sg.handsUp = upL && upR;
    // ---- jump / squat: hips (or shoulders when the legs are out of the picture) against a slow standing baseline
    const hipsOk = P.lh.v >= mv && P.rh.v >= mv;
    const shOk = P.ls.v >= mv && P.rs.v >= mv;
    if (hipsOk || shOk) {
      const ref = hipsOk ? (P.lh.y + P.rh.y) / 2 : (P.ls.y + P.rs.y) / 2;
      if (!it.hasBase || it.usedHips !== hipsOk) {
        it.baseline = ref;
        it.hasBase = true;
        it.usedHips = hipsOk;
        it.prevRef = ref;
      }
      const vy = (ref - it.prevRef) / dt / sc; // scales / s, negative = rising
      it.prevRef = ref;
      if (vy < -c.jump.fastRise) it.fastRiseAt = cap;
      const off = (it.baseline - ref) / sc; // > 0 above the baseline
      const frozen = off > 0.08 && cap - it.fastRiseAt < c.jump.freezeMs;
      if (!frozen) it.baseline += (ref - it.baseline) * velAlpha(dt, off < 0 ? c.baseline.downTauMs : c.baseline.upTauMs);
      const jumping = off > (it.jumpOn ? c.jump.exit : c.jump.enter);
      if (jumping && !it.jumpOn && cap - it.jumpAt > c.jump.cooldownMs) {
        sg.jumpFired = true;
        sg.jumps++;
        it.jumpAt = cap;
      }
      it.jumpOn = jumping;
      sg.jump = jumping;
      const sq = off < -(it.squatOn ? c.squat.exit : c.squat.enter);
      it.squatOn = sq;
      sg.squat = sq && !jumping;
    } else {
      it.jumpOn = it.squatOn = sg.jump = sg.squat = false;
      it.hasBase = false;
    }
    // ---- clap: wrists meet after having been apart
    if (P.lw.v >= mv && P.rw.v >= mv) {
      const d = Math.hypot(P.lw.x - P.rw.x, P.lw.y - P.rw.y) / sc;
      const hipY = hipsOk ? (P.lh.y + P.rh.y) / 2 : P.ls.y + sc * 1.7;
      const high = (P.lw.y + P.rw.y) / 2 < hipY - 0.05 * sc;
      if (d > c.clap.apart) it.apartAt = cap;
      const tog = high && d < (it.together ? c.clap.release : c.clap.together);
      if (tog && !it.together && cap - it.apartAt < c.clap.withinMs) {
        sg.clapFired = true;
        sg.claps++;
      }
      it.together = tog;
      sg.clap = tog;
    } else {
      it.together = false;
      sg.clap = false;
    }
    // ---- wave: a raised hand swings left-right (>= 3 reversals within ~1 s)
    let waving = false;
    for (let side = 0; side < 2; side++) {
      const w = side === 0 ? P.lw : P.rw;
      const sh = side === 0 ? P.ls : P.rs;
      const s = it.swing[side];
      const x = f[(side === 0 ? LW : RW) * 2];
      const raised = w.v >= mv && sh.v >= mv && w.y < sh.y + 0.1 * sc;
      if (!raised) {
        s.dir = 0;
        s.n = 0;
        s.lastX = x;
        continue;
      }
      const dx = x - s.lastX;
      if (Math.abs(dx) > c.wave.dead * sc) {
        const dir = dx > 0 ? 1 : -1;
        if (s.dir === 0) s.startX = s.lastX;
        else if (dir !== s.dir) {
          if (Math.abs(s.lastX - s.startX) > c.wave.swing * sc) {
            s.t[s.head] = cap;
            s.head = (s.head + 1) % 3;
            s.n = Math.min(3, s.n + 1);
          }
          s.startX = s.lastX;
        }
        s.dir = dir;
        s.lastX = x;
      }
      if (s.n >= c.wave.reversals) {
        let oldest = Infinity;
        for (let q = 0; q < 3; q++) oldest = Math.min(oldest, s.t[q]);
        if (cap - oldest < c.wave.windowMs && cap - Math.max(s.t[0], s.t[1], s.t[2]) < 450) waving = true;
      }
    }
    it.waveOn = waving;
    sg.wave = waving;
    // ---- arms out sideways (aeroplane)
    if (P.lw.v >= mv && P.rw.v >= mv && shOk) {
      const spread = Math.abs(P.lw.x - P.rw.x) / sc;
      const band = Math.abs(P.lw.y - P.ls.y) < c.armsOut.yBand * sc && Math.abs(P.rw.y - P.rs.y) < c.armsOut.yBand * sc;
      it.armsOn = band && spread > (it.armsOn ? c.armsOut.exit : c.armsOut.enter);
    } else it.armsOn = false;
    sg.armsOut = it.armsOn;
    // ---- stillness: mean speed of head, hands, hips and feet in body scales per second
    let sum = 0;
    let cnt = 0;
    for (let q = 0; q < MOTION_PTS.length; q++) {
      const k = MOTION_PTS[q];
      if (it.arr[k].v < mv) continue;
      sum += Math.hypot(it.vel[k * 2], it.vel[k * 2 + 1]) / sc;
      cnt++;
    }
    if (cnt) {
      sg.energy = lerp(sg.energy, sum / cnt, velAlpha(dt, c.still.tauMs));
      it.stillOn = sg.energy < (it.stillOn ? c.still.exit : c.still.enter);
    }
    sg.still = it.stillOn;
    sg.stillFor = it.stillOn ? sg.stillFor + dt : 0;
  }
  /** presence + freeing, by engine time */
  private sweep(now: number): void {
    const H = CROWD_CFG.hold;
    const hold = this.holdSec();
    const free = this.freeSec(hold);
    let count = 0;
    for (let i = 0; i < this.maxKids; i++) {
      const sl = this.slots[i];
      if (!sl.active) continue;
      const it = this.ints[i];
      const lost = Math.max(0, (now - it.lastSeenNow) / 1000);
      sl.lostFor = lost;
      sl.seenFor = Math.max(0, (now - it.joinedAt) / 1000);
      sl.present = lost < hold;
      sl.goneFor = sl.present ? 0 : lost - hold;
      sl.held = sl.present && lost > H.heldAfterSec;
      if (sl.present) count++;
      else {
        sl.signals.stillFor = 0;
        if (lost > free) this.free(i, true);
      }
    }
    this.count = count;
  }

  /**
   * Render-rate update: moves the points to where the child is now; frees the slots of children who left.
   * Every point has a target = last filtered measurement + velocity x the age of that measurement (camera + model delay + time since it
   * arrived), the velocity having small drifts (noise) taken out and the extra fading out after `coastMs`: a child keeps moving through a
   * missed detection and slows to a stop instead of freezing or flying off. The drawn point chases the target (aimed a little ahead, so
   * the chase itself adds no lag to a steady walk), which hides the jump when the next measurement arrives.
   */
  extrapolate(now: number, lead: number = CROWD_CFG.motion.leadMs): void {
    this.sweep(now);
    const MO = CROWD_CFG.motion;
    const coast = MO.coastMs / 1000;
    const tau = MO.holdTauMs / 1000;
    for (let i = 0; i < this.maxKids; i++) {
      const sl = this.slots[i];
      // a child who is missed for a moment (present or not yet freed) keeps gliding to the end of its coast: never a frozen animal
      if (!sl.active) continue;
      const it = this.ints[i];
      const age = Math.max(0, now - it.tDet + lead) / 1000;
      const reach = (age <= coast ? age : coast + tau * (1 - Math.exp(-(age - coast) / tau))) * MO.gain;
      const dtR = it.lastRender ? (now - it.lastRender) / 1000 : 0;
      it.lastRender = now;
      if (dtR > 0) it.chaseDt += (it.dtEma - it.chaseDt) * (1 - Math.exp(-dtR / MO.chaseRelaxSec));
      const chaseMs = Math.min(MO.chaseMaxMs, Math.max(MO.chaseMinMs, it.chaseDt * 1000 * MO.chaseFrac));
      const snap = !it.rInit || dtR > MO.snapAfterSec;
      const alpha = snap ? 1 : 1 - Math.exp((-dtR * 1000) / chaseMs);
      // the body is aimed the whole chase time ahead (no lag on a steady walk); limbs swing back and forth, so a long chase must not
      // push them past their turning point
      const aheadBody = reach + (snap ? 0 : chaseMs / 1000);
      const aheadLimb = reach + (snap ? 0 : Math.min(chaseMs, MO.chaseAheadMaxMs) / 1000);
      it.rInit = true;
      const bvx = it.ev[ANC * 2];
      const bvy = it.ev[ANC * 2 + 1];
      for (let q = 0; q < N_ALL; q++) {
        const j = q * 2;
        let tx: number;
        let ty: number;
        if (q < N_KP && !IS_TORSO[q]) {
          // a limb's velocity = the body's + its own swing: the body part is aimed the full chase time ahead (a walking child's paws must
          // not trail behind the body), only the swing relative to the body is capped
          tx = it.filt[j] + bvx * aheadBody + (it.ev[j] - bvx) * aheadLimb;
          ty = it.filt[j + 1] + bvy * aheadBody + (it.ev[j + 1] - bvy) * aheadLimb;
        } else {
          tx = it.filt[j] + it.ev[j] * aheadBody;
          ty = it.filt[j + 1] + it.ev[j + 1] * aheadBody;
        }
        it.rx[j] += (tx - it.rx[j]) * alpha;
        it.rx[j + 1] += (ty - it.rx[j + 1]) * alpha;
        if (q < N_KP) {
          const o = it.arr[q];
          o.x = it.rx[j];
          o.y = it.rx[j + 1];
        }
      }
      sl.center.x = it.rx[ANC * 2];
      sl.center.y = it.rx[ANC * 2 + 1];
    }
  }

  /** Clears the one-frame events (joined / left / jumpFired / clapFired). Call after the game's frame. */
  endFrame(): void {
    for (const s of this.slots) {
      s.joined = s.left = false;
      s.signals.jumpFired = s.signals.clapFired = false;
    }
  }
}
