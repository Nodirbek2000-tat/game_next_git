import { describe, expect, it } from "vitest";
import { GUIDE_MAX, Guide, MAX_SEG_PER_FRAME, MAX_SPARKS, Meter, PROMPT_EVERY, SHAPES, Sparks, StrokeBuffer, buildSchedule, guideTol } from "./logic";

describe("StrokeBuffer", () => {
  it("starts a stroke on the first point, then hands out segments", () => {
    const b = new StrokeBuffer(2, 360, 1);
    expect(b.move(0, 100, 100)).toBe(false);
    expect(b.move(0, 130, 100)).toBe(true);
    expect(b.seg).toEqual({ x0: 100, y0: 100, x1: 130, y1: 100 });
    expect(b.move(0, 130, 140)).toBe(true);
    expect(b.seg.y0).toBe(100);
    expect(b.seg.y1).toBe(140);
    expect(b.dist[0]).toBeCloseTo(70, 3);
  });

  it("ignores tiny movements (no dots piling up while the hand is still)", () => {
    const b = new StrokeBuffer(3, 360, 1);
    b.move(1, 50, 50);
    for (let i = 0; i < 100; i++) expect(b.move(1, 50 + (i % 2), 50)).toBe(false);
    expect(b.segCount).toBe(0);
  });

  it("a jump starts a new stroke instead of drawing a long line", () => {
    const b = new StrokeBuffer(2, 300, 1);
    b.move(2, 0, 0);
    expect(b.move(2, 20, 0)).toBe(true);
    expect(b.move(2, 900, 500)).toBe(false); // tracking glitch / another place
    expect(b.move(2, 920, 500)).toBe(true);
    expect(b.seg.x0).toBe(900);
  });

  it("a lifted pen does not connect to the next stroke", () => {
    const b = new StrokeBuffer(2, 360, 1);
    b.move(3, 0, 0);
    b.move(3, 30, 0);
    b.lift(3);
    expect(b.move(3, 200, 0)).toBe(false);
    expect(b.move(3, 230, 0)).toBe(true);
    expect(b.seg.x0).toBe(200);
  });

  it("caps the segments per frame; the rest waits (nothing is lost, nothing piles up)", () => {
    const b = new StrokeBuffer(2, 360, 1);
    for (let w = 0; w < 10; w++) b.move(w, 0, 0);
    let first = 0;
    // 3 rounds of 10 wrists moving: only MAX_SEG_PER_FRAME segments per frame are allowed
    for (let frame = 0; frame < 3; frame++) {
      b.beginFrame();
      let drawn = 0;
      for (let w = 0; w < 10; w++) if (b.move(w, 20 * (frame + 1), 0)) drawn++;
      expect(drawn).toBeLessThanOrEqual(MAX_SEG_PER_FRAME);
      if (frame === 0) first = drawn;
    }
    expect(first).toBe(10); // 10 wrists < 12 budget: all drawn
    b.beginFrame();
    b.budget = 2;
    let drawn = 0;
    for (let w = 0; w < 10; w++) if (b.move(w, 500, 0)) drawn++;
    expect(drawn).toBe(0); // 500 px away = jump = restart, so use a normal step to test the budget
    b.beginFrame();
    b.budget = 2;
    for (let w = 0; w < 10; w++) if (b.move(w, 520, 0)) drawn++;
    expect(drawn).toBe(2);
    expect(b.deferred).toBe(8);
    // the deferred wrists still have their old pen point and paint the segment in the next frame
    b.beginFrame();
    let later = 0;
    for (let w = 0; w < 10; w++) if (b.move(w, 540, 0)) later++;
    expect(later).toBe(10);
  });

  it("memory is O(1): fixed-size arrays however many points were drawn", () => {
    const b = new StrokeBuffer();
    const keys = Object.keys(b).length;
    b.move(0, 0, 0);
    for (let i = 1; i < 20000; i++) {
      if (i % 12 === 0) b.beginFrame();
      b.move(0, (i * 7) % 300, (i * 3) % 200);
    }
    expect(Object.keys(b).length).toBe(keys);
    expect(b.px.length).toBe(10);
  });

  it("smoothing makes the pen follow the wrist and settle on it", () => {
    const b = new StrokeBuffer(0.5, 360, 0.5);
    b.move(0, 0, 0);
    b.move(0, 100, 0);
    expect(b.seg.x1).toBe(50);
    for (let i = 0; i < 12; i++) b.move(0, 100, 0);
    expect(b.px[0]).toBeGreaterThan(98);
  });
});

