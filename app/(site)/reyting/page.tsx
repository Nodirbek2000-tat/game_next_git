import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/site/page-shell";
import { Leaderboard } from "@/components/site/leaderboard";

export const metadata: Metadata = {
  title: "Reyting",
  description: "Harakat o‘yinlari reytingi.",
  alternates: { canonical: "/reyting" },
};

export default function RankingPage() {
  return (
    <>
      <PageHeader title="Reyting" />
      <Container className="max-w-2xl">
        <Leaderboard title="Haftalik" />
      </Container>
    </>
  );
}
