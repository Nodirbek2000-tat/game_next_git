import type { EngineConfig } from "../config";
import { clamp, dist, lerp } from "../math";
import type { Person, Pt } from "../types";
import { HIST_BINS, histSim } from "./people";

export type LockMode = "none" | "locked" | "nearest";

export interface LockSlot {
  mode: LockMode;
  hist: Float32Array | null;
  center: Pt | null;
  scale: number;
  lastSeen: number;
  person: Person | null;
}

export type HistProvider = (p: Person) => Float32Array | null;

const UNASSIGNED = 50;

/**
 * Player lock for 1 or 2 players. Each slot remembers the clothing colour histogram, the last position and
 * scale of its player. On every detection frame the people in view are assigned to the slots with the
 * cheapest joint assignment (position continuity while recently seen, clothing colour otherwise), so
 *  - two players may swap places without swapping identities,
 *  - a stranger (any person that is not the best match of a slot) never takes over,
 *  - a player who leaves and comes back is re-acquired by clothing colour.
 */
export class PlayerLock {
  slots: LockSlot[] = [];
  /** 0 (good light) .. 1 (very dark): clothing colours are unreliable in the dark, so position/continuity counts more */
  private dark = 0;

  constructor(
    count: number,
    private cfg: EngineConfig["lock"],
  ) {
    this.reset(count);
  }

  reset(count: number): void {
    this.slots = [];
    for (let i = 0; i < count; i++) this.slots.push({ mode: "none", hist: null, center: null, scale: 0, lastSeen: 0, person: null });
  }

  setDarkness(d: number): void {
    this.dark = clamp(d, 0, 1);
  }

  lock(slot: number, info: { hist: Float32Array | null; center: Pt; scale: number }, now: number): void {
    const s = this.slots[slot];
    s.mode = info.hist ? "locked" : "nearest";
    s.hist = info.hist;
    s.center = { x: info.center.x, y: info.center.y };
    s.scale = info.scale;
    s.lastSeen = now;
    s.person = null;
  }

  lockNearest(slot: number): void {
    const s = this.slots[slot];
    s.mode = "nearest";
    s.hist = null;
    s.center = null;
    s.person = null;
  }

  private cost(s: LockSlot, p: Person, now: number, multi: boolean, getHist: HistProvider, people: Person[]): number {
    const c = this.cfg;
    const dk = this.dark;
    const recent = now - s.lastSeen < c.continuitySec * 1000;
    const d = s.center ? dist(p.center, s.center) / Math.max(1, s.scale) : 9;
    if (s.mode === "nearest") {
      let cost = 8 - Math.min(7, p.scale / 60);
      if (s.center && recent && d < 1.2) cost -= 6 * (1.2 - d);
      return cost;
    }
    const hist = p.hist ?? (p.hist = getHist(p));
    const sim = histSim(hist, s.hist);
    // dark picture: colours are noisy -> trust them less, trust the position more (and allow a little more movement)
    const w = (multi ? c.colorWeight2 : c.colorWeight1) * (1 - 0.6 * dk);
    const minSim = c.continuityMinSim * (1 - 0.7 * dk);
    const histMin = c.histMin * (1 - 0.2 * dk);
    if (recent && d < c.continuityDist * (1 + 0.4 * dk)) {
      // a different-looking person standing where the player was is not the player
      // (not when people overlap: the colours sampled on a half hidden torso are unreliable)
      const crowded = people.some((q) => q !== p && dist(q.center, p.center) < 0.9 * Math.max(p.scale, q.scale));
      if (!crowded && hist && s.hist && sim < minSim) return Infinity;
      return d + (hist ? (1 - sim) * w : 0);
    }
    if (!hist || sim < histMin) return Infinity;
    return 3 + (1 - sim) * 4 + Math.min(d, 5) * 0.05;
  }

  /** Assign people to the active slots. Returns, per slot, the matched person (or null). */
  update(people: Person[], now: number, getHist: HistProvider): (Person | null)[] {
    const active = this.slots.map((s, i) => (s.mode !== "none" ? i : -1)).filter((i) => i >= 0);
    const multi = this.slots.length > 1;
    const result: (Person | null)[] = this.slots.map(() => null);
    if (active.length && people.length) {
      const needHist = active.some((i) => this.slots[i].mode === "locked" && (multi || now - this.slots[i].lastSeen > 500 || people.length > 1));
      if (needHist) for (const p of people) if (!p.hist) p.hist = getHist(p);
      const costs: number[][] = active.map((i) => people.map((p) => this.cost(this.slots[i], p, now, multi, getHist, people)));
      // exhaustive search: <= 2 slots, <= 4 people
      let best = Infinity;
      let bestAssign: number[] = active.map(() => -1);
      const cur: number[] = active.map(() => -1);
      const rec = (k: number, total: number, used: number): void => {
        if (total >= best) return;
        if (k === active.length) {
          best = total;
          bestAssign = cur.slice();
          return;
        }
        for (let pi = 0; pi < people.length; pi++) {
          if (used & (1 << pi)) continue;
          const c = costs[k][pi];
          if (!Number.isFinite(c)) continue;
          cur[k] = pi;
          rec(k + 1, total + c, used | (1 << pi));
        }
        cur[k] = -1;
        rec(k + 1, total + UNASSIGNED, used);
      };
      rec(0, 0, 0);
      active.forEach((si, k) => {
        const pi = bestAssign[k];
        if (pi >= 0) result[si] = people[pi];
      });
    }
    this.slots.forEach((s, i) => {
      const p = result[i];
      s.person = p;
      if (!p) return;
      s.lastSeen = now;
      s.center = { x: p.center.x, y: p.center.y };
      s.scale = lerp(s.scale || p.scale, p.scale, 0.3);
      if (s.mode === "locked" && s.hist && p.hist && histSim(p.hist, s.hist) > this.cfg.histAdaptAbove) {
        for (let b = 0; b < HIST_BINS; b++) s.hist[b] = lerp(s.hist[b], p.hist[b], this.cfg.histAdaptRate);
      }
    });
    return result;
  }
}
