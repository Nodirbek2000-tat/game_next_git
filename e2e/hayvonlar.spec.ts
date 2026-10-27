import { expect, test, type Page } from "@playwright/test";
import { installFake } from "./fixtures";

// "Hayvonlardek harakat": three children (window.__fake) copy the animals. The page exposes window.__hayvonlar with ?debug=1.
// A page-side driver turns the current animal's move into skeleton poses (jumps, claps, squats ...) for the kids that take part.

const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });

interface Dbg {
  animal: string;
  move: string;
  phase: string;
  t: number;
  index: number;
  doneCount: number;
  done: boolean[];
  perKid: number[];
  stars: number;
  order: string[];
}
const dbg = <T>(page: Page, expr: string): Promise<T> => page.evaluate(`(() => { const h = window.__hayvonlar; return h ? (${expr}) : null; })()`) as Promise<T>;

const KIDS = [{ cx: 0.8 }, { cx: 0.5 }, { cx: 0.2 }];

/** Starts the pose driver: `acting[i]` says whether kid i copies the animal. Kid i = slot i (left to right on screen). */
async function drive(page: Page, acting: boolean[]): Promise<void> {
  await page.evaluate(
    ({ kids, acting }) => {
      const w = window as unknown as { __scene: { people: unknown[] }; __hayvonlar?: { move: string; phase: string; t: number } };
      setInterval(() => {
        const h = w.__hayvonlar;
        const s = h && h.phase === "act" ? h.t : -1;
        const mv = h ? h.move : "";
        w.__scene.people = kids.map((k, i) => {
          const o: Record<string, unknown> = { cx: k.cx, h: 0.5, top: 0.2, armL: "down", armR: "down" };
          if (!acting[i] || s < 0.9) return o;
          const u = s - 0.9;
          if (mv === "jump") o.top = 0.2 - 0.1 * Math.max(0, Math.sin((u / 1.2) * Math.PI * 2));
          else if (mv === "flap") {
            o.armL = [k.cx + 0.18, 0.2 + 0.5 * 0.17];
            o.armR = [k.cx - 0.18, 0.2 + 0.5 * 0.17];
          } else if (mv === "froghop") {
            const c = u % 3.2;
            if (c < 0.7) o.top = 0.3;
            else if (c < 1.2) o.top = 0.2 - 0.1 * Math.sin(((c - 0.7) / 0.5) * Math.PI);
          } else if (mv === "handsUp") {
            o.armL = "up";
            o.armR = "up";
          } else if (mv === "clap") {
            const gap = u % 0.5 < 0.25 ? 0.1 : 0.005;
            o.armL = [k.cx + gap, 0.29];
            o.armR = [k.cx - gap, 0.29];
          } else if (mv === "slowSquat") {
            if (u % 3 < 1.6) o.top = 0.3;
          }
          return o;
        });
      }, 16);
    },
    { kids: KIDS, acting },
  );
}

test("/play/hayvonlar: three children copy all six animals, everyone gets a star each time, ends with Barakalla", async ({ page }) => {
  test.setTimeout(150_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: KIDS.map((k) => ({ cx: k.cx, h: 0.5, top: 0.2, armL: "down", armR: "down" })) });
  const seq = ["quyon", "pingvin", "baqa", "qush", "ayiq", "toshbaqa"];
  await page.goto(`/play/hayvonlar?duration=50&seq=${seq.join(",")}&debug=1`);

  // a crowd game: no scan, straight to the menu
  await waitState(page, "ready");
  await expect(page.getByTestId("scan-overlay")).toHaveCount(0);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await expect.poll(() => dbg<number>(page, "h.index")).toBe(0);
  await drive(page, [true, true, true]);

  for (let i = 0; i < seq.length; i++) {
    await page.waitForFunction((n) => (window as unknown as { __hayvonlar?: Dbg }).__hayvonlar?.index === n, i, { timeout: 30_000 });
    expect(await dbg<string>(page, "h.animal")).toBe(seq[i]);
    // wait for the end of this challenge (everybody done -> short pause -> praise)
    await page.waitForFunction((n) => {
      const h = (window as unknown as { __hayvonlar?: Dbg }).__hayvonlar;
      return !!h && h.index === n && h.phase === "praise";
    }, i, { timeout: 30_000 });
    expect(await dbg<number>(page, "h.doneCount"), `animal ${seq[i]}: all three children get a star`).toBe(3);
  }
  const per = await dbg<number[]>(page, "Array.from(h.perKid)");
  expect(per.slice(0, 3)).toEqual([6, 6, 6]);
  expect(per.slice(3)).toEqual([0, 0]);

  await waitState(page, "results", 60_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  const stars = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(stars?.split(" ")[0])).toBeGreaterThanOrEqual(18);
  expect(problems).toEqual([]);
});

test("/play/hayvonlar: every child is judged separately (the child who stands still gets no star for the animal)", async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: KIDS.map((k) => ({ cx: k.cx, h: 0.5, top: 0.2, armL: "down", armR: "down" })) });
  await page.goto("/play/hayvonlar?duration=21&seq=quyon,pingvin&debug=1");
  await waitState(page, "ready");
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await expect.poll(() => dbg<number>(page, "h.index")).toBe(0);
  await drive(page, [true, false, true]); // the middle child stands still

  // first animal: the two active children are done, the third is not
  await page.waitForFunction(() => (window as unknown as { __hayvonlar?: Dbg }).__hayvonlar?.doneCount === 2, undefined, { timeout: 20_000 });
  expect(await dbg<boolean[]>(page, "Array.from(h.done)")).toEqual([true, false, true, false, false]);
  expect(await dbg<number[]>(page, "Array.from(h.perKid)")).toEqual([1, 0, 1, 0, 0]);

  // second animal (the clap)
  await page.waitForFunction(() => (window as unknown as { __hayvonlar?: Dbg }).__hayvonlar?.index === 1, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => (window as unknown as { __hayvonlar?: Dbg }).__hayvonlar?.perKid[0] === 2, undefined, { timeout: 20_000 });
  const mid = await dbg<number[]>(page, "Array.from(h.perKid)");
  expect(mid[0]).toBe(2);
  expect(mid[1]).toBe(0);
  expect(mid[2]).toBe(2);

  await waitState(page, "results", 30_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  // the child who took part but did not manage it still shares the celebration (at least 1 star) -> 2 + 1 + 2
  const stars = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(stars?.split(" ")[0])).toBeGreaterThanOrEqual(5);
  expect(problems).toEqual([]);
});
