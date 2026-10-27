import type { GameModule } from "@/engine/types";
import { installModePanel } from "./modePanel";
import { NinjaScene } from "./Scene";

/**
 * Meva Ninja — the reference game of the engine contract (see engine/README.md).
 * AR overlay: the mirrored camera is the background, fruits fly in a transparent 3D canvas on top.
 * Pre-start option: "Oddiy" (1-2 players) or "Xona" (everybody's hands, shared score) - see modePanel.ts.
 */
installModePanel();

const ninja: GameModule = {
  meta: {
    slug: "meva-ninja",
    maxPlayers: 2,
    needsHands: false,
    needsLegs: false,
    world: false,
    dim: 0.62,
    musicBpm: 118,
  },
  Scene: NinjaScene,
};

export default ninja;
