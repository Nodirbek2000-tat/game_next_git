import { expect, test, type Page } from "@playwright/test";
import { installFake } from "./fixtures";

// "Sanaymiz": three children count jumps / claps and catch the named colour (window.__fake). The page exposes window.__sanaymiz with ?debug=1;
// ?seq= fixes the rounds: jump2, colour 0 (qizil), clap2.

const waitState = (page: Page, s: string, timeout = 20_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });
interface Dbg {
  idx: number;
  kind: string;
  n: number;
  colour: number;
  phase: string;
  doneCount: number;
  earned: number[];
  counts: number[];
  targets: number;
  pops: number;
  stars: number;
}
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __sanaymiz?: Dbg }).__sanaymiz ?? null);

const KIDS = [0.8, 0.5, 0.2];

/** page-side driver: every child does what the current round asks (jumps, claps, hands sweeping across the picture for the balloons) */
async function drive(page: Page): Promise<void> {
  await page.evaluate((kids) => {
    const w = window as unknown as { __scene: { people: unknown[] }; __sanaymiz?: { kind: string; phase: string } };
    let playSince = 0;
    let lastPhase = "";
    setInterval(() => {
      const d = w.__sanaymiz;
      const now = Date.now() / 1000;
      if (d && d.phase !== lastPhase) {
        lastPhase = d.phase;
        if (d.phase === "play") playSince = now;
      }
      const u = d && d.phase === "play" ? now - playSince - 0.9 : -1;
      const kind = d ? d.kind : "";
      w.__scene.people = kids.map((cx, i) => {
        const o: Record<string, unknown> = { cx, h: 0.5, top: 0.2, armL: "down", armR: "down" };
        if (u < 0) return o;
        if (kind === "jump") o.top = 0.2 - 0.1 * Math.max(0, Math.sin((u / 1.2) * Math.PI * 2));
        else if (kind === "clap") {
          const gap = u % 0.5 < 0.25 ? 0.1 : 0.005;
          o.armL = [cx + gap, 0.29];
          o.armR = [cx - gap, 0.29];
        } else if (kind === "colour") {
          const ph = i * 2.1;
          o.armL = [0.5 + 0.4 * Math.sin(1.3 * u + ph), 0.55 + 0.3 * Math.cos(1.1 * u + ph)];
          o.armR = [0.5 + 0.4 * Math.sin(1.1 * u + ph + 2), 0.55 + 0.3 * Math.cos(1.5 * u + ph + 1)];
        }
        return o;
      });
    }, 16);
  }, KIDS);
}

test("Sanaymiz: 3 children jump 2 times, catch the red balloon, clap 2 times - everybody gets a star each time, ends with Barakalla", async ({ page }) => {
  test.setTimeout(170_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  await installFake(page, { people: KIDS.map((cx) => ({ cx, h: 0.5, top: 0.2, armL: "down", armR: "down" })) });
  await page.goto("/play/sanaymiz?duration=44&seq=jump2,col0,clap2&debug=1");

  await waitState(page, "ready");
  await expect(page.getByTestId("scan-overlay")).toHaveCount(0);
  expect(await page.locator(".hk-three canvas").count()).toBe(0);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await expect.poll(async () => (await dbg(page))?.idx, { timeout: 10_000 }).toBe(0);
  await drive(page);

  const roundDone = async (idx: number, kind: string) => {
    await page.waitForFunction(
      (a) => {
        const d = (window as unknown as { __sanaymiz?: Dbg }).__sanaymiz;
        return !!d && d.idx === a.idx && d.phase === "praise";
      },
      { idx },
      { timeout: 40_000 },
    );
    const d = (await dbg(page))!;
    expect(d.kind, `round ${idx}`).toBe(kind);
    expect(d.doneCount, `round ${idx} (${kind}): all three children complete it`).toBe(3);
  };
  await roundDone(0, "jump");
  expect((await dbg(page))!.counts.slice(0, 3)).toEqual([2, 2, 2]);
  await roundDone(1, "colour");
  expect((await dbg(page))!.pops).toBeGreaterThanOrEqual(3);
  await roundDone(2, "clap");
  expect((await dbg(page))!.earned).toEqual([3, 3, 3, 0, 0]);

  await waitState(page, "results", 90_000);
  await expect(page.getByTestId("crowd-title")).toHaveText("Barakalla!");
  const stars = await page.getByTestId("result-stars").getAttribute("aria-label");
  expect(Number(stars?.split(" ")[0])).toBeGreaterThanOrEqual(9);
  expect(problems).toEqual([]);
});
