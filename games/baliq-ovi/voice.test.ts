import { describe, expect, it } from "vitest";
import {
  decideKeyword, decideShouts, keywordsIn, KeywordStream, matchWord, normalizeText, ShoutDetector, SHOUT, VoiceControl, voiceCastPower, type VoiceCtx,
} from "./voice";

describe("keywords", () => {
  it("normalises accents and apostrophes", () => {
    expect(normalizeText("  FISH,  Fish!! ")).toBe("fish fish");
    expect(normalizeText("Baliq")).toBe("baliq");
    expect(normalizeText("Tort‘")).toBe("tort");
  });
  it("finds fish and pull words in English and Uzbek, in order", () => {
    expect(keywordsIn("fish fish fish")).toEqual(["fish", "fish", "fish"]);
    expect(keywordsIn("Pull pull")).toEqual(["pull", "pull"]);
    expect(keywordsIn("baliq baliq tort")).toEqual(["fish", "fish", "pull"]);
    expect(keywordsIn("hello world")).toEqual([]);
    expect(matchWord("fishing")).toBe("fish");
    expect(matchWord("table")).toBeNull();
  });
  it("a growing transcript reports every spoken word exactly once", () => {
    const s = new KeywordStream();
    expect(s.feed(0, "fi")).toEqual([]);
    expect(s.feed(0, "fish")).toEqual(["fish"]);
    expect(s.feed(0, "fish")).toEqual([]);
    expect(s.feed(0, "fish fish")).toEqual(["fish"]);
    expect(s.feed(0, "fish fish pull")).toEqual(["pull"]);
    // the next utterance is a new result index
    expect(s.feed(1, "pull")).toEqual(["pull"]);
    s.reset();
    expect(s.feed(0, "fish")).toEqual(["fish"]);
  });
});

describe("keyword -> action by context", () => {
  it("fish casts when the rod is ready, pull strikes at the bite and pulls in the fight", () => {
    expect(decideKeyword("fish", "ready", false)).toBe("cast");
    expect(decideKeyword("pull", "bite", false)).toBe("strike");
    expect(decideKeyword("pull", "fight", false)).toBe("pull");
  });
  it("strict mode: the wrong word does nothing; kids mode: any word does the right thing", () => {
    expect(decideKeyword("pull", "ready", false)).toBe("none");
    expect(decideKeyword("fish", "fight", false)).toBe("none");
    expect(decideKeyword("pull", "ready", true)).toBe("cast");
    expect(decideKeyword("fish", "bite", true)).toBe("strike");
    expect(decideKeyword("fish", "fight", true)).toBe("pull");
  });
  it("never reacts while waiting for the bite (it would scare the fish)", () => {
    for (const c of ["wait", "nibble", "other"] as VoiceCtx[]) {
      expect(decideKeyword("fish", c, true)).toBe("none");
      expect(decideKeyword("pull", c, true)).toBe("none");
      expect(decideShouts(5, c)).toBe("none");
    }
  });
});

describe("loudness fallback by context", () => {
  it("repeated shouts cast, a single one does not; one shout strikes; shouts in the fight pull", () => {
    expect(decideShouts(1, "ready")).toBe("none");
    expect(decideShouts(2, "ready")).toBe("cast");
    expect(decideShouts(1, "bite")).toBe("strike");
    expect(decideShouts(1, "fight")).toBe("pull");
    expect(decideShouts(0, "fight")).toBe("none");
  });
});

describe("shout detector", () => {
  const dt = 1 / 60;
  /** feed a level for `s` seconds, return the onset events (frame times) */
  const feed = (d: ShoutDetector, level: number, s: number, t0: number, hits: number[]) => {
    let t = t0;
    for (let i = 0; i < Math.round(s / dt); i++, t += dt) if (d.update(dt, level) > 0) hits.push(t);
    return t;
  };
  it("a short shout is one event; silence and room noise are none", () => {
    const d = new ShoutDetector();
    const hits: number[] = [];
    let t = feed(d, 0.01, 2, 0, hits);
    expect(hits).toHaveLength(0);
    t = feed(d, 0.4, 0.3, t, hits);
    t = feed(d, 0.01, 0.5, t, hits);
    expect(hits).toHaveLength(1);
    // low murmur never counts
    feed(d, 0.03, 3, t, hits);
    expect(hits).toHaveLength(1);
  });
  it("repeated shouts with pauses are counted separately", () => {
    const d = new ShoutDetector();
    const hits: number[] = [];
    let t = feed(d, 0.01, 1, 0, hits);
    for (let k = 0; k < 3; k++) {
      t = feed(d, 0.5, 0.2, t, hits);
      t = feed(d, 0.01, 0.3, t, hits);
    }
    expect(hits).toHaveLength(3);
  });
  it("one long loud stretch (music, a vacuum cleaner) does not fire again and raises the floor", () => {
    const d = new ShoutDetector();
    const hits: number[] = [];
    let t = feed(d, 0.01, 1, 0, hits);
    t = feed(d, 0.3, 4, t, hits);
    expect(hits).toHaveLength(1);
    expect(d.floor).toBeGreaterThan(0.1);
    feed(d, 0.3, 2, t, hits);
    expect(hits).toHaveLength(1);
  });
  it("adapts to a noisy room: the threshold follows the noise floor", () => {
    const d = new ShoutDetector();
    const hits: number[] = [];
    let t = feed(d, 0.05, 6, 0, hits); // below minLevel: ignored but the floor rises
    expect(d.threshold).toBeGreaterThanOrEqual(SHOUT.minLevel);
    expect(hits).toHaveLength(0);
    t = feed(d, 0.15, 0.2, t, hits);
    expect(hits).toHaveLength(0); // 0.15 is not louder than 3.5 x the floor
    feed(d, 0.9, 0.2, t, hits);
    expect(hits).toHaveLength(1);
  });
});

