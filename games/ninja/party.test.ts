import { describe, expect, it } from "vitest";
import { HandCollector, MAX_HANDS, type PersonLike } from "./party";

const H = 720;
const cfg = { minVis: 0.35, velSmooth: 0.6, dropoutMs: 140, extrapMs: 80, gain: 0.8 };

/** A person whose index fingers are at the given stage positions (everything else invisible). */
function person(l: [number, number] | null, r: [number, number] | null): PersonLike {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
  if (l) lm[19] = { x: l[0], y: l[1], v: 1 };
  if (r) lm[20] = { x: r[0], y: r[1], v: 1 };
  return { lm };
}

describe("HandCollector (party mode)", () => {
  it("collects the hands of everybody in the room, no player lock", () => {
    const c = new HandCollector(cfg);
    // three people, both hands visible: six blades
    const people = [person([100, 300], [200, 300]), person([600, 300], [700, 300]), person([1000, 300], [1100, 300])];
    c.update(people, 1000, H);
    expect(c.active).toBe(6);
    expect(c.tracks.filter((t) => t.active)).toHaveLength(6);
    // a hand without visible landmarks is simply not a blade
    c.update([person([100, 300], null), person(null, [700, 300])], 1033, H);
    expect(c.tracks.filter((t) => t.active && t.seen === 1033)).toHaveLength(2);
  });

  it("falls back to the wrist when the index finger is not visible", () => {
    const c = new HandCollector(cfg);
    const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
    lm[16] = { x: 400, y: 200, v: 0.9 };
    c.update([{ lm }], 0, H);
    expect(c.active).toBe(1);
    const t = c.tracks.find((x) => x.active)!;
    expect([t.x, t.y]).toEqual([400, 200]);
  });

  it("keeps a hand's identity while it sweeps and reports its speed in screen heights per second", () => {
    const c = new HandCollector(cfg);
    let id = -1;
    for (let f = 0; f < 10; f++) {
      // 40 px every 16 ms = 2500 px/s = 3.5 screen heights / s
      c.update([person(null, [200 + f * 40, 300]), person([900, 500], null)], f * 16, H);
      const mover = c.tracks.filter((t) => t.active && t.x < 800);
      expect(mover).toHaveLength(1);
      if (id < 0) id = mover[0].id;
      expect(mover[0].id).toBe(id);
    }
    const t = c.tracks[id];
    expect(t.speed).toBeGreaterThan(2);
    expect(t.x).toBeGreaterThan(t.px);
    // the other (still) hand does not cut
    expect(c.tracks.find((x) => x.active && x.x > 800)!.speed).toBeLessThan(0.1);
  });

  it("drops a hand after the dropout time and never tracks more than the pool", () => {
    const c = new HandCollector(cfg);
    c.update([person([100, 100], null)], 0, H);
    expect(c.active).toBe(1);
    c.update([], 100, H);
    expect(c.active).toBe(1); // bridged
    c.update([], 300, H);
    expect(c.active).toBe(0);
    const crowd = Array.from({ length: 10 }, (_, i) => person([i * 100, 100], [i * 100 + 50, 400]));
    c.update(crowd, 400, H);
    expect(c.active).toBeLessThanOrEqual(MAX_HANDS);
    expect(c.peak).toBeLessThanOrEqual(MAX_HANDS);
  });

  it("tracks nobody when the engine has no people (null)", () => {
    const c = new HandCollector(cfg);
    c.update(null, 0, H);
    expect(c.active).toBe(0);
  });
});
