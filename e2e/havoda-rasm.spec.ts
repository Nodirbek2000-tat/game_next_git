import { expect, test, type Page } from "@playwright/test";
import { installFake } from "./fixtures";

// "Havoda rasm": three children paint in the air (window.__fake wrists moving above the hips), the page exposes window.__havoda with ?debug=1.

const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });
interface Dbg {
  segments: number;
  deferred: number;
  guideHits: number;
  prompts: number;
  shape: string;
  phase: string;
  stars: number;
  saved: number;
  clapBursts: number;
}
const havoda = (page: Page) => page.evaluate(() => (window as unknown as { __havoda?: Dbg }).__havoda ?? null);

const KIDS = [0.2, 0.5, 0.8];

/** page-side driver: the first 3 s all children clap, then both hands of every child circle above the hips (the sun is the first guide) */
async function drive(page: Page): Promise<void> {
  await page.evaluate((kids) => {
    const w = window as unknown as { __scene: { people: unknown[] } };
    const t0 = Date.now();
    setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      w.__scene.people = kids.map((cx, i) => {
        const o: Record<string, unknown> = { cx, h: 0.5, top: 0.2, armL: "down", armR: "down" };
        if (t < 3) {
          const gap = t % 0.5 < 0.25 ? 0.1 : 0.005;
          o.armL = [cx + gap, 0.29];
          o.armR = [cx - gap, 0.29];
        } else {
          const ph = i * 2.1;
          o.armL = [0.5 + 0.28 * Math.cos(1.7 * t + ph), 0.28 + 0.14 * Math.sin(1.7 * t + ph)];
          o.armR = [0.5 + 0.28 * Math.cos(1.9 * t + ph + 1), 0.28 + 0.14 * Math.sin(1.9 * t + ph + 1)];
        }
        return o;
      });
    }, 16);
  }, KIDS);
}

test("Havoda rasm: 3 children paint, the sun guide gives sparkles + stars, claps fire, the picture can be saved, ends with Barakalla", async ({ page }) => {
  test.setTimeout(100_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: KIDS.map((cx) => ({ cx, h: 0.5, top: 0.2, armL: "down", armR: "down" })) });
  await page.goto("/play/havoda-rasm?duration=28&debug=1");

  // a crowd game: no scan, straight to the menu; 2D only
  await waitState(page, "ready");
  await expect(page.getByTestId("scan-overlay")).toHaveCount(0);
  expect(await page.locator(".hk-three canvas").count()).toBe(0);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await drive(page);

  // claps -> fireworks, hands above the hips -> trails (segments), the first prompt is the sun
  await expect.poll(async () => (await havoda(page))?.clapBursts ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await havoda(page))?.prompts ?? 0, { timeout: 10_000 }).toBe(1);
  expect((await havoda(page))!.shape).toBe("sun");
  await expect.poll(async () => (await havoda(page))?.segments ?? 0, { timeout: 15_000 }).toBeGreaterThan(60);
  await expect.poll(async () => (await havoda(page))?.guideHits ?? 0, { timeout: 15_000 }).toBeGreaterThan(3);
  await expect.poll(async () => (await havoda(page))?.stars ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

  // the last seconds show the group picture with the save button for the teacher
  await expect.poll(async () => (await havoda(page))?.phase, { timeout: 25_000 }).toBe("gallery");
  const save = page.getByTestId("save-btn");
  await expect(save).toBeVisible();
  await waitState(page, "results", 25_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  const stars = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(stars?.split(" ")[0])).toBeGreaterThanOrEqual(3);

  // the scene is gone, the picture + the save button stay in a corner panel while the results screen is open
  await expect(page.getByTestId("keepsake")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10_000 }), save.click()]);
  expect(download.suggestedFilename()).toBe("havoda-rasm.png");
  expect(problems).toEqual([]);
});
