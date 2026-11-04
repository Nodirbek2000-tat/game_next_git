import { describe, expect, it } from "vitest";
import { BasketLogic, FLYING, HELD, blendLaunch, crossedRim, hoopX, idealVel, type BasketEvents, type Hand } from "./logic";

const W = 400;
const H = 800;

function setup() {
  const log: string[] = [];
  const ev: BasketEvents = {
    throwBall: () => log.push("throw"),
    basket: (p) => log.push(`basket:${p}`),
    miss: () => log.push("miss"),
    ready: () => log.push("ready"),
  };
  return { g: new BasketLogic(60, ev), log };
}

/** hold the hand still for a moment, then push it */
function throwWith(g: BasketLogic, hand: Hand, push: { vx: number; vy: number }): void {
  hand.vx = 0;
  hand.vy = 0;
  for (let i = 0; i < 20; i++) g.update(0.05, W, H, hand);
  hand.vx = push.vx;
  hand.vy = push.vy;
  g.update(0.03, W, H, hand);
}

describe("basketbol", () => {
  it("ideal velocity reaches the target and rim crossing detects it", () => {
    const v = { x: 0, y: 0 };
    idealVel(200, 500, 200, 150, 1, 1200, v);
    // y(1) = 500 + v.y + 600
    expect(500 + v.y + 0.5 * 1200).toBeCloseTo(150);
    expect(crossedRim(140, 160, 300, 205, 200, 150, 40)).toBe(true);
    expect(crossedRim(140, 160, 300, 290, 200, 150, 40)).toBe(false); // outside the rim
    expect(crossedRim(140, 160, -300, 200, 200, 150, 40)).toBe(false); // going up
  });
  it("caps a huge swing in the launch blend", () => {
    const out = { x: 0, y: 0 };
    blendLaunch(0, -20000, { x: 0, y: -800 }, 0.5, out);
    expect(Math.abs(out.y)).toBeLessThan(1500);
  });
  it("a slow hand does not throw, a fast upward push does", () => {
    const { g, log } = setup();
    const hand: Hand = { x: 200, y: 500, vx: 0, vy: 0, ok: true };
    throwWith(g, hand, { vx: 0, vy: -0.5 * H });
    expect(g.state).toBe(HELD);
    throwWith(g, hand, { vx: 0, vy: -2 * H });
    expect(g.state).toBe(FLYING);
    expect(log).toContain("throw");
  });
  it("a sideways swipe does not throw", () => {
    const { g } = setup();
    const hand: Hand = { x: 200, y: 500, vx: 0, vy: 0, ok: true };
    throwWith(g, hand, { vx: 3 * H, vy: -1.2 * H });
    expect(g.state).toBe(HELD);
  });
  it("a decent throw scores a basket and the ball comes back", () => {
    const { g, log } = setup();
    const hand: Hand = { x: 200, y: 550, vx: 0, vy: 0, ok: true };
    throwWith(g, hand, { vx: 0, vy: -1.4 * H });
    for (let i = 0; i < 60 && g.state === FLYING; i++) g.update(0.03, W, H, hand);
    expect(g.baskets).toBe(1);
    expect(g.score).toBe(20);
    for (let i = 0; i < 40; i++) g.update(0.03, W, H, hand);
    expect(g.state).toBe(HELD);
    expect(log).toContain("ready");
  });
  it("a wild throw misses and resets the streak", () => {
    const { g, log } = setup();
    const hand: Hand = { x: 200, y: 550, vx: 0, vy: 0, ok: true };
    g.streak = 3;
    throwWith(g, hand, { vx: 0.8 * H, vy: -1.5 * H });
    for (let i = 0; i < 120 && g.state === FLYING; i++) g.update(0.03, W, H, hand);
    expect(g.baskets).toBe(0);
    expect(g.streak).toBe(0);
    expect(log).toContain("miss");
  });
  it("the hoop stands still early and moves later", () => {
    expect(hoopX(5, W, 60)).toBe(W / 2);
    let moved = false;
    for (let t = 30; t < 60; t += 1) if (Math.abs(hoopX(t, W, 60) - W / 2) > 40) moved = true;
    expect(moved).toBe(true);
    for (let t = 0; t < 60; t += 0.5) {
      const x = hoopX(t, W, 60);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(W);
    }
  });
});
