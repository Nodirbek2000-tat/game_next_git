import { OneEuro } from "./oneEuro";
import { leadMs, predict, velAlpha } from "./prediction";
import type { Person } from "../types";

// "Bog‘cha" (kindergarten) crowd tracking: every detected person (2..5 children) is exposed as a stable "kid slot".
// No player lock, no scan: slots are assigned by left-to-right position and then kept by position continuity.
// Per kid: key points in stage px (filtered + lightly predicted) and simple signals (handsUp, jump, squat, clap, wave,
// stillness, armsOut) tuned for small, quickly moving bodies. Nothing is allocated after construction.

export const MAX_KIDS = 5;
/** a slot of a child who is gone is freed after this many seconds */
export const FREE_AFTER_SEC = 2;

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
  /** seen in the last 0.35 s */
  present: boolean;
  /** seconds since the child was last seen */
  lostFor: number;
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
  filter: { minCutoff: 1.4, beta: 8, dCutoff: 4 },
  /** render-rate extrapolation: lighter than the adult engine (children move in all directions, jitter shows on avatars) */
  extrapolation: { maxMs: 100, gain: 0.7, leadMs: 8 },
  /** position continuity: max distance in body scales (plus growth while the child is away) */
  matchScales: 2.6,
  matchGrowPerSec: 2.0,
  matchMaxFrac: 0.5,
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
    lostFor: 0,
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
  fx: OneEuro[];
  fy: OneEuro[];
  filt = new Float32Array(N_KP * 2);
  vel = new Float32Array(N_KP * 2);
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
    const f = KIDS_CFG.filter;
    this.fx = Array.from({ length: N_KP }, () => new OneEuro(f.minCutoff, f.beta, f.dCutoff));
    this.fy = Array.from({ length: N_KP }, () => new OneEuro(f.minCutoff, f.beta, f.dCutoff));
  }

  reset(): void {
    for (const o of this.fx) o.reset();
    for (const o of this.fy) o.reset();
    this.filt.fill(0);
    this.vel.fill(0);
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
 * Turns the tracker's raw people into up to 5 stable kid slots (see file header).
 *
 *   update(people, now, capture, H)  per detection (30-60 Hz)
 *   extrapolate(now)                 per render frame: prediction, presence, frees slots of children who left
 *   endFrame()                       per render frame AFTER the game ran: clears the one-frame events
 */
export class KidTracker {
  readonly slots: KidSlot[] = Array.from({ length: MAX_KIDS }, (_, i) => mkSlot(i));
  /** children seen right now */
  count = 0;
  private ints: Internal[] = this.slots.map((s) => new Internal(s));
  private cand: (Person | null)[] = new Array<Person | null>(MAX_KIDS).fill(null);
  private candUsed = new Uint8Array(MAX_KIDS);
  private slotTaken = new Uint8Array(MAX_KIDS);
  private order = new Uint8Array(MAX_KIDS);
  private nc = 0;
  private W = 1280;
  /** how many slots may be used (meta.maxKids) */
  maxKids: number = MAX_KIDS;

  reset(): void {
    for (let i = 0; i < MAX_KIDS; i++) this.free(i, false);
    this.count = 0;
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
    s.signals.jump = s.signals.squat = s.signals.clap = s.signals.wave = s.signals.armsOut = s.signals.handsUp = s.signals.still = false;
    s.signals.handUp.L = s.signals.handUp.R = false;
    this.ints[i].reset();
  }

  /** The free slot that keeps the left-to-right order of the active ones; when all are taken the one whose child is gone longest. */
  private pickSlot(cx: number): number {
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
    let wl = 0;
    for (let s = 0; s < n; s++) {
      const sl = this.slots[s];
      if (!sl.present && sl.lostFor > wl) {
        wl = sl.lostFor;
        worst = s;
      }
    }
    return worst;
  }

  /**
   * @param people the tracker's people of this detection (stage px, mirrored)
   * @param now engine time (ms)
   * @param capture camera capture time (ms): filters and velocities run on it
   * @param W stage width (limits how far a child may "jump" between detections)
   */
  update(people: readonly Person[], now: number, capture: number = now, W = this.W): void {
    this.W = W;
    const n = this.maxKids;
    // 1) candidates
    let nc = 0;
    for (let i = 0; i < people.length && nc < n; i++) {
      if (this.isKid(people[i])) this.cand[nc++] = people[i];
    }
    this.nc = nc;
    this.candUsed.fill(0);
    this.slotTaken.fill(0);
    // 2) greedy global-nearest matching of active slots (also those whose child is briefly gone) to candidates
    for (let iter = 0; iter < n; iter++) {
      let bs = -1;
      let bc = -1;
      let bd = Infinity;
      for (let s = 0; s < n; s++) {
        const sl = this.slots[s];
        if (!sl.active || this.slotTaken[s]) continue;
        const it = this.ints[s];
        const gap = Math.min(0.25, Math.max(0, (now - it.lastSeenNow) / 1000));
        const px = it.cx + it.vcx * gap;
        const py = it.cy + it.vcy * gap;
        const away = Math.max(0, (now - it.lastSeenNow) / 1000);
        const lim = Math.min(W * KIDS_CFG.matchMaxFrac, sl.scale * (KIDS_CFG.matchScales + KIDS_CFG.matchGrowPerSec * away));
        for (let c = 0; c < nc; c++) {
          if (this.candUsed[c]) continue;
          const p = this.cand[c] as Person;
          const d = Math.hypot(p.center.x - px, p.center.y - py);
          if (d < lim && d < bd) {
            bd = d;
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
    // 3) new children, left to right
    let m = 0;
    for (let c = 0; c < nc; c++) if (!this.candUsed[c]) this.order[m++] = c;
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
      const s = this.pickSlot(p.center.x);
      if (s < 0) continue;
      if (this.slots[s].active) this.free(s, true); // stole a slot whose child is gone
      this.slotTaken[s] = 1;
      this.apply(s, p, now, capture, true);
    }
    this.sweep(now);
  }

  /** Fill a slot from a person: filtered points, velocities, signals. */
  private apply(i: number, p: Person, now: number, cap: number, fresh: boolean): void {
    const sl = this.slots[i];
    const it = this.ints[i];
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
    const dtDet = it.hasDet ? Math.min(0.2, Math.max(0.001, (cap - it.tDet) / 1000)) : 1 / 30;
    // centre velocity (position continuity)
    if (!fresh) {
      const a = velAlpha(Math.max(0.001, (now - it.lastSeenNow) / 1000), 120);
      it.vcx = lerp(it.vcx, (p.center.x - it.cx) / Math.max(0.001, (now - it.lastSeenNow) / 1000), a);
      it.vcy = lerp(it.vcy, (p.center.y - it.cy) / Math.max(0.001, (now - it.lastSeenNow) / 1000), a);
    }
    it.cx = p.center.x;
    it.cy = p.center.y;
    it.lastSeenNow = now;
    sl.center.x = p.center.x;
    sl.center.y = p.center.y;
    sl.scale = lerp(sl.scale, p.scale, 0.3);
    sl.present = true;
    sl.lostFor = 0;
    const va = velAlpha(dtDet, 30);
    for (let k = 0; k < N_KP; k++) {
      const src = p.lm[KP[k]];
      const nx = it.fx[k].filter(src.x, cap);
      const ny = it.fy[k].filter(src.y, cap);
      const f = it.filt;
      if (it.hasDet && cap - it.tDet < 200) {
        it.vel[k * 2] = lerp(it.vel[k * 2], (nx - f[k * 2]) / dtDet, va);
        it.vel[k * 2 + 1] = lerp(it.vel[k * 2 + 1], (ny - f[k * 2 + 1]) / dtDet, va);
      } else {
        it.vel[k * 2] = it.vel[k * 2 + 1] = 0;
      }
      f[k * 2] = nx;
      f[k * 2 + 1] = ny;
      const o = it.arr[k];
      o.x = nx;
      o.y = ny;
      o.v = src.v;
    }
    it.tDet = cap;
    it.hasDet = true;
    sl.headR = Math.max(sl.scale * 0.42, Math.hypot(p.lm[7].x - p.lm[8].x, p.lm[7].y - p.lm[8].y) * 0.75);
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
    let count = 0;
    for (let i = 0; i < this.maxKids; i++) {
      const sl = this.slots[i];
      if (!sl.active) continue;
      const it = this.ints[i];
      const lost = Math.max(0, (now - it.lastSeenNow) / 1000);
      sl.lostFor = lost;
      sl.seenFor = Math.max(0, (now - it.joinedAt) / 1000);
      sl.present = lost < 0.35;
      if (sl.present) count++;
      else {
        sl.signals.stillFor = 0;
        if (lost > FREE_AFTER_SEC) this.free(i, true);
      }
    }
    this.count = count;
  }

  /** Render-rate update: moves the points to where the child is now; frees the slots of children who left. */
  extrapolate(now: number, lead: number = KIDS_CFG.extrapolation.leadMs): void {
    this.sweep(now);
    const { maxMs, gain } = KIDS_CFG.extrapolation;
    for (let i = 0; i < this.maxKids; i++) {
      const sl = this.slots[i];
      if (!sl.active || !sl.present) continue;
      const it = this.ints[i];
      const dtMs = leadMs(now, it.tDet, lead, maxMs);
      for (let k = 0; k < N_KP; k++) {
        const o = it.arr[k];
        o.x = predict(it.filt[k * 2], it.vel[k * 2], dtMs, gain);
        o.y = predict(it.filt[k * 2 + 1], it.vel[k * 2 + 1], dtMs, gain);
      }
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
