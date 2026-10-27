import { expect, test } from "@playwright/test";
import { installFake } from "./fixtures";

test("settings page: choices are saved and reloaded", async ({ page }) => {
  await installFake(page, { mode: "none" });
  await page.goto("/sozlamalar");
  await expect(page.getByRole("heading", { name: /Sozlamalar|moslang/ }).first()).toBeVisible();

  const kids = page.getByRole("switch", { name: "Bolalar rejimi" });
  const left = page.getByRole("switch", { name: "Chapaqay rejimi" });
  await expect(kids).toHaveAttribute("aria-checked", "false");
  await kids.click();
  await left.click();
  await page.getByRole("radio", { name: "Past" }).click();
  await page.getByRole("switch", { name: "Musiqa" }).click();
  await page.locator("#s-sens").fill("1.3");

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("harakat.settings") ?? "{}").state);
  expect(stored).toMatchObject({ kids: true, leftHanded: true, quality: "low", music: false });
  expect(stored.sensitivity).toBeCloseTo(1.3, 1);

  await page.reload();
  await expect(page.getByRole("switch", { name: "Bolalar rejimi" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Past" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#s-sens")).toHaveValue("1.3");
});

test("settings are read by the engine (kids mode + left handed reach the game)", async ({ page }) => {
  await installFake(page, { people: [{ cx: 0.5, armL: "up", armR: "up", rgb: [200, 40, 40] }] });
  await page.addInitScript(() => {
    localStorage.setItem("harakat.settings", JSON.stringify({ state: { kids: true, leftHanded: true, sensitivity: 1.5, quality: "medium" }, version: 1 }));
  });
  await page.goto("/play/meva-ninja");
  await page.waitForFunction(() => (window as unknown as { __engine?: { state: string } }).__engine?.state === "ready", undefined, { timeout: 20_000 });
  const got = await page.evaluate(() => {
    const e = (window as unknown as { __engine: { kids: boolean; leftHanded: boolean; sensitivity: number; quality: { level: string }; players: { dominant: string }[]; config: { gestures: { swipeSpeed: number } } } }).__engine;
    return { kids: e.kids, left: e.leftHanded, sens: e.sensitivity, level: e.quality.level, dom: e.players[0].dominant, swipe: e.config.gestures.swipeSpeed };
  });
  expect(got).toMatchObject({ kids: true, left: true, sens: 1.5, level: "medium", dom: "L" });
  expect(got.swipe).toBeLessThan(1);
});
