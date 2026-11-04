import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CROWD_CFG } from "./crowdConfig";
import { makeFakeTf } from "./fakeTf";
import type { FromWorker, ToWorker } from "./moveNetProtocol";
import { MoveNetService, type Converter, type Core } from "./moveNetService";
import { MoveNetUnsupported, MoveNetWorkerDetector, type WorkerLike } from "./moveNetWorker";

// The page side of the MoveNet worker. The worker is a stand-in: either wired to the real MoveNetService (with a fake TensorFlow.js), so
// the whole protocol runs, or a scripted one (silent, crashing, unsupported).

type Listener = (e: never) => void;

class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  private msg: Listener[] = [];
  private err: Listener[] = [];
  constructor(private readonly onSend: (m: ToWorker, w: FakeWorker) => void = () => undefined) {}
  postMessage(m: ToWorker): void {
    this.sent.push(m);
    this.onSend(m, this);
  }
  addEventListener(type: "message" | "error", f: Listener): void {
    (type === "message" ? this.msg : this.err).push(f);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(m: FromWorker): void {
    for (const f of this.msg) f({ data: m } as never);
  }
  fail(message: string): void {
    for (const f of this.err) f({ message } as never);
  }
}

let fake = makeFakeTf();
const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
const grab = async (_v: HTMLVideoElement, w: number, h: number): Promise<ImageBitmap> => {
  const b = { width: w, height: h, close: vi.fn() };
  bitmaps.push(b);
  return b as unknown as ImageBitmap;
};
function video(w = 1280, h = 720): HTMLVideoElement {
  return { videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement;
}

/** A worker that is the real service on top of the fake tfjs; answers asynchronously like a real one. */
function serviceWorker(): FakeWorker {
  const service = new MoveNetService({
    tf: fake.tf as unknown as Core,
    conv: fake.conv as unknown as Converter,
    post: (m) => queueMicrotask(() => w.emit(m)),
    canWebgl: () => true,
  });
  const w: FakeWorker = new FakeWorker((m) => void service.handle(m));
  return w;
}

beforeEach(() => {
  fake = makeFakeTf();
  bitmaps.length = 0;
  vi.stubGlobal("location", { origin: "http://localhost:3201" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function create(w: FakeWorker, extra: { maxPeople?: number; side?: number | null } = {}): Promise<MoveNetWorkerDetector> {
  return MoveNetWorkerDetector.create({ maxPeople: extra.maxPeople ?? 5, side: extra.side, makeWorker: () => w, grab });
}

describe("MoveNetWorkerDetector with a working worker", () => {
  it("starts the worker with the absolute model URL and the starting size, reports progress up to 100 and the back-end", async () => {
    const seen: number[] = [];
    const w = serviceWorker();
    const d = await MoveNetWorkerDetector.create({ maxPeople: 5, makeWorker: () => w, grab, onProgress: (p) => seen.push(p) });
    expect(w.sent[0]).toEqual({
      type: "init",
      modelUrl: "http://localhost:3201/models/movenet-multipose/model.json",
      // the starting size first, then the lower rung and one above (no camera size given: 1280 x 720)
      geos: [
        { rw: 256, rh: 144, pw: 256, ph: 160 },
        { rw: 192, rh: 108, pw: 192, ph: 128 },
        { rw: 320, rh: 180, pw: 320, ph: 192 },
      ],
    });
    expect(d.backend).toBe("webgl");
    expect(d.where).toBe("worker");
    expect(seen[seen.length - 1]).toBe(100);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1])).toBe(true);
    d.close();
  });

  it("detect(): bitmap at the model size goes to the worker, people come back as 33 normalised landmarks", async () => {
    const w = serviceWorker();
    const d = await create(w);
    fake.setOutput({ score: 0.9, nose: [0.25, 0.5] }, { score: 0.1, nose: [0.9, 0.9] }, { score: 0.6, nose: [0.75, 0.3] });
    const r = await d.detect(video());
    const frame = w.sent.find((m) => m.type === "frame");
    expect(frame).toMatchObject({ type: "frame", rw: 256, rh: 144, pw: 256, ph: 160 });
    expect(bitmaps[0]).toMatchObject({ width: 256, height: 144 });
    const lms = r!.pose!.landmarks;
    expect(lms).toHaveLength(2); // the 0.1 person is dropped
    expect(lms[0]).toHaveLength(33);
    expect(lms[0][0].x).toBeCloseTo(0.25, 5);
    expect(lms[1][0].x).toBeCloseTo(0.75, 5);
    expect(r!.hand).toBeNull();
    expect(d.stats.people).toBe(2);
    expect(d.stats.side).toBe(256);
    d.close();
  });

  it("the main thread only spends a tiny part of the round trip (grab call + post + decode)", async () => {
    const w = serviceWorker();
    const d = await create(w);
    for (let i = 0; i < 5; i++) await d.detect(video());
    expect(d.stats.blockMs).toBeLessThan(5);
    expect(d.stats.ms).toBeGreaterThan(0);
    d.close();
  });

  it("never has two pictures in flight: a second detect() while one is grabbed or running resolves null", async () => {
    const w = serviceWorker();
    const d = await create(w);
    fake.st.holdData = true;
    const first = d.detect(video());
    expect(await d.detect(video())).toBeNull(); // while the picture is being grabbed
    await vi.waitFor(() => expect(fake.st.release).not.toBeNull());
    expect(await d.detect(video())).toBeNull(); // while the worker runs
    fake.st.release?.();
    expect(await first).not.toBeNull();
    fake.st.holdData = false;
    expect(await d.detect(video())).not.toBeNull();
    expect(w.sent.filter((m) => m.type === "frame")).toHaveLength(2);
    d.close();
  });

  it("returns null while the camera has no picture yet", async () => {
    const d = await create(serviceWorker());
    expect(await d.detect(video(0, 0))).toBeNull();
    d.close();
  });

  it("limits the people to maxPeople", async () => {
    const d = await create(serviceWorker(), { maxPeople: 2 });
    fake.setOutput({ score: 0.9, nose: [0.1, 0.5] }, { score: 0.8, nose: [0.2, 0.5] }, { score: 0.7, nose: [0.3, 0.5] });
    expect((await d.detect(video()))!.pose!.landmarks).toHaveLength(2);
    d.setMaxPeople(3);
    expect((await d.detect(video()))!.pose!.landmarks).toHaveLength(3);
    d.close();
  });

  it("alternates two result buffers (the previous result stays valid while the next is made)", async () => {
    const d = await create(serviceWorker());
    fake.setOutput({ score: 0.9, nose: [0.2, 0.5] });
    const a = await d.detect(video());
    const keep = a!.pose!.landmarks[0][0].x;
    fake.setOutput({ score: 0.9, nose: [0.8, 0.5] });
    const b = await d.detect(video());
    expect(b).not.toBe(a);
    expect(a!.pose!.landmarks[0][0].x).toBe(keep);
    d.close();
  });

  it("the geometry of the answer is the one the picture was sent with, also after the size changed in between", async () => {
    const w = serviceWorker();
    const d = await create(w, { side: 320 });
    fake.setOutput({ score: 0.9, nose: [0.5, 0.5] });
    const r = await d.detect(video());
    expect(w.sent.find((m) => m.type === "frame")).toMatchObject({ rw: 320, rh: 180, pw: 320, ph: 192 });
    // 0.5 of the padded picture's height is row 96 of 192; the picture is 180 rows: y = 96 / 180 of the frame
    expect(r!.pose!.landmarks[0][0].y).toBeCloseTo(0.5 * (192 / 180), 5);
    d.close();
  });

  it("sends the brightening table only when it changes (the runtime mutates one array in place) and clears it when off", async () => {
    const w = serviceWorker();
    const d = await create(w);
    const lut = new Uint8Array(256).map((_, i) => Math.min(255, i * 2));
    await d.detect(video(), { lut });
    await d.detect(video(), { lut });
    const luts = () => w.sent.filter((m): m is Extract<ToWorker, { type: "lut" }> => m.type === "lut");
    expect(luts()).toHaveLength(1);
    expect(luts()[0].lut![100]).toBe(200);
    lut[100] = 7;
    await d.detect(video(), { lut });
    expect(luts()).toHaveLength(2);
    expect(luts()[1].lut![100]).toBe(7);
    expect(luts()[1].lut).not.toBe(lut); // a copy: the runtime keeps changing its own array
    await d.detect(video(), { lut: null });
    await d.detect(video());
    expect(luts()).toHaveLength(3);
    expect(luts()[2].lut).toBeNull();
    // the table is sent before the picture it applies to
    const order = w.sent.map((m) => m.type);
    expect(order.indexOf("lut")).toBeLessThan(order.indexOf("frame"));
    d.close();
  });

  it("the tensor count the worker reports stays flat over many pictures", async () => {
    const d = await create(serviceWorker());
    await d.detect(video());
    const first = d.memory();
    for (let i = 0; i < 100; i++) await d.detect(video());
    expect(d.memory()).toEqual(first);
    d.close();
  });

  it("adapts the picture size to the measured round trip, and uses it for the next picture", async () => {
    const w = serviceWorker();
    const d = await create(w);
    // a slow worker: every answer is held back, the clock moves 150 ms (above emergencyMs) before it is let go
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    fake.st.holdData = true;
    for (let i = 0; i < 24; i++) {
      fake.st.release = null;
      const p = d.detect(video());
      await vi.waitFor(() => expect(fake.st.release).not.toBeNull());
      now += CROWD_CFG.movenet.emergencyMs + 30;
      fake.st.release!();
      await p;
    }
    expect(d.stats.side).toBe(192);
    const last = [...w.sent].reverse().find((m) => m.type === "frame");
    expect(last).toMatchObject({ rw: 192, rh: 108, pw: 192, ph: 128 });
    d.close();
    vi.restoreAllMocks();
  });

  it("compiles the rungs for the real camera shape while loading; a fixed size compiles only itself", async () => {
    const w = serviceWorker();
    const d = await MoveNetWorkerDetector.create({ maxPeople: 5, camera: { w: 640, h: 480 }, makeWorker: () => w, grab });
    const init = w.sent[0] as Extract<ToWorker, { type: "init" }>;
    expect(init.geos.map((g) => [g.rw, g.rh])).toEqual([[256, 192], [192, 144], [320, 240]]);
    d.close();
    const w2 = serviceWorker();
    const d2 = await create(w2, { side: 320 });
    expect((w2.sent[0] as Extract<ToWorker, { type: "init" }>).geos).toEqual([{ rw: 320, rh: 180, pw: 320, ph: 192 }]);
    d2.close();
  });

  it("never steps to a rung that is not compiled (384 is not compiled while loading)", async () => {
    const w = serviceWorker();
    const d = await create(w);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 1)); // every call costs 1 ms: round trips of a few ms
    // a very fast worker: the ladder wants to go up, 320 is compiled, 384 is not
    for (let i = 0; i < 400; i++) {
      now += 50;
      await d.detect(video());
    }
    expect(d.stats.side).toBe(320);
    expect(w.sent.some((m) => m.type === "frame" && m.rw === 384)).toBe(false);
    vi.restoreAllMocks();
    d.close();
  });

  it("a picture that waited for a shader compile (new camera shape) is not counted: stats and ladder see only real round trips", async () => {
    const w = serviceWorker();
    const d = await create(w);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    fake.st.holdData = true;
    const slow = async (ms: number, v: HTMLVideoElement): Promise<void> => {
      fake.st.release = null;
      const p = d.detect(v);
      await vi.waitFor(() => expect(fake.st.release).not.toBeNull());
      now += ms;
      fake.st.release!();
      expect(await p).not.toBeNull();
    };
    // the first picture of a 4:3 camera: the worker compiles for 3 s
    await slow(3000, video(640, 480));
    expect(d.stats.ms).toBe(0);
    expect(d.stats.workerMs).toBe(0);
    for (let i = 0; i < 40; i++) await slow(40, video(640, 480));
    expect(d.stats.ms).toBeGreaterThan(35);
    expect(d.stats.ms).toBeLessThan(45); // not a value decaying from 3000
    expect(d.stats.side).toBe(256);
    vi.restoreAllMocks();
    d.close();
  });

  it("a camera shape not seen at start (device turned): its first picture also compiles the neighbouring rungs, so the ladder can still move", async () => {
    const w = serviceWorker();
    const d = await create(w);
    await d.detect(video(720, 1280));
    const first = w.sent.filter((m) => m.type === "frame")[0] as Extract<ToWorker, { type: "frame" }>;
    expect([first.rw, first.rh]).toEqual([144, 256]);
    expect(first.also?.map((g) => [g.rw, g.rh])).toEqual([[108, 192], [180, 320]]);
    await d.detect(video(720, 1280));
    const second = w.sent.filter((m) => m.type === "frame")[1] as Extract<ToWorker, { type: "frame" }>;
    expect(second.also).toBeUndefined(); // compiled now, nothing more to ask
    // a slow device can now step down for this shape
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    fake.st.holdData = true;
    for (let i = 0; i < 40; i++) {
      fake.st.release = null;
      const p = d.detect(video(720, 1280));
      await vi.waitFor(() => expect(fake.st.release).not.toBeNull());
      now += CROWD_CFG.movenet.emergencyMs + 30;
      fake.st.release!();
      await p;
    }
    expect(d.stats.side).toBe(192);
    vi.restoreAllMocks();
    d.close();
  });

  it("close(): tells the worker, answers an in-flight call with null, closes a late bitmap, terminates the worker for sure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const w = serviceWorker();
    const d = await create(w);
    fake.st.holdData = true;
    const p = d.detect(video());
    await vi.waitFor(() => expect(w.sent.some((m) => m.type === "frame")).toBe(true));
    d.close();
    d.close();
    expect(await p).toBeNull();
    expect(w.sent.filter((m) => m.type === "close")).toHaveLength(1);
    expect(await d.detect(video())).toBeNull();
    expect(w.terminated).toBe(false);
    vi.advanceTimersByTime(600);
    expect(w.terminated).toBe(true);
    fake.st.release?.();
  });
});

