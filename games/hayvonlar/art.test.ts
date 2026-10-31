import { describe, expect, it, vi } from "vitest";
import { KidTracker } from "@/engine/tracking/kids";
import type { KidSlot } from "../bogcha/common";
import { ANIMALS, type AnimalDef, type AnimalId } from "./animals";
import { AnimalArt } from "./art";
import { MOVE_PERIOD, motionAt, newMotion } from "./motion";
import { Painter } from "./paint";
import type { Round } from "./round";

const W = 1280;
const H = 720;

/** A context that records every call and flags non-finite numbers; `fp` sums the numbers of the shape calls (a pose fingerprint). */
function recorder(hooks: Record<string, (...a: number[]) => void> = {}) {
  const st = { calls: 0, bad: 0, fp: 0, by: {} as Record<string, number>, texts: [] as string[] };
  const num = (v: unknown): void => {
    if (typeof v === "number" && !Number.isFinite(v)) st.bad++;
  };
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === "canvas") return undefined;
        return (...args: unknown[]) => {
          const name = String(k);
          st.calls++;
          st.by[name] = (st.by[name] ?? 0) + 1;
          for (const a of args) {
            num(a);
            if (typeof a === "number" && (name === "ellipse" || name === "arc" || name === "rotate")) st.fp += a;
          }
          if (name === "fillText") st.texts.push(String(args[0]));
          hooks[name]?.(...(args as number[]));
        };
      },
      set: (_t, _k, v) => {
        num(v);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, st };
}

type FakeRound = { index: number; phase: "act" | "praise"; t: number; animal: AnimalDef; progress: { done: boolean }[] };
const fakeRound = (over: Partial<FakeRound> = {}): FakeRound => ({
  index: 0,
  phase: "act",
  t: 2,
  animal: ANIMALS[0],
  progress: [{ done: false }, { done: false }, { done: false }, { done: false }, { done: false }],
  ...over,
});
const asRound = (r: FakeRound): Round => r as unknown as Round;

