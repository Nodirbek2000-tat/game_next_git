import type { DetectionResult, NormLm, TileOutput } from "../types";
import { CROWD_CFG } from "./crowdConfig";

// Crop ("tile") detection for crowd games. Pure geometry + fusion, no DOM, no MediaPipe (the worker only runs the models).
//
// Why: the pose models first run a person detector on the WHOLE picture squeezed to ~224 px. In a 16:9 picture that is 224 x 126 px, so a
// child standing far away is a few pixels tall and is not found. A square crop of the left or right part of a 720p picture is
// 1.78x larger in the detector's eyes (and the landmark stage reads its pixels from the crop, not from a 224 px copy).
//
// Coordinates: "frame" = the camera picture, normalised 0..1. A tile is a rectangle of the frame; the model sees only that rectangle and
// returns landmarks normalised to it. `tileToFrame` maps them back.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile extends Rect {
  index: number;
  /** x range (frame fraction) whose bodies this tile reports: the halves of the overlaps are split between neighbours */
  own0: number;
  own1: number;
}

export interface LayoutCfg {
  minAspect: number;
  overlapMin: number;
}

export const fullTile = (): Tile => ({ index: 0, x: 0, y: 0, w: 1, h: 1, own0: 0, own1: 1 });

/**
 * 2 or 3 square-ish crops side by side over the full height of the frame. `count` < 2, or a frame that is not wide enough
 * (4:3), gives the single full-frame "tile".
 *
 * Crop width = frame height (square) but never so small that the crops leave a gap or overlap less than `overlapMin`.
 */
export function tileLayout(frameW: number, frameH: number, count: number, cfg: LayoutCfg = CROWD_CFG.tiles): Tile[] {
  const n = Math.min(3, Math.floor(count));
  if (n < 2 || !(frameW > 0) || !(frameH > 0) || frameW / frameH < cfg.minAspect) return [fullTile()];
  const w = Math.min(0.999, Math.max(frameH / frameW, 1 / (n - (n - 1) * cfg.overlapMin)));
  const step = (1 - w) / (n - 1);
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) tiles.push({ index: i, x: i * step, y: 0, w, h: 1, own0: 0, own1: 1 });
  for (let i = 0; i < n - 1; i++) {
    const b = (tiles[i].x + w + tiles[i + 1].x) / 2; // middle of the overlap
    tiles[i].own1 = b;
    tiles[i + 1].own0 = b;
  }
  return tiles;
}

export interface PxRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** The tile as an integer pixel rectangle of a `vw` x `vh` picture (inside the picture, at least 2 px). */
export function tileRectPx(t: Rect, vw: number, vh: number): PxRect {
  const sx = Math.max(0, Math.min(vw - 2, Math.round(t.x * vw)));
  const sy = Math.max(0, Math.min(vh - 2, Math.round(t.y * vh)));
  const sw = Math.max(2, Math.min(vw - sx, Math.round(t.w * vw)));
  const sh = Math.max(2, Math.min(vh - sy, Math.round(t.h * vh)));
  return { sx, sy, sw, sh };
}

/** Size of the picture sent to the model for a crop of `sw` x `sh` px: longest side `side`, never enlarged. */
export function tileOutSize(sw: number, sh: number, side: number): { w: number; h: number; scaled: boolean } {
  const k = Math.min(1, side / Math.max(sw, sh));
  if (k >= 1) return { w: sw, h: sh, scaled: false };
  return { w: Math.max(2, Math.round(sw * k)), h: Math.max(2, Math.round(sh * k)), scaled: true };
}

/** Landmark normalised to the tile -> normalised to the frame. */
export function tileToFrame(t: Rect, p: NormLm, out: NormLm = { x: 0, y: 0 }): NormLm {
  out.x = t.x + p.x * t.w;
  out.y = t.y + p.y * t.h;
  out.z = p.z;
  out.visibility = p.visibility;
  return out;
}

