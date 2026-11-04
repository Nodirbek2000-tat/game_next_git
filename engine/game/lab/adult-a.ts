import type { GameModule } from "../../types";

/** Sinov o'yinlari (adult-a): slug -> lazy import. */
export const LOADERS: Record<string, () => Promise<{ default: GameModule }>> = {
  arqon: () => import("@/games/arqon"),
  "engash-sakra": () => import("@/games/engash-sakra"),
  darvozabon: () => import("@/games/darvozabon"),
  yulduzcha: () => import("@/games/yulduzcha"),
  voleybol: () => import("@/games/voleybol"),
};
