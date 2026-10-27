import { describe, expect, it } from "vitest";
import { KID_ANIMALS, KID_COLORS, MAX_KIDS, type KidPt, type KidSlot } from "@/engine/tracking/kids";
import { Angler, EV, ST, TUNE, type AnglerInput } from "./angler";
import { Painter } from "./draw";
import { Baliqcha, FLOAT_LANE, handHeight, type Sink } from "./game";
import { BASKET, FM, GOLDEN, N_FISH, Pond } from "./pond";
import { GroupVoice } from "./voiceGroup";

// ------------------------------------------------------------------ helpers
const inp = (o: Partial<AnglerInput> = {}): AnglerInput => ({ present: true, up: -0.5, voiceCast: false, voicePull: false, ...o });

/** run the angler for `sec` seconds with a constant input; returns all flags seen */
function run(a: Angler, sec: number, input: Partial<AnglerInput> = {}, dt = 1 / 30): number {
  let flags = 0;
  for (let t = 0; t < sec - 1e-9; t += dt) flags |= a.update(dt, inp(input));
  return flags;
}

/** a hand movement: heights (shoulder widths) played one by one, 1/30 s each */
function play(a: Angler, heights: number[], dt = 1 / 30): number {
  let flags = 0;
  for (const u of heights) flags |= a.update(dt, inp({ up: u }));
  return flags;
}

const ramp = (from: number, to: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);

const pt = (x: number, y: number, v = 1): KidPt => ({ x, y, v });

/** a kid at horizontal position cx; hands "up" (wrists above the head) or "down" */
function mkKid(slot: number, cx: number, hands: "up" | "down" | "none" = "down", over: Partial<KidSlot> = {}): KidSlot {
  const k: KidSlot = {
    slot,
    color: KID_COLORS[slot],
    animal: KID_ANIMALS[slot],
    active: true,
    present: true,
    lostFor: 0,
    seenFor: 5,
    joined: false,
    left: false,
    scale: 60,
    headR: 30,
    center: { x: cx, y: 300 },
    pts: {
      head: pt(cx, 200),
      ls: pt(cx - 30, 260),
      rs: pt(cx + 30, 260),
      le: pt(cx - 50, 310),
      re: pt(cx + 50, 310),
      lw: pt(cx - 55, 360),
      rw: pt(cx + 55, 360),
      lh: pt(cx - 20, 400),
      rh: pt(cx + 20, 400),
      lk: pt(cx - 20, 480),
      rk: pt(cx + 20, 480),
      la: pt(cx - 20, 560),
      ra: pt(cx + 20, 560),
    },
    signals: {
      handsUp: false,
      handUp: { L: false, R: false },
      jump: false,
      jumpFired: false,
      squat: false,
      clap: false,
      clapFired: false,
      wave: false,
      armsOut: false,
      still: false,
      stillFor: 0,
      energy: 0,
      jumps: 0,
      claps: 0,
    },
    ...over,
  };
  setHands(k, hands);
  return k;
}

function setHands(k: KidSlot, hands: "up" | "down" | "none"): void {
  const cx = k.center.x;
  const p = k.pts;
  if (hands === "up") {
    p.lw.y = p.rw.y = 90;
    p.le.y = p.re.y = 190;
    p.lw.v = p.rw.v = 1;
  } else if (hands === "down") {
    p.lw.y = p.rw.y = 360;
    p.le.y = p.re.y = 310;
    p.lw.v = p.rw.v = 1;
  } else {
    p.lw.v = p.rw.v = 0;
  }
  p.lw.x = cx - 55;
  p.rw.x = cx + 55;
}

