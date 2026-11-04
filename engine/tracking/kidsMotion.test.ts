import { describe, expect, it } from "vitest";
import { makeSkeleton, type SkeletonOpts } from "../testing/skeleton";
import { KidTracker } from "./kids";
import { buildPeople, computeFit } from "./people";

// How the drawn animal moves, end to end: a noisy camera, slow and late detections, a 60 fps render loop.
//  - a child who stands (nearly) still must not make the animal tremble,
//  - a child who walks / steps / waves must be followed at once (the delay of the camera and the model is made up for).

const W = 1280;
const H = 720;
const fit = computeFit(W, H, W, H);
const FRAME = 1000 / 60;
/** body height 0.35 of the picture: shoulder width (the body unit "scale") = 0.35 x 0.2 x W = 89.6 px */
const BODY_H = 0.35;
const SCALE = BODY_H * 0.2 * W;

type Truth = (ms: number) => SkeletonOpts & { cx: number; top: number };

interface Frame {
  t: number;
  head: { x: number; y: number };
  wrist: { x: number; y: number };
  /** where the child really is at this moment */
  trueHead: { x: number; y: number };
  trueWrist: { x: number; y: number };
}

function seeded(seed: number): () => number {
  let s = seed;
  const u = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  return () => Math.sqrt(-2 * Math.log(u() + 1e-9)) * Math.cos(2 * Math.PI * u());
}

interface Run {
  /** ms between two detections of the child (a round of the crops: 100-250 ms) */
  every: number;
  /** ms from the camera picture to the result being applied */
  latency?: number;
  /** std of the landmark noise, in body scales, per detection and axis; 10 % of the detections are 2.2 x worse (a flickering landmark) */
  noise?: number;
  ms: number;
  truth: Truth;
}

function simulate(o: Run): { frames: Frame[]; tr: KidTracker } {
  const tr = new KidTracker();
  const gauss = seeded(11);
  const latency = o.latency ?? 100;
  const t0 = 1000;
  const frames: Frame[] = [];
  let cap = 0;
  for (let t = 0; t <= o.ms; t += FRAME) {
    while (cap + latency <= t) {
      const lms = makeSkeleton({ h: BODY_H, ...o.truth(cap) });
      const bad = gauss() > 1.3 ? 2.2 : 1; // ~10 %
      for (const l of lms) {
        l.x += (gauss() * (o.noise ?? 0) * SCALE * bad) / W;
        l.y += (gauss() * (o.noise ?? 0) * SCALE * bad) / H;
      }
      tr.update(buildPeople({ landmarks: [lms] }, fit), t0 + cap + latency, t0 + cap, W);
      cap += o.every;
    }
    tr.extrapolate(t0 + t, 8);
    const k = tr.slots[0];
    const sk = makeSkeleton({ h: BODY_H, ...o.truth(t) });
    frames.push({
      t,
      head: { x: k.pts.head.x, y: k.pts.head.y },
      wrist: { x: k.pts.rw.x, y: k.pts.rw.y },
      trueHead: { x: W - sk[0].x * W, y: sk[0].y * H },
      trueWrist: { x: W - sk[16].x * W, y: sk[16].y * H },
    });
    tr.endFrame();
  }
  return { frames, tr };
}

const std = (a: number[]): number => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
};
/** length of the way the drawn point travels per second (what the eye sees as shaking) */
const pathPerSec = (f: Frame[], pick: (p: Frame) => { x: number; y: number }): number => {
  let s = 0;
  for (let i = 1; i < f.length; i++) s += Math.hypot(pick(f[i]).x - pick(f[i - 1]).x, pick(f[i]).y - pick(f[i - 1]).y);
  return (s / (f[f.length - 1].t - f[0].t)) * 1000;
};

