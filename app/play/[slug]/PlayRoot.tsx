"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GAME_LOADERS } from "@/engine/game/registry";
import { EngineRuntime } from "@/engine/runtime/runtime";
import { PlayStage } from "@/engine/ui/PlayStage";
import { PLAY_CSS } from "@/engine/ui/styles";
import { getGame } from "@/lib/games";

function Notice({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="hk-root" data-testid="play-notice">
      <style>{PLAY_CSS}</style>
      <div className="hk-ov solid">
        <div className="hk-card hk-glass">
          <div style={{ fontSize: 64 }}>{icon}</div>
          <h2>{title}</h2>
          <p className="hk-lead">{text}</p>
          <div className="hk-row" style={{ marginTop: 18 }}>
            <Link className="hk-btn" href="/oyinlar">
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

  useEffect(() => {
    if (!info || !load) return;
    const q = new URLSearchParams(window.location.search);
    const rt = new EngineRuntime({
      slug,
      info,
      load,
      debug: q.get("debug") === "1",
      players: q.get("players") === "2" ? 2 : 1,
      worker: q.get("worker") !== "0",
      query: q,
      onExit: () => router.push("/oyinlar"),
    });
    // the runtime is an external system (camera, WebGL, models) created once per slug
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRuntime(rt);
    return () => {
      rt.destroy();
      setRuntime(null);
    };
  }, [slug, info, load, router]);

  if (!info) return <Notice icon="🧭" title="O‘yin topilmadi" text="Bunday o‘yin yo‘q. Quyidagi ro‘yxatdan boshqa o‘yinni tanlang." />;
  if (!load) return <Notice icon={info.icon} title={`${info.title} — tez orada!`} text="Bu o‘yin ustida ishlayapmiz. Tez orada shu yerda o‘ynay olasiz. Hozircha boshqa o‘yinlarni sinab ko‘ring." />;
  if (!runtime) return <div style={{ position: "fixed", inset: 0, background: "#07060f" }} />;
  return <PlayStage runtime={runtime} />;
}
