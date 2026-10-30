"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type * as THREE from "three";
import { useGameFrame, useOverlayDraw } from "@/engine/game/context";
import type { SceneProps } from "@/engine/types";
import { PoygaGame } from "./Game";

/** Cheksiz poyga scene: mounts the imperative game object and forwards the engine's frame / overlay callbacks. */
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

  // smooth edges everywhere but on the weakest devices (SMAA is cheap); on strong ones also bloom (lamps, shop windows,
  // brake lights glow), a slight colour grade and a soft vignette. The composer replaces the renderer's tone mapping,
  // so the tone mapping is applied here as an effect.
  const level = engine.quality.level;
  const post = engine.quality.postfx;
  // ambient occlusion (N8AO: contact darkening under cars, at wall feet, in corners) is what makes the city look solid
  const fx = [
    <N8AO key="ao" aoRadius={2.2} distanceFalloff={1.2} intensity={post ? 2.6 : 2.2} halfRes={!post} quality={post ? "medium" : "low"} />,
    post ? <Bloom key="b" mipmapBlur intensity={0.45} luminanceThreshold={0.92} luminanceSmoothing={0.25} /> : null,
    <ToneMapping key="t" mode={ToneMappingMode.ACES_FILMIC} />,
    <HueSaturation key="h" saturation={0.12} />,
    <BrightnessContrast key="c" brightness={0.02} contrast={0.1} />,
    post ? <Vignette key="v" offset={0.32} darkness={0.38} /> : null,
    <SMAA key="s" />,
  ].filter((x) => x !== null);
  return (
    <>
      <group ref={root} />
      {level !== "low" && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          {fx}
        </EffectComposer>
      )}
    </>
  );

}
