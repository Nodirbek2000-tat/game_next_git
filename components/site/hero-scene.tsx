"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { HeroFallback } from "./hero-fallback";

const HeroCanvas = dynamic(() => import("./hero-canvas"), { ssr: false });

type NetInfo = { saveData?: boolean; effectiveType?: string };

/** Cheap synchronous checks first; GPU benchmark (detect-gpu) only if those pass. */
async function shouldRender3D(): Promise<boolean> {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const nav = navigator as Navigator & { connection?: NetInfo; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if (nav.connection?.effectiveType && /(^|-)2g|3g/.test(nav.connection.effectiveType)) return false;
  if ((nav.hardwareConcurrency ?? 4) <= 2 || (nav.deviceMemory ?? 4) <= 2) return false;
  const canvas = document.createElement("canvas");
  if (!(canvas.getContext("webgl2") || canvas.getContext("webgl"))) return false;
  try {
    const { getGPUTier } = await import("detect-gpu");
    // Benchmarks come from detect-gpu's CDN; if it is slow/blocked we do not wait - cheap checks above already passed.
    const tier = await Promise.race([
      getGPUTier().then((t) => t.tier),
      new Promise<number>((r) => setTimeout(() => r(2), 1500)),
    ]);
    return tier >= 2;
  } catch {
    return true;
  }
}

/**
 * Hero art. The CSS/SVG fallback is server-rendered (instant LCP); the R3F canvas streams in on idle
 * and cross-fades over it only on capable devices.
 */
export function HeroScene() {
  const [use3D, setUse3D] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const start = () =>
      shouldRender3D().then((ok) => {
        if (!cancelled && ok) setUse3D(true);
      });
    // Safari lacks requestIdleCallback; fall back to a short timeout.
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = ric ? ric(start, { timeout: 1200 }) : window.setTimeout(start, 300);
    return () => {
      cancelled = true;
      if (ric) window.cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, []);

  return (
    <div className="relative size-full">
      <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-0" : "opacity-100"}`}>
        <HeroFallback />
      </div>
      {use3D && (
        <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}>
          <HeroCanvas onReady={() => setReady(true)} />
        </div>
      )}
    </div>
  );
}
