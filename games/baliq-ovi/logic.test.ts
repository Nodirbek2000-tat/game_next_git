import { describe, expect, it } from "vitest";
import { AssetLib, assetUrl, type Manifest } from "./assets";
import { collectionSize, recordCatch, loadCollection, saveCollection, type Collection } from "./collection";
import { AState, FishSim, type Bait, type WorldEnv } from "./fishai";
import { AnglerGestures, emptyInput, NetDetector } from "./gestures";
import { bedDepth, LAKE, rollWeather, shoreDamp, waveHeight, WAVES } from "./locations";
import {
  addCatch, basketKg, castDistance, castPower, castYaw, CastDetector, coopDone, coopProgress, duelWinner, emptyTally, FightModel, lineInDanger,
  netHelpApplies, pointsFor, PumpTracker, StrikeDetector, TUNING,
} from "./rules";
import { FISH_SPECIES, pickSpecies, rollWeight, SPECIES, SPECIES_BY_ID } from "./species";
import { VerletLine } from "./verlet";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const T = { kids: false, sensitivity: 1 };
const CYRILLIC = new RegExp('[' + String.fromCharCode(0x400) + '-' + String.fromCharCode(0x4ff) + ']');

describe("species data", () => {
  it("has 12+ species with Uzbek names, weights and no Cyrillic", () => {
    expect(SPECIES.length).toBeGreaterThanOrEqual(12);
    for (const n of ["zog", "sazan", "amur", "dongpeshona", "chortan", "laqqa", "forel", "sudak", "ilonbosh", "karas", "oltin", "etik", "shisha"]) expect(SPECIES.some((s) => s.id.startsWith(n))).toBe(true);
    for (const s of SPECIES) {
      expect(s.w[0]).toBeLessThan(s.w[1]);
      expect(JSON.stringify(s)).not.toMatch(CYRILLIC);
    }
    expect(SPECIES_BY_ID.etik.junk).toBe("boot");
    expect(SPECIES_BY_ID.shisha.junk).toBe("bottle");
  });
  it("species choice respects the water depth and the rarity", () => {
    const rng = seeded(5);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const s = pickSpecies({ depth: 2, tod: "day", rng });
      counts[s.id] = (counts[s.id] ?? 0) + 1;
    }
    expect(counts.laqqa).toBeUndefined(); // needs 3 m
    expect(counts.sudak).toBeUndefined();
    expect(counts.oltin ?? 0).toBeLessThan(counts.zogora);
    const deep = new Set<string>();
    for (let i = 0; i < 4000; i++) deep.add(pickSpecies({ depth: 6, tod: "dawn", rng }).id);
    expect(deep.has("laqqa") && deep.has("sudak")).toBe(true);
    expect(pickSpecies({ depth: 6, tod: "day", rng, force: "forel" }).id).toBe("forel");
  });
  it("weights stay inside the species range", () => {
    const rng = seeded(2);
    for (const s of FISH_SPECIES) for (let i = 0; i < 50; i++) {
      const w = rollWeight(s, rng);
      expect(w).toBeGreaterThanOrEqual(s.w[0] - 0.01);
      expect(w).toBeLessThanOrEqual(s.w[1] + 0.01);
    }
  });
});