// ------------------------------------------------------------------ the per-child state machine
describe("angler: cast", () => {
  it("does nothing while the hand is only raised, or only moves a little", () => {
    const a = new Angler(() => 0.5);
    expect(play(a, ramp(-0.3, 1.2, 10).concat(Array(60).fill(1.2)))).toBe(0);
    expect(a.state).toBe(ST.idle);
    const b = new Angler(() => 0.5);
    // a hand that never gets above the shoulders much: no cast
    expect(play(b, [-0.3, 0.1, 0.3, 0.4, 0.2, -0.2, 0.3, 0.1])).toBe(0);
  });

  it("raise a hand, then bring it down: casts (any speed, any amount of wobble)", () => {
    for (const downFrames of [2, 6, 20]) {
      const a = new Angler(() => 0.5);
      const f = play(a, [...ramp(-0.3, 1.5, 8), 1.4, 1.5, 1.3, ...ramp(1.3, -0.4, downFrames)]);
      expect(f & EV.cast).toBe(EV.cast);
      expect(a.state).toBe(ST.fly);
    }
  });

  it("a hand that drops only part of the way still casts (tolerant), e.g. when it comes forward in front of the face", () => {
    const a = new Angler(() => 0.5);
    const f = play(a, [...ramp(0, 1.4, 6), ...ramp(1.4, 0.7, 4), 0.6, 0.6]);
    expect(f & EV.cast).toBe(EV.cast);
  });

  it("works with one hand: the input is the best hand, so the other one may hang down", () => {
    const k = mkKid(0, 400, "down");
    k.pts.rw.y = 80; // only the right hand goes up
    expect(handHeight(k)).toBeGreaterThan(TUNE.upOn);
    k.pts.rw.y = 360;
    expect(handHeight(k)).toBeLessThan(0);
  });

  it("the voice casts (\"baliq\" / shouts) but never while the line is out", () => {
    const a = new Angler(() => 0.5);
    expect(a.update(0.03, inp({ voiceCast: true })) & EV.cast).toBe(EV.cast);
    // a second shout while flying / waiting changes nothing
    for (let i = 0; i < 20; i++) expect(a.update(0.03, inp({ voiceCast: true })) & EV.cast).toBe(0);
  });

  it("ignores a child who is not seen right now (no gesture without a body)", () => {
    const a = new Angler(() => 0.5);
    play(a, ramp(0, 1.5, 6));
    let f = 0;
    for (let i = 0; i < 10; i++) f |= a.update(1 / 30, inp({ present: false, up: -1 }));
    expect(f & EV.cast).toBe(0);
  });

  it("helps a child who cannot do the gesture: casts by itself after a while", () => {
    const a = new Angler(() => 0.5);
    expect(run(a, TUNE.assistIdle - 0.5) & EV.cast).toBe(0);
    expect(run(a, 1.5) & EV.assist).toBe(EV.assist);
    expect(a.state).not.toBe(ST.idle);
  });
});

describe("angler: bite and pull", () => {
  it("the fish always bites within a few seconds of the cast", () => {
    for (const r of [0, 0.5, 0.999]) {
      const a = new Angler(() => r);
      a.update(0.03, inp({ voiceCast: true }));
      let t = 0;
      let flags = 0;
      while (!(flags & EV.bite) && t < 10) {
        flags |= a.update(1 / 60, inp());
        t += 1 / 60;
      }
      expect(flags & EV.land).toBe(EV.land);
      expect(flags & EV.bite).toBe(EV.bite);
      expect(t).toBeLessThanOrEqual(TUNE.flyTime + TUNE.biteMax + 0.1);
      expect(t).toBeGreaterThanOrEqual(TUNE.flyTime + TUNE.biteMin - 0.05);
    }
  });

  const toBite = (a: Angler): void => {
    a.update(0.03, inp({ voiceCast: true }));
    for (let i = 0; i < 600 && a.state !== ST.bite; i++) a.update(1 / 60, inp());
    expect(a.state).toBe(ST.bite);
  };

  it("raising the hands pulls (after the bite was visible for a moment), then the fish is caught", () => {
    const a = new Angler(() => 0.5);
    toBite(a);
    expect(run(a, 0.1, { up: 1.2 }) & EV.pull).toBe(0); // too early: the bite must be seen first
    const f = run(a, 0.5, { up: 1.2 });
    expect(f & EV.pull).toBe(EV.pull);
    expect(a.state).toBe(ST.reel);
    expect(run(a, TUNE.reelTime + 0.1) & EV.catch).toBe(EV.catch);
    expect(a.state).toBe(ST.idle);
  });

  it("a flicker of the hand is not a pull, a low hand is not a pull", () => {
    const a = new Angler(() => 0.5);
    toBite(a);
    run(a, 0.4, { up: 0.3 });
    expect(a.state).toBe(ST.bite);
    a.update(1 / 60, inp({ up: 1.5 }));
    a.update(1 / 60, inp({ up: 0 }));
    expect(a.state).toBe(ST.bite);
  });

  it("the voice (\"tort\" / a shout) pulls at once", () => {
    const a = new Angler(() => 0.5);
    toBite(a);
    expect(a.update(1 / 60, inp({ voicePull: true })) & EV.pull).toBe(EV.pull);
  });

  it("a fish never gets away: the game pulls it after a while", () => {
    const a = new Angler(() => 0.5);
    toBite(a);
    expect(run(a, TUNE.assistBite + 0.5) & EV.pull).toBe(EV.pull);
  });

  it("after the catch the line rests for a moment, then the next cast works; hands that stay up cast when they come down", () => {
    const a = new Angler(() => 0.5);
    toBite(a);
    run(a, 0.5, { up: 1.5 }); // pull, hand stays up while reeling
    run(a, TUNE.reelTime + 0.05, { up: 1.5 });
    expect(a.state).toBe(ST.idle);
    expect(a.cool).toBeGreaterThan(0);
    // during the rest a shout does nothing
    expect(a.update(0.03, inp({ voiceCast: true, up: 1.5 })) & EV.cast).toBe(0);
    run(a, TUNE.cool + 0.1, { up: 1.5 });
    const f = play(a, ramp(1.5, -0.3, 6));
    expect(f & EV.cast).toBe(EV.cast);
  });

  it("reset puts the line away", () => {
    const a = new Angler(() => 0.5);
    toBite(a);
    a.reset();
    expect(a.state).toBe(ST.idle);
    expect(a.t).toBe(0);
  });
});

