import { describe, expect, it } from "vitest";
import { makeSkeleton, type FakeLm, type SkeletonOpts } from "../testing/skeleton";
import type { NormLm, TileOutput } from "../types";
import { CROWD_CFG } from "./crowdConfig";
import { TileFusion, bodyBox, bodyCx, bodyScore, makeBody, mapToFrame, mergeBodies, overlapOfSmaller, owns, tileLayout, tileOutSize, tileRectPx, tileToFrame, type Tile } from "./tiles";

const W = 1280;
const H = 720;

/** what the model returns for a crop: the landmarks of a body (frame coordinates) expressed in the crop */
function inTile(t: Tile, lm: FakeLm[]): NormLm[] {
  return lm.map((p) => ({ x: (p.x - t.x) / t.w, y: (p.y - t.y) / t.h, z: p.z, visibility: p.visibility }));
}

/** a child in frame coordinates (normalised), as makeSkeleton makes it; `vis` scales the visibility of all landmarks */
function kid(o: SkeletonOpts & { vis?: number } = {}): FakeLm[] {
  const lm = makeSkeleton({ h: 0.5, top: 0.2, ...o });
  if (o.vis !== undefined) for (const p of lm) p.visibility = o.vis;
  return lm;
}

const out = (tile: number, ...bodies: NormLm[][]): TileOutput => ({ tile, pose: { landmarks: bodies } });

describe("tile layout", () => {
  it("16:9 gives two square crops over the full height that overlap and cover the frame", () => {
    const t = tileLayout(W, H, 2);
    expect(t).toHaveLength(2);
    // square: as wide as the frame is high
    expect(t[0].w * W).toBeCloseTo(H, 5);
    expect(t[0].h).toBe(1);
    expect(t[0].x).toBe(0);
    expect(t[1].x + t[1].w).toBeCloseTo(1, 9);
    const overlap = (t[0].x + t[0].w - t[1].x) / t[0].w;
    expect(overlap).toBeGreaterThanOrEqual(CROWD_CFG.tiles.overlapMin);
    // the owned zones split the overlap in the middle and have no gap
    expect(t[0].own0).toBe(0);
    expect(t[1].own1).toBe(1);
    expect(t[0].own1).toBeCloseTo(t[1].own0, 9);
    expect(t[0].own1).toBeGreaterThan(t[1].x);
    expect(t[0].own1).toBeLessThan(t[0].x + t[0].w);
  });

  it("a child in a crop is larger for the detector than in the full frame (the whole point)", () => {
    // the detector squeezes the picture to a square: full 16:9 frame -> W px wide = 224, a square crop -> H px wide = 224
    const full = 224 / W;
    const crop = 224 / (tileLayout(W, H, 2)[0].w * W);
    expect(crop / full).toBeCloseTo(W / H, 5);
    expect(crop / full).toBeGreaterThan(1.7);
  });

  it("three crops: left, centre, right", () => {
    const t = tileLayout(W, H, 3);
    expect(t).toHaveLength(3);
    expect(t[1].x).toBeCloseTo((t[0].x + t[2].x) / 2, 9);
    for (let i = 0; i < 2; i++) expect(t[i].own1).toBeCloseTo(t[i + 1].own0, 9);
    expect(t[0].own0).toBe(0);
    expect(t[2].own1).toBe(1);
  });

  it("no crops for one tile, for 4:3 pictures or for bad sizes", () => {
    expect(tileLayout(W, H, 1)).toHaveLength(1);
    expect(tileLayout(640, 480, 2)).toHaveLength(1);
    expect(tileLayout(0, 0, 2)).toHaveLength(1);
    const f = tileLayout(640, 480, 3)[0];
    expect([f.x, f.y, f.w, f.h, f.own0, f.own1]).toEqual([0, 0, 1, 1, 0, 1]);
  });

  it("pixel rectangles are integers inside the picture", () => {
    const [l, r] = tileLayout(W, H, 2);
    expect(tileRectPx(l, W, H)).toEqual({ sx: 0, sy: 0, sw: 720, sh: 720 });
    expect(tileRectPx(r, W, H)).toEqual({ sx: 560, sy: 0, sw: 720, sh: 720 });
    const odd = tileRectPx({ x: 0.9999, y: 0.9999, w: 0.5, h: 0.5 }, 641, 361);
    expect(odd.sx + odd.sw).toBeLessThanOrEqual(641);
    expect(odd.sy + odd.sh).toBeLessThanOrEqual(361);
    expect(odd.sw).toBeGreaterThanOrEqual(2);
  });

  it("crop pictures are scaled down to the side limit and never enlarged", () => {
    expect(tileOutSize(720, 720, 512)).toEqual({ w: 512, h: 512, scaled: true });
    expect(tileOutSize(300, 200, 512)).toEqual({ w: 300, h: 200, scaled: false });
    const o = tileOutSize(800, 400, 400);
    expect(o.w / o.h).toBeCloseTo(2, 1);
  });
});

