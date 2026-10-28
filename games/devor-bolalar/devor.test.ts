import { describe, expect, it, vi } from "vitest";
import type { EngineApi } from "@/engine";
import { buildPeople, computeFit } from "@/engine/tracking/people";
import { KidTracker } from "@/engine/tracking/kids";
import { makeSkeleton, type SkeletonOpts } from "@/engine/testing/skeleton";
import { PROMPTS, startKidsGame } from "../bogcha/common";
import { devorDef, ALL_BONUS } from "./game";
import { Painter, approachScale, throughScale, FAR } from "./paint";
import { HoldGate, MATCH_MIN, POSES, POSE_IDS, angDiff, armAngle, poseById, poseMatches, poseScore, registerPrompts, type PoseId, type PoseKid, type PtV } from "./poses";
import { Deck, ROUND_CFG, Round, parseSeq, type RoundHooks, type RoundKid } from "./round";
import { SLOT_MIDI, WallSounds } from "./sounds";

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

const SC = 100; // shoulder width in px
const pt = (x: number, y: number, v = 0.9): PtV => ({ x, y, v });

interface KidOpts {
  /** std-dev of the tracking noise in shoulder widths */
  noise?: number;
  rnd?: () => number;
  /** ankle distance in shoulder widths */
  feet?: number;
  legsVisible?: boolean;
  squat?: boolean;
  /** extra signals */
  handsUp?: boolean;
  armsOut?: boolean;
}

/** A child described by the direction of the two arms (degrees from straight down, outward positive); ls is at +x. */
function kidAt(armL: number, armR: number, o: KidOpts = {}): PoseKid {
  const rnd = o.rnd ?? (() => 0.5);
  const n = (): number => ((rnd() + rnd() + rnd() - 1.5) * 2 * (o.noise ?? 0) * SC); // ~gaussian
  const sh = (sgn: number): PtV => pt(300 + sgn * SC * 0.5 + n() * 0.3, 300 + n() * 0.3);
  const wrist = (s: PtV, sgn: number, deg: number): PtV => {
    const a = (deg * Math.PI) / 180;
    return pt(s.x + sgn * Math.sin(a) * SC * 1.6 + n(), s.y + Math.cos(a) * SC * 1.6 + n());
  };
  const ls = sh(1);
  const rs = sh(-1);
  const lw = wrist(ls, 1, armL);
  const rw = wrist(rs, -1, armR);
  const fv = o.legsVisible === false ? 0.05 : 0.9;
  const f = (o.feet ?? 0.6) * SC;
  const la = pt(300 + f / 2, 640, fv);
  const ra = pt(300 - f / 2, 640, fv);
  return {
    scale: SC,
    pts: { ls, rs, lw, rw, la, ra },
    signals: {
      squat: o.squat ?? false,
      armsOut: o.armsOut ?? (armL > 70 && armL < 110 && armR > 70 && armR < 110),
      handsUp: o.handsUp ?? (armL > 150 && armR > 150),
      handUp: { L: armL > 150, R: armR > 150 },
    },
  };
}

// the five canonical children
const UP = (o?: KidOpts) => kidAt(176, 176, o);
const OUT = (o?: KidOpts) => kidAt(90, 90, o);
const STAR = (o?: KidOpts) => kidAt(135, 135, { feet: 1.5, ...o });
const SQUAT = (o?: KidOpts) => kidAt(25, 25, { squat: true, ...o });
const ONE = (o?: KidOpts) => kidAt(176, 8, o);
const DOWN = (o?: KidOpts) => kidAt(8, 8, o);

describe("angles", () => {
  it("angDiff wraps around", () => {
    expect(angDiff(175, -175)).toBe(10);
    expect(angDiff(0, 180)).toBe(180);
    expect(angDiff(90, 80)).toBe(10);
  });

  it("armAngle: down 0, out 90, up 180, whichever side the body faces", () => {
    const sh = pt(0, 0);
    expect(armAngle(sh, pt(0, 10), 1)).toBeCloseTo(0, 5);
    expect(armAngle(sh, pt(10, 0), 1)).toBeCloseTo(90, 5);
    expect(armAngle(sh, pt(-10, 0), -1)).toBeCloseTo(90, 5);
    expect(Math.abs(armAngle(sh, pt(0, -10), 1))).toBeCloseTo(180, 5);
  });
});

