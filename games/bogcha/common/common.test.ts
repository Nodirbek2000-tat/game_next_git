import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineApi } from "@/engine";
import { buildPeople, computeFit } from "@/engine/tracking/people";
import { KidTracker } from "@/engine/tracking/kids";
import { makeSkeleton } from "@/engine/testing/skeleton";
import { avatarSpriteCount, clearAvatarSprites, drawKids, lostAlpha, minScaleFor, setSpriteFactory } from "./avatar";
import { KID_ANIMALS } from "@/engine/tracking/kids";
import { clearEmojiSprites, drawEmoji } from "./sprites";
import { startKidsGame } from "./kit";
import { MelodyScheduler, MusicPlayer, NOTE_LEAD, SONGS, type KidsGraph, type SongId } from "./music";
import { PROMPTS, Voice, findUzbekVoice } from "./voice";

afterEach(() => {
  vi.useRealTimers();
});

describe("songs", () => {
  it("are well formed", () => {
    for (const s of Object.values(SONGS)) {
      expect(s.lead.length).toBe(32);
      expect(s.bass.length).toBe(s.lead.length / 2);
      expect(s.lead[0]).toBeGreaterThan(0);
      if (s.drums) expect(s.drums.length).toBe(s.lead.length);
      for (const n of s.lead) expect(n >= -1 && n <= 90).toBe(true);
    }
  });
});

describe("melody scheduler", () => {
  it("keeps O(1) state and emits at a steady rate however long it runs", () => {
    for (const id of Object.keys(SONGS) as SongId[]) {
      const song = SONGS[id];
      let notes = 0;
      let maxBurst = 0;
      let lastT = -1;
      let monotonic = true;
      const sch = new MelodyScheduler(song, (_k, _m, t) => {
        notes++;
        if (t < lastT - 1e-9) monotonic = false;
        lastT = Math.max(lastT, t);
      });
      sch.start(0.1);
      const keys = Object.keys(sch).length;
      let now = 0;
      // 10 minutes of a 25 ms timer
      for (let i = 0; i < 24000; i++) {
        now += 0.025;
        const before = notes;
        sch.tick(now, 0.15);
        maxBurst = Math.max(maxBurst, notes - before);
      }
      const steps = now / sch.stepDur;
      expect(Math.abs(sch.step - steps)).toBeLessThan(10);
      // never more than a few notes per tick (no bursts), and nothing was stored
      expect(maxBurst).toBeLessThanOrEqual(12);
      expect(notes / now).toBeLessThan(14); // < 14 notes / s in total
      expect(monotonic).toBe(true);
      expect(Object.keys(sch).length).toBe(keys);
    }
  });

  it("skips a burst of old steps after the page was throttled", () => {
    let notes = 0;
    const sch = new MelodyScheduler(SONGS.march, () => notes++);
    sch.start(0);
    sch.tick(0, 0.15);
    const n0 = notes;
    sch.tick(30, 0.15); // 30 s later (hidden tab)
    expect(notes - n0).toBeLessThan(40);
  });

  it("holds long notes and ends them before the next one", () => {
    const got: number[] = [];
    const sch = new MelodyScheduler(SONGS.march, (k, _m, _t, d) => {
      if (k === NOTE_LEAD) got.push(d);
    });
    sch.start(0);
    for (let i = 0; i < 10; i++) sch.tick(100, 100);
    // the last bar holds 72 for 4 steps
    expect(Math.max(...got)).toBeGreaterThan(sch.stepDur * 3);
  });
});

// ---------------------------------------------------------------- fake Web Audio
class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  cancelScheduledValues(): void {}
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = "sine";
  onended: (() => void) | null = null;
  stopAt = 0;
  connect(n: unknown): unknown {
    return n;
  }
  disconnect(): void {}
  start(): void {}
  stop(t: number): void {
    this.stopAt = t;
  }
}
class FakeAC {
  currentTime = 0;
  created = 0;
  live: FakeNode[] = [];
  maxLive = 0;
  context = this;
  createOscillator(): FakeNode {
    const n = new FakeNode();
    this.created++;
    this.live.push(n);
    this.maxLive = Math.max(this.maxLive, this.live.length);
    return n;
  }
  createGain(): FakeNode {
    return new FakeNode();
  }
  /** advance the audio clock: finished oscillators fire onended and leave */
  advance(dt: number): void {
    this.currentTime += dt;
    this.live = this.live.filter((n) => {
      if (n.stopAt > 0 && n.stopAt <= this.currentTime) {
        n.onended?.();
        return false;
      }
      return true;
    });
  }
}

