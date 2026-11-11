"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { registerAssetCache, warmWhenIdle } from "@/engine/net/assetCache";
import { trackVisitOnce } from "@/engine/net/stats";

/**
 * Registers the asset cache (service worker) on every page, and on the site pages (the menu) downloads the engine of the games
 * listed there in the background: the Bog'cha pages the MoveNet model, the others MediaPipe. A game chosen afterwards opens without
 * waiting for them. The play screen warms its own engine (engine/runtime). Also counts the visit (engine/net/stats.ts).
 */
export function AssetWarmup() {
  const path = usePathname() ?? "/";
  useEffect(() => {
    void registerAssetCache();
    trackVisitOnce();
    if (path.startsWith("/play/")) return;
    return warmWhenIdle(path.startsWith("/bogcha") ? "movenet" : "mediapipe");
  }, [path]);
  return null;
}
