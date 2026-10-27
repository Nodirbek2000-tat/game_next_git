import { describe, expect, it } from "vitest";
import { NinjaLogic, type BladeLike, type NinjaEvents } from "./logic";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function setup(over: Partial<ConstructorParameters<typeof NinjaLogic>[0]> = {}) {
  const log: string[] = [];
  const ev: NinjaEvents = {
    score: (p, d) => log.push(`score:${p}:${d}`),
    popup: (t) => log.push(`popup:${t}`),
    bomb: () => log.push("bomb"),
    freeze: () => log.push("freeze"),
    frenzy: () => log.push("frenzy"),
    slice: () => log.push("slice"),
    combo: (n) => log.push(`combo:${n}`),
    spawnItem: () => undefined,
    spawnHalf: () => undefined,
  };
  const logic = new NinjaLogic({ w: 1280, h: 720, kids: false, players: 1, minSpeed: 1, rng: seeded(3), ...over }, ev);
  return { logic, log };
}

const blade = (x: number, y: number, px: number, py: number, speed = 3): BladeLike => ({ active: true, side: "R", x, y, px, py, vx: (x - px) * 30, vy: (y - py) * 30, speed });

describe("NinjaLogic", () => {
  it("spawns items over time, never more than the pool, and removes the ones that fell", () => {
    const { logic } = setup();
    for (let t = 0; t < 20; t += 1 / 60) logic.update(1 / 60, [], [0], t * 1000);
    expect(logic.spawned).toBeGreaterThan(5);
    expect(logic.items.length).toBe(40);
    expect(logic.items.filter((i) => i.active).length).toBeLessThan(40);
  });

  it("a fast swipe through a fruit slices it (+10 / +30 crit) and creates two halves", () => {
    const { logic, log } = setup();
    logic.spawn("fruit");
    const it = logic.items.find((i) => i.active)!;
    it.x = 600;
    it.y = 300;
    it.vx = it.vy = 0;
    it.g = 0;
    logic.update(0.016, [blade(700, 300, 500, 300)], [0], 1000);
    expect(it.active).toBe(false);
    expect(logic.sliced).toBe(1);
    expect([10, 30]).toContain(logic.scores[0]);
    expect(logic.halves.filter((h) => h.active)).toHaveLength(2);
    expect(log).toContain("slice");
  });

  it("a slow hand does not cut (blade speed below the threshold)", () => {
    const { logic } = setup();
    logic.spawn("fruit");
    const it = logic.items.find((i) => i.active)!;
    it.x = 600;
    it.y = 300;
    it.vx = it.vy = 0;
    it.g = 0;
    logic.update(0.016, [blade(700, 300, 500, 300, 0.5)], [0], 1000);
    expect(it.active).toBe(true);
  });

  it("a bomb costs 30 points (never below zero)", () => {
    const { logic, log } = setup();
    logic.scores[0] = 20;
    logic.spawn("bomb");
    const it = logic.items.find((i) => i.active)!;
    it.x = 600;
    it.y = 300;
    it.vx = it.vy = 0;
    it.g = 0;
    logic.update(0.016, [blade(700, 300, 500, 300)], [0], 1000);
    expect(logic.bombs).toBe(1);
    expect(logic.scores[0]).toBe(0);
    expect(log).toContain("bomb");
  });

  it("kids mode: no bombs are ever queued", () => {
    const { logic } = setup({ kids: true });
    for (let t = 0; t < 50; t += 1 / 60) logic.update(1 / 60, [], [0], t * 1000);
    expect(logic.bombs).toBe(0);
    expect(logic.items.every((i) => i.kind !== "bomb")).toBe(true);
  });

  it("3+ fruits in one swipe give a combo bonus of n x 10", () => {
    const { logic, log } = setup();
    for (let k = 0; k < 3; k++) {
      logic.spawn("fruit");
    }
    const act = logic.items.filter((i) => i.active);
    act.forEach((it, k) => {
      it.x = 500 + k * 80;
      it.y = 300;
      it.vx = it.vy = 0;
      it.g = 0;
    });
    logic.update(0.016, [blade(800, 300, 450, 300)], [0], 1000);
    expect(logic.maxCombo).toBe(3);
    // after the 260 ms window the bonus is paid
    logic.update(0.016, [], [0], 1400);
    expect(log).toContain("combo:3");
    expect(log).toContain("popup:3 MEVA KOMBO!");
  });

  it("freeze slows time, frenzy doubles points", () => {
    const { logic } = setup();
    logic.spawn("freeze");
    let it = logic.items.find((i) => i.active)!;
    it.x = 600;
    it.y = 300;
    it.vx = it.vy = 0;
    it.g = 0;
    logic.update(0.016, [blade(700, 300, 500, 300)], [0], 1000);
    expect(logic.freezeT).toBeGreaterThan(4);
    logic.freezeT = 0;
    logic.spawn("frenzy");
    it = logic.items.find((i) => i.active && i.kind === "frenzy")!;
    it.x = 600;
    it.y = 300;
    it.vx = it.vy = 0;
    it.g = 0;
    logic.update(0.016, [blade(700, 300, 500, 300)], [0], 2000);
    expect(logic.frenzyT).toBeGreaterThan(5);
    logic.spawn("fruit");
    it = logic.items.find((i) => i.active && i.kind === "fruit")!;
    it.x = 600;
    it.y = 300;
    it.vx = it.vy = 0;
    it.g = 0;
    const before = logic.scores[0];
    logic.update(0.016, [blade(700, 300, 500, 300)], [0], 3000);
    expect([20, 60]).toContain(logic.scores[0] - before);
  });

  it("the round ends after the duration; accuracy = sliced / (spawned - bombs)", () => {
    const { logic } = setup({ duration: 5 });
    for (let t = 0; t < 6; t += 1 / 60) logic.update(1 / 60, [], [0], t * 1000);
    expect(logic.over).toBe(true);
    expect(logic.accuracy).toBe(0);
  });

  it("two players keep separate scores", () => {
    const { logic } = setup({ players: 2 });
    logic.spawn("fruit");
    const it = logic.items.find((i) => i.active)!;
    it.x = 600;
    it.y = 300;
    it.vx = it.vy = 0;
    it.g = 0;
    logic.update(0.016, [blade(100, 100, 90, 90, 0), blade(700, 300, 500, 300)], [0, 1], 1000);
    expect(logic.scores[0]).toBe(0);
    expect(logic.scores[1]).toBeGreaterThan(0);
  });

  it('party mode: every hand cuts into one shared score; a combo is counted per hand', () => {
    const { logic, log } = setup({ players: 1 });
    for (let k = 0; k < 6; k++) logic.spawn('fruit');
    const act = logic.items.filter((i) => i.active);
    act.forEach((it, k) => {
      it.x = 200 + k * 150;
      it.y = k < 3 ? 300 : 500;
      it.vx = it.vy = 0;
      it.g = 0;
    });
    const hand = (id: number, y: number): BladeLike => ({ ...blade(1000, y, 100, y), id });
    // two different hands (three fruits each) in the same frame, both belong to owner 0
    logic.update(0.016, [hand(0, 300), hand(1, 500)], [0, 0], 1000);
    expect(logic.sliced).toBe(6);
    expect(logic.scores).toHaveLength(1);
    expect(logic.scores[0]).toBeGreaterThanOrEqual(60);
    logic.update(0.016, [], [0], 1400);
    expect(log.filter((l) => l === 'combo:3')).toHaveLength(2);
  });
});

