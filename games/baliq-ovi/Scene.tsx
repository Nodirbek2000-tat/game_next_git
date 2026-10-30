"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { useOverlayDraw, type SceneProps } from "@/engine";
import { BaliqRig } from "./game";
import { SPECIES } from "./species";

declare global {
  interface Window {
    /** test / debug hook: snapshot of the running game */
    __baliq?: { snapshot(): Record<string, unknown>; rig: BaliqRig; species: typeof SPECIES };
  }
}

/** Baliq ovi scene: our own 3D world (the camera picture becomes a small PiP). */
export function BaliqScene({ engine }: SceneProps) {
  const root = useRef<THREE.Group>(null);
  const rig = useRef<BaliqRig | null>(null);
  const { scene, camera, gl } = useThree();

  useEffect(() => {
    const group = root.current;
    if (!group) return;
    const r = new BaliqRig(engine, group, { scene, camera, gl });
    rig.current = r;
    window.__baliq = { snapshot: () => r.snapshot(), rig: r, species: SPECIES };
    return () => {
      r.dispose();
      rig.current = null;
      delete window.__baliq;
    };
  }, [engine, scene, camera, gl]);

  useFrame((_, delta) => rig.current?.tick(delta));
  useOverlayDraw((c, e, now) => rig.current?.draw(c, e, now));

  return <group ref={root} />;
}
