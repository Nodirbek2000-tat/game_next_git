import { chromium, test, type Browser, type CDPSession, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { makeSkeleton, makeSmallFrame } from "../../engine/testing/skeleton";

/**
 * Performance harness. NOT part of the normal e2e run (it has its own config, playwright.perf.config.ts):
 *
 *   PERF_BASE=http://localhost:3300 PERF_LABEL=before PERF_OUT=e2e/perf/out/before.jsonl npx playwright test -c playwright.perf.config.ts
 *
 * The GPU is the real one (ANGLE/D3D11) unless PERF_SOFTWARE=1 (SwiftShader).
 * Env: PERF_GAMES=meva-ninja,mashina  PERF_THROTTLE=1,4  PERF_SECONDS=12  PERF_WORKER=0 (main-thread tracking)  PERF_MOBILE=1  PERF_HEADED=1
 *
 * The REAL tracking path is used (Chromium fake camera device + the MediaPipe detector, worker or main thread).
 * To get game activity without a person in front of the camera, the input of `tracker.process` is replaced by a synthetic
 * autopilot skeleton (the real detector still runs and its result is discarded) = a realistic CPU load:
 * real model + real camera frames + real game. CPU throttling is done through CDP (4x ~ a weak PC / phone).
 */

const BASE = process.env.PERF_BASE ?? "http://localhost:3300";
const OUT = process.env.PERF_OUT ?? "e2e/perf/out/run.jsonl";
const SECONDS = Number(process.env.PERF_SECONDS ?? 12);
const THROTTLES = (process.env.PERF_THROTTLE ?? "1,4").split(",").map(Number);
const ONLY = process.env.PERF_GAMES?.split(",");
const WORKER = process.env.PERF_WORKER ?? "1";
const MOBILE = process.env.PERF_MOBILE === "1";

interface GameSpec {
  slug: string;
  kids: boolean;
  query: string;
}
const GAMES: GameSpec[] = [
  { slug: "meva-ninja", kids: false, query: "duration=120" },
  { slug: "baliq-ovi", kids: false, query: "duration=120" },
  { slug: "mashina", kids: false, query: "duration=120" },
  { slug: "pufakchalar", kids: true, query: "duration=120" },
  { slug: "qotib-qol", kids: true, query: "duration=120" },
  { slug: "hayvonlar", kids: true, query: "duration=120" },
  { slug: "baliqcha", kids: true, query: "duration=120" },
];

const ARGS = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
];

