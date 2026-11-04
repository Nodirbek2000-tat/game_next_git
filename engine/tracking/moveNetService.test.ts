import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeTf } from "./fakeTf";
import type { FromWorker } from "./moveNetProtocol";
import { MoveNetService, type Converter, type Core } from "./moveNetService";

// The worker side of MoveNet with a fake TensorFlow.js: init sequence, frames, brightening table, errors, tensor leaks, shutdown.

let fake = makeFakeTf();
let sent: FromWorker[] = [];
let closedCb = vi.fn();
let webgl = true;

function service(): MoveNetService {
  return new MoveNetService({
    tf: fake.tf as unknown as Core,
    conv: fake.conv as unknown as Converter,
    post: (m) => void sent.push(m),
    canWebgl: () => webgl,
    onClosed: closedCb,
  });
}
const bitmap = () => ({ width: 256, height: 144, close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
const frame = (id: number, b: ImageBitmap, geo = { rw: 256, rh: 144, pw: 256, ph: 160 }) => ({ type: "frame" as const, id, bitmap: b, ...geo });
const of = <T extends FromWorker["type"]>(t: T) => sent.filter((m): m is Extract<FromWorker, { type: T }> => m.type === t);

async function ready(): Promise<MoveNetService> {
  const s = service();
  await s.handle({ type: "init", modelUrl: "http://x/m.json", geos: [{ rw: 256, rh: 144, pw: 256, ph: 160 }] });
  return s;
}

beforeEach(() => {
  fake = makeFakeTf();
  sent = [];
  closedCb = vi.fn();
  webgl = true;
});

describe("MoveNetService init", () => {
  it("loads the model, warms it up and answers ready with the back-end; progress only goes forward", async () => {
    await ready();
    expect(fake.st.loadedUrl).toBe("http://x/m.json");
    expect(of("ready")).toEqual([{ type: "ready", backend: "webgl" }]);
    const pct = of("progress").map((m) => m.pct);
    expect(pct.length).toBeGreaterThan(2);
    expect(pct.every((p, i) => i === 0 || p >= pct[i - 1])).toBe(true);
    expect(sent[sent.length - 1].type).toBe("ready");
    expect(fake.st.live).toBe(0); // the warm-up tensors are gone
    // warm-up at the starting size, padded
    expect(fake.st.executed[0]).toEqual([1, 160, 256, 3]);
  });

  it("compiles the shaders in parallel first (compile-only mode, switched off again), then runs once for real", async () => {
    await ready();
    expect(fake.st.compileOnlyAtExecute).toEqual([true, false]);
    expect(fake.st.flags.ENGINE_COMPILE_ONLY).toBe(false);
    expect(fake.st.ops).toContain("compile-wait");
    expect(fake.st.ops.indexOf("uniforms")).toBeGreaterThan(fake.st.ops.indexOf("compile-wait"));
    expect(fake.st.live).toBe(0);
  });

  it("a failing compile-only pass is not fatal: the plain run compiles what is missing", async () => {
    fake.tf.backend = () => ({
      checkCompileCompletionAsync: async () => {
        throw new Error("no ext");
      },
      getUniformLocations: () => undefined,
    });
    await ready();
    expect(of("ready")).toHaveLength(1);
    expect(fake.st.flags.ENGINE_COMPILE_ONLY).toBe(false);
  });

  it("does not turn off WEBGL_CPU_FORWARD (it makes the graph read tiny tensors back one by one)", async () => {
    await ready();
    expect(fake.st.envSet.map(([k]) => k)).not.toContain("WEBGL_CPU_FORWARD");
  });

  it("says 'unsupported' when WebGL is not available in this worker, or tfjs cannot use it", async () => {
    webgl = false;
    await ready();
    expect(sent).toEqual([{ type: "unsupported", reason: "nowebgl" }]);
    sent = [];
    webgl = true;
    fake.st.webgl = false;
    await ready();
    expect(of("unsupported")).toEqual([{ type: "unsupported", reason: "backend" }]);
  });

  it("every chunk of the model download is a sign of life (progress), at most a few times a second", async () => {
    let t = 0;
    let fetchFunc: ((u: string, i?: RequestInit) => Promise<Response>) | undefined;
    fake.conv.loadGraphModel = (async (_u: string, o: { fetchFunc?: typeof fetchFunc }) => {
      fetchFunc = o.fetchFunc;
      return { dispose: () => undefined, execute: () => undefined } as never;
    }) as never;
    const chunks = [new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)];
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } })));
    const s = new MoveNetService({
      tf: fake.tf as unknown as Core,
      conv: fake.conv as unknown as Converter,
      post: (m) => void sent.push(m),
      canWebgl: () => true,
      now: () => (t += 300),
    });
    s.handle({ type: "init", modelUrl: "http://x/m.json", geos: [{ rw: 256, rh: 144, pw: 256, ph: 160 }] }).catch(() => undefined);
    await vi.waitFor(() => expect(fetchFunc).toBeDefined());
    const before = of("progress").length;
    const res = await fetchFunc!("http://x/w.bin");
    expect((await res.arrayBuffer()).byteLength).toBe(30);
    expect(of("progress").length - before).toBe(3);
    vi.unstubAllGlobals();
  });

  it("reports a fatal error when the model cannot be loaded", async () => {
    fake.conv.loadGraphModel = async () => {
      throw new Error("404");
    };
    await ready();
    expect(of("error")).toEqual([{ type: "error", message: "404", fatal: true }]);
    expect(of("ready")).toHaveLength(0);
  });
});

