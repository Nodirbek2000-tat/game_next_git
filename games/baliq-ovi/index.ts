import type { GameModule } from "@/engine/types";
import { BaliqScene } from "./Scene";

/**
 * Baliq ovi 2.0 — own 3D world (mountain lake): cast, wait, strike, fight, land. 1 or 2 players (co-op or duel).
 * Hands: the pose model is enough (wrist + shoulder + the engine's crank tracker), so the hand model is not downloaded.
 */
const baliq: GameModule = {
  meta: {
    slug: "baliq-ovi",
    maxPlayers: 2,
    needsHands: false,
    needsLegs: false,
    world: true,
    musicBpm: 70,
  },
  Scene: BaliqScene,
};

export default baliq;
