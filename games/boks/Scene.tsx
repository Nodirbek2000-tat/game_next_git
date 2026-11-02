"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type * as THREE from "three";
import { useGameFrame, useOverlayDraw } from "@/engine/game/context";
import type { SceneProps } from "@/engine/types";
import { BoksGame } from "./Game";

/** Boks scene: mounts the imperative game object and forwards the engine's frame / overlay callbacks. */
export function BoksScene({ engine }: SceneProps) {
  const root = useRef<THREE.Group>(null);
  const game = useRef<BoksGame | null>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const group = root.current;
    if (!group) return;
    const g = new BoksGame(engine, group, camera, gl);
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, [engine, camera, gl]);

  // the world also lives during the 3-2-1 (the partner sways, the gloves follow the hands)
  useGameFrame((dt) => game.current?.frame(dt), { duringCountdown: true });
  useOverlayDraw((c) => game.current?.draw(c));
  // what the first picture does not need (the spectators) arrives a few frames later, also while the engine shows its loading screen
  useFrame((_, dt) => game.current?.streamIn(Math.min(0.05, dt)));

  // The post pipeline (bloom for the loaded glove and the lamps, a soft vignette, SMAA) is high only and follows the quality
  // level while playing. The composer replaces the renderer's tone mapping while it exists, so ACES is applied as an effect.
  const [post, setPost] = useState(false);
  const composerOn = useRef(false);
  useEffect(() => {
    composerOn.current = post;
  }, [post]);
  useFrame(() => {
    const p = game.current?.postOn ?? false;
    if (p !== post) setPost(p);
  });
  // The engine draws the scene itself after every R3F frame callback below priority 1000, which would be a second full pass
  // under the composer. With the composer on, hide the game while the engine draws (it is left with the background only), show
  // it again, and let the composer draw last: one real render per frame.
  useFrame(() => {
    if (composerOn.current && root.current) root.current.visible = false;
  }, 999);
  useFrame(() => {
    if (root.current) root.current.visible = true;
  }, 1001);

  return (
    <>
      <group ref={root} />
      {post && (
        <EffectComposer multisampling={0} enableNormalPass={false} renderPriority={2000}>
          <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.88} luminanceSmoothing={0.3} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.3} darkness={0.5} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}