describe("cast", () => {
  it("power grows with the flick speed, direction follows the hand", () => {
    expect(castPower(0.1)).toBe(TUNING.cast.minPower);
    expect(castPower(1.3)).toBeCloseTo(0.5, 1);
    expect(castPower(9)).toBe(1);
    expect(castDistance(1, false)).toBeGreaterThan(castDistance(0.3, false));
    expect(castDistance(1, true)).toBeLessThan(castDistance(1, false));
    expect(castDistance(1, false, 20)).toBe(20);
    expect(castYaw(1)).toBeGreaterThan(0);
    expect(castYaw(-1)).toBeLessThan(0);
    expect(castYaw(10)).toBeCloseTo((TUNING.cast.maxYawDeg * Math.PI) / 180);
  });
  it("needs the raised hand first, then a fast downward flick", () => {
    const d = new CastDetector();
    // flick without arming: nothing
    expect(d.update(0.016, false, 2, T).fired).toBe(false);
    d.reset();
    d.update(0.7, true, 0, T);
    expect(d.armed).toBe(true);
    // slow movement does not cast
    expect(d.update(0.016, true, 0.4, T).fired).toBe(false);
    const r = d.update(0.016, false, 1.8, T);
    expect(r.fired).toBe(true);
    expect(r.power).toBeCloseTo(1.8 / 2.6, 2);
    // cooldown + disarmed
    expect(d.update(0.016, false, 2, T).fired).toBe(false);
  });
  it("the armed state expires after 1.6 s; kids and sensitivity lower the threshold", () => {
    const d = new CastDetector();
    d.update(0.016, true, 0, T);
    for (let i = 0; i < 120; i++) d.update(0.016, false, 0, T);
    expect(d.armed).toBe(false);
    expect(d.update(0.016, false, 2, T).fired).toBe(false);
    d.reset();
    d.update(0.7, true, 0, T);
    expect(d.update(0.016, false, 0.8, T).fired).toBe(false);
    d.reset();
    d.update(0.7, true, 0, T);
    expect(d.update(0.016, false, 0.8, { kids: true, sensitivity: 1 }).fired).toBe(true);
    d.reset();
    d.update(0.7, true, 0, T);
    expect(d.update(0.016, false, 0.8, { kids: false, sensitivity: 1.3 }).fired).toBe(true);
  });
});

describe("strike and pump", () => {
  it("a sharp upward pull strikes; a slow one does not", () => {
    const s = new StrikeDetector();
    expect(s.update(0.016, 0.5, T)).toBe(false);
    expect(s.update(0.016, 1.4, T)).toBe(true);
    const k = new StrikeDetector();
    expect(k.update(0.016, 0.9, { kids: true, sensitivity: 1 })).toBe(true);
    expect(new StrikeDetector().update(0.016, 0.9, T)).toBe(false);
  });
  it("pumping: lift pulls, then lowering while reeling speeds the reel up", () => {
    const p = new PumpTracker();
    expect(p.update(0.016, -1.5, 0, T).lift).toBe(TUNING.fight.pumpPull);
    const o = p.update(0.016, 0.8, 1, T);
    expect(o.lift).toBe(0);
    expect(o.lower).toBe(TUNING.pump.lowerBonus);
    const q = new PumpTracker();
    expect(q.update(0.016, 0.8, 1, T).lower).toBe(1); // no lift before
  });
});

describe("fight model", () => {
  const sp = SPECIES_BY_ID.sazan;
  const make = (over: Partial<ConstructorParameters<typeof FightModel>[0]> = {}) => new FightModel({ species: sp, weight: 3, startD: 20, kids: false, rng: seeded(11), ...over });
  const run = (f: FightModel, seconds: number, crank: number, pump = 0, reelMul = 1) => {
    let ev = "none";
    for (let t = 0; t < seconds && ev === "none"; t += 0.016) ev = f.step(0.016, { crank, pump, reelMul });
    return ev;
  };
  it("steady reeling brings the fish to the net", () => {
    expect(run(make(), 90, 1.2)).toBe("land");
  });
  it("not reeling lets the fish run away", () => {
    expect(run(make(), 90, 0)).toBe("escape");
  });
  it("reeling too hard while the fish runs snaps the line (adult mode), kids mode never breaks", () => {
    const strong = SPECIES_BY_ID.laqqa;
    const f = make({ species: strong, weight: 14 });
    expect(run(f, 60, 2.6, 0.45)).toBe("break");
    const k = make({ species: strong, weight: 14, kids: true });
    expect(run(k, 60, 2.6, 0.45)).not.toBe("break");
  });
  it("tension rises with reel speed and a bigger fish pulls harder", () => {
    const a = make({ weight: 1 });
    const b = make({ weight: 8 });
    run(a, 1.5, 1);
    run(b, 1.5, 1);
    expect(b.pull).toBeGreaterThan(a.pull);
    const slow = make();
    const fast = make();
    run(slow, 2, 0.2);
    run(fast, 2, 2.2);
    expect(fast.T).toBeGreaterThan(slow.T);
  });
  it("the fish tires over time and goes left and right", () => {
    const f = make();
    let minLat = 0;
    let maxLat = 0;
    for (let t = 0; t < 40; t += 0.016) {
      f.step(0.016, { crank: 0.8, pump: 0, reelMul: 1 });
      f.D = Math.max(f.D, 12);
      minLat = Math.min(minLat, f.lat);
      maxLat = Math.max(maxLat, f.lat);
    }
    expect(f.S).toBeLessThan(0.9);
    expect(minLat).toBeLessThan(-0.3);
    expect(maxLat).toBeGreaterThan(0.3);
  });
  it("strong fish leap sometimes", () => {
    let jumps = 0;
    const f = make({ species: SPECIES_BY_ID.dongpeshona, weight: 6, rng: seeded(3) });
    for (let t = 0; t < 200; t += 0.016) {
      f.D = 15;
      f.step(0.016, { crank: 0.5, pump: 0, reelMul: 1 });
      if (f.jumped) jumps++;
    }
    expect(jumps).toBeGreaterThan(0);
  });
  it("warning threshold for the partner line", () => {
    expect(lineInDanger(0.9)).toBe(true);
    expect(lineInDanger(0.5)).toBe(false);
  });
});

