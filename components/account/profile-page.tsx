"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { botLink, useAccount } from "@/lib/account/store";

const ROLE: Record<string, string> = { user: "Oddiy akkaunt", bogcha: "Bog‘cha akkaunti", admin: "Admin" };

export function ProfilePage() {
  const router = useRouter();
  const { ready, me, config, load, logout } = useAccount();
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (ready && !me) router.replace("/kirish?next=/profil");
  }, [ready, me, router]);
  if (!me) return <div className="min-h-[60dvh]" />;
  return (
    <div className="mx-auto max-w-md px-5 pb-14 pt-8 sm:pt-12">
      <div className="glass rounded-[2rem] p-6 text-center">
        <div className="text-6xl" aria-hidden="true">
          {me.premium ? "💎" : "👤"}
        </div>
        <h1 className="mt-2 font-display text-3xl font-extrabold">{me.name}</h1>
        <p className="mt-1 font-semibold text-muted">
          {ROLE[me.role] ?? me.role} · login: <b>{me.username}</b>
        </p>
        <div className="mt-5 grid gap-2 text-left text-base font-semibold">
          <div className="glass rounded-2xl px-4 py-3">
            💎 Premium: {me.premium ? (me.premiumUntil ? `${new Date(me.premiumUntil).toLocaleDateString("uz-UZ")} gacha` : "bor") : "yo‘q"}
          </div>
          <div className="glass rounded-2xl px-4 py-3">
            📱 Qurilmalar: {me.devices} / {me.deviceLimit}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          {!me.premium && (
            <ButtonLink href="/premium" size="lg">
              💎 Premium olish
            </ButtonLink>
          )}
          <a href={botLink(config)} target="_blank" rel="noopener" className="glass inline-flex min-h-12 items-center justify-center rounded-2xl font-bold">
            ✈️ Telegram bot (login va parol)
          </a>
          <ButtonLink href="/sozlamalar" variant="secondary">
            ⚙️ Sozlamalar
          </ButtonLink>
          <Button
            variant="secondary"
            onClick={async () => {
              await logout();
              router.replace("/");
            }}
            data-testid="logout"
          >
            Chiqish
          </Button>
        </div>
      </div>
      <p className="mt-5 text-center text-sm font-semibold text-muted">
        <Link href="/fitnes" className="underline">
          Fitnes
        </Link>{" "}
        natijalari shu qurilmada saqlanadi.
      </p>
    </div>
  );
}
