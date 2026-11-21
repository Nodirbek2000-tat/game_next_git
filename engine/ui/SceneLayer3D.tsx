"use client";

// The WebGL (three.js / React Three Fiber) layer of the play screen. Only the 3D games (meta.three) load this file: the 2D games
// never download three.js (~240 KB gzip), see PlayStage.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type ReactElement } from "react";
import * as THREE from "three";
import { EngineContext } from "../game/context";
import type { EngineRuntime } from "../runtime/runtime";
import { useRunUI } from "../runtime/runStore";
import type { GameModule } from "../types";
import { disposeTree } from "./disposeTree";

const SCENE_STATES = new Set(["preparing", "countdown", "play", "pause"]);

/** Runs the engine once per rendered frame (before the game's own useFrame callbacks) and applies dynamic resolution. */
function EngineDriver({ runtime }: { runtime: EngineRuntime }): null {
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);
  const last = useRef(0);
  useEffect(() => {
    runtime.setRenderer(gl as unknown as Parameters<EngineRuntime["setRenderer"]>[0]);
    return () => runtime.setRenderer(null);
  }, [gl, runtime]);
  useFrame((_, delta) => {
    runtime.step(performance.now(), delta);
    const pr = runtime.quality.pixelRatio;
    if (Math.abs(pr - last.current) > 0.01) {
      last.current = pr;
      setDpr(pr);
    }
  }, -1000);
  // A positive priority makes this the render step (R3F then no longer renders by itself). Nothing is drawn while no game scene is
  // active (camera / scan / menus: the canvas is empty and hidden) and on the frames a capped device (phones) skips.
  useFrame(({ gl: renderer, scene, camera }) => {
    if (runtime.drawNow && SCENE_STATES.has(runtime.state)) renderer.render(scene, camera);
  }, 1000);
  return null;
}

/** Mounts the game scene, pre-compiles its shaders (everything made visible once), tells the runtime when ready. */
function SceneHost({ runtime, module }: { runtime: EngineRuntime; module: GameModule }): ReactElement {
  const group = useRef<THREE.Group>(null);
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let alive = true;
    const hidden: THREE.Object3D[] = [];
    (async () => {
      scene.traverse((o) => {
        if (!o.visible) {
          hidden.push(o);
          o.visible = true;
        }
      });
      try {
        await Promise.race([gl.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 4000))]);
      } catch (e) {
        console.warn("shader precompile", e);
      }
      for (const o of hidden) o.visible = false;
      if (alive) runtime.sceneReady();
    })();
    const g = group.current;
    return () => {
      alive = false;
      if (g) disposeTree(g);
    };
  }, [gl, scene, camera, runtime]);
  const Scene = module.Scene;
  return (
    <group ref={group}>
      <EngineContext.Provider value={runtime}>
        <Scene engine={runtime} />
      </EngineContext.Provider>
    </group>
  );
}

export default function SceneLayer3D({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const state = useRunUI((s) => s.state);
  const show = SCENE_STATES.has(state);
  const mod = runtime.module;
  // the WebGL context is created once the device is known (quality level decides antialiasing / pixel ratio), not behind the camera dialog
  const deviceKnown = state !== "camera" && state !== "loading" && state !== "error";
  if (!deviceKnown) return <div className="hk-three" style={{ display: "none" }} />;
  return (
    <div className="hk-three" style={show ? undefined : { visibility: "hidden" }}>
      <Canvas
        frameloop="always"
        dpr={runtime.quality.pixelRatio}
        camera={{ fov: 50, position: [0, 0, 10], near: 0.1, far: 400 }}
        gl={{ alpha: true, antialias: runtime.quality.level === "high", powerPreference: "high-performance" }}
        shadows={runtime.quality.shadows}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <EngineDriver runtime={runtime} />
        {show && mod ? <SceneHost key={runtime.sessionId} runtime={runtime} module={mod} /> : null}
      </Canvas>
    </div>
  );
}
