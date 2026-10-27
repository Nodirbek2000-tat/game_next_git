import { describe, expect, it, vi } from "vitest";
import type { EngineApi } from "@/engine";
import { buildPeople, computeFit } from "@/engine/tracking/people";
import { KidTracker } from "@/engine/tracking/kids";
import { makeSkeleton } from "@/engine/testing/skeleton";
import { startKidsGame } from "../bogcha/common";
import { PufakGame } from "./game";
import {
  BubblePool,
  KIND_COLOUR,
  KIND_GOLD,
  KIND_NORMAL,
  MAX_BUBBLES,
  MAX_RINGS,
  MAX_SPARKS,
  Rings,
  Scorer,
  Spawner,
  Sparks,
  bubbleCap,
  circleHit,
  makeEnv,
  pawRadius,
  segHit,
  sparkCount,
} from "./logic";

// seeded random so the tests are deterministic
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("caps adapt to quality and to the number of children", () => {
  it("is smaller on weak PCs and with fewer children, never above the pool", () => {
    expect(bubbleCap("low", 5)).toBe(6);
    expect(bubbleCap("medium", 5)).toBe(9);
    expect(bubbleCap("high", 5)).toBe(12);
    expect(bubbleCap("high", 1)).toBe(5);
    expect(bubbleCap("high", 0)).toBe(5);
    expect(bubbleCap("high", 2)).toBe(7);
    for (const l of ["low", "medium", "high", undefined]) for (let k = 0; k <= 5; k++) expect(bubbleCap(l, k)).toBeLessThanOrEqual(MAX_BUBBLES);
    expect(sparkCount("low", false)).toBeLessThan(sparkCount("high", false));
    expect(sparkCount("medium", true)).toBeGreaterThan(sparkCount("medium", false));
    // a burst never needs more than the sparkle pool
    expect(sparkCount("high", true) * 3).toBeLessThanOrEqual(MAX_SPARKS);
  });
});

describe("hit tests", () => {
  it("circle overlap", () => {
    expect(circleHit(100, 100, 50, 100, 190, 40)).toBe(true);
    expect(circleHit(100, 100, 50, 100, 200, 40)).toBe(false);
    expect(circleHit(100, 100, 50, 190, 100, 40)).toBe(true);
  });
  it("a swipe cannot skip a bubble", () => {
    // the hand jumped from x=0 to x=400 in one frame, the bubble sits in between
    expect(segHit(0, 100, 400, 100, 200, 120, 50)).toBe(true);
    expect(segHit(0, 100, 400, 100, 200, 300, 50)).toBe(false);
    // beyond the end of the segment
    expect(segHit(0, 100, 100, 100, 200, 100, 50)).toBe(false);
    expect(segHit(0, 100, 100, 100, 140, 100, 50)).toBe(true);
    // zero length segment == a point
    expect(segHit(10, 10, 10, 10, 20, 10, 15)).toBe(true);
    expect(segHit(10, 10, 10, 10, 40, 10, 15)).toBe(false);
  });
  it("paw radius is generous for small bodies and bounded", () => {
    expect(pawRadius(10, 720)).toBeCloseTo(720 * 0.03);
    expect(pawRadius(100, 720)).toBeCloseTo(100 * 0.32);
    expect(pawRadius(900, 720)).toBeCloseTo(720 * 0.07);
  });
});

