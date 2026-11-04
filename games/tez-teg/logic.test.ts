import { describe, expect, it } from "vitest";
import { TegLogic, bodyFrame, isKneeZone, makeBody, makeTouchers, scoreFor, touches, zonePos, type Lmv } from "./logic";

function person(): Lmv[] {
  const lm: Lmv[] = Array.from({ length: 33 }, () => ({ x: 200, y: 300, v: 1 }));
  const set = (i: number, x: number, y: number) => {
    lm[i].x = x;
    lm[i].y = y;
  };
  set(0, 200, 200);
  set(11, 250, 280); set(12, 150, 280);
  set(23, 235, 480); set(24, 165, 480);
  set(25, 238, 640); set(26, 162, 640);
  return lm;
}

describe("tez-teg", () => {
  it("scores faster touches higher", () => {
    expect(scoreFor(0, 1.5)).toBe(100);
    expect(scoreFor(1.5, 1.5)).toBe(50);
    expect(scoreFor(0.3, 1.5)).toBeGreaterThan(scoreFor(1.0, 1.5));
    expect(touches(10, 10, 14, 13, 6)).toBe(true);
    expect(touches(10, 10, 30, 10, 6)).toBe(false);
  });
  it("places targets around the body inside the screen", () => {
    const b = makeBody();
    expect(bodyFrame(person(), b)).toBe(true);
    expect(b.legs).toBe(true);
    expect(b.s).toBeCloseTo(100);
    const o = { x: 0, y: 0, r: 0 };
    zonePos(0, b, 400, 900, o);
    expect(o.y).toBeLessThan(b.noseY); // high target above the head
    zonePos(2, b, 400, 900, o);
    expect(o.x).toBeLessThan(b.cx); // side target on the left
    zonePos(5, b, 400, 900, o);
    expect(o.y).toBeGreaterThan(b.hipY); // knee target below the hips
    expect(isKneeZone(5)).toBe(true);
    expect(isKneeZone(1)).toBe(false);
    for (let z = 0; z < 6; z++) {
      zonePos(z, b, 400, 900, o);
      expect(o.x).toBeGreaterThan(0);
      expect(o.x).toBeLessThan(400);
      expect(o.y).toBeGreaterThan(0);
      expect(o.y).toBeLessThan(900);
    }
  });
  it("hand hits a hand target, only a knee hits a low one, a miss resets the combo", () => {
    const hits: number[] = [];
    let misses = 0;
    const g = new TegLogic(60, () => 0, { spawn: () => undefined, hit: (_t, pts) => hits.push(pts), miss: () => misses++ });
    const body = makeBody();
    bodyFrame(person(), body);
    const tc = makeTouchers();
    g.update(1, 400, 900, body, tc); // spawns zone 0
    const t = g.targets.find((x) => x.on)!;
    expect(t.zone).toBe(0);
    tc.hx[0] = t.x;
    tc.hy[0] = t.y;
    tc.hok[0] = true;
    g.update(0.1, 400, 900, body, tc);
    expect(hits.length).toBe(1);
    expect(g.combo).toBe(1);
    // let a target time out
    tc.hok[0] = false;
    for (let i = 0; i < 80; i++) g.update(0.05, 400, 900, body, tc);
    expect(misses).toBeGreaterThan(0);
    expect(g.combo).toBe(0);
  });
  it("hand does not satisfy a knee target", () => {
    const g = new TegLogic(60, () => 0.99, { spawn: () => undefined, hit: () => undefined, miss: () => undefined });
    const body = makeBody();
    bodyFrame(person(), body);
    const tc = makeTouchers();
    g.update(1, 400, 900, body, tc);
    const t = g.targets.find((x) => x.on)!;
    expect(isKneeZone(t.zone)).toBe(true);
    tc.hx[0] = t.x;
    tc.hy[0] = t.y;
    tc.hok[0] = true;
    g.update(0.1, 400, 900, body, tc);
    expect(g.hits).toBe(0);
    tc.kx[1] = t.x;
    tc.ky[1] = t.y;
    tc.kok[1] = true;
    g.update(0.1, 400, 900, body, tc);
    expect(g.hits).toBe(1);
  });
});
