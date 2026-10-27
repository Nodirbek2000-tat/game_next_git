import { expect, test, type Page } from "@playwright/test";
import { installFake, setAuto, setPeople, type FakePerson } from "./fixtures";

type Eng = {
  state: string;
  players: { present: boolean; center: { x: number; y: number }; lockMode: string }[];
  tracker: { lock: { slots: { mode: string; center: { x: number; y: number } | null }[] } };
};
const eng = (page: Page, expr: string) => page.evaluate(`(() => { const e = window.__engine; return ${expr}; })()`);
const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: Eng }).__engine?.state === st, s, { timeout });

const RED: [number, number, number] = [210, 40, 40];
const BLUE: [number, number, number] = [40, 80, 220];
const GREEN: [number, number, number] = [40, 190, 80];

const standing = (o: Partial<FakePerson> = {}): FakePerson => ({ cx: 0.5, armL: "down", armR: "down", rgb: RED, ...o });
const handsUp = (o: Partial<FakePerson> = {}): FakePerson => standing({ armL: "up", armR: "up", ...o });

test("one player: scan -> menu -> countdown -> play -> results -> replay", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push("console.error: " + m.text());
  });
  // kids mode: no bombs, so the autopilot's score can only go up
  await page.addInitScript(() => localStorage.setItem("harakat.settings", JSON.stringify({ state: { kids: true }, version: 1 })));
  await installFake(page, { people: [standing()] });
  await page.goto("/play/meva-ninja?duration=6&debug=1");

  await waitState(page, "scan");
  await expect(page.getByTestId("scan-overlay")).toBeVisible();
  // not locked yet: nobody raised both hands
  expect(await eng(page, "e.tracker.lock.slots[0].mode")).toBe("none");

  await setPeople(page, [handsUp()]);
  await waitState(page, "ready");
  expect(await eng(page, "e.tracker.lock.slots[0].mode")).toBe("locked");
  await expect(page.getByTestId("ready-overlay")).toBeVisible();

  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "countdown");
  await waitState(page, "play");
  await expect(page.getByTestId("debug-panel")).toContainText("window.__fake");

  await setAuto(page, true);
  await expect.poll(async () => Number((await page.getByTestId("hud-score").textContent())?.replace(/\s/g, "")), { timeout: 15_000 }).toBeGreaterThan(0);

  await waitState(page, "results", 25_000);
  await expect(page.getByTestId("results-overlay")).toBeVisible();
  const score = Number(await page.getByTestId("result-score").textContent());
  expect(score).toBeGreaterThan(0);
  expect(await page.getByTestId("result-stars").getAttribute("aria-label")).toMatch(/^\d yulduz$/);
  // the record is kept in localStorage
  expect(Number(await page.evaluate(() => localStorage.getItem("harakat.best.meva-ninja")))).toBe(score);

  // everything the scene created is disposed when it unmounts
  // (three.js keeps one shared 16x16 BRDF lookup texture for MeshStandardMaterial; every texture of the game is gone)
  await expect.poll(async () => Number(await eng(page, "e.gl.info.memory.geometries")), { timeout: 5000 }).toBe(0);
  expect(Number(await eng(page, "e.gl.info.memory.textures"))).toBeLessThanOrEqual(1);

  // replay
  await setAuto(page, false);
  await page.getByTestId("again-btn").click();
  await waitState(page, "countdown");
  await waitState(page, "play");
  expect(problems).toEqual([]);
});