describe("a child who stands still does not make the animal tremble", () => {
  for (const every of [100, 160, 250]) {
    it(`landmark noise of ~3 % of the shoulder width, a detection every ${every} ms`, () => {
      const { frames } = simulate({ every, noise: 0.03, ms: 8000, truth: () => ({ cx: 0.5, top: 0.3 }) });
      const f = frames.filter((p) => p.t > 2000);
      // before: 6-8 px std and 100-200 px/s of shaking for this noise (the noise itself is 2.7 px)
      // (now ~2-2.6 px: the filter is only as stiff as the noise needs, so a slow real motion is not swallowed)
      expect(std(f.map((p) => p.head.x))).toBeLessThan(3);
      expect(std(f.map((p) => p.head.y))).toBeLessThan(3);
      expect(std(f.map((p) => p.wrist.x))).toBeLessThan(3);
      // a little life is fine (a few px of std), a visible tremble is not
      expect(pathPerSec(f, (p) => p.head)).toBeLessThan(35);
      expect(pathPerSec(f, (p) => p.wrist)).toBeLessThan(35);
    });
  }

  it("tiny noise (1.5 % of the shoulder width) does not move the animal at all", () => {
    const { frames } = simulate({ every: 120, noise: 0.015, ms: 8000, truth: () => ({ cx: 0.5, top: 0.3 }) });
    const f = frames.filter((p) => p.t > 2000);
    expect(pathPerSec(f, (p) => p.head)).toBeLessThan(4);
    expect(pathPerSec(f, (p) => p.wrist)).toBeLessThan(5);
  });

  it("the size of the animal does not pulse", () => {
    const { frames, tr } = simulate({ every: 120, noise: 0.04, ms: 6000, truth: () => ({ cx: 0.5, top: 0.3 }) });
    expect(frames.length).toBeGreaterThan(100);
    expect(tr.slots[0].scale).toBeGreaterThan(SCALE * 0.9);
    expect(tr.slots[0].scale).toBeLessThan(SCALE * 1.15);
    // headR and scale are smoothed: they hardly change from one frame to the next
    const tr2 = new KidTracker();
    const g = seeded(5);
    const r: number[] = [];
    for (let i = 0; i < 80; i++) {
      const lms = makeSkeleton({ h: BODY_H, cx: 0.5, top: 0.3 });
      for (const l of lms) {
        l.x += (g() * 0.04 * SCALE) / W;
        l.y += (g() * 0.04 * SCALE) / H;
      }
      const t = 1000 + i * 120;
      tr2.update(buildPeople({ landmarks: [lms] }, fit), t, t, W);
      tr2.extrapolate(t, 0);
      if (i > 20) r.push(tr2.slots[0].headR);
    }
    expect(std(r) / (r.reduce((a, b) => a + b, 0) / r.length)).toBeLessThan(0.03);
  });

  it("the whole animal stays together: head and shoulders do not drift apart", () => {
    const { frames, tr } = simulate({ every: 150, noise: 0.03, ms: 6000, truth: () => ({ cx: 0.5, top: 0.3 }) });
    expect(frames.length).toBeGreaterThan(100);
    const P = tr.slots[0].pts;
    const sw = Math.abs(P.ls.x - P.rs.x);
    expect(sw).toBeGreaterThan(SCALE * 0.8);
    expect(sw).toBeLessThan(SCALE * 1.25);
  });
});

