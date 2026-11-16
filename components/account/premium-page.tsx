"use client";

import Link from "next/link";
import { useEffect } from "react";
import { botLink, useAccount } from "@/lib/account/store";
import { GAMES } from "@/lib/games";

const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
const som = (n: number): string => n.toLocaleString("en-US").replace(/,/g, " ");

const PERKS = ["Barcha o‘yinlar ochiladi", "Fitnes: barcha mashqlar va kunlik reja", "Bog‘cha o‘yinlari — 5 tagacha bola birga", "Telefon, kompyuter va katta ekranda"];

const STEPS: [string, string][] = [
  ["Botni oching", "«💎 Premium» — karta raqami chiqadi"],
  ["To‘lov qiling", "Chek rasmini botga yuboring"],
  ["O‘ynang", "Admin tasdiqlagach, premium o‘zi yoqiladi"],
];

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="var(--brand)" />
      <path d="M6 10.3l2.6 2.6L14.2 7.3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** /premium: one plan, its price, what it opens and how to buy it (Telegram bot: card number, receipt, admin approval). */
export function PremiumPage() {
  const { ready, me, config, load } = useAccount();
  useEffect(() => {
    void load();
  }, [load]);
  const free = GAMES.filter((g) => config.freeGames.includes(g.slug)).map((g) => g.title);

  return (
    <div className="relative isolate overflow-x-clip">
      <div aria-hidden="true" className="aurora pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[30rem]" />
      <div className="mx-auto max-w-[40rem] px-5 pb-16 pt-10 sm:pt-16">
        <p className="text-center text-sm font-bold uppercase tracking-[0.2em] text-brand">💎 Premium</p>
        <h1 className="mt-3 text-center font-display text-[clamp(2.6rem,9vw,4.6rem)]">
          Hamma o‘yinlar.
          <br />
          <span className="text-brand">Bitta obuna.</span>
        </h1>

        {ready && me?.premium && (
          <div className="mt-8 flex items-center justify-center gap-2 rounded-2xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-center font-bold" data-testid="premium-active">
            ✅ Sizda premium bor{me.premiumUntil ? ` — ${fmtDate(me.premiumUntil)} gacha` : ""}
          </div>
        )}

        <section className="mt-8 rounded-[2rem] border border-[var(--line)] p-6 shadow-[0_30px_80px_-40px_var(--glow)] sm:p-8" style={{ background: "var(--card-solid)" }}>
          <div className="flex items-baseline gap-2">
            {config.monthlyPrice > 0 ? (
              <>
                <span className="font-display text-[clamp(2.8rem,11vw,4rem)] font-extrabold leading-none" data-testid="premium-price">
                  {som(config.monthlyPrice)}
                </span>
                <span className="text-lg font-semibold text-muted">so‘m / oy</span>
              </>
            ) : (
              <span className="font-display text-3xl font-extrabold">Narx tez orada</span>
            )}
          </div>
          <ul className="mt-6 grid gap-3">
            {PERKS.map((t) => (
              <li key={t} className="flex gap-3 text-base font-medium">
                <Check />
                {t}
              </li>
            ))}
          </ul>
          <a
            href={botLink(config, "premium")}
            target="_blank"
            rel="noopener"
            className="mt-8 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[var(--fg)] text-lg font-bold text-[var(--bg)] transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
            data-testid="premium-bot"
          >
            Telegram bot orqali olish <span aria-hidden="true">→</span>
          </a>
          {ready && !me && (
            <p className="mt-4 text-center text-sm font-semibold text-muted">
              Avval{" "}
              <Link href="/kirish?next=/premium" className="font-bold text-brand underline">
                akkauntga kiring
              </Link>{" "}
              — premium shu akkauntga yoziladi.
            </p>
          )}
        </section>

        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <div className="font-display text-sm font-extrabold text-brand">0{i + 1}</div>
              <div className="mt-1 font-display text-lg font-bold">{title}</div>
              <div className="text-sm font-medium text-muted">{text}</div>
            </li>
          ))}
        </ol>

        {free.length > 0 && <p className="mt-10 text-center text-sm font-medium text-muted">Bepul: {free.join(", ")}</p>}
        <p className="mt-2 text-center text-sm font-medium text-muted">
          Bog‘cha yoki maktab uchun (10 ta qurilmagacha):{" "}
          {config.bogchaPhone ? (
            <a href={`tel:${config.bogchaPhone.replace(/[^\d+]/g, "")}`} className="font-bold text-brand">
              {config.bogchaPhone}
            </a>
          ) : (
            "Telegram bot orqali bog‘laning"
          )}
        </p>
      </div>
    </div>
  );
}
