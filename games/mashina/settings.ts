import { CAR_IDS, CARS, CONTROL_DEFAULTS, MODES, type CarId, type ControlConfig, type ModeId } from "./config";
import type { Choice } from "./logic/picker";

const KEY = "harakat.mashina";

export interface GameSettings {
  car: CarId;
  color: number;
  seated: boolean;
  handbrake: ControlConfig["handbrake"];
  /** steering sensitivity: hand angle (deg) that means full lock */
  steerFullDeg: number;
}

export const SETTING_DEFAULTS: GameSettings = { car: "sedan", color: 0, seated: false, handbrake: "hand", steerFullDeg: CONTROL_DEFAULTS.steerFullDeg };

export function loadSettings(): GameSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (!raw) return { ...SETTING_DEFAULTS };
    const o = JSON.parse(raw) as Partial<GameSettings>;
    return {
      car: CAR_IDS.includes(o.car as CarId) ? (o.car as CarId) : SETTING_DEFAULTS.car,
      color: Number.isInteger(o.color) ? Math.max(0, Math.min(5, o.color as number)) : 0,
      seated: !!o.seated,
      handbrake: o.handbrake === "knees" || o.handbrake === "off" ? o.handbrake : "hand",
      steerFullDeg: typeof o.steerFullDeg === "number" ? Math.max(35, Math.min(90, o.steerFullDeg)) : SETTING_DEFAULTS.steerFullDeg,
    };
  } catch {
    return { ...SETTING_DEFAULTS };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export interface QueryOptions {
  mode?: ModeId;
  car?: CarId;
  color?: number;
  seated?: boolean;
  handbrake?: ControlConfig["handbrake"];
  /** fixed time of day 0..1 (0.25 = 06:00, 0.5 = noon, 0.9 = night); omitted = cycle */
  time?: number;
  rain?: boolean;
  duration?: number;
  traffic?: number;
  /** test / debug: simulation steps per rendered frame (software GL renders at a few fps); default 1 */
  timescale?: number;
}

/** URL query overrides (used by tests and deep links): ?mode=imtihon&car=sport&color=2&seated=1&time=0.5&rain=1 */
export function parseQuery(q: URLSearchParams): QueryOptions {
  const o: QueryOptions = {};
  const mode = q.get("mode");
  if (mode && MODES.some((m) => m.id === mode)) o.mode = mode as ModeId;
  const car = q.get("car");
  if (car && CAR_IDS.includes(car as CarId)) o.car = car as CarId;
  const color = q.get("color");
  if (color !== null && /^\d$/.test(color)) o.color = Math.min(Number(color), 5);
  if (q.has("seated")) o.seated = q.get("seated") !== "0";
  const hb = q.get("handbrake");
  if (hb === "hand" || hb === "knees" || hb === "off") o.handbrake = hb;
  const time = q.get("time");
  if (time !== null && Number.isFinite(Number(time))) o.time = ((Number(time) % 1) + 1) % 1;
  if (q.has("rain")) o.rain = q.get("rain") !== "0";
  const dur = Number(q.get("duration"));
  if (dur > 0) o.duration = dur;
  const tr = q.get("traffic");
  if (tr !== null && Number.isFinite(Number(tr))) o.traffic = Math.max(0, Math.min(1, Number(tr)));
  const ts = Number(q.get("timescale"));
  if (ts >= 1) o.timescale = Math.min(16, Math.floor(ts));
  return o;
}

export function choiceFrom(s: GameSettings, o: QueryOptions): Choice {
  const car = o.car ?? s.car;
  return { mode: o.mode ?? "erkin", car, color: Math.min(o.color ?? s.color, CARS[car].colors.length - 1), seated: o.seated ?? s.seated };
}