describe("scoring, co-op, duel and net help", () => {
  it("points follow the prototype formula; junk counts nothing for the basket", () => {
    expect(pointsFor(SPECIES_BY_ID.sazan, 3)).toBe(300);
    expect(pointsFor(SPECIES_BY_ID.oltin, 0.2)).toBe(240);
    expect(pointsFor(SPECIES_BY_ID.etik, 0.8)).toBe(10);
    expect(basketKg(SPECIES_BY_ID.etik, 0.8)).toBe(0);
    const t = emptyTally();
    addCatch(t, SPECIES_BY_ID.sazan, 3);
    addCatch(t, SPECIES_BY_ID.etik, 0.8);
    expect(t).toMatchObject({ score: 310, kg: 3, count: 1, best: 3 });
  });
  it("co-op goal is shared and finishes at 15 kg", () => {
    expect(coopProgress(7.5, 15)).toBe(0.5);
    expect(coopDone(14.9, 15)).toBe(false);
    expect(coopDone(15, 15)).toBe(true);
  });
  it("duel winner is decided by weight, then by score; equal = draw", () => {
    const a = { ...emptyTally(), kg: 5, score: 100 };
    const b = { ...emptyTally(), kg: 6.2, score: 50 };
    expect(duelWinner(a, b)).toBe(1);
    expect(duelWinner(b, a)).toBe(0);
    expect(duelWinner({ ...a, kg: 5 }, { ...b, kg: 5, score: 100 })).toBe(-1);
    expect(duelWinner({ ...a, kg: 5, score: 200 }, { ...b, kg: 5, score: 100 })).toBe(0);
  });
  it("net help works only in co-op, when the partner fights and the fish is within 5 m", () => {
    const ok = { mode: "birgalikda" as const, partnerFighting: true, partnerD: 4.5, helperPresent: true };
    expect(netHelpApplies(ok)).toBe(true);
    expect(netHelpApplies({ ...ok, partnerD: 5.5 })).toBe(false);
    expect(netHelpApplies({ ...ok, mode: "musobaqa" })).toBe(false);
    expect(netHelpApplies({ ...ok, mode: "yolgiz" })).toBe(false);
    expect(netHelpApplies({ ...ok, partnerFighting: false })).toBe(false);
    expect(netHelpApplies({ ...ok, helperPresent: false })).toBe(false);
  });
});

describe("net gesture", () => {
  const base = () => ({ ...emptyInput(), present: true, scale: 100, leftVisible: true, rightVisible: true, hipY: 400, shoulderY: 250 });
  it("both hands down, then both hands up within the window fires once", () => {
    const n = new NetDetector();
    expect(n.update(0.016, { ...base(), leftY: 410, rightY: 410 })).toBe(false);
    for (let i = 0; i < 10; i++) n.update(0.016, { ...base(), leftY: 410, rightY: 410 });
    expect(n.update(0.016, { ...base(), leftY: 200, rightY: 210 })).toBe(true);
    // not again immediately
    expect(n.update(0.016, { ...base(), leftY: 200, rightY: 210 })).toBe(false);
  });
  it("up without the down phase, one hand only, or too slow does not fire", () => {
    expect(new NetDetector().update(0.016, { ...base(), leftY: 200, rightY: 200 })).toBe(false);
    const n = new NetDetector();
    n.update(0.016, { ...base(), leftY: 410, rightY: 410 });
    expect(n.update(0.016, { ...base(), leftY: 200, rightY: 330 })).toBe(false);
    const slow = new NetDetector();
    slow.update(0.016, { ...base(), leftY: 410, rightY: 410 });
    for (let i = 0; i < 130; i++) slow.update(0.016, { ...base(), leftY: 330, rightY: 330 });
    expect(slow.update(0.016, { ...base(), leftY: 200, rightY: 200 })).toBe(false);
  });
});

