import type { Metadata } from "next";
import Link from "next/link";
import { GameCard } from "@/components/site/game-card";
import { HeroScene } from "@/components/site/hero-scene";
import { MAIN_GAMES } from "@/lib/games";

export const metadata: Metadata = {
  title: { absolute: "Harakat o‘yinlari — tanangiz bilan o‘ynang" },
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <section className="relative isolate overflow-x-clip">
      <div aria-hidden="true" className="aurora pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[40rem]" />
      <div className="mx-auto flex max-w-[72rem] flex-col px-5 pb-10 pt-6 sm:px-8 sm:pt-10 lg:pt-14">
        <div className="grid items-center gap-2 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rise text-center lg:text-left">
            <h1 className="font-display text-[clamp(2.6rem,7.4vw,5.75rem)] font-extrabold leading-[1.02] tracking-tight">
              Tanangiz — <span className="text-gradient">pult.</span>
            </h1>
            <p className="mt-4 text-[clamp(1.1rem,2.2vw,1.5rem)] font-medium text-muted">Kamerani yoqing va o‘ynang.</p>
          </div>
          <div
            className="rise relative mx-auto aspect-square w-full max-w-[min(22rem,40dvh)] lg:max-w-[min(26rem,44dvh)] lg:justify-self-end"
            style={{ animationDelay: "0.1s" }}
          >
            <HeroScene />
          </div>
        </div>

        <Link
          href="/fitnes"
          data-testid="home-fitnes"
          className="rise glass mt-4 flex items-center gap-4 rounded-[2rem] p-5 transition-transform hover:-translate-y-0.5 active:scale-[0.98] sm:p-6 lg:mt-6"
          style={{ animationDelay: "0.14s", boxShadow: "0 22px 50px -26px #34d399", borderColor: "#34d39966" }}
        >
          <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-[1.25rem] text-4xl sm:size-20 sm:text-5xl" style={{ background: "linear-gradient(145deg, #34d39959, #34d3991a)" }}>
            💪
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-2xl font-extrabold leading-tight sm:text-3xl">Fitnes</span>
            <span className="block text-base font-medium text-muted">Bugungi mashg‘ulot · kamera tekshiradi · kaloriya</span>
          </span>
          <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full text-white" style={{ background: "#34d399" }}>
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
        </Link>

        <ul className="mt-4 grid gap-4 sm:grid-cols-3 sm:gap-5">
          {MAIN_GAMES.map((g, i) => (
            <li key={g.slug} className="rise" style={{ animationDelay: `${0.18 + i * 0.07}s` }}>
              <GameCard game={g} />
            </li>
          ))}
        </ul>

        <div className="rise mt-6 flex justify-center" style={{ animationDelay: "0.4s" }}>
          <Link
            href="/bogcha"
            className="glass inline-flex min-h-14 items-center gap-3 rounded-3xl px-7 py-3 text-lg font-extrabold transition-transform hover:-translate-y-0.5 active:scale-95"
          >
            <span aria-hidden="true" className="text-3xl">🐰🐸</span> Bog‘cha uchun o‘yinlar
          </Link>
        </div>

        <p className="rise mt-8 flex items-center justify-center gap-2 text-center text-sm font-semibold text-muted" style={{ animationDelay: "0.45s" }}>
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Kamera tasviri qurilmangizdan chiqmaydi
        </p>
      </div>
    </section>
  );
}