describe("pose matching", () => {
  it("has the five poses of the brief with Uzbek Latin prompts", () => {
    expect(POSE_IDS).toEqual(["handsUp", "armsOut", "star", "squat", "oneHand"]);
    registerPrompts(PROMPTS as unknown as Record<string, { text: string; icon: string }>);
    for (const p of POSES) {
      expect((PROMPTS as Record<string, { text: string }>)[p.promptId].text).toBe(p.text);
      expect([...p.text].some((c) => c.charCodeAt(0) >= 0x400 && c.charCodeAt(0) <= 0x4ff)).toBe(false);
    }
    expect((PROMPTS as Record<string, { text: string }>)["dv-again"].text).toBe("Yana bir marta!");
    expect((PROMPTS as Record<string, { text: string }>)["dv-all"].text).toBe("Hammamiz o‘tdik!");
  });

  it("each canonical child matches its own pose", () => {
    expect(poseMatches("handsUp", UP())).toBe(true);
    expect(poseMatches("armsOut", OUT())).toBe(true);
    expect(poseMatches("star", STAR())).toBe(true);
    expect(poseMatches("squat", SQUAT())).toBe(true);
    expect(poseMatches("oneHand", ONE())).toBe(true);
    expect(poseMatches("oneHand", kidAt(8, 176))).toBe(true); // either hand
  });

  it("clearly different poses do not match", () => {
    expect(poseMatches("armsOut", UP())).toBe(false);
    expect(poseMatches("handsUp", OUT())).toBe(false);
    expect(poseMatches("oneHand", UP())).toBe(false);
    expect(poseMatches("oneHand", OUT())).toBe(false);
    expect(poseMatches("handsUp", ONE())).toBe(false);
    expect(poseMatches("armsOut", ONE())).toBe(false);
    expect(poseMatches("star", UP())).toBe(false); // feet together
    expect(poseMatches("star", OUT())).toBe(false);
    expect(poseMatches("squat", UP())).toBe(false);
  });

  it("a child standing with the arms down matches nothing", () => {
    for (const id of POSE_IDS) expect(poseMatches(id, DOWN()), id).toBe(false);
  });

  it("is generous: +-40 degrees off still passes, +-80 does not", () => {
    for (const d of [-40, -25, 0, 25, 40]) {
      expect(poseMatches("armsOut", kidAt(90 + d, 90 - d)), `armsOut ${d}`).toBe(true);
      expect(poseMatches("handsUp", kidAt(176 - Math.abs(d), 176 - Math.abs(d)))).toBe(true);
    }
    expect(poseMatches("armsOut", kidAt(10, 170))).toBe(false);
    expect(poseMatches("armsOut", kidAt(90, 5))).toBe(false); // one arm only
  });

  it("score is monotone in the error and a folded (short) raised arm does not count", () => {
    let last = 2;
    for (const d of [0, 20, 40, 55, 70, 90]) {
      const s = poseScore("armsOut", kidAt(90 + d, 90 + d));
      expect(s).toBeLessThanOrEqual(last + 1e-9);
      last = s;
    }
    const k = kidAt(176, 176, { handsUp: false });
    // fold both arms: wrists right above the shoulders but close to them
    k.pts.lw.y = k.pts.ls.y - 0.2 * SC;
    k.pts.rw.y = k.pts.rs.y - 0.2 * SC;
    expect(poseScore("handsUp", k)).toBeLessThan(MATCH_MIN);
  });

  it("star needs the feet apart when the ankles are seen, not when they are not", () => {
    expect(poseMatches("star", kidAt(135, 135, { feet: 0.6 }))).toBe(false);
    expect(poseMatches("star", kidAt(135, 135, { feet: 1.5 }))).toBe(true);
    expect(poseMatches("star", kidAt(135, 135, { feet: 0.6, legsVisible: false }))).toBe(true);
  });

  it("a hanging arm with an unseen wrist does not spoil 'one hand up'", () => {
    const k = ONE();
    k.pts.rw.v = 0.02;
    expect(poseMatches("oneHand", k)).toBe(true);
  });

  it("mirrored image (left shoulder on the other side) gives the same answer", () => {
    const k = OUT();
    const m = kidAt(90, 90);
    // swap the sides: ls at -x
    const sw = (a: PtV, b: PtV): void => {
      const t = { ...a };
      a.x = b.x;
      a.y = b.y;
      b.x = t.x;
      b.y = t.y;
    };
    sw(m.pts.ls, m.pts.rs);
    sw(m.pts.lw, m.pts.rw);
    expect(poseMatches("armsOut", m)).toBe(poseMatches("armsOut", k));
    const u = ONE();
    const um = ONE();
    sw(um.pts.ls, um.pts.rs);
    sw(um.pts.lw, um.pts.rw);
    expect(poseMatches("oneHand", um)).toBe(true);
    expect(poseMatches("oneHand", u)).toBe(true);
  });

  it("with heavy tracking noise (jitter ~12 degrees) the hold gate still passes the right pose and rejects a wrong one", () => {
    const poses: [PoseId, (o: KidOpts) => PoseKid][] = [
      ["handsUp", UP],
      ["armsOut", OUT],
      ["star", STAR],
      ["squat", SQUAT],
      ["oneHand", ONE],
    ];
    const wrong: Record<PoseId, (o: KidOpts) => PoseKid> = { handsUp: OUT, armsOut: ONE, star: DOWN, squat: UP, oneHand: UP };
    let pass = 0;
    let falsePass = 0;
    const N = 60;
    for (let seed = 1; seed <= N; seed++) {
      for (const [id, mk] of poses) {
        const rnd = seeded(seed * 31 + id.length);
        const gate = new HoldGate();
        const bad = new HoldGate();
        for (let f = 0; f < 60; f++) {
          // 1 s at 60 fps... the detection rate of weak PCs is lower, the kit repeats frames: 2 frames per sample
          const o: KidOpts = { noise: 0.28, rnd };
          if (f % 2 === 0) {
            gate.step(poseMatches(id, mk(o)), true, 1 / 30);
            bad.step(poseMatches(id, wrong[id](o)), true, 1 / 30);
          }
        }
        if (gate.ok) pass++;
        if (bad.ok) falsePass++;
      }
    }
    expect(pass / (N * poses.length)).toBeGreaterThan(0.97);
    expect(falsePass / (N * poses.length)).toBeLessThan(0.03);
  });
});

