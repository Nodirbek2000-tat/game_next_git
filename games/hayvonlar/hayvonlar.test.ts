import { describe, expect, it, vi } from "vitest";
import type { EngineApi } from "@/engine";
import { buildPeople, computeFit } from "@/engine/tracking/people";
import { KidTracker } from "@/engine/tracking/kids";
import { makeSkeleton, type SkeletonOpts } from "@/engine/testing/skeleton";
import { PROMPTS, startKidsGame } from "../bogcha/common";
import { ANIMALS, ANIMAL_IDS, registerPrompts, type AnimalDef, type Move } from "./animals";
import { hayvonlarDef } from "./game";
import { KidProgress, MOVE_CFG, type MoveSignals } from "./moves";
import { MOVE_PERIOD, motionAt, newMotion } from "./motion";
import { Painter } from "./paint";
import { Round, ROUND_CFG, type KidLike, type RoundHooks } from "./round";
import { Deck, parseSeq } from "./sequence";
import { ANIMAL_SOUNDS } from "./sounds";

const sig = (o: Partial<Omit<MoveSignals, "handUp">> & { handUp?: { L: boolean; R: boolean } } = {}): MoveSignals => ({
  jumpFired: false,
  squat: false,
  clapFired: false,
  handsUp: false,
  handUp: { L: false, R: false },
  wave: false,
  armsOut: false,
  ...o,
});

/** feeds `frames` render frames of 1/30 s */
function run(p: KidProgress, move: Move, frames: number, s: MoveSignals | ((i: number) => MoveSignals)): boolean {
  let fired = false;
  for (let i = 0; i < frames; i++) if (p.step(move, typeof s === "function" ? s(i) : s, 1 / 30)) fired = true;
  return fired;
}

describe("animals", () => {
  it("six animals, one move each, Uzbek Latin prompts", () => {
    expect(ANIMAL_IDS).toEqual(["quyon", "qush", "baqa", "ayiq", "pingvin", "toshbaqa"]);
    expect(ANIMALS.map((a) => a.move)).toEqual(["jump", "flap", "froghop", "handsUp", "clap", "slowSquat"]);
    expect(ANIMALS.map((a) => a.emoji)).toEqual(["🐰", "🐦", "🐸", "🐻", "🐧", "🐢"]);
    registerPrompts();
    for (const a of ANIMALS) {
      expect(PROMPTS[a.promptId as keyof typeof PROMPTS].text).toBe(a.text);
      expect([...a.text].some((c) => c.charCodeAt(0) >= 0x400 && c.charCodeAt(0) <= 0x4ff)).toBe(false);
    }
    expect(ANIMALS[0].text).toBe("Quyonchadek sakrang!");
  });

  it("every animal has its own short synthesised voice", () => {
    const seen = new Set<string>();
    for (const id of ANIMAL_IDS) {
      const notes = ANIMAL_SOUNDS[id];
      expect(notes.length).toBeGreaterThan(1);
      let end = 0;
      for (const [hz, hz2, at, len, , vol] of notes) {
        expect(hz).toBeGreaterThan(20);
        expect(hz2).toBeGreaterThan(20);
        expect(vol).toBeGreaterThan(0);
        expect(vol).toBeLessThanOrEqual(0.4);
        end = Math.max(end, at + len);
      }
      expect(end).toBeLessThan(1.4);
      seen.add(JSON.stringify(notes));
    }
    expect(seen.size).toBe(6);
  });
});

