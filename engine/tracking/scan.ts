import type { EngineConfig } from "../config";
import { clamp, dist } from "../math";
import type { Person, Pt } from "../types";
import { HIST_BINS } from "./people";
import type { HistProvider } from "./playerLock";

export interface ScanLockInfo {
  hist: Float32Array | null;
  center: Pt;
  scale: number;
}

export interface ScanStatus {
  progress: number;
  info: string;
  /** people currently selected as candidates (slot order = left to right on screen) */
  candidates: Person[];
  done: boolean;
  result: ScanLockInfo[] | null;
}

/** Both wrists clearly above the nose. */
export function hasBothHandsUp(p: Person): boolean {
  const lm = p.lm;
  return lm[15].v > 0.5 && lm[16].v > 0.5 && lm[0].v > 0.4 && lm[15].y < lm[0].y && lm[16].y < lm[0].y;
}

/**
 * Player scan: the person (1 player) or the two people (2 players) who raise both hands above the head for
 * `scanHoldSec` become the players. With two players the left person on screen is player 1 (blue) and the
 * right one player 2 (yellow). A third person raising hands is ignored (the two closest win).
 */
export class ScanController {
  private t = 0;
  private prev: (Pt | null)[];
  private hists: Float32Array[][];

  constructor(
    private playerCount: number,
    private cfg: EngineConfig["lock"],
  ) {
    this.prev = Array.from({ length: playerCount }, () => null);
    this.hists = Array.from({ length: playerCount }, () => []);
  }

  reset(): void {
    this.t = 0;
    this.prev = this.prev.map(() => null);
    this.hists = this.hists.map(() => []);
  }

  update(people: Person[], dt: number, getHist: HistProvider): ScanStatus {
    const n = this.playerCount;
    const up = people.filter(hasBothHandsUp).sort((a, b) => b.scale - a.scale);
    const chosen = up.slice(0, n).sort((a, b) => a.center.x - b.center.x);
    let info: string;
    if (!people.length) info = "Hech kim ko‘rinmayapti — kamera oldiga turing (1,5–2 m)";
    else if (chosen.length === n) info = "Qimirlamang — skanerlanmoqda…";
    else if (n === 2) {
      info =
        chosen.length === 1
          ? "Yana bir kishi ham ikki qo‘lini ko‘tarsin"
          : `${people.length} kishi ko‘rinyapti · ikkala o‘yinchi ikki qo‘lini ko‘tarsin`;
    } else info = `${people.length} kishi ko‘rinyapti · o‘ynaydigan odam ikki qo‘lini ko‘tarsin`;

    if (chosen.length === n) {
      // the same people must stay roughly where they were, otherwise restart
      for (let i = 0; i < n; i++) {
        const prev = this.prev[i];
        if (prev && dist(prev, chosen[i].center) > chosen[i].scale * 1.2) {
          this.t = 0;
          this.hists.forEach((h) => (h.length = 0));
          break;
        }
      }
      chosen.forEach((c, i) => {
        this.prev[i] = { x: c.center.x, y: c.center.y };
        const h = c.hist ?? (c.hist = getHist(c));
        if (h) this.hists[i].push(h);
      });
      this.t += dt;
    } else {
      this.t = Math.max(0, this.t - dt * 2);
      if (this.t === 0) {
        this.prev = this.prev.map(() => null);
        this.hists.forEach((h) => (h.length = 0));
      }
    }
    const progress = clamp(this.t / this.cfg.scanHoldSec, 0, 1);
    if (this.t >= this.cfg.scanHoldSec && chosen.length === n) {
      const result: ScanLockInfo[] = chosen.map((c, i) => {
        const list = this.hists[i];
        let h: Float32Array | null = null;
        if (list.length) {
          h = new Float32Array(HIST_BINS);
          for (const s of list) for (let b = 0; b < HIST_BINS; b++) h[b] += s[b] / list.length;
        }
        return { hist: h, center: { x: c.center.x, y: c.center.y }, scale: c.scale };
      });
      return { progress: 1, info, candidates: chosen, done: true, result };
    }
    return { progress, info, candidates: chosen, done: false, result: null };
  }
}