describe("HoldGate", () => {
  it("needs ~0.3 s of holding, forgives single noisy frames, freezes while the child is out of view", () => {
    const g = new HoldGate();
    for (let i = 0; i < 5; i++) g.step(true, true, 1 / 30); // 0.17 s
    expect(g.ok).toBe(false);
    for (let i = 0; i < 6; i++) g.step(true, true, 1 / 30); // 0.37 s
    expect(g.ok).toBe(true);
    g.step(false, true, 1 / 30); // one bad frame
    expect(g.ok).toBe(true);
    const h = g.hold;
    for (let i = 0; i < 90; i++) g.step(false, false, 1 / 30); // gone for 3 s: frozen
    expect(g.hold).toBe(h);
    for (let i = 0; i < 60; i++) g.step(false, true, 1 / 30); // 2 s of another pose
    expect(g.ok).toBe(false);
  });

  it("a lone false-positive frame (5%) never gives the pass", () => {
    const rnd = seeded(5);
    const g = new HoldGate();
    let ok = false;
    for (let i = 0; i < 300; i++) {
      g.step(rnd() < 0.05, true, 1 / 30);
      if (g.ok) ok = true;
    }
    expect(ok).toBe(false);
  });
});

describe("Deck", () => {
  it("starts with hands up, never repeats a pose twice in a row, plays all five in every bag", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = new Deck(seeded(seed));
      expect(d.next()).toBe("handsUp");
      const got: PoseId[] = [];
      for (let i = 0; i < 200; i++) got.push(d.next());
      expect(got[0]).not.toBe("handsUp");
      for (let i = 1; i < got.length; i++) expect(got[i]).not.toBe(got[i - 1]);
      for (let b = 0; b + 5 <= 200; b += 5) expect(new Set(got.slice(b, b + 5)).size).toBe(5);
    }
  });

  it("?seq= is a fixed cycle; unknown names are ignored", () => {
    expect(parseSeq("handsUp, armsOut,nope,squat")).toEqual(["handsUp", "armsOut", "squat"]);
    expect(parseSeq(null)).toEqual([]);
    const d = new Deck(Math.random, parseSeq("armsOut,star"));
    expect([d.next(), d.next(), d.next()]).toEqual(["armsOut", "star", "armsOut"]);
  });
});

