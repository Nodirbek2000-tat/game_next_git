import type { GameModule } from "../../types";

/** Sinov o'yinlari (kids-a): slug -> lazy import. */
export const LOADERS: Record<string, () => Promise<{ default: GameModule }>> = {
  "yulduz-ushla": () => import("@/games/yulduz-ushla"),
  qurbaqa: () => import("@/games/qurbaqa"),
  "rangni-top": () => import("@/games/rangni-top"),
  shamol: () => import("@/games/shamol"),
  baraban: () => import("@/games/baraban"),
};
