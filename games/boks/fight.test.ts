import { describe, expect, it } from "vitest";
import { type Defense, judgeDefense } from "./combat";
import { PLAYER_HP, ROUND_SPECS } from "./config";
import { Fight, type FightHooks, type Phase } from "./fight";

/** deterministic random numbers */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Log {
  phases: Phase[];
  bells: string[];
  impacts: { def: Defense; dmg: number; pts: number }[];
  windups: number[];
  spawned: number;
  expired: number;
  over: string[];
  down: string[];
}

function make(opts: { roundSec?: number; kids?: boolean; judge?: () => Defense; seed?: number } = {}) {
  const log: Log = { phases: [], bells: [], impacts: [], windups: [], spawned: 0, expired: 0, over: [], down: [] };
  const hooks: FightHooks = {
    judge: () => (opts.judge ? opts.judge() : "hit"),
    bell: (k) => log.bells.push(k),
    phase: (p) => log.phases.push(p),
    padSpawn: () => log.spawned++,
    padExpire: () => log.expired++,
    attackStart: (a) => log.windups.push(a.windup),
    impact: (_a, def, dmg, pts) => log.impacts.push({ def, dmg, pts }),
    knockdown: (w) => log.down.push(w),
    over: (o) => log.over.push(o),
  };
  const f = new Fight({ roundSec: opts.roundSec ?? 12, restSec: 2, kids: opts.kids, rng: mulberry(opts.seed ?? 7) }, hooks);
  f.start();
  return { f, log };
}

const run = (f: Fight, sec: number, dt = 1 / 30, each?: (f: Fight) => void): void => {
  for (let t = 0; t < sec && f.phase !== "over"; t += dt) {
    f.update(dt);
    each?.(f);
  }
};

describe("round flow", () => {
  it("intro -> 3 rounds with rests -> over, with a bell at every round", () => {
    const { f, log } = make();
    run(f, 200);
    expect(log.phases).toEqual(["intro", "round", "rest", "round", "rest", "round", "over"]);
    expect(f.round).toBe(3);
    expect(f.phase).toBe("over");
    expect(f.outcome).toBe("points");
    expect(log.bells.filter((b) => b === "start").length).toBe(3);
    expect(log.bells.filter((b) => b === "end").length).toBe(3);
    expect(f.stats.roundsDone).toBe(3);
    expect(log.over).toEqual(["points"]);
  });

  it("a round lasts the set time", () => {
    const { f } = make({ roundSec: 12 });
    run(f, 2.5);
    expect(f.phase).toBe("round");
    run(f, 11);
    expect(f.phase).toBe("round");
    run(f, 2);
    expect(f.phase).toBe("rest");
  });

  it("the rest gives health back (not above the maximum)", () => {
    const { f } = make({ judge: () => "dodge" });
    run(f, 3);
    f.hp = 40;
    run(f, 12);
    expect(f.phase).toBe("rest");
    expect(f.hp).toBe(70);
    f.hp = 95;
    run(f, 6);
    run(f, 13);
    expect(f.hp).toBeLessThanOrEqual(PLAYER_HP);
  });

  it("the wind-up is about 0.7 s on average: slow early, quick late", () => {
    expect(ROUND_SPECS[0].windup).toBeGreaterThan(ROUND_SPECS[1].windup);
    expect(ROUND_SPECS[1].windup).toBeGreaterThan(ROUND_SPECS[2].windup);
    const avg = ROUND_SPECS.reduce((s, r) => s + r.windup, 0) / ROUND_SPECS.length;
    expect(avg).toBeGreaterThan(0.6);
    expect(avg).toBeLessThan(0.8);
    expect(ROUND_SPECS[2].padLife).toBeLessThan(ROUND_SPECS[0].padLife);
  });

  it("the partner attacks with the telegraphed wind-up of the round", () => {
    const { f, log } = make({ roundSec: 45 });
    run(f, 60);
    expect(log.windups.length).toBeGreaterThan(0);
    for (const w of log.windups) expect(w).toBeGreaterThan(0.45);
    expect(Math.max(...log.windups)).toBeLessThanOrEqual(ROUND_SPECS[0].windup + 1e-9);
  });

  it("kids mode: no attacks at all, longer pads", () => {
    const { f, log } = make({ roundSec: 45, kids: true });
    run(f, 120);
    expect(log.windups.length).toBe(0);
    expect(f.hp).toBe(PLAYER_HP);
    expect(log.spawned).toBeGreaterThan(5);
  });

  it("pads that nobody hits run out, count as missed and break the combo", () => {
    const { f, log } = make();
    run(f, 8);
    expect(log.spawned).toBeGreaterThan(0);
    expect(log.expired).toBeGreaterThan(0);
    expect(f.stats.missed).toBe(log.expired);
    expect(f.combo).toBe(0);
  });

  it("at most one live pad per side", () => {
    const { f } = make({ roundSec: 45 });
    run(f, 60, 1 / 30, (fi) => {
      expect(fi.pads.filter((p) => p.active && p.side === "L").length).toBeLessThanOrEqual(1);
      expect(fi.pads.filter((p) => p.active && p.side === "R").length).toBeLessThanOrEqual(1);
    });
  });
});

