import { describe, expect, it } from "vitest";
import { AnglerGestures, emptyInput } from "./gestures";
import { CrankReel, SteerTracker } from "./handmotion";
import { castDistance, CastDetector, FightModel, strokePower, TUNING, type Tuning } from "./rules";
import { SPECIES_BY_ID } from "./species";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const T: Tuning = { kids: false, sensitivity: 1 };
const DT = 1 / 60;
/** body scales per screen height in these tests (a person about 3.5 shoulder widths tall in the picture's height) */
const SCALES_PER_H = 3.5;

// ---------------------------------------------------------------- the overhead cast

/** A forward stroke: half a sine of hand speed (screen heights / s, + = down) with the given peak, lasting `frames` frames. */
const strokeSpeeds = (peak: number, frames = 14): number[] => Array.from({ length: frames }, (_, i) => peak * Math.sin((Math.PI * (i + 0.5)) / frames));

/** Raise the hand (arm the detector), run `speeds`, then keep the hand still; returns the cast result if one fired. */
function swing(d: CastDetector, speeds: number[], opts: { raised?: boolean; aim?: number; tuning?: Tuning; rest?: number; armDt?: number } = {}) {
  const t = opts.tuning ?? T;
  let elev = 1.2;
  if (opts.raised !== false) d.update(opts.armDt ?? 0.5, true, 0, elev, 0, t);
  let hit: { power: number; aim: number; viaHand: boolean } | null = null;
  const run = (v: number) => {
    elev -= v * DT * SCALES_PER_H;
    const r = d.update(DT, false, v, elev, opts.aim ?? 0, t);
    if (r.fired) hit = { power: r.power, aim: r.aim, viaHand: r.viaHand };
  };
  speeds.forEach(run);
  for (let i = 0; i < (opts.rest ?? 30); i++) run(0);
  return hit as { power: number; aim: number; viaHand: boolean } | null;
}

