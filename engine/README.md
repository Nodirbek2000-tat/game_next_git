# Harakat o‘yinlari — engine (`game_next/engine/`)

Camera → MediaPipe → player lock → gestures → **your game** → results. One engine, every game is a lazy module.

```
engine/
  camera/       getUserMedia, device list, permission guides (Android/iPhone/Mac/Windows, Telegram/file viewer)
  tracking/     detector (worker + main thread fallback), OneEuro, people, playerLock (1–2 players), scan,
                gestures, legCalibration, blades (hand points + 140 ms dropout bridge), tracker (capture-time prediction),
                prediction (latency tracker), lowLight (dark-frame compensation), scheduler (detection rate)
  calibration/  light / full-body / distance check (10 s window)
  audio/        synthesised sfx + music (Web Audio, no files)
  quality/      detect-gpu (self-hosted benchmarks) + live fps -> high | medium | low, dynamic resolution
  fx/           2D particles, popups, stains, shake, flash + drawing helpers
  runtime/      EngineRuntime (state machine, implements EngineApi) + zustand UI store
  ui/           PlayStage (video + R3F canvas + fx canvas + HUD/overlays), dwell cursor, styles
  game/         contract hooks (useEngine / useGameFrame / useOverlayDraw) and the lazy registry
  settings/     persisted user settings (zustand persist, key `harakat.settings`)
  testing/      synthetic skeletons for unit tests and the `window.__fake` autopilot
```

## Game module contract

A game lives in `game_next/games/<slug>/` (slug = the one in `lib/games.ts`) and **default-exports a `GameModule`**:

```ts
// games/<slug>/index.ts
import type { GameModule } from "@/engine";
import { MyScene } from "./Scene";

const game: GameModule = {
  meta: {
    slug: "meva-ninja",
    maxPlayers: 2,      // 1 = single player only, 2 = also supports two players side by side
    needsHands: false,  // true -> HandLandmarker is loaded (finger level); otherwise it is never downloaded
    needsLegs: false,   // true -> calibration insists on the full body (knees/ankles) being visible
    world: false,       // false = AR overlay over the mirrored camera, true = own 3D world (camera becomes a small PiP)
    dim: 0.62,          // camera brightness behind an AR game
  },
  Scene: MyScene,       // rendered INSIDE the engine's <Canvas>
};
export default game;
```

Register it with **one line** in `engine/game/registry.ts` (`"slug": () => import("@/games/<slug>")`). That is what keeps the
home page free of game code: only `/play/<slug>` loads the engine chunk, and only that game's chunk.

### What the Scene receives

`Scene({ engine })` — `engine` is an `EngineApi` (also available through `useEngine()`):

| field | meaning |
|---|---|
| `players: PlayerFrame[]` | 1 or 2 entries, reused every frame (never reallocated while a Scene is mounted) |
| `players[i].lm[0..32]` | **filtered + extrapolated** landmarks in *stage px* (CSS px, mirrored, cover-fitted). `{x, y, v}` |
| `players[i].raw` | latest unfiltered landmarks (same units) |
| `players[i].blades[0|1]` | fast hand points: `{active, x, y, px, py, vx, vy, speed}` (`speed` in screen heights / s) |
| `players[i].hands.L/R` | `HandInfo` (21 pts, `shape`, `palm`) when `needsHands` |
| `players[i].legs` | `{gas, brake, ok, rest}` — knee lift 0..1, calibrated from the standing leg |
| `players[i].gestures` | `handsAboveHead`, `handUp.L/R`, `kneeUp.L/R`, `shape.L/R`, `crank.L/R` (circles/s), `wristVel`, `swipe.L/R` (`fired` one frame) |
| `players[i].present`, `.lostFor`, `.scale`, `.center`, `.headR`, `.dominant` (`"L"/"R"` from left-handed mode), `.color` |
| `playerCount`, `kids`, `leftHanded`, `sensitivity` | settings / mode |
| `quality` | `{level, pixelRatio, shadows, postfx, viewDistance, particles}` — live, adapts to fps |
| `audio` | `slice() splat() boom() coin() good() bad() combo(n) beep() ... musicStart(bpm) musicStop() engineSet() ...` |
| `fx` | `burst popup ring particle stain shake flash` (2D layer, CSS px) |
| `hud` | `set({title, score, combo, time, timeLabel, lives, bar})`, `setPlayer(slot, {score, label, extra})` |
| `config` | all numeric thresholds (`config.gestures.swipeSpeed`, ...) — prototype values, scaled by sensitivity |
| `keys` | keyboard fallback (`ArrowUp`, `r`, ...) |
| `query` | `URLSearchParams` of the page (tests use e.g. `?duration=10`) |
| `screenToWorld(x, y, z, out)`, `pxToWorld(z)` | helpers for the default AR camera (fov 50 at z = 10) |
| `finish({score, lines, players?, stats?})` | end the game: engine shows "tugadi", stars, record and the results screen |

Hooks:

* `useGameFrame((dt, now, engine) => …)` — your logic; called **only while playing** (not in menu / countdown / pause), `dt` ≤ 50 ms.
* `useOverlayDraw((ctx, engine, now) => …)` — draw on the 2D overlay (trails, markers). Runs also while paused.

### Rules every game must follow

1. **No allocation in the frame loop** — pool meshes/vectors/particles, reuse scratch objects (see `games/ninja/rig.ts`).
2. **Build everything at mount** (inside `useEffect` / JSX). The engine makes every object visible once and calls
   `renderer.compileAsync` before the countdown, so shaders are ready before "3-2-1". Hidden pooled objects are included.
3. **Dispose on exit.** The engine disposes the geometries/materials/textures under your Scene group
   (mark shared ones with `userData.keep = true`); free anything created outside the scene graph in the effect cleanup.