describe("MoveNetService frames", () => {
  it("a picture that arrives before the worker is ready is dropped (and its bitmap closed)", async () => {
    const s = service();
    const b = bitmap();
    await s.handle(frame(1, b));
    expect(sent).toEqual([{ type: "skipped", id: 1 }]);
    expect(b.close).toHaveBeenCalled();
  });

  it("answers with the model output, the id and the tensor count; the bitmap is closed; padding runs on the GPU", async () => {
    const s = await ready();
    fake.setOutput({ score: 0.7, nose: [0.4, 0.5] });
    sent = [];
    fake.st.ops.length = 0;
    const b = bitmap();
    await s.handle(frame(7, b));
    const r = of("result");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(7);
    expect(r[0].data).toHaveLength(6 * 56);
    expect(r[0].data[55]).toBeCloseTo(0.7, 5);
    expect(r[0].tensors).toBeGreaterThanOrEqual(0);
    expect(b.close).toHaveBeenCalled();
    expect(fake.st.ops).toEqual(["fromPixels 256x144", "pad"]);
    expect(fake.st.executed[fake.st.executed.length - 1]).toEqual([1, 160, 256, 3]);
  });

  it("a new picture size is compiled in parallel (compile-only) before its first run, once per size", async () => {
    const s = await ready();
    fake.st.compileOnlyAtExecute.length = 0;
    await s.handle(frame(1, bitmap())); // the size warmed at start: nothing to compile
    expect(fake.st.compileOnlyAtExecute).toEqual([false]);
    fake.st.compileOnlyAtExecute.length = 0;
    await s.handle(frame(2, bitmap(), { rw: 320, rh: 180, pw: 320, ph: 192 }));
    expect(fake.st.compileOnlyAtExecute).toEqual([true, false]);
    fake.st.compileOnlyAtExecute.length = 0;
    await s.handle(frame(3, bitmap(), { rw: 320, rh: 180, pw: 320, ph: 192 }));
    expect(fake.st.compileOnlyAtExecute).toEqual([false]);
    expect(of("result").map((m) => m.id)).toEqual([1, 2, 3]);
    expect(fake.st.live).toBe(0);
  });

  it("init compiles every size of the session in ONE compile-only pass (no duplicates), announces each, then runs the first for real", async () => {
    const s = service();
    const g = { rw: 192, rh: 108, pw: 192, ph: 128 };
    const g2 = { rw: 320, rh: 180, pw: 320, ph: 192 };
    await s.handle({ type: "init", modelUrl: "x", geos: [{ rw: 256, rh: 144, pw: 256, ph: 160 }, g, g2, g] });
    expect(fake.st.compileOnlyAtExecute).toEqual([true, true, true, false]);
    expect(fake.st.ops.filter((o) => o === "compile-wait")).toHaveLength(1);
    expect(of("compiled").map((m) => m.key)).toEqual(["256x144x256x160", "192x108x192x128", "320x180x320x192"]);
    expect(fake.st.executed[fake.st.executed.length - 1]).toEqual([1, 160, 256, 3]); // the real warm-up run is the starting size
    expect(fake.st.live).toBe(0);
    fake.st.compileOnlyAtExecute.length = 0;
    await s.handle(frame(1, bitmap(), g2));
    expect(fake.st.compileOnlyAtExecute).toEqual([false]); // compiled at start: no stall in the game
    expect(of("result").map((m) => m.id)).toEqual([1]);
  });

  it("a compile-only pass that fails announces nothing; the warm-up run still makes the starting size ready, a failed size is tried once per picture size", async () => {
    fake.st.compileFails = true;
    const s = service();
    const g2 = { rw: 320, rh: 180, pw: 320, ph: 192 };
    await s.handle({ type: "init", modelUrl: "x", geos: [{ rw: 256, rh: 144, pw: 256, ph: 160 }, g2] });
    expect(of("ready")).toHaveLength(1);
    expect(of("compiled").map((m) => m.key)).toEqual(["256x144x256x160"]); // from the real run, not from the failed pass
    fake.st.compileOnlyAtExecute.length = 0;
    await s.handle(frame(1, bitmap(), g2));
    await s.handle(frame(2, bitmap(), g2));
    expect(fake.st.compileOnlyAtExecute).toEqual([true, false, false]); // one more try, then the real run made it; never again
    expect(of("result").map((m) => m.id)).toEqual([1, 2]);
  });

  it("announces the size compiled at start, so the page knows it", async () => {
    await ready();
    expect(of("compiled").map((m) => m.key)).toEqual(["256x144x256x160"]);
  });

  it("no padding op when the picture already is a multiple of 32", async () => {
    const s = await ready();
    fake.st.ops.length = 0;
    await s.handle(frame(1, bitmap(), { rw: 256, rh: 160, pw: 256, ph: 160 }));
    expect(fake.st.ops).not.toContain("pad");
  });

  it("leaks nothing: the tensor count is the same after 300 frames", async () => {
    const s = await ready();
    const before = fake.st.live;
    for (let i = 0; i < 300; i++) await s.handle(frame(i, bitmap()));
    expect(fake.st.live).toBe(before);
    expect(of("result")).toHaveLength(300);
  });

  it("only one picture at a time: one that arrives while another runs is skipped", async () => {
    const s = await ready();
    fake.st.holdData = true;
    const first = s.handle(frame(1, bitmap()));
    const b2 = bitmap();
    await s.handle(frame(2, b2));
    expect(of("skipped")).toEqual([{ type: "skipped", id: 2 }]);
    expect(b2.close).toHaveBeenCalled();
    fake.st.release?.();
    await first;
    expect(of("result").map((m) => m.id)).toEqual([1]);
  });

  it("a failing call posts a non-fatal error with the id, disposes its tensors and closes the bitmap; later frames still work", async () => {
    const s = await ready();
    fake.st.failData = true;
    const b = bitmap();
    await s.handle(frame(3, b));
    expect(of("error")).toEqual([{ type: "error", id: 3, message: "context lost", fatal: false }]);
    expect(fake.st.live).toBe(0);
    expect(b.close).toHaveBeenCalled();
    fake.st.failData = false;
    await s.handle(frame(4, bitmap()));
    expect(of("result").map((m) => m.id)).toEqual([4]);
  });
});

