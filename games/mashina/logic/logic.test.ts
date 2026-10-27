// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CONTROL_DEFAULTS, DRIFT_DEFAULTS, RULE_DEFAULTS } from "../config";
import { buildLayout, type RuleDef } from "../world/layout";
import { DriftScorer } from "./drift";
import { InputMapper, newControls, type BodyLike } from "./input";
import { MISSIONS, MissionRunner, type MissionEvent } from "./modes";
import { Picker } from "./picker";
import { ExamScorer, RulesEngine, type RuleContext, type Verdict } from "./rules";
import { cycleLength, lightColor, timeToChange } from "./signals";
import { axleGrip } from "./tyre";
import { laneAssist } from "./assist";
import { CARS } from "../config";

const L = buildLayout();

// ---------------------------------------------------------------------------------------------------- signals
describe("traffic light phases", () => {
  it("never shows green to both axes, and always passes through yellow before red", () => {
    const len = cycleLength();
    let prev = lightColor(0, "x");
    for (let t = 0; t < len * 2; t += 0.05) {
      const a = lightColor(t, "x");
      const b = lightColor(t, "z");
      expect(a === "green" && b === "green").toBe(false);
      if (prev === "green" && a === "red") throw new Error("green -> red without yellow at " + t);
      prev = a;
    }
  });
  it("offset shifts the cycle and timeToChange is consistent", () => {
    expect(lightColor(0, "x", 0)).toBe("green");
    expect(lightColor(0, "z", 0)).toBe("red");
    expect(lightColor(14.5, "x")).toBe("yellow");
    expect(lightColor(17.5, "x")).toBe("red");
    expect(lightColor(17.5 + 18.5, "x")).toBe("red");
    expect(lightColor(37, "x")).toBe("green");
    expect(timeToChange(10, "x")).toBeCloseTo(4);
    expect(lightColor(0, "x", 20)).toBe("red");
  });
});

// ---------------------------------------------------------------------------------------------------- rules
function harness(opts: { light?: "red" | "green" | "yellow"; pedsOnRoad?: boolean; pedsActive?: boolean; cross?: boolean } = {}) {
  const verdicts: Verdict[] = [];
  const ctx: RuleContext = {
    lightColor: () => opts.light ?? "green",
    pedsOnRoad: () => !!opts.pedsOnRoad,
    pedsActive: () => !!opts.pedsActive || !!opts.pedsOnRoad,
    crossTraffic: () => !!opts.cross,
  };
  const eng = new RulesEngine(L, ctx, (v) => verdicts.push(v));
  return { eng, verdicts };
}

/** Drive along `def` (towards it) from `from` m before the line to `to` m after, with the speed profile v(along). */
function approach(eng: RulesEngine, def: RuleDef, from: number, to: number, v: (along: number) => number): void {
  let along = from;
  const dt = 1 / 30;
  while (along < to) {
    const sp = v(along);
    along += sp * dt;
    eng.update(dt, { x: def.x + def.dx * along, z: def.z + def.dz * along, speed: sp, fx: def.dx, fz: def.dz, onRoad: true, grounded: true });
  }
}
const def = (id: string): RuleDef => L.rules.find((r) => r.id === id)!;