describe("angler gestures (combined)", () => {
  it("rod angles follow the hand; cast then strike through the same detector", () => {
    const g = new AnglerGestures();
    const i = { ...emptyInput(), present: true, scale: 100, rodVisible: true, shoulderX: 500, shoulderY: 300, rodX: 560, rodY: 200, handUp: true };
    for (let k = 0; k < 30; k++) g.update(0.016, i, T, true, false);
    expect(g.out.pitch).toBeGreaterThan(35);
    expect(g.out.yawDeg).toBeGreaterThan(5);
    expect(g.out.armed).toBe(true);
    const r = g.update(0.016, { ...i, handUp: false, vy: 2 }, T, true, false);
    expect(r.cast).toBe(true);
    expect(r.castPower).toBeGreaterThan(0.5);
    // while waiting for the bite the same upward pull is a strike
    const s = g.update(0.016, { ...i, handUp: false, vy: -2 }, T, false, true);
    expect(s.strike).toBe(true);
    // but not when no bite is expected
    expect(g.update(0.5, { ...i, vy: -2 }, T, false, false).strike).toBe(false);
  });
  it("keyboard fallback", () => {
    const g = new AnglerGestures();
    const i = { ...emptyInput(), keySwing: true, keyReel: true };
    const o = g.update(0.016, i, T, true, false);
    expect(o.cast).toBe(true);
    for (let k = 0; k < 40; k++) g.update(0.016, i, T, false, false);
    expect(g.out.crank).toBeGreaterThan(1);
  });
});

describe("Verlet line", () => {
  it("sags when slack and is straight when taut", () => {
    const l = new VerletLine({ segments: 28 });
    l.reset(0, 3, 0, 0, 0.1, -10);
    l.length = 11;
    l.surface = () => 0;
    for (let i = 0; i < 240; i++) l.step(1 / 60, 0, 3, 0, 0, 0.1, -10);
    const mid = l.n >> 1;
    const straightY = (3 + 0.1) / 2;
    expect(l.y[mid]).toBeLessThan(straightY - 0.05);
    expect(l.slack()).toBeGreaterThan(0.05);
    const t = new VerletLine({ segments: 28 });
    t.reset(0, 3, 0, 0, 0.1, -10);
    t.length = 10.3;
    for (let i = 0; i < 240; i++) t.step(1 / 60, 0, 3, 0, 0, 0.1, -10);
    expect(t.y[mid] - (3 + 0.1) / 2).toBeLessThan(0.15);
    expect(Math.abs(t.y[mid] - straightY)).toBeLessThan(0.3);
  });
  it("lying slack line stays on the water surface; trembling moves it", () => {
    const l = new VerletLine({ segments: 24 });
    l.reset(0, 3, 0, 0, 0, -20);
    l.length = 26;
    l.surface = () => 0;
    for (let i = 0; i < 300; i++) l.step(1 / 60, 0, 3, 0, 0, 0, -20);
    for (let i = 1; i < l.n - 1; i++) expect(l.y[i]).toBeGreaterThanOrEqual(0);
    const taut = new VerletLine({ segments: 24 });
    taut.reset(0, 3, 0, 0, 0, -20);
    taut.length = 20.3;
    for (let i = 0; i < 120; i++) taut.step(1 / 60, 0, 3, 0, 0, 0, -20, 1);
    const calm = new VerletLine({ segments: 24 });
    calm.reset(0, 3, 0, 0, 0, -20);
    calm.length = 20.3;
    for (let i = 0; i < 120; i++) calm.step(1 / 60, 0, 3, 0, 0, 0, -20, 0);
    let diff = 0;
    for (let i = 0; i < taut.n; i++) diff += Math.abs(taut.x[i] - calm.x[i]);
    expect(diff).toBeGreaterThan(0.01);
  });
  it("never produces NaN", () => {
    const l = new VerletLine({ segments: 20 });
    l.reset(0, 3, 0, 0, 0, 0);
    l.length = 0.5;
    for (let i = 0; i < 100; i++) l.step(1 / 60, 0, 3, 0, 0, 0, 0, 0.5);
    expect(l.x.every(Number.isFinite) && l.y.every(Number.isFinite)).toBe(true);
  });
});

