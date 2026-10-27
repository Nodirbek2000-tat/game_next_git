import { expect, test, type Page } from "@playwright/test";
import { installFake, type FakePerson } from "./fixtures";

const eng = (page: Page, expr: string) => page.evaluate(`(() => { const e = window.__engine; return ${expr}; })()`);
const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });
const waitPhase = (page: Page, ph: string, timeout = 20_000) =>
  page.waitForFunction((p) => (window as unknown as { __qotib?: { phase: string } }).__qotib?.phase === p, ph, { timeout });
const qotib = <T>(page: Page, expr: string) => page.evaluate(`(() => { const q = window.__qotib; return ${expr}; })()`) as Promise<T>;

const kid = (cx: number): FakePerson => ({ cx, h: 0.5, top: 0.2, armL: "down", armR: "down" });

test("Qotib qol: music, freeze, stars only for the children who stayed still, Barakalla", async ({ page }) => {
  test.setTimeout(100_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  // three children: left and right stand still, the one in the middle keeps dancing
  await installFake(page, { people: [kid(0.2), kid(0.5), kid(0.8)] });
  await page.goto("/play/qotib-qol?duration=30&dance=2&debug=1");

  await waitState(page, "ready");
  await expect(page.getByTestId("scan-overlay")).toHaveCount(0);
  expect(await eng(page, "e.crowd")).toBe(true);
  await expect.poll(() => eng(page, "e.kidTracker.count")).toBe(3);
  expect(await page.locator(".hk-three canvas").count()).toBe(0);

  await page.getByTestId("start-btn").click();
  await waitState(page, "countdown");
  await waitState(page, "play");

  // the middle child dances like mad (arms and body swing), the others do not move at all
  await page.evaluate(() => {
    const sc = (window as unknown as { __scene: { people: Record<string, unknown>[] } }).__scene;
    const base = sc.people[1];
    const t0 = performance.now();
    setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      sc.people[1] = {
        ...base,
        cx: 0.5 + 0.05 * Math.sin(t * 9),
        armL: [0.42 + 0.14 * Math.sin(t * 13), 0.35 + 0.2 * Math.cos(t * 11)],
        armR: [0.58 + 0.14 * Math.sin(t * 12 + 1), 0.35 + 0.2 * Math.cos(t * 10 + 2)],
      };
    }, 33);
  });

  // dance first, then the music stops
  await waitPhase(page, "dance");
  await waitPhase(page, "freeze");
  // the freeze lasts until the still children got their star
  await waitPhase(page, "result", 20_000);
  const done = await qotib<number>(page, "q.doneMask");
  const tried = await qotib<number>(page, "q.triedMask");
  expect(done).toBe(0b101); // slots 0 and 2 (left / right) froze
  expect(tried).toBe(0b010); // the dancer only got the friendly "Yana urinib ko‘ramiz!"
  expect(await qotib<number>(page, "q.tries")).toBeGreaterThanOrEqual(1);
  const stars = await qotib<number[]>(page, "q.perKid()");
  expect(stars[0]).toBeGreaterThanOrEqual(1);
  expect(stars[2]).toBeGreaterThanOrEqual(1);
  expect(stars[1]).toBe(0);

  // the dance starts again
  await waitPhase(page, "dance");
  expect(await qotib<number>(page, "q.cycle")).toBeGreaterThanOrEqual(1);

  // the round ends with "Barakalla!" and everybody who took part has a star
  await waitState(page, "results", 40_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  const total = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(total?.split(" ")[0])).toBeGreaterThanOrEqual(3);
  expect(problems).toEqual([]);
});
