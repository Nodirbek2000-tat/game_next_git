import type { DetectionResult, TileOutput } from "../types";
import { CROWD_CFG } from "./crowdConfig";
import { TileFusion, tileLayout, type Tile } from "./tiles";

// Decides, for a crowd game, WHAT the pose model looks at next: one crop of the picture (round-robin over 2, optionally 3 crops) or
// the whole picture (the old path). Adaptive and pure (time is passed in): when the model cannot keep up, fewer crops, then the
// full frame; after a long calm spell it climbs back. Nothing here touches the DOM, the camera or the worker.

export interface AdaptCfg {
  maxCycleMs: number;
  upCycleMs: number;
  downAfterSec: number;
  upAfterSec: number;
  cooldownSec: number;
  backoffMax: number;
  overheadMs: number;
  tileVsFull: number;
  emaK: number;
}

/**
 * Rung = number of crops (1 = the whole frame). `counts` is ordered best first, e.g. [2, 1] or [3, 2, 1].
 *
 * Round time of a rung = crops x max(wait between two model calls, model time of a crop + overhead): every child is analysed
 * once per round. The controller steps down when the round of the current rung stays longer than `maxCycleMs`, and steps up when the
 * round of the rung above would be shorter than `upCycleMs` for `upAfterSec` (doubling after an up that was followed by a down).
 */
export class TileController {
  idx = 0;
  private cursor = 0;
  private tileMs = 0;
  private fullMs = 0;
  private capMs = 33;
  private badFor = 0;
  private goodFor = 0;
  private lastT: number | null = null;
  private cooldownUntil = 0;
  private lastUpAt = -1e9;
  private lastChangeAt = 0;
  private upWait: number;

  constructor(
    readonly counts: readonly number[],
    readonly adaptive: boolean = true,
    private cfg: AdaptCfg = CROWD_CFG.adapt,
  ) {
    this.upWait = cfg.upAfterSec;
  }

  /** crops of the current rung (1 = whole frame) */
  get count(): number {
    return this.counts[Math.min(this.idx, this.counts.length - 1)] ?? 1;
  }

  /** model time of one crop / of the whole frame, ms (0 = not measured yet) */
  get modelMs(): number {
    return this.count >= 2 ? this.tileMs : this.fullMs;
  }

  /** Model time of a crop: measured while crops are in use, else derived from the whole frame (an old crop measurement may be from a busy moment). */
  private estTileMs(): number {
    if (this.count >= 2 && this.tileMs > 0) return this.tileMs;
    if (this.fullMs > 0) return this.fullMs * this.cfg.tileVsFull;
    return this.tileMs;
  }

  /** Predicted time of one round over all crops at rung count `count` (0 = unknown). */
  predictedCycle(count: number): number {
    const ms = count >= 2 ? this.estTileMs() : this.fullMs;
    if (!(ms > 0)) return 0;
    const call = Math.max(this.capMs, ms + this.cfg.overheadMs);
    return Math.max(1, count) * call;
  }

  /** Time one child needs to be refreshed, ms (0 = unknown). */
  get cycleMs(): number {
    return this.predictedCycle(this.count);
  }

  /** Which of `n` crops is next (round-robin). */
  next(n: number): number {
    this.cursor = (this.cursor + 1) % Math.max(1, n);
    return this.cursor;
  }

  /**
   * Report a finished model call.
   * @param nowSec time (s)
   * @param inferMs time of the call (picture copy + model), ms
   * @param capMs the minimal time between two calls (the detection rate cap), ms
   * @param tiled the call analysed one crop (false: the whole frame)
   * @returns true when the rung changed
   */
  report(nowSec: number, inferMs: number, capMs: number, tiled: boolean = this.count >= 2): boolean {
    const dt = this.lastT === null ? 0 : Math.min(1, Math.max(0, nowSec - this.lastT));
    this.lastT = nowSec;
    this.capMs = capMs;
    const k = this.cfg.emaK;
    if (inferMs > 0) {
      if (tiled) this.tileMs = this.tileMs > 0 ? this.tileMs + (inferMs - this.tileMs) * k : inferMs;
      else this.fullMs = this.fullMs > 0 ? this.fullMs + (inferMs - this.fullMs) * k : inferMs;
    }
    if (!this.adaptive || this.counts.length < 2) return false;
    if (nowSec < this.cooldownUntil) return false;
    const cfg = this.cfg;
    // calm for a long time: forget the up-backoff
    if (nowSec - this.lastChangeAt > 90) this.upWait = cfg.upAfterSec;
    // down
    const cur = this.predictedCycle(this.count);
    if (this.idx < this.counts.length - 1 && cur > cfg.maxCycleMs) {
      this.badFor += dt;
      this.goodFor = 0;
      if (this.badFor >= cfg.downAfterSec) {
        if (nowSec - this.lastUpAt < 30) this.upWait = Math.min(this.upWait * 2, cfg.upAfterSec * cfg.backoffMax);
        this.idx++;
        return this.changed(nowSec);
      }
      return false;
    }
    this.badFor = Math.max(0, this.badFor - dt);
    // up
    if (this.idx > 0) {
      const up = this.predictedCycle(this.counts[this.idx - 1]);
      if (up > 0 && up < cfg.upCycleMs) {
        this.goodFor += dt;
        if (this.goodFor >= this.upWait) {
          this.idx--;
          this.lastUpAt = nowSec;
          return this.changed(nowSec);
        }
      } else this.goodFor = Math.max(0, this.goodFor - dt);
    }
    return false;
  }

