import { expect, test } from "@playwright/test";
import { BLUE, RED, eng, errorsOf, handsUp, installFakeMic, installFakeRecognizer, openGame, setPilot, snap, standing, startPilot, waitSnap, waitState } from "./baliq-helpers";
import { installFake, setPeople } from "./fixtures";

// Baliq ovi e2e (see baliq-helpers.ts for the autopilot). Headless software GL renders only a few frames per second and the
// game clock advances at most 50 ms per frame, so game time runs slower than real time: everything polls generously, and
// the tests shorten the clock through window.__baliq.rig where waiting for the real timer would only waste minutes.

const GAME = "collection=0&wait=0.15&maxcast=13&tod=day&rain=0&wind=0.3";
/** more sensitive gestures: the slow frames of the headless run make hand speeds look lower than on a real camera */
const SENS = { sensitivity: 1.5 };

const endSoon = (page: import("@playwright/test").Page) => page.evaluate(() => ((window as unknown as { __baliq: { rig: { timeLeft: number } } }).__baliq.rig.timeLeft = 2));

test.describe("Baliq ovi", () => {
  test("solo: cast -> wait -> nibble -> bite -> strike -> fight -> land -> results, collection saved, nothing leaks", async ({ page }) => {
    test.setTimeout(600_000);
    const problems = errorsOf(page);
    await openGame(page, `duration=600&fish=forel&${GAME}`, [standing()], SENS);
    const s0 = await snap(page);
    expect(s0.mode).toBe("yolgiz");
    expect(s0.phase).toBe("play");
    await startPilot(page, { people: [standing()] });

    // the whole flow happens, in order
    await waitSnap(page, "s.anglers[0].count >= 1", 420_000);
    const log = (await page.evaluate(() => (window as unknown as { __pilot: { log: string[] } }).__pilot.log)).map((l) => l.split(":")[1]);
    const order = ["ready", "fly", "wait", "nibble", "bite", "fight", "show"];
    let from = 0;
    for (const st of order) {
      const i = log.indexOf(st, from);
      expect(i, `state ${st} reached in order (log: ${log.join(">")})`).toBeGreaterThanOrEqual(from);
      from = i;
    }
    const s1 = await snap(page);
    expect(s1.anglers[0].kg).toBeGreaterThan(0.3);
    expect(s1.anglers[0].score).toBeGreaterThan(0);
    await expect.poll(async () => Number(await page.getByTestId("hud-score").textContent())).toBeGreaterThan(0);

    // end of the game: stop casting and let the (shortened) timer run out
    await setPilot(page, 0, { cast: false });
    await endSoon(page);
    await waitState(page, "results", 300_000);
    await expect(page.getByTestId("results-overlay")).toBeVisible();
    await expect(page.getByTestId("results-overlay")).toContainText("Tutilgan baliqlar");
    await expect(page.getByTestId("results-overlay")).toContainText("Jami og‘irlik");
    expect(Number(await page.getByTestId("result-score").textContent())).toBeGreaterThan(0);
    // the trout is in the encyclopedia (localStorage)
    const col = await page.evaluate(() => JSON.parse(localStorage.getItem("harakat.baliq-ovi.collection") ?? "{}"));
    expect(col.forel.count).toBeGreaterThanOrEqual(1);
    expect(col.forel.record).toBeGreaterThan(0.3);
    // dispose: nothing of the lake stays in GPU memory once the scene is gone
    await expect.poll(async () => Number(await eng(page, "e.gl.info.memory.geometries")), { timeout: 8000 }).toBe(0);
    expect(Number(await eng(page, "e.gl.info.memory.textures"))).toBeLessThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test("solo: end screen shows the encyclopedia, Enter continues to the results", async ({ page }) => {
    test.setTimeout(300_000);
    const problems = errorsOf(page);
    await page.addInitScript(() =>
      localStorage.setItem("harakat.baliq-ovi.collection", JSON.stringify({ sazan: { count: 2, record: 3.4, first: 1 }, forel: { count: 1, record: 1.1, first: 1 } })),
    );
    await openGame(page, "duration=600&wait=0.2", [standing()]);
    await endSoon(page);
    await waitSnap(page, "s.phase === 'collection'", 120_000);
    expect((await snap(page)).collection).toBe(2);
    await page.keyboard.press("Enter");
    await waitState(page, "results", 60_000);
    await expect(page.getByTestId("results-overlay")).toContainText("Kolleksiya");
    expect(problems).toEqual([]);
  });

  test("two players: the mode (Birgalikda / Musobaqa) is chosen in a lobby before the game starts", async ({ page }) => {
    test.setTimeout(300_000);
    const people = [standing({ cx: 0.3, rgb: BLUE }), standing({ cx: 0.7, rgb: RED })];
    await openGame(page, "players=2&duration=100", people);
    expect((await snap(page)).phase).toBe("lobby");
    // nothing runs in the lobby: the clock stands still
    const t0 = (await snap(page)).timeLeft;
    await page.waitForTimeout(1500);
    expect((await snap(page)).phase).toBe("lobby");
    expect((await snap(page)).timeLeft).toBe(t0);
    await page.keyboard.press("2");
    await waitSnap(page, "s.phase === 'play'");
    const s = await snap(page);
    expect(s.mode).toBe("musobaqa");
    expect(s.anglers).toHaveLength(2);
    // separate HUDs for the two players
    await expect(page.locator(".hk-pl.p0")).toContainText("1-o‘yinchi");
    await expect(page.locator(".hk-pl.p1")).toContainText("2-o‘yinchi");
  });

  test("two players co-op: partner warning when the line turns red, landing-net help gives the friendship bonus, a waving bystander is ignored", async ({ page }) => {
    test.setTimeout(600_000);
    const problems = errorsOf(page);
    const people = [standing({ cx: 0.3, rgb: BLUE }), standing({ cx: 0.7, rgb: RED })];
    // kids mode: a red line does not snap (keeps this test deterministic)
    await openGame(page, `players=2&mode=birgalikda&goal=15&duration=600&fish=laqqa&${GAME}`, people, { kids: true, ...SENS });
    const s0 = await snap(page);
    expect(s0.mode).toBe("birgalikda");
    // player 1 = the person on the screen left (camera x 0.7); a bystander keeps waving next to them
    await startPilot(page, {
      people,
      extra: [handsUp({ cx: 0.5, h: 0.4, top: 0.4, rgb: [40, 190, 80] })],
      slots: [{ cast: true, reel: 1.0 }, { cast: false, net: true }],
    });

    // 1) player 1 hooks a fish and it surges: the line turns red -> "Ehtiyot bo'l!" for player 2 (voice hook + counter).
    //    (Real reeling at 3-10 fps cannot reach red reliably, so the surge is injected into the fight model.)
    await waitSnap(page, "s.anglers[0].state === 'fight'", 420_000);
    await page.evaluate(() => {
      const rig = (window as unknown as { __baliq: { rig: { anglers: { fight: { T: number } | null }[] } } }).__baliq.rig;
      const t0 = performance.now();
      const id = setInterval(() => {
        const f = rig.anglers[0].fight;
        if (f) f.T = 2.2;
        if (performance.now() - t0 > 2500) clearInterval(id);
      }, 25);
    });
    await waitSnap(page, "s.anglers[0].strain > 0.85", 120_000);
    await waitSnap(page, "s.warnCount >= 1 && s.warnings >= 1", 60_000);
    // 2) the fish comes within 5 m, the friend raises the net -> immediate landing + "Do'stlik bonusi"
    await waitSnap(page, "s.friendBonuses >= 1", 420_000);
    const s1 = await snap(page);
    expect(s1.anglers[0].count + s1.anglers[1].count).toBeGreaterThanOrEqual(1);
    expect(s1.anglers[0].score).toBeGreaterThanOrEqual(200);
    expect(s1.teamKg).toBeGreaterThan(1);
    expect(s1.anglers[1].count).toBe(0); // the friend only helped, player 2 never cast
    // the bystander is not a player
    expect(await eng(page, "e.players.length")).toBe(2);
    expect(problems).toEqual([]);
  });

  test("competition: the heavier basket wins and the winner is announced", async ({ page }) => {
    test.setTimeout(600_000);
    const problems = errorsOf(page);
    const people = [standing({ cx: 0.3, rgb: BLUE }), standing({ cx: 0.7, rgb: RED })];
    await openGame(page, `players=2&mode=musobaqa&duration=600&fish=forel&${GAME}`, people, SENS);
    expect((await snap(page)).mode).toBe("musobaqa");
    // only player 1 fishes; player 2 stands still
    await startPilot(page, { people, slots: [{}, { on: false }] });
    await waitSnap(page, "s.anglers[0].count >= 1", 420_000);
    await setPilot(page, 0, { cast: false });
    await endSoon(page);
    await waitState(page, "results", 300_000);
    const text = await page.getByTestId("results-overlay").innerText();
    expect(text.toLowerCase()).toContain("g‘olib");
    expect(text).toContain("1-o‘yinchi");
    expect(problems).toEqual([]);
  });

  test("left-handed mode swaps the hands (the left wrist casts)", async ({ page }) => {
    test.setTimeout(300_000);
    await openGame(page, `duration=600&fish=forel&${GAME}`, [standing()], { leftHanded: true, ...SENS });
    expect(await eng(page, "e.players[0].dominant")).toBe("L");
    // raise the LEFT hand, then flick it down
    const p = standing();
    await setPeople(page, [{ ...p, armL: "up" }]);
    await page.waitForTimeout(2500);
    await setPeople(page, [{ ...p, armL: [p.cx + 0.1, 0.5] }]);
    await waitSnap(page, "s.anglers[0].state !== 'ready'", 90_000);
    // (the cast happened; with the very short waiting time the fish may already have bitten and escaped again)
  });

  test("draw calls and triangles stay inside the budget (low: <= 80 calls)", async ({ page }) => {
    test.setTimeout(300_000);
    await openGame(page, "duration=600&players=2&mode=birgalikda&tod=day&rain=1", [standing({ cx: 0.3, rgb: BLUE }), standing({ cx: 0.7, rgb: RED })]);
    await page.waitForTimeout(1500);
    const s = await snap(page);
    console.log(`BALIQ low (2 players, rain): ${s.render.calls} draw calls, ${s.render.triangles} triangles (quality ${s.quality})`);
    expect(s.quality).toBe("low");
    expect(s.render.calls).toBeLessThanOrEqual(80);
    expect(s.render.triangles).toBeLessThan(150_000);
    expect(s.water.passes).toBe(false);
  });

  test("high quality: reflection + refraction passes are active and the budget (<= 150 calls) holds", async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 480, height: 270 });
    await page.addInitScript(() => localStorage.setItem("harakat.settings", JSON.stringify({ state: { quality: "high" }, version: 1 })));
    await installFake(page, { people: [standing({ cx: 0.3, rgb: BLUE }), standing({ cx: 0.7, rgb: RED })] });
    await page.goto("/play/baliq-ovi?players=2&mode=birgalikda&duration=600&tod=sunset&rain=1");
    await waitState(page, "scan");
    await setPeople(page, [handsUp({ cx: 0.3, rgb: BLUE }), handsUp({ cx: 0.7, rgb: RED })]);
    await waitState(page, "ready");
    await setPeople(page, [standing({ cx: 0.3, rgb: BLUE }), standing({ cx: 0.7, rgb: RED })]);
    await page.getByTestId("start-btn").click();
    await waitState(page, "play", 400_000);
    await waitSnap(page, "s.render.passCalls > 0", 120_000);
    const s = await snap(page);
    console.log(`BALIQ high (2 players, rain): ${s.render.calls} draw calls (${s.render.mainCalls} main + ${s.render.passCalls} reflection/refraction), ${s.render.triangles} triangles`);
    expect(s.quality).toBe("high");
    expect(s.water.passes).toBe(true);
    expect(s.render.calls).toBeLessThanOrEqual(150);
  });

  test("the game is registered and its texts are Uzbek Latin only", async ({ page }) => {
    await page.goto("/play/baliq-ovi");
    await expect(page.getByTestId("play-notice")).toHaveCount(0);
    const cyrillic = new RegExp("[" + String.fromCharCode(0x400) + "-" + String.fromCharCode(0x4ff) + "]");
    expect(await page.locator("body").innerText()).not.toMatch(cyrillic);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const hold = async (page: import("@playwright/test").Page, key: string, until: string, timeout = 90_000) => {
  await page.keyboard.down(key);
  try {
    await waitSnap(page, until, timeout);
  } finally {
    await page.keyboard.up(key);
  }
};

test.describe("Baliq ovi: first person and kids voice", () => {
  test("first person: eye-level camera; the view turns with the head and the arrow keys; the cast flies in an arc over the water to where you look", async ({ page }) => {
    test.setTimeout(400_000);
    const problems = errorsOf(page);
    await openGame(page, `duration=600&fish=forel&${GAME}`, [standing()], SENS);
    const cam = await page.evaluate(() => {
      const c = (window as any).__baliq.rig.camera;
      return { y: c.position.y, fov: c.fov };
    });
    expect(cam.y).toBeGreaterThan(2);
    expect(cam.y).toBeLessThan(2.6);
    await waitSnap(page, "s.view.calibrated", 90_000);
    // head turn (the nose moves against the ears): left and right, then back to the dead zone
    await page.evaluate(() => {
      const w = window as any;
      const f = w.__fake;
      w.__head = 0;
      w.__fake = (now: number) => {
        const r = f(now);
        for (const p of r.pose.landmarks) p[0].x += w.__head;
        return r;
      };
    });
    await page.evaluate(() => ((window as any).__head = 0.05)); // un-mirrored picture: + = the user's left
    await waitSnap(page, "s.view.yawDeg < -20", 90_000);
    const yawCam = await page.evaluate(() => ({ ry: (window as any).__baliq.rig.camera.rotation.y, yaw: (window as any).__baliq.rig.viewYaw }));
    expect(yawCam.ry).toBeCloseTo(-yawCam.yaw, 1);
    await page.evaluate(() => ((window as any).__head = -0.05));
    await waitSnap(page, "s.view.yawDeg > 20", 90_000);
    await page.evaluate(() => ((window as any).__head = 0));
    await waitSnap(page, "Math.abs(s.view.yawDeg) < 6", 90_000);
    // keyboard: the arrows turn the view left (and it stays there)
    await hold(page, "ArrowLeft", "s.view.yawDeg < -25");
    // watch the flight of the float
    await page.evaluate(() => {
      const w = window as any;
      w.__fly = { maxY: -9, startY: null as number | null, n: 0 };
      const loop = () => {
        const a = w.__baliq?.rig.anglers[0];
        if (a && a.state === "fly") {
          w.__fly.n++;
          w.__fly.maxY = Math.max(w.__fly.maxY, a.fy);
          if (w.__fly.startY === null) w.__fly.startY = a.fy;
        }
        requestAnimationFrame(loop);
      };
      loop();
    });
    await hold(page, "e", "s.anglers[0].state !== 'ready'");
    await waitSnap(page, "s.anglers[0].state === 'wait' || s.anglers[0].state === 'nibble' || s.anglers[0].state === 'bite'", 90_000);
    const s = await snap(page);
    const fly = await page.evaluate(() => (window as any).__fly);
    expect(s.anglers[0].castDir).toBeLessThan(-0.3); // cast towards the left side of the lake
    expect(s.anglers[0].D).toBeGreaterThan(5);
    expect(s.anglers[0].float.x).toBeLessThan(-2);
    expect(Math.abs(s.anglers[0].float.y)).toBeLessThan(0.7); // lies on the water
    expect(fly.n).toBeGreaterThan(2);
    expect(fly.maxY).toBeGreaterThan(fly.startY + 1); // an arc: it rose above the rod tip
    // the camera pitch eased towards the float (looking a little down)
    expect(s.view.pitchDeg).toBeLessThan(0);
    expect(problems).toEqual([]);
  });

  test("kids voice: options screen (default ON), on-device recogniser only, fish casts, the game strikes for the child, pull reels", async ({ page }) => {
    test.setTimeout(600_000);
    const problems = errorsOf(page);
    await openGame(page, `opts=1&duration=600&fish=forel&${GAME}`, [standing()], { kids: true, ...SENS }, installFakeRecognizer);
    const s0 = await snap(page);
    expect(s0.phase).toBe("options");
    expect(s0.voice.offered).toBe(true);
    expect(s0.voice.wanted).toBe(true); // kids: default ON
    // nothing is asked / started before the player presses start
    expect(await page.evaluate(() => (window as any).__sr.starts)).toBe(0);
    // the option can be turned off and on again
    await hold(page, "v", "s.voice.wanted === false");
    await hold(page, "v", "s.voice.wanted === true");
    await hold(page, "Enter", "s.phase === 'play'");
    await waitSnap(page, "s.voice.status === 'keywords'", 60_000);
    const sr = await page.evaluate(() => (window as any).__sr);
    expect(sr.starts).toBe(1);
    expect(sr.local).toBe(true); // on-device only
    // "fish fish fish" casts
    expect((await snap(page)).anglers[0].state).toBe("ready");
    await page.evaluate(() => (window as any).__say("fish fish fish", 0));
    await waitSnap(page, "s.anglers[0].state !== 'ready'", 120_000);
    expect((await snap(page)).voice.events).toBe(3);
    // the bite comes, the game strikes for the child
    await waitSnap(page, "s.anglers[0].state === 'fight'", 420_000);
    expect((await snap(page)).anglers[0].autoStruck).toBe(true);
    // "pull pull" reels (the hand is not moving: the reel can only come from the voice)
    await page.evaluate(() => (window as any).__say("pull pull", 1));
    await waitSnap(page, "s.anglers[0].sig.crank > 1 || s.anglers[0].state !== 'fight'", 60_000);
    expect(problems).toEqual([]);
  });

  test("voice option: off by default for adults, then no recogniser and no microphone is ever started", async ({ page }) => {
    test.setTimeout(300_000);
    await openGame(page, `opts=1&duration=600&${GAME}`, [standing()], { ...SENS }, installFakeRecognizer);
    const s0 = await snap(page);
    expect(s0.phase).toBe("options");
    expect(s0.voice.wanted).toBe(false);
    await hold(page, "Enter", "s.phase === 'play'");
    await page.waitForTimeout(1500);
    const s1 = await snap(page);
    expect(s1.voice.status).toBe("off");
    expect(await page.evaluate(() => (window as any).__sr.starts)).toBe(0);
  });

  test("kids voice without a recogniser: the loudness detector - repeated shouts cast, the microphone is asked only now", async ({ page }) => {
    test.setTimeout(400_000);
    const problems = errorsOf(page);
    await openGame(page, `opts=1&duration=600&fish=forel&${GAME}`, [standing()], { kids: true, ...SENS }, installFakeMic);
    expect(await page.evaluate(() => (window as any).__mic.asked)).toBe(0);
    await hold(page, "Enter", "s.phase === 'play'");
    await waitSnap(page, "s.voice.status === 'loudness'", 60_000);
    expect(await page.evaluate(() => (window as any).__mic.asked)).toBe(1);
    // the room is quiet for a moment (the detector learns the noise floor), then shouts with pauses
    await page.waitForTimeout(2500);
    for (let k = 0; k < 5; k++) {
      await page.evaluate(() => (window as any).__shout(400));
      await page.waitForTimeout(700);
      await page.evaluate(() => (window as any).__shout(400));
      await page.waitForTimeout(2500);
      if ((await snap(page)).anglers[0].state !== "ready") break;
    }
    await waitSnap(page, "s.anglers[0].state !== 'ready'", 120_000);
    expect((await snap(page)).voice.events).toBeGreaterThanOrEqual(2);
    expect(problems).toEqual([]);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
