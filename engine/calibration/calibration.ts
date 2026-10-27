import type { EngineConfig } from "../config";
import type { NormLm, Person } from "../types";

export type FullBodyState = "ok" | "cut" | "unknown";
export type LightState = "ok" | "dark" | "bright" | "unknown";
export type DistanceState = "ok" | "near" | "far" | "unknown";

export interface CalibrationReport {
  fullBody: FullBodyState;
  light: LightState;
  distance: DistanceState;
  /** the most important problem as a sentence ("" when everything is fine) */
  message: string;
  /** every check is fine */
  ok: boolean;
}

/** Normalised (camera image) height of the visible body: from the nose to the lowest visible ankle/foot. */
export function bodyHeightFrac(norm: NormLm[]): number | null {
  const v = (i: number): boolean => (norm[i]?.visibility ?? 1) > 0.4;
  const nose = norm[0];
  if (!nose) return null;
  const low = [27, 28, 31, 32].filter(v).map((i) => norm[i].y);
  if (!low.length) return null;
  return Math.max(...low) - nose.y;
}

/**
 * Start-up calibration (10 s window): is the whole body in the frame, is the room bright enough and
 * how far is the player. The checks are advisory; the flow never blocks forever (see `totalSec`).
 */
export class CalibrationAnalyzer {
  constructor(
    private cfg: EngineConfig["calibration"],
    private needsLegs: boolean,
  ) {}

  analyze(player: Person | null, luma: number | null): CalibrationReport {
    const c = this.cfg;
    let light: LightState = "unknown";
    if (luma !== null) light = luma < c.darkLuma ? "dark" : luma > c.brightLuma ? "bright" : "ok";

    let fullBody: FullBodyState = "unknown";
    let distance: DistanceState = "unknown";
    if (player) {
      const n = player.norm;
      const vis = (i: number): boolean => (n[i]?.visibility ?? 1) > 0.5;
      const inFrame = (i: number): boolean => n[i].x > c.edgeMargin && n[i].x < 1 - c.edgeMargin && n[i].y > c.edgeMargin && n[i].y < 1 - c.edgeMargin;
      const head = vis(0) && inFrame(0);
      const feet = [27, 28].every((i) => vis(i) && inFrame(i));

      const upper = vis(11) && vis(12) && head;
      fullBody = this.needsLegs ? (head && feet ? "ok" : "cut") : upper && vis(23) && vis(24) ? "ok" : "cut";
      const hf = bodyHeightFrac(n);
      if (hf !== null && fullBody === "ok") distance = hf > c.nearFrac ? "near" : hf < c.farFrac ? "far" : "ok";
      else if (fullBody === "ok") {
        // legs not visible (upper body game): judge by the shoulder width
        const sw = Math.abs(n[11].x - n[12].x);
        distance = sw > 0.42 ? "near" : sw < 0.09 ? "far" : "ok";
      } else if (fullBody === "cut") {
        // body is cut off: too close if the shoulders fill the frame, otherwise just not fully visible
        const sw = Math.abs(n[11].x - n[12].x);
        distance = sw > 0.42 ? "near" : "unknown";
      }
    }

    let message = "";
    if (light === "dark") message = "Xona qorong‘i, chiroqni yoqing";
    else if (!player) message = "";
    else if (fullBody === "cut") message = this.needsLegs ? "Butun tana kadrga sig‘sin — orqaroq turing" : "Belgacha ko‘rinsin — biroz orqaroq turing";
    else if (distance === "near") message = "Juda yaqin — biroz orqaroq turing";
    else if (distance === "far") message = "Juda uzoq — kameraga yaqinroq keling";
    else if (light === "bright") message = "Yorug‘lik juda kuchli — kamera oynadan teskari bo‘lsin";

    return { fullBody, light, distance, message, ok: !!player && message === "" && light !== "dark" && fullBody === "ok" };
  }
}
