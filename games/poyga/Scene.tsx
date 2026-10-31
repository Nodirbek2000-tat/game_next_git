"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type * as THREE from "three";
import { useGameFrame, useOverlayDraw } from "@/engine/game/context";
import type { SceneProps } from "@/engine/types";
import { PoygaGame } from "./Game";
import { LOD } from "./config";

/** Shahar simulyatori scene: mounts the imperative game object and forwards the engine's frame / overlay callbacks. */
export function PoygaScene({ engine }: SceneProps) {
  const root = useRef<THREE.Group>(null);
  const game = useRef<PoygaGame | null>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const group = root.current;
    if (!group) return;
    const g = new PoygaGame(engine, group, camera, gl);
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, [engine, camera, gl]);

  useGameFrame((dt) => game.current?.frame(dt), { duringCountdown: true });
  useOverlayDraw((c) => game.current?.draw(c));
  // while the engine compiles shaders and shows its loading screen the game frame does not run: stream the city meanwhile
  useFrame((_, dt) => {
    if (engine.state === "preparing") game.current?.preload(Math.min(0.05, dt));
  });

  // The post pipeline is high only, and follows the quality level while playing (the controller may lower it): ambient
  // occlusion (contact darkening under cars, at wall feet, in corners: it makes the city look solid), bloom (lamps, shop
  // windows, brake lights glow), a slight colour grade, a soft vignette and SMAA. Without it (medium, low) the renderer's own
  // tone mapping is used. The composer replaces the renderer's tone mapping while it exists (and puts it back when it goes),
  // so the tone mapping is applied here as an effect; both paths use ACES at the engine's exposure.
  const [post, setPost] = useState(() => LOD[engine.quality.level].post);
  const composerOn = useRef(post);
  useEffect(() => {
    composerOn.current = post;
  }, [post]);
  useFrame(() => {
    const p = LOD[engine.quality.level].post;
    if (p !== post) setPost(p);
  });
  // The engine draws the scene itself after every R3F frame callback below priority 1000, which would be a second full pass
  // under the composer (and would paint over its picture). With the composer on, hide the game while the engine draws (it is
  // left with the sky only), show it again, and let the composer draw last.
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
          <N8AO aoRadius={2.2} distanceFalloff={1.2} intensity={2.6} quality="medium" />
          <Bloom mipmapBlur intensity={0.45} luminanceThreshold={0.92} luminanceSmoothing={0.25} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <HueSaturation saturation={0.12} />
          <BrightnessContrast brightness={0.02} contrast={0.1} />
          <Vignette offset={0.32} darkness={0.38} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}
