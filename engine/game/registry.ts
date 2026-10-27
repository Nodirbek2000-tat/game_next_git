import type { GameModule } from "../types";

/**
 * Game modules, one lazy chunk each. The home page never imports this file, so no game code is loaded
 * until /play/<slug> opens. To add a game: create games/<slug>/index.ts (default export = GameModule)
 * and add ONE line here. The key must be the slug from lib/games.ts.
 */
export const GAME_LOADERS: Record<string, () => Promise<{ default: GameModule }>> = {
  "meva-ninja": () => import("@/games/ninja"),
  "baliq-ovi": () => import("@/games/baliq-ovi"),
  "mashina": () => import("@/games/mashina"),
};

export const isImplemented = (slug: string): boolean => slug in GAME_LOADERS;
