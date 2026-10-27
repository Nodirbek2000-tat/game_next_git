import type { EngineConfig } from "../config";
import { TAU, clamp, dist, lerp } from "../math";
import type { GestureState, HandInfo, HandShape, Pt, PlayerFrame, SwipeDir, SwipeEvent } from "../types";

/**
 * Boolean gesture with hysteresis (different enter / exit thresholds on a scalar signal) and a stability
 * window: the output only flips after `frames` consecutive frames agree on the new state.
 */
export class StableBool {
  state = false;
  private candidate = false;
  private count = 0;

  constructor(
    private enter: number,
    private exit: number,
    private frames = 3,
  ) {}

  configure(enter: number, exit: number, frames: number): void {
    this.enter = enter;
    this.exit = exit;
    this.frames = frames;
  }

  reset(): void {
    this.state = false;
    this.candidate = false;
    this.count = 0;
  }

  /** `value` is a scalar where larger = more "on". NaN counts as "off". */
  update(value: number): boolean {
    // raw decision with hysteresis relative to the CURRENT stable state
    const raw = this.state ? !(value < this.exit) && !Number.isNaN(value) : value > this.enter;
    if (raw === this.state) {
      this.candidate = this.state;
      this.count = 0;
    } else {
      if (raw === this.candidate) this.count++;
      else {
        this.candidate = raw;
        this.count = 1;
      }
      if (this.count >= this.frames) {
        this.state = raw;
        this.count = 0;
      }
    }
    return this.state;
  }
}

/** Stability window for categorical values (e.g. hand shapes). */
export class StableLabel<T> {
  value: T;
  private cand: T;
  private count = 0;

  constructor(
    initial: T,
    private frames = 3,
  ) {
    this.value = initial;
    this.cand = initial;
  }

  update(v: T): T {
    if (v === this.value) {
      this.cand = v;
      this.count = 0;
    } else {
      if (v === this.cand) this.count++;
      else {
        this.cand = v;
        this.count = 1;
      }
      if (this.count >= this.frames) {
        this.value = v;
        this.count = 0;
      }
    }
    return this.value;
  }
}

/** Reel crank: circles drawn by a hand around its own slowly moving centre (ported from the prototype fishing game). */
export class CrankTracker {
  rate = 0;
  private cx = 0;
  private cy = 0;
  private ang = 0;
  private has = false;

  constructor(private cfg: EngineConfig["gestures"]) {}

  reset(): void {
    this.has = false;
    this.rate = 0;
  }

  /** (x, y) hand position in stage px, `scale` body scale, dt seconds. Pass visible=false when the hand is not seen. */
  update(x: number, y: number, visible: boolean, scale: number, dt: number): number {
    const c = this.cfg;
    if (!visible) {
      this.rate = lerp(this.rate, 0, 0.1);
      return this.rate;
    }
    if (!this.has) {
      this.cx = x;
      this.cy = y;
      this.ang = Math.atan2(0, 0);
      this.has = true;
    }
    const k = 1 - Math.exp(-dt / c.crankTau);
    this.cx = lerp(this.cx, x, k);
    this.cy = lerp(this.cy, y, k);
    const r = Math.hypot(x - this.cx, y - this.cy);
    const a = Math.atan2(y - this.cy, x - this.cx);
    let da = a - this.ang;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    this.ang = a;
    const raw = r > scale * c.crankRadius && Math.abs(da) < c.crankMaxStep ? Math.abs(da) / dt / TAU : 0;
    this.rate = clamp(lerp(this.rate, raw, c.crankSmooth), 0, c.crankMax);
    return this.rate;
  }
}

/** Fires once when a wrist moves faster than a threshold; then holds off for a cooldown. */
export class SwipeDetector {
  private lastFire = -1e9;

  constructor(private cfg: EngineConfig["gestures"]) {}

  update(vx: number, vy: number, H: number, now: number, out: SwipeEvent): SwipeEvent {
    out.fired = false;
    const sp = Math.hypot(vx, vy) / H;
    out.speed = sp;
    if (sp > this.cfg.swipeSpeed && now - this.lastFire > this.cfg.swipeCooldownMs) {
      this.lastFire = now;
      out.fired = true;
      out.dir = (Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? "right" : "left") : vy > 0 ? "down" : "up") as SwipeDir;
    }
    return out;
  }
}

/** Finger-state classification of a MediaPipe hand (21 points). */
export function handInfo(pts: Pt[]): HandInfo {
  const d = (a: number, b: number) => dist(pts[a], pts[b]);
  const ext = (t: number, q: number) => d(0, t) > d(0, q) * 1.12;
  const size = Math.max(8, d(0, 9));
  const e = {
    idx: ext(8, 6),
    mid: ext(12, 10),
    ring: ext(16, 14),
    pinky: ext(20, 18),
    thumb: d(4, 17) > d(3, 17) * 1.04 && d(4, 5) > size * 0.5,
  };
  const n4 = [e.idx, e.mid, e.ring, e.pinky].filter(Boolean).length;
  let shape: HandShape = "other";
  if (n4 === 0) shape = "fist";
  else if (n4 >= 4) shape = "open";
  else if (e.idx && !e.mid && !e.ring && !e.pinky) shape = e.thumb ? "gun" : "point";
  else if (e.idx && e.mid && !e.ring && !e.pinky) shape = "peace";
  return {
    pts,
    size,
    shape,
    pinchD: d(4, 8) / size,
    palm: { x: (pts[0].x + pts[9].x) / 2, y: (pts[0].y + pts[9].y) / 2 },
  };
}

