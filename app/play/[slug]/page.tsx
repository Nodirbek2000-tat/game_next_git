import type { Metadata } from "next";
import { Suspense } from "react";
import { GAMES, getGame } from "@/lib/games";
import PlayClient from "./PlayClient";

export function generateStaticParams(): { slug: string }[] {
  return GAMES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/play/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const game = getGame(slug);
  return {
    title: game ? `${game.title} — o‘ynash` : "O‘yin",
    description: game?.short,
    robots: { index: false },
  };
}

async function PlaySlug({ params }: { params: PageProps<"/play/[slug]">["params"] }) {
  const { slug } = await params;
  return <PlayClient slug={slug} />;
}

// The game itself is client-only (camera, WebGL). This server page only resolves the route param.
export default function PlayPage({ params }: PageProps<"/play/[slug]">) {
  return (
    <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#07060f" }} />}>
      <PlaySlug params={params} />
    </Suspense>
  );
}