describe("overhead cast: power from the arm speed", () => {
  it("a weak flick throws short, a strong one long, in between in between", () => {
    const weak = swing(new CastDetector(), strokeSpeeds(1.45));
    const mid = swing(new CastDetector(), strokeSpeeds(1.9));
    const strong = swing(new CastDetector(), strokeSpeeds(2.8));
    expect(weak && mid && strong).toBeTruthy();
    expect(weak!.viaHand).toBe(true);
    expect(weak!.power).toBeLessThan(mid!.power);
    expect(mid!.power).toBeLessThan(strong!.power);
    expect(strong!.power).toBe(1);
    // power follows the peak speed of the stroke
    expect(weak!.power).toBeCloseTo(strokePower(Math.max(...strokeSpeeds(1.45)), T), 5);
    const dist = (p: number) => castDistance(p, false, 36);
    expect(dist(weak!.power)).toBeLessThan(14);
    expect(dist(strong!.power)).toBeGreaterThan(34);
    expect(dist(mid!.power)).toBeGreaterThan(dist(weak!.power));
    expect(dist(mid!.power)).toBeLessThan(dist(strong!.power));
  });

  it("the aim is where the hand was during the stroke (left / right)", () => {
    const left = swing(new CastDetector(), strokeSpeeds(2), { aim: -0.8 });
    const right = swing(new CastDetector(), strokeSpeeds(2), { aim: 0.6 });
    expect(left!.aim).toBeCloseTo(-0.8, 5);
    expect(right!.aim).toBeCloseTo(0.6, 5);
  });

  it("the line is released at the end of the stroke, not at its start", () => {
    const d = new CastDetector();
    d.update(0.5, true, 0, 1.2, 0, T);
    let elev = 1.2;
    let firedAt = -1;
    strokeSpeeds(2.2, 16).forEach((v, i) => {
      elev -= v * DT * SCALES_PER_H;
      if (d.update(DT, false, v, elev, 0, T).fired) firedAt = i;
    });
    // after the peak (frame 8 of 16), once the speed has fallen
    expect(firedAt).toBeGreaterThan(8);
  });

  it("a hand merely resting or moving slowly never casts", () => {
    const d = new CastDetector();
    // arm raised and held for 5 s without moving
    for (let i = 0; i < 300; i++) expect(d.update(DT, true, 0, 1.2, 0, T).fired).toBe(false);
    // lowering the arm slowly (peak under the stroke speed)
    expect(swing(new CastDetector(), strokeSpeeds(0.9, 40))).toBeNull();
    // a lazy drop that passes the start speed but not the peak a real flick needs
    expect(swing(new CastDetector(), strokeSpeeds(1.15, 30))).toBeNull();
  });

  it("tracking noise does not cast: one-frame spikes, a short jerk, an unraised hand", () => {
    // spikes of speed while the hand stays in place
    const d = new CastDetector();
    d.update(0.5, true, 0, 1.2, 0, T);
    for (let i = 0; i < 90; i++) expect(d.update(DT, false, i % 6 === 0 ? 3 : 0, 1.2, 0, T).fired).toBe(false);
    // a short jerk: fast, but the hand comes down only a little
    const jerk = new CastDetector();
    jerk.update(0.5, true, 0, 1.2, 0, T);
    let fired = false;
    let elev = 1.2;
    [0.8, 1.6, 2.4, 1.2, 0.2, 0, 0, 0].forEach((v) => {
      elev -= v * DT * SCALES_PER_H * 0.5;
      fired = jerk.update(DT, false, v, elev, 0, T).fired || fired;
    });
    expect(fired).toBe(false);
    // a perfect stroke without raising the hand first
    expect(swing(new CastDetector(), strokeSpeeds(2.5), { raised: false })).toBeNull();
  });

  it("the raised hand is armed for a while only; casts are spaced by a cooldown", () => {
    const d = new CastDetector();
    d.update(0.5, true, 0, 1.2, 0, T);
    for (let i = 0; i < 120; i++) d.update(DT, false, 0, 1.2, 0, T);
    expect(d.armed).toBe(false);
    expect(swing(d, strokeSpeeds(2.5), { raised: false })).toBeNull();
    const c = new CastDetector();
    expect(swing(c, strokeSpeeds(2.2), { rest: 0 })).not.toBeNull();
    // right after: still in the cooldown
    expect(swing(c, strokeSpeeds(2.2), { rest: 0, armDt: DT })).toBeNull();
    expect(swing(c, strokeSpeeds(2.2), { armDt: 0.6 })).not.toBeNull();
  });

  it("the keyboard flick casts at once with a fixed power, not as a hand stroke", () => {
    const d = new CastDetector();
    const r = d.update(DT, false, 0, 0, 0.3, T, true);
    expect(r.fired).toBe(true);
    expect(r.power).toBe(TUNING.cast.keyPower);
    expect(r.viaHand).toBe(false);
  });

  it("kids and a higher sensitivity cast with a gentler stroke", () => {
    const soft = strokeSpeeds(1.0, 16);
    expect(swing(new CastDetector(), soft)).toBeNull();
    expect(swing(new CastDetector(), soft, { tuning: { kids: true, sensitivity: 1 } })).not.toBeNull();
    expect(swing(new CastDetector(), soft, { tuning: { kids: false, sensitivity: 1.5 } })).not.toBeNull();
  });
});

