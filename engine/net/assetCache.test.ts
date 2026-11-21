import { afterEach, describe, expect, it, vi } from "vitest";
import { assetPlan, idleWarmAllowed, warmAssets } from "./assetCache";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setConnection(c: object | undefined): void {
  Object.defineProperty(navigator, "connection", { value: c, configurable: true });
}

describe("idleWarmAllowed", () => {
  it("allows when the browser says nothing about the connection", () => {
    setConnection(undefined);
    expect(idleWarmAllowed()).toBe(true);
  });
  it("never with data saver, on 2G or on mobile data", () => {
    setConnection({ saveData: true });
    expect(idleWarmAllowed()).toBe(false);
    setConnection({ effectiveType: "2g" });
    expect(idleWarmAllowed()).toBe(false);
    setConnection({ effectiveType: "4g", type: "cellular" });
    expect(idleWarmAllowed()).toBe(false);
    setConnection({ effectiveType: "4g", type: "wifi" });
    expect(idleWarmAllowed()).toBe(true);
    setConnection(undefined);
  });
  it("never on a phone (touch screen or a phone browser)", () => {
    setConnection(undefined);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("coarse") }));
    expect(idleWarmAllowed()).toBe(false);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari/537.36");
    expect(idleWarmAllowed()).toBe(false);
  });
});

describe("assetPlan", () => {
  it("MoveNet: model.json and every weight shard it lists", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ weightsManifest: [{ paths: ["a.bin", "b.bin"] }, { paths: ["c.bin"] }] })));
    expect(await assetPlan("movenet")).toEqual([
      "/models/movenet-multipose/model.json",
      "/models/movenet-multipose/a.bin",
      "/models/movenet-multipose/b.bin",
      "/models/movenet-multipose/c.bin",
    ]);
  });
  it("MediaPipe: the wasm engine first, then the pose model of the settings and the loaders", async () => {
    const plan = await assetPlan("mediapipe");
    expect(plan[0]).toMatch(/^\/mediapipe\/vision_wasm_(nosimd_)?internal\.wasm$/);
    expect(plan[1]).toBe("/models/pose_landmarker_lite.task");
    expect(plan).toContain("/mediapipe/vision_bundle.js");
    expect(plan.some((u) => u.includes("hand_landmarker"))).toBe(false);
  });
  it("a finger game: the hand model instead of the pose model", async () => {
    const plan = await assetPlan("hands");
    expect(plan[1]).toBe("/models/hand_landmarker.task");
    expect(plan.some((u) => u.includes("pose_landmarker"))).toBe(false);
  });
});

describe("warmAssets", () => {
  it("does nothing without a controlling service worker (no second, unshared download)", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("caches", { open: async () => ({ match: async () => undefined }) });
    await warmAssets(["/models/x.task"]);
    expect(f).not.toHaveBeenCalled();
  });
  it("downloads only the files that are not on the device yet, and stops when aborted", async () => {
    const got: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      got.push(u);
      return new Response("x");
    });
    vi.stubGlobal("caches", { open: async () => ({ match: async (u: string) => (u.endsWith("/have.task") ? new Response("") : undefined) }) });
    Object.defineProperty(navigator, "serviceWorker", { value: { controller: {} }, configurable: true });
    await warmAssets(["/models/have.task", "/models/need.task"]);
    expect(got).toEqual(["/models/need.task"]);
    const ac = new AbortController();
    ac.abort();
    got.length = 0;
    await warmAssets(["/models/need.task"], ac.signal);
    expect(got).toEqual([]);
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
  });
});