describe("bubble pool", () => {
  it("never exceeds the cap or the pool, reuses cells and recycles bubbles that left the top", () => {
    const pool = new BubblePool();
    for (let i = 0; i < 40; i++) pool.spawn(KIND_NORMAL, 100, 500, 50, 100, -1, 0, 0, 1, 0, 9);
    expect(pool.count).toBe(9);
    for (let i = 0; i < 40; i++) pool.spawn(KIND_NORMAL, 100, 500, 50, 100, -1, 0, 0, 1, 0);
    expect(pool.count).toBe(MAX_BUBBLES);
    expect(pool.spawn(KIND_NORMAL, 0, 0, 1, 1, -1, 0, 0, 1, 0)).toBe(-1);
    // float up until all are gone through the top
    for (let i = 0; i < 20 * 60; i++) pool.step(1 / 60);
    expect(pool.count).toBe(0);
    expect(pool.spawn(KIND_NORMAL, 0, 0, 1, 1, -1, 0, 0, 1, 0)).toBe(0);
  });

  it("colour / golden bookkeeping survives kill and clear", () => {
    const pool = new BubblePool();
    pool.spawn(KIND_COLOUR, 10, 10, 40, 0, 2, 0, 0, 1, 0);
    pool.spawn(KIND_GOLD, 10, 10, 40, 0, -1, 0, 0, 1, 0);
    expect(pool.colourAlive[2]).toBe(1);
    expect(pool.goldAlive).toBe(1);
    pool.kill(0);
    pool.kill(0); // twice is harmless
    expect(pool.colourAlive[2]).toBe(0);
    expect(pool.count).toBe(1);
    pool.clear();
    expect(pool.goldAlive).toBe(0);
    expect(pool.count).toBe(0);
  });

  it("a normal bubble pops at the first touch; a golden one needs two (and ignores a repeat within the cooldown)", () => {
    const pool = new BubblePool();
    const n = pool.spawn(KIND_NORMAL, 10, 10, 40, 0, -1, 0, 0, 1, 0);
    expect(pool.touch(n, 1)).toBe(true);
    const g = pool.spawn(KIND_GOLD, 10, 10, 60, 0, -1, 0, 0, 1, 0);
    expect(pool.hp[g]).toBe(2);
    expect(pool.touch(g, 0)).toBe(false);
    expect(pool.first[g]).toBe(0);
    expect(pool.hurt[g]).toBe(1);
    // same wave through the bubble in the next frame: still not popped
    expect(pool.touch(g, 0)).toBe(false);
    expect(pool.hp[g]).toBe(1);
    pool.step(0.5);
    expect(pool.touch(g, 2)).toBe(true);
    expect(pool.first[g]).toBe(0);
  });
});

describe("spawner", () => {
  const envWith = (kids: number[], cap = 9) => {
    const env = makeEnv();
    env.cap = cap;
    env.nKids = kids.length;
    kids.forEach((x, i) => {
      env.kidX[i] = x;
      env.kidSlot[i] = i;
    });
    return env;
  };

  it("tops up to the cap, never above it, with a mix of kinds and bubbles in front of the children", () => {
    const pool = new BubblePool();
    const env = envWith([200, 640, 1080], 9);
    const sp = new Spawner(lcg(7));
    sp.prefill(pool, env);
    expect(pool.count).toBeGreaterThanOrEqual(2);
    let maxCount = 0;
    const lanes = [0, 0, 0];
    for (let i = 0; i < 90 * 60; i++) {
      pool.step(1 / 60);
      sp.tick(1 / 60, pool, env);
      maxCount = Math.max(maxCount, pool.count);
      expect(pool.goldAlive).toBeLessThanOrEqual(1);
      for (let s = 0; s < 3; s++) expect(pool.colourAlive[s]).toBeLessThanOrEqual(1);
    }
    expect(maxCount).toBeLessThanOrEqual(9);
    expect(sp.spawned).toBeGreaterThan(90);
    expect(sp.golds).toBeGreaterThanOrEqual(2);
    expect(sp.colours).toBeGreaterThanOrEqual(5);
    // x distribution: every child's third of the screen gets bubbles
    const sp2 = new Spawner(lcg(3));
    for (let i = 0; i < 300; i++) {
      const x = sp2.pickX(env, 50);
      expect(x).toBeGreaterThanOrEqual(58);
      expect(x).toBeLessThanOrEqual(1280 - 58);
      lanes[x < 427 ? 0 : x < 853 ? 1 : 2]++;
    }
    for (const n of lanes) expect(n).toBeGreaterThan(60);
  });

  it("colour bubbles carry the colour of a present child only, golden only when there is room", () => {
    const pool = new BubblePool();
    const env = envWith([300, 900], 9);
    const sp = new Spawner(lcg(11));
    sp.colourT = 0;
    sp.cool = 0;
    sp.tick(0.01, pool, env);
    const i = [...Array(MAX_BUBBLES).keys()].find((k) => pool.alive[k] && pool.kind[k] === KIND_COLOUR);
    expect(i).toBeDefined();
    expect([0, 1]).toContain(pool.owner[i!]);
    // no children: no colour bubbles
    const pool2 = new BubblePool();
    const sp2 = new Spawner(lcg(5));
    sp2.colourT = 0;
    sp2.cool = 0;
    sp2.tick(0.01, pool2, envWith([], 9));
    expect(pool2.count).toBe(1);
    expect(pool2.kind[0]).toBe(KIND_NORMAL);
    // tiny cap: no golden
    const pool3 = new Spawner(lcg(5));
    pool3.goldT = 0;
    pool3.cool = 0;
    const p3 = new BubblePool();
    pool3.tick(0.01, p3, envWith([300], 4));
    expect(pool3.golds).toBe(0);
  });
});