describe("sequence", () => {
  it("shows all six animals before any repeats and never the same one twice in a row", () => {
    let seed = 3;
    const rng = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const d = new Deck(rng);
    const got: string[] = [];
    for (let i = 0; i < 600; i++) got.push(d.next());
    for (let b = 0; b < 100; b++) expect(new Set(got.slice(b * 6, b * 6 + 6)).size).toBe(6);
    for (let i = 1; i < got.length; i++) expect(got[i]).not.toBe(got[i - 1]);
    // not always the same order
    expect(new Set(Array.from({ length: 20 }, (_, b) => got.slice(b * 6, b * 6 + 6).join())).size).toBeGreaterThan(5);
  });

  it("?seq forces the first animals, ignores junk, then the bag continues", () => {
    expect(parseSeq("quyon, pingvin,xx,BAQA")).toEqual(["quyon", "pingvin", "baqa"]);
    expect(parseSeq(null)).toEqual([]);
    const d = new Deck(Math.random, parseSeq("pingvin,quyon"));
    expect([d.next(), d.next()]).toEqual(["pingvin", "quyon"]);
    const rest = Array.from({ length: 6 }, () => d.next());
    expect(new Set(rest).size).toBe(6);
    expect(rest[0]).not.toBe("quyon");
  });
});

describe("per-child move decisions", () => {
  it("jump: only the jump event counts, once", () => {
    const p = new KidProgress();
    expect(run(p, "jump", 60, sig({ squat: true, handsUp: true, clapFired: true, armsOut: true }))).toBe(false);
    expect(run(p, "jump", 1, sig({ jumpFired: true }))).toBe(true);
    expect(p.done).toBe(true);
    expect(run(p, "jump", 1, sig({ jumpFired: true }))).toBe(false); // never twice
  });

  it("clap: a clap event", () => {
    const p = new KidProgress();
    expect(run(p, "clap", 90, sig({ jumpFired: true, handsUp: true }))).toBe(false);
    expect(run(p, "clap", 1, sig({ clapFired: true }))).toBe(true);
  });

  it("flap: arms out / waving counts even when the detection flickers; standing still does not", () => {
    const p = new KidProgress();
    expect(run(p, "flap", 120, sig())).toBe(false);
    // flapping: arms out about 45 % of the time
    expect(run(p, "flap", 120, (i) => sig({ armsOut: i % 10 < 4.5 }))).toBe(true);
    const q = new KidProgress();
    expect(run(q, "flap", 12, sig({ wave: true }))).toBe(false); // 0.4 s
    expect(run(q, "flap", 12, sig({ wave: true }))).toBe(true); // 0.8 s
    const r = new KidProgress();
    expect(run(r, "flap", Math.ceil(MOVE_CFG.flapNeed * 30) + 1, sig({ armsOut: true }))).toBe(true);
  });

  it("frog: needs a squat and then a jump", () => {
    const jumpOnly = new KidProgress();
    expect(run(jumpOnly, "froghop", 1, sig({ jumpFired: true }))).toBe(false);
    const squatOnly = new KidProgress();
    expect(run(squatOnly, "froghop", 150, sig({ squat: true }))).toBe(false);
    const both = new KidProgress();
    run(both, "froghop", 9, sig({ squat: true })); // 0.3 s down
    run(both, "froghop", 3, sig()); // coming up
    expect(run(both, "froghop", 1, sig({ jumpFired: true }))).toBe(true);
    // a jump long after the squat is not a frog hop
    const late = new KidProgress();
    run(late, "froghop", 9, sig({ squat: true }));
    run(late, "froghop", Math.ceil((MOVE_CFG.frogWindow + 0.3) * 30), sig());
    expect(run(late, "froghop", 1, sig({ jumpFired: true }))).toBe(false);
    // a flicker of squat shorter than the minimum does not arm it
    const blip = new KidProgress();
    run(blip, "froghop", 2, sig({ squat: true }));
    expect(run(blip, "froghop", 1, sig({ jumpFired: true }))).toBe(false);
  });

  it("bear: both hands up for a moment, or one hand for a while", () => {
    const none = new KidProgress();
    expect(run(none, "handsUp", 150, sig())).toBe(false);
    const both = new KidProgress();
    expect(run(both, "handsUp", 5, sig({ handsUp: true, handUp: { L: true, R: true } }))).toBe(false);
    expect(run(both, "handsUp", 8, sig({ handsUp: true, handUp: { L: true, R: true } }))).toBe(true);
    const one = new KidProgress();
    expect(run(one, "handsUp", 20, sig({ handUp: { L: false, R: true } }))).toBe(false); // 0.67 s
    expect(run(one, "handsUp", 30, sig({ handUp: { L: false, R: true } }))).toBe(true);
  });

  it("turtle: a squat held for a moment (not a flicker)", () => {
    const p = new KidProgress();
    expect(run(p, "slowSquat", 12, sig({ squat: true }))).toBe(false);
    expect(run(p, "slowSquat", 10, sig())).toBe(false);
    expect(run(p, "slowSquat", 30, sig({ squat: true }))).toBe(true);
    const q = new KidProgress();
    expect(run(q, "slowSquat", 150, sig({ jumpFired: true, handsUp: true }))).toBe(false);
  });

  it("reset clears everything", () => {
    const p = new KidProgress();
    run(p, "jump", 1, sig({ jumpFired: true }));
    p.reset();
    expect(p.done).toBe(false);
    expect(run(p, "jump", 1, sig({ jumpFired: true }))).toBe(true);
  });
});