function initScript(args: { mk: string; mkSmall: string; kids: boolean }): void {
  const w = window as unknown as Record<string, unknown>;
  const mk = new Function(`return (${args.mk})`)() as (o: unknown) => unknown;
  const mkSmall = new Function(`return (${args.mkSmall})`)() as (p: unknown) => Uint8ClampedArray;
  const people = args.kids ? [0.2, 0.5, 0.8] : [0.5];
  w.__smallFixed = mkSmall(people.map((cx) => ({ cx, top: args.kids ? 0.25 : 0.12, h: args.kids ? 0.5 : 0.8, rgb: [200, 40, 40] as [number, number, number] })));
  w.__perfSkeleton = (now: number): unknown => {
    const t = now / 1000;
    const lms = people.map((cx, i) => {
      const o: Record<string, unknown> = { cx, top: args.kids ? 0.25 : 0.12, h: args.kids ? 0.5 : 0.8 };
      // arms sweep fast over the whole play area (cuts fruit, pulls fish, hits bubbles)
      o.armR = [0.5 + 0.34 * Math.sin(t * 7.1 + i), 0.5 + 0.24 * Math.cos(t * 5.3 + i)];
      o.armL = [0.5 + 0.34 * Math.sin(t * 6.1 + 2 + i), 0.5 + 0.24 * Math.cos(t * 4.7 + 1 + i)];
      if (args.kids) {
        o.armR = Math.sin(t * 1.3 + i) > 0 ? "up" : "down";
        o.armL = Math.sin(t * 1.1 + i) > 0 ? "up" : "down";
      }
      return mk(o);
    });
    return { pose: { landmarks: lms }, hand: null };
  };
  // frame time / long task recorder
  const rec = { frames: [] as number[], long: [] as number[], on: false, last: 0 };
  w.__perfRec = rec;
  const loop = (t: number): void => {
    if (rec.on && rec.last) rec.frames.push(t - rec.last);
    rec.last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((l) => {
      if (rec.on) for (const e of l.getEntries()) rec.long.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask not supported */
  }
}

interface Row {
  game: string;
  /** the first screen after the camera (scan, or "ready" for kids games), nothing heavy on it: fps and p95 frame time */
  menuFps: number;
  menuP95: number;
  menuGpuCpuPct: number;
  /** model loading (worker start + download + benchmark) until the first screen, seconds */
  loadSec: number;
  throttle: number;
  mobile: boolean;
  build: string;
  fps: number;
  frameP50: number;
  frameP95: number;
  frameMax: number;
  longTasks: number;
  longTaskMs: number;
  backend: string;
  poseModel: string;
  detectFps: number;
  inferMs: number;
  mainBusyPct: number;
  /** CPU seconds per second of the whole renderer process (main thread + tracking worker), of the GPU process and of the browser process, in % of one core */
  rendererCpuPct: number;
  gpuCpuPct: number;
  browserCpuPct: number;
  calls: number;
  tris: number;
  level: string;
  pixelRatio: number;
  detectCap: number;
  note: string;
  /** PERF_PROFILE=1: main thread self time per function (top 12) while playing */
  top?: string[];
}

async function procCpu(browser: Browser): Promise<Record<string, number>> {
  const s = await browser.newBrowserCDPSession();
  try {
    const r = (await s.send("SystemInfo.getProcessInfo" as never)) as { processInfo: { type: string; cpuTime: number }[] };
    const out: Record<string, number> = {};
    for (const p of r.processInfo) out[p.type] = (out[p.type] ?? 0) + p.cpuTime;
    return out;
  } finally {
    await s.detach().catch(() => undefined);
  }
}

/** Frame times / GPU process CPU over `ms` milliseconds. */
async function record(page: Page, browser: Browser, ms: number): Promise<{ fps: number; p95: number; gpu: number }> {
  const p0 = await procCpu(browser);
  await page.evaluate(() => {
    const r = (window as unknown as { __perfRec: { frames: number[]; long: number[]; on: boolean } }).__perfRec;
    r.frames.length = 0;
    r.on = true;
  });
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  const el = (Date.now() - t0) / 1000;
  const p1 = await procCpu(browser);
  const frames = await page.evaluate(() => {
    const r = (window as unknown as { __perfRec: { frames: number[]; on: boolean } }).__perfRec;
    r.on = false;
    return r.frames.slice();
  });
  const f = frames.sort((a, b) => a - b);
  const mean = f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
  return { fps: +(1000 / (mean || 1)).toFixed(1), p95: +(f[Math.min(f.length - 1, Math.floor(f.length * 0.95))] ?? 0).toFixed(1), gpu: Math.round((((p1.GPU ?? 0) - (p0.GPU ?? 0)) / el) * 100) };
}

async function runOne(browser: Browser, g: GameSpec, throttle: number): Promise<Row> {
  const ctx = await browser.newContext(
    MOBILE
      ? {
          viewport: { width: 844, height: 390 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          userAgent: "Mozilla/5.0 (Linux; Android 12; SM-A325F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
        }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  );
  await ctx.grantPermissions(["camera"], { origin: BASE });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(initScript, { mk: makeSkeleton.toString(), mkSmall: makeSmallFrame.toString(), kids: g.kids });
  await page.addInitScript(() => localStorage.setItem("harakat.settings", JSON.stringify({ state: { sound: false, music: false }, version: 1 })));
  // the microphone / speech recognition is optional and not part of this measurement (and crashes headless Chromium)
  await page.addInitScript(() => localStorage.setItem("harakat.baliqcha.voice", "0"));
  const cdp: CDPSession = await ctx.newCDPSession(page);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await cdp.send("Performance.enable");
  await page.goto(`${BASE}/play/${g.slug}?${g.query}${WORKER === "0" ? "&worker=0" : ""}`);
  const waitState = (s: string, timeout = 90_000) => page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });
  let note = "";
  let menu = { fps: 0, p95: 0, gpu: 0 };
  const tLoad = Date.now();
  let loadSec = 0;
  try {
    // loading (model download + wasm init), then scan / ready
    await page.waitForFunction(
      () => {
        const e = (window as unknown as { __engine?: { state: string } }).__engine;
        return !!e && (e.state === "scan" || e.state === "ready");
      },
      undefined,
      { timeout: 120_000 },
    );
    loadSec = (Date.now() - tLoad) / 1000;
    // the menu screen (scan / ready): record it as it is, with the real detector running
    await page.waitForTimeout(3000);
    menu = await record(page, browser, 6000);
    // drive the game with the synthetic skeleton on top of the real detector
    await page.evaluate(() => {
      const w = window as unknown as { __engine: { tracker: { process: (d: unknown, n: number, c?: number) => void }; config: { lock: { lostPauseSec: number } } }; __perfSkeleton: (n: number) => unknown };
      const e = w.__engine;
      const orig = e.tracker.process.bind(e.tracker);
      e.tracker.process = (_d, n, c) => orig(w.__perfSkeleton(n), n, c);
      e.config.lock.lostPauseSec = 1e9;
    });
    if ((await page.evaluate(() => (window as unknown as { __engine: { state: string } }).__engine.state)) === "scan") {
      await page.evaluate(() => (window as unknown as { __engine: { skipScan: () => void } }).__engine.skipScan());
    }
    await waitState("ready");
    await page.evaluate(() => (window as unknown as { __engine: { startGame: () => void } }).__engine.startGame());
    await waitState("play", 60_000);
  } catch (e) {
    note = "ERR " + String(e).slice(0, 120);
  }
  // let the quality controller settle a bit, then record
  await page.waitForTimeout(5000);
  const profile = process.env.PERF_PROFILE === "1";
  if (profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    await cdp.send("Profiler.start");
  }
  const p0 = await procCpu(browser);
  const m0 = await cdp.send("Performance.getMetrics");
  await page.evaluate(() => {
    const r = (window as unknown as { __perfRec: { frames: number[]; long: number[]; on: boolean } }).__perfRec;
    r.frames.length = 0;
    r.long.length = 0;
    r.on = true;
  });
  const t0 = Date.now();
  const res = await page.evaluate(
    (ms) =>
      new Promise<{ calls: number; tris: number }>((resolve) => {
        const e = (window as unknown as { __engine: { gl?: { info: { render: { calls: number; triangles: number } } } | null } }).__engine;
        let calls = 0;
        let tris = 0;
        const t = performance.now();
        const f = (): void => {
          const r = e.gl?.info?.render;
          if (r) {
            calls = Math.max(calls, r.calls);
            tris = Math.max(tris, r.triangles);
          }
          if (performance.now() - t < ms) requestAnimationFrame(f);
          else resolve({ calls, tris });
        };
        f();
      }),
    SECONDS * 1000,
  );
  const elapsed = (Date.now() - t0) / 1000;
  const m1 = await cdp.send("Performance.getMetrics");
  const p1 = await procCpu(browser);
  let top: string[] | undefined;
  if (profile) {
    const { profile: prof } = (await cdp.send("Profiler.stop")) as unknown as {
      profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] };
    };
    const self = new Map<number, number>();
    prof.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (prof.timeDeltas[i] ?? 0)));
    const byName = new Map<string, number>();
    for (const n of prof.nodes) {
      const cf = n.callFrame;
      const name = `${cf.functionName || "(anon)"} ${cf.url.split("/").slice(-1)[0].slice(0, 40)}:${cf.lineNumber}`;
      byName.set(name, (byName.get(name) ?? 0) + (self.get(n.id) ?? 0));
    }
    top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(v / 1000 / elapsed / 10).toFixed(1)}% ${k}`);
  }
  const pct = (t: string): number => Math.round((((p1[t] ?? 0) - (p0[t] ?? 0)) / elapsed) * 100);
  const metric = (m: { metrics: { name: string; value: number }[] }, n: string): number => m.metrics.find((x) => x.name === n)?.value ?? 0;
  const busy = (metric(m1, "TaskDuration") - metric(m0, "TaskDuration")) / elapsed;
  const out = await page.evaluate(() => {
    const w = window as unknown as {
      __perfRec: { frames: number[]; long: number[]; on: boolean };
      __engine: {
        detector?: { info: { where: string; poseModel: string } } | null;
        detEma: number;
        lat: { infer: number };
        quality: { level: string; pixelRatio: number };
        sched: { capFps: number };
        state: string;
      };
    };
    const r = w.__perfRec;
    r.on = false;
    const e = w.__engine;
    return {
      frames: r.frames.slice(),
      long: r.long.slice(),
      where: e.detector?.info.where ?? "?",
      model: e.detector?.info.poseModel ?? "?",
      detEma: e.detEma,
      infer: e.lat.infer,
      level: e.quality.level,
      pr: e.quality.pixelRatio,
      cap: e.sched.capFps,
      state: e.state,
    };
  });
  const f = out.frames.slice().sort((a, b) => a - b);
  const q = (p: number): number => f[Math.min(f.length - 1, Math.floor(f.length * p))] ?? 0;
  const mean = f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
  if (out.state !== "play") note += ` state=${out.state}`;
  if (errors.length) note += ` pageerrors=${errors.length}:${errors[0].slice(0, 80)}`;
  await ctx.close();
  return {
    game: g.slug,
    menuFps: menu.fps,
    menuP95: menu.p95,
    menuGpuCpuPct: menu.gpu,
    loadSec: +loadSec.toFixed(1),
    throttle,
    mobile: MOBILE,
    build: process.env.PERF_LABEL ?? "?",
    fps: +(1000 / (mean || 1)).toFixed(1),
    frameP50: +q(0.5).toFixed(1),
    frameP95: +q(0.95).toFixed(1),
    frameMax: +(f[f.length - 1] ?? 0).toFixed(1),
    longTasks: out.long.length,
    longTaskMs: Math.round(out.long.reduce((a, b) => a + b, 0)),
    backend: out.where,
    poseModel: out.model,
    detectFps: +out.detEma.toFixed(1),
    inferMs: +out.infer.toFixed(1),
    mainBusyPct: Math.round(busy * 100),
    rendererCpuPct: pct("renderer"),
    gpuCpuPct: pct("GPU"),
    browserCpuPct: pct("browser"),
    calls: res.calls,
    tris: res.tris,
    level: out.level,
    pixelRatio: +out.pr.toFixed(2),
    detectCap: out.cap,
    note: note.trim(),
    top,
  };
}

test("perf matrix", async () => {
  test.setTimeout(3_600_000);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, "");
  // a fresh browser per run: the fake camera device and the GPU process start from the same state every time; a failed run is repeated once
  const launch = (): Promise<Browser> =>
    chromium.launch({ headless: process.env.PERF_HEADED !== "1", ignoreDefaultArgs: ["--disable-gpu"], args: [...ARGS, ...(process.env.PERF_SOFTWARE === "1" ? [] : ["--use-angle=d3d11", "--enable-gpu"])] });
  for (const throttle of THROTTLES) {
    for (const g of GAMES) {
      if (ONLY && !ONLY.includes(g.slug)) continue;
      let row: Row | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const browser = await launch();
        try {
          row = await runOne(browser, g, throttle);
        } finally {
          await browser.close();
        }
        if (!row.note.startsWith("ERR")) break;
      }
      appendFileSync(OUT, `${JSON.stringify(row)}\n`);
      console.log(JSON.stringify(row));
    }
  }
});
