import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CalibrationAnalyzer } from "./calibration/calibration";
import { classifyCameraError } from "./camera/camera";
import { detectEnvFrom } from "./camera/env";
import { permissionGuide, type CameraProblem } from "./camera/guides";
import { DEFAULT_CONFIG, makeConfig } from "./config";
import { mkPeople } from "./testing/helpers";
import { makeSmallFrame } from "./testing/skeleton";
import { meanLuma } from "./tracking/people";

const UA = {
  android: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  telegram: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 Telegram-Android/10.0",
};

describe("environment detection + permission guides", () => {
  it("detects platforms", () => {
    expect(detectEnvFrom({ ua: UA.android }).android).toBe(true);
    expect(detectEnvFrom({ ua: UA.iphone }).ios).toBe(true);
    expect(detectEnvFrom({ ua: UA.mac }).mac).toBe(true);
    expect(detectEnvFrom({ ua: UA.win }).win).toBe(true);
    expect(detectEnvFrom({ ua: UA.mac, platform: "MacIntel", maxTouchPoints: 5 }).ios).toBe(true); // iPadOS
  });
  it("detects in-app browsers and file viewers", () => {
    expect(detectEnvFrom({ ua: UA.telegram }).inApp).toBe(true);
    expect(detectEnvFrom({ ua: UA.win }).inApp).toBe(false);
    expect(detectEnvFrom({ ua: UA.android, protocol: "content:" }).viewer).toBe(true);
    expect(detectEnvFrom({ ua: UA.android, protocol: "file:" }).viewer).toBe(true);
    expect(detectEnvFrom({ ua: UA.win, protocol: "file:" }).viewer).toBe(false);
  });
  it("device specific texts for a denied permission", () => {
    const t = (ua: string) => permissionGuide("denied", detectEnvFrom({ ua })).steps.join(" ");
    expect(t(UA.iphone)).toContain("Safari");
    expect(t(UA.android)).toContain("Ruxsatlar");
    expect(t(UA.mac)).toContain("Tizim sozlamalari");
    expect(t(UA.win)).toContain("Windows");
  });
  it("classifies camera errors", () => {
    const env = detectEnvFrom({ ua: UA.win });
    expect(classifyCameraError({ name: "NotAllowedError" }, env)).toBe("denied");
    expect(classifyCameraError({ name: "NotAllowedError" }, detectEnvFrom({ ua: UA.telegram }))).toBe("inapp");
    expect(classifyCameraError({ name: "NotAllowedError" }, detectEnvFrom({ ua: UA.android, protocol: "content:" }))).toBe("viewer");
    expect(classifyCameraError({ name: "NotFoundError" }, env)).toBe("nocam");
    expect(classifyCameraError({ name: "NotReadableError" }, env)).toBe("busy");
    expect(classifyCameraError(new Error("x"), env)).toBe("unknown");
  });
});

describe("calibration", () => {
  const a = new CalibrationAnalyzer(DEFAULT_CONFIG.calibration, true);
  it("healthy full-body player in a bright room", () => {
    const [p] = mkPeople([{ h: 0.8, top: 0.1 }]);
    const r = a.analyze(p, 0.5);
    expect(r).toMatchObject({ fullBody: "ok", light: "ok", distance: "ok", ok: true, message: "" });
  });
  it("dark room", () => {
    const [p] = mkPeople([{}]);
    const r = a.analyze(p, 0.05);
    expect(r.light).toBe("dark");
    expect(r.message).toBe("Xona qorong‘i, chiroqni yoqing");
    expect(r.ok).toBe(false);
  });
  it("feet out of the frame: tells the player to step back (legs needed)", () => {
    const [p] = mkPeople([{ top: 0.2, h: 1.0 }]);
    const r = a.analyze(p, 0.5);
    expect(r.fullBody).toBe("cut");
    expect(r.message).toContain("orqaroq");
  });
  it("too far", () => {
    const [p] = mkPeople([{ top: 0.35, h: 0.35 }]);
    expect(a.analyze(p, 0.5).distance).toBe("far");
  });
  it("meanLuma reads a synthetic frame", () => {
    expect(meanLuma({ data: makeSmallFrame([]) })).toBeCloseTo(60 / 255, 1);
    expect(meanLuma(null)).toBeNull();
  });
});

describe("config", () => {
  it("sensitivity scales the gesture thresholds, defaults are the prototype values", () => {
    expect(makeConfig().gestures.swipeSpeed).toBe(1);
    expect(makeConfig({}, 1.5).gestures.swipeSpeed).toBeLessThan(1);
    expect(makeConfig({}, 0.5).gestures.swipeSpeed).toBeGreaterThan(1);
    expect(makeConfig({ blade: { dropoutMs: 200 } }).blade.dropoutMs).toBe(200);
    expect(makeConfig().blade.dropoutMs).toBe(140);
    expect(makeConfig().lock.scanHoldSec).toBe(1.4);
  });
});

describe("texts", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f === "node_modules" || f === ".next") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js)$/.test(f)) files.push(p);
    }
  };
  for (const d of ["engine", "games", "app/play", "app/(site)/sozlamalar", "e2e"]) walk(join(process.cwd(), d));
  it("contains no Cyrillic letters (Uzbek Latin only)", () => {
    const bad = files.filter((f) => new RegExp("[\u0400-\u04FF]").test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
  it("every camera problem has a guide", () => {
    const kinds: CameraProblem[] = ["denied", "nocam", "busy", "noapi", "viewer", "inapp", "insecure", "unknown"];
    for (const k of kinds) expect(permissionGuide(k, detectEnvFrom({ ua: UA.win })).steps.length).toBeGreaterThan(0);
  });
});
