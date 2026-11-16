import type { Metadata } from "next";
import { KidsGrid } from "@/components/site/kids-grid";
import { KIDS_GAMES } from "@/lib/games";

export const metadata: Metadata = {
  title: "Bog‘cha",
  description:
    "Bog‘cha uchun harakat o‘yinlari: 2–5 bola kamera oldida birga o‘ynaydi.",
  alternates: { canonical: "/bogcha" },
};

export default function BogchaPage() {
  return (
    <section className="mx-auto max-w-[72rem] px-5 pb-12 pt-6 sm:px-8 sm:pt-10">
      <h1 className="text-center font-display text-[clamp(2.4rem,7vw,5rem)] font-extrabold leading-tight tracking-tight">
        Bog‘cha <span aria-hidden="true">🐰🐻🐱🐶🐸</span>
      </h1>
      <p className="mt-3 text-center text-[clamp(1.1rem,2.4vw,1.6rem)] font-semibold text-muted">
        Bolalar kameradan 2–3 metr uzoqroq tursin
      </p>
      <KidsGrid games={KIDS_GAMES} />
      <p className="mt-8 text-center text-base font-semibold text-muted">
        Kamera tasviri qurilmadan chiqmaydi. Yutqazish yo‘q — hamma yulduz
        oladi.
      </p>
    </section>
  );
}
