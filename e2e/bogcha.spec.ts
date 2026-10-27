import { expect, test, type Page } from "@playwright/test";
import { installFake, type FakePerson } from "./fixtures";

const eng = (page: Page, expr: string) => page.evaluate(`(() => { const e = window.__engine; return ${expr}; })()`);
const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });

const kid = (cx: number): FakePerson => ({ cx, h: 0.5, top: 0.2, armL: "down", armR: "down" });
const FOUR = [0.15, 0.4, 0.62, 0.85].map(kid);

test("/bogcha: big cards for the kids games and the teacher line", async ({ page }) => {
  await page.goto("/bogcha");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bog‘cha");
  await expect(page.getByText("Bolalar kameradan 2–3 metr uzoqroq tursin")).toBeVisible();
  for (const slug of ["pufakchalar", "qotib-qol", "hayvonlar", "baliqcha"]) {
    await expect(page.getByTestId(`kids-${slug}`)).toHaveAttribute("href", `/play/${slug}`);
  }
  // the demo game is not listed, the main catalogue does not show kids games
  await expect(page.getByTestId("kids-bogcha-demo")).toHaveCount(0);
  await page.goto("/oyinlar");
  await expect(page.locator('a[href="/play/pufakchalar"]')).toHaveCount(0);
  // header link
  await page.getByTestId("nav-bogcha").click();
  await expect(page).toHaveURL(/\/bogcha$/);
});

test("crowd game: 4 children, no scan, no WebGL canvas, never pauses, Barakalla screen", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: FOUR });
  await page.goto("/play/bogcha-demo?duration=6&debug=1");

  // straight to the menu: no scan step
  await waitState(page, "ready");
  await expect(page.getByTestId("scan-overlay")).toHaveCount(0);
  await expect(page.getByTestId("ready-overlay")).toBeVisible();
  expect(await eng(page, "e.crowd")).toBe(true);
  await expect.poll(() => eng(page, "e.kidTracker.count")).toBe(4);
  expect(await eng(page, "e.kidSlots.map((k) => k.active)")).toEqual([true, true, true, true, false]);
  // slots run left to right
  const xs = (await eng(page, "e.kidSlots.slice(0, 4).map((k) => k.center.x)")) as number[];
  for (let i = 1; i < 4; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  // a 2D game: the engine did not create a WebGL canvas
  expect(await page.locator(".hk-three canvas").count()).toBe(0);

  await page.getByTestId("start-btn").click();
  await waitState(page, "countdown");
  await waitState(page, "play");
  await expect(page.getByTestId("debug-panel")).toContainText("window.__fake");

  // everybody leaves the picture: a crowd game does not pause
  await page.evaluate(() => {
    (window as unknown as { __scene: { people: unknown[] } }).__scene.people = [];
  });
  await page.waitForTimeout(1800);
  expect(await eng(page, "e.state")).toBe("play");
  await page.evaluate((p) => {
    (window as unknown as { __scene: { people: unknown[] } }).__scene.people = p;
  }, FOUR);

  await waitState(page, "results", 25_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  const stars = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(stars?.split(" ")[0])).toBeGreaterThanOrEqual(1);
  expect(problems).toEqual([]);

  // replay works without a scan
  await page.getByTestId("again-btn").click();
  await waitState(page, "countdown");
});