describe("lake data", () => {
  it("bed gets deeper away from the shore, land is <= 0", () => {
    expect(bedDepth(LAKE, 0, 20)).toBeLessThanOrEqual(0);
    expect(bedDepth(LAKE, 0, 3)).toBeGreaterThan(0.5);
    expect(bedDepth(LAKE, 0, -40)).toBeGreaterThan(bedDepth(LAKE, 0, 3));
    expect(bedDepth(LAKE, 0, -40)).toBeLessThanOrEqual(LAKE.profile.maxDepth + 0.3);
  });
  it("waves are calmer near the shore and match across calls", () => {
    expect(shoreDamp(0.05)).toBeLessThan(shoreDamp(5));
    expect(WAVES).toHaveLength(4);
    expect(waveHeight(1, 2, 3, 1, 10)).toBe(waveHeight(1, 2, 3, 1, 10));
    let maxDeep = 0;
    let maxShallow = 0;
    for (let t = 0; t < 20; t += 0.1) {
      maxDeep = Math.max(maxDeep, Math.abs(waveHeight(3, -5, t, 1, 10)));
      maxShallow = Math.max(maxShallow, Math.abs(waveHeight(3, -5, t, 1, 0.1)));
    }
    expect(maxShallow).toBeLessThan(maxDeep);
  });
  it("weather: query overrides, otherwise random but valid", () => {
    const w = rollWeather(LAKE, seeded(4), { tod: "sunset", rain: "1", wind: "0.2" });
    expect(w).toEqual({ tod: "sunset", rain: true, wind: 0.2 });
    const r = rollWeather(LAKE, seeded(9), {});
    expect(["dawn", "day", "sunset"]).toContain(r.tod);
    expect(r.wind).toBeGreaterThanOrEqual(0);
    expect(r.wind).toBeLessThanOrEqual(1);
  });
});