describe("rules engine", () => {
  it("layout has lights, stop, give way and zebra definitions", () => {
    expect(L.rules.filter((r) => r.type === "light").length).toBeGreaterThan(8);
    expect(L.rules.some((r) => r.type === "stop")).toBe(true);
    expect(L.rules.some((r) => r.type === "giveWay")).toBe(true);
    expect(L.rules.some((r) => r.type === "zebra")).toBe(true);
    expect(L.lights.length).toBe(L.rules.filter((r) => r.type === "light").length);
  });

  it("running a red light is reported, passing on green is not", () => {
    const d = def("1,1:s");
    expect(d.type).toBe("light");
    const red = harness({ light: "red" });
    approach(red.eng, d, -40, 12, () => 12);
    expect(red.verdicts.map((v) => v.kind)).toContain("redLight");
    const green = harness({ light: "green" });
    approach(green.eng, d, -40, 12, () => 12);
    expect(green.verdicts.filter((v) => !v.ok)).toEqual([]);
  });

  it("stopping at a red light and leaving on green is rewarded", () => {
    const d = def("1,1:s");
    let light: "red" | "green" = "red";
    const verdicts: Verdict[] = [];
    const eng = new RulesEngine(L, { lightColor: () => light, pedsOnRoad: () => false, pedsActive: () => false, crossTraffic: () => false }, (v) => verdicts.push(v));
    approach(eng, d, -40, -4, (a) => Math.max(0, Math.min(10, -a - 3) * 1));
    for (let i = 0; i < 60; i++) eng.update(1 / 30, { x: d.x + d.dx * -3.5, z: d.z + d.dz * -3.5, speed: 0, fx: d.dx, fz: d.dz, onRoad: true, grounded: true });
    light = "green";
    approach(eng, d, -3.5, 10, () => 6);
    expect(verdicts.map((v) => v.kind)).toEqual(["lightOk"]);
  });

  it("STOP: rolling through is a violation, a full stop is fine", () => {
    const d = def("1,2:s");
    expect(d.type).toBe("stop");
    const bad = harness();
    approach(bad.eng, d, -50, 10, () => 6);
    expect(bad.verdicts.map((v) => v.kind)).toEqual(["stop"]);
    const good = harness();
    // slow to a crawl (<1.5 m/s) near the line, then continue
    approach(good.eng, d, -50, 10, (a) => (a > -12 && a < -6 ? 0.8 : 7));
    expect(good.verdicts.map((v) => v.kind)).toEqual(["stopOk"]);
  });

  it("give way only matters when traffic is on the cross street", () => {
    const d = L.rules.find((r) => r.type === "giveWay")!;
    const quiet = harness({ cross: false });
    approach(quiet.eng, d, -40, 10, () => 8);
    expect(quiet.verdicts).toEqual([]);
    const busy = harness({ cross: true });
    approach(busy.eng, d, -40, 10, () => 8);
    expect(busy.verdicts.map((v) => v.kind)).toEqual(["giveWay"]);
    const polite = harness({ cross: true });
    approach(polite.eng, d, -40, 10, (a) => (a > -10 && a < 3 ? 2 : 8));
    expect(polite.verdicts.map((v) => v.kind)).toEqual(["giveWayOk"]);
  });

  it("pedestrian on the crossing: violation; a clear crossing after pedestrians left: thanks", () => {
    const d = L.rules.find((r) => r.type === "zebra")!;
    const hit = harness({ pedsOnRoad: true });
    approach(hit.eng, d, -40, 8, () => 9);
    expect(hit.verdicts.map((v) => v.kind)).toEqual(["pedestrian"]);
    const ok = harness({ pedsActive: true, pedsOnRoad: false });
    approach(ok.eng, d, -40, 8, () => 9);
    expect(ok.verdicts.map((v) => v.kind)).toEqual(["pedOk"]);
    const none = harness();
    approach(none.eng, d, -40, 8, () => 9);
    expect(none.verdicts).toEqual([]);
  });

  it("speed: over limit + 10 km/h for 1.5 s is reported once per 6 s; within tolerance is not", () => {
    const t = L.tiles.get("2,1")!;
    const { eng, verdicts } = harness();
    const at = (speedKmh: number, secs: number) => {
      for (let i = 0; i < secs * 30; i++) eng.update(1 / 30, { x: t.cx - 40, z: t.cz + 1.8, speed: speedKmh / 3.6, fx: 1, fz: 0, onRoad: true, grounded: true });
    };
    at(69, 5); // 60 + 10 tolerance -> fine
    expect(verdicts.filter((v) => v.kind === "speed")).toHaveLength(0);
    at(75, 1);
    expect(verdicts.filter((v) => v.kind === "speed")).toHaveLength(0);
    at(75, 1);
    expect(verdicts.filter((v) => v.kind === "speed")).toHaveLength(1);
    at(75, 3);
    expect(verdicts.filter((v) => v.kind === "speed")).toHaveLength(1);
    at(75, 5);
    expect(verdicts.filter((v) => v.kind === "speed")).toHaveLength(2);
    expect(eng.limit).toBe(60);
  });

  it("highway limit is 90 and the city exit without speeding is rewarded", () => {
    const { eng, verdicts } = harness();
    const t = L.tiles.get("3,1")!;
    for (let x = t.x0 + 90; x < t.x0 + 150; x += 1) eng.update(0.1, { x, z: t.cz + 1.8, speed: 15, fx: 1, fz: 0, onRoad: true, grounded: true });
    expect(verdicts.map((v) => v.kind)).toEqual(["cityOk"]);
    expect(eng.limit).toBe(90);
  });

  it("wrong way on the one-way street and stopping where it is forbidden", () => {
    const ow = L.oneWays[0];
    const { eng, verdicts } = harness();
    for (let i = 0; i < 60; i++) eng.update(0.05, { x: (ow.x0 + ow.x1) / 2, z: ow.z0 + 5, speed: 6, fx: -1, fz: 0, onRoad: true, grounded: true });
    expect(verdicts.map((v) => v.kind)).toContain("wrongWay");
    const ns = L.noStops[0];
    const h2 = harness();
    for (let i = 0; i < 160; i++) h2.eng.update(0.05, { x: (ns.x0 + ns.x1) / 2, z: (ns.z0 + ns.z1) / 2, speed: 0, fx: 0, fz: -1, onRoad: true, grounded: true });
    expect(h2.verdicts.map((v) => v.kind)).toContain("noStop");
  });
});