describe("music player", () => {
  it("keeps only a few oscillators alive and stops cleanly", () => {
    vi.useFakeTimers();
    const ac = new FakeAC();
    const graph = { ac: ac as unknown as AudioContext, sfx: new FakeNode() as unknown as AudioNode, music: new FakeNode() as unknown as AudioNode, musicEnabled: () => true } satisfies KidsGraph;
    const p = new MusicPlayer(() => graph);
    p.play("bouncy");
    for (let i = 0; i < 3000; i++) {
      ac.advance(0.04);
      vi.advanceTimersByTime(40);
    }
    expect(p.notes).toBeGreaterThan(500);
    expect(ac.maxLive).toBeLessThan(20);
    const notes = p.notes;
    p.stop();
    for (let i = 0; i < 100; i++) {
      ac.advance(0.04);
      vi.advanceTimersByTime(40);
    }
    expect(p.notes).toBe(notes);
    expect(p.playing).toBe(false);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // only the 400 ms bus clean-up at most
  });

  it("waits for the audio graph (not unlocked yet) and respects the music setting", () => {
    vi.useFakeTimers();
    const ac = new FakeAC();
    let g: KidsGraph | null = null;
    let enabled = true;
    const p = new MusicPlayer(() => g);
    p.play("calm");
    vi.advanceTimersByTime(400);
    expect(p.notes).toBe(0);
    g = { ac: ac as unknown as AudioContext, sfx: new FakeNode() as unknown as AudioNode, music: new FakeNode() as unknown as AudioNode, musicEnabled: () => enabled };
    enabled = false;
    ac.advance(0.5);
    vi.advanceTimersByTime(200);
    expect(p.notes).toBe(0);
    enabled = true;
    ac.advance(0.5);
    vi.advanceTimersByTime(200);
    expect(p.notes).toBeGreaterThan(0);
    p.dispose();
  });
});

describe("voice", () => {
  const sfx = { attention: vi.fn() } as never;

  it("finds an Uzbek voice", () => {
    expect(findUzbekVoice([{ lang: "en-US" }, { lang: "uz-UZ" }])?.lang).toBe("uz-UZ");
    expect(findUzbekVoice([{ lang: "uz_UZ" }])).not.toBeNull();
    expect(findUzbekVoice([{ lang: "ru-RU" }, { lang: "tr-TR" }])).toBeNull();
  });

  it("without an Uzbek voice: attention jingle + banner, no repeat within 1.2 s", () => {
    const v = new Voice(sfx, { synth: { getVoices: () => [{ lang: "en-US", name: "x" }], speak: vi.fn(), cancel: vi.fn() } });
    expect(v.mode).toBe("jingle");
    v.say("jump");
    expect(v.banner.text).toBe("Sakrang!");
    expect(v.banner.until).toBeGreaterThan(performance.now());
    v.say("jump");
    expect((sfx as unknown as { attention: ReturnType<typeof vi.fn> }).attention).toHaveBeenCalledTimes(1);
  });

  it("prompts are Uzbek Latin (no Cyrillic) with an icon", () => {
    for (const p of Object.values(PROMPTS)) {
      expect([...p.text].some((c) => c.charCodeAt(0) >= 0x400 && c.charCodeAt(0) <= 0x4ff)).toBe(false);
      expect(p.icon.length).toBeGreaterThan(0);
    }
    expect(PROMPTS.handsUp.text).toBe("Qo‘llarni ko‘taring!");
    expect(PROMPTS.freeze.text).toBe("Qotib qoling!");
    expect(PROMPTS.bravo.text).toBe("Barakalla!");
  });
});

// ---------------------------------------------------------------- avatars + kit
const ctxMock = (): CanvasRenderingContext2D => {
  const calls = { n: 0 };
  const c = new Proxy(calls, {
    get: (t, k) => (k === "n" ? t.n : () => void t.n++),
    set: () => true,
  });
  return c as unknown as CanvasRenderingContext2D;
};

function trackerWith(n: number): KidTracker {
  const tr = new KidTracker();
  const fit = computeFit(1280, 720, 1280, 720);
  const lms = Array.from({ length: n }, (_, i) => makeSkeleton({ cx: 0.9 - (0.8 * i) / Math.max(1, n - 1), h: 0.5, top: 0.2 }));
  for (let i = 0; i < 6; i++) {
    const t = 1000 + i * 33;
    tr.update(buildPeople({ landmarks: lms }, fit), t, t, 1280);
    tr.extrapolate(t, 0);
  }
  return tr;
}

