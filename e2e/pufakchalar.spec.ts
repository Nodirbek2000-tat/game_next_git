import { expect, test, type Page } from "@playwright/test";
import { installFake, type FakePerson } from "./fixtures";

const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });
const pufak = (page: Page) => page.evaluate(() => (window as unknown as { __pufak?: { pops: number; spawned: number; alive: number; stars: number } }).__pufak ?? null);

// three children with their hands held out in front of them at chest height (bubbles are spawned in front of every child)
const kid = (cx: number): FakePerson => ({ cx, h: 0.5, top: 0.2, armL: [cx + 0.06, 0.52], armR: [cx - 0.06, 0.46] });
const THREE = [0.2, 0.5, 0.8].map(kid);

test("Pufakchalar: 3 children pop bubbles, the round ends with Barakalla", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: THREE });
  await page.goto("/play/pufakchalar?duration=12&debug=1");

  // no scan, straight to the menu; 2D only
  await waitState(page, "ready");
  await expect(page.getByTestId("scan-overlay")).toHaveCount(0);
  expect(await page.locator(".hk-three canvas").count()).toBe(0);
  await page.getByTestId("start-btn").click();
  await waitState(page, "countdown");
  await waitState(page, "play");

  // bubbles float and the children's hands pop them
  await expect.poll(async () => (await pufak(page))?.spawned ?? 0, { timeout: 10_000 }).toBeGreaterThan(3);
  await expect.poll(async () => (await pufak(page))?.pops ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  const mid = await pufak(page);
  expect(mid!.alive).toBeLessThanOrEqual(9);

  await waitState(page, "results", 25_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  const stars = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(stars?.split(" ")[0])).toBeGreaterThanOrEqual(3);
  expect(problems).toEqual([]);
});
