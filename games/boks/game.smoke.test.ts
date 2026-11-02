// A whole fight without a renderer: the real BoksGame class runs on a fake engine and a fake player (landmarks in stage px),
// so the punch detection, the pads, the dodge / block checks and the round flow are exercised together with the 3D scene
// graph (no WebGL needed: nothing is drawn).
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineApi } from "@/engine/types";
import { BoksGame, type BoksProbe } from "./Game";
import { effectiveLevel } from "./config";

const W = 960;
const H = 540;
const SW = 154; // shoulder width in px
const SH_Y = 230;
const CX = W / 2;

interface Fake {
  engine: EngineApi;
  lm: { x: number; y: number; v: number }[];
  blades: { active: boolean; speed: number }[];
  keys: Set<string>;
  calls: Record<string, number>;
  finished: { score: number; lines: [string, string | number][] } | null;
  state: { v: string };
}

function fake(opts: { level?: "low" | "medium" | "high"; query?: string; kids?: boolean } = {}): Fake {
  const lm = Array.from({ length: 33 }, () => ({ x: CX, y: H / 2, v: 0.99 }));
  const set = (i: number, x: number, y: number): void => {
    lm[i].x = x;
    lm[i].y = y;
  };
  set(0, CX, 160);
  set(11, CX - SW / 2, SH_Y);
  set(12, CX + SW / 2, SH_Y);
  const blades = [
    { active: true, speed: 0 },
    { active: true, speed: 0 },
  ];
  const calls: Record<string, number> = {};
  const count = new Proxy(
    {},
    {
      get:
        (_t, k: string) =>
        (...a: unknown[]) => {
          calls[k] = (calls[k] ?? 0) + 1;
          void a;
        },
    },
  );
  const state = { v: "play" };
  const keys = new Set<string>();
  const q = { level: opts.level ?? "high", shadows: (opts.level ?? "high") === "high", particles: 1, pixelRatio: 1, postfx: true, viewDistance: 1, resolutionScale: 1 };
  const out: Fake = { lm, blades, keys, calls, finished: null, state } as unknown as Fake;
  const engine = {
    slug: "boks",
    players: [{ present: true, lm, scale: SW, blades, world: null }],
    quality: q,
    query: new URLSearchParams(opts.query ?? "duration=20"),
    kids: !!opts.kids,
    sensitivity: 1,
    stage: { w: W, h: H, dpr: 1 },
    keys,
    get state() {
      return state.v;
    },
    hud: { set: () => undefined },
    audio: new Proxy(count, { get: (t, k: string) => (k === "musicOn" ? true : (t as Record<string, unknown>)[k]) }),
    fx: count,
    finish: (r: { score: number; lines: [string, string | number][] }) => {
      out.finished = r;
    },
  } as unknown as EngineApi;
  out.engine = engine;
  return out;
}

class Rig {
  game: BoksGame;
  f: Fake;
  scene = new THREE.Scene();
  root = new THREE.Group();
  now = 1000;
  // arms hanging down
  wrist = [
    { x: CX - SW / 2 - 10, y: SH_Y + 200 },
    { x: CX + SW / 2 + 10, y: SH_Y + 200 },
  ];

  constructor(opts: Parameters<typeof fake>[0] = {}) {
    this.f = fake(opts);
    this.scene.add(this.root);
    const gl = { shadowMap: { enabled: false, type: 0 }, compileAsync: () => Promise.resolve() } as unknown as THREE.WebGLRenderer;
    const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    this.game = new BoksGame(this.f.engine, this.root, cam, gl);
    vi.spyOn(performance, "now").mockImplementation(() => this.now);
    this.place(0, this.wrist[0].x, this.wrist[0].y, 1 / 60);
    this.place(1, this.wrist[1].x, this.wrist[1].y, 1 / 60);
  }

  snap(): ReturnType<BoksProbe["snapshot"]> {
    return (window as unknown as { __boks: BoksProbe }).__boks.snapshot();
  }

  /** put a wrist (and the index finger the blade follows) at a stage point; the blade speed is what the tracker would report */
  place(h: number, x: number, y: number, dt: number): void {
    const lm = this.f.lm;
    const w = this.wrist[h];
    const sp = Math.hypot(x - w.x, y - w.y) / dt / H;
    this.f.blades[h].speed = sp;
    w.x = x;
    w.y = y;
    lm[15 + h].x = x;
    lm[15 + h].y = y;
    lm[19 + h].x = x;
    lm[19 + h].y = y - 8;
    // the elbow halfway to the shoulder
    const sx = lm[11 + h].x;
    lm[13 + h].x = (x + sx) / 2;
    lm[13 + h].y = (y + SH_Y) / 2 + 20;
  }