// ------------------------------------------------------------------ the director
function kidLike(slot: number, sg: MoveSignals, present = true): KidLike {
  return { slot, active: true, present, signals: sg as unknown as KidLike["signals"] };
}

function director(forced: string, hooksOver: Partial<RoundHooks> = {}) {
  const log: string[] = [];
  const hooks: RoundHooks = {
    start: (a, i) => log.push(`start:${a.id}:${i}`),
    prompt: (a) => log.push(`prompt:${a.id}`),
    done: (k, a, first) => log.push(`done:${k.slot}:${a.id}:${first ? "first" : "next"}`),
    end: (a, any) => log.push(`end:${a.id}:${any}`),
    ...hooksOver,
  };
  const round = new Round(new Deck(Math.random, parseSeq(forced)), hooks);
  return { round, log };
}

const DT = 1 / 30;
function tick(round: Round, sec: number, kids: readonly KidLike[] | ((t: number) => readonly KidLike[]), timeLeft = 60): void {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) round.update(DT, typeof kids === "function" ? kids(i * DT) : kids, timeLeft);
}

describe("challenge sequencing", () => {
  it("animal appears, prompt after ~1 s, each child is judged separately, the challenge ends after 8 s, next animal", () => {
    const { round, log } = director("quyon,pingvin");
    round.begin();
    expect(log).toEqual(["start:quyon:0"]);
    expect(round.phase).toBe("act");
    const idle = sig();
    // kid 0 and kid 2 jump at ~2 s and ~3 s, kid 1 never
    const kids = (t: number): KidLike[] => [kidLike(0, sig({ jumpFired: Math.abs(t - 2) < DT / 2 })), kidLike(1, idle), kidLike(2, sig({ jumpFired: Math.abs(t - 3) < DT / 2 }))];
    tick(round, ROUND_CFG.act - 0.2, kids);
    expect(log.filter((l) => l.startsWith("prompt"))).toEqual(["prompt:quyon"]);
    expect(log.filter((l) => l.startsWith("done"))).toEqual(["done:0:quyon:first", "done:2:quyon:next"]);
    expect(round.progress.map((p) => p.done)).toEqual([true, false, true, false, false]);
    expect(round.phase).toBe("act"); // kid 1 is still being waited for
    tick(round, 0.5, kids);
    expect(round.phase).toBe("praise");
    expect(log).toContain("end:quyon:true");
    tick(round, ROUND_CFG.praise + 0.1, kids);
    expect(round.phase).toBe("act");
    expect(round.animal.id).toBe("pingvin");
    expect(round.index).toBe(1);
    expect(round.progress.every((p) => !p.done)).toBe(true); // fresh start for everybody
  });

  it("ends early (after a short pause) when every child in the picture did it", () => {
    const { round, log } = director("quyon");
    round.begin();
    const kids = [kidLike(0, sig({ jumpFired: true })), kidLike(3, sig({ jumpFired: true }))];
    tick(round, 0.8 + DT * 2, kids);
    expect(log.filter((l) => l.startsWith("done")).length).toBe(2);
    expect(round.phase).toBe("act");
    tick(round, ROUND_CFG.allDoneHold + 0.2, [kidLike(0, sig()), kidLike(3, sig())]);
    expect(round.phase).toBe("praise");
  });

  it("does not count moves in the first moment of a challenge (the previous pose)", () => {
    const { round, log } = director("quyon");
    round.begin();
    tick(round, ROUND_CFG.armAt - 0.1, [kidLike(0, sig({ jumpFired: true }))]);
    expect(log.some((l) => l.startsWith("done"))).toBe(false);
  });

  it("children who are absent or inactive are not waited for and get no stars", () => {
    const { round, log } = director("quyon");
    round.begin();
    const away = kidLike(1, sig({ jumpFired: true }), false);
    const gone: KidLike = { slot: 2, active: false, present: false, signals: sig({ jumpFired: true }) as unknown as KidLike["signals"] };
    tick(round, 1.3, [kidLike(0, sig({ jumpFired: true })), away, gone]);
    expect(log.filter((l) => l.startsWith("done"))).toEqual(["done:0:quyon:first"]);
    tick(round, 1.2, [kidLike(0, sig()), away, gone]);
    expect(round.phase).toBe("praise"); // the only child in the picture was done
  });

  it("a child who joins in the middle can still take part", () => {
    const { round, log } = director("pingvin");
    round.begin();
    tick(round, 3, [kidLike(0, sig())]);
    tick(round, 0.5, [kidLike(0, sig()), kidLike(4, sig({ clapFired: true }))]);
    expect(log).toContain("done:4:pingvin:first");
  });

  it("nobody does it: no stars, no punishment, the next animal comes", () => {
    const { round, log } = director("ayiq,qush");
    round.begin();
    tick(round, ROUND_CFG.act + 0.1, [kidLike(0, sig()), kidLike(1, sig())]);
    expect(log).toContain("end:ayiq:false");
    tick(round, ROUND_CFG.praise + 0.1, [kidLike(0, sig())]);
    expect(round.animal.id).toBe("qush");
  });

  it("an empty room just runs the clock", () => {
    const { round } = director("quyon");
    round.begin();
    tick(round, ROUND_CFG.act + 0.1, []);
    expect(round.phase).toBe("praise");
  });

  it("asks the game to finish instead of starting an animal when almost no time is left", () => {
    const { round, log } = director("quyon,qush");
    round.begin();
    tick(round, ROUND_CFG.act + 0.1, []);
    let r: "finish" | undefined;
    for (let i = 0; i < 100 && !r; i++) r = round.update(DT, [], ROUND_CFG.minLeft - 0.1);
    expect(r).toBe("finish");
    expect(log.filter((l) => l.startsWith("start")).length).toBe(1);
  });

  it("a whole 84 s round: 8-9 challenges, all six animals in the first six, none started when it cannot be finished", () => {
    let timeLeft = 84;
    const lefts: number[] = [];
    const { round, log } = director("", { start: () => lefts.push(timeLeft) });
    round.begin();
    const kids = [kidLike(0, sig()), kidLike(1, sig())];
    let finished = false;
    for (let i = 0; i < 90 * 30 && !finished; i++) {
      timeLeft -= DT;
      if (round.update(DT, kids, Math.max(0, timeLeft)) === "finish") finished = true;
    }
    expect(lefts.length).toBeGreaterThanOrEqual(8);
    expect(lefts.length).toBeLessThanOrEqual(9);
    for (const l of lefts) expect(l).toBeGreaterThanOrEqual(ROUND_CFG.minLeft - 1e-6);
    expect(finished || timeLeft <= 0).toBe(true);
    expect(log.length).toBeGreaterThan(8);
  });
});