export function mapToFrame(t: Rect, lms: readonly NormLm[]): NormLm[] {
  const out: NormLm[] = new Array<NormLm>(lms.length);
  for (let i = 0; i < lms.length; i++) out[i] = tileToFrame(t, lms[i], { x: 0, y: 0 });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Bodies

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Body {
  /** 33 landmarks, normalised to the frame */
  lm: NormLm[];
  tile: number;
  /** how much the crop result can be trusted (visibility of the key landmarks, lower when the body is cut by the inner edge of the crop) */
  score: number;
  box: Box;
  /** analysed in the current round (preferred over older results of other crops) */
  fresh: boolean;
}

const KEY = [0, 11, 12, 23, 24] as const;
const vis = (p: NormLm | undefined): number => (p ? (p.visibility ?? 1) : 0);

interface MergeCfg {
  overlap: number;
  boxPad: number;
  minVis: number;
  truncPenalty: number;
  edgeMargin: number;
}

/** Box around nose, shoulders and hips (the arms and legs do not count: they would make two neighbours overlap), padded. */
export function bodyBox(lm: readonly NormLm[], cfg: MergeCfg = CROWD_CFG.merge): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let n = 0;
  const add = (p: NormLm): void => {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
    n++;
  };
  for (const k of KEY) if (lm[k] && vis(lm[k]) >= cfg.minVis) add(lm[k]);
  if (n < 2) {
    x0 = y0 = Infinity;
    x1 = y1 = -Infinity;
    n = 0;
    for (const k of KEY) if (lm[k]) add(lm[k]);
  }
  if (n === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const pad = cfg.boxPad * Math.max(x1 - x0, y1 - y0, 0.02);
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** Horizontal centre of a body (frame fraction): between the shoulders, else the nose, else the middle of its box. */
export function bodyCx(lm: readonly NormLm[], cfg: MergeCfg = CROWD_CFG.merge): number {
  const a = lm[11];
  const b = lm[12];
  if (a && b && vis(a) >= cfg.minVis && vis(b) >= cfg.minVis) return (a.x + b.x) / 2;
  if (lm[0] && vis(lm[0]) >= cfg.minVis) return lm[0].x;
  const bx = bodyBox(lm, cfg);
  return (bx.x0 + bx.x1) / 2;
}

/** Trust in a body found in `tile`; `lm` is in frame coordinates. */
export function bodyScore(lm: readonly NormLm[], tile: Rect, cfg: MergeCfg = CROWD_CFG.merge): number {
  let sum = 0;
  let cut = 0;
  let seen = 0;
  const innerL = tile.x > 0.001;
  const innerR = tile.x + tile.w < 0.999;
  const m = cfg.edgeMargin * tile.w;
  for (const k of KEY) {
    const p = lm[k];
    if (!p) continue;
    const v = vis(p);
    sum += v;
    if (v < cfg.minVis) continue;
    seen++;
    if ((innerL && p.x < tile.x + m) || (innerR && p.x > tile.x + tile.w - m)) cut++;
  }
  const mean = sum / KEY.length;
  return mean * (1 - cfg.truncPenalty * (seen ? cut / seen : 0));
}

export function makeBody(lm: NormLm[], tile: Tile, fresh: boolean, cfg: MergeCfg = CROWD_CFG.merge): Body {
  return { lm, tile: tile.index, score: bodyScore(lm, tile, cfg), box: bodyBox(lm, cfg), fresh };
}

/** intersection / smaller box */
export function overlapOfSmaller(a: Box, b: Box): number {
  const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (iw <= 0 || ih <= 0) return 0;
  const aa = (a.x1 - a.x0) * (a.y1 - a.y0);
  const ab = (b.x1 - b.x0) * (b.y1 - b.y0);
  const m = Math.min(aa, ab);
  return m > 0 ? (iw * ih) / m : 0;
}

/**
 * Drops duplicates: the same child found in two overlapping crops. Two bodies from DIFFERENT tiles whose boxes overlap by `overlap` of the
 * smaller one are one child; the one analysed now (fresh) wins, then the better score. Two bodies from the same tile are never merged
 * (the model's own suppression already decided they are two children). Fresh bodies come first in the result.
 */
export function mergeBodies(bodies: readonly Body[], overlap: number = CROWD_CFG.merge.overlap): Body[] {
  const idx = bodies.map((_, i) => i);
  idx.sort((i, j) => (bodies[j].fresh ? 1 : 0) - (bodies[i].fresh ? 1 : 0) || bodies[j].score - bodies[i].score || i - j);
  const kept: Body[] = [];
  for (const i of idx) {
    const b = bodies[i];
    let dup = false;
    for (const k of kept) {
      if (k.tile !== b.tile && overlapOfSmaller(k.box, b.box) >= overlap) {
        dup = true;
        break;
      }
    }
    if (!dup) kept.push(b);
  }
  return kept;
}

/** Does `tile` report a body whose centre is at `cx`? (its zone, plus a margin so a child on the border is taken from either side) */
export function owns(tile: Tile, cx: number, margin: number = CROWD_CFG.tiles.ownMargin): boolean {
  return cx >= tile.own0 - margin && cx <= tile.own1 + margin;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fusion

interface Stored {
  bodies: Body[];
  t: number;
}

/**
 * Turns the per-tile results of the detector into one pose result in frame coordinates.
 *   - bodies are mapped back to the frame and kept only in the zone their tile owns,
 *   - bodies of tiles analysed in this round (fresh) are merged,
 *   - the latest bodies of the other tiles (not older than `staleMs`) are appended (for the "everybody in view" list of the menu cursor).
 * `fresh` of the result says how many leading bodies are fresh: the kid tracker gets only those, so it never sees an old position as a new one.
 */
export class TileFusion {
  private last: (Stored | null)[] = [];
  /** bodies in the latest combined list */
  total = 0;
  /** fresh bodies of the latest round */
  freshTotal = 0;

  reset(): void {
    this.last.length = 0;
    this.total = 0;
    this.freshTotal = 0;
  }

  ingest(outs: readonly TileOutput[], tiles: readonly Tile[], capture: number, staleMs: number = CROWD_CFG.tiles.staleMs): DetectionResult {
    const fresh: Body[] = [];
    const inRound = new Set<number>();
    for (const o of outs) {
      const tile = tiles[o.tile];
      if (!tile) continue;
      inRound.add(o.tile);
      const bodies: Body[] = [];
      for (const raw of o.pose?.landmarks ?? []) {
        if (raw.length < 33) continue;
        const lm = mapToFrame(tile, raw);
        if (!owns(tile, bodyCx(lm))) continue;
        bodies.push(makeBody(lm, tile, true));
      }
      this.last[o.tile] = { bodies, t: capture };
      for (const b of bodies) fresh.push(b);
    }
    const all: Body[] = fresh.slice();
    for (let i = 0; i < this.last.length; i++) {
      const s = this.last[i];
      if (!s || inRound.has(i)) continue;
      if (capture - s.t > staleMs) {
        this.last[i] = null;
        continue;
      }
      for (const b of s.bodies) all.push({ ...b, fresh: false });
    }
    const merged = mergeBodies(all);
    let nf = 0;
    while (nf < merged.length && merged[nf].fresh) nf++;
    this.total = merged.length;
    this.freshTotal = nf;
    return { pose: { landmarks: merged.map((b) => b.lm) }, hand: null, fresh: nf };
  }
}
