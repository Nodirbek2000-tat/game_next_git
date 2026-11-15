"use client";

import { useAccount } from "@/lib/account/store";

/** "💎 Premium" corner badge on a game card, when this account would need premium for it. */
export function PremiumBadge({ slug }: { slug: string }) {
  const { ready, me, config } = useAccount();
  if (!ready || me?.premium || config.freeGames.includes(slug)) return null;
  return (
    <span
      className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold text-white shadow-md"
      style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)" }}
      data-testid="premium-badge"
    >
      💎 Premium
    </span>
  );
}