// ------------------------------------------------------------------ the round flow
type Ev = { k: string; a?: unknown; b?: unknown; c?: unknown };

function mkRound(seq: PoseId[] = ["handsUp", "armsOut"]) {
  const ev: Ev[] = [];
  const hooks: RoundHooks = {
    spawn: (p, i, h) => ev.push({ k: "spawn", a: p.id, b: i, c: h }),
    chime: (n) => ev.push({ k: "chime", a: n }),
    judge: (s, ok) => ev.push({ k: "judge", a: s, b: ok }),
    result: (p, t, all) => ev.push({ k: "result", a: p, b: t, c: all }),
  };
  const round = new Round(new Deck(Math.random, seq), hooks);
  return { round, ev };
}

function slots(specs: (PoseKid | null)[], present: (boolean | undefined)[] = []): RoundKid[] {
  const none = DOWN();
  return Array.from({ length: 5 }, (_, i) => {
    const s = specs[i];
    return { ...(s ?? none), slot: i, active: s !== null && s !== undefined, present: present[i] ?? (s !== null && s !== undefined) } as RoundKid;
  });
}

/** runs the round for `sec` seconds at 30 fps; `kids` may be a function of the time since the start */
function run(r: Round, sec: number, kids: RoundKid[] | ((t: number) => RoundKid[]), left = 60, t0 = 0): number {
  const dt = 1 / 30;
  let t = t0;
  for (let i = 0; i < Math.round(sec / dt); i++) {
    t += dt;
    if (r.update(dt, typeof kids === "function" ? kids(t) : kids, left) === "finish") return -t;
  }
  return t;
}

