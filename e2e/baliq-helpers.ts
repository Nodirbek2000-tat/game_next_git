import type { Page } from "@playwright/test";
import { installFake, setPeople, type FakePerson } from "./fixtures";

// Helpers of the Baliq ovi e2e tests: page-side autopilot (fake skeleton driven from the game snapshot).

export type Snap = {
  phase: string;
  mode: string;
  timeLeft: number;
  teamKg: number;
  friendBonuses: number;
  warnings: number;
  warnCount: number;
  quality: string;
  water: { passes: boolean };
  view: { yawDeg: number; targetDeg: number; pitchDeg: number; calibrated: boolean; neutral: number; raw: number };
  voice: { offered: boolean; wanted: boolean; status: string; events: number; last: string; ctx: string; label: string };
  render: { calls: number; triangles: number; mainCalls: number; passCalls: number };
  anglers: {
    slot: number; state: string; D: number; strain: number; species: string | null; weight: number; score: number; kg: number; count: number; lost: number; netOffer: boolean;
    sig: { crank: number; armed: boolean; pitch: number; yaw: number }; castDir: number; autoStruck: boolean; fightAng: number; fightRun: boolean;
    float: { x: number; y: number; z: number };
  }[];
  collection: number;
};

export const RED: [number, number, number] = [210, 40, 40];
export const BLUE: [number, number, number] = [40, 80, 220];
export const standing = (o: Partial<FakePerson> = {}): FakePerson => ({ cx: 0.5, armL: "down", armR: "down", rgb: RED, ...o });
export const handsUp = (o: Partial<FakePerson> = {}): FakePerson => standing({ armL: "up", armR: "up", ...o });

export const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as unknown as { __baliq: { snapshot(): Snap } }).__baliq.snapshot());
export const waitState = (page: Page, s: string, timeout = 60_000) =>
  page.waitForFunction((st) => (window as unknown as { __engine?: { state: string } }).__engine?.state === st, s, { timeout });
export const waitSnap = (page: Page, expr: string, timeout = 120_000) =>
  page.waitForFunction(`(() => { const b = window.__baliq; if (!b) return false; const s = b.snapshot(); return ${expr}; })()`, null, { timeout, polling: 200 });

export interface PilotCfg {
  people: FakePerson[];
  /** bystanders: they wave their arms up and down the whole time and must never disturb the game */
  extra?: FakePerson[];
  /** initial settings per player slot (set before the first frame: a late change could look like a flick) */
  slots?: Partial<PilotSlot>[];
}
export interface PilotSlot {
  on: boolean;
  /** cast when the rod is ready */
  cast: boolean;
  /** reel speed in circles/s while fighting */
  reel: number;
  /** help the partner with the net */
  net: boolean;
  /** milliseconds the flick takes (slower = less power) */
  swingMs: number;
}

