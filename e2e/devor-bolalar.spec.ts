import { expect, test, type Page } from "@playwright/test";
import { installFake } from "./fixtures";

// "Devordan o‘tamiz": three children (window.__fake): two take the pose of the first wall, one stands still (soft bump, no star);
// the second wall is taken by all three (group bonus). The page exposes window.__devor with ?debug=1. A page-side driver turns the
// current wall's pose into skeleton poses for the children that take part.

const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });

interface Dbg {
  pose: string;
  phase: string;
  t: number;
  index: number;
  results: number[];
  passed: number;
  participants: number;
  allPassed: boolean;
  passTotal: number;
  allCount: number;
  perKid: number[];
  stars: number;
  poses: string[];
}
const dbg = <T>(page: Page, expr: string): Promise<T> => page.evaluate(`(() => { const h = window.__devor; return h ? (${expr}) : null; })()`) as Promise<T>;

// cx 0.8 / 0.5 / 0.2 = slots 0 / 1 / 2 (the image is mirrored)
const KIDS = [{ cx: 0.8 }, { cx: 0.5 }, { cx: 0.2 }];

/** Starts the pose driver: `acting[i]` (by wall index) says whether kid i takes the pose of the current wall. */
async function drive(page: Page, acting: boolean[][]): Promise<void> {
  await page.evaluate(
    ({ kids, acting }) => {
      const w = window as unknown as { __scene: { people: unknown[] }; __devor?: { pose: string; phase: string; index: number } };
      setInterval(() => {
        const h = w.__devor;
        const idx = h ? Math.max(0, h.index) : 0;
        const on = h && h.phase === "approach" ? acting[Math.min(idx, acting.length - 1)] : null;
        w.__scene.people = kids.map((k, i) => {
          const o: Record<string, unknown> = { cx: k.cx, h: 0.5, top: 0.2, armL: "down", armR: "down" };
          if (!on || !on[i]) return o;
          switch (h!.pose) {
            case "handsUp":
              o.armL = "up";
              o.armR = "up";
              break;
            case "armsOut":
              o.armL = "shoulder";
              o.armR = "shoulder";
              break;
            case "oneHand":
              o.armL = "up";
              break;
            case "squat":
              o.top = 0.3;
              break;
          }
          return o;
        });
      }, 16);
    },
    { kids: KIDS, acting },
  );
}

test("/play/devor-bolalar: two children take the pose (stars), one gets a soft bump; the next wall all three pass (bonus); ends with Barakalla", async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: KIDS.map((k) => ({ cx: k.cx, h: 0.5, top: 0.2, armL: "down", armR: "down" })) });
  await page.goto("/play/devor-bolalar?duration=20&seq=handsUp,armsOut&debug=1");

  // a crowd game: no scan, straight to the menu; 2D only
  await waitState(page, "ready");
  await expect(page.getByTestId("scan-overlay")).toHaveCount(0);
  expect(await page.locator(".hk-three canvas").count()).toBe(0);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await expect.poll(() => dbg<number>(page, "h.index"), { timeout: 10_000 }).toBe(0);
  await drive(page, [
    [true, true, false],
    [true, true, true],
  ]);

  // wall 1 (hands up): judged when it arrives (~5 s), then the result phase
  await page.waitForFunction(() => (window as unknown as { __devor?: Dbg }).__devor?.phase === "result" && (window as unknown as { __devor?: Dbg }).__devor?.index === 0, undefined, { timeout: 20_000 });
  expect(await dbg<string>(page, "h.pose")).toBe("handsUp");
  expect(await dbg<number[]>(page, "h.results.slice(0, 3)")).toEqual([1, 1, 2]);
  expect(await dbg<number>(page, "h.passed")).toBe(2);
  expect(await dbg<number>(page, "h.participants")).toBe(3);
  expect(await dbg<boolean>(page, "h.allPassed")).toBe(false);
  expect(await dbg<number[]>(page, "Array.from(h.perKid)")).toEqual([1, 1, 0, 0, 0]);
  expect(await dbg<number>(page, "h.stars")).toBe(2);

  // wall 2 (arms out): everybody passes -> every child gets a star and the group a bonus
  await page.waitForFunction(() => (window as unknown as { __devor?: Dbg }).__devor?.phase === "result" && (window as unknown as { __devor?: Dbg }).__devor?.index === 1, undefined, { timeout: 20_000 });
  expect(await dbg<string>(page, "h.pose")).toBe("armsOut");
  expect(await dbg<number[]>(page, "h.results.slice(0, 3)")).toEqual([1, 1, 1]);
  expect(await dbg<boolean>(page, "h.allPassed")).toBe(true);
  expect(await dbg<number[]>(page, "Array.from(h.perKid)")).toEqual([2, 2, 1, 0, 0]);
  expect(await dbg<number>(page, "h.stars")).toBe(5 + 2); // 5 stars of the children + the "Hammamiz o‘tdik!" bonus
  expect(await dbg<number>(page, "h.allCount")).toBe(1);

  // not enough time for a third wall: the round ends with "Barakalla!"
  await waitState(page, "results", 25_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  const stars = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(stars?.split(" ")[0])).toBe(7);
  expect(problems).toEqual([]);
});