  step(dt = 1 / 60, n = 1): void {
    for (let i = 0; i < n; i++) {
      this.now += dt * 1000;
      this.game.frame(dt);
    }
  }

  /** run until the first pad has been up for `minAge` seconds */
  untilPad(minAge = 0.3, max = 20): ReturnType<BoksProbe["snapshot"]> {
    for (let t = 0; t < max; t += 1 / 60) {
      this.step();
      const s = this.snap();
      if (s.phase === "round" && s.pads.some((p) => p.age >= minAge)) return s;
    }
    throw new Error("no pad appeared");
  }

  /** a punch of hand `h` from the guard to (x, y) in `ms` */
  punch(h: number, x: number, y: number, ms: number): void {
    const x0 = this.wrist[h].x;
    const y0 = this.wrist[h].y;
    const n = Math.max(2, Math.round((ms / 1000) * 60));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      this.place(h, x0 + (x - x0) * k, y0 + (y - y0) * k, 1 / 60);
      this.step();
    }
    // the hand stops at the pad
    for (let i = 0; i < 6; i++) {
      this.place(h, x, y, 1 / 60);
      this.step();
    }
  }

  guard(h: number, ms = 400): void {
    const sx = h === 0 ? CX - SW / 2 : CX + SW / 2;
    const gx = sx + (h === 0 ? -0.35 : 0.35) * SW;
    const gy = SH_Y - 0.4 * SW;
    const n = Math.round((ms / 1000) * 60);
    const x0 = this.wrist[h].x;
    const y0 = this.wrist[h].y;
    for (let i = 1; i <= n; i++) {
      this.place(h, x0 + ((gx - x0) * i) / n, y0 + ((gy - y0) * i) / n, 1 / 60);
      this.step();
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { __boks?: unknown }).__boks;
});

