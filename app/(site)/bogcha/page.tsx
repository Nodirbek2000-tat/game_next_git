import type { Metadata } from "next";
import Link from "next/link";
import { KIDS_GAMES } from "@/lib/games";

export const metadata: Metadata = {
  title: "Bog‘cha",
  description: "Bog‘cha uchun harakat o‘yinlari: 2–5 bola kamera oldida birga o‘ynaydi.",
  alternates: { canonical: "/bogcha" },
};

/** Short, readable label under the big emoji. */
const LABEL: Record<string, string> = {
  pufakchalar: "Pufakchalarni yor",
  "qotib-qol": "Musiqa — qotib qol!",
  hayvonlar: "Hayvonlar kabi qil",
  baliqcha: "Baliqcha tut",
};

export default function BogchaPage() {
  return (
    <section className="mx-auto max-w-[72rem] px-5 pb-12 pt-6 sm:px-8 sm:pt-10">
      <h1 className="text-center font-display text-[clamp(2.4rem,7vw,5rem)] font-extrabold leading-tight tracking-tight">
        Bog‘cha <span aria-hidden="true">🐰🐻🐱🐶🐸</span>
      </h1>
      <p className="mt-3 text-center text-[clamp(1.1rem,2.4vw,1.6rem)] font-semibold text-muted">Bolalar kameradan 2–3 metr uzoqroq tursin</p>

      <ul className="mt-8 grid gap-5 sm:grid-cols-2">
        {KIDS_GAMES.map((g) => (
          <li key={g.slug}>
            <Link
              href={`/play/${g.slug}`}
              prefetch={false}
              data-testid={`kids-${g.slug}`}
              className="glass flex min-h-56 flex-col items-center justify-center gap-3 rounded-[2.5rem] p-6 text-center transition-transform active:scale-95 sm:min-h-72"
              style={{ boxShadow: `0 22px 50px -24px ${g.color}`, borderColor: g.color }}
            >
              <span aria-hidden="true" className="text-[clamp(5rem,16vw,9rem)] leading-none">
                {g.icon}
              </span>
              <span className="font-display text-[clamp(1.6rem,4vw,2.6rem)] font-extrabold leading-tight">{g.title}</span>
              <span className="text-[clamp(1.05rem,2.2vw,1.5rem)] font-medium text-muted">{LABEL[g.slug] ?? g.short}</span>
              <span
                aria-hidden="true"
                className="mt-1 inline-flex min-h-16 min-w-56 items-center justify-center rounded-full px-8 text-2xl font-extrabold text-white"
                style={{ background: g.color }}
              >
                ▶ O‘ynash
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-center text-base font-semibold text-muted">Kamera tasviri qurilmadan chiqmaydi. Yutqazish yo‘q — hamma yulduz oladi.</p>
    </section>
  );
}
