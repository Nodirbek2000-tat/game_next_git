import { describe, expect, it } from "vitest";
import {
  Balloons,
  COLOURS,
  COLOUR_MAX_PLAY,
  CountRound,
  EV_NEXT,
  EV_NONE,
  EV_PLAY,
  EV_PRAISE,
  MAX_BALLOONS,
  NUMBER_WORDS,
  RoundClock,
  allDone,
  countMaxPlay,
  makeEnv,
  makeRounds,
  parseSeq,
  roundText,
  segCircle,
} from "./logic";

/** a small deterministic random generator */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("round plan", () => {
  it("alternates counting and colour rounds, numbers 1-5, easy start", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rounds = makeRounds(lcg(seed), 12);
      expect(rounds.length).toBe(12);
      let counts = 0;
      let lastN = 0;
      rounds.forEach((r, i) => {
        if (i % 2 === 1) {
          expect(r.kind).toBe("colour");
          expect(r.colour).toBeGreaterThanOrEqual(0);
          expect(r.colour).toBeLessThanOrEqual(3);
        } else {
          expect(["jump", "clap"]).toContain(r.kind);
          expect(r.n).toBeGreaterThanOrEqual(1);
          expect(r.n).toBeLessThanOrEqual(counts < 2 ? 3 : 5);
          expect(r.n).not.toBe(lastN);
          lastN = r.n;
          counts++;
        }
      });
    }
  });

  it("all four colours and both moves come round within one game", () => {
    const rounds = makeRounds(lcg(7), 12);
    expect(new Set(rounds.filter((r) => r.kind === "colour").map((r) => r.colour)).size).toBe(4);
    expect(new Set(rounds.map((r) => r.kind))).toEqual(new Set(["jump", "clap", "colour"]));
  });

  it("every number 1..5 shows up over many games", () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 30; seed++) for (const r of makeRounds(lcg(seed), 12)) if (r.kind !== "colour") seen.add(r.n);
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("texts are Uzbek Latin and name the number / colour", () => {
    expect(roundText({ kind: "jump", n: 3, colour: 0 })).toEqual({ text: "3 marta sakrang!", icon: "🐰" });
    expect(roundText({ kind: "clap", n: 2, colour: 0 })).toEqual({ text: "2 marta qarsak!", icon: "👏" });
    expect(roundText({ kind: "colour", n: 0, colour: 0 }).text).toBe("Qizil sharni ushlang!");
    expect(COLOURS.map((c) => c.name)).toEqual(["Qizil", "Sariq", "Ko‘k", "Yashil"]);
    expect(NUMBER_WORDS.length).toBe(5);
    for (const c of COLOURS) expect(/[\u0400-\u04FF]/.test(c.prompt)).toBe(false);
  });

  it("?seq= parses a test plan", () => {
    expect(parseSeq("jump3,col0,clap2,junk,col9")).toEqual([
      { kind: "jump", n: 3, colour: 0 },
      { kind: "colour", n: 0, colour: 0 },
      { kind: "clap", n: 2, colour: 0 },
    ]);
    expect(parseSeq(null)).toEqual([]);
  });
});

describe("CountRound", () => {
  it("counts every child separately, stops at the number, ignores the rest", () => {
    const c = new CountRound();
    c.reset(3);
    expect(c.hit(0)).toBe(1);
    expect(c.hit(0)).toBe(2);
    expect(c.hit(1)).toBe(1);
    expect(c.done[0]).toBe(0);
    expect(c.hit(0)).toBe(3);
    expect(c.done[0]).toBe(1);
    expect(c.hit(0)).toBe(0); // extra jumps do nothing
    expect(c.count[0]).toBe(3);
    expect(c.count[1]).toBe(1);
    expect(c.best()).toBe(3);
  });

  it("reset clears everything and clamps the number to 1..5", () => {
    const c = new CountRound();
    c.reset(9);
    expect(c.n).toBe(5);
    c.hit(2);
    c.reset(0);
    expect(c.n).toBe(1);
    expect(c.count[2]).toBe(0);
    expect(c.hit(2)).toBe(1);
    expect(c.done[2]).toBe(1);
  });

  it("allDone: needs somebody present and everybody present done (absent children do not block)", () => {
    const present = [1, 1, 0, 0, 0];
    expect(allDone(present, [1, 0, 0, 0, 0])).toBe(false);
    expect(allDone(present, [1, 1, 0, 0, 0])).toBe(true);
    expect(allDone([0, 0, 0, 0, 0], [0, 0, 0, 0, 0])).toBe(false);
    expect(allDone([0, 1, 0, 0, 0], [0, 1, 0, 0, 0])).toBe(true);
  });
});