test("two players: slots follow clothing when swapping places, a third person is ignored", async ({ page }) => {
  await installFake(page, { people: [standing({ cx: 0.3, rgb: BLUE }), standing({ cx: 0.7, rgb: RED })] });
  await page.goto("/play/meva-ninja?players=2&duration=20");
  await waitState(page, "scan");
  await expect(page.getByTestId("scan-title")).toContainText("Ikkala");

  // a stranger raises hands too: only the two closest/largest become players
  await setPeople(page, [handsUp({ cx: 0.3, rgb: BLUE }), handsUp({ cx: 0.7, rgb: RED }), handsUp({ cx: 0.5, h: 0.4, top: 0.4, rgb: GREEN })]);
  await waitState(page, "ready");
  const mode = (await eng(page, "e.tracker.lock.slots.map(s => s.mode)")) as string[];
  expect(mode).toEqual(["locked", "locked"]);

  await page.getByTestId("start-btn").click();
  await waitState(page, "play");

  // mirrored view: camera x 0.7 appears on the screen LEFT. Slot 0 must be the person at screen-left (red, cx .7)
  await setPeople(page, [standing({ cx: 0.3, rgb: BLUE }), standing({ cx: 0.7, rgb: RED }), standing({ cx: 0.5, h: 0.4, top: 0.4, rgb: GREEN })]);
  await page.waitForTimeout(400);
  const w = (await eng(page, "e.stage.w")) as number;
  const c0 = (await eng(page, "e.players[0].center.x")) as number;
  const c1 = (await eng(page, "e.players[1].center.x")) as number;
  expect(c0).toBeLessThan(w / 2);
  expect(c1).toBeGreaterThan(w / 2);

  // swap places smoothly: identities (clothing colour) must follow the people, not the positions
  for (let i = 0; i <= 20; i++) {
    const k = i / 20;
    await setPeople(page, [standing({ cx: 0.3 + 0.4 * k, rgb: BLUE }), standing({ cx: 0.7 - 0.4 * k, rgb: RED }), standing({ cx: 0.5, h: 0.4, top: 0.4, rgb: GREEN })]);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
  const d0 = (await eng(page, "e.players[0].center.x")) as number;
  const d1 = (await eng(page, "e.players[1].center.x")) as number;
  // slot 0 followed its clothing to the other side of the screen
  expect(d0).toBeGreaterThan(w / 2);
  expect(d1).toBeLessThan(w / 2);
  expect(await eng(page, "e.state")).toBe("play");
});

test("player leaves -> pause, returns -> game resumes", async ({ page }) => {
  await installFake(page, { people: [handsUp()] });
  await page.goto("/play/meva-ninja?duration=30");
  await waitState(page, "ready");
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await setPeople(page, []);
  await waitState(page, "pause", 8000);
  await expect(page.getByTestId("pause-overlay")).toContainText("ko‘rinmayapti");
  await setPeople(page, [standing()]);
  await waitState(page, "countdown", 8000);
  await waitState(page, "play", 8000);
});

test("camera permission denied shows a device guide and a retry button", async ({ page }) => {
  await installFake(page, { mode: "denied" });
  await page.goto("/play/meva-ninja");
  await expect(page.getByTestId("camera-status")).toContainText("Kameraga ruxsat berilmadi");
  const guide = page.getByTestId("camera-guide");
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Kameraga ruxsat yopiq");
  await expect(guide.locator("li").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Qayta urinish/ })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(new RegExp("[\u0400-\u04FF]"));
});

test("denied inside an in-app browser (Telegram) explains how to open the system browser", async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Telegram-Android/10.0" });
  const page = await ctx.newPage();
  await installFake(page, { mode: "denied" });
  await page.goto("/play/meva-ninja");
  await expect(page.getByTestId("camera-guide")).toContainText("Telegram");
  await ctx.close();
});

test("unknown or unreleased game shows a friendly screen", async ({ page }) => {
  await page.goto("/play/yoq-oyin");
  await expect(page.getByTestId("play-notice")).toContainText("topilmadi");
  await page.goto("/play/boks");
  await expect(page.getByTestId("play-notice")).toContainText("topilmadi");
  await expect(page.getByRole("link", { name: /Boshqa o‘yinlar/ })).toHaveAttribute("href", "/oyinlar");
});

test("hand dwell: holding the raised hand over a button presses it (no mouse)", async ({ page }) => {
  await installFake(page, { people: [handsUp({ top: 0.28, h: 0.62, legsVisible: false })] });
  await page.goto("/play/meva-ninja");
  await waitState(page, "ready");
  // the left hand goes down: the raised right hand is the pointer
  await setPeople(page, [standing({ top: 0.28, h: 0.62, legsVisible: false, armR: "up" })]);
  // aim the (mirrored) cursor at the centre of the start button
  const box = await page.getByTestId("start-btn").boundingBox();
  expect(box).not.toBeNull();
  const target = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  const m = (await eng(page, "({ c: e.players[0].center, s: e.players[0].scale, w: e.stage.w, h: e.stage.h, reach: e.config.cursor.reach })")) as { c: { x: number; y: number }; s: number; w: number; h: number; reach: number };
  // cursor = c + (p - c) * reach - scale * 0.2   =>   p = c + (cursor - c + scale * 0.2) / reach   (stage px)
  const px = m.c.x + (target.x - m.c.x) / m.reach;
  const py = m.c.y + (target.y - m.c.y + m.s * 0.2) / m.reach;
  // stage px -> normalised un-mirrored camera coords (16:9 camera on a 16:9 stage)
  await setPeople(page, [standing({ top: 0.28, h: 0.62, legsVisible: false, armR: [(m.w - px) / m.w, py / m.h] })]);
  await waitState(page, "countdown", 8000);
});

test("hidden tab pauses the game", async ({ page }) => {
  await installFake(page, { people: [handsUp()] });
  await page.goto("/play/meva-ninja?duration=30");
  await waitState(page, "ready");
  await setPeople(page, [standing()]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitState(page, "pause", 3000);
  await expect(page.getByTestId("pause-overlay")).toContainText("yashirildi");
});
