import { beforeEach, describe, expect, it, vi } from "vitest";

// The MAIN-thread MoveNet (?pose=movenet-main). TensorFlow.js is mocked: what is checked is the wiring (one call in flight, every tensor
// disposed, output mapping, fallback signals, no CPU canvas, no WEBGL_CPU_FORWARD=false).

const { fake } = await vi.hoisted(async () => ({ fake: (await import("./fakeTf")).makeFakeTf() }));
const { st } = fake;

vi.mock("@tensorflow/tfjs-core", () => ({ ...fake.tf }));
vi.mock("@tensorflow/tfjs-backend-webgl", () => ({}));
vi.mock("@tensorflow/tfjs-converter", () => ({ ...fake.conv }));

import { MoveNetDetector } from "./movenet";

function video(w = 1280, h = 720): HTMLVideoElement {
  return { videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement;
}

beforeEach(() => {
  st.live = 0;
  st.made = 0;
  st.failData = false;
  st.holdData = false;
  st.release = null;
  st.webgl = true;
  st.ops.length = 0;
  st.envSet.length = 0;
  st.executed.length = 0;
  st.lutValues.length = 0;
  st.modelDisposed = 0;
  fake.setOutput();
});

describe("MoveNetDetector (main thread)", () => {
  it("loads, warms up and reports progress up to 100", async () => {
    const seen: number[] = [];
    const d = await MoveNetDetector.create({ maxPeople: 5, onProgress: (p) => seen.push(p) });
    expect(d.backend).toBe("webgl");
    expect(d.where).toBe("main");
    expect(seen[seen.length - 1]).toBe(100);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1])).toBe(true);
    expect(st.live).toBe(0); // the warm-up output was disposed
    expect(st.loadedUrl).toBe("/models/movenet-multipose/model.json");
  });

  it("keeps tfjs's default CPU forwarding of tiny tensors (false made the graph read them back one by one)", async () => {
    await MoveNetDetector.create({ maxPeople: 5 });
    expect(st.envSet.map(([k]) => k)).not.toContain("WEBGL_CPU_FORWARD");
  });

  it("fails (so the runtime falls back to MediaPipe) when WebGL is unavailable", async () => {
    st.webgl = false;
    await expect(MoveNetDetector.create({ maxPeople: 5 })).rejects.toThrow(/WebGL/);
  });

  it("returns people as 33 normalised landmarks; the video goes straight to the GPU and is scaled there (no canvas)", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 5 });
    fake.setOutput({ score: 0.9, nose: [0.25, 0.5] }, { score: 0.05, nose: [0.9, 0.9] }, { score: 0.6, nose: [0.75, 0.3] });
    st.ops.length = 0;
    const r = await d.detect(video());
    expect(r).not.toBeNull();
    const lms = r!.pose!.landmarks;
    expect(lms).toHaveLength(2); // the 0.05 person is dropped
    expect(lms[0]).toHaveLength(33);
    expect(lms[0][0].x).toBeCloseTo(0.25, 5);
    expect(lms[1][0].x).toBeCloseTo(0.75, 5);
    expect(r!.hand).toBeNull();
    expect(r!.fresh).toBeUndefined();
    expect(st.ops).toContain("fromPixels 1280x720");
    expect(st.ops).toContain("resize 256x144");
    expect(st.executed[st.executed.length - 1]).toEqual([1, 160, 256, 3]); // padded to multiples of 32
    expect(d.stats.people).toBe(2);
    expect(d.stats.side).toBe(256);
  });

  it("limits the people to maxPeople", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 2 });
    fake.setOutput({ score: 0.9, nose: [0.1, 0.5] }, { score: 0.8, nose: [0.2, 0.5] }, { score: 0.7, nose: [0.3, 0.5] });
    expect((await d.detect(video()))!.pose!.landmarks).toHaveLength(2);
    d.setMaxPeople(3);
    expect((await d.detect(video()))!.pose!.landmarks).toHaveLength(3);
  });

  it("never starts a second call while one is in flight", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 5 });
    st.holdData = true;
    const first = d.detect(video());
    expect(await d.detect(video())).toBeNull();
    st.release?.();
    expect(await first).not.toBeNull();
    st.holdData = false;
    expect(await d.detect(video())).not.toBeNull();
  });

  it("returns null while the camera has no picture yet", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 5 });
    expect(await d.detect(video(0, 0))).toBeNull();
  });

  it("disposes every output tensor: the tensor count stays flat over many calls", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 5 });
    fake.setOutput({ score: 0.9 });
    const before = d.memory();
    for (let i = 0; i < 200; i++) await d.detect(video());
    expect(d.memory()).toEqual(before);
    expect(st.made).toBeGreaterThan(200);
  });

  it("disposes the output also when reading it fails, and reports broken after 8 failures in a row", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 5 });
    st.failData = true;
    for (let i = 0; i < 8; i++) {
      expect(d.broken).toBe(false);
      await expect(d.detect(video())).rejects.toThrow();
    }
    expect(st.live).toBe(0);
    expect(d.broken).toBe(true);
    expect(await d.detect(video())).toBeNull();
  });

  it("alternates two result buffers (the previous result stays valid while the next is made)", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 5 });
    fake.setOutput({ score: 0.9, nose: [0.2, 0.5] });
    const a = await d.detect(video());
    const keep = a!.pose!.landmarks[0][0].x;
    fake.setOutput({ score: 0.9, nose: [0.8, 0.5] });
    const b = await d.detect(video());
    expect(b).not.toBe(a);
    expect(a!.pose!.landmarks[0][0].x).toBe(keep);
  });

  it("brightens on the GPU with a table tensor that is rebuilt only when the table changes", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 5 });
    const lut = new Uint8Array(256).map((_, i) => Math.min(255, i * 2));
    await d.detect(video(), { lut });
    await d.detect(video(), { lut });
    expect(st.ops).toContain("gather");
    expect(st.lutValues).toHaveLength(1);
    expect(st.lutValues[0][100]).toBe(200);
    lut[100] = 7; // the runtime mutates one array in place
    await d.detect(video(), { lut });
    expect(st.lutValues).toHaveLength(2);
    st.ops.length = 0;
    await d.detect(video(), { lut: null });
    expect(st.ops).not.toContain("gather");
  });

  it("close() disposes the model once and ignores late results", async () => {
    const d = await MoveNetDetector.create({ maxPeople: 5 });
    st.holdData = true;
    const p = d.detect(video());
    d.close();
    d.close();
    st.release?.();
    expect(await p).toBeNull();
    expect(st.modelDisposed).toBe(1);
    expect(st.live).toBe(0);
  });
});
