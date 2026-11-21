"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { DrawFn, EngineApi } from "../types";

export const EngineContext = createContext<EngineApi | null>(null);

/** The engine API for the current play session (inside a game `Scene`). */
export function useEngine(): EngineApi {
  const e = useContext(EngineContext);
  if (!e) throw new Error("useEngine() must be used inside a game Scene");
  return e;
}

/** Register a 2D painter on the engine's overlay canvas (trails, markers, tints). */
export function useOverlayDraw(fn: DrawFn): void {
  const engine = useEngine();
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => engine.onDraw((c, e, now) => ref.current(c, e, now)), [engine]);
}
