import { describe, expect, it } from "vitest";
import { CROSS_SEC, SUN_SEC, Weather, isUnder, passStar } from "./logic";

describe("soyabon logic", () => {
  it("under the cloud only inside its column", () => {
    expect(isUnder(500, 450, 100)).toBe(true);
    expect(isUnder(500, 700, 100)).toBe(false);
  });
  it("a star for a mostly dry pass of enough length", () => {
    expect(passStar(2.5, 0.3)).toBe(true);
    expect(passStar(2.5, 2)).toBe(false);
    expect(passStar(0.3, 0)).toBe(false);
  });
  it("cloud crosses, sun comes, cloud returns from the other side", () => {
    const w = new Weather();
    w.reset(100);
    expect(w.x).toBe(-100);
    let ev = 0;
    let t = 0;
    while (ev === 0 && t < 60) {
      ev = w.step(0.1, 1000, 100);
      t += 0.1;
    }
    expect(ev).toBe(1);
    expect(w.phase).toBe("sun");
    expect(t).toBeGreaterThan(CROSS_SEC);
    ev = 0;
    t = 0;
    while (ev === 0 && t < 60) {
      ev = w.step(0.1, 1000, 100);
      t += 0.1;
    }
    expect(ev).toBe(2);
    expect(t).toBeGreaterThanOrEqual(SUN_SEC - 0.2);
    expect(w.phase).toBe("rain");
    expect(w.dir).toBe(-1);
    expect(w.x).toBe(1100);
  });
});
