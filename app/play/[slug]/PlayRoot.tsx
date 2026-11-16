"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GAME_LOADERS } from "@/engine/game/registry";
import { EngineRuntime } from "@/engine/runtime/runtime";
import { PlayStage } from "@/engine/ui/PlayStage";
import { PLAY_CSS } from "@/engine/ui/styles";
import { botLink, useAccount } from "@/lib/account/store";
import { backHref, getGame } from "@/lib/games";

/**
 * Production: a free game (set in the admin panel) is open to everybody, also without signing in; a premium game asks to sign in,
 * then for premium.
 * NEXT_PUBLIC_REQUIRE_LOGIN=0 turns the check off (local tests without the backend); dev builds never check.
 */
const GATE = process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_REQUIRE_LOGIN !== "0";

function Notice({ icon, title, text, back = "/oyinlar", children }: { icon: string; title: string; text: string; back?: string; children?: React.ReactNode }) {
  return (
    <div className="hk-root" data-testid="play-notice">
      <style>{PLAY_CSS}</style>
      <div className="hk-ov solid">
        <div className="hk-card hk-glass">
          <div style={{ fontSize: 64 }}>{icon}</div>
          <h2>{title}</h2>
          <p className="hk-lead">{text}</p>
          {children}
          <div className="hk-row" style={{ marginTop: 18 }}>
            <Link className={children ? "hk-btn ghost" : "hk-btn"} href={back}>
              ← Boshqa o‘yinlar
            </Link>
            <Link className="hk-btn ghost" href="/">
              Bosh sahifa
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Play screen of one game: creates the engine runtime and hands it to the stage. */
export default function PlayRoot({ slug }: { slug: string }) {
  const info = getGame(slug);
  const load = GAME_LOADERS[slug];
  const router = useRouter();
  const [runtime, setRuntime] = useState<EngineRuntime | null>(null);
  const { ready, me, config, load: loadAccount, canPlay } = useAccount();
  const free = config.freeGames.includes(slug);
  const allowed = !GATE || (ready && canPlay(slug));

  useEffect(() => {
    if (GATE) void loadAccount();
  }, [loadAccount]);
  useEffect(() => {
    if (GATE && ready && !me && !free) router.replace(`/kirish?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [ready, me, free, router]);

  useEffect(() => {
    if (!info || !load || !allowed) return;
    const q = new URLSearchParams(window.location.search);
    const rt = new EngineRuntime({
      slug,
      info,
      load,
      debug: q.get("debug") === "1",
      players: q.get("players") === "2" ? 2 : 1,
      worker: q.get("worker") !== "0",
      query: q,
      onExit: () => router.push(backHref(info)),
    });
    // the runtime is an external system (camera, WebGL, models) created once per slug
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRuntime(rt);
    return () => {
      rt.destroy();
      setRuntime(null);
    };
  }, [slug, info, load, router, allowed]);

  if (!info) return <Notice icon="🧭" title="O‘yin topilmadi" text="Bunday o‘yin yo‘q. Quyidagi ro‘yxatdan boshqa o‘yinni tanlang." />;
  if (!load) return <Notice icon={info.icon} title={`${info.title} — tez orada!`} text="Bu o‘yin ustida ishlayapmiz. Tez orada shu yerda o‘ynay olasiz. Hozircha boshqa o‘yinlarni sinab ko‘ring." back={backHref(info)} />;
  if (GATE && ready && me && !free && !canPlay(slug))
    return (
      <Notice icon="💎" title={`${info.title} — Premium o‘yin`} text="Bu o‘yin premium akkauntda ochiladi. Premiumni Telegram botimiz orqali bir necha daqiqada olasiz." back={backHref(info)}>
        <div className="hk-row" style={{ marginTop: 18 }}>
          <Link className="hk-btn" href="/premium" data-testid="go-premium">
            💎 Premium olish
          </Link>
          <a className="hk-btn ghost" href={botLink(config, "premium")} target="_blank" rel="noopener">
            Telegram bot
          </a>
        </div>
      </Notice>
    );
  if (!runtime) return <div style={{ position: "fixed", inset: 0, background: "#07060f" }} />;
  return <PlayStage runtime={runtime} />;
}