describe("the animal follows a child who moves", () => {
  /** mean delay of the drawn head behind the real one while walking: positive = behind, in ms */
  const lagMs = (every: number, noise: number, speed: number): number => {
    const { frames } = simulate({ every, noise, ms: 7000, truth: (t) => ({ cx: 0.15 + speed * (t / 1000), top: 0.3 }) });
    const f = frames.filter((p) => p.t > 2500 && p.t < 6000);
    const behind = f.reduce((s, p) => s + (p.head.x - p.trueHead.x), 0) / f.length; // x falls while the child walks right
    return (behind / (speed * W)) * 1000;
  };

  for (const every of [100, 160, 250]) {
    it(`walking fast (0.15 picture widths per second) with a detection every ${every} ms: no delay`, () => {
      // before: 57 / 85 / 140 ms behind. The camera + model delay (100 ms) is made up for by looking ahead along the velocity.
      const lag = Math.abs(lagMs(every, 0.03, 0.15));
      expect(lag).toBeLessThan(35);
    });
  }

  it("walking slowly (0.04 picture widths per second, ~0.6 body widths per second) is followed as well", () => {
    // a slow drift is smoothed like noise until it adds up (dead zone + smoothing): the error stays below a tenth of a body width (~5 px)
    expect((Math.abs(lagMs(160, 0.03, 0.04)) / 1000) * 0.04 * W).toBeLessThan(0.1 * SCALE);
  });

  for (const every of [160, 250]) {
    it(`walking with a detection every ${every} ms: the paws keep up with the body (a long chase must not leave them behind)`, () => {
      const speed = 0.12;
      const { frames } = simulate({ every, noise: 0, ms: 7000, truth: (t) => ({ cx: 0.15 + speed * (t / 1000), top: 0.3 }) });
      const f = frames.filter((p) => p.t > 2500 && p.t < 6000);
      const lag = (pick: (p: Frame) => { x: number }, truth: (p: Frame) => { x: number }): number => f.reduce((s, p) => s + Math.abs(pick(p).x - truth(p).x), 0) / f.length;
      const head = lag((p) => p.head, (p) => p.trueHead);
      const wrist = lag((p) => p.wrist, (p) => p.trueWrist);
      expect(wrist - head).toBeLessThan(0.05 * SCALE);
      expect(wrist).toBeLessThan(0.15 * SCALE);
    });
  }

  it("a step sideways: the animal is there ~ one detection round + the camera delay later", () => {
    const every = 150;
    const { frames } = simulate({ every, noise: 0, ms: 4000, truth: (t) => ({ cx: t < 2000 ? 0.4 : 0.55, top: 0.3 }) });
    const from = W - 0.4 * W;
    const to = W - 0.55 * W;
    const hit = frames.find((p) => p.t >= 2000 && Math.abs(p.head.x - to) < 0.15 * Math.abs(from - to));
    expect(hit).toBeDefined();
    // before: 233 ms at this rate; the model sees the step at the earliest 100 ms later and at the latest 150 ms after that
    expect((hit as Frame).t - 2000).toBeLessThan(300);
  });

  it("a waving hand: the hand follows it, but does not fly past the turning points", () => {
    const hand = (t: number): [number, number] => [0.5 - 0.1 + 0.05 * Math.sin((t / 1000) * 2 * Math.PI * 1.2), 0.2];
    const { frames } = simulate({ every: 120, noise: 0.02, ms: 6000, truth: (t) => ({ cx: 0.5, top: 0.3, armR: hand(t) }) });
    const f = frames.filter((p) => p.t > 1500);
    const xs = f.map((p) => p.wrist.x);
    const amp = Math.max(...xs) - Math.min(...xs);
    const real = 0.1 * W; // peak to peak
    expect(amp).toBeGreaterThan(real * 0.75); // it really moves
    expect(amp).toBeLessThan(real * 1.45); // before: 1.8-2 x (an extrapolated velocity at a turning point)
  });

  it("a child who stops: the animal overshoots by less than a third of a second of walking", () => {
    const speed = 0.15;
    const stopX = W - (0.15 + speed * 3) * W;
    for (const every of [100, 160]) {
      const { frames } = simulate({ every, noise: 0.02, ms: 6000, truth: (t) => ({ cx: 0.15 + speed * Math.min(3, t / 1000), top: 0.3 }) });
      const f = frames.filter((p) => p.t > 2500);
      const over = Math.max(...f.map((p) => stopX - p.head.x));
      expect(over).toBeLessThan(speed * W * 0.33);
      // and it settles on the child
      expect(Math.abs(f[f.length - 1].head.x - stopX)).toBeLessThan(0.1 * SCALE);
    }
  });

  it("a point that gets no detection for a while coasts a little and stops: it does not run away", () => {
    const tr = new KidTracker();
    const t0 = 1000;
    for (let i = 0; i < 20; i++) {
      const t = t0 + i * 66;
      tr.update(buildPeople({ landmarks: [makeSkeleton({ h: BODY_H, cx: 0.2 + 0.0132 * i, top: 0.3 })] }, fit), t, t, W);
      tr.extrapolate(t, 0);
    }
    const x0 = tr.slots[0].pts.head.x;
    let t = t0 + 20 * 66;
    for (; t < t0 + 20 * 66 + 700; t += FRAME) tr.extrapolate(t, 0);
    const moved = x0 - tr.slots[0].pts.head.x;
    // 0.2 W/s = 256 px/s; at most ~0.5 s of it
    expect(moved).toBeGreaterThan(40);
    expect(moved).toBeLessThan(256 * 0.55);
    const x1 = tr.slots[0].pts.head.x;
    for (; t < t0 + 20 * 66 + 1500; t += FRAME) tr.extrapolate(t, 0);
    expect(Math.abs(tr.slots[0].pts.head.x - x1)).toBeLessThan(25);
  });
});