describe("Boks, played against the real game class", () => {
  it("a fast punch with the right hand on a pad scores, with a speed and the hand's side", () => {
    const r = new Rig();
    let s = r.untilPad();
    r.guard(0);
    r.guard(1);
    s = r.snap();
    const aim = s.aim!;
    expect(aim).toBeTruthy();
    const h = aim.side === "L" ? 0 : 1;
    const before = s.hits;
    r.punch(h, aim.x, aim.y, 130);
    s = r.snap();
    expect(s.hits).toBe(before + 1);
    expect(s.score).toBeGreaterThan(60);
    expect(s.lastSpeed).toBeGreaterThan(8);
    expect(s.bestSpeed).toBeGreaterThan(8);
    expect(s.enemyHealth).toBeLessThan(100);
    expect(r.f.calls.punch).toBeGreaterThan(0);
  });

  it("the same reach, slowly, does not score", () => {
    const r = new Rig();
    let s = r.untilPad(0.2);
    r.guard(0);
    r.guard(1);
    s = r.snap();
    const aim = s.aim!;
    const h = aim.side === "L" ? 0 : 1;
    const hits = s.hits;
    r.punch(h, aim.x, aim.y, 1200);
    expect(r.snap().hits).toBe(hits);
  });

  it("the wrong hand does not score and does not take the pad", () => {
    const r = new Rig();
    let s = r.untilPad(0.2);
    r.guard(0);
    r.guard(1);
    s = r.snap();
    const aim = s.aim!;
    const wrongHand = aim.side === "L" ? 1 : 0;
    const hits = s.hits;
    const score = s.score;
    // the other hand punches at the same place
    r.punch(wrongHand, aim.x, aim.y, 130);
    s = r.snap();
    expect(s.hits).toBe(hits);
    expect(s.score).toBe(score);
    expect(s.pads.length).toBeGreaterThan(0);
  });

  it("tracking jitter on a resting hand never scores or throws a punch", () => {
    const r = new Rig();
    r.untilPad(0.1);
    r.guard(0);
    r.guard(1);
    for (let i = 0; i < 240; i++) {
      const j = i % 2 ? 4 : -4;
      r.place(0, r.wrist[0].x + j, r.wrist[0].y - j, 1 / 60);
      r.place(1, r.wrist[1].x - j, r.wrist[1].y + j, 1 / 60);
      r.step();
    }
    const s = r.snap();
    expect(s.hits).toBe(0);
    expect(s.thrown).toBe(0);
  });

  // run to the moment the partner's glove is about to land
  function untilImpact(r: Rig, before?: () => void): void {
    for (let t = 0; t < 60; t += 1 / 60) {
      r.step();
      const s = r.snap();
      if (s.partner.attack.active && s.partner.attack.t > 0.02) break;
    }
    before?.();
    for (let t = 0; t < 3; t += 1 / 60) {
      r.step();
      const s = r.snap();
      if (s.taken + s.dodges + s.blocks > 0) return;
    }
  }

  it("standing still takes the punch", () => {
    const r = new Rig();
    untilImpact(r);
    const s = r.snap();
    expect(s.taken).toBe(1);
    expect(s.health).toBeLessThan(100);
  });

  it("a head lean dodges it: no damage", () => {
    const r = new Rig();
    untilImpact(r, () => {
      // lean to the side before the glove lands, keep it there
      const lm = r.f.lm;
      const from = r.snap().partner.attack.from;
      const dx = from < 0 ? 0.9 : -0.9;
      const bx = lm[0].x;
      for (let i = 1; i <= 10; i++) {
        lm[0].x = bx + (dx * SW * i) / 10;
        r.step();
      }
      void from;
    });
    const s = r.snap();
    expect(s.dodges).toBe(1);
    expect(s.taken).toBe(0);
    expect(s.health).toBe(100);
  });

  it("both hands at the face block: a quarter of the damage", () => {
    const hit = new Rig();
    untilImpact(hit);
    const lostHit = 100 - hit.snap().health;
    vi.restoreAllMocks();
    const r = new Rig();
    untilImpact(r, () => {
      const lm = r.f.lm;
      for (let h = 0; h < 2; h++) {
        lm[15 + h].x = lm[0].x + (h ? 20 : -20);
        lm[15 + h].y = lm[0].y + 30;
      }
      r.step(1 / 60, 20);
    });
    const s = r.snap();
    expect(s.blocks).toBe(1);
    expect(100 - s.health).toBeGreaterThan(0);
    expect(100 - s.health).toBeLessThan(lostHit);
  });

  it("the keyboard fallback hits a pad of its side", () => {
    const r = new Rig();
    r.f.lm.forEach((l) => (l.v = 0));
    (r.f.engine.players[0] as { present: boolean }).present = false;
    const s = r.untilPad(0.3);
    const side = s.pads[0].side;
    r.f.keys.add(side === "L" ? "a" : "d");
    r.step();
    r.f.keys.delete("a");
    r.f.keys.delete("d");
    r.step(1 / 60, 4);
    expect(r.snap().hits).toBe(1);
  });

  it("a whole fight runs to the results: 3 rounds, then finish with the lines", () => {
    const r = new Rig({ query: "duration=6" });
    let guard = 0;
    while (!r.f.finished && guard++ < 60 * 120) {
      r.step();
      const s = r.snap();
      // block always, hit pads at once with the right hand
      const lm = r.f.lm;
      for (let h = 0; h < 2; h++) {
        lm[15 + h].x = lm[0].x + (h ? 20 : -20);
        lm[15 + h].y = lm[0].y + 30;
      }
      void s;
    }
    expect(r.f.finished).not.toBeNull();
    const labels = r.f.finished!.lines.map((l) => l[0]);
    expect(labels).toEqual(expect.arrayContaining(["Zarbalar", "Eng tez zarba", "Aniqlik", "Qochish / blok", "Nokautlar", "Raundlar"]));
    const text = JSON.stringify(r.f.finished);
    expect(text).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(text).toContain("taxminiy");
  });

  it("builds at every quality level, the crowd and shadows follow it, and the probe is removed on dispose", () => {
    const counts: number[] = [];
    for (const level of ["low", "medium", "high"] as const) {
      const r = new Rig({ level });
      r.step(1 / 60, 3);
      // the crowd arrives a little later
      for (let i = 0; i < 20; i++) r.game.streamIn(0.05);
      const s = r.snap();
      expect(s.level).toBe(level);
      expect(s.shadows).toBe(level === "high");
      expect(s.post).toBe(level === "high");
      counts.push(s.crowd);
      r.game.dispose();
      expect((window as unknown as { __boks?: unknown }).__boks).toBeUndefined();
      vi.restoreAllMocks();
    }
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(50);
    expect(counts[2]).toBeGreaterThan(counts[1]);
  });

  it("reacts to a live level drop: fewer spectators, no shadows, post off", () => {
    const r = new Rig({ level: "high" });
    for (let i = 0; i < 20; i++) r.game.streamIn(0.05);
    r.step(1 / 60, 2);
    expect(r.snap().shadows).toBe(true);
    const q = r.f.engine.quality as { level: string; shadows: boolean };
    q.level = "low";
    q.shadows = false;
    r.step(1 / 60, 2);
    const s = r.snap();
    expect(s.shadows).toBe(false);
    expect(s.post).toBe(false);
    expect(effectiveLevel("high", "low")).toBe("low");
  });
});