export const emptySwipe = (): SwipeEvent => ({ fired: false, dir: "up", speed: 0 });

export function emptyGestures(): GestureState {
  return {
    handsAboveHead: false,
    handUp: { L: false, R: false },
    kneeUp: { L: false, R: false },
    shape: { L: "other", R: "other" },
    crank: { L: 0, R: 0 },
    wristVel: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } },
    swipe: { L: emptySwipe(), R: emptySwipe() },
    name: "—",
  };
}

/**
 * Per-player gesture classifier. Call `update` once per detection frame with the player's filtered
 * landmarks. All outputs are written into `pf.gestures` (no allocation).
 */
export class GestureEngine {
  private aboveHead: StableBool;
  private handUp = { L: new StableBool(0, 0), R: new StableBool(0, 0) };
  private knee = { L: new StableBool(0.3, 0.15), R: new StableBool(0.3, 0.15) };
  private shape = { L: new StableLabel<HandShape>("other"), R: new StableLabel<HandShape>("other") };
  private crank: { L: CrankTracker; R: CrankTracker };
  private swipe: { L: SwipeDetector; R: SwipeDetector };
  private prevWrist: { L: Pt & { t: number }; R: Pt & { t: number } } | null = null;
  private velSm = { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } };

  constructor(private cfg: EngineConfig["gestures"]) {
    this.aboveHead = new StableBool(cfg.aboveHeadEnter, cfg.aboveHeadExit, cfg.stableFrames);
    for (const s of ["L", "R"] as const) this.handUp[s].configure(cfg.handUpEnter, cfg.handUpExit, cfg.stableFrames);
    this.crank = { L: new CrankTracker(cfg), R: new CrankTracker(cfg) };
    this.swipe = { L: new SwipeDetector(cfg), R: new SwipeDetector(cfg) };
  }

  reset(): void {
    this.aboveHead.reset();
    for (const s of ["L", "R"] as const) {
      this.handUp[s].reset();
      this.knee[s].reset();
      this.crank[s].reset();
    }
    this.prevWrist = null;
  }

  update(pf: PlayerFrame, dt: number, now: number, H: number): void {
    const g = pf.gestures;
    const lm = pf.lm;
    const s = Math.max(1, pf.scale);
    const nose = lm[0];
    // hands above the head
    const lw = lm[15];
    const rw = lm[16];
    const bothVis = lw.v > 0.5 && rw.v > 0.5 && nose.v > 0.4;
    g.handsAboveHead = this.aboveHead.update(bothVis ? Math.min(nose.y - lw.y, nose.y - rw.y) / s : NaN);
    // hand above the shoulder
    g.handUp.L = this.handUp.L.update(lw.v > 0.4 && lm[11].v > 0.4 ? (lm[11].y - lw.y) / s : NaN);
    g.handUp.R = this.handUp.R.update(rw.v > 0.4 && lm[12].v > 0.4 ? (lm[12].y - rw.y) / s : NaN);
    // knees (from the leg calibration)
    g.kneeUp.L = this.knee.L.update(pf.legs.brake);
    g.kneeUp.R = this.knee.R.update(pf.legs.gas);
    // hand shapes (stable)
    for (const side of ["L", "R"] as const) {
      const h = pf.hands[side];
      g.shape[side] = this.shape[side].update(h ? h.shape : "other");
    }
    // wrist velocity + swipe + crank
    for (const side of ["L", "R"] as const) {
      const w = side === "L" ? pf.raw[15] : pf.raw[16];
      const prev = this.prevWrist?.[side];
      const vis = w.v > 0.35;
      if (vis && prev && now - prev.t < 200) {
        const d = Math.max(0.001, (now - prev.t) / 1000);
        this.velSm[side].x = lerp(this.velSm[side].x, (w.x - prev.x) / d, 0.6);
        this.velSm[side].y = lerp(this.velSm[side].y, (w.y - prev.y) / d, 0.6);
      } else if (!vis) {
        this.velSm[side].x = this.velSm[side].y = 0;
      }
      g.wristVel[side].x = this.velSm[side].x / H;
      g.wristVel[side].y = this.velSm[side].y / H;
      this.swipe[side].update(this.velSm[side].x, this.velSm[side].y, H, now, g.swipe[side]);
      const hand = pf.hands[side];
      const cp = hand ? hand.palm : w;
      g.crank[side] = this.crank[side].update(cp.x, cp.y, hand ? true : vis, s, Math.max(0.001, dt));
    }
    this.prevWrist = {
      L: { x: pf.raw[15].x, y: pf.raw[15].y, t: now },
      R: { x: pf.raw[16].x, y: pf.raw[16].y, t: now },
    };
    g.name = this.nameOf(g);
  }

  private nameOf(g: GestureState): string {
    if (g.swipe.L.fired || g.swipe.R.fired) {
      const e = g.swipe.L.fired ? g.swipe.L : g.swipe.R;
      return `swipe ${e.dir}`;
    }
    if (g.handsAboveHead) return "ikki qo‘l tepada";
    if (g.crank.L > 0.5 || g.crank.R > 0.5) return "doira";
    if (g.kneeUp.L && g.kneeUp.R) return "ikki tizza";
    if (g.kneeUp.R) return "o‘ng tizza";
    if (g.kneeUp.L) return "chap tizza";
    if (g.handUp.L && g.handUp.R) return "ikki qo‘l yelkadan yuqori";
    if (g.handUp.R) return "o‘ng qo‘l yuqori";
    if (g.handUp.L) return "chap qo‘l yuqori";
    return "—";
  }
}
