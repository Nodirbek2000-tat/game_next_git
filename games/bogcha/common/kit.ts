"use client";

// The kit a Bog‘cha game is built on. `defineKidsGame()` turns a tiny `create(kit)` function into a GameModule:
//   - crowd mode (no scan, no player lock, no WebGL canvas, up to 5 children, never pauses when somebody is missing)
//   - one 2D painter per frame: drawBack -> cartoon avatars of the children -> drawFront -> HUD (stars, timer, prompt banner)
//   - the round timer (60-90 s), the music, the group stars and the "Barakalla!" end screen
// A game only writes update(dt) + drawBack/drawFront. Everything is allocation-free per frame in the kit itself.

import { useEffect } from "react";
import type { EngineApi, GameModule, SceneProps } from "@/engine";
import type { KidSlot } from "@/engine/tracking/kids";
import { MAX_KIDS } from "@/engine/tracking/kids";
import { clamp } from "@/engine/math";
import { drawKids } from "./avatar";
import { KidsHud } from "./hud";
import { KidSfx, MusicPlayer, type SongId } from "./music";
import { Voice } from "./voice";

export interface KidsGameInstance {
  /** game logic; called every frame ONLY while playing (not in countdown / pause / after the round ended) */
  update?(dt: number, now: number): void;
  /** painted before the avatars (bubbles, fish, background decorations) */
  drawBack?(ctx: CanvasRenderingContext2D, now: number): void;
  /** painted over the avatars (sparkles, big signs). The HUD is drawn after it. */
  drawFront?(ctx: CanvasRenderingContext2D, now: number): void;
  /** the round started (state turned to "play" after the countdown) */
  onStart?(): void;
  dispose?(): void;
}

export interface KidsKit {
  readonly engine: EngineApi;
  /** the 5 kid slots; use `k.active && k.present`, `k.pts.*`, `k.signals.*` */
  readonly kids: readonly KidSlot[];
  /** stage size in CSS px (the 2D canvas is already scaled) */
  readonly stage: { w: number; h: number };
  readonly music: MusicPlayer;
  readonly sfx: KidSfx;
  readonly voice: Voice;
  readonly hud: KidsHud;
  /** group stars */
  readonly stars: number;
  /** stars earned by each slot */
  readonly perKid: readonly number[];
  readonly roundSec: number;
  /** seconds left of the round (counts down only while playing) */
  readonly timeLeft: number;
  /** true while the round is running */
  readonly playing: boolean;
  /** one or more stars to a child (or to the group when `kid` is null); pops a star at (x, y), default above the child's head */
  award(kid: KidSlot | null, n?: number, x?: number, y?: number): void;
  /** end the round now ("Barakalla!" screen); called automatically when the time is up */
  finish(): void;
}

export interface KidsGameDef {
  slug: string;
  /** 1..5, default 5 */
  maxKids?: number;
  /** camera brightness behind the game (0..1, default 0.5) */
  dim?: number;
  /** round length in seconds (60..90, default 75). `?duration=10` in the URL shortens it for tests. */
  roundSec?: number;
  /** background music started when the round starts (default "march"); null = the game controls the music itself */
  music?: SongId | null;
  create(kit: KidsKit): KidsGameInstance;
}

export interface KidsRun {
  kit: KidsKit;
  dispose(): void;
}

/** Wires a kids game to an engine. Used by the Scene component; exported so it can be driven without React (tests). */
export function startKidsGame(engine: EngineApi, def: KidsGameDef): KidsRun {
  const getGraph = () => engine.audio.graph?.() ?? null;
  const music = new MusicPlayer(getGraph);
  const sfx = new KidSfx(getGraph);
  const voice = new Voice(sfx, { muted: () => (getGraph()?.sfx as GainNode | undefined)?.gain?.value === 0 });
  const hud = new KidsHud();
  const kids = engine.kidSlots;
  const q = Number(engine.query.get("duration"));
  const roundSec = q > 0 ? q : clamp(def.roundSec ?? 75, 20, 90);
  const perKid: number[] = new Array<number>(MAX_KIDS).fill(0);
  const seen: boolean[] = new Array<boolean>(MAX_KIDS).fill(false);
  const stage = { w: 1, h: 1 };
  let left = roundSec;
  let total = 0;
  let finished = false;
  let wasPlay = false;
  let last = 0;

  const kit: KidsKit = {
    engine,
    kids,
    stage,
    music,
    sfx,
    voice,
    hud,
    get stars() {
      return total;
    },
    perKid,
    roundSec,
    get timeLeft() {
      return left;
    },
    get playing() {
      return engine.state === "play" && !finished;
    },
    award(kid, n = 1, x, y) {
      if (finished || n <= 0) return;
      total += n;
      hud.addStars(n);
      if (kid) {
        perKid[kid.slot] += n;
        seen[kid.slot] = true;
      }
      sfx.star();
      const px = x ?? kid?.pts.head.x ?? stage.w / 2;
      const py = y ?? (kid ? kid.pts.head.y - kid.headR * 2 : stage.h / 2);
      engine.fx.popup("⭐", px, py, "#ffd23d", 44, 0.9);
    },
    finish() {
      if (finished) return;
      finished = true;
      music.stop();
      const rows: { slot: number; emoji: string; color: string; stars: number }[] = [];
      let sum = 0;
      for (let i = 0; i < MAX_KIDS; i++) {
        if (!seen[i] && perKid[i] === 0) continue;
        // everybody who took part gets at least one star
        const st = Math.max(1, perKid[i]);
        sum += st;
        rows.push({ slot: i, emoji: kids[i].animal.emoji, color: kids[i].color, stars: st });
      }
      total = Math.max(total, sum);
      sfx.yay();
      voice.say("bravo", 3000);
      engine.finish({ score: total, lines: [["Yulduzlar", total]], kids: rows });
    },
  };

  const game = def.create(kit);

  const off = engine.onDraw((ctx, e, now) => {
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    stage.w = e.stage.w;
    stage.h = e.stage.h;
    const st = e.state;
    if (st === "play" && !finished) {
      if (!wasPlay) {
        wasPlay = true;
        if (def.music !== null) music.play(def.music ?? "march");
        game.onStart?.();
      }
      left = Math.max(0, left - dt);
      hud.left = left / roundSec;
      for (let i = 0; i < kids.length; i++) if (kids[i].active && kids[i].present) seen[i] = true;
      game.update?.(dt, now);
      if (left <= 0) kit.finish();
    } else if (wasPlay) {
      wasPlay = false;
      music.stop();
    }
    hud.update(dt);
    game.drawBack?.(ctx, now);
    drawKids(ctx, kids, now);
    game.drawFront?.(ctx, now);
    hud.draw(ctx, stage.w, stage.h, now, voice.banner, true);
  });

  return {
    kit,
    dispose() {
      off();
      game.dispose?.();
      music.dispose();
      voice.dispose();
    },
  };
}

/** The GameModule of a kids game. Register it with one line in engine/game/registry.ts. */
export function defineKidsGame(def: KidsGameDef): GameModule {
  const Scene = ({ engine }: SceneProps): null => {
    useEffect(() => {
      const run = startKidsGame(engine, def);
      return () => run.dispose();
    }, [engine]);
    return null;
  };
  return {
    meta: { slug: def.slug, maxPlayers: 1, needsHands: false, needsLegs: false, world: false, dim: def.dim ?? 0.5, crowd: true, maxKids: def.maxKids ?? MAX_KIDS },
    Scene,
  };
}