4. Respect `engine.quality` (shadows, postfx, density) and `engine.kids` / `engine.leftHanded` / `engine.sensitivity`.
5. UI texts: Uzbek, Latin only. Camera frames never leave the device — never upload anything derived from them.
6. Pause, countdown, player-lost handling, results, record in localStorage, sound unlock: engine's job, not yours.

### Minimal example

```tsx
"use client";
import { useMemo, useRef } from "react";
import type * as THREE from "three";
import { useGameFrame, type SceneProps } from "@/engine";

export function MyScene({ engine }: SceneProps) {
  const ball = useRef<THREE.Mesh>(null);
  const p = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);   // scratch, reused every frame
  const score = useRef(0);

  useGameFrame(() => {
    const hand = engine.players[0].blades[1];            // right hand point
    if (!hand.active || !ball.current) return;
    engine.screenToWorld(hand.x, hand.y, 0, p);
    ball.current.position.set(p.x, p.y, 0);
    if (engine.players[0].gestures.swipe.R.fired) {
      score.current += 10;
      engine.hud.set({ score: score.current });
      engine.audio.good();
      if (score.current >= 100) engine.finish({ score: score.current, lines: [["Urinishlar", score.current / 10]] });
    }
  });

  return (
    <mesh ref={ball}>
      <sphereGeometry args={[0.5, 24, 16]} />
      <meshStandardMaterial color="hotpink" />
    </mesh>
  );
}
```

(Lights are part of your Scene: `<hemisphereLight/>`, `<directionalLight/>`.)

## Run-time flow (TZ §4.3)

`camera` (instant browser prompt; on denial a device specific guide + retry) → `loading` (progress + tips; game chunk,
detect-gpu, wasm, pose model — hand model only if `needsHands`) → `scan` (calibration: full body / light / distance,
then raise both hands above the head for 1.4 s; 1 or 2 players) → `ready` (dwell menu: hold the raised hand over a
button) → `preparing` (mount + shader precompile) → `countdown` → `play` ⇄ `pause` (button, hidden tab, player lost >1.2 s)
→ `results` (stars, record, "Qayta o‘ynash").

Debug: `/play/<slug>?debug=1` shows fps, camera fps, **measured camera→screen latency** (target < 80 ms; split into
wait / model / apply / worst), detection cap, camera fps, light level, people, who is locked, current gesture, tracking back-end.
Other query flags: `?players=2`, `?worker=0` (force main-thread tracking).

## Speed, latency and robustness (tracking comes first, graphics second)

* **Camera**: 640x360 @ 30 fps requested (`camera/camera.ts`); when the light is good and the model is fast the runtime asks for 60 fps
  (half the capture delay) and goes back to 30 in a dim room (longer exposure).
* **Newest frame only**: detection is driven by `requestVideoFrameCallback`; frames that arrive while the model is busy are dropped,
  never queued. The result is applied the moment it arrives (not at the next render frame).
* **Capture-time prediction** (`tracking/prediction.ts`, `blades.ts`, `tracker.ts`): filters, velocities and acceleration run on the camera
  *capture* time; every render frame (also the one with a new detection) moves the hands/blades to where the hand is *now*
  (`capture position + v·Δt + ½·a·Δt²`, Δt = now − capture + 8 ms display lead, ≤ 120 ms; a braking hand stops instead of flying back; a soft
  dead zone keeps a resting hand from trembling). Games draw trails from `blade.x/y` with no extra smoothing.
* **One Euro** `minCutoff 1.2, beta 10, dCutoff 4`: sweep error ~4x lower than before at the same resting jitter.
* **Low light** (`tracking/lowLight.ts`): ~10 Hz luma statistics on the 160x90 snapshot; when dark or flat the frame sent to the model is
  brightened (contrast stretch + gamma LUT on a ≤ 640 px canvas, only then), MediaPipe confidence drops 0.5 → 0.35 in steps, the player lock leans on
  position instead of clothing colour, blades accept lower visibility. A gentle toast appears only when the room stays really dark.
* **Run everywhere** (`quality/*`, `tracking/scheduler.ts`): lite pose model by default; start quality from detect-gpu, CPU cores, memory and
  software-renderer detection; fps below 78 % of target lowers resolution (to 0.5 on "low") within ~1.5 s, below 50 % drops a whole level at once,
  last resort squeezes particles / view distance; recovery is slow (12 s, doubling). The detection rate (60/45/30/24/20/15 per s) is lowered only when the
  graphics are already at the floor (or the model runs on the main thread). No WebGL at all shows a clear error instead of a blank screen.

## Testing hooks

* `window.__fake = (now) => ({ pose: { landmarks: [[33 × {x,y,z,visibility}], …] }, hand: null })` — when defined, the camera
  is **not analysed**; the returned result is used every frame (normalised, un-mirrored camera coordinates — exactly like MediaPipe).
  Models are not even downloaded. `window.__smallFixed` (160×90 RGBA `Uint8ClampedArray`) replaces the camera frame used for
  clothing colours. `engine/testing/skeleton.ts` builds skeletons; `e2e/fixtures.ts` shows a full autopilot.
* `window.__engine` — the live `EngineRuntime` (state, players, tracker…) for tests and debugging.

## Assets (self-hosted, never a CDN)

`public/mediapipe/*` (wasm + `vision_bundle.js`, used by the worker), `public/models/*.task`, `public/detect-gpu/*.json`,
`public/engine/tracking-worker.js` (classic worker: MediaPipe's loader needs `importScripts`).
Helper: `node scripts/sync-engine-assets.mjs` re-copies `vision_bundle.js` and the detect-gpu benchmarks from `node_modules`
after a dependency update.