describe("MoveNetWorkerDetector start-up failures (the runtime then uses MediaPipe)", () => {
  it("unsupported (no WebGL in the worker) -> MoveNetUnsupported, worker closed", async () => {
    const w = new FakeWorker((m, self) => {
      if (m.type === "init") queueMicrotask(() => self.emit({ type: "unsupported", reason: "nowebgl" }));
    });
    await expect(create(w)).rejects.toBeInstanceOf(MoveNetUnsupported);
    expect(w.sent.some((m) => m.type === "close")).toBe(true);
  });

  it("a worker script that fails to load (error event) -> rejected at once", async () => {
    const w = new FakeWorker((m, self) => {
      if (m.type === "init") queueMicrotask(() => self.fail("Failed to load module script"));
    });
    await expect(create(w)).rejects.toThrow(/module script/);
  });

  it("a fatal error while loading (model 404) -> rejected with its message", async () => {
    const w = new FakeWorker((m, self) => {
      if (m.type === "init") queueMicrotask(() => self.emit({ type: "error", message: "404", fatal: true }));
    });
    await expect(create(w)).rejects.toThrow("404");
  });

  it("a silent worker -> gives up after initTimeoutMs without any sign of life; progress messages keep it waiting", async () => {
    vi.useFakeTimers();
    const w = new FakeWorker();
    const p = create(w);
    const caught = p.catch((e: Error) => e);
    vi.advanceTimersByTime(CROWD_CFG.movenet.initTimeoutMs - 1000);
    w.emit({ type: "progress", pct: 20, label: "x" });
    vi.advanceTimersByTime(CROWD_CFG.movenet.initTimeoutMs - 1000);
    let settled = false;
    void caught.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(((await caught) as Error).message).toMatch(/in time/);
  });

  it("leaving the game while it loads (abort) -> rejected at once, the worker is told to close and terminated", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const w = new FakeWorker(); // never answers
    const ac = new AbortController();
    const p = MoveNetWorkerDetector.create({ maxPeople: 5, makeWorker: () => w, grab, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(w.sent.some((m) => m.type === "close")).toBe(true);
    vi.advanceTimersByTime(600);
    expect(w.terminated).toBe(true);
    const ac2 = new AbortController();
    ac2.abort();
    await expect(MoveNetWorkerDetector.create({ maxPeople: 5, makeWorker: () => new FakeWorker(), grab, signal: ac2.signal })).rejects.toThrow();
  });

  it("the compile step gets the long wait until ready, also after a 'compiled' message", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const w = new FakeWorker();
    let err: unknown = null;
    const p = MoveNetWorkerDetector.create({ maxPeople: 5, makeWorker: () => w, grab }).catch((e) => (err = e));
    w.emit({ type: "progress", pct: 88, label: "x" });
    w.emit({ type: "compiled", key: "256x144x256x160" });
    vi.advanceTimersByTime(CROWD_CFG.movenet.initTimeoutMs + 1000);
    await Promise.resolve();
    expect(err).toBeNull();
    w.emit({ type: "ready", backend: "webgl" });
    const d = await p;
    expect(err).toBeNull();
    (d as MoveNetWorkerDetector).close();
  });

  it("no Worker / OffscreenCanvas / createImageBitmap in this browser -> MoveNetUnsupported", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(MoveNetWorkerDetector.create({ maxPeople: 5 })).rejects.toBeInstanceOf(MoveNetUnsupported);
  });
});

