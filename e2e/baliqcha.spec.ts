import { expect, test, type Page } from "@playwright/test";
import { installFakeRecognizer } from "./baliq-helpers";
import { installFake, setPeople, type FakePerson } from "./fixtures";

const eng = (page: Page, expr: string) => page.evaluate(`(() => { const e = window.__engine; return ${expr}; })()`);
const game = (page: Page, expr: string) => page.evaluate(`(() => { const g = window.__baliqcha; return g ? (${expr}) : null; })()`);
const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });
const waitGame = (page: Page, expr: string, timeout = 10_000) =>
  page.waitForFunction((src) => {
    const g = (window as unknown as { __baliqcha?: unknown }).__baliqcha;
    return g ? new Function("g", `return (${src})`)(g) : false;
  }, expr, { timeout });

const kid = (cx: number, arms: "up" | "down"): FakePerson => ({ cx, h: 0.5, top: 0.25, armL: arms, armR: arms });
const KIDS = (arms: "up" | "down", n = 3): FakePerson[] => [0.2, 0.5, 0.8].slice(0, n).map((cx) => kid(cx, arms));

async function startRound(page: Page, query: string): Promise<void> {
  await page.goto(`/play/baliqcha?${query}`);
  await waitState(page, "ready");
  await page.getByTestId("start-btn").click();
  await waitState(page, "countdown");
  await waitState(page, "play");
  await waitGame(page, "g.anglers.length === 5");
}

test("/baliqcha game is on the site (the card links to it)", async ({ page }) => {
  await page.goto("/bogcha");
  await expect(page.getByTestId("kids-baliqcha")).toHaveAttribute("href", "/play/baliqcha");
});

test("3 children cast (hand up, then down), the fish bite by themselves, hands up pull: fish in the shared basket, ends with Barakalla!", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: KIDS("down") });
  // the mic is optional: keep it off here so that the test does not depend on the browser's microphone handling
  await page.addInitScript(() => localStorage.setItem("harakat.baliqcha.voice", "0"));
  await startRound(page, "duration=30&debug=1");
  expect(await eng(page, "e.crowd")).toBe(true);
  expect(await page.locator(".hk-three canvas").count()).toBe(0);
  await expect.poll(() => eng(page, "e.kidTracker.count")).toBe(3);
  await expect(page.getByTestId("voice-toggle")).toHaveAttribute("aria-pressed", "false");

  // cast: everybody raises a hand and brings it down
  await setPeople(page, KIDS("up"));
  await page.waitForTimeout(700);
  await setPeople(page, KIDS("down"));
  await waitGame(page, "g.anglers.slice(0, 3).every((a) => a.state !== 0)", 6_000);

  // the bite comes by itself, within a few seconds
  await waitGame(page, "g.anglers.slice(0, 3).every((a) => a.state === 3)", 8_000);
  // pull: hands up
  await setPeople(page, KIDS("up"));
  await waitGame(page, "g.basket >= 3", 8_000);
  expect(await game(page, "Array.from(g.catches.slice(0, 3))")).toEqual([1, 1, 1]);
  await setPeople(page, KIDS("down"));

  if (process.env.BALIQCHA_SHOT) await page.screenshot({ path: process.env.BALIQCHA_SHOT });

  // the stars of the shared basket
  const stars = await eng(page, "e.kidSlots.slice(0, 3).map((k) => k.active)");
  expect(stars).toEqual([true, true, true]);

  await waitState(page, "results", 40_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  const n = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(n?.split(" ")[0])).toBeGreaterThanOrEqual(3);
  expect(problems).toEqual([]);
});

test("voice: the mic switch works, \"baliq\" / \"tort\" commands cast and pull for everybody, the game also plays without any microphone", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: KIDS("down", 2) });
  // a mock of the browser's on-device recogniser (the real one does not exist in headless Chromium)
  await page.addInitScript(installFakeRecognizer);
  await startRound(page, "duration=25&debug=1");
  const toggle = page.getByTestId("voice-toggle");
  await expect(toggle).toBeVisible();
  // default: on; the on-device recogniser starts (and only the on-device one: processLocally)
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("voice-status")).toContainText("fish", { timeout: 5_000 });
  expect(await page.evaluate(() => (window as unknown as { __sr: { local: boolean | null } }).__sr.local)).toBe(true);
  // switch off: the recogniser is gone and the choice is remembered on this device; switch on again
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("voice-status")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("harakat.baliqcha.voice"))).toBe("0");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("voice-status")).toContainText("fish", { timeout: 5_000 });

  await expect.poll(() => game(page, "g.voice.anyIdle")).toBe(true);
  // the children say "baliq" (the recogniser hears it): every idle line is cast
  await page.evaluate(() => (window as unknown as { __say: (t: string, i: number) => void }).__say("baliq", 0));
  await waitGame(page, "g.anglers.slice(0, 2).every((a) => a.state !== 0)", 4_000);
  await waitGame(page, "g.anglers.slice(0, 2).every((a) => a.state === 3)", 8_000);
  // "tort!": every fish that bites is pulled out
  await page.evaluate(() => (window as unknown as { __say: (t: string, i: number) => void }).__say("tort", 1));
  await waitGame(page, "g.basket >= 2", 6_000);
  expect(problems).toEqual([]);
});
