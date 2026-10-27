import type { BladeLike } from "./logic";

// "Xona" (party) mode: every hand of every person the camera sees is a blade. No player lock, one shared score.
// The engine only locks 1-2 players, so the extra people come from the tracker's raw people list (see getPeople()).

export const MAX_HANDS = 12;
const MAX_CANDIDATES = 16;

interface Pt3 {
  x: number;
  y: number;
  v: number;
}
export interface PersonLike {
  /** 33 pose landmarks in stage px (index fingers 19 / 20, wrists 15 / 16) */
  lm: ArrayLike<Pt3>;
}

export interface HandCfg {
  minVis: number;
  velSmooth: number;
  dropoutMs: number;
  /** render-rate extrapolation cap (ms) and gain */
  extrapMs: number;
  gain: number;
  /** display latency added on top of the age of the detection (ms, default 0) */
  leadMs?: number;
  /** frame-rate independent velocity smoothing time constant (ms); when set it replaces `velSmooth` */
  velTauMs?: number;
}

export interface HandTrack extends BladeLike {
  id: number;
  // detection-time state
  bx: number;
  by: number;
  bvx: number;
  bvy: number;
  bt: number;
  seen: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Collects the hands of all people into a pool of blade tracks. Matching between detections is greedy nearest-neighbour
 * (a hand cannot jump further than `maxJump` between two detections), velocities are smoothed like the engine's blades,
 * and positions are extrapolated to the render time. Nothing is allocated in `update`.
 */
export class HandCollector {
  readonly tracks: HandTrack[] = [];
  /** hands currently tracked */
  active = 0;
  /** highest number of simultaneously tracked hands */
  peak = 0;
  private last: readonly PersonLike[] | null = null;
  private cx = new Float32Array(MAX_CANDIDATES);
  private cy = new Float32Array(MAX_CANDIDATES);
  private used = new Uint8Array(MAX_CANDIDATES);
  private claimed = new Uint8Array(MAX_HANDS);
  private nc = 0;

  constructor(private cfg: HandCfg) {
    for (let i = 0; i < MAX_HANDS; i++) {
      this.tracks.push({ id: i, active: false, side: i & 1 ? "R" : "L", x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, speed: 0, bx: 0, by: 0, bvx: 0, bvy: 0, bt: 0, seen: 0 });
    }
  }

  reset(): void {
    for (const t of this.tracks) t.active = false;
    this.active = 0;
    this.last = null;
  }

  /**
   * Call every frame. `people` is the tracker's people array: when its identity changed a new detection arrived.
   * @param H stage height in px (speeds are in screen heights / s)
   * @param captureAt camera capture time of the detection (ms, default `now`): velocities and the prediction run on it
   */
  update(people: readonly PersonLike[] | null, now: number, H: number, captureAt: number = now): void {
    if (people !== this.last) {
      this.last = people;
      this.detect(people, Math.min(now, captureAt), H);
    }
    this.render(now, H);
  }