describe("overhead cast through the gestures", () => {
  const base = () => ({ ...emptyInput(), present: true, scale: 100, rodVisible: true, shoulderX: 500, shoulderY: 300, rodX: 540, handUp: true });
  /** hand above the shoulder, then a stroke of the given peak: returns the cast signal if it fired */
  function cast(peak: number, settle = 1, vis = true) {
    const g = new AnglerGestures();
    const i = { ...base(), rodVisible: vis, rodY: 100 };
    for (let k = 0; k < Math.round(settle * 60); k++) g.update(DT, i, T, true, false);
    let y = 100;
    let hit: { castPower: number; castAim: number; castHand: boolean } | null = null;
    for (const v of [...strokeSpeeds(peak), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) {
      y += v * DT * 360; // screen height 360 px
      const o = g.update(DT, { ...i, rodVisible: true, rodY: y, vy: v, handUp: y < 300 }, T, true, false);
      if (o.cast) hit = { castPower: o.castPower, castAim: o.castAim, castHand: o.castHand };
    }
    return hit;
  }
  it("a strong stroke casts with power and the aim of the hand; a weak one casts shorter", () => {
    const strong = cast(2.6);
    const weak = cast(1.45);
    expect(strong).not.toBeNull();
    expect(weak).not.toBeNull();
    expect(strong!.castHand).toBe(true);
    expect(strong!.castPower).toBeGreaterThan(weak!.castPower);
    expect(strong!.castAim).toBeCloseTo(0.4, 1); // (540 - 500) / 100: the hand is to the right of the shoulder
  });
  it("a hand that has just come back into view does not cast on its first jump", () => {
    const g = new AnglerGestures();
    const i = { ...base(), rodY: 100 };
    for (let k = 0; k < 30; k++) g.update(DT, { ...i, rodVisible: false, handUp: true }, T, true, false);
    let y = 100;
    let fired = false;
    for (const v of [...strokeSpeeds(2.6), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 10)) {
      y += v * DT * 360;
      fired = g.update(DT, { ...i, rodY: y, vy: v, handUp: y < 300 }, T, true, false).cast || fired;
    }
    expect(fired).toBe(false);
  });
  it("the rod lags behind the arm: armV follows the vertical hand speed", () => {
    const g = new AnglerGestures();
    for (let k = 0; k < 20; k++) g.update(DT, { ...base(), rodY: 200, vy: 2 }, T, false, false);
    expect(g.out.armV).toBeGreaterThan(1.5);
    for (let k = 0; k < 30; k++) g.update(DT, { ...base(), rodY: 200, vy: 0 }, T, false, false);
    expect(Math.abs(g.out.armV)).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------- the reel crank

/** Positions of a hand drawing circles: `dir` +1 = clockwise on the screen. Radius and speed in body scales / circles per second. */
function circle(reel: CrankReel, opts: { rate: number; dir?: 1 | -1; radius?: number; seconds: number; fps?: number; t0?: number; scale?: number; every?: number }) {
  const scale = opts.scale ?? 100;
  const fps = opts.fps ?? 60;
  const dir = opts.dir ?? 1;
  const R = (opts.radius ?? 0.3) * scale;
  const n = Math.round(opts.seconds * fps);
  let rate = 0;
  for (let k = 0; k < n; k++) {
    const t = (opts.t0 ?? 0) + k / fps;
    const a = dir * Math.PI * 2 * opts.rate * t;
    rate = reel.update(1 / fps, 300 + R * Math.cos(a), 200 + R * Math.sin(a), true, scale);
  }
  return rate;
}

describe("reel crank from the circling hand", () => {
  it("the reeling speed is proportional to the circle speed", () => {
    const at = (rate: number) => {
      const r = new CrankReel();
      circle(r, { rate, seconds: 3 });
      return r.rate;
    };
    const slow = at(0.8);
    const mid = at(1.6);
    const fast = at(2.4);
    expect(slow).toBeGreaterThan(0.6);
    expect(slow).toBeLessThan(1.0);
    expect(mid / slow).toBeGreaterThan(1.8);
    expect(mid / slow).toBeLessThan(2.2);
    expect(fast / slow).toBeGreaterThan(2.7);
    expect(fast).toBeLessThanOrEqual(TUNING.reel.max);
  });

  it("the sign says which way the hand turns", () => {
    const cw = new CrankReel();
    circle(cw, { rate: 1.2, dir: 1, seconds: 2 });
    expect(cw.omega).toBeGreaterThan(0.8);
    const ccw = new CrankReel();
    circle(ccw, { rate: 1.2, dir: -1, seconds: 2 });
    expect(ccw.omega).toBeLessThan(-0.8);
    expect(ccw.rate).toBeGreaterThan(0.8);
    // switching direction follows quickly
    circle(ccw, { rate: 1.2, dir: 1, seconds: 1.5, t0: 2 });
    expect(ccw.omega).toBeGreaterThan(0.8);
  });

  it("stopping the hand stops the reeling at once", () => {
    const r = new CrankReel();
    circle(r, { rate: 1.6, seconds: 3 });
    expect(r.rate).toBeGreaterThan(1.3);
    // the hand freezes at a point of its circle (a little tremor)
    const rng = seeded(4);
    const x = 300 + 30;
    const y = 200;
    let stoppedAfter = -1;
    for (let k = 0; k < 60; k++) {
      r.update(DT, x + (rng() - 0.5) * 1.5, y + (rng() - 0.5) * 1.5, true, 100);
      if (stoppedAfter < 0 && r.rate === 0) stoppedAfter = k + 1;
    }
    expect(stoppedAfter).toBeGreaterThan(0);
    expect(stoppedAfter * DT).toBeLessThan(0.25);
    expect(r.rate).toBe(0);
    // and it picks up again when the circling goes on
    circle(r, { rate: 1.6, seconds: 1.5, t0: 5 });
    expect(r.rate).toBeGreaterThan(1.2);
  });

  it("stops at once also when the hand leaves the picture", () => {
    const r = new CrankReel();
    circle(r, { rate: 1.6, seconds: 3 });
    for (let k = 0; k < 15; k++) r.update(DT, 0, 0, false, 100);
    expect(r.rate).toBe(0);
  });

  it("jitter, slow drift, tiny circles and back-and-forth wiggles do not reel", () => {
    const rng = seeded(9);
    const jitter = new CrankReel();
    let maxJ = 0;
    for (let k = 0; k < 600; k++) maxJ = Math.max(maxJ, jitter.update(DT, 300 + (rng() - 0.5) * 4, 200 + (rng() - 0.5) * 4, true, 100));
    expect(maxJ).toBe(0);
    const drift = new CrankReel();
    let maxD = 0;
    for (let k = 0; k < 600; k++) maxD = Math.max(maxD, drift.update(DT, 300 + k * 0.1, 200, true, 100));
    expect(maxD).toBe(0);
    const tiny = new CrankReel();
    circle(tiny, { rate: 2, radius: 0.06, seconds: 3 });
    expect(tiny.rate).toBe(0);
    const wiggle = new CrankReel();
    let maxW = 0;
    for (let k = 0; k < 600; k++) maxW = Math.max(maxW, wiggle.update(DT, 300 + 25 * Math.sin(k * DT * Math.PI * 2 * 2), 200 + (rng() - 0.5) * 2, true, 100));
    expect(maxW).toBeLessThan(TUNING.reel.on + 0.4);
  });

  it("works with a slow camera (repeated samples) and a big step between frames", () => {
    // 15 fps detection shown at 60 fps: every sample repeated 4 times
    const r = new CrankReel();
    const scale = 100;
    let rate = 0;
    for (let k = 0; k < 240; k++) {
      const tk = Math.floor(k / 4) / 15;
      const a = Math.PI * 2 * 1.5 * tk;
      rate = r.update(DT, 300 + 30 * Math.cos(a), 200 + 30 * Math.sin(a), true, scale);
    }
    expect(rate).toBeGreaterThan(1.1);
    expect(rate).toBeLessThan(1.9);
    // 5 fps (the game clock cannot see this, the real frame time can)
    const slow = new CrankReel();
    circle(slow, { rate: 1.0, seconds: 4, fps: 5 });
    expect(slow.rate).toBeGreaterThan(0.6);
  });

  it("the gestures turn the circle into the reel signals; the keyboard still reels", () => {
    const g = new AnglerGestures();
    const i = { ...emptyInput(), present: true, scale: 100, reelVisible: true };
    for (let k = 0; k < 180; k++) {
      const a = -Math.PI * 2 * 1.4 * k * DT;
      g.update(DT, { ...i, reelX: 300 + 30 * Math.cos(a), reelY: 200 + 30 * Math.sin(a), realDt: DT }, T, false, false);
    }
    expect(g.out.crank).toBeGreaterThan(1);
    expect(g.out.spin).toBeLessThan(-1); // counter-clockwise
    const k = new AnglerGestures();
    for (let n = 0; n < 40; n++) k.update(DT, { ...emptyInput(), keyReel: true }, T, false, false);
    expect(k.out.crank).toBeGreaterThan(1);
    expect(k.out.spin).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------- steering and the fight

describe("steering with the rod hand", () => {
  it("it does not matter where the arm hangs: only moving it counts", () => {
    const s = new SteerTracker();
    for (let k = 0; k < 600; k++) s.update(DT, 0.5);
    expect(Math.abs(s.side)).toBeLessThan(0.05);
    for (let k = 0; k < 30; k++) s.update(DT, 0.5 + 0.4);
    expect(s.side).toBeGreaterThan(0.7);
    for (let k = 0; k < 30; k++) s.update(DT, 0.5 - 0.4);
    expect(s.side).toBeLessThan(-0.7);
  });
});

describe("the fish pulls left and right", () => {
  const make = (id: string, weight: number, seed = 5, kids = false) => new FightModel({ species: SPECIES_BY_ID[id], weight, startD: 24, kids, rng: seeded(seed) });
  /** Reel steadily; `lean`: how the player steers (1 = against every run, 0 = ignores it). Keeps the fish far out so it does not land. */
  function fight(f: FightModel, seconds: number, lean: number, crank = 0.9) {
    let sum = 0;
    let n = 0;
    let peak = 0;
    let event = "none";
    for (let t = 0; t < seconds && event === "none"; t += DT) {
      event = f.step(DT, { crank, pump: 0, reelMul: 1, side: -f.runDir * lean });
      f.D = Math.max(f.D, 14);
      if (f.run) {
        sum += f.T / f.limit;
        n++;
      }
      peak = Math.max(peak, f.strain);
    }
    return { mean: sum / Math.max(1, n), peak, event, t: f.age };
  }

  it("it runs to one side, then (mostly) the other, with a pull that builds up, peaks and fades", () => {
    const f = make("sazan", 4);
    const sides: number[] = [];
    const surges: number[] = [];
    let last = 0;
    let runMax = 0;
    for (let t = 0; t < 60; t += DT) {
      f.step(DT, { crank: 0.6, pump: 0, reelMul: 1 });
      f.D = Math.max(f.D, 14);
      if (f.ranNow) {
        if (last) {
          surges.push(runMax);
          runMax = 0;
        }
        sides.push(f.runDir);
        last = f.runDir;
      }
      if (f.run) runMax = Math.max(runMax, f.surge);
    }
    expect(sides.length).toBeGreaterThan(6);
    const flips = sides.filter((s, i) => i > 0 && s !== sides[i - 1]).length;
    expect(flips / (sides.length - 1)).toBeGreaterThan(0.5);
    expect(new Set(sides).size).toBe(2);
    // the strength changes from run to run and always peaks above the "surge" splash level
    expect(Math.max(...surges)).toBeGreaterThan(0.85);
    expect(new Set(surges.map((s) => Math.round(s * 10))).size).toBeGreaterThan(2);
  });

  it("the fish turns up at the rod's side first: the pull direction is the side of the run", () => {
    const f = make("sazan", 4);
    let seen = 0;
    for (let t = 0; t < 40; t += DT) {
      f.step(DT, { crank: 0.6, pump: 0, reelMul: 1 });
      f.D = Math.max(f.D, 14);
      if (f.pullDir !== 0) {
        expect(f.pullDir).toBe(f.runDir);
        seen++;
      }
      if (!f.run) expect(f.pullDir).toBe(0);
    }
    expect(seen).toBeGreaterThan(60);
  });

  it("small fish run short and weak, big fish long and hard", () => {
    const stat = (id: string, w: number) => {
      const f = make(id, w, 21);
      let runs = 0;
      let runTime = 0;
      let surgeSum = 0;
      let pullSum = 0;
      let n = 0;
      for (let t = 0; t < 120; t += DT) {
        f.step(DT, { crank: 0.6, pump: 0, reelMul: 1, side: -f.runDir });
        f.D = Math.max(f.D, 14);
        if (f.ranNow) runs++;
        if (f.run) {
          runTime += DT;
          surgeSum += f.surge;
          n++;
        }
        pullSum += Math.abs(f.lat);
      }
      return { avgRun: runTime / Math.max(1, runs), surge: surgeSum / Math.max(1, n), lat: pullSum, pull: f.pull };
    };
    const small = stat("karas", 0.3);
    const big = stat("laqqa", 14);
    expect(big.avgRun).toBeGreaterThan(small.avgRun * 1.3);
    expect(big.pull).toBeGreaterThan(small.pull * 2);
    expect(big.lat).toBeGreaterThan(small.lat);
  });

  it("ignoring the pull raises the strain; leaning against it lowers it", () => {
    const ignore = fight(make("sazan", 5), 40, 0);
    const counter = fight(make("sazan", 5), 40, 1);
    expect(ignore.mean).toBeGreaterThan(counter.mean + 0.08);
    expect(ignore.peak).toBeGreaterThan(counter.peak);
  });

  it("ignoring a strong fish snaps the line, leaning against it keeps the line", () => {
    const ignore = fight(make("laqqa", 12, 3), 60, 0, 0.7);
    const counter = fight(make("laqqa", 12, 3), 60, 1, 0.7);
    expect(ignore.event).toBe("break");
    expect(counter.event).not.toBe("break");
    expect(counter.mean).toBeLessThan(ignore.mean);
  });

  it("a weak fish is no danger even when ignored; kids are never punished", () => {
    const weak = fight(make("karas", 0.4), 60, 0, 0.9);
    expect(weak.event).not.toBe("break");
    expect(weak.peak).toBeLessThan(1);
    const kids = make("laqqa", 12, 3, true);
    const a = fight(kids, 40, 0, 0.7);
    expect(a.event).not.toBe("break");
    expect(kids.counter).toBe(0);
  });

  it("not countering also lets a running fish take more line", () => {
    const out = (lean: number) => {
      const f = make("sazan", 5, 8);
      let gained = 0;
      for (let t = 0; t < 40; t += DT) {
        const d0 = f.D;
        f.step(DT, { crank: 0.5, pump: 0, reelMul: 1, side: -f.runDir * lean });
        f.D = Math.min(f.D, 60);
        if (f.run && f.D > d0) gained += f.D - d0;
      }
      return gained;
    };
    expect(out(0)).toBeGreaterThan(out(1));
  });

  it("reeling against a hard pulling fish brings in less line per turn than against a weak one", () => {
    const reelV = (id: string, w: number) => {
      const f = make(id, w, 6);
      let sum = 0;
      let n = 0;
      for (let t = 0; t < 30; t += DT) {
        f.step(DT, { crank: 1.2, pump: 0, reelMul: 1, side: -f.runDir });
        f.D = Math.max(f.D, 14);
        if (f.run) {
          sum += f.reelV;
          n++;
        }
      }
      return sum / Math.max(1, n);
    };
    expect(reelV("laqqa", 14)).toBeLessThan(reelV("karas", 0.3) * 0.9);
  });

  it("a countered run ends sooner: the fish spends less time running", () => {
    const share = (lean: number) => {
      const f = make("sazan", 5, 2);
      let running = 0;
      for (let t = 0; t < 60; t += DT) {
        f.step(DT, { crank: 0.6, pump: 0, reelMul: 1, side: -f.runDir * lean });
        f.D = Math.max(f.D, 14);
        if (f.run) running++;
      }
      return running * DT;
    };
    expect(share(1)).toBeLessThan(share(0) * 0.85);
  });
});
