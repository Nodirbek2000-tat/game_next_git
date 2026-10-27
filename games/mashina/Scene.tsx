"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { useGameFrame, useOverlayDraw } from "@/engine/game/context";
import type { SceneProps } from "@/engine/types";
import { MashinaGame } from "./Game";

/**
 * Mashina haydash scene: our own 3D world (the camera picture becomes a small picture-in-picture).
 * The imperative game object owns the three.js objects, the Rapier world and the logic; this component only
 * mounts / unmounts it and forwards the engine's frame and overlay callbacks.
 */
export function MashinaScene({ engine }: SceneProps) {
  const root = useRef<THREE.Group>(null);
  const game = useRef<MashinaGame | null>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useEffect(() => {
    const group = root.current;
    if (!group) return;
    const g = new MashinaGame(engine, group, camera);
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, [engine, camera]);

  useGameFrame((dt, now) => game.current?.frame(dt, now), { duringCountdown: true });
  useOverlayDraw((c, e, now) => game.current?.draw(c, e, now));

  return <group ref={root} />;
}