describe("avatars", () => {
  it("draw every child without throwing and with a bounded number of canvas calls", () => {
    const tr = trackerWith(5);
    const ctx = ctxMock();
    drawKids(ctx, tr.slots, 0);
    const n = (ctx as unknown as { n: number }).n;
    // no canvas to make sprites on: every part is painted straight onto the context (gradients, outlines), about 200 calls a child
    expect(n).toBeGreaterThan(50);
    expect(n).toBeLessThan(5 * 300);
  });

  it("with sprites: a child costs a few dozen canvas calls per frame, nothing is rebuilt after the first frame, nothing allocates canvases", () => {
    let made = 0;
    const fake = (): HTMLCanvasElement => {
      made++;
      return { width: 0, height: 0, getContext: () => ctxMock() } as unknown as HTMLCanvasElement;
    };
    setSpriteFactory(fake);
    try {
      const tr = trackerWith(5);
      const r = recCtx();
      drawKids(r.ctx, tr.slots, 500, 720, 1280); // first frame: the sprites are made
      const first = avatarSpriteCount();
      expect(first).toBeGreaterThan(10);
      expect(made).toBe(first);
      const second = recCtx();
      drawKids(second.ctx, tr.slots, 4000, 720, 1280);
      expect(avatarSpriteCount()).toBe(first); // calm heads + torso + paws + feet + tails are all there already
      expect(made).toBe(first);
      expect(second.calls()).toBeLessThan(5 * 110);
      expect(second.calls()).toBeGreaterThan(5 * 20);
      // a happy child (jump) and a blink need their own head sprites, once
      tr.slots[0].signals.jump = true;
      drawKids(recCtx().ctx, tr.slots, 4000, 720, 1280);
      drawKids(recCtx().ctx, tr.slots, 4000, 720, 1280);
      expect(avatarSpriteCount()).toBe(first + 1);
      drawKids(recCtx().ctx, tr.slots, 50, 720, 1280); // t % 3200 < 110: blink
      const withBlink = avatarSpriteCount();
      drawKids(recCtx().ctx, tr.slots, 50, 720, 1280);
      expect(avatarSpriteCount()).toBe(withBlink);
    } finally {
      setSpriteFactory(null);
      clearAvatarSprites();
    }
  });

  it("every animal has its own look: no two animals are painted with the same calls", () => {
    const tr = trackerWith(5);
    const sigs = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const log: string[] = [];
      const ctx = new Proxy({} as Record<string, unknown>, {
        get: (_t, k) => (...a: unknown[]) => void log.push(String(k) + a.map((x) => (typeof x === "number" ? Math.round(x) : "")).join(",")),
        set: (_t, k, v) => {
          if (k === "fillStyle" || k === "strokeStyle") log.push(String(v));
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
      drawKids(ctx, [tr.slots[i]], 0);
      sigs.add(log.join("|"));
    }
    expect(sigs.size).toBe(5);
    expect(KID_ANIMALS.map((a) => a.id)).toEqual(["quyon", "ayiq", "mushuk", "kuchuk", "baqa"]);
  });
});

/** a context that records what the avatar code asks for */
function recCtx(): { ctx: CanvasRenderingContext2D; calls: () => number; arcs: number[]; texts: string[]; alphas: number[] } {
  const rec = { n: 0, arcs: [] as number[], texts: [] as string[], alphas: [] as number[] };
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, k) =>
        (...a: unknown[]) => {
          rec.n++;
          if (k === "arc") rec.arcs.push(a[2] as number);
          if (k === "ellipse") rec.arcs.push(Math.max(a[2] as number, a[3] as number));
          if (k === "fillText") rec.texts.push(String(a[0]));
        },
      set: (_t, k, v) => {
        if (k === "globalAlpha") rec.alphas.push(v as number);
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls: () => rec.n, arcs: rec.arcs, texts: rec.texts, alphas: rec.alphas };
}

describe("avatars never vanish", () => {
  it("an active child who is not 'present' for a moment is still drawn, slightly faded, at the last position", () => {
    const tr = trackerWith(2);
    const both = recCtx();
    drawKids(both.ctx, tr.slots, 0, 720, 1280);
    expect(both.alphas).toEqual([]);
    // the second child is lost for 0.6 s (present false, slot still active)
    tr.slots[1].present = false;
    tr.slots[1].lostFor = 0.6;
    const lost = recCtx();
    drawKids(lost.ctx, tr.slots, 0, 720, 1280);
    expect(tr.slots[1].active).toBe(true);
    expect(lost.calls()).toBeGreaterThanOrEqual(both.calls() - 4); // both children still painted
    expect(lost.alphas[0]).toBeLessThan(1);
    expect(lost.alphas[0]).toBeGreaterThan(0.3);
    expect(lost.alphas[lost.alphas.length - 1]).toBe(1); // alpha restored for the next drawing
    // a free slot is not drawn
    const none = recCtx();
    tr.slots[1].active = false;
    drawKids(none.ctx, tr.slots, 0, 720, 1280);
    expect(none.calls()).toBeLessThan(lost.calls());
    expect(lostAlpha(0)).toBeGreaterThan(0.8); // no jump when the hold time ends
    expect(lostAlpha(0.5)).toBeLessThan(lostAlpha(0));
    expect(lostAlpha(0.5)).toBeGreaterThan(lostAlpha(1));
    expect(lostAlpha(3)).toBeGreaterThanOrEqual(0.15);
  });

  it("a child whose head and shoulders are hardly seen (far away) still gets an avatar", () => {
    const tr = trackerWith(2);
    for (const p of Object.values(tr.slots[0].pts)) p.v = 0.02;
    const r = recCtx();
    drawKids(r.ctx, [tr.slots[0]], 0, 720, 1280);
    expect(r.calls()).toBeGreaterThan(20);
  });

  it("a tiny child gets a usable avatar size and a name tag", () => {
    const tr = trackerWith(1);
    const k = tr.slots[0];
    const hx = k.pts.head.x;
    const hy = k.pts.head.y;
    for (const p of Object.values(k.pts)) {
      p.x = hx + (p.x - hx) * 0.12;
      p.y = hy + (p.y - hy) * 0.12;
    }
    k.scale = 8;
    k.headR = 3;
    const r = recCtx();
    drawKids(r.ctx, [k], 0, 720, 1280);
    // the head circle is not smaller than the minimum avatar head
    expect(Math.max(...r.arcs)).toBeGreaterThanOrEqual(minScaleFor(720) * 0.6);
    expect(r.texts).toContain(k.animal.name);
  });

  it("the greeting: a child who takes a slot gets a popup", () => {
    const tr = trackerWith(2);
    const popup = vi.fn();
    const draws: ((c: CanvasRenderingContext2D, e: EngineApi, n: number) => void)[] = [];
    const engine = {
      state: "play",
      kidSlots: tr.slots,
      query: new URLSearchParams("duration=30"),
      stage: { w: 1280, h: 720, dpr: 1 },
      audio: { graph: () => null },
      fx: { popup },
      onDraw: (f: (typeof draws)[number]) => {
        draws.push(f);
        return () => {};
      },
      finish: () => {},
    } as unknown as EngineApi;
    tr.slots[0].joined = true;
    tr.slots[1].joined = true;
    startKidsGame(engine, { slug: "test", create: () => ({}) });
    draws[0](ctxMock(), engine, 100);
    expect(popup.mock.calls.map((c) => c[0])).toEqual(["🐰 Salom, quyoncha!", "🐻 Salom, ayiqcha!"]);
  });
});

describe("emoji sprites", () => {
  it("fall back to text on a mocked context and never throw", () => {
    clearEmojiSprites();
    const r = recCtx();
    drawEmoji(r.ctx, "🎣", 10, 10, 40);
    expect(r.texts).toEqual(["🎣"]);
  });
});

describe("kids game kit", () => {
  function fakeEngine(tr: KidTracker, duration: string): { engine: EngineApi; draw: (now: number) => void; result: () => unknown; state: { v: string } } {
    let fn: ((c: CanvasRenderingContext2D, e: EngineApi, n: number) => void) | null = null;
    let result: unknown = null;
    const state = { v: "play" };
    const engine = {
      get state() {
        return state.v;
      },
      kidSlots: tr.slots,
      query: new URLSearchParams(`duration=${duration}`),
      stage: { w: 1280, h: 720, dpr: 1 },
      audio: { graph: () => null },
      fx: { popup: vi.fn() },
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
    return { engine, draw: (now) => fn?.(ctx, engine, now), result: () => result, state };
  }

  it("runs the round, awards stars, ends with stars for every child who took part", () => {
    const tr = trackerWith(3);
    const { engine, draw, result } = fakeEngine(tr, "2");
    let updates = 0;
    const run = startKidsGame(engine, {
      slug: "test",
      create: (kit) => ({
        update: () => {
          updates++;
          if (updates === 5) kit.award(kit.kids[0], 3);
        },
      }),
    });
    let t = 0;
    for (let i = 0; i < 200 && !result(); i++) draw((t += 16.7));
    expect(updates).toBeGreaterThan(90);
    const r = result() as { score: number; kids: { slot: number; stars: number; emoji: string }[] };
    expect(r).not.toBeNull();
    expect(r.kids.map((k) => k.slot)).toEqual([0, 1, 2]);
    expect(r.kids[0].stars).toBe(3);
    expect(r.kids[1].stars).toBe(1);
    expect(r.kids[2].stars).toBe(1);
    expect(r.score).toBe(5);
    expect(run.kit.timeLeft).toBe(0);
    run.dispose();
  });

  it("does not run the logic outside of play (countdown / pause)", () => {
    const tr = trackerWith(2);
    const { engine, draw, state } = fakeEngine(tr, "30");
    const update = vi.fn();
    startKidsGame(engine, { slug: "test", create: () => ({ update }) });
    state.v = "countdown";
    draw(100);
    draw(120);
    expect(update).not.toHaveBeenCalled();
    state.v = "play";
    draw(140);
    draw(160);
    expect(update).toHaveBeenCalledTimes(2);
    state.v = "pause";
    draw(180);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