describe("hits and defence", () => {
  const firstPad = (f: Fight): number => f.pads.findIndex((p) => p.active);

  it("a hit on a pad scores, faster is worth more, a combo adds up", () => {
    const { f } = make({ roundSec: 45 });
    run(f, 6, 1 / 30, () => undefined);
    let i = firstPad(f);
    for (let n = 0; i < 0 && n < 400; n++) {
      f.update(1 / 30);
      i = firstPad(f);
    }
    expect(i).toBeGreaterThanOrEqual(0);
    const slow = f.padHit(i, 12);
    expect(slow.pts).toBeGreaterThanOrEqual(60);
    expect(f.score).toBe(slow.pts);
    expect(f.stats.hits).toBe(1);
    expect(f.combo).toBe(1);
    let j = firstPad(f);
    for (let n = 0; j < 0 && n < 400; n++) {
      f.update(1 / 30);
      j = firstPad(f);
    }
    expect(f.stats.maxKmh).toBe(12);
    const fast = f.padHit(j, 45);
    expect(f.stats.maxKmh).toBe(45);
    expect(fast.pts).toBeGreaterThan(slow.pts);
    expect(fast.dmg).toBeGreaterThan(slow.dmg);
    expect(f.combo).toBe(2);
  });

  it("a pad can only be hit once and only in a round", () => {
    const { f } = make({ roundSec: 45 });
    expect(f.padHit(0, 30).pts).toBe(0);
    run(f, 6);
    let i = firstPad(f);
    for (let n = 0; i < 0 && n < 400; n++) {
      f.update(1 / 30);
      i = firstPad(f);
    }
    expect(f.padHit(i, 30).pts).toBeGreaterThan(0);
    expect(f.padHit(i, 30).pts).toBe(0);
  });

  it("a punch costs stamina, a tired player scores less", () => {
    const { f } = make({ roundSec: 45 });
    run(f, 6);
    const before = f.stamina;
    f.punchThrown();
    expect(f.stamina).toBeLessThan(before);
    expect(f.stats.thrown).toBe(1);
    let i = firstPad(f);
    for (let n = 0; i < 0 && n < 400; n++) {
      f.update(1 / 30);
      i = firstPad(f);
    }
    f.stamina = 5;
    const tired = f.padHit(i, 30);
    expect(f.tired).toBe(true);
    expect(tired.pts).toBeLessThan(60);
  });

  // run until the first impact with a given judge
  function untilImpact(judge: () => Defense, round = 1): { f: Fight; log: Log } {
    const g = make({ roundSec: 45, judge });
    for (let n = 0; n < 4000 && g.log.impacts.length === 0; n++) g.f.update(1 / 30);
    expect(g.log.impacts.length).toBe(1);
    void round;
    return g;
  }

  it("a hit costs health and breaks the combo", () => {
    const { f, log } = untilImpact(() => "hit");
    expect(log.impacts[0].dmg).toBe(ROUND_SPECS[0].damage * (f.attack.kind === "hook" ? 1.25 : 1));
    expect(f.hp).toBe(PLAYER_HP - log.impacts[0].dmg);
    expect(f.stats.taken).toBe(1);
  });

  it("a dodge avoids the hit and scores", () => {
    const { f, log } = untilImpact(() => "dodge");
    expect(f.hp).toBe(PLAYER_HP);
    expect(f.stats.dodges).toBe(1);
    expect(log.impacts[0].dmg).toBe(0);
    expect(f.score).toBe(120);
  });

  it("a block reduces the damage to a quarter", () => {
    const hit = untilImpact(() => "hit");
    const block = untilImpact(() => "block");
    const lostHit = PLAYER_HP - hit.f.hp;
    const lostBlock = PLAYER_HP - block.f.hp;
    expect(lostBlock).toBeGreaterThan(0);
    expect(lostBlock).toBeLessThan(lostHit);
    expect(lostBlock / lostHit).toBeCloseTo(0.25, 5);
  });

  it("the judge sees the attack (dodge is decided from the player's body)", () => {
    let seen = "";
    const g = make({ roundSec: 45 });
    // replace the judge with a real one on a leaning head
    const hooks = g.f as unknown as { hooks: FightHooks };
    hooks.hooks.judge = (a) => {
      seen = `${a.kind}:${a.from}`;
      return judgeDefense(a.kind, a.from, { devXMax: 0.9, devXMin: 0, devY: 0, guard: 0 });
    };
    for (let n = 0; n < 4000 && !seen; n++) g.f.update(1 / 30);
    expect(seen).not.toBe("");
    expect(g.f.stats.dodges).toBe(1);
  });

  it("the player is knocked out when health runs out: the fight is over", () => {
    const { f, log } = make({ roundSec: 45, judge: () => "hit" });
    f.hp = 5;
    run(f, 60);
    expect(f.phase).toBe("over");
    expect(f.outcome).toBe("lost");
    expect(log.down).toContain("player");
    expect(log.over).toEqual(["lost"]);
  });

  it("enough clean hits knock the partner down: bonus, count, then the rest", () => {
    const { f, log } = make({ roundSec: 45, judge: () => "dodge" });
    run(f, 2.5);
    let hits = 0;
    for (let n = 0; n < 6000 && f.phase === "round"; n++) {
      f.update(1 / 30);
      const i = firstPad(f);
      if (i >= 0 && f.pads[i].age > 0.3) {
        f.padHit(i, 30);
        hits++;
      }
    }
    expect(f.phase).toBe("ko");
    expect(log.down).toEqual(["enemy"]);
    expect(f.stats.kos).toBe(1);
    expect(hits).toBeGreaterThan(10);
    expect(hits).toBeLessThan(40);
    const s = f.score;
    run(f, 4);
    expect(f.phase).toBe("rest");
    expect(f.score).toBeGreaterThan(s);
    run(f, 3);
    expect(f.round).toBe(2);
    expect(f.enemyHp).toBe(100);
  });
});

