import type { GameModule } from "@/engine/types";
import { MashinaScene } from "./Scene";

/**
 * Mashina haydash 2.0 (TZ section 6): a Samarkand-inspired streamed city district, a highway with a bridge and a
 * drift area; Rapier raycast vehicle; knees are the pedals, the hands are the wheel. Own 3D world (not an AR overlay).
 */
const mashina: GameModule = {
  meta: {
    slug: "mashina",
    maxPlayers: 1,
    needsHands: false,
    needsLegs: true,
    world: true,
    musicBpm: 112,
  },
  Scene: MashinaScene,
};

export default mashina;