describe("demonstration motion", () => {
  it("is finite, bounded and loops for every move", () => {
    const m = newMotion();
    const moves = Object.keys(MOVE_PERIOD) as Move[];
    for (const mv of moves) {
      for (let t = 0; t < 12; t += 0.037) {
        motionAt(mv, t, m);
        for (const v of [m.dy, m.sx, m.sy, m.rot, m.arm, m.crouch, m.lift]) expect(Number.isFinite(v)).toBe(true);
        expect(m.arm).toBeGreaterThanOrEqual(0);
        expect(m.arm).toBeLessThanOrEqual(1);
        expect(m.crouch).toBeGreaterThanOrEqual(0);
        expect(m.crouch).toBeLessThanOrEqual(1);
        expect(m.sx).toBeGreaterThan(0.6);
        expect(m.sy).toBeGreaterThan(0.6);
      }
      const a = { ...motionAt(mv, 0.3, newMotion()) };
      const b = { ...motionAt(mv, 0.3 + MOVE_PERIOD[mv] * 3, newMotion()) };
      expect(b.dy).toBeCloseTo(a.dy, 6);
      expect(b.arm).toBeCloseTo(a.arm, 6);
    }
    // the squat moves really go down, the hop really goes up
    const g = { ...motionAt("slowSquat", 2, newMotion()) };
    expect(g.crouch).toBeGreaterThan(0.9);
    const j = { ...motionAt("jump", MOVE_PERIOD.jump / 2, newMotion()) };
    expect(j.dy).toBeLessThan(-0.1);
  });
});

