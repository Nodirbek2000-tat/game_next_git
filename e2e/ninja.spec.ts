import { expect, test, type Page } from "@playwright/test";
import { installFake, setAuto, setPeople, type FakePerson } from "./fixtures";

// Meva Ninja: render budget, party ("Xona") mode, the pre-start mode picker and optional GLB models.

type Ninja = { mode: string; partyLive: boolean; hands: number; peakHands: number; score: number; sliced: number; cutMask: number; drops: number; stains: number; models: number };
const ninja = (page: Page): Promise<Ninja> => page.evaluate(() => (window as unknown as { __ninja: Ninja }).__ninja);
const eng = (page: Page, expr: string) => page.evaluate(`(() => { const e = window.__engine; return ${expr}; })()`);
const waitState = (page: Page, s: string, timeout = 45_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });

const RED: [number, number, number] = [210, 40, 40];
const BLUE: [number, number, number] = [40, 80, 220];
const GREEN: [number, number, number] = [40, 190, 80];
const standing = (o: Partial<FakePerson> = {}): FakePerson => ({ cx: 0.5, armL: "down", armR: "down", rgb: RED, ...o });
const handsUp = (o: Partial<FakePerson> = {}): FakePerson => standing({ armL: "up", armR: "up", ...o });

async function settings(page: Page, s: Record<string, unknown>): Promise<void> {
  await page.addInitScript((v) => localStorage.setItem("harakat.settings", JSON.stringify({ state: v, version: 1 })), s);
}

/** Largest draw-call / triangle count of the 3D canvas over `ms` milliseconds. */
async function sampleRender(page: Page, ms: number): Promise<{ calls: number; tris: number; level: string }> {
  return page.evaluate(
    (t) =>
      new Promise((res) => {
        const e = (window as unknown as { __engine: { gl: { info: { render: { calls: number; triangles: number } } }; quality: { level: string } } }).__engine;
        let calls = 0;
        let tris = 0;
        const t0 = performance.now();
        const f = (): void => {
          const r = e.gl.info.render;
          calls = Math.max(calls, r.calls);
          tris = Math.max(tris, r.triangles);
          if (performance.now() - t0 < t) requestAnimationFrame(f);
          else res({ calls, tris, level: e.quality.level });
        };
        f();
      }),
    ms,
  );
}

const BUDGET = { high: { calls: 150, tris: 260_000 }, medium: { calls: 150, tris: 200_000 }, low: { calls: 80, tris: 120_000 } } as const;

for (const quality of ["high", "low"] as const) {
  test(`render budget (${quality}): everything on screen at once stays within the draw call / triangle limits`, async ({ page }) => {
    await settings(page, { quality });
    await installFake(page, { people: [handsUp()] });
    await page.goto("/play/meva-ninja?showcase=1&duration=30");
    await waitState(page, "ready");
    await page.getByTestId("start-btn").click();
    await waitState(page, "play");
    await page.waitForTimeout(800);
    const s = await sampleRender(page, 1500);
    test.info().annotations.push({ type: "showcase", description: `${s.level}: ${s.calls} calls, ${s.tris} triangles` });
    console.log(`budget showcase ${s.level}: ${s.calls} calls, ${s.tris} triangles`);
    expect(s.level).toBe(quality);
    expect(s.calls).toBeGreaterThan(15); // the showcase really shows the fruits
    expect(s.calls).toBeLessThanOrEqual(BUDGET[quality].calls);
    expect(s.tris).toBeLessThanOrEqual(BUDGET[quality].tris);
  });
}

test("render budget while playing: autopilot slicing at the highest quality", async ({ page }) => {
  test.setTimeout(90_000);
  await settings(page, { quality: "high" });
  await installFake(page, { people: [handsUp()] });
  await page.goto("/play/meva-ninja?duration=60");
  await waitState(page, "ready");
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await setAuto(page, true);
  const s = await sampleRender(page, 9000);
  test.info().annotations.push({ type: "play", description: `${s.level}: ${s.calls} calls, ${s.tris} triangles` });
  console.log(`budget play ${s.level}: ${s.calls} calls, ${s.tris} triangles`);
  expect(s.calls).toBeGreaterThan(0);
  expect(s.calls).toBeLessThanOrEqual(BUDGET.high.calls);
  expect(s.tris).toBeLessThanOrEqual(BUDGET.high.tris);
  expect((await ninja(page)).sliced).toBeGreaterThan(0);
});

