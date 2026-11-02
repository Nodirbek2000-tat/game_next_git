import { expect, test, type Page } from "@playwright/test";
import { installFake, setPeople, type FakePerson } from "./fixtures";

// Boks: first-person boxing. The player is a synthetic skeleton (window.__fake): the wrists are moved by a page-side
// animation so that a punch is a real fast hand motion for the tracker (blade speed + the arm getting longer).

interface Snap {
  phase: string;
  state: string;
  round: number;
  health: number;
  stamina: number;
  enemyHealth: number;
  score: number;
  combo: number;
  lastSpeed: number;
  bestSpeed: number;
  hits: number;
  thrown: number;
  accuracy: number;
  dodges: number;
  blocks: number;
  taken: number;
  partner: { phase: string; down: number; attack: { active: boolean; kind: string; from: number; t: number } };
  pads: { id: number; side: "L" | "R"; age: number; x: number; y: number; r: number }[];
  aim: { side: "L" | "R"; x: number; y: number; guardX: number; guardY: number; r: number } | null;
  present: boolean;
  level: string;
  crowd: number;
  shadows: boolean;
  post: boolean;
}
type Win = {
  __boks?: { snapshot(): Snap };
  __engine?: { state: string; stage: { w: number; h: number } };
  __scene: { people: Record<string, unknown>[] };
};

const RED: [number, number, number] = [210, 40, 40];
const standing = (o: Partial<FakePerson> = {}): FakePerson => ({ cx: 0.5, armL: "down", armR: "down", rgb: RED, ...o });
const handsUp = (): FakePerson => standing({ armL: "up", armR: "up" });

const waitState = (page: Page, s: string, timeout = 90_000) =>
  page.waitForFunction((st) => (window as unknown as Win).__engine?.state === st, s, { timeout });
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as unknown as Win).__boks!.snapshot());

async function boot(page: Page, level: "low" | "medium" | "high", query = "duration=14"): Promise<string[]> {
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
  await page.goto(`/play/boks?${query}`);
  await waitState(page, "ready");
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await page.waitForFunction(() => !!(window as unknown as Win).__boks, null, { timeout: 30_000 });
  return problems;
}

/** wait until the probe says `ok` */
const until = (page: Page, ok: (s: Snap) => boolean, timeout = 40_000) =>
  expect
    .poll(async () => ok(await snap(page)), { timeout, intervals: [100] })
    .toBe(true);

/**
 * Move the wrist of `side` from where it is to the stage point (x, y) in `ms` (a page-side animation, one step per frame), so
 * the tracker sees a real motion. Stage px -> the fake's normalised, un-mirrored camera image.
 */