describe("Round flow", () => {
  it("a wall comes in about 6.5 s: spawn, countdown chimes 3-2-1, arrival, judgement, result, next wall", () => {
    const { round, ev } = mkRound();
    round.begin();
    const kids = slots([UP(), UP(), DOWN()]);
    run(round, ROUND_CFG.lead + 0.1, kids);
    expect(ev.filter((e) => e.k === "spawn")).toEqual([{ k: "spawn", a: "handsUp", b: 0, c: 3 }]);
    expect(round.phase).toBe("approach");
    // chimes: exactly 3, 2, 1, at 3 / 2 / 1 s before the arrival
    const chimeAt: Record<number, number> = {};
    let t = 0;
    while (round.phase === "approach") {
      round.update(1 / 60, kids, 60);
      t += 1 / 60;
      for (const e of ev) if (e.k === "chime" && chimeAt[e.a as number] === undefined) chimeAt[e.a as number] = t;
    }
    expect(ev.filter((e) => e.k === "chime").map((e) => e.a)).toEqual([3, 2, 1]);
    expect(Math.abs(ROUND_CFG.approach - 3 - (chimeAt[3] + 0.1))).toBeLessThan(0.1);
    expect(Math.abs(ROUND_CFG.approach - 1 - (chimeAt[1] + 0.1))).toBeLessThan(0.1);
    // judged at the arrival
    expect(ev.filter((e) => e.k === "judge")).toEqual([
      { k: "judge", a: 0, b: true },
      { k: "judge", a: 1, b: true },
      { k: "judge", a: 2, b: false },
    ]);
    expect(ev[ev.length - 1]).toEqual({ k: "result", a: 2, b: 3, c: false });
    expect(round.phase).toBe("result");
    expect(Array.from(round.results)).toEqual([1, 1, 2, 0, 0]);
    expect(ROUND_CFG.lead + ROUND_CFG.approach + ROUND_CFG.result).toBeGreaterThanOrEqual(6);
    expect(ROUND_CFG.approach + ROUND_CFG.result + ROUND_CFG.gap).toBeLessThanOrEqual(7.5);
    // after the result and the gap the next wall (another pose) comes
    run(round, ROUND_CFG.result + ROUND_CFG.gap + 0.1, kids);
    expect(ev.filter((e) => e.k === "spawn").map((e) => e.a)).toEqual(["handsUp", "armsOut"]);
    expect(round.index).toBe(1);
    expect(round.passTotal).toBe(2);
    expect(round.bumpTotal).toBe(1);
  });

  it("everybody passes -> `all` (the group bonus); one child alone passing is not a group", () => {
    const a = mkRound();
    a.round.begin();
    run(a.round, ROUND_CFG.lead + ROUND_CFG.approach + 0.1, slots([UP(), UP(), UP(), UP()]));
    expect(a.ev[a.ev.length - 1]).toEqual({ k: "result", a: 4, b: 4, c: true });
    expect(a.round.allCount).toBe(1);
    expect(a.round.holes).toBe(3);

    const b = mkRound();
    b.round.begin();
    run(b.round, ROUND_CFG.lead + ROUND_CFG.approach + 0.1, slots([UP()]));
    expect(b.ev[b.ev.length - 1]).toEqual({ k: "result", a: 1, b: 1, c: false });
    expect(b.round.holes).toBe(1);
    expect(b.round.allCount).toBe(0);
  });

  it("nobody is punished: a bump is only an event, the next wall always comes, no matter how many children miss", () => {
    const { round, ev } = mkRound();
    round.begin();
    const t = run(round, 30, slots([DOWN(), DOWN(), DOWN()]));
    expect(t).toBeGreaterThan(0);
    expect(ev.filter((e) => e.k === "spawn").length).toBeGreaterThanOrEqual(4);
    expect(round.passTotal).toBe(0);
    expect(round.bumpTotal).toBeGreaterThanOrEqual(9);
  });

  it("poses held only before the arming point do not count; a pose taken in the last second does; flicker is forgiven", () => {
    // kid 0: pose only during the first 20% of the approach; kid 1: pose only in the last 0.7 s; kid 2: flickers 75% of the frames
    const { round, ev } = mkRound();
    round.begin();
    const rnd = seeded(3);
    const kidsAt = (t: number): RoundKid[] => {
      const s = t - ROUND_CFG.lead;
      return slots([s < ROUND_CFG.approach * 0.2 ? UP() : DOWN(), s > ROUND_CFG.approach - 0.7 ? UP() : DOWN(), rnd() < 0.75 ? UP() : DOWN()]);
    };
    run(round, ROUND_CFG.lead + ROUND_CFG.approach + 0.1, kidsAt);
    const judged = ev.filter((e) => e.k === "judge").map((e) => e.b);
    expect(judged).toEqual([false, true, true]);
  });

  it("a child who is out of the picture at the arrival is not judged, one who flickered away after holding still passes", () => {
    const { round, ev } = mkRound();
    round.begin();
    const kidsAt = (t: number): RoundKid[] => {
      const s = t - ROUND_CFG.lead;
      const late = s > ROUND_CFG.approach - 0.15; // both kids vanish just before the wall arrives
      return slots([UP(), UP(), DOWN()], [!late, false, true]);
    };
    // kid 1 was never present (frozen gate) -> no pass, not judged; kid 0 held the pose then flickered -> passes
    run(round, ROUND_CFG.lead + ROUND_CFG.approach + 0.1, kidsAt);
    const j = ev.filter((e) => e.k === "judge");
    expect(j).toEqual([
      { k: "judge", a: 0, b: true },
      { k: "judge", a: 2, b: false },
    ]);
    expect(ev[ev.length - 1]).toEqual({ k: "result", a: 1, b: 2, c: false });
  });

  it("nobody in the picture: the wall just comes and goes, no judge, no result spam", () => {
    const { round, ev } = mkRound();
    round.begin();
    run(round, 10, slots([]));
    expect(ev.filter((e) => e.k === "judge").length).toBe(0);
    expect(ev.filter((e) => e.k === "result")[0]).toEqual({ k: "result", a: 0, b: 0, c: false });
  });

  it("does not start a wall when the round is nearly over (finish), but always starts the first one", () => {
    const { round, ev } = mkRound();
    round.begin();
    const kids = slots([UP(), UP()]);
    expect(run(round, 2, kids, 4)).toBeGreaterThan(0); // first wall starts even with little time
    expect(ev[0].k).toBe("spawn");
    const t = run(round, 10, kids, 5.9, 2);
    expect(t).toBeLessThan(0); // finished after the first wall's result
    expect(round.index).toBe(0);
  });

  it("update before begin() is a no-op", () => {
    const { round, ev } = mkRound();
    expect(run(round, 5, slots([UP()]))).toBeGreaterThan(0);
    expect(ev.length).toBe(0);
  });
});

