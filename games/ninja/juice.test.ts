import { describe, expect, it } from "vitest";
import { DROP_CAP, Juice, STAIN_CAP } from "./juice";

describe("Juice pools", () => {
  it("a slice makes streaks, droplets, mist and a stain", () => {
    const j = new Juice(3);
    j.splash(300, 300, "#ff2d55", 42, 0.4, false);
    expect(j.n).toBeGreaterThan(20);
    expect(j.stains).toBe(1);
    const kinds = new Set(Array.from(j.kind.subarray(0, j.n)));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it("never exceeds the pool, however many fruits are cut", () => {
    const j = new Juice(5);
    for (let i = 0; i < 400; i++) j.splash(i % 600, 200, "#ff9a1f", 50, i, i % 7 === 0);
    expect(j.n).toBeLessThanOrEqual(DROP_CAP);
    expect(j.stains).toBeLessThanOrEqual(STAIN_CAP);
    for (let i = 0; i < 1000; i++) j.drip(10, 10, "#fff");
    expect(j.n).toBeLessThanOrEqual(DROP_CAP);
  });

  it("quality scales the pool: low quality uses fewer droplets and stains", () => {
    const hi = new Juice(1);
    const lo = new Juice(1);
    lo.scale = 0.3;
    for (let i = 0; i < 100; i++) {
      hi.splash(100, 100, "#f00", 40, 0, false);
      lo.splash(100, 100, "#f00", 40, 0, false);
    }
    expect(lo.n).toBeLessThanOrEqual(lo.dropLimit);
    expect(lo.dropLimit).toBeLessThan(hi.dropLimit);
    expect(lo.stains).toBeLessThanOrEqual(lo.stainLimit);
    expect(lo.stainLimit).toBeLessThan(hi.stainLimit);
    // a pool that shrank at run time is cut down on the next update
    hi.scale = 0.2;
    hi.update(0.016);
    expect(hi.n).toBeLessThanOrEqual(hi.dropLimit);
  });

  it("everything is short lived: droplets and stains are gone after a few seconds", () => {
    const j = new Juice(2);
    j.splash(200, 200, "#9be15d", 40, 1, true);
    for (let t = 0; t < 4; t += 1 / 60) j.update(1 / 60);
    expect(j.n).toBe(0);
    expect(j.stains).toBe(0);
  });

  it("droplets fall under gravity and the palette is memoised", () => {
    const j = new Juice(9);
    j.drip(100, 100, "#abcdef");
    const y0 = j.y[0];
    for (let i = 0; i < 20; i++) j.update(1 / 60);
    expect(j.y[0]).toBeGreaterThan(y0);
    expect(j.colour("#abcdef")).toBe(j.colour("#abcdef"));
  });
});