describe("MoveNetService brightening table", () => {
  const lut = new Uint8Array(256).map((_, i) => Math.min(255, i * 2));

  it("is applied on the GPU while set (gather) and not after it is cleared; the old table tensor is disposed", async () => {
    const s = await ready();
    const base = fake.st.live;
    await s.handle({ type: "lut", lut });
    expect(fake.st.live).toBe(base + 1);
    expect(fake.st.lutValues[0][100]).toBe(200);
    fake.st.ops.length = 0;
    await s.handle(frame(1, bitmap()));
    expect(fake.st.ops).toContain("gather");
    await s.handle({ type: "lut", lut: lut.map((v) => v >> 1) });
    expect(fake.st.live).toBe(base + 1); // replaced, not added
    await s.handle({ type: "lut", lut: null });
    expect(fake.st.live).toBe(base);
    fake.st.ops.length = 0;
    await s.handle(frame(2, bitmap()));
    expect(fake.st.ops).not.toContain("gather");
  });

  it("ignores a table of the wrong size", async () => {
    const s = await ready();
    const base = fake.st.live;
    await s.handle({ type: "lut", lut: new Uint8Array(10) });
    expect(fake.st.live).toBe(base);
  });
});

describe("MoveNetService close", () => {
  it("disposes the model and the table once, closes the worker and drops later pictures", async () => {
    const s = await ready();
    await s.handle({ type: "lut", lut: new Uint8Array(256) });
    await s.handle({ type: "close" });
    await s.handle({ type: "close" });
    expect(fake.st.modelDisposed).toBe(1);
    expect(fake.st.live).toBe(0);
    expect(closedCb).toHaveBeenCalledTimes(1);
    sent = [];
    const b = bitmap();
    await s.handle(frame(9, b));
    expect(sent).toEqual([{ type: "skipped", id: 9 }]);
    expect(b.close).toHaveBeenCalled();
  });

  it("a close during the model download disposes the model that arrives late", async () => {
    let finish!: () => void;
    const model = { execute: fake.model.execute, dispose: vi.fn() };
    fake.conv.loadGraphModel = () => new Promise((res) => (finish = () => res(model as never))) as never;
    const s = service();
    const init = s.handle({ type: "init", modelUrl: "x", geos: [{ rw: 256, rh: 144, pw: 256, ph: 160 }] });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await s.handle({ type: "close" });
    finish();
    await init;
    expect(model.dispose).toHaveBeenCalledTimes(1);
    expect(of("ready")).toHaveLength(0);
  });
});