describe("scoring", () => {
  it("every 3rd pop of a child gives that child a star", () => {
    const sc = new Scorer();
    const got: number[] = [];
    for (let i = 0; i < 6; i++) {
      sc.pop(KIND_NORMAL, -1, 1, -1);
      got.push(sc.kidStars);
      expect(sc.groupStars).toBe(0);
    }
    expect(got).toEqual([0, 0, 1, 0, 0, 1]);
    expect(sc.pops[1]).toBe(6);
    expect(sc.pops[0]).toBe(0);
    expect(sc.total).toBe(6);
  });

  it("a colour bubble popped by its owner is a group bonus, by a friend it is a normal pop", () => {
    const sc = new Scorer();
    sc.pop(KIND_COLOUR, 2, 2, -1);
    expect(sc.groupStars).toBe(2);
    expect(sc.colourBonuses).toBe(1);
    sc.pop(KIND_COLOUR, 2, 0, -1);
    expect(sc.groupStars).toBe(0);
    expect(sc.colourBonuses).toBe(1);
  });

  it("golden: 3 stars alone, 2 + 1 when two children share it", () => {
    const sc = new Scorer();
    sc.pop(KIND_GOLD, -1, 0, 0);
    expect(sc.kidStars).toBe(3);
    expect(sc.firstStars).toBe(0);
    sc.pop(KIND_GOLD, -1, 3, 1);
    expect(sc.kidStars).toBe(2);
    expect(sc.firstStars).toBe(1);
    expect(sc.firstSlot).toBe(1);
    sc.pop(KIND_GOLD, -1, 3, -1);
    expect(sc.kidStars).toBe(3);
    expect(sc.goldPops).toBe(3);
  });
});

describe("effect pools", () => {
  it("sparks and rings are ring buffers that fade out", () => {
    const sp = new Sparks();
    const r = lcg(1);
    for (let i = 0; i < 20; i++) sp.burst(10, 10, 12, 1, 100, 8, r);
    expect(sp.active).toBeLessThanOrEqual(MAX_SPARKS);
    for (let i = 0; i < 120; i++) sp.step(1 / 60, 200);
    expect(sp.active).toBe(0);
    const rg = new Rings();
    for (let i = 0; i < 50; i++) rg.add(1, 1, 5, 50, 0);
    for (let i = 0; i < 120; i++) rg.step(1 / 60);
    expect([...rg.life].filter((l) => l > 0).length).toBe(0);
    expect(rg.life.length).toBe(MAX_RINGS);
  });
});

// ------------------------------------------------------------------ the game on a fake kit
const ctxMock = (): CanvasRenderingContext2D => {
  const calls = { n: 0 };
  return new Proxy(calls, { get: (t, k) => (k === "n" ? t.n : () => void t.n++), set: () => true }) as unknown as CanvasRenderingContext2D;
};

function trackerWith(xs: number[], hands: [number, number][] | null = null): KidTracker {
  const tr = new KidTracker();
  const fit = computeFit(1280, 720, 1280, 720);
  const lms = xs.map((cx, i) => makeSkeleton({ cx, h: 0.5, top: 0.2, armL: hands ? hands[i] : "down", armR: hands ? hands[i] : "down" }));
  for (let i = 0; i < 8; i++) {
    const t = 1000 + i * 33;
    tr.update(buildPeople({ landmarks: lms }, fit), t, t, 1280);
    tr.extrapolate(t, 0);
  }
  return tr;
}

