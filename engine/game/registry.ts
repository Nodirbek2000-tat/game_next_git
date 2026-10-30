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
  "poyga": () => import("@/games/poyga"),
  // Bog‘cha (kids) games are added here by the game authors; the demo is the kit's reference game
  "bogcha-demo": () => import("@/games/bogcha/demo"),
  "baliqcha": () => import("@/games/baliqcha"),
  "hayvonlar": () => import("@/games/hayvonlar"),
  "pufakchalar": () => import("@/games/pufakchalar"),
  "qotib-qol": () => import("@/games/qotib-qol"),
  "havoda-rasm": () => import("@/games/havoda-rasm"),
  "sanaymiz": () => import("@/games/sanaymiz"),
  "devor-bolalar": () => import("@/games/devor-bolalar"),
};

export const isImplemented = (slug: string): boolean => slug in GAME_LOADERS;