  private detect(people: readonly PersonLike[] | null, now: number, H: number): void {
    const c = this.cfg;
    const nc0 = this.collect(people);
    const maxJump = H * 0.32;
    this.used.fill(0, 0, nc0);
    this.claimed.fill(0);
    // greedy global-nearest assignment of candidates to live tracks
    for (let iter = 0; iter < MAX_CANDIDATES; iter++) {
      let bi = -1;
      let bj = -1;
      let bd = maxJump * maxJump;
      for (let i = 0; i < MAX_HANDS; i++) {
        const t = this.tracks[i];
        if (!t.active || this.claimed[i]) continue;
        for (let j = 0; j < nc0; j++) {
          if (this.used[j]) continue;
          const dx = this.cx[j] - t.bx;
          const dy = this.cy[j] - t.by;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            bi = i;
            bj = j;
          }
        }
      }
      if (bi < 0) break;
      this.claimed[bi] = 1;
      this.used[bj] = 1;
      const t = this.tracks[bi];
      const dt = Math.max(0.001, (now - t.bt) / 1000);
      const a = c.velTauMs ? 1 - Math.exp((-dt * 1000) / c.velTauMs) : c.velSmooth;
      const ivx = (this.cx[bj] - t.bx) / dt;
      const ivy = (this.cy[bj] - t.by) / dt;
      // the hand turned around: take the new direction at once (less overshoot)
      const k = c.velTauMs && t.bvx * ivx + t.bvy * ivy < 0 ? Math.max(a, 0.92) : a;
      t.bvx = lerp(t.bvx, ivx, k);
      t.bvy = lerp(t.bvy, ivy, k);
      t.bx = this.cx[bj];
      t.by = this.cy[bj];
      t.bt = t.seen = now;
    }
    // new hands take free tracks
    for (let j = 0; j < nc0; j++) {
      if (this.used[j]) continue;
      for (let i = 0; i < MAX_HANDS; i++) {
        const t = this.tracks[i];
        if (t.active) continue;
        t.active = true;
        t.bx = t.x = t.px = this.cx[j];
        t.by = t.y = t.py = this.cy[j];
        t.bvx = t.bvy = t.vx = t.vy = t.speed = 0;
        t.bt = t.seen = now;
        this.claimed[i] = 1;
        break;
      }
    }
    // hands that were not seen for a while disappear
    for (let i = 0; i < MAX_HANDS; i++) {
      const t = this.tracks[i];
      if (t.active && !this.claimed[i] && now - t.seen > c.dropoutMs) t.active = false;
    }
    void H;
  }

  private collect(people: readonly PersonLike[] | null): number {
    let n = 0;
    if (!people) return 0;
    const minVis = this.cfg.minVis;
    for (let p = 0; p < people.length && n < MAX_CANDIDATES; p++) {
      const lm = people[p].lm;
      if (lm.length < 21) continue;
      for (let s = 0; s < 2 && n < MAX_CANDIDATES; s++) {
        const idx = lm[s === 0 ? 19 : 20];
        const wr = lm[s === 0 ? 15 : 16];
        const pt = idx.v > minVis ? idx : wr.v > minVis ? wr : null;
        if (!pt) continue;
        this.cx[n] = pt.x;
        this.cy[n] = pt.y;
        n++;
      }
    }
    this.nc = n;
    return n;
  }

  private render(now: number, H: number): void {
    const { extrapMs, gain } = this.cfg;
    const lead = this.cfg.leadMs ?? 0;
    let act = 0;
    for (let i = 0; i < MAX_HANDS; i++) {
      const t = this.tracks[i];
      if (!t.active) continue;
      act++;
      const dt = Math.min(extrapMs, Math.max(0, now - t.bt + lead)) / 1000;
      t.px = t.x;
      t.py = t.y;
      t.x = t.bx + t.bvx * dt * gain;
      t.y = t.by + t.bvy * dt * gain;
      t.vx = t.bvx;
      t.vy = t.bvy;
      t.speed = Math.hypot(t.bvx, t.bvy) / H;
    }
    this.active = act;
    if (act > this.peak) this.peak = act;
  }
}

/** Minimal view of the live engine runtime that exposes every detected person (see engine README: window.__engine). */
interface RuntimeHandle {
  slug?: string;
  tracker?: { people?: readonly PersonLike[]; lastCaptureAt?: number };
}

/**
 * All people the camera currently sees (locked players and bystanders). The public EngineApi only exposes the 1-2 locked
 * players, so the party mode reads the live runtime handle. Returns null when it is not reachable (then the game falls back
 * to the engine players' blades).
 */
export function getPeople(): readonly PersonLike[] | null {
  if (typeof window === "undefined") return null;
  const rt = (window as unknown as { __engine?: RuntimeHandle }).__engine;
  return rt?.tracker?.people ?? null;
}

/** Camera capture time (ms) of the people returned by `getPeople()`; undefined when not reachable. */
export function getCaptureAt(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const rt = (window as unknown as { __engine?: RuntimeHandle }).__engine;
  return rt?.tracker?.lastCaptureAt || undefined;
}