describe("coordinates back to the frame", () => {
  it("maps a crop landmark to the frame and back", () => {
    const [l, r] = tileLayout(W, H, 2);
    for (const t of [l, r]) {
      const p = tileToFrame(t, { x: 0.5, y: 0.25, visibility: 0.8 });
      expect(p.x).toBeCloseTo(t.x + t.w / 2, 9);
      expect(p.y).toBeCloseTo(0.25, 9);
      expect(p.visibility).toBe(0.8);
      expect((p.x - t.x) / t.w).toBeCloseTo(0.5, 9);
    }
    // crop corners map to the crop rectangle in the frame
    expect(tileToFrame(r, { x: 0, y: 0 })).toMatchObject({ x: r.x, y: 0 });
    expect(tileToFrame(r, { x: 1, y: 1 })).toMatchObject({ x: 1, y: 1 });
  });

  it("a whole body survives the round trip through a crop", () => {
    const [, r] = tileLayout(W, H, 2);
    const lm = kid({ cx: 0.8 });
    const back = mapToFrame(r, inTile(r, lm));
    for (let i = 0; i < lm.length; i++) {
      expect(back[i].x).toBeCloseTo(lm[i].x, 9);
      expect(back[i].y).toBeCloseTo(lm[i].y, 9);
    }
  });

  it("a pixel in the crop picture is the right pixel of the camera picture", () => {
    const [, r] = tileLayout(W, H, 2);
    const px = tileRectPx(r, W, H);
    const o = tileOutSize(px.sw, px.sh, 512);
    // landmark at crop-picture pixel (256, 128) -> camera pixel
    const p = tileToFrame(r, { x: 256 / o.w, y: 128 / o.h });
    expect(p.x * W).toBeCloseTo(px.sx + 256 * (px.sw / o.w), 6);
    expect(p.y * H).toBeCloseTo(px.sy + 128 * (px.sh / o.h), 6);
  });
});

describe("body box and score", () => {
  it("box covers nose, shoulders and hips and ignores the arms", () => {
    const wide = kid({ cx: 0.5, armL: [0.95, 0.3], armR: [0.05, 0.3] });
    const b = bodyBox(wide);
    expect(b.x1 - b.x0).toBeLessThan(0.3);
    expect(bodyCx(wide)).toBeCloseTo(0.5, 6);
  });

  it("overlap is measured against the smaller box", () => {
    const a = { x0: 0, y0: 0, x1: 1, y1: 1 };
    expect(overlapOfSmaller(a, { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 })).toBe(1);
    expect(overlapOfSmaller(a, { x0: 2, y0: 0, x1: 3, y1: 1 })).toBe(0);
    expect(overlapOfSmaller(a, { x0: 0.5, y0: 0, x1: 1.5, y1: 1 })).toBeCloseTo(0.5, 9);
  });

  it("a body cut by the inner edge of its crop scores lower", () => {
    const [l, r] = tileLayout(W, H, 2);
    // a child at the right edge of the left crop
    const edgeKid = kid({ cx: l.x + l.w - 0.01 });
    expect(bodyScore(edgeKid, l)).toBeLessThan(bodyScore(edgeKid, r));
    // the outer border of the frame is not an inner edge
    const outer = kid({ cx: 0.02 });
    expect(bodyScore(outer, l)).toBeCloseTo(bodyScore(kid({ cx: 0.3 }), l), 6);
  });
});

describe("duplicate merging", () => {
  const [l, r] = tileLayout(W, H, 2);
  const seam = (l.x + l.w + r.x) / 2; // middle of the overlap

  it("the same child found by both crops is kept once, with the better visibility", () => {
    const a = makeBody(kid({ cx: seam, vis: 0.6 }), l, true);
    const b = makeBody(kid({ cx: seam + 0.004, vis: 0.95 }), r, true);
    const m = mergeBodies([a, b]);
    expect(m).toHaveLength(1);
    expect(m[0].tile).toBe(r.index);
    expect(m[0].score).toBeCloseTo(b.score, 9);
  });

  it("two different children, even close, from different crops are both kept", () => {
    const a = makeBody(kid({ cx: seam - 0.07 }), l, true);
    const b = makeBody(kid({ cx: seam + 0.07 }), r, true);
    expect(overlapOfSmaller(a.box, b.box)).toBeLessThan(CROWD_CFG.merge.overlap);
    expect(mergeBodies([a, b])).toHaveLength(2);
  });

  it("two bodies of the same crop are never merged (the model already told them apart)", () => {
    const a = makeBody(kid({ cx: 0.3 }), l, true);
    const b = makeBody(kid({ cx: 0.3 }), l, true);
    expect(mergeBodies([a, b])).toHaveLength(2);
  });

  it("a fresh result beats an older one of the other crop even when the older one scores higher", () => {
    const old = { ...makeBody(kid({ cx: seam, vis: 0.99 }), l, false), fresh: false };
    const now = makeBody(kid({ cx: seam, vis: 0.5 }), r, true);
    const m = mergeBodies([old, now]);
    expect(m).toHaveLength(1);
    expect(m[0].fresh).toBe(true);
  });

  it("five children, some of them in the overlap, come out once each", () => {
    const xs = [0.1, 0.3, seam, 0.7, 0.9];
    const lefts = xs.filter((x) => x < l.x + l.w - 0.03).map((x) => makeBody(kid({ cx: x }), l, true));
    const rights = xs.filter((x) => x > r.x + 0.03).map((x) => makeBody(kid({ cx: x }), r, true));
    expect(lefts.length + rights.length).toBeGreaterThan(5); // the seam child is in both
    expect(mergeBodies([...lefts, ...rights])).toHaveLength(5);
  });
});

