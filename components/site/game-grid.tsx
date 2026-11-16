"use client";

import { GameCard } from "@/components/site/game-card";
import { useAccount } from "@/lib/account/store";
import type { GameInfo } from "@/lib/games";

/** The game cards, the free ones first (the free list is set in the admin panel), premium ones after them. */
export function GameGrid({ games, delay = 0 }: { games: GameInfo[]; delay?: number }) {
  const free = useAccount((s) => s.config.freeGames);
  const sorted = [...games].sort((a, b) => Number(!free.includes(a.slug)) - Number(!free.includes(b.slug)));
  return (
    <ul className="grid gap-4 sm:grid-cols-3 sm:gap-5">
      {sorted.map((g, i) => (
        <li key={g.slug} className="rise" style={{ animationDelay: `${delay + i * 0.06}s` }}>
          <GameCard game={g} />
        </li>
      ))}
    </ul>
  );
}
