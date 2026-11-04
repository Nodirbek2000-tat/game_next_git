import type { GameModule } from "../../types";

/** Sinov o'yinlari (adult-b): slug -> lazy import. */
export const LOADERS: Record<string, () => Promise<{ default: GameModule }>> = {
  "tez-teg": () => import("@/games/tez-teg"),
  basketbol: () => import("@/games/basketbol"),
  raqs: () => import("@/games/raqs"),
};
