import type { Metadata } from "next";
import { GameCard } from "@/components/site/game-card";
import { HeroScene } from "@/components/site/hero-scene";
import { GAMES } from "@/lib/games";

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

        <ul className="mt-4 grid gap-4 sm:grid-cols-3 sm:gap-5 lg:mt-6">
          {GAMES.map((g, i) => (
            <li key={g.slug} className="rise" style={{ animationDelay: `${0.18 + i * 0.07}s` }}>
              <GameCard game={g} />
            </li>
          ))}
        </ul>

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
