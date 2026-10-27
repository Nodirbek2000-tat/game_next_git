import Link from "next/link";
import type { GameInfo } from "@/lib/games";

/** One short line per game for the entry screen; falls back to the catalogue text. */
const TAGLINE: Record<string, string> = {
  "meva-ninja": "Qo‘lingiz — qilich.",
  "baliq-ovi": "Qarmoq tashlang, baliq tuting.",
  mashina: "Tizza — pedal, qo‘l — rul.",
};

/** Big tappable card: the whole thing goes straight into the game. */
export function GameCard({ game }: { game: GameInfo }) {
  return (
    <Link
      href={`/play/${game.slug}`}
      prefetch={false}
      className="game-card group glass relative flex items-center gap-4 overflow-hidden rounded-[2rem] p-4 text-left sm:min-h-72 sm:flex-col sm:justify-center sm:p-8 sm:text-center"
      style={{ ["--c" as string]: game.color }}
    >
      <div aria-hidden="true" className="game-card-glow pointer-events-none absolute inset-x-6 -top-16 h-40 rounded-full blur-3xl" />
      <div
        aria-hidden="true"
        className="relative flex size-20 shrink-0 items-center justify-center rounded-[1.5rem] text-5xl transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105 sm:size-28 sm:rounded-[1.75rem] sm:text-7xl"
        style={{ background: `linear-gradient(145deg, ${game.color}59, ${game.color}1a)`, boxShadow: `0 18px 40px -18px ${game.color}` }}
      >
        {game.icon}
      </div>
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <h2 className="font-display text-xl font-bold leading-tight sm:text-2xl">{game.title}</h2>
        <p className="mt-1.5 text-base text-muted">{TAGLINE[game.slug] ?? game.short}</p>
      </div>
      <span className="game-card-go relative inline-flex shrink-0 size-11 items-center justify-center rounded-full text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </span>
    </Link>
  );
}
