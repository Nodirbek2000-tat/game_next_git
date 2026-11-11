// Fitnes: the user's profile and history, on this device only (localStorage). Never sent anywhere.

import { addDays, dayKey, type Level } from "./plan";

export interface DayLog {
  kcal: number;
  /** seconds of exercise */
  sec: number;
  reps: number;
  sessions: number;
  /** the day's plan was finished */
  planDone: boolean;
}

export interface FitnessData {
  weightKg: number;
  level: Level;
  days: Record<string, DayLog>;
}

const KEY = "harakat.fitness.v1";
export const DEFAULT_WEIGHT = 70;
const KEEP_DAYS = 120;

export function emptyData(): FitnessData {
  return { weightKg: DEFAULT_WEIGHT, level: 1, days: {} };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads and validates; anything broken falls back to the defaults. */
export function loadFitness(): FitnessData {
  const s = storage();
  const d = emptyData();
  if (!s) return d;
  try {
    const raw = JSON.parse(s.getItem(KEY) ?? "null") as Partial<FitnessData> | null;
    if (!raw || typeof raw !== "object") return d;
    if (typeof raw.weightKg === "number" && raw.weightKg >= 20 && raw.weightKg <= 250) d.weightKg = raw.weightKg;
    if (raw.level === 1 || raw.level === 2 || raw.level === 3) d.level = raw.level;
    if (raw.days && typeof raw.days === "object") {
      for (const [k, v] of Object.entries(raw.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== "object") continue;
        const l = v as Partial<DayLog>;
        d.days[k] = { kcal: num(l.kcal), sec: num(l.sec), reps: num(l.reps), sessions: num(l.sessions), planDone: !!l.planDone };
      }
    }
  } catch {
    /* broken JSON: defaults */
  }
  return d;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export function saveFitness(d: FitnessData): void {
  const s = storage();
  if (!s) return;
  // only the last KEEP_DAYS days are kept
  const keys = Object.keys(d.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete d.days[k];
  try {
    s.setItem(KEY, JSON.stringify(d));
  } catch {
    /* full / blocked */
  }
}

export interface SessionResult {
  kcal: number;
  sec: number;
  reps: number;
  planDone: boolean;
}

/** Adds a finished session to today's log and saves. */
export function recordSession(r: SessionResult, now = new Date()): FitnessData {
  const d = loadFitness();
  const k = dayKey(now);
  const day = d.days[k] ?? { kcal: 0, sec: 0, reps: 0, sessions: 0, planDone: false };
  day.kcal += r.kcal;
  day.sec += r.sec;
  day.reps += r.reps;
  day.sessions += 1;
  day.planDone = day.planDone || r.planDone;
  d.days[k] = day;
  saveFitness(d);
  return d;
}

/** Days in a row with a session, ending today (or yesterday, when today has none yet). */
export function streak(d: FitnessData, now = new Date()): number {
  let day = d.days[dayKey(now)]?.sessions ? now : addDays(now, -1);
  let n = 0;
  while (d.days[dayKey(day)]?.sessions) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** The last 7 days, oldest first: [date, log or null] */
export function lastWeek(d: FitnessData, now = new Date()): [Date, DayLog | null][] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(now, i - 6);
    return [day, d.days[dayKey(day)] ?? null];
  });
}