describe("MoveNetWorkerDetector failures while playing", () => {
  async function started(): Promise<{ w: FakeWorker; d: MoveNetWorkerDetector }> {
    const w = new FakeWorker((m, self) => {
      if (m.type === "init") queueMicrotask(() => self.emit({ type: "ready", backend: "webgl" }));
    });
    return { w, d: await create(w) };
  }

  /** answers the latest picture the worker was sent */
  const answer = async (w: FakeWorker, p: Promise<unknown>): Promise<void> => {
    await vi.waitFor(() => expect(w.sent.some((m) => m.type === "frame")).toBe(true));
    const id = (w.sent.filter((m) => m.type === "frame").pop() as Extract<ToWorker, { type: "frame" }>).id;
    w.emit({ type: "result", id, data: new Float32Array(336), ms: 10, tensors: 3, bytes: 300 });
    await p;
  };
  const silentFor = (ms: number): void => {
    const t0 = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(t0 + ms);
    vi.advanceTimersByTime(1000);
  };

  it("a worker that stops answering is declared broken after watchdogMs and the call resolves null", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const { w, d } = await started();
    await answer(w, d.detect(video())); // the first picture of a size gets the long wait, so one is answered first
    const p = d.detect(video());
    await vi.waitFor(() => expect(bitmaps.length).toBe(2));
    expect(d.broken).toBe(false);
    silentFor(CROWD_CFG.movenet.watchdogMs + 100);
    expect(await p).toBeNull();
    expect(d.broken).toBe(true);
    expect(await d.detect(video())).toBeNull();
    d.close();
    vi.restoreAllMocks();
  });

  it("the first picture of a new size gets the long wait (its shaders are compiled first)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const { w, d } = await started();
    await answer(w, d.detect(video()));
    await answer(w, d.detect(video())); // same size again
    const p = d.detect(video(640, 480)); // another picture size
    await vi.waitFor(() => expect(bitmaps.length).toBe(3));
    silentFor(CROWD_CFG.movenet.watchdogMs + 1000);
    expect(d.broken).toBe(false);
    vi.restoreAllMocks();
    silentFor(CROWD_CFG.movenet.warmTimeoutMs + 100);
    expect(await p).toBeNull();
    expect(d.broken).toBe(true);
    d.close();
    vi.restoreAllMocks();
  });

  it("a fatal error from the worker (lost WebGL context) -> broken, the call resolves null", async () => {
    const { w, d } = await started();
    const p = d.detect(video());
    await vi.waitFor(() => expect(w.sent.some((m) => m.type === "frame")).toBe(true));
    w.emit({ type: "error", message: "webglcontextlost", fatal: true });
    expect(await p).toBeNull();
    expect(d.broken).toBe(true);
    d.close();
  });

  it("the worker crashing (error event) -> broken", async () => {
    const { w, d } = await started();
    w.fail("out of memory");
    expect(d.broken).toBe(true);
    expect(await d.detect(video())).toBeNull();
    d.close();
  });

  it("a failed call rejects, 8 in a row make it broken, a good one in between resets the count", async () => {
    const { w, d } = await started();
    const fail = async (): Promise<void> => {
      const p = d.detect(video());
      const n = w.sent.filter((m) => m.type === "frame").length;
      await vi.waitFor(() => expect(w.sent.filter((m) => m.type === "frame").length).toBe(n || 1));
      const id = (w.sent.filter((m) => m.type === "frame").pop() as Extract<ToWorker, { type: "frame" }>).id;
      w.emit({ type: "error", id, message: "bad", fatal: false });
      await expect(p).rejects.toThrow("bad");
    };
    for (let i = 0; i < 7; i++) await fail();
    expect(d.broken).toBe(false);
    // a good answer
    const p = d.detect(video());
    await vi.waitFor(() => expect(bitmaps.length).toBe(8));
    const id = (w.sent.filter((m) => m.type === "frame").pop() as Extract<ToWorker, { type: "frame" }>).id;
    w.emit({ type: "result", id, data: new Float32Array(336), ms: 10, tensors: 3, bytes: 300 });
    await p;
    for (let i = 0; i < 7; i++) await fail();
    expect(d.broken).toBe(false);
    await fail();
    expect(d.broken).toBe(true);
    d.close();
  });

  it("a skipped picture (worker busy) resolves null and frees the slot", async () => {
    const { w, d } = await started();
    const p = d.detect(video());
    await vi.waitFor(() => expect(w.sent.some((m) => m.type === "frame")).toBe(true));
    const id = (w.sent.find((m) => m.type === "frame") as Extract<ToWorker, { type: "frame" }>).id;
    w.emit({ type: "skipped", id });
    expect(await p).toBeNull();
    expect(d.broken).toBe(false);
    const q = d.detect(video());
    await vi.waitFor(() => expect(bitmaps.length).toBe(2));
    expect(q).toBeInstanceOf(Promise);
    d.close();
    expect(await q).toBeNull();
  });

  it("an answer for an old picture (after a timeout) is ignored", async () => {
    const { w, d } = await started();
    const p = d.detect(video());
    await vi.waitFor(() => expect(w.sent.some((m) => m.type === "frame")).toBe(true));
    w.emit({ type: "result", id: 9999, data: new Float32Array(336), ms: 1, tensors: 0, bytes: 0 });
    let done = false;
    void p.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    d.close();
    expect(await p).toBeNull();
  });

  it("a picture grabbed after close() is closed, not sent", async () => {
    const { w, d } = await started();
    const p = d.detect(video());
    d.close();
    expect(await p).toBeNull();
    expect(w.sent.filter((m) => m.type === "frame")).toHaveLength(0);
    expect(bitmaps[0].close).toHaveBeenCalled();
  });
});
