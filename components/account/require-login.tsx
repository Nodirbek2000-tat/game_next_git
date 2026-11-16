"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAccount } from "@/lib/account/store";

/** same switch as the play screen (app/play/[slug]/PlayRoot.tsx) */
const GATE = process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_REQUIRE_LOGIN !== "0";

/**
 * A page only for a signed-in account: anybody else is sent to /kirish and comes back here afterwards. `freeSlug`: the page is open
 * to everybody while that game is a free one (set in the admin panel).
 */
export function RequireLogin({ children, freeSlug }: { children: ReactNode; freeSlug?: string }) {
  const router = useRouter();
  const path = usePathname();
  const { ready, me, load, config } = useAccount();
  const open = !!freeSlug && config.freeGames.includes(freeSlug);
  useEffect(() => {
    if (GATE) void load();
  }, [load]);
  useEffect(() => {
    if (GATE && ready && !me && !open) router.replace(`/kirish?next=${encodeURIComponent(path)}`);
  }, [ready, me, open, path, router]);
  if (GATE && !(ready && (me || open))) return <div className="min-h-[70dvh]" aria-busy="true" />;
  return <>{children}</>;
}
