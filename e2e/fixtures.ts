import type { Page } from "@playwright/test";
import { makeSkeleton, makeSmallFrame } from "../engine/testing/skeleton";

export interface FakePerson {
  cx: number;
  top?: number;
  h?: number;
  armL?: "up" | "down" | "shoulder" | [number, number];
  armR?: "up" | "down" | "shoulder" | [number, number];
  kneeL?: number;
  kneeR?: number;
  legsVisible?: boolean;
  rgb?: [number, number, number];
}

/** Everything the browser needs to fake a camera + MediaPipe results (same semantics as the prototype's window.__fake). */
function fakeInit(args: { mode: "ok" | "denied" | "none"; people: FakePerson[]; mk: string; mkSmall: string }): void {
  const w = window as unknown as Record<string, unknown>;
  const mk = new Function(`return (${args.mk})`)() as (o: unknown) => unknown;
  const mkSmall = new Function(`return (${args.mkSmall})`)() as (p: unknown) => Uint8ClampedArray;
  const md = navigator.mediaDevices;
  if (args.mode === "denied") {
    md.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  } else {
    md.getUserMedia = () => {
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const x = c.getContext("2d")!;
      const draw = () => {
        x.fillStyle = `hsl(${(Date.now() / 40) % 360},35%,32%)`;
        x.fillRect(0, 0, 1280, 720);
      };
      draw();
      setInterval(draw, 33);
      return Promise.resolve(c.captureStream(30));
    };
  }
  const scene = { people: args.people, auto: false, t0: 0 };
  w.__scene = scene;
  const refreshSmall = () => {
    const withColor = scene.people.filter((p) => p.rgb).map((p) => ({ cx: p.cx, top: p.top ?? 0.12, h: p.h ?? 0.8, rgb: p.rgb! }));
    w.__smallFixed = withColor.length ? mkSmall(withColor) : undefined;
  };
  w.__refreshSmall = refreshSmall;
  refreshSmall();
  if (args.mode !== "none") {
    w.__fake = (now: number) => {
      const lms = scene.people.map((p, i) => {
        const o: Record<string, unknown> = { ...p };
        if (scene.auto && i === 0) {
          // autopilot: both hands zig-zag fast across the whole play area (cuts fruit)
          const t = (now - (scene.t0 || (scene.t0 = now))) / 1000;
          o.armR = [0.5 + 0.34 * Math.sin(t * 7.1), 0.5 + 0.24 * Math.cos(t * 5.3)];
          o.armL = [0.5 + 0.34 * Math.sin(t * 6.1 + 2), 0.5 + 0.24 * Math.cos(t * 4.7 + 1)];
        }
        return mk(o);
      });
      return { pose: { landmarks: lms }, hand: null };
    };
  }
}

export interface InstallOptions {
  mode?: "ok" | "denied" | "none";
  people?: FakePerson[];
}

export async function installFake(page: Page, opts: InstallOptions = {}): Promise<void> {
  await page.addInitScript(fakeInit, {
    mode: opts.mode ?? "ok",
    people: opts.people ?? [{ cx: 0.5, armL: "down", armR: "down", rgb: [200, 40, 40] }],
    mk: makeSkeleton.toString(),
    mkSmall: makeSmallFrame.toString(),
  });
}

/** Update the people of the fake scene from the test. */
export async function setPeople(page: Page, people: FakePerson[]): Promise<void> {
  await page.evaluate((p) => {
    const w = window as unknown as { __scene: { people: unknown[] }; __refreshSmall: () => void };
    w.__scene.people = p;
    w.__refreshSmall();
  }, people);
}

export async function setAuto(page: Page, on: boolean): Promise<void> {
  await page.evaluate((v) => {
    (window as unknown as { __scene: { auto: boolean } }).__scene.auto = v;
  }, on);
}
