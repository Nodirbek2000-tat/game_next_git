"use client";

import Link from "next/link";
import { useEffect } from "react";
import { botLink, useAccount } from "@/lib/account/store";
import { GAMES, type GameInfo } from "@/lib/games";

const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
const som = (n: number): string => n.toLocaleString("en-US").replace(/,/g, " ");

const PERKS: [string, string][] = [
  ["🎮", "Barcha o‘yinlar ochiladi"],
  ["💪", "Fitnes: barcha mashqlar va kunlik reja"],
  ["🐰", "Bog‘cha o‘yinlari — 5 tagacha bola birga"],
  ["📱", "Telefon, kompyuter va katta ekranda"],
  ["🔒", "Kamera tasviri qurilmadan chiqmaydi"],
];

const STEPS: [string, string][] = [
  ["Botni oching", "«💎 Premium» tugmasi — karta raqami chiqadi"],
  ["To‘lov qiling", "Kartaga o‘tkazing va chek rasmini botga yuboring"],
  ["O‘ynang", "Admin tasdiqlagach, premium akkauntingizda o‘zi yoqiladi"],
];

function GameChips({ games, locked }: { games: GameInfo[]; locked: boolean }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {games.map((g) => (
        <li key={g.slug} className="glass inline-flex items-center gap-1.5 rounded-full py-1.5 pl-2 pr-3 text-sm font-bold">
          <span className="text-lg leading-none" aria-hidden="true">
            {g.icon}
          </span>
          {g.title}
          {locked && (
            <span className="text-xs" aria-label="premium">
              💎
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** /premium: what premium opens, the price, and the way to buy it (Telegram bot: card number, receipt, admin approval). */
export function PremiumPage() {
  const { ready, me, config, load } = useAccount();
  useEffect(() => {
    void load();
  }, [load]);
  const listed = GAMES.filter((g) => !g.hidden || g.slug === "fitnes");
  const free = listed.filter((g) => config.freeGames.includes(g.slug));
  const premiumGames = listed.filter((g) => !config.freeGames.includes(g.slug));
  const adults = premiumGames.filter((g) => g.audience !== "bogcha");
  const kids = premiumGames.filter((g) => g.audience === "bogcha");

  return (
    <div className="relative isolate overflow-x-clip">
      <div aria-hidden="true" className="aurora pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[34rem]" />
      <div className="mx-auto max-w-[46rem] px-5 pb-16 pt-8 sm:pt-12">
        <div className="text-center">
          <div className="mx-auto flex size-20 items-center justify-center rounded-[1.75rem] text-5xl shadow-xl" style={{ background: "linear-gradient(145deg,#a78bfa,#ec4899)" }} aria-hidden="true">
            💎
          </div>
          <h1 className="mt-4 font-display text-[clamp(2.4rem,8vw,4rem)] font-extrabold leading-none">
            <span className="text-gradient">Premium</span>
          </h1>
          <p className="mt-3 text-lg font-semibold text-muted">Barcha o‘yinlar va fitnes — bitta obunada.</p>
        </div>

        {ready && me?.premium && (
          <div className="mt-6 flex items-center gap-3 rounded-[1.5rem] border-2 border-green-500/40 bg-green-500/10 p-4" data-testid="premium-active">
            <span className="text-3xl" aria-hidden="true">
              ✅
            </span>
            <div>
              <div className="text-lg font-extrabold">Sizda premium bor</div>
              <div className="font-semibold text-muted">{me.premiumUntil ? `${fmtDate(me.premiumUntil)} gacha` : "Cheksiz"}</div>
            </div>
          </div>
        )}

        {/* the plan */}
        <section className="relative mt-7 overflow-hidden rounded-[2.25rem] p-[2px]" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899,#f59e0b)" }}>
          <div className="rounded-[2.15rem] p-6 sm:p-8" style={{ background: "var(--card-solid)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="rounded-full bg-[var(--brand)] px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-white">Oylik tarif</span>
              <span className="text-sm font-bold text-muted">30 kun</span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              {config.monthlyPrice > 0 ? (
                <>
                  <span className="font-display text-[clamp(2.6rem,10vw,3.6rem)] font-extrabold leading-none" data-testid="premium-price">
                    {som(config.monthlyPrice)}
                  </span>
                  <span className="text-xl font-bold text-muted">so‘m / oy</span>
                </>
              ) : (
                <span className="font-display text-3xl font-extrabold">Narx tez orada</span>
              )}
            </div>
            <ul className="mt-6 grid gap-3">
              {PERKS.map(([icon, text]) => (
                <li key={text} className="flex items-center gap-3 text-base font-semibold">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: "color-mix(in srgb, var(--brand) 14%, transparent)" }} aria-hidden="true">
                    {icon}
                  </span>
                  {text}
                </li>
              ))}
            </ul>
            <a
              href={botLink(config, "premium")}
              target="_blank"
              rel="noopener"
              className="mt-7 inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-full text-xl font-extrabold text-white shadow-lg transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg,#229ED9,#1d7fc1)", boxShadow: "0 18px 40px -18px #229ED9" }}
              data-testid="premium-bot"
            >
              <span aria-hidden="true">✈️</span> Telegram bot orqali olish
            </a>
            {ready && !me && (
              <p className="mt-4 text-center text-sm font-bold">
                Avval{" "}
                <Link href="/kirish?next=/premium" className="text-brand underline">
                  akkauntga kiring
                </Link>{" "}
                — premium shu akkauntga yoziladi.
              </p>
            )}
          </div>
        </section>

        {/* how */}
        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <div key={title} className="glass rounded-[1.5rem] p-4">
              <div className="flex size-9 items-center justify-center rounded-full text-base font-extrabold text-white" style={{ background: "var(--brand)" }}>
                {i + 1}
              </div>
              <div className="mt-2 font-display text-lg font-bold">{title}</div>
              <div className="text-sm font-medium text-muted">{text}</div>
            </div>
          ))}
        </section>

        {/* which games */}
        {adults.length > 0 && (
          <section className="mt-9">
            <h2 className="font-display text-2xl font-bold">Premiumda ochiladi</h2>
            <GameChips games={adults} locked />
          </section>
        )}
        {kids.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-bold">🐰 Bog‘cha o‘yinlari</h2>
            <GameChips games={kids} locked />
          </section>
        )}
        {free.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-bold">Bepul</h2>
            <GameChips games={free} locked={false} />
          </section>
        )}
        <p className="mt-9 text-center text-sm font-semibold text-muted">
          Bog‘cha yoki maktab uchun (10 ta qurilmagacha) — {config.bogchaPhone ? <a href={`tel:${config.bogchaPhone.replace(/[^\d+]/g, "")}`} className="font-bold text-brand">{config.bogchaPhone}</a> : "Telegram bot orqali bog‘laning"}
        </p>
      </div>
    </div>
  );
}