  private changed(nowSec: number): boolean {
    this.badFor = 0;
    this.goodFor = 0;
    this.cursor = 0;
    this.cooldownUntil = nowSec + this.cfg.cooldownSec;
    this.lastChangeAt = nowSec;
    return true;
  }
}

export interface CrowdVisionOpts {
  /** ?tiles=: 0 whole frame only, 2 / 3 that many crops, no adaptation; null = automatic */
  force: number | null;
  /** crops are allowed on this device / back-end (worker, not a phone) when not forced */
  allow: boolean;
  centre?: boolean;
}

/** Choice of crops + fusion of their results; the runtime asks `plan` before every model call and hands the result to `ingest`. */
export class CrowdVision {
  readonly ctl: TileController;
  readonly fusion = new TileFusion();
  /** most crops the detector must have ready (0 = crops are never used) */
  readonly maxTiles: number;
  private mode: "full" | "tiles" = "full";
  /** the last call looked at a crop (not at the whole frame) */
  get tiled(): boolean {
    return this.mode === "tiles";
  }
  private layoutKey = "";
  private tiles: Tile[] = [];
  /** bodies in the latest combined list (debug) */
  get bodies(): number {
    return this.fusion.total;
  }

  constructor(o: CrowdVisionOpts) {
    const centre = o.centre ?? CROWD_CFG.tiles.centre;
    let counts: number[];
    let adaptive = true;
    if (o.force !== null) {
      adaptive = false;
      counts = o.force >= 2 ? [Math.min(3, Math.floor(o.force))] : [1];
    } else if (!o.allow) counts = [1];
    else counts = centre ? [3, 2, 1] : [2, 1];
    this.ctl = new TileController(counts, adaptive && counts.length > 1);
    this.maxTiles = counts[0] >= 2 ? counts[0] : 0;
  }

  /** The crops of the current rung for this picture size (one entry = the whole frame). */
  layout(frameW: number, frameH: number): Tile[] {
    const key = `${this.ctl.count}|${frameW}|${frameH}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.tiles = tileLayout(frameW, frameH, this.ctl.count);
    }
    return this.tiles;
  }

  /**
   * The crop to analyse next (a one-element list), or null = analyse the whole frame the old way.
   * @param ready how many crops the detector has ready (see Detector.tilesReady)
   */
  plan(frameW: number, frameH: number, ready: number): Tile[] | null {
    if (this.maxTiles < 2 || this.ctl.count < 2) return this.toFull();
    const tiles = this.layout(frameW, frameH);
    if (tiles.length < 2 || ready < tiles.length) return this.toFull();
    if (this.mode !== "tiles") {
      this.mode = "tiles";
      this.fusion.reset();
    }
    return [tiles[this.ctl.next(tiles.length)]];
  }

  private toFull(): null {
    if (this.mode !== "full") {
      this.mode = "full";
      this.fusion.reset();
    }
    return null;
  }

  /** Crop results -> one pose result in frame coordinates (see TileFusion). */
  ingest(outs: readonly TileOutput[], tiles: readonly Tile[], capture: number): DetectionResult {
    return this.fusion.ingest(outs, tiles, capture);
  }

  /** Report a finished model call; fusion is dropped when the rung changes. */
  report(nowSec: number, inferMs: number, capMs: number): void {
    if (this.ctl.report(nowSec, inferMs, capMs, this.mode === "tiles")) {
      this.fusion.reset();
      this.layoutKey = "";
    }
  }

  /** "2 bo‘lak (aylanma)" / "to‘liq kadr" for the debug line */
  describe(): string {
    if (this.mode === "tiles") return `${this.tiles.length} bo‘lak, aylanma`;
    return "to‘liq kadr";
  }
}