describe("RoundClock", () => {
  it("intro -> play -> praise -> next, never stuck", () => {
    const c = new RoundClock(1, 2);
    c.begin(5);
    const evs: number[] = [];
    for (let i = 0; i < 400; i++) {
      const e = c.tick(0.05, false, true);
      if (e !== EV_NONE) evs.push(e);
      if (e === EV_NEXT) break;
    }
    expect(evs).toEqual([EV_PLAY, EV_PRAISE, EV_NEXT]);
  });

  it("ends the play phase as soon as everybody is done", () => {
    const c = new RoundClock(0.5, 1);
    c.begin(20);
    let t = 0;
    while (c.tick(0.05, false, true) !== EV_PLAY) t += 0.05;
    expect(c.tick(0.05, true, true)).toBe(EV_PRAISE);
    expect(t).toBeLessThan(1);
  });

  it("the play timer waits while nobody is there", () => {
    const c = new RoundClock(0.1, 1);
    c.begin(1);
    while (c.tick(0.05, false, false) !== EV_PLAY) {
      /* intro */
    }
    for (let i = 0; i < 200; i++) expect(c.tick(0.05, false, false)).toBe(EV_NONE); // 10 s alone: still playing
    expect(c.phase).toBe("play");
    let e = EV_NONE;
    for (let i = 0; i < 40 && e === EV_NONE; i++) e = c.tick(0.05, false, true);
    expect(e).toBe(EV_PRAISE);
  });

  it("round lengths are sane", () => {
    expect(countMaxPlay(1)).toBeGreaterThan(8);
    expect(countMaxPlay(5)).toBeLessThanOrEqual(18);
    expect(COLOUR_MAX_PLAY).toBeLessThanOrEqual(16);
  });
});

describe("segCircle", () => {
  it("a point inside, a fast swipe across, and a miss", () => {
    expect(segCircle(100, 100, 100, 100, 110, 100, 20)).toBe(true);
    expect(segCircle(0, 100, 300, 100, 150, 110, 20)).toBe(true); // swiped through between two frames
    expect(segCircle(0, 100, 300, 100, 150, 200, 20)).toBe(false);
    expect(segCircle(0, 100, 50, 100, 200, 100, 20)).toBe(false); // segment ends before the balloon
  });
});

describe("Balloons", () => {
  const env = () => {
    const e = makeEnv();
    e.w = 1280;
    e.h = 720;
    e.nKids = 3;
    e.kidX[0] = 250;
    e.kidX[1] = 640;
    e.kidX[2] = 1000;
    return e;
  };

  it("keeps enough balloons of the named colour for every child, and never more than the pool", () => {
    const e = env();
    e.target = 0;
    e.need = 4;
    e.cap = 8;
    const b = new Balloons(lcg(3));
    b.r = 45;
    b.refill(e, true);
    expect(b.targetAlive(0)).toBeGreaterThanOrEqual(4);
    expect(b.count).toBeLessThanOrEqual(MAX_BALLOONS);
    expect(b.count).toBe(8);
    // children pop three target balloons: they are replaced
    let popped = 0;
    for (let i = 0; i < MAX_BALLOONS && popped < 3; i++) {
      if (!b.alive[i] || b.colour[i] !== 0) continue;
      b.kill(i);
      popped++;
    }
    for (let i = 0; i < 10; i++) b.refill(e, false);
    expect(b.targetAlive(0)).toBeGreaterThanOrEqual(4);
    expect(b.count).toBeLessThanOrEqual(8);
  });

  it("balloons rise, stay inside the screen sideways and leave at the top", () => {
    const e = env();
    e.target = 2;
    e.need = 2;
    const b = new Balloons(lcg(11));
    b.r = 45;
    b.refill(e, true);
    const y0 = b.y.slice();
    b.step(0.1, 0.1, e);
    for (let i = 0; i < MAX_BALLOONS; i++) if (b.alive[i]) expect(b.y[i]).toBeLessThan(y0[i]);
    for (let s = 0; s < 400; s++) {
      b.step(0.05, s * 0.05, e);
      for (let i = 0; i < MAX_BALLOONS; i++) if (b.alive[i]) {
        expect(b.x[i]).toBeGreaterThanOrEqual(45);
        expect(b.x[i]).toBeLessThanOrEqual(1280 - 45);
      }
    }
    expect(b.count).toBe(0); // all floated away (20 s)
  });

  it("allocation-free: fixed typed arrays, kill is idempotent", () => {
    const b = new Balloons(lcg(5));
    const keys = Object.keys(b).length;
    const e = env();
    e.target = 1;
    e.need = 2;
    for (let i = 0; i < 300; i++) {
      b.refill(e, i % 50 === 0);
      b.step(0.05, i * 0.05, e);
    }
    expect(Object.keys(b).length).toBe(keys);
    b.clear();
    b.kill(0);
    expect(b.count).toBe(0);
  });
});