async function moveWrist(page: Page, side: "L" | "R", x: number, y: number, ms: number): Promise<void> {
  await page.evaluate(
    ([sd, tx, ty, dur]) =>
      new Promise<void>((done) => {
        const w = window as unknown as Win;
        const W = w.__engine!.stage.w;
        const H = w.__engine!.stage.h;
        const key = sd === "L" ? "armL" : "armR";
        const p = w.__scene.people[0];
        const from = Array.isArray(p[key]) ? (p[key] as [number, number]) : null;
        const to: [number, number] = [1 - (tx as number) / W, (ty as number) / H];
        // (a hand hanging down: start from the hip, never teleport)
        const a = from ?? [to[0], 0.52];
        const t0 = performance.now();
        const step = (): void => {
          const k = Math.min(1, (performance.now() - t0) / (dur as number));
          p[key] = [a[0] + (to[0] - a[0]) * k, a[1] + (to[1] - a[1]) * k];
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        step();
      }),
    [side, x, y, ms] as const,
  );
}

test.describe("boks", () => {
  for (const level of ["low", "medium", "high"] as const) {
    test(`${level}: the ring draws, the intro runs into round 1, pads appear, nothing fails`, async ({ page }) => {
      test.setTimeout(120_000);
      const problems = await boot(page, level);
      expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Cyrillic}/u);
      await until(page, (s) => s.phase === "round");
      await until(page, (s) => s.pads.length > 0);
      const s = await snap(page);
      // (the quality controller may lower the level on a slow machine, never raise it)
      const order = ["low", "medium", "high"];
      expect(order.indexOf(s.level)).toBeLessThanOrEqual(order.indexOf(level));
      expect(s.round).toBe(1);
      expect(s.health).toBe(100);
      if (level !== "high") expect(s.shadows).toBe(false);
      if (s.level !== "high") expect(s.post).toBe(false);
      if (level === "low") expect(s.crowd).toBe(0);
      else await until(page, (x) => x.crowd > 50);
      await page.waitForTimeout(2000);
      expect(await page.evaluate(() => (window as unknown as Win).__engine?.state)).toBe("play");
      expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Cyrillic}/u);
      expect(problems).toEqual([]);
    });
  }

  test("a fast punch with the right hand on its pad scores and shows a speed; a slow reach does not", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page, "medium", "duration=40");
    await until(page, (s) => s.phase === "round");
    // 1) slow: lift the hand to the pad over 1.5 s
    await until(page, (s) => !!s.aim && s.pads.some((p) => p.age > 0.2));
    let s = await snap(page);
    await moveWrist(page, s.aim!.side, s.aim!.guardX, s.aim!.guardY, 250);
    await page.waitForTimeout(300);
    s = await snap(page);
    if (s.aim) {
      const side = s.aim.side;
      await moveWrist(page, side, s.aim.x, s.aim.y, 1200);
      await page.waitForTimeout(200);
    }
    s = await snap(page);
    expect(s.hits).toBe(0);
    expect(s.thrown).toBe(0);
    // 2) fast: guard, then a quick thrust onto the pad (a few tries: the pad may have run out meanwhile)
    let hit = false;
    for (let attempt = 0; attempt < 8 && !hit; attempt++) {
      await until(page, (x) => !!x.aim && x.pads.some((p) => p.age > 0.25 && p.age < 1.0), 15_000);
      s = await snap(page);
      const aim = s.aim!;
      await moveWrist(page, aim.side, aim.guardX, aim.guardY, 180);
      await page.waitForTimeout(120);
      await moveWrist(page, aim.side, aim.x, aim.y, 120);
      await page.waitForTimeout(250);
      await moveWrist(page, aim.side, aim.guardX, aim.guardY, 400);
      hit = (await snap(page)).hits > 0;
    }
    s = await snap(page);
    expect(s.hits).toBeGreaterThan(0);
    expect(s.score).toBeGreaterThan(0);
    expect(s.bestSpeed).toBeGreaterThan(0);
    expect(s.enemyHealth).toBeLessThan(100);
    // the HUD score follows
    await expect.poll(async () => Number((await page.getByTestId("hud-score").textContent())?.replace(/\s/g, "")), { timeout: 5000 }).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("the partner telegraphs a punch; a lean of the head dodges it", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page, "low", "duration=30");
    // wait for the wind-up of the first attack
    await until(page, (s) => s.partner.attack.active && s.partner.attack.t > 0.05, 60_000);
    const s = await snap(page);
    expect(["windup", "strike"]).toContain(s.partner.phase);
    // lean away from the side the glove comes from (the picture is mirrored: moving right on the screen = a smaller x)
    const dx = s.partner.attack.from < 0 ? -0.13 : 0.13;
    await setPeople(page, [standing({ cx: 0.5 + dx })]);
    await until(page, (x) => x.dodges + x.taken + x.blocks > 0, 10_000);
    const r = await snap(page);
    expect(r.dodges).toBe(1);
    expect(r.taken).toBe(0);
    expect(r.health).toBe(100);
    expect(problems).toEqual([]);
  });

  test("three short rounds, then the results with the speed, the hits and the stars", async ({ page }) => {
    test.setTimeout(180_000);
    const problems = await boot(page, "medium", "duration=5");
    await until(page, (s) => s.round === 2, 40_000);
    await until(page, (s) => s.round === 3, 40_000);
    await waitState(page, "results", 90_000);
    const box = page.getByTestId("results-overlay");
    await expect(box).toContainText("Zarbalar");
    await expect(box).toContainText("Eng tez zarba");
    await expect(box).toContainText("taxminiy");
    await expect(box).toContainText("Aniqlik");
    expect(await page.getByTestId("result-stars").getAttribute("aria-label")).toMatch(/^\d yulduz$/);
    expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(problems).toEqual([]);
  });

  test("the probe is removed when the game is left", async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page, "low");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !(window as unknown as Win).__boks, null, { timeout: 20_000 });
  });
});