describe("Guide", () => {
  it("builds every shape inside the stage with at most GUIDE_MAX points", () => {
    const g = new Guide();
    for (const s of SHAPES) {
      g.build(s, 1280, 720);
      expect(g.n).toBeGreaterThan(20);
      expect(g.n).toBeLessThanOrEqual(GUIDE_MAX);
      for (let i = 0; i < g.n; i++) {
        expect(g.x[i]).toBeGreaterThanOrEqual(0);
        expect(g.x[i]).toBeLessThanOrEqual(1280);
        expect(g.y[i]).toBeGreaterThanOrEqual(0);
        expect(g.y[i]).toBeLessThanOrEqual(720);
      }
      expect(g.coveredCount).toBe(0);
    }
  });

  it("drawing a circle around the sun covers it; a scribble in the corner does not", () => {
    const g = new Guide();
    g.build("sun", 1280, 720);
    const tol = guideTol(1280, 720);
    // scribble far away
    for (let i = 0; i < 50; i++) g.hitSeg(10 + i, 10, 12 + i, 12, tol, 0);
    expect(g.progress).toBe(0);
    // a rough circle (50 % too small -> still inside the generous tolerance of the ring)
    const R = 720 * 0.27 * 0.9;
    let px = 640 + R;
    let py = 360;
    for (let i = 1; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const x = 640 + Math.cos(a) * R;
      const y = 360 + Math.sin(a) * R;
      g.hitSeg(px, py, x, y, tol, 2);
      px = x;
      py = y;
    }
    expect(g.progress).toBeGreaterThan(0.9);
    expect(g.owner[0]).toBe(2);
  });

  it("vertical lines cover the rain, a horizontal line covers only a little of it", () => {
    const g = new Guide();
    g.build("rain", 1280, 720);
    const tol = guideTol(1280, 720);
    g.hitSeg(100, 360, 1200, 360, tol, 0);
    const horizontal = g.progress;
    expect(horizontal).toBeLessThan(0.4);
    g.build("rain", 1280, 720);
    for (let l = 0; l < 5; l++) {
      const x = 1280 * (0.28 + l * 0.11) + 20; // not exact: very tolerant
      g.hitSeg(x, 150, x, 600, tol, 1);
    }
    expect(g.progress).toBe(1);
  });

  it("a point is counted once, fresh lists only the new points", () => {
    const g = new Guide();
    g.build("wave", 1280, 720);
    const tol = guideTol(1280, 720);
    const a = g.hitSeg(100, 400, 400, 400, tol, 0);
    expect(a).toBeGreaterThan(0);
    const again = g.hitSeg(100, 400, 400, 400, tol, 1);
    expect(again).toBe(0);
    expect(g.coveredCount).toBe(a);
    for (let i = 0; i < a; i++) expect(g.owner[g.fresh[i]]).toBe(0);
  });

  it("is very tolerant: tolerance is 10 % of the short side", () => {
    expect(guideTol(1280, 720)).toBe(72);
    expect(guideTol(500, 900)).toBe(50);
  });
});

describe("prompt schedule", () => {
  it("a prompt every 15 s, the last 6 s show the picture", () => {
    const s = buildSchedule(80);
    expect(s.galleryAt).toBe(74);
    expect(s.prompts.length).toBe(5);
    for (let i = 1; i < s.prompts.length; i++) expect(s.prompts[i].start - s.prompts[i - 1].start).toBe(PROMPT_EVERY);
    for (const p of s.prompts) {
      expect(p.end).toBeLessThanOrEqual(s.galleryAt);
      expect(p.end - p.start).toBeGreaterThanOrEqual(3.5);
    }
    // all four shapes appear
    expect(new Set(s.prompts.map((p) => p.shape)).size).toBe(4);
  });

  it("short test rounds still get a prompt and a picture", () => {
    const s = buildSchedule(12);
    expect(s.galleryAt).toBeCloseTo(8.4, 5);
    expect(s.prompts.length).toBe(1);
    expect(s.prompts[0].start).toBeCloseTo(1.2, 5);
    expect(s.prompts[0].end).toBeLessThan(s.galleryAt);
  });
});

describe("Meter", () => {
  it("hands out a whole star per `per` units per child", () => {
    const m = new Meter();
    expect(m.add(0, 3, 5)).toBe(0);
    expect(m.add(0, 3, 5)).toBe(1);
    expect(m.add(1, 12, 5)).toBe(2);
    expect(m.add(0, 4, 5)).toBe(1);
  });
});

describe("Sparks", () => {
  it("never exceeds its pool, fades out and is allocation-free", () => {
    const s = new Sparks();
    const keys = Object.keys(s).length;
    for (let i = 0; i < 40; i++) s.burst(100, 100, 20, i % 5, 300, 8);
    s.step(0.016, 200);
    expect(s.count).toBeLessThanOrEqual(MAX_SPARKS);
    expect(s.count).toBe(MAX_SPARKS);
    for (let i = 0; i < 200; i++) s.step(0.05, 200);
    expect(s.count).toBe(0);
    expect(Object.keys(s).length).toBe(keys);
  });
});
