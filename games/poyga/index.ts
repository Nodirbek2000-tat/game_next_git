import type { GameModule } from "@/engine/types";
import { PoygaScene } from "./Scene";

/**
 * Shahar simulyatori: an open, endless city with supercars and real driving physics. Knees are the pedals, hands the
 * wheel (as in Mashina haydash), so the legs must be seen. Own 3D world.
 */
const poyga: GameModule = {
  meta: {
    slug: "poyga",
    maxPlayers: 1,
    // the hand model: the menu cursor clicks with a closed fist
    needsHands: true,
    needsLegs: true,
    world: true,
    musicBpm: 96,
  },
  Scene: PoygaScene,
};

export default poyga;
