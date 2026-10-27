import { expect, test, type Page } from "@playwright/test";
import { installFake, setPeople, type FakePerson } from "./fixtures";
import { installDriver } from "./mashinaDriver";

// Mashina haydash 2.0 (TZ section 6). Everything goes through window.__fake: the "driver" is a synthetic skeleton
// (knees = pedals, wrists = wheel), so tracker, input mapping, Rapier physics, traffic rules and results are all exercised.
// Headless Chrome renders with a software GL at a few fps, so the long tests use ?timescale=N (N simulation steps per frame).

interface Snap {
  phase: string;
  mode: string;
  clock: number;
  score: number;
  car: { x: number; y: number; z: number; fx: number; fz: number; speed: number; kmh: number; slipDeg: number; grounded: number };
  input: { gas: number; brake: number; steer: number; handbrake: boolean; reverse: boolean; source: string };
  legs: { ready: boolean; calib: number; gasRaw: number; brakeRaw: number; okGas: boolean; okBrake: boolean };
  verdicts: { kind: string; ok: boolean }[];
  penalty: number;
  drift: { total: number; chain: number; combo: number; chains: number; best: number };
  tiles: { loaded: number; built: number; released: number; pending: number; ids: string[] };
  traffic: { cars: number; spawned: number; overtakes: number };
  crashes: number;
  lives: number;
  exam: { passed: boolean; penalty: number } | null;
  missions: { index: number; completed: number; failed: number; id: string } | null;
  ready: boolean;
  cam: string;
  limit: number;
}
type Game = {
  debugTeleport(x: number, z: number, fx: number, fz: number): void;
  debugSetClock(t: number): void;
  debugForcePeds(id: string): boolean;
  L: { tiles: Map<string, { cx: number; cz: number; offset: number }> };
};
type Win = { __mashina?: { snapshot(): Snap; game: Game }; __engine?: { state: string; gl: { info: { render: { calls: number; triangles: number } } } } };

const RED: [number, number, number] = [210, 40, 40];
const standing = (o: Partial<FakePerson> = {}): FakePerson => ({ cx: 0.5, armL: "down", armR: "down", rgb: RED, ...o });
const handsUp = (o: Partial<FakePerson> = {}): FakePerson => standing({ armL: "up", armR: "up", ...o });

const waitState = (page: Page, s: string, timeout = 90_000) =>
  page.waitForFunction((st) => (window as unknown as Win).__engine?.state === st, s, { timeout });
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as unknown as Win).__mashina!.snapshot());
const until = async (page: Page, expr: (s: Snap) => boolean, timeout = 120_000): Promise<void> => {
  try {
    await page.waitForFunction((src) => {
      const m = (window as unknown as Win).__mashina;
      if (!m) return false;
      return new Function("s", `return (${src})(s)`)(m.snapshot());
    }, expr.toString(), { timeout, polling: 250 });
  } catch (e) {
    const sn = await snap(page).catch(() => null);
    throw new Error(`until(${expr.toString()}) timed out; state: ${JSON.stringify(sn)?.slice(0, 900)} ${String(e).slice(0, 80)}`);
  }
};

function track(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => {
    // (the dev server's HMR socket can drop while the machine is busy: not a game error)
    if (m.type() === "error" && !/_next\/hmr|WebSocket connection/.test(m.text())) problems.push("console.error: " + m.text());
  });
  return problems;
}

interface BootOpts {
  query?: string;
  quality?: "low" | "medium" | "high";
  kids?: boolean;
  person?: Partial<FakePerson>;
  size?: [number, number];
}

/** scan -> ready -> start -> play, then wait for the world + car. */
async function boot(page: Page, o: BootOpts = {}): Promise<void> {
  const [w, h] = o.size ?? [480, 270];
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript(
    ([quality, kids]) => {
      localStorage.setItem("harakat.settings", JSON.stringify({ state: { quality: quality ?? "low", kids: !!kids }, version: 1 }));
      localStorage.removeItem("harakat.mashina");
    },
    [o.quality ?? "low", o.kids ?? false] as const,
  );
  await installFake(page, { people: [handsUp()] });
  await page.goto(`/play/mashina?${o.query ?? "mode=erkin"}`);
  await waitState(page, "ready");
  await setPeople(page, [standing(o.person)]);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play");
  await until(page, (s) => s.ready);
}