describe("fusion of crop results", () => {
  const tiles = tileLayout(W, H, 2);
  const [l, r] = tiles;

  it("maps bodies of a crop back to frame coordinates", () => {
    const f = new TileFusion();
    const k = kid({ cx: 0.85 });
    const res = f.ingest([out(1, inTile(r, k))], tiles, 1000);
    expect(res.pose?.landmarks).toHaveLength(1);
    expect(res.fresh).toBe(1);
    const lm = res.pose?.landmarks[0] as NormLm[];
    for (let i = 0; i < 33; i++) {
      expect(lm[i].x).toBeCloseTo(k[i].x, 9);
      expect(lm[i].y).toBeCloseTo(k[i].y, 9);
    }
  });

  it("a crop reports only the bodies in the zone it owns", () => {
    const f = new TileFusion();
    // the left crop "sees" a child at 0.55 (right of the seam, clipped by the crop edge): the right crop owns it
    const res = f.ingest([out(0, inTile(l, kid({ cx: 0.2 })), inTile(l, kid({ cx: 0.56 })))], tiles, 1000);
    expect(res.pose?.landmarks).toHaveLength(1);
    expect(owns(l, 0.2)).toBe(true);
    expect(owns(l, 0.56)).toBe(false);
    expect(owns(r, 0.56)).toBe(true);
    // on the seam both own it (margin)
    const seam = l.own1;
    expect(owns(l, seam + 0.01)).toBe(true);
    expect(owns(r, seam - 0.01)).toBe(true);
  });

  it("round-robin: the other crop's last result is kept as older data, fresh bodies come first", () => {
    const f = new TileFusion();
    const a = kid({ cx: 0.2 });
    const b = kid({ cx: 0.8 });
    let res = f.ingest([out(0, inTile(l, a))], tiles, 1000);
    expect([res.pose?.landmarks.length, res.fresh]).toEqual([1, 1]);
    res = f.ingest([out(1, inTile(r, b))], tiles, 1033);
    expect(res.pose?.landmarks).toHaveLength(2);
    expect(res.fresh).toBe(1);
    expect(bodyCx(res.pose?.landmarks[0] as NormLm[])).toBeCloseTo(0.8, 6); // the fresh one first
    expect(bodyCx(res.pose?.landmarks[1] as NormLm[])).toBeCloseTo(0.2, 6);
    // the old result expires
    res = f.ingest([out(1, inTile(r, b))], tiles, 1033 + CROWD_CFG.tiles.staleMs + 10);
    expect(res.pose?.landmarks).toHaveLength(1);
  });

  it("an older body that the fresh crop also sees is not counted twice", () => {
    const f = new TileFusion();
    const s = l.own1; // on the seam: both crops report it
    f.ingest([out(0, inTile(l, kid({ cx: s })))], tiles, 1000);
    const res = f.ingest([out(1, inTile(r, kid({ cx: s + 0.003 })))], tiles, 1033);
    expect(res.pose?.landmarks).toHaveLength(1);
    expect(res.fresh).toBe(1);
  });

  it("a crop with no result, or a null pose, is harmless", () => {
    const f = new TileFusion();
    const res = f.ingest([{ tile: 0, pose: null }, { tile: 7, pose: { landmarks: [] } }], tiles, 1000);
    expect(res.pose?.landmarks).toHaveLength(0);
    expect(res.fresh).toBe(0);
  });

  it("reset forgets the older results", () => {
    const f = new TileFusion();
    f.ingest([out(0, inTile(l, kid({ cx: 0.2 })))], tiles, 1000);
    f.reset();
    const res = f.ingest([out(1, inTile(r, kid({ cx: 0.8 })))], tiles, 1010);
    expect(res.pose?.landmarks).toHaveLength(1);
  });
});
