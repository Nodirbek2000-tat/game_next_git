"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useAccount } from "@/lib/account/store";

const pill = "glass inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3 text-base font-bold sm:px-4 transition-transform hover:-translate-y-0.5 active:scale-95";

/** same switch as the play screen: production asks for an account, dev and tests do not */
const GATE = process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_REQUIRE_LOGIN !== "0";

function Sections() {
  return (
    <>
      <Link href="/fitnes" className={pill} data-testid="nav-fitnes">
        <span aria-hidden="true">💪</span> <span className="hidden sm:inline">Fitnes</span>
      </Link>
      <Link href="/bogcha" className={pill} data-testid="nav-bogcha">
        <span aria-hidden="true">🐰</span> <span className="hidden sm:inline">Bog‘cha</span>
      </Link>
    </>
  );
}

/** Header: "Kirish" for a visitor; signed in: Fitnes, Bog'cha, the account (name, 💎) and for admins the admin panel button. */
export function AccountNav() {
  const { ready, me, load } = useAccount();
  useEffect(() => {
    void load();
  }, [load]);
  if (!ready) return <span className="inline-block min-h-12 w-12" aria-hidden="true" />;
  if (!me)
    return (
      <>
        {!GATE && <Sections />}
        <Link href="/kirish" className={pill} data-testid="nav-signin">
          <span aria-hidden="true">🔑</span> <span className="hidden sm:inline">Kirish</span>
        </Link>
      </>
    );
  return (
    <>
      <Sections />
      {me.isAdmin && (
        <Link href="/boshqaruv" className={pill} data-testid="nav-admin" style={{ borderColor: "#f59e0b88" }}>
          <span aria-hidden="true">🛠</span> <span className="hidden sm:inline">Admin</span>
        </Link>
      )}
      <Link href="/profil" className={pill} data-testid="nav-profile" title={me.name}>
        <span aria-hidden="true">{me.premium ? "💎" : "👤"}</span>
        <span className="hidden max-w-32 truncate sm:inline">{me.name}</span>
      </Link>
    </>
  );
}