test("juice: a slice throws droplets and a short-lived stain, all bounded by the pools", async ({ page }) => {
  test.setTimeout(150_000);
  await settings(page, { kids: true });
  await installFake(page, { people: [handsUp()] });
  await page.goto("/play/meva-ninja?duration=60");
  await waitState(page, "ready");
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await setAuto(page, true);
  await page.waitForFunction(() => ((window as unknown as { __ninja?: Ninja }).__ninja?.sliced ?? 0) > 0, undefined, { timeout: 60_000 });
  let peakDrops = 0;
  let peakStains = 0;
  for (let i = 0; i < 25; i++) {
    const n = await ninja(page);
    peakDrops = Math.max(peakDrops, n.drops);
    peakStains = Math.max(peakStains, n.stains);
    await page.waitForTimeout(100);
  }
  expect(peakDrops).toBeGreaterThan(10);
  expect(peakStains).toBeGreaterThan(0);
  expect(peakDrops).toBeLessThanOrEqual(280);
  expect(peakStains).toBeLessThanOrEqual(12);
  // stop slicing: the splashes disappear again (nothing stays on the screen)
  await setAuto(page, false);
  await setPeople(page, [standing()]);
  await page.waitForTimeout(3600);
  expect((await ninja(page)).stains).toBe(0);
});

test("mode picker: shown in the ready menu, remembered, and ?mode= presets it", async ({ page }) => {
  await installFake(page, { people: [handsUp()] });
  await page.goto("/play/meva-ninja");
  await waitState(page, "ready");
  const panel = page.getByTestId("ninja-modes");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Xona");
  await expect(page.getByTestId("ninja-mode-oddiy")).toHaveClass(/on/);
  // hand-selectable like every menu button
  await expect(page.getByTestId("ninja-mode-xona")).toHaveAttribute("data-dwell", "");
  await page.getByTestId("ninja-mode-xona").click();
  await expect(page.getByTestId("ninja-mode-xona")).toHaveClass(/on/);
  await expect(page.getByTestId("ninja-mode-hint")).toContainText("hamma");
  expect(await page.evaluate(() => localStorage.getItem("harakat.ninja.mode"))).toBe("xona");
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  expect((await ninja(page)).mode).toBe("xona");
  expect(await page.locator("body").innerText()).not.toMatch(new RegExp("[\u0400-\u04FF]"));
});

test("?mode=xona presets the party mode without touching the menu", async ({ page }) => {
  await installFake(page, { people: [handsUp()] });
  await page.goto("/play/meva-ninja?mode=xona");
  await waitState(page, "ready");
  await expect(page.getByTestId("ninja-mode-xona")).toHaveClass(/on/);
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  const n = await ninja(page);
  expect(n.mode).toBe("xona");
  expect(n.partyLive).toBe(true);
});

/** Persons 1 and 2 (not the locked player) swing both hands across the screen; the locked player 0 stands still. */
async function bystandersSlice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __scene: { people: { armL?: [number, number]; armR?: [number, number] }[] } };
    const t0 = performance.now();
    setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      const [, a, b] = w.__scene.people;
      if (a) {
        a.armR = [0.5 + 0.34 * Math.sin(t * 7.1), 0.5 + 0.24 * Math.cos(t * 5.3)];
        a.armL = [0.5 + 0.34 * Math.sin(t * 6.1 + 2), 0.5 + 0.24 * Math.cos(t * 4.7 + 1)];
      }
      if (b) {
        b.armR = [0.5 + 0.34 * Math.sin(t * 6.6 + 1), 0.5 + 0.24 * Math.cos(t * 5.9 + 2)];
        b.armL = [0.5 + 0.34 * Math.sin(t * 7.4 + 4), 0.5 + 0.24 * Math.cos(t * 4.1 + 3)];
      }
    }, 16);
  });
}

async function threePeopleToPlay(page: Page, query: string, duration = 60): Promise<void> {
  await settings(page, { kids: true });
  await installFake(page, { people: [handsUp({ cx: 0.5, rgb: RED }), standing({ cx: 0.15, rgb: BLUE }), standing({ cx: 0.85, rgb: GREEN })] });
  await page.goto(`/play/meva-ninja?duration=${duration}${query}`);
  await waitState(page, "ready");
  expect(await eng(page, "e.tracker.lock.slots.map(s => s.mode)")).toEqual(["locked"]);
  await setPeople(page, [standing({ cx: 0.5, rgb: RED }), standing({ cx: 0.15, rgb: BLUE }), standing({ cx: 0.85, rgb: GREEN })]);
}