// ------------------------------------------------------------------ voice commands (group)
describe("group voice", () => {
  it("\"baliq\"/\"fish\" casts the idle lines, \"tort\"/\"pull\" pulls the biting ones, in kids mode any word does the right thing", () => {
    const v = new GroupVoice();
    const out = { cast: false, pull: false };
    v.anyIdle = true;
    v.onEvent("fish");
    v.take(out);
    expect(out).toEqual({ cast: true, pull: false });
    v.take(out);
    expect(out).toEqual({ cast: false, pull: false });
    v.anyIdle = false;
    v.anyBite = true;
    v.onEvent("pull");
    v.take(out);
    expect(out).toEqual({ cast: false, pull: true });
    v.onEvent("fish"); // wrong word, but the fish bites: it pulls
    v.take(out);
    expect(out.pull).toBe(true);
  });

  it("does nothing when nobody needs it (never scares the fish)", () => {
    const v = new GroupVoice();
    const out = { cast: false, pull: false };
    v.onEvent("fish");
    v.onEvent("pull");
    v.onEvent("shout");
    v.take(out);
    expect(out).toEqual({ cast: false, pull: false });
  });

  it("shouts: two quick shouts cast, one shout pulls, an old shout does not count", () => {
    const v = new GroupVoice();
    const out = { cast: false, pull: false };
    v.anyIdle = true;
    v.onEvent("shout");
    v.take(out);
    expect(out.cast).toBe(false);
    v.update(0.5);
    v.onEvent("shout");
    v.take(out);
    expect(out.cast).toBe(true);
    // a lonely shout after a long pause is the first one again
    v.update(5);
    v.onEvent("shout");
    v.take(out);
    expect(out.cast).toBe(false);
    v.anyIdle = false;
    v.anyBite = true;
    v.onEvent("shout");
    v.take(out);
    expect(out.pull).toBe(true);
  });
});

// ------------------------------------------------------------------ hand height from the kit's kid slots
describe("handHeight", () => {
  it("is high with raised hands and low with lowered hands", () => {
    expect(handHeight(mkKid(0, 300, "up"))).toBeGreaterThan(2);
    expect(handHeight(mkKid(0, 300, "down"))).toBeLessThan(0);
  });

  it("uses the elbow when the wrists left the picture, and survives a child without shoulders", () => {
    const k = mkKid(0, 300, "none");
    k.pts.le.y = k.pts.re.y = 180; // elbows above the shoulders
    expect(handHeight(k)).toBeGreaterThan(TUNE.upOn);
    const n = mkKid(0, 300, "up");
    n.pts.ls.v = n.pts.rs.v = 0;
    expect(handHeight(n)).toBeGreaterThan(TUNE.upOn);
    expect(handHeight(mkKid(0, 300, "none"))).toBeLessThan(0.3);
  });
});

