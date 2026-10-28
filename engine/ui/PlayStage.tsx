"use client";

import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type ReactElement } from "react";
import * as THREE from "three";
import { EngineContext } from "../game/context";
import type { EngineRuntime } from "../runtime/runtime";
import { useRunUI } from "../runtime/runStore";
import { useSettings } from "../settings/store";
import type { GameModule } from "../types";
import { PLAY_CSS } from "./styles";

const SCENE_STATES = new Set(["preparing", "countdown", "play", "pause"]);
const backOf = (runtime: EngineRuntime): string => (runtime.info.audience === "bogcha" ? "/bogcha" : "/oyinlar");

/** Dispose geometries, materials and textures below `root` (skips anything flagged `userData.keep`). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData?.keep) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (mat.userData?.keep) continue;
      for (const key of Object.keys(mat)) {
        const v = (mat as unknown as Record<string, unknown>)[key];
        if (v instanceof THREE.Texture && !v.userData?.keep) v.dispose();
      }
      mat.dispose();
    }
  });
}

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

/** Crowd (Bog‘cha) games: no WebGL at all. The scene only registers a 2D painter; a plain rAF loop drives the engine. */
function CrowdHost({ runtime, module }: { runtime: EngineRuntime; module: GameModule }): ReactElement {
  useEffect(() => {
    runtime.sceneReady();
  }, [runtime]);
  const Scene = module.Scene;
  return (
    <EngineContext.Provider value={runtime}>
      <Scene engine={runtime} />
    </EngineContext.Provider>
  );
}

