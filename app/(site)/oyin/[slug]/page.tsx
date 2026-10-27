import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/site/page-shell";
import { Pictogram } from "@/components/site/pictogram";
import { GAMES, getGame } from "@/lib/games";
import { GESTURES } from "@/lib/gestures";

export function generateStaticParams() {
  return GAMES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/oyin/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) return {};
  return {
    title: game.title,
    description: `${game.short} ${game.description}`,
    alternates: { canonical: `/oyin/${game.slug}` },
    openGraph: { title: game.title, description: game.short, url: `/oyin/${game.slug}` },
  };
}

export default function GamePage({ params }: PageProps<"/oyin/[slug]">) {
  // params is a Promise; reading it must happen under Suspense (cacheComponents).
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <GameContent params={params} />
    </Suspense>
  );
}

async function GameContent({ params }: { params: PageProps<"/oyin/[slug]">["params"] }) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) notFound();
  const gestures = GESTURES[game.slug] ?? [];

  return (
    <Container className="py-6 sm:py-10">
      <div className="rise flex flex-col items-center text-center">
        <div
          aria-hidden="true"
          className="anim-float flex size-36 items-center justify-center rounded-[2.25rem] text-8xl sm:size-44 sm:text-9xl"
          style={{ background: `linear-gradient(145deg, ${game.color}59, ${game.color}1a)`, boxShadow: `0 24px 60px -24px ${game.color}` }}
        >
          {game.icon}
        </div>
        <h1 className="mt-8 font-display text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-tight tracking-tight">{game.title}</h1>
        <p className="mt-3 max-w-xl text-lg text-muted">{game.tip}</p>
        <ButtonLink href={`/play/${game.slug}`} prefetch={false} size="lg" className="mt-8 min-w-56">
          <span aria-hidden="true">▶</span> O‘ynash
        </ButtonLink>
      </div>

      {gestures.length > 0 && (
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {gestures.map((g) => (
            <li key={g.title} className="glass rounded-3xl p-4 text-center">
              <div className="mx-auto aspect-[5/6] w-full max-w-36">
                <Pictogram pose={g.pose} label={g.title} color={game.color} />
              </div>
              <h2 className="mt-2 font-display text-base font-bold">{g.title}</h2>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