describe("exam scoring", () => {
  const v = (e: RulesEngine | null, kind: Parameters<RulesEngine["report"]>[0]): Verdict => {
    void e;
    return { kind, ok: false, text: "", score: 0, penalty: RULE_DEFAULTS.penalty[kind as keyof typeof RULE_DEFAULTS.penalty] ?? 0 };
  };
  it("a clean drive passes", () => {
    const ex = new ExamScorer();
    const r = ex.result(true);
    expect(r.passed).toBe(true);
    expect(r.lines[0][1]).toBe("O‘tdi");
  });
  it("small mistakes within the limit pass, too many points fail", () => {
    const a = new ExamScorer();
    a.add(v(null, "speed"));
    a.add(v(null, "noStop"));
    expect(a.result(true).passed).toBe(true); // 3 + 2 = 5 <= 8
    a.add(v(null, "speed"));
    a.add(v(null, "speed"));
    const r = a.result(true);
    expect(r.passed).toBe(false);
    expect(r.reasons.join()).toContain("Jarima ball");
  });
  it("a red light, a skipped STOP or a pedestrian fail at once; an unfinished route fails", () => {
    for (const k of ["redLight", "stop", "pedestrian", "pedHit"] as const) {
      const ex = new ExamScorer();
      ex.add(v(null, k));
      expect(ex.result(true).passed).toBe(false);
      expect(ex.result(true).gross).toContain(k);
    }
    expect(new ExamScorer().result(false).passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------- drift
describe("drift score", () => {
  const run = (d: DriftScorer, secs: number, slipDeg: number, speed: number, inZone = true, grounded = true) => {
    for (let i = 0; i < secs * 60; i++) d.update(1 / 60, (slipDeg * Math.PI) / 180, speed, grounded, inZone);
  };
  it("gives nothing for driving straight or slowly", () => {
    const d = new DriftScorer();
    run(d, 3, 3, 20);
    run(d, 3, 40, 3);
    expect(d.score).toBe(0);
  });
  it("angle x speed x time, banked after the grace period", () => {
    const d = new DriftScorer();
    run(d, 1, 30, 15);
    const chain = d.score;
    expect(chain).toBeGreaterThan(15); // 30 deg * 15 m/s * 1 s * k(0.05) = 22
    expect(chain).toBeLessThan(30);
    expect(d.total).toBe(0);
    run(d, 2, 0, 15);
    expect(d.total).toBe(chain);
    expect(d.chains).toBe(1);
  });
  it("bigger angle and higher speed score more; the combo grows with a long chain", () => {
    const a = new DriftScorer();
    run(a, 2, 20, 12);
    const b = new DriftScorer();
    run(b, 2, 50, 20);
    expect(b.score).toBeGreaterThan(a.score * 2);
    const c = new DriftScorer();
    run(c, 10, 30, 15);
    expect(c.combo).toBe(1 + Math.floor(10 / DRIFT_DEFAULTS.comboEvery));
    const flat = new DriftScorer();
    run(flat, 3, 30, 15);
    expect(c.score).toBeGreaterThan(flat.score * 3.3);
  });
  it("a crash or leaving the drift area loses the running chain; jumps do not count", () => {
    const d = new DriftScorer();
    run(d, 2, 40, 15);
    const lost: number[] = [];
    const d2 = new DriftScorer(DRIFT_DEFAULTS, { lost: (p) => lost.push(p) });
    run(d2, 2, 40, 15);
    d2.crash();
    expect(d2.total).toBe(0);
    expect(lost[0]).toBeGreaterThan(0);
    const d3 = new DriftScorer();
    run(d3, 2, 40, 15, true, false);
    expect(d3.score).toBe(0);
    const d4 = new DriftScorer();
    run(d4, 1, 40, 15);
    run(d4, 0.1, 40, 15, false);
    expect(d4.total).toBe(0);
  });
  it("tyre model: handbrake takes grip from the rear only; sport lets go earlier than sedan", () => {
    const base = { surface: 1, wet: 0, throttle: 0.8, slip: 0.1, speed: 18 };
    const sedan = axleGrip({ ...base, car: CARS.sedan, handbrake: false });
    const sedanHb = axleGrip({ ...base, car: CARS.sedan, handbrake: true });
    const sport = axleGrip({ ...base, car: CARS.sport, handbrake: false });
    expect(sedanHb.rear).toBeLessThan(sedan.rear * 0.7);
    expect(sedanHb.front).toBeCloseTo(sedan.front);
    expect(sport.rear / sport.front).toBeLessThan(sedan.rear / sedan.front);
    const wet = axleGrip({ ...base, car: CARS.sedan, handbrake: false, wet: 1 });
    expect(wet.front).toBeLessThan(sedan.front);
  });
});

// ---------------------------------------------------------------------------------------------------- input
/** A standing body: hips at y 400, the knee `lift` (0..1) raised the way the prototype formula measures it, the ankle follows by half. */
const REST = 0.62;
const kneeY = (lift: number, rest = REST): number => 400 + 160 * rest * (1 - 0.8 * (lift === 0 ? 0 : 0.12 + lift * 0.88));
const ankleY = (lift: number, rest = REST): number => 400 + 160 * (rest + 0.6) - 0.5 * (400 + 160 * rest - kneeY(lift, rest));

interface BodyOpts {
  gas?: number;
  brake?: number;
  lw?: [number, number];
  rw?: [number, number];
  up?: boolean;
  rest?: number;
  /** rest height of the right leg as a fraction of the left one (an asymmetric stance) */
  restR?: number;
  /** override the visibility of the landmarks (index -> v) */
  vis?: Record<number, number>;
  /** knee labels swapped (the model puts the right knee on the left label) */
  swap?: boolean;
}

function body(over: BodyOpts = {}): BodyLike {
  const lm = Array.from({ length: 33 }, () => ({ x: 640, y: 400, v: 0.99 }));
  const rest = over.rest ?? REST;
  const restR = rest * (over.restR ?? 1);
  // the stage is mirrored: the player's left side is on the left of the picture (smaller x)
  lm[23] = { x: 580, y: 400, v: 0.99 };
  lm[24] = { x: 700, y: 400, v: 0.99 };
  lm[25] = { x: 580, y: kneeY(over.brake ?? 0, rest), v: 0.99 };
  lm[26] = { x: 700, y: kneeY(over.gas ?? 0, restR), v: 0.99 };
  lm[27] = { x: 580, y: ankleY(over.brake ?? 0, rest), v: 0.99 };
  lm[28] = { x: 700, y: ankleY(over.gas ?? 0, restR), v: 0.99 };
  if (over.swap) {
    for (const [a, b] of [[25, 26], [27, 28]]) [lm[a], lm[b]] = [lm[b], lm[a]];
  }
  const [lwx, lwy] = over.lw ?? [540, 300];
  const [rwx, rwy] = over.rw ?? [740, 300];
  lm[15] = { x: lwx, y: lwy, v: 0.99 };
  lm[16] = { x: rwx, y: rwy, v: 0.99 };
  for (const [i, v] of Object.entries(over.vis ?? {})) lm[Number(i)].v = v;
  return { present: true, scale: 160, lm, gestures: { handsAboveHead: !!over.up } };
}
const K = new Set<string>();
function drive(m: InputMapper, b: BodyLike | null, secs: number, speed = 0, keys: ReadonlySet<string> = K) {
  const out = newControls();
  for (let i = 0; i < secs * 60; i++) m.update(1 / 60, b, keys, null, speed, 720, out);
  return out;
}

/** a mapper whose pedals are calibrated (the player stood on both legs for a moment, like in the menu) */
const ready = (kids = false, seated = false): InputMapper => {
  const m = new InputMapper(CONTROL_DEFAULTS, { seated, kids, handbrakeSide: "R" });
  if (seated) drive(m, seatedBody(0, 0), 1.3);
  else drive(m, body(), 1.3);
  return m;
};
/** a seated body: hips level with the knees, lift in body scales (160 px) */
function seatedBody(kr: number, kl: number): BodyLike {
  const b = body();
  b.lm[23] = { x: 580, y: 500, v: 0.9 };
  b.lm[24] = { x: 700, y: 500, v: 0.9 };
  b.lm[25] = { x: 580, y: 508 - kl * 48, v: 0.9 };
  b.lm[26] = { x: 700, y: 508 - kr * 48, v: 0.9 };
  b.lm[27].v = b.lm[28].v = 0.1;
  return b;
}

describe("input mapping", () => {
  it("pedals read 0 during the 1 s calibration, then right knee = proportional gas, left knee = brake", () => {
    const m = new InputMapper();
    // the very first half second: the progress shows, nothing fires
    const early = drive(m, body(), 0.5);
    expect(early.legsReady).toBe(false);
    expect(early.legsCalib).toBeGreaterThan(0.3);
    expect(drive(m, body(), 0.8).legsReady).toBe(true);
    const half = drive(m, body({ gas: 0.5 }), 0.5);
    expect(half.gas).toBeCloseTo(0.5, 1);
    expect(half.brake).toBeLessThan(0.05);
    const br = drive(m, body({ gas: 0, brake: 1 }), 0.5);
    expect(br.brake).toBeGreaterThan(0.95);
    expect(br.gas).toBeLessThan(0.05);
  });

  it("raised-leg start: the standing leg gives the rest height, the raised knee reads gas, nothing else fires", () => {
    const m = new InputMapper();
    const first = newControls();
    m.update(1 / 30, body({ gas: 0.9 }), K, null, 0, 720, first);
    expect(first.gas).toBe(0); // not decided yet
    const settled = drive(m, body({ gas: 0.9 }), 1.2);
    expect(settled.gas).toBeGreaterThan(0.8);
    expect(settled.brake).toBeLessThan(0.05); // the standing left leg is NOT mistaken for a lift
    // the raised leg is put down: back to zero, and the pedals still work afterwards
    expect(drive(m, body(), 1.5).gas).toBeLessThan(0.05);
    expect(drive(m, body({ brake: 1 }), 0.4).brake).toBeGreaterThan(0.9);
    expect(drive(m, body(), 0.5).gas).toBeLessThan(0.05);
    expect(drive(m, body({ gas: 1 }), 0.4).gas).toBeGreaterThan(0.9);
  });

  it("start-up nonsense (landmarks still settling) does not stick: nothing fires afterwards", () => {
    const m = new InputMapper();
    const out = newControls();
    for (let i = 0; i < 12; i++) m.update(1 / 30, body({ rest: 0.95 }), K, null, 0, 720, out);
    const after = drive(m, body(), 3);
    expect(after.gas).toBeLessThan(0.05);
    expect(after.brake).toBeLessThan(0.05);
  });

  it("the wrong leg does not gas: left knee up never moves the gas pedal, not even with an asymmetric stance", () => {
    for (const restR of [1, 0.86, 0.8]) {
      const m = new InputMapper();
      drive(m, body({ restR }), 1.3);
      let maxGas = 0;
      const out = newControls();
      const seq = [body({ restR }), body({ brake: 1, restR }), body({ brake: 0.5, restR }), body({ restR })];
      for (const b of seq) {
        for (let i = 0; i < 90; i++) {
          m.update(1 / 60, b, K, null, 0, 720, out);
          maxGas = Math.max(maxGas, out.gas);
        }
      }
      expect(maxGas, `restR ${restR}`).toBeLessThan(0.01);
    }
  });

  it("occlusion and low confidence give 0, never an automatic gas afterwards", () => {
    const m = ready();
    expect(drive(m, body({ gas: 1 }), 0.5).gas).toBeGreaterThan(0.9);
    const hidden = drive(m, body({ gas: 1, vis: { 26: 0.1 } }), 0.4);
    expect(hidden.gas).toBeLessThan(0.02);
    expect(hidden.okGas).toBe(false);
    expect(hidden.legsOk).toBe(false);
    expect(drive(m, body({ gas: 1, vis: { 24: 0.2 } }), 0.4).gas).toBeLessThan(0.02);
    const back = drive(m, body(), 3);
    expect(back.gas).toBeLessThan(0.02);
    expect(back.brake).toBeLessThan(0.02);
    // a player who is not in the picture: pedals 0
    const none = newControls();
    for (let i = 0; i < 60; i++) m.update(1 / 60, null, K, null, 0, 720, none);
    expect(none.gas).toBeLessThan(1e-3);
    expect(none.brake).toBeLessThan(1e-3);
    // legs never visible: never calibrated, never a pedal
    const blind = new InputMapper();
    const out = drive(blind, body({ vis: { 23: 0.1, 24: 0.1, 25: 0.1, 26: 0.1, 27: 0.1, 28: 0.1 } }), 5);
    expect(out.legsReady).toBe(false);
    expect(out.gas).toBe(0);
    expect(out.legsOk).toBe(false);
  });

  it("swapped knee labels are resolved by position: the right knee up is still the gas", () => {
    const m = ready();
    const g = drive(m, body({ gas: 1, swap: true }), 0.5);
    expect(g.gas).toBeGreaterThan(0.9);
    expect(g.brake).toBeLessThan(0.02);
  });

  it("seated mode: knee lift relative to the hip; right = gas, left = brake, raised-right start works, wrong leg does not gas", () => {
    const m = ready(false, true);
    expect(drive(m, seatedBody(1, 0), 0.5).gas).toBeGreaterThan(0.8);
    expect(drive(m, seatedBody(0, 0), 0.6).gas).toBeLessThan(0.02);
    const b = drive(m, seatedBody(0, 1), 0.5);
    expect(b.brake).toBeGreaterThan(0.8);
    expect(b.gas).toBeLessThan(0.02);
    // started with the right knee raised (left knee down)
    const m2 = new InputMapper(CONTROL_DEFAULTS, { seated: true, kids: false, handbrakeSide: "R" });
    const a = drive(m2, seatedBody(1, 0), 1.2);
    expect(a.gas).toBeGreaterThan(0.8);
    expect(a.brake).toBeLessThan(0.05);
    expect(drive(m2, seatedBody(0, 0), 0.6).gas).toBeLessThan(0.02);
    expect(drive(m2, seatedBody(1, 0), 0.5).gas).toBeGreaterThan(0.8);
    // switching standing <-> seated calibrates again; asking for the same mode again (every menu frame) does not
    m2.setOptions({ seated: true });
    expect(drive(m2, seatedBody(0, 0), 0.1).legsReady).toBe(true);
    m2.setOptions({ seated: false });
    expect(drive(m2, body(), 0.1).legsReady).toBe(false);
  });

  it("two hands on an imaginary wheel steer: right hand lower = right, with a dead zone", () => {
    const m = ready();
    expect(Math.abs(drive(m, body(), 0.6).steer)).toBeLessThan(0.02);
    const right = drive(m, body({ lw: [540, 300 - 100], rw: [740, 300 + 100] }), 0.8); // 45 deg
    expect(right.steer).toBeGreaterThan(0.6);
    const left = drive(m, body({ lw: [540, 300 + 100], rw: [740, 300 - 100] }), 0.8);
    expect(left.steer).toBeLessThan(-0.6);
    const tiny = drive(m, body({ lw: [540, 300 - 8], rw: [740, 300 + 8] }), 0.8); // ~4.6 deg < dead zone
    expect(Math.abs(tiny.steer)).toBeLessThan(0.02);
    const full = drive(m, body({ lw: [590, 200], rw: [690, 400] }), 0.8);
    expect(full.steer).toBeGreaterThan(0.99);
  });

  it("hands lost: the last angle is held briefly, then the wheel returns to the middle; hands together = no angle", () => {
    const m = ready();
    const turn = body({ lw: [590, 200], rw: [690, 400] });
    expect(drive(m, turn, 0.6).steer).toBeGreaterThan(0.9);
    const lost = body({ lw: [590, 200], rw: [690, 400], vis: { 15: 0.1, 16: 0.1 } });
    const out = newControls();
    for (let i = 0; i < 6; i++) m.update(1 / 60, lost, K, null, 5, 720, out); // 0.1 s: held
    expect(out.steer).toBeGreaterThan(0.85);
    expect(out.handsOk).toBe(false);
    expect(drive(m, lost, 1.5).steer).toBeLessThan(0.1);
    // back again: immediate
    expect(drive(m, turn, 0.3).steer).toBeGreaterThan(0.8);
    // both wrists almost on top of each other (the angle would be noise): treated as lost, not as a jump to +-90 degrees
    const together = drive(m, body({ lw: [640, 300], rw: [650, 330] }), 1.5);
    expect(Math.abs(together.steer)).toBeLessThan(0.1);
    expect(together.handsOk).toBe(false);
  });

  it("handbrake: right hand pulled sharply down while the left stays; slow steering does not trigger it", () => {
    const m = new InputMapper();
    const out = newControls();
    // slow wheel turn (0.4 H/s both hands in opposite directions)
    let hb = false;
    for (let i = 0; i < 60; i++) {
      const dy = i * 0.4 * 720 / 60 / 60;
      m.update(1 / 60, body({ lw: [540, 300 - dy], rw: [740, 300 + dy] }), K, null, 5, 720, out);
      hb = hb || out.handbrake;
    }
    expect(hb).toBe(false);
    // sharp pull: right wrist drops 130 px in 4 frames (~2 H/s), left stays
    const m2 = new InputMapper();
    let seen = false;
    for (let i = 0; i < 20; i++) {
      const y = i < 5 ? 300 : 300 + Math.min(i - 5, 4) * 32;
      m2.update(1 / 60, body({ rw: [740, y] }), K, null, 15, 720, out);
      seen = seen || out.handbrake;
    }
    expect(seen).toBe(true);
    // stays on for ~0.9 s then releases
    for (let i = 0; i < 20; i++) m2.update(1 / 60, body({ rw: [740, 428] }), K, null, 15, 720, out);
    expect(out.handbrake).toBe(true);
    for (let i = 0; i < 60; i++) m2.update(1 / 60, body({ rw: [740, 428] }), K, null, 15, 720, out);
    expect(out.handbrake).toBe(false);
  });

  it("reverse gear: brake held 1.5 s at a standstill toggles R; moving or a short press does not", () => {
    const m = ready();
    const b = body({ brake: 1 });
    expect(drive(m, b, 1.3, 0).reverse).toBe(false);
    const out = drive(m, b, 0.4, 0);
    expect(out.reverse).toBe(true);
    // release and hold again -> back to D
    drive(m, body(), 0.5, 0);
    expect(drive(m, b, 1.7, 0).reverse).toBe(false);
    // braking while rolling never selects R
    const m2 = ready();
    expect(drive(m2, b, 3, 8).reverse).toBe(false);
    // releasing before 1.5 s resets the timer
    const m3 = ready();
    drive(m3, b, 1.2, 0);
    drive(m3, body(), 0.2, 0);
    expect(drive(m3, b, 1.2, 0).reverse).toBe(false);
  });

  it("both hands above the head toggle the camera once, with a cooldown", () => {
    const m = new InputMapper();
    const out = newControls();
    let toggles = 0;
    const step = (up: boolean) => {
      m.update(1 / 60, body({ up }), K, null, 0, 720, out);
      if (out.camToggle) toggles++;
    };
    for (let i = 0; i < 30; i++) step(true);
    expect(toggles).toBe(1);
    for (let i = 0; i < 10; i++) step(false);
    for (let i = 0; i < 10; i++) step(true); // inside the cooldown
    expect(toggles).toBe(1);
    for (let i = 0; i < 120; i++) step(false);
    for (let i = 0; i < 10; i++) step(true);
    expect(toggles).toBe(2);
  });

  it("kids mode: automatic gas unless braking; keyboard and gamepad override", () => {
    const kids = ready(true);
    expect(drive(kids, body(), 0.5).gas).toBeCloseTo(CONTROL_DEFAULTS.kidsGas, 1);
    expect(drive(kids, body({ brake: 1 }), 0.5).gas).toBeLessThan(0.05);
    const m = new InputMapper();
    const keys = new Set(["ArrowUp", "ArrowRight"]);
    const out = drive(m, null, 0.6, 0, keys);
    expect(out.gas).toBeGreaterThan(0.95);
    expect(out.steer).toBeGreaterThan(0.95);
    expect(out.source).toBe("keys");
    const o2 = newControls();
    const pm = new InputMapper();
    for (let i = 0; i < 40; i++) pm.update(1 / 60, null, K, { axes: [-1, 0], buttons: Array.from({ length: 8 }, (_, k) => ({ value: k === 7 ? 1 : 0, pressed: k === 7 })) }, 0, 720, o2);
    expect(o2.source).toBe("pad");
    expect(o2.steer).toBeLessThan(-0.9);
    expect(o2.gas).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------------------------------- menu + missions
describe("picker", () => {
  it("left knee cycles, right knee held confirms, 4 steps", () => {
    const p = new Picker();
    const keys = new Set<string>();
    const none = { next: false, confirm: false };
    expect(p.choice.mode).toBe("erkin");
    p.update(0.016, 0, 1, keys, none);
    p.update(0.016, 0, 0, keys, none);
    expect(p.choice.mode).toBe("missiya");
    for (let i = 0; i < 60; i++) p.update(0.016, 1, 0, keys, none);
    expect(p.stepId).toBe("car");
    p.update(0.016, 0, 0, keys, none);
    p.update(0.016, 0, 1, keys, none);
    expect(p.choice.car).toBe("krossover");
    p.confirm();
    p.confirm();
    p.update(0.016, 0, 0, keys, none);
    p.update(0.016, 0, 1, keys, none);
    expect(p.choice.seated).toBe(true);
    p.confirm();
    expect(p.done).toBe(true);
  });
  it("keyboard digits pick a mode", () => {
    const p = new Picker();
    p.update(0.016, 0, 0, new Set(["3"]), { next: false, confirm: false });
    expect(p.choice.mode).toBe("imtihon");
  });
});

describe("missions", () => {
  const spots: Record<string, { x: number; z: number; r: number }> = { registon: { x: 0, z: 0, r: 10 }, yolovchi: { x: 100, z: 0, r: 5 }, bozor: { x: 200, z: 0, r: 8 }, aerodrom: { x: 500, z: 0, r: 20 } };
  it("reach mission completes inside the circle; ride needs a pickup stop and a delivery stop; timeouts fail", () => {
    const ev: MissionEvent[] = [];
    const r = new MissionRunner(MISSIONS, (id) => spots[id], (e) => ev.push(e));
    r.start();
    expect(r.current?.id).toBe("m1");
    r.update(1, 50, 0, 10);
    expect(ev.at(-1)?.type).toBe("start");
    r.update(1, 5, 0, 10);
    expect(ev.at(-1)?.type).toBe("start"); // now mission 2 started
    expect(r.current?.id).toBe("m2");
    expect(ev.filter((e) => e.type === "done")).toHaveLength(1);
    // driving through the pickup circle without stopping does nothing
    r.update(0.5, 100, 0, 10);
    expect(r.passenger).toBe(false);
    for (let i = 0; i < 30; i++) r.update(0.05, 100, 0, 0.2);
    expect(r.passenger).toBe(true);
    for (let i = 0; i < 30; i++) r.update(0.05, 200, 0, 0.2);
    expect(ev.filter((e) => e.type === "done")).toHaveLength(2);
    expect(r.current?.id).toBe("m3");
    r.update(500, 900, 0, 0);
    expect(ev.at(-1)?.type).toBe("fail");
    expect(r.allDone).toBe(true);
    expect(r.completed).toBe(2);
    expect(r.failed).toBe(1);
  });
});

describe("kids lane assist", () => {
  const t = L.tiles.get("2,1")!;
  const lane = t.cz + 1.8; // eastbound lane
  it("pushes back towards the lane centre and along the road; nothing when centred, slow, off road or in a junction", () => {
    expect(Math.abs(laneAssist(L, t.cx - 40, lane, 1, 0, 10))).toBeLessThan(0.01);
    // drifted to the right (south) of the lane while heading east: steer left (negative)
    expect(laneAssist(L, t.cx - 40, lane + 1.2, 1, 0, 10)).toBeLessThan(-0.05);
    // drifted left (north): steer right
    expect(laneAssist(L, t.cx - 40, lane - 1.2, 1, 0, 10)).toBeGreaterThan(0.05);
    // pointing towards the right kerb: steer left
    expect(laneAssist(L, t.cx - 40, lane, 0.98, 0.2, 10)).toBeLessThan(-0.05);
    // westbound uses the other lane (north side)
    expect(Math.abs(laneAssist(L, t.cx - 40, t.cz - 1.8, -1, 0, 10))).toBeLessThan(0.01);
    expect(laneAssist(L, t.cx - 40, t.cz - 1.8 - 1, -1, 0, 10)).toBeLessThan(-0.05);
    // northbound on the N-S street: its lane is on the east side (+x)
    expect(Math.abs(laneAssist(L, t.cx + 1.8, t.cz + 40, 0, -1, 10))).toBeLessThan(0.01);
    expect(laneAssist(L, t.cx + 1.8 + 1, t.cz + 40, 0, -1, 10)).toBeLessThan(-0.05);
    expect(laneAssist(L, t.cx - 40, lane + 1.2, 1, 0, 2)).toBe(0); // too slow
    expect(laneAssist(L, t.cx + 30, t.cz + 30, 1, 0, 10)).toBe(0); // off the road
    expect(laneAssist(L, t.cx, t.cz, 1, 0, 10)).toBe(0); // inside the junction
  });
});