test("party mode: the hands of everybody in the room cut, the score is shared", async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await threePeopleToPlay(page, "&mode=xona");
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  // three people, six hands, the locked player does nothing
  await expect.poll(async () => (await ninja(page)).peakHands, { timeout: 8000 }).toBeGreaterThanOrEqual(5);
  expect((await ninja(page)).sliced).toBe(0);
  await bystandersSlice(page);
  await expect.poll(async () => (await ninja(page)).sliced, { timeout: 25_000 }).toBeGreaterThan(2);
  const n = await ninja(page);
  expect(n.score).toBeGreaterThan(0);
  // more than one hand has cut
  let bits = 0;
  for (let m = n.cutMask; m; m &= m - 1) bits++;
  expect(bits).toBeGreaterThanOrEqual(2);
  // one shared score on the HUD (single card)
  await expect(page.getByTestId("hud-score")).toBeVisible();
  expect(await eng(page, "e.state")).toBe("play");

  expect(problems).toEqual([]);
});

test("party mode: the results screen shows the hands, and everything is disposed on exit", async ({ page }) => {
  test.setTimeout(150_000);
  await threePeopleToPlay(page, "&mode=xona", 5);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await waitState(page, "results", 100_000);
  await expect(page.getByTestId("results-overlay")).toContainText("Qo‘llar");
  await expect.poll(async () => Number(await eng(page, "e.gl.info.memory.geometries")), { timeout: 8000 }).toBe(0);
  expect(Number(await eng(page, "e.gl.info.memory.textures"))).toBeLessThanOrEqual(1);
});

test("normal mode ignores the bystanders (only the locked player cuts)", async ({ page }) => {
  test.setTimeout(60_000);
  await threePeopleToPlay(page, "&mode=oddiy");
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await bystandersSlice(page);
  await page.waitForTimeout(6000);
  const n = await ninja(page);
  expect(n.mode).toBe("oddiy");
  expect(n.partyLive).toBe(false);
  expect(n.sliced).toBe(0);
  expect(await eng(page, "e.state")).toBe("play");
});

// ---- GLB models: a tiny triangle model is served instead of the procedural watermelon -------------------------
function tinyGlb(): Buffer {
  const pos = Buffer.from(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]).buffer);
  const idx = Buffer.from(new Uint16Array([0, 1, 2]).buffer);
  const bin = Buffer.concat([pos, idx, Buffer.alloc(2)]);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.9, 0.3, 1] }, doubleSided: true }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const c1 = Buffer.alloc(8);
  c1.writeUInt32LE(js.length, 0);
  c1.writeUInt32LE(0x4e4f534a, 4);
  const c2 = Buffer.alloc(8);
  c2.writeUInt32LE(bin.length, 0);
  c2.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, c1, js, c2, bin]);
}

test("assets.json: a GLB replaces the procedural fruit, a missing one falls back silently", async ({ page }) => {
  test.setTimeout(90_000);
  const manifest = {
    version: 1,
    fruits: { tarvuz: { whole: "/__ninja_test/tarvuz.glb", half: null, scale: 1 }, olma: { whole: "/__ninja_test/yoq.glb", half: null, scale: 1 } },
    bomb: { whole: null, half: null, scale: 1 },
  };
  await page.route((u) => u.pathname === "/__ninja_test/manifest.json", (r) => r.fulfill({ json: manifest }));
  await page.route((u) => u.pathname === "/__ninja_test/tarvuz.glb", (r) => r.fulfill({ body: tinyGlb(), contentType: "model/gltf-binary" }));
  await page.route((u) => u.pathname === "/__ninja_test/yoq.glb", (r) => r.fulfill({ status: 404, body: "yo‘q" }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installFake(page, { people: [handsUp()] });
  await page.goto("/play/meva-ninja?showcase=1&assets=/__ninja_test/manifest.json");
  await waitState(page, "ready");
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await expect.poll(async () => (await ninja(page)).models, { timeout: 15_000 }).toBe(1);
  const s = await sampleRender(page, 800);
  expect(s.calls).toBeGreaterThan(10);
  expect(errors).toEqual([]);
  expect(await eng(page, "e.state")).toBe("play");
});