// ------------------------------------------------------------------ paint
const ctxMock = (): CanvasRenderingContext2D => {
  const calls = { n: 0 };
  return new Proxy(calls, { get: (t, k) => (k === "n" ? t.n : () => void t.n++), set: () => true }) as unknown as CanvasRenderingContext2D;
};

describe("paint", () => {
  it("the wall perspective: starts small and far, accelerates, ends at the full stage; flies through bigger", () => {
    expect(approachScale(0)).toBeCloseTo(1 / (1 + FAR), 5);
    expect(approachScale(1)).toBe(1);
    let last = 0;
    let lastStep = 0;
    for (let i = 0; i <= 20; i++) {
      const s = approachScale(i / 20);
      expect(s).toBeGreaterThan(last);
      if (i > 1) expect(s - last).toBeGreaterThanOrEqual(lastStep - 1e-9); // accelerating
      lastStep = s - last;
      last = s;
    }
    expect(throughScale(0)).toBe(1);
    expect(throughScale(1)).toBeGreaterThan(2);
  });

  it("paints a bounded number of canvas calls and its particle pool stays bounded", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { round } = mkRound(["star"]);
    round.begin();
    const kids = slots([STAR(), STAR(), STAR(), STAR(), STAR()]);
    const tr = new KidTracker();
    const painter = new Painter(seeded(1));
    const ctx = ctxMock();
    let worst = 0;
    for (let f = 0; f < 60 * 9; f++) {
      round.update(1 / 60, kids, 60);
      const before = (ctx as unknown as { n: number }).n;
      painter.drawBack(ctx, 1280, 720, f * 16.7, round);
      painter.drawFront(ctx, 1280, 720, f * 16.7, round, tr.slots);
      worst = Math.max(worst, (ctx as unknown as { n: number }).n - before);
      if (f % 20 === 0) {
        painter.burst(300, 300, 12, 1, 300);
        painter.confetti(1280, 720);
      }
    }
    expect(worst).toBeLessThan(160);
    expect(painter.sparkCount).toBeLessThanOrEqual(72);
    vi.restoreAllMocks();
  });
});

describe("sounds", () => {
  it("are silent without an audio graph and one note per slot", () => {
    const s = new WallSounds(() => null);
    expect(() => {
      s.whoosh();
      s.chime(3);
      s.arrive();
      s.passed(0);
      s.bump();
      s.fanfare();
    }).not.toThrow();
    expect(SLOT_MIDI.length).toBe(5);
    expect(new Set(SLOT_MIDI).size).toBe(5);
  });
});

// ------------------------------------------------------------------ the whole game on the real kid tracker
const W = 1280;
const H = 720;

