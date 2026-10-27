import type { Metadata } from "next";
import { GameCard } from "@/components/site/game-card";
import { Container, PageHeader } from "@/components/site/page-shell";
import { GAMES } from "@/lib/games";

export const metadata: Metadata = {
  title: "O‘yinlar",
  description: "Kamera bilan boshqariladigan o‘yinlar: Meva Ninja, Baliq ovi va Mashina.",
  alternates: { canonical: "/oyinlar" },
};

export default function GamesPage() {
  return (
    <>
      <PageHeader title="O‘yinlar" />
      <Container>
        <ul className="grid gap-4 sm:grid-cols-3 sm:gap-5">
          {GAMES.map((g, i) => (
            <li key={g.slug} className="rise" style={{ animationDelay: `${i * 0.07}s` }}>
              <GameCard game={g} />
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
