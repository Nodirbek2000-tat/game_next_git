"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAccount } from "@/lib/account/store";

/** same switch as the play screen (app/play/[slug]/PlayRoot.tsx) */
const GATE = process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_REQUIRE_LOGIN !== "0";

/** A page only for a signed-in account: anybody else is sent to /kirish and comes back here afterwards. */
export function RequireLogin({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { ready, me, load } = useAccount();
  useEffect(() => {
    if (GATE) void load();
  }, [load]);
  useEffect(() => {
    if (GATE && ready && !me) router.replace(`/kirish?next=${encodeURIComponent(path)}`);
  }, [ready, me, path, router]);
  if (GATE && !(ready && me)) return <div className="min-h-[70dvh]" aria-busy="true" />;
  return <>{children}</>;
}