// ------------------------------------------------------------------ the whole game on the real kid tracker
const W = 1280;
const H = 720;
const ctxMock = (): CanvasRenderingContext2D => {
  const calls = { n: 0 };
  return new Proxy(calls, { get: (t, k) => (k === "n" ? t.n : () => void t.n++), set: () => true }) as unknown as CanvasRenderingContext2D;
};

describe("hayvonlar on the kids kit", () => {
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
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); // jsdom has no canvas: emoji fall back to text
    const run = startKidsGame(engine, hayvonlarDef);
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

  it("children who jump get stars for the rabbit, the one who stands still does not; the round ends with Barakalla", () => {
    const g = setup("duration=14&seq=quyon,pingvin");
    const jumper = (cx: number, since: number): Kid => {
      const s = (g.now() - 1000) / 1000 - since;
      return { cx, top: s > 0 ? 0.2 - 0.1 * Math.max(0, Math.sin((s / 1.2) * Math.PI * 2)) : 0.2 };
    };
    for (let i = 0; i < 60 * 9; i++) g.step([jumper(0.8, 1.2), { cx: 0.5 }, jumper(0.2, 1.4)]);
    const per = g.run.kit.perKid;
    expect(per[0]).toBeGreaterThanOrEqual(1);
    expect(per[1]).toBe(0);
    expect(per[2]).toBeGreaterThanOrEqual(1);
    expect(per[3] + per[4]).toBe(0);
    expect(g.popup).toHaveBeenCalled();
    // keep going until the round time (14 s) is over
    for (let i = 0; i < 60 * 8 && !g.result(); i++) g.step([{ cx: 0.8 }, { cx: 0.5 }, { cx: 0.2 }]);
    const r = g.result() as { score: number; kids: { slot: number; stars: number }[] } | null;
    expect(r).not.toBeNull();
    expect(r?.kids.map((k) => k.slot)).toEqual([0, 1, 2]);
    expect(r?.kids[1].stars).toBe(1); // took part: at least one star
    g.run.dispose();
  });

  it("paints without throwing for every animal and a bounded number of canvas calls", () => {
    const g = setup("duration=60");
    const painter = new Painter(false);
    expect(painter).toBeTruthy();
    for (let i = 0; i < 20; i++) g.step([{ cx: 0.8 }, { cx: 0.5 }]);
    const ctx = ctxMock();
    const fakeRound = { index: 0, phase: "act" as const, t: 2, animal: ANIMALS[0] as AnimalDef, progress: [{ done: true }, { done: false }, { done: false }, { done: false }, { done: false }] };
    for (const a of ANIMALS) {
      fakeRound.animal = a;
      const before = (ctx as unknown as { n: number }).n;
      painter.draw(ctx, W, H, 1234, fakeRound as unknown as Round, g.tr.slots);
      expect((ctx as unknown as { n: number }).n - before).toBeLessThan(120);
    }
    g.run.dispose();
  });
});
