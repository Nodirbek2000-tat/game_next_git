"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { DrawFn, EngineApi } from "../types";

export const EngineContext = createContext<EngineApi | null>(null);

/** The engine API for the current play session (inside a game `Scene`). */
export function useEngine(): EngineApi {
  const e = useContext(EngineContext);
  if (!e) throw new Error("useEngine() must be used inside a game Scene");
  return e;
}

export interface GameFrameOptions {
  /** also run while the 3-2-1 countdown is on (default false: only while playing) */
  duringCountdown?: boolean;
  /** R3F priority; keep <= 0 so the engine keeps rendering for you */
  priority?: number;
}

/**
 * Per-frame game logic. `dt` is clamped to 50 ms and the callback is NOT called while the game is paused,
 * in the menu, or finished — so games never need to check the run state themselves.
 * Do not allocate inside the callback (reuse vectors / pooled objects).
 */
export function useGameFrame(cb: (dt: number, now: number, engine: EngineApi) => void, opts: GameFrameOptions = {}): void {
  const engine = useEngine();
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useFrame((_, delta) => {
    const s = engine.state;
    if (s === "play" || (opts.duringCountdown && s === "countdown")) {
      ref.current(Math.min(0.05, Math.max(0.001, delta)), performance.now(), engine);
    }
  }, opts.priority ?? 0);
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
