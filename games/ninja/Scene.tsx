"use client";

import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { useGameFrame, useOverlayDraw } from "@/engine/game/context";
import type { SceneProps } from "@/engine/types";
import { NinjaRig } from "./rig";

/** Meva Ninja scene: an AR overlay (mirrored camera behind, transparent 3D canvas in front). */
export function NinjaScene({ engine }: SceneProps) {
  const root = useRef<THREE.Group>(null);
  const rig = useRef<NinjaRig | null>(null);

  useEffect(() => {
    const group = root.current;
    if (!group) return;
    const r = new NinjaRig(engine, group);
    rig.current = r;
    return () => {
      r.dispose();
      rig.current = null;
    };
  }, [engine]);

  useGameFrame((dt, now) => rig.current?.frame(dt, now));
  useOverlayDraw((c, e, now) => rig.current?.draw(c, e, now));

  return (
    <group ref={root}>
      <hemisphereLight args={[0xdde8ff, 0x302040, 0.75]} />
      <directionalLight args={[0xffffff, 1.25]} position={[-4, 6, 8]} />
      <directionalLight args={[0x88aaff, 0.5]} position={[5, -2, 4]} />
      {/* warm rim light from behind: lifts the silhouettes off the camera picture */}
      <directionalLight args={[0xffd6a0, 0.9]} position={[3, 4, -7]} />
    </group>
  );
}