describe("a child who moves slowly never looks stuck", () => {
  /** share of the frames in which the child really moves but the drawn point stands (almost) still, and the longest such run (ms) */
  const stuck = (every: number, noise: number, truth: Truth, pick: "head" | "wrist"): { share: number; longest: number } => {
    const { frames } = simulate({ every, noise, ms: 10000, truth });
    const f = frames.filter((p) => p.t > 2000);
    const tp = (p: Frame) => (pick === "head" ? p.trueHead : p.trueWrist);
    const dp = (p: Frame) => (pick === "head" ? p.head : p.wrist);
    let moving = 0;
    let still = 0;
    let run = 0;
    let longest = 0;
    for (let i = 1; i < f.length; i++) {
      const trueStep = Math.hypot(tp(f[i]).x - tp(f[i - 1]).x, tp(f[i]).y - tp(f[i - 1]).y);
      if (trueStep < 0.15) continue; // the child itself hardly moves (a turning point)
      moving++;
      if (Math.hypot(dp(f[i]).x - dp(f[i - 1]).x, dp(f[i]).y - dp(f[i - 1]).y) < 0.05) {
        still++;
        run += FRAME;
        longest = Math.max(longest, run);
      } else run = 0;
    }
    return { share: still / moving, longest };
  };

  for (const every of [100, 160]) {
    for (const [name, amp, hz] of [["a slow sway", 0.2, 0.3], ["a gentle sway", 0.43, 0.4]] as const) {
      it(`${name} of the whole body, a detection every ${every} ms: the animal moves with the child (not in steps)`, () => {
        const truth: Truth = (t) => ({ cx: 0.5 + ((amp * SCALE) / W) * Math.sin((t / 1000) * 2 * Math.PI * hz), top: 0.3 });
        const r = stuck(every, 0.02, truth, "head");
        expect(r.share).toBeLessThan(0.15);
        expect(r.longest).toBeLessThan(220);
      });
    }
  }

  it("an arm raise: the wrist is within ~a third of a body width of the real hand on average", () => {
    for (const every of [100, 160]) {
      const rise = (t: number): [number, number] => [0.5 - 0.1, 0.3 + 0.2 - 0.17 * Math.min(1, Math.max(0, (t - 3000) / 500))];
      const { frames } = simulate({ every, noise: 0.02, ms: 5000, truth: (t) => ({ cx: 0.5, top: 0.3, armR: rise(t) }) });
      const f = frames.filter((p) => p.t > 3000 && p.t < 4500);
      const rms = Math.sqrt(f.reduce((s, p) => s + (p.wrist.x - p.trueWrist.x) ** 2 + (p.wrist.y - p.trueWrist.y) ** 2, 0) / f.length);
      expect(rms).toBeLessThan(36);
    }
  });
});

describe("the signals survive the smoothing", () => {
  it("a jump is seen once, with a noisy camera and 8 detections per second", () => {
    const { tr } = simulate({
      every: 125,
      noise: 0.03,
      ms: 6000,
      // standing, one 0.5 s jump (the body rises by 0.1 of the picture height = 0.8 body widths) at 3 s
      truth: (t) => ({ cx: 0.5, top: 0.3 - (t > 3000 && t < 3500 ? 0.1 * Math.sin(((t - 3000) / 500) * Math.PI) : 0) }),
    });
    expect(tr.slots[0].signals.jumps).toBe(1);
  });

  it("hands up and a clap are seen with a noisy camera", () => {
    const { tr } = simulate({ every: 125, noise: 0.03, ms: 2500, truth: () => ({ cx: 0.5, top: 0.3, armL: "up", armR: "up" }) });
    expect(tr.slots[0].signals.handsUp).toBe(true);
  });

  it("a child who stands still (noisy) counts as still, one who walks does not", () => {
    const a = simulate({ every: 125, noise: 0.03, ms: 4000, truth: () => ({ cx: 0.5, top: 0.3 }) });
    expect(a.tr.slots[0].signals.still).toBe(true);
    const b = simulate({ every: 125, noise: 0.03, ms: 4000, truth: (t) => ({ cx: 0.2 + 0.15 * (t / 1000), top: 0.3 }) });
    expect(b.tr.slots[0].signals.still).toBe(false);
  });
});
