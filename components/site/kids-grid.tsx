"use client";

import Link from "next/link";
import { PremiumBadge } from "@/components/account/premium-badge";
import { useAccount } from "@/lib/account/store";
import type { GameInfo } from "@/lib/games";

/** Short, readable label under the big emoji. */
const LABEL: Record<string, string> = {
  pufakchalar: "Pufakchalarni yor",
  hayvonlar: "Hayvonlar kabi qil",
  baliqcha: "Baliqcha tut",
  "devor-bolalar": "Devordan o‘t",
  sanaymiz: "Sanab o‘yna",
};

/** The kindergarten games, free ones first. */
export function KidsGrid({ games }: { games: GameInfo[] }) {
  const free = useAccount((s) => s.config.freeGames);
  const sorted = [...games].sort((a, b) => Number(!free.includes(a.slug)) - Number(!free.includes(b.slug)));
  return (
    <ul className="mt-8 grid gap-5 sm:grid-cols-2">
      {sorted.map((g) => (
        <li key={g.slug}>
          <Link
            href={`/play/${g.slug}`}
            prefetch={false}
            data-testid={`kids-${g.slug}`}
            className="glass relative flex min-h-56 flex-col items-center justify-center gap-3 rounded-[2.5rem] p-6 text-center transition-transform active:scale-95 sm:min-h-72"
            style={{ boxShadow: `0 22px 50px -24px ${g.color}`, borderColor: g.color }}
          >
            <PremiumBadge slug={g.slug} />
            <span aria-hidden="true" className="text-[clamp(5rem,16vw,9rem)] leading-none">
              {g.icon}
            </span>
            <span className="font-display text-[clamp(1.6rem,4vw,2.6rem)] font-extrabold leading-tight">{g.title}</span>
            <span className="text-[clamp(1.05rem,2.2vw,1.5rem)] font-medium text-muted">{LABEL[g.slug] ?? g.short}</span>
            <span aria-hidden="true" className="mt-1 inline-flex min-h-16 min-w-56 items-center justify-center rounded-full px-8 text-2xl font-extrabold text-white" style={{ background: g.color }}>
              ▶ O‘ynash
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