// ------------------------------------------------------------------ the pond
describe("pond", () => {
  it("a fish comes to the float, bites, flies to the basket and a new one swims in; the fish count never changes", () => {
    const p = new Pond(() => 0.5);
    const i = p.send(2, 0.4, 0.6, 1);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p.mode[i]).toBe(FM.come);
    for (let k = 0; k < 70; k++) p.update(1 / 60);
    expect(Math.abs(p.x[i] - 0.4)).toBeLessThan(0.01);
    expect(p.hook(2)).toBe(i);
    expect(p.mode[i]).toBe(FM.hook);
    p.reel(2, 0.9);
    for (let k = 0; k < 60; k++) p.update(1 / 60);
    expect(Math.abs(p.x[i] - BASKET.x)).toBeLessThan(0.01);
    expect(p.land(2)).toBe(i);
    expect(p.mode[i]).toBe(FM.swim);
    expect(p.fishOf[2]).toBe(-1);
    let swimming = 0;
    for (let k = 0; k < N_FISH; k++) if (p.mode[k] === FM.swim) swimming++;
    expect(swimming).toBe(N_FISH);
  });

  it("the golden fish is rare, the others are all different in size and colour", () => {
    let gold = 0;
    const p = new Pond();
    for (let k = 0; k < 2000; k++) if (p.pick() === GOLDEN) gold++;
    expect(gold).toBeGreaterThan(40);
    expect(gold).toBeLessThan(500);
    const colors = new Set<number>();
    for (let k = 0; k < N_FISH; k++) colors.add(p.color[k]);
    expect(colors.size).toBeGreaterThanOrEqual(6);
  });

  it("fish stay finite and inside a sane area for minutes, and always have a free fish for 5 children", () => {
    const p = new Pond();
    for (let s = 0; s < 5; s++) expect(p.send(s, 0.2 + 0.15 * s, 0.6, 1)).toBeGreaterThanOrEqual(0);
    for (let k = 0; k < 60 * 120; k++) p.update(1 / 60);
    for (let k = 0; k < N_FISH; k++) {
      expect(Number.isFinite(p.x[k]) && Number.isFinite(p.y[k])).toBe(true);
      expect(p.x[k]).toBeGreaterThan(-0.5);
      expect(p.x[k]).toBeLessThan(1.5);
    }
  });

  it("release lets a fish swim on when the child leaves", () => {
    const p = new Pond(() => 0.5);
    const i = p.send(1, 0.5, 0.6, 1);
    p.release(1);
    expect(p.mode[i]).toBe(FM.swim);
    expect(p.fishOf[1]).toBe(-1);
  });
});

// ------------------------------------------------------------------ the whole game, 3 children
interface Rec {
  casts: number[];
  lands: number[];
  bites: number[];
  pulls: number[];
  caught: { slot: number; golden: boolean; stars: number }[];
}

function rig(n: number, rand?: () => number): { g: Baliqcha; kids: KidSlot[]; rec: Rec } {
  const kids = Array.from({ length: MAX_KIDS }, (_, i) => mkKid(i, 200 + i * 300, "down", { active: i < n, present: i < n }));
  const rec: Rec = { casts: [], lands: [], bites: [], pulls: [], caught: [] };
  const sink: Sink = {
    cast: (s) => rec.casts.push(s),
    land: (s) => rec.lands.push(s),
    bite: (s) => rec.bites.push(s),
    pull: (s) => rec.pulls.push(s),
    caught: (slot, golden, stars) => rec.caught.push({ slot, golden, stars }),
  };
  const g = new Baliqcha(kids, sink, rand);
  return { g, kids, rec };
}

const tick = (g: Baliqcha, sec: number, dt = 1 / 30): void => {
  for (let t = 0; t < sec - 1e-9; t += dt) g.update(dt, 1280);
};

