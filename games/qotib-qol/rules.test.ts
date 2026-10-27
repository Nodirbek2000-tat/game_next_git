import { describe, expect, it } from "vitest";
import { DEFAULT_CFG, DanceMeter, FreezeRound, PLAYLIST, SLOTS, StillGate, hasBit } from "./rules";
import { SONGS } from "@/games/bogcha/common";

/** small deterministic generator (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 30;

/** energy of a kid who stands still, with tracking jitter and now and then a short spike */
function stillEnergy(rnd: () => number): number {
  const base = 0.05 + rnd() * 0.3; // jitter
  return rnd() < 0.06 ? base + 1.2 : base; // ~6% of the frames a false "movement" spike (single frames)
}
/** energy of a kid who keeps dancing / running */
const movingEnergy = (rnd: () => number): number => 1.1 + rnd() * 2.4;

describe("StillGate (tolerant stillness)", () => {
  it("a still child with noisy tracking gets the star after ~2 s", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rnd = seeded(seed);
      const g = new StillGate(DEFAULT_CFG);
      let t = 0;
      let at = -1;
      while (t < 5.5 && at < 0) {
        if (g.step(stillEnergy(rnd), true, DT)) at = t;
        t += DT;
      }
      expect(at).toBeGreaterThan(1.9);
      expect(at).toBeLessThan(3.2);
    }
  });

  it("a child who keeps moving never gets it", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rnd = seeded(seed);
      const g = new StillGate(DEFAULT_CFG);
      let won = false;
      for (let t = 0; t < 5.5; t += DT) if (g.step(movingEnergy(rnd), true, DT)) won = true;
      expect(won).toBe(false);
    }
  });

  it("a child who moves first and then freezes still wins inside the freeze window", () => {
    const rnd = seeded(7);
    const g = new StillGate(DEFAULT_CFG);
    let at = -1;
    for (let t = 0; t < DEFAULT_CFG.freezeSec; t += DT) {
      const e = t < 2.5 ? movingEnergy(rnd) : stillEnergy(rnd);
      if (g.step(e, true, DT) && at < 0) at = t;
    }
    expect(at).toBeGreaterThan(4);
    expect(at).toBeLessThan(DEFAULT_CFG.freezeSec);
  });

  it("a short wobble does not wipe the collected calm time", () => {
    const g = new StillGate(DEFAULT_CFG);
    for (let t = 0; t < 1.2; t += DT) g.step(0.1, true, DT);
    const before = g.hold;
    for (let t = 0; t < 0.3; t += DT) g.step(2, true, DT);
    expect(g.hold).toBeGreaterThan(before * 0.6);
    expect(g.hold).toBeLessThan(before);
  });

  it("uses hysteresis: just under the exit level keeps counting once calm, but does not start counting", () => {
    const cfg = DEFAULT_CFG;
    const mid = (cfg.calmEnter + cfg.calmExit) / 2;
    const cold = new StillGate(cfg);
    for (let t = 0; t < 3; t += DT) cold.step(mid, true, DT);
    expect(cold.hold).toBe(0);
    const warm = new StillGate(cfg);
    warm.step(0.1, true, DT);
    let won = false;
    for (let t = 0; t < 3; t += DT) if (warm.step(mid, true, DT)) won = true;
    expect(won).toBe(true);
  });

  it("a child who is not in the picture gains nothing and loses nothing; one star only", () => {
    const g = new StillGate(DEFAULT_CFG);
    for (let t = 0; t < 1; t += DT) g.step(0, true, DT);
    const h = g.hold;
    for (let t = 0; t < 4; t += DT) expect(g.step(0, false, DT)).toBe(false);
    expect(g.hold).toBe(h);
    let wins = 0;
    for (let t = 0; t < 6; t += DT) if (g.step(0, true, DT)) wins++;
    expect(wins).toBe(1);
  });
});

describe("DanceMeter", () => {
  it("lively dancing fills a star every few seconds, standing does not", () => {
    const m = new DanceMeter(DEFAULT_CFG);
    let stars = 0;
    for (let t = 0; t < 12; t += DT) if (m.step(2.5, DT)) stars++;
    expect(stars).toBeGreaterThanOrEqual(2);
    expect(stars).toBeLessThanOrEqual(4);
    const s = new DanceMeter(DEFAULT_CFG);
    for (let t = 0; t < 60; t += DT) expect(s.step(0.2, DT)).toBe(false);
  });
});

/** drives a round like the kit does; `kids[i](t, rnd)` gives the energy of slot i or null when absent */
function run(opts: { seed: number; secs: number; kids: ((t: number, r: () => number) => number | null)[]; cfg?: typeof DEFAULT_CFG }) {
  const rnd = seeded(opts.seed);
  const round = new FreezeRound(opts.cfg ?? DEFAULT_CFG, seeded(opts.seed + 1000));
  const present = new Uint8Array(SLOTS);
  const energy = new Float32Array(SLOTS);
  const log = { freezes: [] as number[], dances: [] as number[], stars: new Array<number>(SLOTS).fill(0), danceStars: new Array<number>(SLOTS).fill(0), tried: [] as number[], phases: [] as string[] };
  let phase = round.phase;
  let phaseStart = 0;
  let t = 0;
  for (; t < opts.secs; t += DT) {
    for (let i = 0; i < SLOTS; i++) {
      const e = opts.kids[i]?.(t, rnd) ?? null;
      present[i] = e === null ? 0 : 1;
      energy[i] = e ?? 0;
    }
    round.update(DT, opts.secs - t, present, energy);
    for (let i = 0; i < SLOTS; i++) {
      if (hasBit(round.ev.starMask, i)) log.stars[i]++;
      if (hasBit(round.ev.danceMask, i)) log.danceStars[i]++;
    }
    if (round.ev.thawed) log.tried.push(round.triedMask);
    if (round.phase !== phase) {
      log.phases.push(`${phase}:${(t - phaseStart).toFixed(1)}`);
      if (round.phase === "freeze") log.dances.push(t - phaseStart);
      phase = round.phase;
      phaseStart = t;
    }
    if (round.ev.froze) log.freezes.push(t);
  }
  return { round, log };
}

