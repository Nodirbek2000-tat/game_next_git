"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type * as THREE from "three";
import { useGameFrame, useOverlayDraw } from "@/engine/game/context";
import type { SceneProps } from "@/engine/types";
import { MashinaGame } from "./Game";
import { LOD, effectiveLevel } from "./render/lod";

/**
 * Mashina haydash scene: our own 3D world (the camera picture becomes a small picture-in-picture).
 * The imperative game object owns the three.js objects, the Rapier world and the logic; this component only
 * mounts / unmounts it, forwards the engine's frame and overlay callbacks and owns the post pipeline.
 */
export function MashinaScene({ engine }: SceneProps) {
  const root = useRef<THREE.Group>(null);
  const game = useRef<MashinaGame | null>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const group = root.current;
    if (!group) return;
    const g = new MashinaGame(engine, group, camera, gl);
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, [engine, camera, gl]);

  useGameFrame((dt, now) => game.current?.frame(dt, now), { duringCountdown: true });
  useOverlayDraw((c, e, now) => game.current?.draw(c, e, now));
  // while the engine compiles shaders and shows its loading screen the game frame does not run: build the district meanwhile
  useFrame((_, dt) => {
    if (engine.state === "preparing") game.current?.preload(Math.min(0.05, dt));
  });

  // The post pipeline is high only (the level table in render/lod.ts) and follows the quality level while playing (the controller
  // may lower it): ambient occlusion (contact darkening under cars and at wall feet), bloom (lamps, windows, brake lights glow), a
  // slight colour grade, a soft vignette and SMAA. Without it (medium, low) the renderer's own tone mapping is used. The composer
  // replaces the renderer's tone mapping while it exists, so the tone mapping is applied here as an effect; both paths use ACES.
  // The level it was built for caps it (as in the game object): a game that started lower never gets the pipeline.
  const [built] = useState(() => engine.quality.level);
  const wants = () => LOD[effectiveLevel(built, engine.quality.level)].post;
  const [post, setPost] = useState(wants);
  const composerOn = useRef(post);
  useEffect(() => {
    composerOn.current = post;
  }, [post]);
  useFrame(() => {
    const p = wants();
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
          <N8AO aoRadius={2.2} distanceFalloff={1.2} intensity={2.2} quality="medium" />
          <Bloom mipmapBlur intensity={0.4} luminanceThreshold={0.92} luminanceSmoothing={0.25} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <HueSaturation saturation={0.1} />
          <BrightnessContrast brightness={0.02} contrast={0.08} />
          <Vignette offset={0.32} darkness={0.35} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}