test.describe("mashina", () => {
  test("module is registered, world:true, needs legs; texts are Uzbek Latin", async ({ page }) => {
    const problems = track(page);
    await boot(page, { query: "mode=erkin&time=0.45&traffic=0" });
    expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Cyrillic}/u);
    const s = await snap(page);
    expect(s.phase).toBe("driving");
    expect(s.tiles.loaded).toBeGreaterThan(8);
    expect(problems.filter((p) => !/deprecated|Clock/.test(p))).toEqual([]);
  });

  test("controls: raised-leg start, knees = pedals, hands = wheel, reverse after 1.5 s brake, both hands up = camera", async ({ page }) => {
    test.setTimeout(240_000);
    const problems = track(page);
    // the right knee is ALREADY raised when the game starts: the calibration must take the rest height from the standing leg
    await boot(page, { query: "mode=erkin&time=0.45&traffic=0&timescale=4", person: { kneeR: 1 } });
    await until(page, (s) => s.input.gas > 0.6);
    let s = await snap(page);
    expect(s.input.brake).toBeLessThan(0.1);
    await until(page, (s2) => s2.car.speed > 2);
    // putting the leg down releases the gas; the other knee brakes
    await setPeople(page, [standing()]);
    await until(page, (s2) => s2.input.gas < 0.05);
    await setPeople(page, [standing({ kneeL: 1 })]);
    await until(page, (s2) => s2.input.brake > 0.7);
    await until(page, (s2) => s2.car.speed < 0.3, 150_000);
    // brake held at a standstill for 1.5 s -> reverse gear
    await until(page, (s2) => s2.input.reverse, 150_000);
    await setPeople(page, [standing()]);
    await setPeople(page, [standing({ kneeL: 1 })]);
    await setPeople(page, [standing()]);
    // steering: right wrist lower than the left = turn right
    await setPeople(page, [standing({ armL: [0.62, 0.44], armR: [0.38, 0.62] })]);
    await until(page, (s2) => s2.input.steer > 0.3);
    await setPeople(page, [standing({ armL: [0.62, 0.62], armR: [0.38, 0.44] })]);
    await until(page, (s2) => s2.input.steer < -0.3);
    // handbrake: the right wrist is pulled sharply down while the left stays (a pulse of ~0.9 s)
    await setPeople(page, [standing({ armL: [0.62, 0.5], armR: [0.38, 0.5] })]);
    await page.waitForTimeout(500);
    await setPeople(page, [standing({ armL: [0.62, 0.5], armR: [0.38, 0.72] })]);
    await until(page, (s2) => s2.input.handbrake, 30_000);
    await setPeople(page, [standing({ armL: [0.62, 0.5], armR: [0.38, 0.5] })]);
    await until(page, (s2) => !s2.input.handbrake, 60_000);
    // both hands above the head switch the camera
    s = await snap(page);
    const before = s.cam;
    await setPeople(page, [handsUp()]);
    await page.waitForFunction((b) => (window as unknown as Win).__mashina!.snapshot().cam !== b, before, { timeout: 60_000 });
    expect(problems.filter((p) => !/deprecated|Clock/.test(p))).toEqual([]);
  });

  test("pedals: calibration first, the wrong leg never gasses, an occluded knee gives 0, the camera reading is exposed", async ({ page }) => {
    test.setTimeout(240_000);
    const problems = track(page);
    await boot(page, { query: "mode=erkin&time=0.45&traffic=0&timescale=4" });
    await until(page, (s) => s.legs.ready, 90_000);
    // standing on both legs: nothing fires, ever (watch for a while)
    const watch = async (ms: number): Promise<{ gas: number; brake: number }> => {
      const t0 = Date.now();
      let gas = 0;
      let brake = 0;
      while (Date.now() - t0 < ms) {
        const s = await snap(page);
        gas = Math.max(gas, s.input.gas);
        brake = Math.max(brake, s.input.brake);
        await page.waitForTimeout(120);
      }
      return { gas, brake };
    };
    expect((await watch(2500)).gas).toBeLessThan(0.02);
    // the WRONG (left) knee: brake only, gas stays 0, and the camera reading shows it
    await setPeople(page, [standing({ kneeL: 1 })]);
    await until(page, (s) => s.input.brake > 0.7 && s.legs.brakeRaw > 0.8);
    const w = await watch(1800);
    expect(w.gas).toBeLessThan(0.02);
    await setPeople(page, [standing()]);
    await until(page, (s) => s.input.brake < 0.05);
    // right knee: gas; then the knee is lost while it is raised (occlusion): the gas drops to 0 at once and stays 0
    await setPeople(page, [standing({ kneeR: 1 })]);
    await until(page, (s) => s.input.gas > 0.7 && s.legs.gasRaw > 0.8);
    await page.evaluate(() => {
      const w2 = window as unknown as { __fake?: (n: number) => { pose: { landmarks: { visibility: number }[][] } } };
      const f = w2.__fake!;
      w2.__fake = (n: number) => {
        const r = f(n);
        r.pose.landmarks[0][26].visibility = 0.05;
        return r;
      };
    });
    await until(page, (s) => s.input.gas < 0.05 && !s.legs.okGas);
    expect(problems.filter((p) => !/deprecated|Clock/.test(p))).toEqual([]);
  });

  test("menu: left knee cycles, right knee confirms; the chosen mode is used", async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page, { query: "time=0.45&traffic=0" });
    await until(page, (s) => s.phase === "menu");
    // the pedals need their 1 s calibration (both legs down) first
    await until(page, (s) => s.legs.ready, 90_000);
    // left knee up = next mode (erkin -> missiya)
    await setPeople(page, [standing({ kneeL: 1 })]);
    await page.waitForTimeout(1200);
    await setPeople(page, [standing()]);
    await page.waitForTimeout(600);
    for (let i = 0; i < 4; i++) {
      await setPeople(page, [standing({ kneeR: 1 })]);
      await page.waitForTimeout(2200);
      await setPeople(page, [standing()]);
      await page.waitForTimeout(1200);
    }
    await until(page, (s) => s.phase === "driving");
    expect((await snap(page)).mode).toBe("missiya");
  });

  test("free drive: tiles stream along the highway to the drift area without errors; draw calls stay in budget", async ({ page }) => {
    test.setTimeout(300_000);
    const problems = track(page);
    await boot(page, { query: "mode=erkin&time=0.45&traffic=0.4", quality: "low" });
    const stops: [number, number][] = [[300, 181.8], [560, 190], [745, 190], [900, 190], [1100, 180], [1250, 180], [900, 190], [300, 181.8]];
    let released0 = 0;
    for (const [x, z] of stops) {
      await page.evaluate(([a, b]) => (window as unknown as Win).__mashina!.game.debugTeleport(a, b, 1, 0), [x, z]);
      await page.waitForFunction(([a]) => {
        const s = (window as unknown as Win).__mashina!.snapshot();
        return Math.abs(s.car.x - (a as number)) < 30 && s.tiles.pending === 0 && s.tiles.ids.includes(`${Math.floor((a as number) / 120)},1`);
      }, [x], { timeout: 90_000 });
      await page.waitForTimeout(800);
      const stat = await page.evaluate(() => {
        const e = (window as unknown as Win).__engine!;
        return { calls: e.gl.info.render.calls, tris: e.gl.info.render.triangles };
      });
      console.log(`BUDGET low x=${x}: ${stat.calls} calls, ${stat.tris} tris`);
      // low quality budget (TZ 9): <= 80 draw calls
      expect(stat.calls, `draw calls at x=${x}`).toBeLessThanOrEqual(80);
      expect(stat.calls).toBeGreaterThan(5);
      const s = await snap(page);
      expect(s.tiles.loaded).toBeLessThan(40);
      released0 = s.tiles.released;
    }
    expect(released0).toBeGreaterThan(5);
    expect(problems.filter((p) => !/deprecated|Clock/.test(p))).toEqual([]);
  });

  test("draw-call budget: <= 150 on high quality in the busiest places", async ({ page }) => {
    test.setTimeout(300_000);
    await boot(page, { query: "mode=erkin&time=0.45&traffic=1", quality: "high", size: [640, 360] });
    const places: [number, number][] = [[300, 181.8], [180, 181.8], [60, 175], [745, 190]];
    const report: string[] = [];
    for (const [x, z] of places) {
      await page.evaluate(([a, b, c, d]) => (window as unknown as Win).__mashina!.game.debugTeleport(a, b, c, d), [x, z, x < 100 ? 0 : 1, x < 100 ? -1 : 0]);
      await page.waitForFunction(([a]) => {
        const s = (window as unknown as Win).__mashina!.snapshot();
        return Math.abs(s.car.x - (a as number)) < 30 && s.tiles.pending === 0;
      }, [x], { timeout: 120_000 });
      await page.waitForTimeout(1500);
      const stat = await page.evaluate(() => {
        const e = (window as unknown as Win).__engine!;
        return { calls: e.gl.info.render.calls, tris: e.gl.info.render.triangles };
      });
      report.push(`${x},${z}: ${stat.calls} calls, ${stat.tris} tris`);
      expect(stat.calls, report.join(" | ")).toBeLessThanOrEqual(150);
    }
    console.log("BUDGET high:", report.join(" | "));
    test.info().annotations.push({ type: "budget", description: report.join(" | ") });
  });

  test("YHQ exam: the careful driver passes (STOP, zebras, light, give way respected)", async ({ page }) => {
    test.setTimeout(420_000);
    const problems = track(page);
    await boot(page, { query: "mode=imtihon&timescale=5&traffic=0.5&duration=400", size: [480, 270] });
    await installDriver(page, { profile: "careful", route: ["1,2", "0,2", "0,1", "0,0"], speed: 7.5, lag: 1.1 });
    await until(page, (s2) => s2.phase === "over", 380_000);
    const s = await snap(page);
    await waitState(page, "results", 30_000);
    const kinds = s.verdicts.map((v) => v.kind);
    expect(s.exam, JSON.stringify({ kinds, penalty: s.penalty, car: s.car })).not.toBeNull();
    expect(s.exam!.passed, JSON.stringify(kinds)).toBe(true);
    expect(kinds).toContain("stopOk");
    await expect(page.getByTestId("results-overlay")).toContainText("O‘tdi");
    expect(problems.filter((p) => !/deprecated|Clock/.test(p))).toEqual([]);
  });

  test("YHQ exam: the violator (speeds, ignores STOP and lights) fails", async ({ page }) => {
    test.setTimeout(300_000);
    await boot(page, { query: "mode=imtihon&timescale=6&traffic=0.3&duration=300", size: [480, 270] });
    await installDriver(page, { profile: "violator", route: ["1,2", "0,2", "0,1", "0,0"], speed: 21 });
    await until(page, (s2) => s2.phase === "over", 260_000);
    const s = await snap(page);
    await waitState(page, "results", 30_000);
    const kinds = s.verdicts.map((v) => v.kind);
    expect(s.exam?.passed).toBe(false);
    expect(kinds.some((k) => ["stop", "redLight", "speed", "pedestrian", "crash"].includes(k)), JSON.stringify(kinds)).toBe(true);
    await expect(page.getByTestId("results-overlay")).toContainText("O‘tmadi");
  });

  test("rules in free mode: speeding, red light and pedestrians are judged", async ({ page }) => {
    test.setTimeout(300_000);
    await boot(page, { query: "mode=erkin&time=0.45&timescale=6&traffic=0&duration=900", size: [480, 270] });
    // 1) speeding on a city street: 22 m/s (79 km/h) against the 60 km/h limit
    await page.evaluate(() => {
      const g = (window as unknown as Win).__mashina!.game;
      const t = g.L.tiles.get("2,1")!;
      g.debugTeleport(t.cx - 55, t.cz + 1.8, 1, 0);
    });
    await installDriver(page, { profile: "cruise", speed: 22 });
    await until(page, (s) => s.verdicts.some((v) => v.kind === "speed"), 100_000);
    // 2) a red light: stand 60 m south of the junction (1,1) heading north while axis z is red, drive through at 11 m/s
    await page.evaluate(() => {
      const g = (window as unknown as Win).__mashina!.game;
      const t = g.L.tiles.get("1,1")!;
      const len = 37;
      // axis z is red when k = (t + offset + 18.5) mod 37 >= 17: pick t so that k = 21
      const clock = (((21 - t.offset - 18.5) % len) + len) % len;
      g.debugSetClock(clock);
      g.debugTeleport(t.cx + 1.8, t.cz + 70, 0, -1);
    });
    await installDriver(page, { profile: "cruise", speed: 11 });
    await until(page, (s) => s.verdicts.some((v) => v.kind === "redLight"), 100_000);
    // 3) pedestrians on a zebra: the violator keeps going, the careful driver gives way
    const zebra = "z:2,1"; // N-S road, 38 m south of the centre of tile (2,1)
    const place = async (page2: Page): Promise<void> => {
      await page2.evaluate(() => {
        const g = (window as unknown as Win).__mashina!.game;
        const t = g.L.tiles.get("2,1")!;
        g.debugTeleport(t.cx + 1.8, t.cz + 38 + 24, 0, -1);
      });
      // the previous group may still be on the zebra: wait until a new one can start
      await page2.waitForFunction((z) => (window as unknown as Win).__mashina!.game.debugForcePeds(z), zebra, { timeout: 60_000, polling: 300 });
    };
    await place(page);
    await installDriver(page, { profile: "cruise", speed: 5 });
    await until(page, (s) => s.verdicts.some((v) => v.kind === "pedestrian" || v.kind === "pedHit"), 100_000);
    // careful driver: stops and is thanked
    await place(page);
    await installDriver(page, { profile: "careful", speed: 7, lag: 1.1 });
    await until(page, (s) => s.verdicts.filter((v) => v.kind === "pedOk").length > 0, 150_000);
  });

  test("drift mode: handbrake + steering in the drift area gives points", async ({ page }) => {
    test.setTimeout(300_000);
    await boot(page, { query: "mode=drift&car=sport&timescale=6&duration=200&time=0.45", size: [480, 270] });
    await installDriver(page, { profile: "drift", center: [1260, 180], radius: 24 });
    await until(page, (s) => s.drift.total > 20, 200_000);
    const s = await snap(page);
    expect(s.score).toBeGreaterThan(10);
    expect(s.mode).toBe("drift");
  });

  test("missions: reaching the Registon completes the first mission", async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page, { query: "mode=missiya&time=0.45&timescale=6&traffic=0", size: [480, 270] });
    await until(page, (s) => !!s.missions && s.missions.index === 0);
    await page.evaluate(() => (window as unknown as Win).__mashina!.game.debugTeleport(61.8, 100, 0, -1));
    await installDriver(page, { profile: "cruise", speed: 6 });
    await until(page, (s) => !!s.missions && s.missions.completed >= 1, 150_000);
    expect((await snap(page)).missions!.id).toBe("m2");
  });

  test("kids mode: auto gas and a crash does not cost a life", async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page, { query: "mode=erkin&time=0.45&timescale=4&traffic=0", kids: true });
    await until(page, (s) => s.car.speed > 2); // gas is automatic
    // aim at a building and keep going
    await page.evaluate(() => {
      const g = (window as unknown as Win).__mashina!.game;
      const t = g.L.tiles.get("2,1")!;
      g.debugTeleport(t.cx - 40, t.cz + 1.8, 0, 1);
    });
    await installDriver(page, { profile: "cruise", speed: 12 });
    await until(page, (s) => s.crashes > 0, 150_000);
    expect((await snap(page)).lives).toBeGreaterThan(50);
  });
});