function CrowdLayer({ runtime }: { runtime: EngineRuntime }): ReactElement | null {
  const state = useRunUI((s) => s.state);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (): void => {
      const now = performance.now();
      runtime.step(now, (now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime]);
  const mod = runtime.module;
  return SCENE_STATES.has(state) && mod ? <CrowdHost key={runtime.sessionId} runtime={runtime} module={mod} /> : null;
}

function SceneLayer({ runtime }: { runtime: EngineRuntime }): ReactElement {
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

function Hud({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const hud = useRunUI((s) => s.hud);
  const state = useRunUI((s) => s.state);
  const muted = !useSettings((s) => s.sound);
  const two = runtime.playerCount === 2;
  const on = hud.on && state !== "results";
  return (
    <>
      <div className={`hk-hud${on ? " on" : ""}`}>
        <div className="hk-hcard hk-glass">
          <div className="hk-htitle">{hud.title || "—"}</div>
          <div className="hk-hbar">
            <i style={{ width: `${hud.bar * 100}%` }} />
          </div>
        </div>
        {!two && (
          <div className="hk-hcard hk-glass hk-hmid">
            <small>Ochko</small>
            <b data-testid="hud-score">{hud.score.toLocaleString("en-US").replace(/,/g, " ")}</b>
          </div>
        )}
        {two && <div className="hk-hmid" />}
        {hud.combo !== null && (
          <div className="hk-hcard hk-glass hk-combo">
            <small>Kombo</small>
            <b>{hud.combo}</b>
          </div>
        )}
        {hud.time !== null && (
          <div className="hk-hcard hk-glass">
            <small>{hud.timeLabel}</small>
            <b data-testid="hud-time">{hud.time}</b>
          </div>
        )}
        {hud.lives !== null && (
          <div className="hk-hcard hk-glass">
            <small>Jon</small>
            <b>{hud.lives}</b>
          </div>
        )}
      </div>
      {on && two &&
        hud.players.map((p, i) => (
          <div key={i} className={`hk-pl hk-glass p${i}`}>
            <small>{p.label || `${i + 1}-o‘yinchi`}</small>
            <b>{p.score.toLocaleString("en-US").replace(/,/g, " ")}</b>
            {p.extra ? <div className="hk-muted">{p.extra}</div> : null}
          </div>
        ))}
      <div className="hk-btns">
        <button aria-label="Pauza" title="Pauza (P)" onClick={() => (runtime.state === "play" ? runtime.pause("manual") : runtime.resume())}>
          ⏸
        </button>
        <button aria-label="Ovoz" title="Ovoz (M)" onClick={() => runtime.toggleMute()}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button
          aria-label="To‘liq ekran"
          title="To‘liq ekran"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen?.().catch(() => undefined);
          }}
        >
          ⛶
        </button>
      </div>
    </>
  );
}

function CameraOverlay({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const ui = useRunUI();
  const problem = ui.problem;
  return (
    <div className="hk-ov solid" data-testid="camera-overlay">
      <div className="hk-card">
        <div className="hk-icon" aria-hidden="true">
          {runtime.info.icon}
        </div>
        <h1>{runtime.info.title}</h1>
        <p className={`hk-lead${problem ? " hk-err" : ""}`} data-testid="camera-status">
          {ui.problemStatus}
        </p>
        {ui.guide && (
          <details className="hk-guide" data-testid="camera-guide" open>
            <summary>{ui.guide.title}</summary>
            <ol>
              {ui.guide.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </details>
        )}
        <p className="hk-muted" style={{ marginTop: 18 }}>
          🔒 Kamera tasviri qurilmangizdan chiqmaydi
        </p>
        <div className="hk-row" style={{ marginTop: 18 }}>
          {problem && (
            <button className="hk-btn" onClick={() => void runtime.retryCamera()}>
              ↻ Qayta urinish
            </button>
          )}
          <Link className="hk-btn ghost" href={backOf(runtime)}>
            ← Orqaga
          </Link>
        </div>
      </div>
    </div>
  );
}

function LoadingOverlay({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const l = useRunUI((s) => s.loading);
  return (
    <div className="hk-ov solid" data-testid="loading-overlay">
      <div className="hk-card">
        <div className="hk-icon" aria-hidden="true">
          {runtime.info.icon}
        </div>
        <h2>{runtime.info.title}</h2>
        <div className="hk-bar">
          <i style={{ width: `${l.pct}%` }} />
        </div>
        <div className="hk-pct">{l.pct}%</div>
        <div className="hk-muted">{l.label}</div>
        <div className="hk-tip">{l.tip}</div>
      </div>
    </div>
  );
}

function ErrorOverlay({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const text = useRunUI((s) => s.errorText);
  return (
    <div className="hk-ov solid">
      <div className="hk-card">
        <h2>Xatolik</h2>
        <p className="hk-lead hk-err">{text}</p>
        <div className="hk-row" style={{ marginTop: 16 }}>
          <button className="hk-btn" onClick={() => location.reload()}>
            ↻ Qayta yuklash
          </button>
          <button className="hk-btn ghost" onClick={() => runtime.exit()}>
            ← Orqaga
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanOverlay({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const s = useRunUI((u) => u.scan);
  const c = s.calib;
  const check = (label: string, state: "ok" | "bad" | "idle"): ReactElement => (
    <span className={state === "idle" ? "" : state}>
      {state === "ok" ? "✓ " : state === "bad" ? "✗ " : "· "}
      {label}
    </span>
  );
  const body = !c ? "idle" : c.fullBody === "ok" ? "ok" : c.fullBody === "cut" ? "bad" : "idle";
  const light = !c ? "idle" : c.light === "ok" ? "ok" : c.light === "unknown" ? "idle" : "bad";
  const dist = !c ? "idle" : c.distance === "ok" ? "ok" : c.distance === "unknown" ? "idle" : "bad";
  return (
    <div className="hk-ov dim" data-testid="scan-overlay">
      <div className="hk-card hk-glass">
        <h2 data-testid="scan-title">{s.title}</h2>
        {s.canPickPlayers && (
          <div className="hk-modes">
            <button data-dwell className={s.players === 1 ? "on" : ""} onClick={() => runtime.setPlayerCount(1)}>
              👤 1 o‘yinchi
            </button>
            <button data-dwell className={s.players === 2 ? "on" : ""} onClick={() => runtime.setPlayerCount(2)}>
              👥 2 o‘yinchi
            </button>
          </div>
        )}
        <div className="hk-ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="8" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="url(#hk-sg)" strokeWidth="8" strokeLinecap="round" strokeDasharray="276.5" strokeDashoffset={276.5 * (1 - s.progress)} />
            <defs>
              <linearGradient id="hk-sg">
                <stop offset="0" stopColor="#22d3ee" />
                <stop offset="1" stopColor="#7c5cff" />
              </linearGradient>
            </defs>
          </svg>
          <div className="big">{s.icon}</div>
        </div>
        <div className="hk-muted" data-testid="scan-info">
          {s.info}
        </div>
        <div className="hk-checks">
          {check(s.needsLegs ? "Butun tana kadrda" : "Tana kadrda", body)}
          {check("Yorug‘lik", light)}
          {check("Masofa", dist)}
        </div>
        <div className="hk-warn">{c?.message ?? ""}</div>
        <div className="hk-row" style={{ marginTop: 10 }}>
          <button className="hk-btn ghost" data-dwell onClick={() => runtime.skipScan()} data-testid="scan-skip">
            Skansiz o‘ynash
          </button>
          <Link className="hk-btn ghost" href={backOf(runtime)}>
            ← Orqaga
          </Link>
        </div>
        <div className="hk-muted" style={{ marginTop: 10 }}>
          {s.secondsLeft} s
        </div>
      </div>
    </div>
  );
}

function ReadyOverlay({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const info = runtime.info;
  if (runtime.crowd) {
    return (
      <div className="hk-ov dim hk-kids" data-testid="ready-overlay">
        <div className="hk-card hk-glass hk-big">
          <div className="hk-icon" aria-hidden="true">
            {info.icon}
          </div>
          <h1>{info.title}</h1>
          <p className="hk-lead">{info.tip}</p>
          <p className="hk-muted" style={{ marginTop: 6 }}>
            Bolalar kameradan 2–3 metr uzoqroq tursin
          </p>
          <div className="hk-row" style={{ marginTop: 22 }}>
            <button className="hk-btn" data-dwell data-testid="start-btn" onClick={() => runtime.startGame()}>
              ▶ Boshlash
            </button>
          </div>
          <div className="hk-row hk-sub">
            <button className="hk-btn ghost" onClick={() => runtime.exit()}>
              ← Orqaga
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="hk-ov dim" data-testid="ready-overlay">
      <div className="hk-card hk-glass hk-big">
        <div className="hk-hrow">
          <div className="hk-icon sm" aria-hidden="true">
            {info.icon}
          </div>
          <h1>{info.title}</h1>
        </div>
        <p className="hk-lead">{info.tip}</p>
        <div className="hk-row" style={{ marginTop: 22 }}>
          <button className="hk-btn" data-dwell data-testid="start-btn" onClick={() => runtime.startGame()}>
            ▶ Boshlash
          </button>
        </div>
        <div className="hk-row hk-sub">
          <button className="hk-btn ghost" data-dwell onClick={() => runtime.rescan()}>
            🔄 Qayta skanerlash
          </button>
          <button className="hk-btn ghost" data-dwell onClick={() => runtime.exit()}>
            ← Orqaga
          </button>
        </div>
        <details className="hk-more">
          <summary>Qoidalar</summary>
          <ul className="hk-rules">
            {info.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
        <p className="hk-muted" style={{ marginTop: 12 }}>
          Qo‘lni tugma ustida ushlab turing
        </p>
      </div>
    </div>
  );
}

function PauseOverlay({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const p = useRunUI((s) => s.pause);
  return (
    <div className="hk-ov dim" data-testid="pause-overlay">
      <div className="hk-card hk-glass hk-big" style={{ width: "min(560px,100%)" }}>
        <div className="hk-icon" aria-hidden="true">
          {p.reason === "lost" ? "👀" : "⏸"}
        </div>
        <h2>{p.title}</h2>
        <p className="hk-muted" style={{ marginBottom: 18 }}>
          {p.sub}
        </p>
        <div className="hk-row">
          <button className="hk-btn" data-dwell onClick={() => runtime.resume()}>
            ▶ Davom etish
          </button>
          <button className="hk-btn ghost" data-dwell onClick={() => runtime.exit()}>
            ☰ Chiqish
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultsOverlay({ runtime }: { runtime: EngineRuntime }): ReactElement | null {
  const r = useRunUI((s) => s.results);
  if (!r) return null;
  if (r.crowd) {
    return (
      <div className="hk-ov dim hk-kids" data-testid="results-overlay">
        <div className="hk-card hk-glass hk-big" style={{ width: "min(860px,100%)" }}>
          <div className="hk-icon" aria-hidden="true">
            🎉
          </div>
          <h1 data-testid="crowd-title">Barakalla!</h1>
          <div className="hk-stars" data-testid="result-stars" aria-label={`${r.score} yulduz`}>
            {"⭐".repeat(Math.min(r.score, 30))}
          </div>
          {r.kids && r.kids.length > 0 && (
            <div className="hk-kidrow">
              {r.kids.map((k) => (
                <div key={k.slot} style={{ ["--kc" as string]: k.color }}>
                  <b aria-hidden="true">{k.emoji}</b>
                  <span>{"⭐".repeat(Math.min(k.stars, 8))}</span>
                </div>
              ))}
            </div>
          )}
          <div className="hk-row">
            <button className="hk-btn" data-dwell data-testid="again-btn" onClick={() => runtime.startGame()}>
              ↻ Yana o‘ynaymiz
            </button>
            <button className="hk-btn ghost" data-dwell data-testid="back-btn" onClick={() => runtime.exit()}>
              ← Orqaga
            </button>
          </div>
        </div>
      </div>
    );
  }
  const winnerText = r.winner === null ? "" : r.winner === -1 ? "Durang!" : `${r.players?.[r.winner]?.label ?? ""} g‘olib! 🏆`;
  return (
    <div className="hk-ov dim" data-testid="results-overlay">
      <div className="hk-card hk-glass hk-big" style={{ width: "min(680px,100%)" }}>
        <div className="hk-tag">{r.game}</div>
        <div className="hk-score" data-testid="result-score">
          {r.score}
        </div>
        <div className="hk-stars" data-testid="result-stars" aria-label={`${r.stars} yulduz`}>
          {"★".repeat(r.stars)}
          {"☆".repeat(3 - r.stars)}
        </div>
        <div className="hk-best" data-testid="result-best">
          {r.isBest ? "🏆 Yangi rekord!" : r.best ? `Rekord: ${r.best}` : ""}
        </div>
        {winnerText && <div className="hk-best">{winnerText}</div>}
        <div className="hk-lines">
          {r.lines.map(([k, v]) => (
            <div key={k}>
              <small>{k}</small>
              <b>{v}</b>
            </div>
          ))}
        </div>
        <div className="hk-row">
          <button className="hk-btn" data-dwell data-testid="again-btn" onClick={() => runtime.startGame()}>
            ↻ Qayta o‘ynash
          </button>
          <button className="hk-btn ghost" data-dwell data-testid="back-btn" onClick={() => runtime.exit()}>
            ← Orqaga
          </button>
        </div>
      </div>
    </div>
  );
}

function CenterText(): ReactElement {
  const c = useRunUI((s) => s.center);
  return (
    <div className={`hk-center${c.show ? " show" : ""}`} data-testid="center-text">
      {c.text}
      {c.sub ? <small>{c.sub}</small> : null}
    </div>
  );
}

function DebugPanel(): ReactElement | null {
  const d = useRunUI((s) => s.debug);
  const state = useRunUI((s) => s.state);
  if (!d) return null;
  return (
    <div className="hk-debug" data-testid="debug-panel">
      <div>
        <b>holat</b> {state} · <b>fps</b> {d.renderFps} · <b>aniqlash fps</b> {d.detectFps}
      </div>
      <div>
        <b>kechikish</b> ≈{d.latencyMs} ms <small>(kutish {d.latWait} · model {d.inferMs} · qo‘llash {d.latApply} · eng yomon {d.latPeak})</small> · <b>odamlar</b> {d.people}
      </div>
      <div>
        <b>aniqlash</b> ≤{d.detectCap}/s · <b>kamera</b> {d.camera} · <b>yorug‘lik</b> {d.light}
      </div>
      <div>
        <b>qulflangan</b> {d.locked}
      </div>
      <div>
        <b>imo-ishora</b> {d.gesture}
      </div>
      <div>
        <b>tracking</b> {d.backend} · {d.poseModel} · <b>sifat</b> {d.quality}
      </div>
      <div>
        <b>GPU</b> {d.gpu}
      </div>
    </div>
  );
}

/** The full-screen play area: camera picture, 3D canvas, 2D effects layer and all DOM overlays. */
export function PlayStage({ runtime }: { runtime: EngineRuntime }): ReactElement {
  const state = useRunUI((s) => s.state);
  const toast = useRunUI((s) => s.toast);
  const audioReady = useRunUI((s) => s.audioReady);
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = root.current;
    if (!r || !video.current || !fx.current || !bg.current || !overlay.current) return;
    runtime.attach({ video: video.current, fx: fx.current, bg: bg.current, overlay: overlay.current });
    const apply = (): void => {
      const rect = r.getBoundingClientRect();
      runtime.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), Math.min(window.devicePixelRatio || 1, 2));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(r);
    void runtime.start();
    return () => ro.disconnect();
  }, [runtime]);

  const showHud = state === "preparing" || state === "countdown" || state === "play" || state === "pause";
  const sceneish = showHud || state === "results";

  return (
    <div ref={root} className="hk-root" data-state={state} data-testid="play-root">
      <style>{PLAY_CSS}</style>
      <video ref={video} className="hk-cam" playsInline muted autoPlay data-pip="0" />
      <div className="hk-camdim" data-pip="0" />
      <canvas ref={bg} className="hk-layer hk-bg" />
      {runtime.crowd ? <CrowdLayer runtime={runtime} /> : <SceneLayer runtime={runtime} />}
      <canvas ref={fx} className="hk-layer hk-fx" />
      {showHud && <Hud runtime={runtime} />}
      {showHud && (
        <Link className="hk-back" href={backOf(runtime)} aria-label="Orqaga">
          ← Orqaga
        </Link>
      )}
      <CenterText />
      <div ref={overlay}>
        {state === "camera" && <CameraOverlay runtime={runtime} />}
        {state === "loading" && <LoadingOverlay runtime={runtime} />}
        {state === "error" && <ErrorOverlay runtime={runtime} />}
        {state === "scan" && <ScanOverlay runtime={runtime} />}
        {state === "ready" && <ReadyOverlay runtime={runtime} />}
        {state === "pause" && <PauseOverlay runtime={runtime} />}
        {state === "results" && <ResultsOverlay runtime={runtime} />}
      </div>
      {!audioReady && sceneish && <div className="hk-sound hk-glass">🔊 Ovozni yoqish uchun ekranni bosing</div>}
      <div className={`hk-toast hk-glass${toast ? " show" : ""}`}>{toast}</div>
      {runtime.debugOn && <DebugPanel />}
    </div>
  );
}