describe("scoring is in line with the catalogue stars (2500 / 5500 / 9000)", () => {
  /** a simulated player: lands a pad with `hit` probability, dodges with `dodge` probability */
  function play(hit: number, dodge: number, kmh: number, seed: number): Fight {
    const rng = mulberry(seed * 31 + 5);
    const { f } = make({ roundSec: 45, seed });
    (f as unknown as { hooks: FightHooks }).hooks.judge = () => (rng() < dodge ? "dodge" : rng() < 0.3 ? "block" : "hit");
    const seen = new Set<string>();
    for (let n = 0; n < 20000 && f.phase !== "over"; n++) {
      f.update(1 / 30);
      for (const p of f.pads) {
        const key = `${f.round}:${p.id}:${p.life}:${p.rx}`;
        if (p.active && p.age > 0.4 && !seen.has(key)) {
          seen.add(key);
          if (rng() < hit) f.padHit(p.id, kmh + (rng() - 0.5) * 10);
        }
      }
    }
    return f;
  }
  const avg = (hit: number, dodge: number, kmh: number): number => {
    let s = 0;
    for (let seed = 1; seed <= 6; seed++) s += play(hit, dodge, kmh, seed).score;
    return s / 6;
  };

  it("a beginner earns a star, a good player three", () => {
    const beginner = avg(0.35, 0.2, 18);
    const decent = avg(0.6, 0.45, 25);
    const great = avg(0.9, 0.7, 32);
    expect(beginner).toBeGreaterThan(2500);
    expect(decent).toBeGreaterThan(beginner);
    expect(great).toBeGreaterThan(decent);
    expect(great).toBeGreaterThan(9000);
    expect(decent).toBeGreaterThan(5000);
    expect(beginner).toBeLessThan(5500);
    console.log("boks scores (beginner / decent / great):", Math.round(beginner), Math.round(decent), Math.round(great));
  });
});