describe("voice control (mixer)", () => {
  const run = (v: VoiceControl, seconds: number) => {
    let cast = 0;
    let power = 0;
    let strikes = 0;
    let maxCrank = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      const o = v.update(1 / 60);
      if (o.cast) {
        cast++;
        power = o.castPower;
      }
      if (o.strike) strikes++;
      maxCrank = Math.max(maxCrank, o.crank);
    }
    return { cast, power, strikes, maxCrank };
  };
  it("«fish» casts once after a short gathering time; more words throw further", () => {
    const one = new VoiceControl();
    one.ctx = "ready";
    one.onEvent("fish");
    const a = run(one, 2.5);
    const three = new VoiceControl();
    three.ctx = "ready";
    three.onEvent("fish");
    three.onEvent("fish");
    three.onEvent("fish");
    const b = run(three, 3);
    expect(a.cast).toBe(1);
    expect(b.cast).toBe(1);
    expect(b.power).toBeGreaterThan(a.power);
    expect(b.power).toBeLessThanOrEqual(1);
    expect(a.power).toBeGreaterThan(0.3);
    expect(voiceCastPower(3)).toBeGreaterThan(voiceCastPower(1));
  });
  it("the cast waits for the gathering time, it does not fire on the same frame", () => {
    const v = new VoiceControl();
    v.ctx = "ready";
    v.onEvent("fish");
    expect(v.update(0.016).cast).toBe(false);
  });
  it("forgets the gathered words when the rod is no longer ready", () => {
    const v = new VoiceControl();
    v.ctx = "ready";
    v.onEvent("fish");
    v.ctx = "wait";
    expect(run(v, 3).cast).toBe(0);
  });
  it("«pull» at the bite strikes once; in the fight it reels and fades; outside the fight there is no reel", () => {
    const b = new VoiceControl();
    b.ctx = "bite";
    b.onEvent("pull");
    expect(run(b, 0.5).strikes).toBe(1);
    const f = new VoiceControl();
    f.ctx = "fight";
    f.onEvent("pull");
    const r = run(f, 0.3);
    expect(r.maxCrank).toBeGreaterThan(1);
    run(f, 1);
    expect(run(f, 1).maxCrank).toBe(0);
    const w = new VoiceControl();
    w.ctx = "wait";
    w.onEvent("pull");
    const x = run(w, 1);
    expect(x.strikes).toBe(0);
    expect(x.maxCrank).toBe(0);
  });
  it("repeated pulls keep the reel going", () => {
    const v = new VoiceControl();
    v.ctx = "fight";
    let min = 9;
    for (let t = 0; t < 3; t += 1 / 60) {
      if (Math.abs(t % 0.5) < 1 / 60) v.onEvent("pull");
      const o = v.update(1 / 60);
      if (t > 0.3) min = Math.min(min, o.crank);
    }
    expect(min).toBeGreaterThan(0.3);
  });
  it("shouts: one shout does not cast, two do; a shout strikes at the bite and pulls in the fight", () => {
    const v = new VoiceControl();
    v.ctx = "ready";
    v.onEvent("shout", 0.6);
    expect(run(v, 3).cast).toBe(0);
    const w = new VoiceControl();
    w.ctx = "ready";
    w.onEvent("shout", 0.6);
    w.update(0.3);
    w.onEvent("shout", 0.8);
    const r = run(w, 3);
    expect(r.cast).toBe(1);
    expect(r.power).toBeGreaterThan(0.4);
    const b = new VoiceControl();
    b.ctx = "bite";
    b.onEvent("shout", 0.7);
    expect(run(b, 0.3).strikes).toBe(1);
    const f = new VoiceControl();
    f.ctx = "fight";
    f.onEvent("shout", 0.7);
    expect(run(f, 0.3).maxCrank).toBeGreaterThan(1);
    // shouts far apart never add up to a cast
    const s = new VoiceControl();
    s.ctx = "ready";
    s.onEvent("shout", 0.6);
    run(s, 3);
    s.onEvent("shout", 0.6);
    expect(run(s, 3).cast).toBe(0);
  });
  it("strict mode ignores the wrong word", () => {
    const v = new VoiceControl();
    v.lenient = false;
    v.ctx = "ready";
    v.onEvent("pull");
    expect(run(v, 3).cast).toBe(0);
  });
});
