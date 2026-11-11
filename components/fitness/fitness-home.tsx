"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EXERCISE_LIST, EXERCISES } from "@/lib/fitness/exercises";
import { addDays, dayKey, LEVEL_LABEL, planFor, planKcal, planMinutes, weekdayName, type DayPlan, type Level } from "@/lib/fitness/plan";
import { emptyData, lastWeek, loadFitness, saveFitness, streak, type FitnessData } from "@/lib/fitness/store";

const GREEN = "#34d399";

/** /fitnes: today's plan first (one big button), then the numbers, tomorrow, every exercise and the two settings. All data is local. */
export function FitnessHome() {
  const [data, setData] = useState<FitnessData>(emptyData);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // localStorage and today's date exist only in the browser: read once after mounting (the server renders the empty frame)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(loadFitness());
    setNow(new Date());
  }, []);
  const update = (d: FitnessData): void => {
    saveFitness(d);
    setData({ ...d, days: { ...d.days } });
  };

  // the date and the saved data exist only in the browser: nothing day-specific is rendered before they are read
  if (!now) return <div className="mx-auto min-h-[70dvh] max-w-[48rem]" aria-busy="true" />;
  const today = now;
  const plan = planFor(today, data.level);
  const tomorrow = planFor(addDays(today, 1), data.level);
  const log = data.days[dayKey(today)];
  const week = lastWeek(data, today);
  const weekKcal = week.reduce((s, [, l]) => s + (l?.kcal ?? 0), 0);
  const maxBar = Math.max(30, ...week.map(([, l]) => l?.kcal ?? 0));
  const ready = true;

  return (
    <div className="mx-auto max-w-[48rem] px-5 pb-14 pt-6 sm:px-8 sm:pt-10">
      <h1 className="font-display text-[clamp(2.4rem,7vw,4.2rem)] font-extrabold leading-tight tracking-tight">Fitnes</h1>
      <p className="mt-2 text-lg font-medium text-muted">Kamera sanaydi, tekshiradi va kaloriyani hisoblaydi.</p>

      {/* today */}
      <section className="glass mt-6 rounded-[2rem] p-5 sm:p-7" style={{ boxShadow: `0 24px 60px -30px ${GREEN}` }} data-testid="fitness-today">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-bold uppercase tracking-wider text-muted">Bugun{ready ? ` · ${weekdayName(today)}` : ""}</span>
          {log?.planDone && <span className="text-sm font-bold" style={{ color: GREEN }}>✓ Bajarildi</span>}
        </div>
        <h2 className="mt-2 flex items-center gap-3 font-display text-[clamp(1.6rem,4.5vw,2.4rem)] font-extrabold">
          <span aria-hidden="true">{plan.icon}</span> {plan.title}
        </h2>
        <Steps plan={plan} />
        <p className="mt-4 text-base font-semibold text-muted">
          ≈ {planMinutes(plan)} daqiqa · ≈ {Math.round(planKcal(plan, data.weightKg))} kkal
        </p>
        <Link
          href="/play/fitnes"
          prefetch={false}
          data-testid="fitness-start"
          className="mt-5 inline-flex min-h-16 w-full items-center justify-center rounded-full text-2xl font-extrabold text-white transition-transform active:scale-95"
          style={{ background: GREEN }}
        >
          ▶ {log?.planDone ? "Yana bir marta" : "Boshlash"}
        </Link>
      </section>

      {/* numbers */}
      <section className="mt-5 grid grid-cols-3 gap-3">
        <Stat label="Bugun" value={`${Math.round(log?.kcal ?? 0)}`} unit="kkal" />
        <Stat label="Ketma-ket" value={`${streak(data, today)}`} unit="kun" />
        <Stat label="7 kun" value={`${Math.round(weekKcal)}`} unit="kkal" />
      </section>

      <section className="glass mt-3 rounded-[1.5rem] p-5" aria-label="Oxirgi 7 kun">
        <div className="flex h-28 items-end justify-between gap-2">
          {week.map(([d, l]) => {
            const k = l?.kcal ?? 0;
            const isToday = dayKey(d) === dayKey(today);
            return (
              <div key={dayKey(d)} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-xs font-bold text-muted">{k > 0 ? Math.round(k) : ""}</span>
                <div className="w-full max-w-9 rounded-full" style={{ height: `${Math.max(6, (k / maxBar) * 80)}px`, background: k > 0 ? GREEN : "color-mix(in srgb, currentColor 12%, transparent)" }} />
                <span className={`text-xs font-bold ${isToday ? "" : "text-muted"}`}>{weekdayName(d).slice(0, 2)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* tomorrow */}
      <section className="glass mt-5 flex items-center gap-4 rounded-[1.5rem] p-5" data-testid="fitness-tomorrow">
        <span aria-hidden="true" className="text-4xl">
          {tomorrow.icon}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-bold uppercase tracking-wider text-muted">Ertaga{ready ? ` · ${weekdayName(addDays(today, 1))}` : ""}</span>
          <div className="font-display text-xl font-bold">{tomorrow.title}</div>
          <div className="text-sm font-semibold text-muted">
            ≈ {planMinutes(tomorrow)} daqiqa · {tomorrow.steps.map((s) => EXERCISES[s.ex].icon).join(" ")}
          </div>
        </div>
      </section>

      {/* every exercise */}
      <h2 className="mt-9 font-display text-2xl font-bold">Mashqlar</h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {EXERCISE_LIST.map((ex) => (
          <li key={ex.id}>
            <Link
              href={`/play/fitnes?ex=${ex.id}`}
              prefetch={false}
              className="glass flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-[1.5rem] p-3 text-center transition-transform active:scale-95"
            >
              <span aria-hidden="true" className="text-4xl">
                {ex.icon}
              </span>
              <span className="text-base font-bold leading-tight">{ex.title}</span>
              <span className="text-xs font-semibold text-muted">{ex.kind === "hold" ? `${ex.target} s` : `${ex.target} marta`}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* settings */}
      <section className="glass mt-9 grid gap-5 rounded-[1.5rem] p-5 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-bold text-muted">Vazningiz (kaloriya uchun)</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={20}
              max={250}
              value={data.weightKg}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (v >= 20 && v <= 250) update({ ...data, weightKg: v });
              }}
              className="glass h-12 w-28 rounded-2xl px-4 text-xl font-bold"
              data-testid="fitness-weight"
            />
            <span className="text-lg font-bold">kg</span>
          </span>
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold text-muted">Daraja</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Daraja">
            {([1, 2, 3] as Level[]).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={data.level === l}
                onClick={() => update({ ...data, level: l })}
                className="glass min-h-12 flex-1 rounded-2xl px-2 text-sm font-bold"
                style={data.level === l ? { background: GREEN, color: "#fff" } : undefined}
              >
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
        </div>
      </section>
      <p className="mt-5 text-center text-sm font-semibold text-muted">Natijalar faqat shu qurilmada saqlanadi. Kaloriya — taxminiy hisob.</p>
    </div>
  );
}

function Steps({ plan }: { plan: DayPlan }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {plan.steps.map((s, i) => {
        const ex = EXERCISES[s.ex];
        return (
          <li key={i} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold" style={{ background: "color-mix(in srgb, currentColor 8%, transparent)" }}>
            <span aria-hidden="true">{ex.icon}</span>
            {ex.title} · {ex.kind === "hold" ? `${s.amount} s` : `${s.amount}×`}
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="glass flex flex-col items-center rounded-[1.5rem] px-2 py-4 text-center">
      <span className="text-xs font-bold uppercase tracking-wider text-muted">{label}</span>
      <span className="font-display text-3xl font-extrabold leading-tight">{value}</span>
      <span className="text-xs font-bold text-muted">{unit}</span>
    </div>
  );
}
