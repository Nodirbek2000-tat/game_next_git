import type { GameModule } from "../../types";

/** Sinov o'yinlari (kids-b): slug -> lazy import. */
export const LOADERS: Record<string, () => Promise<{ default: GameModule }>> = {
  "olma-ter": () => import("@/games/olma-ter"),
  kapalak: () => import("@/games/kapalak"),
  "shar-pufla": () => import("@/games/shar-pufla"),
  harflar: () => import("@/games/harflar"),
  soyabon: () => import("@/games/soyabon"),
};