describe("the animal performs the move", () => {
  it("each of the six animals draws on a mock context, finite numbers only, and its pose changes through the move", () => {
    for (const a of ANIMALS) {
      const art = new AnimalArt(false);
      const m = newMotion();
      const prints = new Set<string>();
      for (let i = 0; i < 24; i++) {
        const t = (i / 24) * MOVE_PERIOD[a.move];
        const { ctx, st } = recorder();
        art.draw(ctx, a.id, 300, 500, 180, motionAt(a.move, t, m), t, 1);
        expect(st.bad, `${a.id} t=${t}`).toBe(0);
        expect(st.by.ellipse ?? 0, a.id).toBeGreaterThan(12); // body, head, face, limbs
        expect(st.by.save).toBe(st.by.restore);
        prints.add(st.fp.toFixed(4));
      }
      expect(prints.size, `${a.id} moves`).toBeGreaterThan(5);
    }
  });

  it("the moving parts follow the move: wings, paws, flippers, squat, hop and ears change the drawing", () => {
    const art = new AnimalArt(false);
    const fp = (id: AnimalId, f: (m: ReturnType<typeof newMotion>) => void): number => {
      const m = newMotion();
      f(m);
      const { ctx, st } = recorder();
      art.draw(ctx, id, 0, 0, 100, m, 0, 1);
      return st.fp;
    };
    expect(fp("qush", (m) => (m.arm = 0.1))).not.toBeCloseTo(fp("qush", (m) => (m.arm = 0.9)), 3);
    expect(fp("ayiq", (m) => (m.arm = 0))).not.toBeCloseTo(fp("ayiq", (m) => (m.arm = 1)), 3);
    expect(fp("pingvin", (m) => (m.hands = 0))).not.toBeCloseTo(fp("pingvin", (m) => (m.hands = 1)), 3);
    expect(fp("toshbaqa", (m) => (m.crouch = 0))).not.toBeCloseTo(fp("toshbaqa", (m) => (m.crouch = 1)), 3);
    expect(fp("baqa", (m) => (m.lift = 0))).not.toBeCloseTo(fp("baqa", (m) => (m.lift = 1)), 3);
    expect(fp("quyon", (m) => (m.ear = 0))).not.toBeCloseTo(fp("quyon", (m) => (m.ear = 0.5)), 3);
  });

  it("static parts are cached on offscreen canvases: built once, drawn with drawImage afterwards", () => {
    const made: unknown[] = [];
    const spy = vi.spyOn(document, "createElement").mockImplementation(() => {
      const c = { width: 0, height: 0, getContext: () => recorder().ctx };
      made.push(c);
      return c as unknown as HTMLElement;
    });
    try {
      const art = new AnimalArt(true);
      const { ctx, st } = recorder();
      const m = newMotion();
      for (let i = 0; i < 30; i++) art.draw(ctx, "quyon", 300, 500, 180, motionAt("jump", i / 30, m), i / 30, 1);
      expect(made.length).toBe(2); // body + head
      expect(art.builds).toBe(2);
      expect(st.by.drawImage).toBe(60);
      art.draw(ctx, "quyon", 300, 500, 181, m, 0, 1); // the same size bucket: no rebuild
      expect(art.builds).toBe(2);
      art.draw(ctx, "quyon", 300, 500, 90, m, 0, 1); // a clearly different stage size: rebuilt
      expect(art.builds).toBe(4);
      // without a 2d context the paths are drawn directly (and nothing throws)
      const art2 = new AnimalArt(true);
      spy.mockImplementation(() => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLElement);
      const r = recorder();
      expect(() => art2.draw(r.ctx, "baqa", 0, 0, 100, m, 0, -1)).not.toThrow();
      expect(r.st.by.ellipse).toBeGreaterThan(12);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("painter", () => {
  const slots = (): KidSlot[] => new KidTracker().slots;
  const kidAt = (x: number, slot = 0) => ({ slot, active: true, present: true, center: { x, y: 300 }, headR: 20, pts: { head: { x, y: 200, v: 1 } } }) as unknown as KidSlot;

  it("draws one animal and the name under it; no stick figure (no long polyline), nothing non-finite", () => {
    for (const a of ANIMALS) {
      const painter = new Painter(false);
      const r = recorder();
      painter.draw(r.ctx, W, H, 100, asRound(fakeRound({ animal: a, t: 0.1 })), slots());
      expect(r.st.texts).toEqual([a.name]);
      expect(r.st.bad).toBe(0);
      expect(r.st.by.ellipse).toBeGreaterThan(12);
      expect(r.st.by.lineTo ?? 0).toBeLessThanOrEqual(6); // the old figure was a ~15-segment polyline
    }
    // praise too, and a check above a child who did it
    const p = new Painter(false);
    const r = recorder();
    const kid = kidAt(600);
    const round = fakeRound({ phase: "praise", t: 0.5, progress: [{ done: true }, { done: false }, { done: false }, { done: false }, { done: false }] });
    p.draw(r.ctx, W, H, 100, asRound(round), [kid]);
    expect(r.st.bad).toBe(0);
    expect(r.st.by.lineTo).toBeGreaterThanOrEqual(2); // the check mark
  });

  it("the animal is about a third of the stage height and pops in", () => {
    const heights: number[] = [];
    const size = (t: number, w = W, h = H): number => {
      const painter = new Painter(false);
      const sc: number[] = [];
      const r = recorder({ scale: (x, y) => void sc.push(Math.max(x, y)) });
      painter.draw(r.ctx, w, h, 0, asRound(fakeRound({ t })), []);
      return sc[0] * 2;
    };
    heights.push(size(2));
    expect(heights[0]).toBeGreaterThan(H * 0.28);
    expect(heights[0]).toBeLessThan(H * 0.42);
    expect(size(0.05)).toBeLessThan(size(2) * 0.6); // starts small
    expect(size(0.3)).toBeGreaterThan(size(0.05));
    // narrow screen: still fits the width
    expect(size(2, 600, 800)).toBeLessThan(600 * 0.5);
  });

  it("stands on the side with fewer children and stays there for the whole animal", () => {
    const painter = new Painter(false);
    const at = (kids: KidSlot[], over: Partial<FakeRound>): number => {
      const xs: number[] = [];
      const r = recorder({ translate: (x) => void xs.push(x) });
      painter.draw(r.ctx, W, H, 0, asRound(fakeRound(over)), kids);
      return xs[0];
    };
    expect(at([kidAt(1100), kidAt(900, 1)], { index: 4 })).toBeLessThan(W / 3); // children on the right -> left
    expect(at([kidAt(100), kidAt(300, 1)], { index: 4, t: 3 })).toBeLessThan(W / 3); // same animal: does not jump over
    expect(at([kidAt(100), kidAt(300, 1)], { index: 5 })).toBeGreaterThan((W * 2) / 3); // next animal: the free side
    expect(at([], { index: 6 })).toBeLessThan(W / 3); // empty room alternates
    expect(at([], { index: 7 })).toBeGreaterThan((W * 2) / 3);
  });

  it("the cached painter builds each animal's two canvases once and reuses them for every frame", () => {
    const spy = vi.spyOn(document, "createElement").mockImplementation(() => ({ width: 0, height: 0, getContext: () => recorder().ctx }) as unknown as HTMLElement);
    try {
      const painter = new Painter(true);
      const r = recorder();
      for (let i = 0; i < 40; i++) painter.draw(r.ctx, W, H, i * 16, asRound(fakeRound({ animal: ANIMALS[3], t: 1 + i / 40 })), []);
      expect(painter.builds).toBe(2);
      expect(r.st.by.drawImage).toBe(80);
    } finally {
      spy.mockRestore();
    }
  });
});
