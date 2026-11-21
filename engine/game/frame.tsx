"use client";

// Per-frame logic of a 3D game (React Three Fiber): kept apart from context.tsx so the 2D games never load React Three Fiber.

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { EngineApi } from "../types";
import { useEngine } from "./context";

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