describe("FreezeRound phase machine", () => {
  const still = (t: number, r: () => number): number => stillEnergy(r);
  const moving = (t: number, r: () => number): number => movingEnergy(r);

  it("cycles dance -> freeze -> result -> dance with dances of 4-9 s", () => {
    const { log } = run({ seed: 3, secs: 75, kids: [still, moving, moving] });
    expect(log.freezes.length).toBeGreaterThanOrEqual(4);
    // dances are random in 4..9 s (the first one at least 5 s)
    for (const d of log.dances) {
      expect(d).toBeGreaterThanOrEqual(4 - 0.1);
      expect(d).toBeLessThanOrEqual(9 + 0.1);
    }
    expect(log.dances[0]).toBeGreaterThanOrEqual(5 - 0.1);
    // the phase order is strictly dance, freeze, result, dance, ...
    const order = log.phases.map((p) => p.split(":")[0]);
    for (let i = 0; i < order.length; i++) expect(order[i]).toBe(["dance", "freeze", "result"][i % 3]);
    // the dance lengths vary
    expect(new Set(log.dances.map((d) => Math.round(d))).size).toBeGreaterThan(2);
  });

  it("freeze stars go only to the children who stayed still (3 kids, noisy data)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { log } = run({ seed, secs: 75, kids: [still, moving, still] });
      expect(log.freezes.length).toBeGreaterThanOrEqual(4);
      expect(log.stars[0]).toBe(log.freezes.length);
      expect(log.stars[2]).toBe(log.freezes.length);
      expect(log.stars[1]).toBe(0);
      expect(log.stars[3] + log.stars[4]).toBe(0);
      // every freeze: the mover was told to try again, the still ones were not
      for (const m of log.tried) {
        expect(hasBit(m, 1)).toBe(true);
        expect(hasBit(m, 0)).toBe(false);
        expect(hasBit(m, 2)).toBe(false);
      }
    }
  });

  it("dance stars reward movement, not standing", () => {
    const { log } = run({ seed: 5, secs: 75, kids: [still, moving] });
    expect(log.danceStars[1]).toBeGreaterThanOrEqual(2);
    expect(log.danceStars[0]).toBe(0);
  });

  it("ends a freeze early when everybody froze, and not before they held still", () => {
    const { log } = run({ seed: 2, secs: 40, kids: [still, still, still] });
    const f = log.phases.find((p) => p.startsWith("freeze"));
    const len = Number(f?.split(":")[1]);
    expect(len).toBeGreaterThanOrEqual(DEFAULT_CFG.holdSec + DEFAULT_CFG.celebrateSec - 0.2);
    expect(len).toBeLessThan(DEFAULT_CFG.freezeSec - 0.5);
  });

  it("a freeze lasts at most freezeSec when somebody keeps moving", () => {
    const { log } = run({ seed: 2, secs: 40, kids: [moving] });
    const f = log.phases.find((p) => p.startsWith("freeze"));
    expect(Number(f?.split(":")[1])).toBeLessThanOrEqual(DEFAULT_CFG.freezeSec + 0.1);
    expect(log.stars[0]).toBe(0);
  });

  it("never starts a freeze that would be cut off by the end of the round", () => {
    const { log } = run({ seed: 4, secs: 75, kids: [still] });
    const last = log.freezes[log.freezes.length - 1];
    expect(75 - last).toBeGreaterThanOrEqual(DEFAULT_CFG.minLeftForFreeze - 0.1);
    // a very short round still dances all the way and never freezes
    const short = run({ seed: 4, secs: 7, kids: [still] });
    expect(short.log.freezes.length).toBe(0);
  });

  it("absent children get nothing; children may come and go without blocking the freeze", () => {
    const comeGo = (t: number, r: () => number): number | null => (t % 9 < 4 ? null : stillEnergy(r));
    const { log } = run({ seed: 8, secs: 75, kids: [still, null as never, comeGo] });
    expect(log.stars[1]).toBe(0);
    expect(log.stars[3]).toBe(0);
    expect(log.freezes.length).toBeGreaterThanOrEqual(3);
    // nobody in the picture at all: the cycle still runs, nobody is "tried"
    const empty = run({ seed: 9, secs: 40, kids: [] });
    expect(empty.log.freezes.length).toBeGreaterThanOrEqual(1);
    expect(empty.log.tried.every((m) => m === 0)).toBe(true);
  });

  it("a freeze never gives more than one star per child, and the result/dance parts reset the freeze marks", () => {
    const { round, log } = run({ seed: 6, secs: 75, kids: [still] });
    expect(log.stars[0]).toBe(log.freezes.length);
    if (round.phase === "dance") expect(round.doneMask).toBe(0);
  });
});

describe("playlist", () => {
  it("uses real songs and varies the tempo", () => {
    for (const p of PLAYLIST) expect(SONGS[p.song]).toBeTruthy();
    expect(new Set(PLAYLIST.map((p) => p.tempo)).size).toBeGreaterThan(3);
    expect(new Set(PLAYLIST.map((p) => p.song)).size).toBe(3);
  });
});
