import { expect, test, type Page } from "@playwright/test";
import { installFake, setPeople, type FakePerson } from "./fixtures";

// Cheksiz poyga: endless motorway. The driver is a synthetic skeleton (window.__fake): wrists = wheel, both hands up = nitro.

interface Snap {
  phase: string;
  car: string;
  s: number;
  d: number;
  kmh: number;
  score: number;
  combo: number;
  misses: number;
  crashes: number;
  nitro: number;
  chunks: number;
  traffic: number;
  models: number;
}
type Win = { __poyga?: { snapshot(): Snap }; __engine?: { state: string } };

const RED: [number, number, number] = [210, 40, 40];
const standing = (o: Partial<FakePerson> = {}): FakePerson => ({ cx: 0.5, armL: "down", armR: "down", rgb: RED, ...o });
const handsUp = (): FakePerson => standing({ armL: "up", armR: "up" });

const waitState = (page: Page, s: string, timeout = 90_000) =>
  page.waitForFunction((st) => (window as unknown as Win).__engine?.state === st, s, { timeout });
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as unknown as Win).__poyga!.snapshot());

async function boot(page: Page, query = ""): Promise<void> {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.addInitScript(() => {
    localStorage.setItem("harakat.settings", JSON.stringify({ state: { quality: "low" }, version: 1 }));
  });
  await installFake(page, { people: [handsUp()] });
  await page.goto(`/play/poyga?${query}`);
  await waitState(page, "ready");
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await page.waitForFunction(() => !!(window as unknown as Win).__poyga, null, { timeout: 30_000 });
}

test.describe("poyga", () => {
  test("garage -> endless race: drives, streams chunks, wheel steers, nitro, no game over", async ({ page }) => {
    test.setTimeout(240_000);
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    await boot(page);
    let s = await snap(page);
    expect(s.phase).toBe("garage");
    expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Cyrillic}/u);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (window as unknown as Win).__poyga!.snapshot().phase === "race");
    // wheel: right wrist lower = steer right
    await setPeople(page, [standing({ armL: [0.62, 0.45], armR: [0.38, 0.6] })]);
    await page.waitForFunction(() => (window as unknown as Win).__poyga!.snapshot().kmh > 60, null, { timeout: 90_000 });
    s = await snap(page);
    expect(s.d).toBeGreaterThan(-1.8);
    // nitro
    await setPeople(page, [handsUp()]);
    await page.waitForTimeout(1500);
    const n = await snap(page);
    expect(n.nitro).toBeLessThan(s.nitro);
    await setPeople(page, [standing()]);
    // the road keeps coming and memory stays bounded
    await page.waitForFunction(() => (window as unknown as Win).__poyga!.snapshot().s > 900, null, { timeout: 180_000 });
    s = await snap(page);
    expect(s.chunks).toBeLessThan(25);
    expect(s.traffic).toBeGreaterThan(20);
    expect((await page.evaluate(() => (window as unknown as Win).__engine?.state))).toBe("play");
    expect(problems).toEqual([]);
  });
});