describe("fish AI", () => {
  const depthFn = (x: number, z: number) => bedDepth(LAKE, x, z);
  const mkSim = (seed = 7) => {
    const env: WorldEnv = { depth: depthFn, minX: -30, maxX: 30, minZ: -50, maxZ: 6, rng: seeded(seed), activity: 1 };
    return new FishSim(env, 14, 4);
  };
  const bait = (x = 0, z = -15): Bait => ({ active: true, x, z, hookDepth: 0.9, disturb: 0 });

  it("ambient fish stay inside the lake area and at their species depth", () => {
    const sim = mkSim();
    sim.populate([0, 1, 4, 5, 6, 9, 3], 0, -15, 20);
    expect(sim.agents.filter((a) => a.active).length).toBeGreaterThan(6);
    const baits = [bait(500, 500)];
    baits[0].active = false;
    for (let i = 0; i < 60 * 40; i++) sim.step(1 / 60, baits);
    for (const a of sim.agents) {
      if (!a.active) continue;
      expect(a.x).toBeGreaterThan(-31);
      expect(a.x).toBeLessThan(31);
      expect(a.z).toBeGreaterThan(-52);
      expect(a.z).toBeLessThan(8);
      const d = depthFn(a.x, a.z);
      expect(a.y).toBeLessThan(0);
      expect(-a.y).toBeLessThanOrEqual(Math.max(0.3, d));
    }
  });

  it("schools hold together", () => {
    const sim = mkSim(3);
    sim.populate([9], 0, -15, 10); // karas school of 4
    const school = sim.agents.filter((a) => a.active && a.school >= 0);
    expect(school.length).toBeGreaterThan(2);
    const off = [bait(500, 500)];
    off[0].active = false;
    for (let i = 0; i < 60 * 30; i++) sim.step(1 / 60, off);
    let maxD = 0;
    for (const a of school) for (const b of school) maxD = Math.max(maxD, Math.hypot(a.x - b.x, a.z - b.z));
    expect(maxD).toBeLessThan(20);
  });

  it("a visitor approaches the bait, nibbles 1-3 times and then bites", () => {
    const sim = mkSim(11);
    const log: string[] = [];
    sim.onEvent = (e) => log.push(e);
    const b = [bait(0, -12)];
    const a = sim.sendVisitor(0, b[0], 1, 3)!;
    expect(a).not.toBeNull();
    expect(a.visitor).toBe(true);
    const d0 = Math.hypot(a.x, a.z + 12);
    expect(d0).toBeGreaterThan(1);
    let t = 0;
    while (t < 40 && !log.includes("bite")) {
      sim.step(1 / 60, b);
      t += 1 / 60;
    }
    expect(log.includes("bite")).toBe(true);
    const nib = log.filter((e) => e === "nibble").length;
    expect(nib).toBeGreaterThanOrEqual(1);
    expect(nib).toBeLessThanOrEqual(3);
    expect(Math.hypot(a.x - 0, a.z + 12)).toBeLessThan(1.5);
    expect(a.state).toBe(AState.Bite);
  });

  it("a disturbed bait or a splash scares fish away; hooked fish are not touched", () => {
    const sim = mkSim(5);
    const b = [bait(0, -12)];
    const a = sim.sendVisitor(0, b[0], 1, 3)!;
    for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60, b);
    const scared = sim.scare(a.x, a.z, 3);
    expect(scared).toBeGreaterThan(0);
    expect(a.state).toBe(AState.Scared);
    const x0 = a.x;
    const z0 = a.z;
    for (let i = 0; i < 60; i++) sim.step(1 / 60, b);
    expect(Math.hypot(a.x - b[0].x, a.z - b[0].z)).toBeGreaterThan(Math.hypot(x0 - b[0].x, z0 - b[0].z));
    const h = sim.sendVisitor(0, b[0], 0, 2)!;
    sim.hook(h);
    expect(sim.scare(h.x, h.z, 50)).toBeGreaterThanOrEqual(0);
    expect(h.state).toBe(AState.Hooked);
  });

  it("a junk visitor sits on the bed under the bait", () => {
    const sim = mkSim(2);
    const b = [bait(2, -10)];
    const a = sim.sendVisitor(0, b[0], 11, 0.8, true)!;
    expect(Math.hypot(a.x - 2, a.z + 10)).toBeLessThan(0.01);
    expect(a.state).toBe(AState.Sniff);
  });
});

describe("collection (encyclopedia)", () => {
  const mem = () => {
    const m: Record<string, string> = {};
    return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => void (m[k] = v) };
  };
  it("new species, repeat catches and records", () => {
    const c: Collection = {};
    expect(recordCatch(c, SPECIES_BY_ID.sazan, 2, 1)).toEqual({ isNew: true, isRecord: true });
    expect(recordCatch(c, SPECIES_BY_ID.sazan, 1.5, 2)).toEqual({ isNew: false, isRecord: false });
    expect(recordCatch(c, SPECIES_BY_ID.sazan, 3.1, 3)).toEqual({ isNew: false, isRecord: true });
    expect(c.sazan).toMatchObject({ count: 3, record: 3.1, first: 1 });
    expect(collectionSize(c)).toBe(1);
  });
  it("is saved to and restored from storage; broken data gives an empty collection", () => {
    const s = mem();
    const c: Collection = {};
    recordCatch(c, SPECIES_BY_ID.forel, 1.2, 5);
    saveCollection(c, s);
    expect(loadCollection(s).forel.record).toBe(1.2);
    s.setItem("harakat.baliq-ovi.collection", "{not json");
    expect(loadCollection(s)).toEqual({});
  });
});

describe("assets.json fallback", () => {
  const m: Manifest = { root: "/m/", models: { a: { path: "a.glb", present: false }, b: { path: "b.glb", present: true } }, textures: {}, sounds: { s: { path: "/audio/s.ogg", present: true } } };
  it("returns null for missing assets and a URL once delivered", async () => {
    expect(assetUrl("models", "a", m)).toBeNull();
    expect(assetUrl("models", "zzz", m)).toBeNull();
    expect(assetUrl("models", "b", m)).toBe("/m/b.glb");
    expect(assetUrl("sounds", "s", m)).toBe("/audio/s.ogg");
    expect(await new AssetLib(m).model("a")).toBeNull();
  });
});