describe("devor-bolalar on the kids kit", () => {
  type Kid = SkeletonOpts & { cx: number };
  const fit = computeFit(W, H, W, H);

  function setup(query: string) {
    const tr = new KidTracker();
    let fn: ((c: CanvasRenderingContext2D, e: EngineApi, n: number) => void) | null = null;
    let result: unknown = null;
    const popup = vi.fn();
    const engine = {
      state: "play",
      kidSlots: tr.slots,
      query: new URLSearchParams(query),
      stage: { w: W, h: H, dpr: 1 },
      audio: { graph: () => null },
      fx: { popup },
      onDraw: (f: typeof fn) => {
        fn = f;
        return () => {
          fn = null;
        };
      },
      finish: (r: unknown) => {
        result ??= r;
      },
    } as unknown as EngineApi;
    const ctx = ctxMock();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const run = startKidsGame(engine, devorDef);
    let t = 1000;
    let frame = 0;
    const step = (kids: Kid[]): void => {
      t += 1000 / 60;
      if (frame++ % 2 === 0) {
        tr.update(buildPeople({ landmarks: kids.map((k) => makeSkeleton({ h: 0.5, top: 0.2, ...k })) }, fit), t, t, W);
      }
      tr.extrapolate(t, 0);
      fn?.(ctx, engine, t);
      tr.endFrame();
    };
    return { tr, run, step, result: () => result, popup, now: () => t };
  }

  it("two children in the pose pass, the third gets a bump and no star; then everybody passes: group bonus; ends with the result", () => {
    const dbg = (): { results: number[]; allCount: number; index: number } => (window as unknown as { __devor: { results: number[]; allCount: number; index: number } }).__devor;
    const g = setup("duration=20&seq=handsUp&debug=1");
    const up: Kid[] = [{ cx: 0.8, armL: "up", armR: "up" }, { cx: 0.5 }, { cx: 0.2, armL: "up", armR: "up" }];
    const all: Kid[] = [{ cx: 0.8, armL: "up", armR: "up" }, { cx: 0.5, armL: "up", armR: "up" }, { cx: 0.2, armL: "up", armR: "up" }];
    // wall 1: lead 0.8 + approach 5.2 -> judged at ~6 s
    for (let i = 0; i < 60 * 6.3; i++) g.step(up);
    expect(dbg().index).toBe(0);
    expect(dbg().results.slice(0, 3)).toEqual([1, 2, 1]);
    expect(Array.from(g.run.kit.perKid)).toEqual([1, 0, 1, 0, 0]);
    expect(g.run.kit.stars).toBe(2);
    expect(g.popup).toHaveBeenCalled();
    // wall 2 (the same pose again by ?seq): everybody holds it -> everybody passes + the group bonus
    for (let i = 0; i < 60 * 7.4; i++) g.step(all);
    expect(dbg().index).toBe(1);
    expect(dbg().allCount).toBe(1);
    expect(Array.from(g.run.kit.perKid)).toEqual([2, 1, 2, 0, 0]);
    expect(g.run.kit.stars).toBe(5 + ALL_BONUS);
    // not enough time left for a third wall: the round finishes by itself
    for (let i = 0; i < 60 * 3 && !g.result(); i++) g.step(all);
    const r = g.result() as { score: number; kids: { slot: number; stars: number }[] } | null;
    expect(r).not.toBeNull();
    expect(r?.score).toBe(5 + ALL_BONUS);
    expect(r?.kids.map((k) => k.slot)).toEqual([0, 1, 2]);
    expect(r?.kids[1].stars).toBe(1); // took part: at least one star
    g.run.dispose();
    expect((window as unknown as { __devor?: unknown }).__devor).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("squat and one-hand walls work with the real tracker signals", () => {
    const dbg = (): { results: number[]; pose: string } => (window as unknown as { __devor: { results: number[]; pose: string } }).__devor;
    const g = setup("duration=40&seq=oneHand,armsOut&debug=1");
    // standing still first so the squat baseline settles
    const one: Kid[] = [{ cx: 0.8, armL: "up", armR: "down" }, { cx: 0.5, armL: "up", armR: "up" }, { cx: 0.2, armL: "down", armR: "up" }];
    for (let i = 0; i < 60 * 6.3; i++) g.step(one);
    expect(dbg().pose).toBe("oneHand");
    // two kids raised one hand (either), the one with both hands up is not "one hand"
    expect(dbg().results.slice(0, 3)).toEqual([1, 2, 1]);
    const out: Kid[] = [{ cx: 0.8, armL: "shoulder", armR: "shoulder" }, { cx: 0.5, armL: "shoulder", armR: "shoulder" }, { cx: 0.2, armL: "down", armR: "down" }];
    for (let i = 0; i < 60 * 7.4; i++) g.step(out);
    expect(dbg().pose).toBe("armsOut");
    expect(dbg().results.slice(0, 3)).toEqual([1, 1, 2]);
    g.run.dispose();
    vi.restoreAllMocks();
  });

  it("the squat wall: the child who squats (hips drop) passes, the one who stays up gets the bump", () => {
    const dbg = (): { results: number[]; pose: string } => (window as unknown as { __devor: { results: number[]; pose: string } }).__devor;
    const g = setup("duration=40&seq=squat&debug=1");
    const stand: Kid[] = [{ cx: 0.8 }, { cx: 0.5 }, { cx: 0.2 }];
    for (let i = 0; i < 60 * 2; i++) g.step(stand); // the standing baseline settles
    const sq: Kid[] = [{ cx: 0.8, top: 0.3 }, { cx: 0.5 }, { cx: 0.2, top: 0.3 }];
    for (let i = 0; i < 60 * 4.6; i++) g.step(sq);
    expect(dbg().pose).toBe("squat");
    expect(dbg().results.slice(0, 3)).toEqual([1, 2, 1]);
    g.run.dispose();
    vi.restoreAllMocks();
  });

  it("poseById / registered prompts are consistent", () => {
    for (const id of POSE_IDS) expect(poseById(id).id).toBe(id);
  });
});