function fakeEngine(tr: KidTracker, quality = "medium") {
  let fn: ((c: CanvasRenderingContext2D, e: EngineApi, n: number) => void) | null = null;
  let result: unknown = null;
  const engine = {
    state: "play",
    kidSlots: tr.slots,
    query: new URLSearchParams("duration=40&debug=1"),
    stage: { w: 1280, h: 720, dpr: 1 },
    quality: { level: quality },
    audio: { graph: () => null },
    fx: { popup: vi.fn() },
    onDraw: (f: typeof fn) => {
      fn = f;
      return () => {
        fn = null;
      };
    },
    finish: (r: unknown) => {
      result ??= r;
    },
  } as unknown as EngineApi;
  const ctx = ctxMock();
  return { engine, draw: (now: number) => fn?.(ctx, engine, now), result: () => result, ctx };
}

describe("PufakGame on a fake kit", () => {
  it("children popping with their hands: pops counted in their colour, stars awarded, pools stay bounded", () => {
    // 3 kids with hands held at mid-height in front of themselves
    const tr = trackerWith([0.2, 0.5, 0.8], [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]);
    const { engine, draw, result, ctx } = fakeEngine(tr);
    let game!: PufakGame;
    const run = startKidsGame(engine, {
      slug: "pufakchalar",
      music: null,
      create: (kit) => (game = new PufakGame(kit, lcg(42))),
    });
    let t = 0;
    let maxAlive = 0;
    for (let i = 0; i < 40 * 60 && !result(); i++) {
      draw((t += 16.7));
      maxAlive = Math.max(maxAlive, game.pool.count);
    }
    expect(maxAlive).toBeLessThanOrEqual(9);
    expect(game.scorer.total).toBeGreaterThan(8);
    expect(run.kit.stars).toBeGreaterThan(2);
    // everybody got bubbles (they are spawned in front of each child)
    let kidsWithPops = 0;
    for (let s = 0; s < 3; s++) if (game.scorer.pops[s] > 0) kidsWithPops++;
    expect(kidsWithPops).toBeGreaterThanOrEqual(2);
    expect((ctx as unknown as { n: number }).n).toBeGreaterThan(1000);
    expect(result()).not.toBeNull();
    expect((window as unknown as { __pufak?: { pops: number } }).__pufak?.pops).toBe(game.scorer.total);
    run.dispose();
    expect((window as unknown as { __pufak?: unknown }).__pufak).toBeUndefined();
  });

  it("nobody is in the picture: bubbles still float, nothing is awarded", () => {
    const tr = trackerWith([]);
    const { engine, draw } = fakeEngine(tr);
    let game!: PufakGame;
    const run = startKidsGame(engine, { slug: "pufakchalar", music: null, create: (kit) => (game = new PufakGame(kit, lcg(1))) });
    let t = 0;
    for (let i = 0; i < 600; i++) draw((t += 16.7));
    expect(game.pool.count).toBeGreaterThan(0);
    expect(game.pool.count).toBeLessThanOrEqual(5);
    expect(game.scorer.total).toBe(0);
    expect(run.kit.stars).toBe(0);
    run.dispose();
  });

  it("the low quality level keeps fewer bubbles in the sky", () => {
    const tr = trackerWith([0.15, 0.3, 0.5, 0.7, 0.85]);
    const { engine, draw } = fakeEngine(tr, "low");
    let game!: PufakGame;
    const run = startKidsGame(engine, { slug: "pufakchalar", music: null, create: (kit) => (game = new PufakGame(kit, lcg(2))) });
    let t = 0;
    let max = 0;
    for (let i = 0; i < 1200; i++) {
      draw((t += 16.7));
      max = Math.max(max, game.pool.count);
    }
    expect(max).toBeLessThanOrEqual(6);
    expect(max).toBeGreaterThanOrEqual(4);
    run.dispose();
  });
});
