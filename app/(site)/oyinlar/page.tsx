import type { Metadata } from "next";
import { GameGrid } from "@/components/site/game-grid";
import { Container, PageHeader } from "@/components/site/page-shell";
import { MAIN_GAMES } from "@/lib/games";

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
        <GameGrid games={MAIN_GAMES} />
      </Container>
    </>
  );
}