/** Page-side autopilot. Self-contained (serialised into the page). */
function pilotMain(cfg: PilotCfg): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as unknown as Record<string, any>;
  const base = cfg.people.map((p) => ({ ...p }));
  const slots: PilotSlot[] = cfg.people.map((_, i) => ({ on: true, cast: true, reel: 1.2, net: false, swingMs: 450, ...(cfg.slots?.[i] ?? {}) }));
  w.__pilot = { slots, log: [] as string[] };
  const st = base.map(() => ({ last: "", t0: 0 }));
  const top = 0.12;
  const h = 0.8;
  const upY = top - h * 0.1;
  const hipY = top + h * 0.5;
  // person -> player slot by position (the mirrored camera x decides, the engine may also swap identities)
  const slotFor = (cx: number): number => {
    const eng = w.__engine;
    if (!eng) return 0;
    let best = 0;
    let bd = 1e9;
    eng.players.forEach((pl: { center: { x: number } }, i: number) => {
      const d = Math.abs(pl.center.x - (1 - cx) * eng.stage.w);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const loop = (now: number) => {
    const b = w.__baliq;
    const s = b ? b.snapshot() : null;
    const out: Record<string, unknown>[] = base.map((p, idx) => {
      const o: Record<string, unknown> = { ...p, armL: "down", armR: "down" };
      if (!s || s.phase !== "play") return o;
      const slot = slotFor(p.cx);
      const a = s.anglers[slot];
      const partner = s.anglers[1 - slot];
      const c = slots[slot];
      const m = st[idx];
      if (!a || !c.on) return o;
      if (a.state !== m.last) {
        m.last = a.state;
        m.t0 = now;
        w.__pilot.log.push(`${slot}:${a.state}`);
      }
      const t = now - m.t0;
      const sxR = p.cx - 0.08;
      const sxL = p.cx + 0.08;
      if (c.cast && a.state === "ready") {
        if (t < 1000) o.armR = "up";
        else if (t < 1000 + c.swingMs) o.armR = [sxR - 0.03, upY + ((t - 1000) / c.swingMs) * (hipY - upY)];
        else if (t > 3500) m.t0 = now;
      } else if (a.state === "bite") {
        // a sharp jerk up (beyond the frame: headless frames are slow, the speed is distance / real time)
        o.armR = [sxR - 0.03, -0.35];
      } else if (a.state === "fight") {
        let rate = c.reel;
        if (a.strain > 0.8) rate = 0;
        else if (a.netOffer) rate = Math.min(rate, 0.5);
        if (rate > 0) {
          const ang = (now / 1000) * Math.PI * 2 * rate;
          o.armL = [sxL + 0.02 + 0.075 * Math.cos(ang), 0.46 + 0.075 * Math.sin(ang)];
        }
      }
      // landing net for the partner: both hands down, then both up
      if (c.net && partner && partner.state === "fight" && partner.netOffer && a.state !== "fight") {
        const ph = (now % 2200) / 2200;
        if (ph < 0.4) {
          o.armL = "down";
          o.armR = "down";
        } else if (ph < 0.75) {
          o.armL = "up";
          o.armR = "up";
        }
      }
      return o;
    });
    for (const e of cfg.extra ?? []) {
      const up = Math.floor(now / 400) % 2 === 0;
      out.push({ ...e, armL: up ? "up" : "down", armR: up ? "down" : "up" });
    }
    w.__scene.people = out;
    requestAnimationFrame(loop);
  };
  // the bystander gets his own clothing colour (as in the engine's own scan tests)
  w.__scene.people = [...cfg.people, ...(cfg.extra ?? [])];
  w.__refreshSmall?.();
  requestAnimationFrame(loop);
}

export const startPilot = (page: Page, cfg: PilotCfg) => page.evaluate(pilotMain, cfg);
export const setPilot = (page: Page, slot: number, patch: Partial<PilotSlot>) =>
  page.evaluate(([s, p]) => Object.assign((window as unknown as { __pilot: { slots: unknown[] } }).__pilot.slots[s as number] as object, p), [slot, patch] as const);

/** Mock of the browser's on-device speech recogniser (Chrome SpeechRecognition with processLocally). */
export function installFakeRecognizer(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__sr = { starts: 0, local: null as boolean | null, inst: null, avail: 0 };
  class FakeSR {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    static available(): Promise<string> {
      w.__sr.avail++;
      return Promise.resolve("available");
    }
    start(): void {
      w.__sr.starts++;
      w.__sr.local = (this as unknown as { processLocally: boolean }).processLocally;
      w.__sr.inst = this;
    }
    stop(): void {}
    abort(): void {}
  }
  Object.defineProperty(FakeSR.prototype, "processLocally", { value: false, writable: true });
  w.SpeechRecognition = FakeSR;
  w.webkitSpeechRecognition = FakeSR;
  /** say(text, idx): what a recogniser sends: a growing interim transcript of result number idx */
  w.__say = (text: string, idx = 0): void => {
    const inst = w.__sr.inst;
    if (!inst?.onresult) return;
    const results: unknown[] = [];
    for (let i = 0; i <= idx; i++) results.push(Object.assign([{ transcript: i === idx ? text : "" }], { isFinal: false }));
    inst.onresult({ resultIndex: idx, results });
  };
}

/** A fake microphone: a tone that is silent until window.__shout(ms) (for the loudness fallback). */
export function installFakeMic(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  // the recogniser does not exist here: the game must fall back to the loudness detector
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
  w.__mic = { asked: 0 };
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = (c?: MediaStreamConstraints) => {
    if (c && c.audio) {
      w.__mic.asked++;
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      gain.gain.value = 0;
      const dest = ac.createMediaStreamDestination();
      osc.frequency.value = 220;
      osc.connect(gain).connect(dest);
      osc.start();
      void ac.resume();
      w.__shout = (ms: number): void => {
        gain.gain.value = 0.6;
        setTimeout(() => (gain.gain.value = 0), ms);
      };
      return Promise.resolve(dest.stream);
    }
    return orig(c);
  };
}

export async function openGame(page: Page, query: string, people: FakePerson[], settings: Record<string, unknown> = {}, init?: () => void): Promise<void> {
  await page.setViewportSize({ width: 640, height: 360 });
  // the pre-start options screen is skipped unless a test asks for it (opts=1)
  if (!/(^|&)opts=/.test(query)) query += "&opts=0";

  if (Object.keys(settings).length) await page.addInitScript((s) => localStorage.setItem("harakat.settings", JSON.stringify({ state: s, version: 1 })), settings);
  await installFake(page, { people: people.map((p) => ({ ...p })) });
  if (init) await page.addInitScript(init);
  await page.goto(`/play/baliq-ovi?${query}`);
  await waitState(page, "scan");
  await setPeople(page, people.map((p) => ({ ...p, armL: "up", armR: "up" })));
  await waitState(page, "ready");
  await setPeople(page, people);
  await page.getByTestId("start-btn").click();
  await waitState(page, "play", 90_000);
  await waitSnap(page, "s.phase !== 'none'");
}

export const errorsOf = (page: Page): string[] => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Download the React DevTools|favicon/.test(m.text())) problems.push("console.error: " + m.text());
  });
  return problems;
};

export const eng = (page: Page, expr: string) => page.evaluate(`(() => { const e = window.__engine; return ${expr}; })()`);