describe("baliqcha game", () => {
  it("3 children cast with a raised-then-lowered hand, pull with raised hands: their fish land in the shared basket", () => {
    const { g, kids, rec } = rig(3, () => 0.5);
    tick(g, 0.2);
    // everybody raises a hand and brings it down
    for (let i = 0; i < 3; i++) setHands(kids[i], "up");
    tick(g, 0.3);
    for (let i = 0; i < 3; i++) setHands(kids[i], "down");
    tick(g, 0.2);
    expect(rec.casts.sort()).toEqual([0, 1, 2]);
    // float lands in front of each child
    tick(g, 0.6);
    expect(rec.lands.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(g.floatX[i] * 1280).toBeCloseTo(kids[i].center.x, -1);
      expect(g.floatY[i]).toBeCloseTo(FLOAT_LANE[i], 5);
    }
    // the bite comes by itself within a few seconds
    tick(g, TUNE.biteMax + 0.2);
    expect(rec.bites.sort()).toEqual([0, 1, 2]);
    for (let i = 0; i < 3; i++) expect(g.pond.mode[g.pond.fishOf[i]]).toBe(FM.hook);
    // raise hands: pull
    for (let i = 0; i < 3; i++) setHands(kids[i], "up");
    tick(g, 0.6);
    expect(rec.pulls.sort()).toEqual([0, 1, 2]);
    expect(rec.caught.length).toBe(0);
    tick(g, TUNE.reelTime + 0.1);
    expect(rec.caught.map((c) => c.slot).sort()).toEqual([0, 1, 2]);
    expect(g.basket).toBe(3);
    expect(Array.from(g.catches.slice(0, 3))).toEqual([1, 1, 1]);
    expect(rec.caught.every((c) => c.stars === 1 || c.golden)).toBe(true);
    // fish were replaced, nothing is stuck
    for (let i = 0; i < 3; i++) expect(g.pond.fishOf[i]).toBe(-1);
  });

  it("voice: one \"baliq\" casts every idle line, one \"tort\" pulls every biting fish", () => {
    const { g, rec } = rig(2, () => 0.5);
    tick(g, 0.1);
    g.voice.onEvent("fish");
    tick(g, 0.1);
    expect(rec.casts.sort()).toEqual([0, 1]);
    g.voice.onEvent("pull"); // lines are still in the water: the fish is not scared
    tick(g, 0.1);
    expect(rec.pulls).toEqual([]);
    tick(g, 4);
    expect(rec.bites.length).toBe(2);
    g.voice.onEvent("pull");
    tick(g, 0.1);
    expect(rec.pulls.length).toBe(2);
    tick(g, 1.2);
    expect(g.basket).toBe(2);
  });

  it("the golden fish gives 3 stars", () => {
    // rand = 0.05 is below the golden chance: the first fish that comes is the golden one
    const { g, rec } = rig(1, () => 0.05);
    tick(g, 0.1);
    g.voice.onEvent("fish");
    tick(g, 0.9);
    expect(g.pond.fishOf[0]).toBe(GOLDEN);
    tick(g, TUNE.biteMax + 0.2);
    g.voice.onEvent("pull");
    tick(g, 0.1 + TUNE.reelTime + 0.1);
    expect(rec.caught).toEqual([{ slot: 0, golden: true, stars: 3 }]);
  });

  it("a child who has just taken a slot starts from zero; a child who left puts the line away and frees the fish", () => {
    const { g, kids } = rig(1, () => 0.5);
    tick(g, 0.1);
    g.voice.onEvent("fish");
    tick(g, 1);
    expect(g.pond.fishOf[0]).toBeGreaterThanOrEqual(0);
    g.catches[0] = 4;
    kids[0].active = false;
    tick(g, 0.1);
    expect(g.anglers[0].state).toBe(ST.idle);
    expect(g.pond.fishOf[0]).toBe(-1);
    kids[0].active = true;
    kids[0].joined = true;
    tick(g, 0.05);
    expect(g.catches[0]).toBe(0);
  });

  it("never gets stuck: 5 children who do nothing at all still catch fish (the game helps), and at most one fish per child is busy", () => {
    const { g, rec } = rig(5);
    tick(g, 60);
    expect(rec.caught.length).toBeGreaterThanOrEqual(5);
    let swimming = 0;
    for (let i = 0; i < N_FISH; i++) if (g.pond.mode[i] !== FM.swim) swimming++;
    expect(swimming).toBeLessThanOrEqual(5);
  });

  it("an absent (not seen) child does not cast with the hands but the game keeps going", () => {
    const { g, kids, rec } = rig(2, () => 0.5);
    kids[1].present = false;
    setHands(kids[1], "up");
    tick(g, 0.5);
    setHands(kids[1], "down");
    tick(g, 0.5);
    expect(rec.casts).toEqual([]);
  });
});

// ------------------------------------------------------------------ painting
describe("painter", () => {
  const ctxMock = (): { ctx: CanvasRenderingContext2D; n: () => number } => {
    const calls = { n: 0 };
    const c = new Proxy(calls, {
      get: (t, k) => (k === "n" ? t.n : () => void t.n++),
      set: () => true,
    });
    return { ctx: c as unknown as CanvasRenderingContext2D, n: () => calls.n };
  };

  it("draws a busy scene (5 children, fish biting and flying) with a bounded number of canvas calls and without throwing", () => {
    const { g, kids } = rig(5, () => 0.5);
    const painter = new Painter(g);
    g.voice.onEvent("fish");
    let worst = 0;
    for (let f = 0; f < 600; f++) {
      g.update(1 / 30, 1280);
      if (f === 200) g.voice.onEvent("pull");
      if (f === 300) g.voice.onEvent("fish");
      const m = ctxMock();
      painter.drawBack(m.ctx, f * 33, 1280, 720);
      painter.drawFront(m.ctx, f * 33, kids, 1280, 720);
      worst = Math.max(worst, m.n());
    }
    expect(worst).toBeGreaterThan(200);
    expect(worst).toBeLessThan(900);
  });
});
