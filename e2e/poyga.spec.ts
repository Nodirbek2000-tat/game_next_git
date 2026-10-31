import { expect, test, type Page } from "@playwright/test";
import { installFake, setPeople, type FakePerson } from "./fixtures";

// Shahar simulyatori: open city. The driver is a synthetic skeleton (window.__fake): knees = pedals, wrists = wheel.

interface Snap {
  phase: string;
  x: number;
  z: number;
  kmh: number;
  odo: number;
  tiles: number;
  traffic: number;
  peds: number;
  models: number;
  input: { gas: number; brake: number; steer: number; source: string };
}
type Win = { __poyga?: { snapshot(): Snap }; __engine?: { state: string } };

const RED: [number, number, number] = [210, 40, 40];
const standing = (o: Partial<FakePerson> = {}): FakePerson => ({ cx: 0.5, armL: "down", armR: "down", rgb: RED, ...o });
const handsUp = (): FakePerson => standing({ armL: "up", armR: "up" });

const waitState = (page: Page, s: string, timeout = 90_000) =>
  page.waitForFunction((st) => (window as unknown as Win).__engine?.state === st, s, { timeout });
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as unknown as Win).__poyga!.snapshot());

async function boot(page: Page, level: "low" | "medium" | "high"): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("_next/hmr")) problems.push("console: " + m.text());
  });
  page.on("requestfailed", (r) => problems.push("failed: " + r.url()));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`);
  });
  await page.setViewportSize({ width: 960, height: 540 });
  await page.addInitScript((q) => {
    localStorage.setItem("harakat.settings", JSON.stringify({ state: { quality: q }, version: 1 }));
  }, level);
  await installFake(page, { people: [handsUp()] });
  await page.goto("/play/poyga?start=1");
  await waitState(page, "ready");
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await page.waitForFunction(() => !!(window as unknown as Win).__poyga, null, { timeout: 30_000 });
  return problems;
}

test.describe("poyga", () => {
  for (const level of ["low", "medium", "high"] as const) {
    test(`${level}: the city streams in and draws, the assets load, nothing fails`, async ({ page }) => {
      test.setTimeout(180_000);
      const problems = await boot(page, level);
      expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Cyrillic}/u);
      expect((await snap(page)).phase).toBe("drive");
      // tiles, traffic and pedestrians appear while the game runs
      await page.waitForFunction(() => (window as unknown as Win).__poyga!.snapshot().tiles >= 4, null, { timeout: 60_000 });
      await page.waitForTimeout(6000);
      const s = await snap(page);
      expect(s.traffic).toBeGreaterThan(0);
      expect(await page.evaluate(() => (window as unknown as Win).__engine?.state)).toBe("play");
      expect(problems).toEqual([]);
    });
  }
});
