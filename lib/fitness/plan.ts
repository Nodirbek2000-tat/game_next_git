// Fitnes: the daily programme ("Bugun" / "Ertaga"). A fixed weekly rotation, scaled by the user's level; pure, no storage.

import { EXERCISES, kcal, stepSeconds, type ExerciseId } from "./exercises";

export type Level = 1 | 2 | 3;
export const LEVEL_LABEL: Record<Level, string> = { 1: "Boshlang‘ich", 2: "O‘rta", 3: "Kuchli" };
const LEVEL_K: Record<Level, number> = { 1: 0.7, 2: 1, 3: 1.4 };

export interface PlanStep {
  ex: ExerciseId;
  /** reps, or seconds for a "hold" exercise */
  amount: number;
}

export interface DayPlan {
  /** e.g. "Kuch kuni" */
  title: string;
  icon: string;
  steps: PlanStep[];
  /** rest between the steps (s) */
  rest: number;
}

type Template = { title: string; icon: string; steps: [ExerciseId, number][] };

/** index = Date.getDay() (0 = yakshanba) */
const WEEK: Template[] = [
  { title: "Yoga va cho‘zilish", icon: "🧘", steps: [["tepaga", 10], ["egilish", 10], ["daraxt", 25], ["jangchi", 25], ["yonoyoq", 12], ["daraxt", 25], ["egilish", 10]] },
  { title: "Kuch kuni", icon: "🏋️", steps: [["tepaga", 12], ["squat", 12], ["lunge", 10], ["yonoyoq", 14], ["plank", 25], ["squat", 12], ["plank", 25]] },
  { title: "Kardio kuni", icon: "🏃", steps: [["jack", 25], ["boks", 30], ["knees", 30], ["yonqadam", 20], ["tirsak", 20], ["jack", 25], ["knees", 30]] },
  { title: "Yoga va muvozanat", icon: "🌳", steps: [["egilish", 12], ["jangchi", 30], ["yonoyoq", 12], ["daraxt", 30], ["tepaga", 10], ["jangchi", 30]] },
  { title: "Kuch kuni", icon: "🏋️", steps: [["lunge", 12], ["tepaga", 15], ["squat", 15], ["yonoyoq", 16], ["plank", 30], ["lunge", 12]] },
  { title: "Kardio kuni", icon: "🔥", steps: [["knees", 30], ["boks", 40], ["jack", 30], ["tirsak", 20], ["yonqadam", 20], ["boks", 40], ["jack", 25]] },
  { title: "Aralash mashg‘ulot", icon: "⚡", steps: [["jack", 25], ["boks", 30], ["squat", 12], ["tirsak", 20], ["daraxt", 25], ["yonqadam", 20], ["lunge", 10], ["plank", 30], ["egilish", 10]] },
];

export function planFor(date: Date, level: Level): DayPlan {
  const t = WEEK[date.getDay()];
  const k = LEVEL_K[level];
  return {
    title: t.title,
    icon: t.icon,
    rest: level === 1 ? 20 : 15,
    steps: t.steps.map(([ex, n]) => ({ ex, amount: Math.max(EXERCISES[ex].kind === "hold" ? 10 : 4, Math.round(n * k)) })),
  };
}

/** seconds of exercise (without the rests) */
export function planSeconds(p: DayPlan): number {
  return p.steps.reduce((s, st) => s + stepSeconds(st.ex, st.amount), 0);
}

/** whole session in minutes, rests included (rounded up) */
export function planMinutes(p: DayPlan): number {
  return Math.max(1, Math.ceil((planSeconds(p) + p.rest * Math.max(0, p.steps.length - 1)) / 60));
}

/** expected kcal of the plan for this weight */
export function planKcal(p: DayPlan, weightKg: number): number {
  return p.steps.reduce((s, st) => s + kcal(EXERCISES[st.ex].met, weightKg, stepSeconds(st.ex, st.amount)), 0);
}

/** "2026-11-10" in local time */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const WEEKDAY = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
export const weekdayName = (d: Date): string => WEEKDAY[d.getDay()];
