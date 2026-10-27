"use client";

import { create } from "zustand";
import type { CalibrationReport } from "../calibration/calibration";
import type { CameraProblem, Guide } from "../camera/guides";
import type { GameResult, RunState } from "../types";

export interface HudPlayerUI {
  score: number;
  label: string;
  extra: string;
}

export interface ResultsUI {
  game: string;
  score: number;
  stars: number;
  best: number;
  isBest: boolean;
  lines: [string, string | number][];
  /** 2 player games: index of the winner, -1 = draw, null = single player */
  winner: number | null;
  players: { score: number; label: string }[] | null;
  /** crowd (Bog‘cha) game: "Barakalla!" screen with the stars of every child */
  crowd: boolean;
  kids: NonNullable<GameResult["kids"]> | null;
}

export interface DebugUI {
  renderFps: number;
  detectFps: number;
  /** camera capture -> on screen, ms (target < 80) */
  latencyMs: number;
  inferMs: number;
  /** capture -> detection start / result -> applied, ms */
  latWait: number;
  latApply: number;
  latPeak: number;
  /** current cap of detections per second */
  detectCap: number;
  light: string;
  camera: string;
  people: number;
  locked: string;
  gesture: string;
  backend: string;
  poseModel: string;
  quality: string;
  gpu: string;
}

export interface RunUIState {
  state: RunState;
  problem: CameraProblem | null;
  problemStatus: string;
  guide: Guide | null;
  loading: { pct: number; label: string; tip: string };
  scan: {
    progress: number;
    info: string;
    title: string;
    icon: string;
    players: 1 | 2;
    canPickPlayers: boolean;
    calib: CalibrationReport | null;
    secondsLeft: number;
    needsLegs: boolean;
  };
  pause: { reason: "manual" | "lost" | "hidden"; title: string; sub: string };
  center: { text: string; sub: string; show: boolean; seq: number };
  hud: {
    on: boolean;
    title: string;
    score: number;
    combo: string | null;
    time: number | null;
    timeLabel: string;
    lives: string | null;
    bar: number;
    players: HudPlayerUI[];
  };
  results: ResultsUI | null;
  debug: DebugUI | null;
  audioReady: boolean;
  /** error text for state "error" (model load failed, ...) */
  errorText: string;
  toast: string;
  patch: (p: Partial<RunUIState>) => void;
}

const initial = (): Omit<RunUIState, "patch"> => ({
  state: "camera",
  problem: null,
  problemStatus: "Kamera yoqilmoqda… (brauzer so‘rasa «Ruxsat berish»ni bosing)",
  guide: null,
  loading: { pct: 0, label: "", tip: "" },
  scan: { progress: 0, info: "", title: "Ikki qo‘lingizni boshingizdan yuqori ko‘taring", icon: "🙌", players: 1, canPickPlayers: false, calib: null, secondsLeft: 10, needsLegs: false },
  pause: { reason: "manual", title: "O‘yin to‘xtatildi", sub: "" },
  center: { text: "", sub: "", show: false, seq: 0 },
  hud: { on: false, title: "", score: 0, combo: null, time: null, timeLabel: "Vaqt", lives: null, bar: 1, players: [] },
  results: null,
  debug: null,
  audioReady: false,
  errorText: "",
  toast: "",
});

/** UI-facing state of the current play session (what the React overlays render). Written by the runtime only. */
export const useRunUI = create<RunUIState>((set) => ({
  ...initial(),
  patch: (p) => set(p),
}));

export function resetRunUI(): void {
  useRunUI.setState({ ...initial() });
}

export type { GameResult };
