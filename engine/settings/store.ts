"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type QualitySetting = "auto" | "high" | "medium" | "low";
export type PoseModelSetting = "auto" | "lite" | "full";

export interface Settings {
  /** saved camera deviceId ("" = automatic front camera) */
  cameraId: string;
  sound: boolean;
  music: boolean;
  quality: QualitySetting;
  poseModel: PoseModelSetting;
  leftHanded: boolean;
  kids: boolean;
  /** 0.5 .. 1.5 (1 = prototype thresholds) */
  sensitivity: number;
  /** draw the player's skeleton during the game */
  skeleton: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  cameraId: "",
  sound: true,
  music: true,
  quality: "auto",
  poseModel: "auto",
  leftHanded: false,
  kids: false,
  sensitivity: 1,
  skeleton: false,
};

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const noopStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

/** Persisted user settings (localStorage key "harakat.settings"). Read by the engine, edited on /sozlamalar. */
export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: "harakat.settings",
      version: 1,
      // hydrate on the client after mount (see useHydratedSettings) so SSR markup and first client render match
      skipHydration: true,
      storage: createJSONStorage(() => (typeof localStorage === "undefined" ? noopStorage : localStorage)),
      partialize: (s) => {
        const { set: _set, reset: _reset, ...rest } = s;
        void _set;
        void _reset;
        return rest;
      },
    },
  ),
);

export function snapshotSettings(): Settings {
  const { set: _s, reset: _r, ...rest } = useSettings.getState();
  void _s;
  void _r;
  return rest;
}

/** Best score per game (localStorage; the backend takes over in stage 5). */
export const bestKey = (slug: string): string => `harakat.best.${slug}`;
export function readBest(slug: string): number {
  try {
    return Number(localStorage.getItem(bestKey(slug))) || 0;
  } catch {
    return 0;
  }
}
export function writeBest(slug: string, score: number): void {
  try {
    localStorage.setItem(bestKey(slug), String(Math.round(score)));
  } catch {
    /* storage unavailable (private mode) */
  }
}

/** Rehydrate the persisted settings once on the client. Returns true when the stored values are loaded. */
export function useHydratedSettings(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve(useSettings.persist.rehydrate()).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
