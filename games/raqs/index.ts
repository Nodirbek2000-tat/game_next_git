import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine/types";
import { RaqsGame } from "./game";

/** Raqs: 2D AR overlay painted through engine.onDraw. The legs are optional (squat / knee cards only appear when the knees are visible). */
function RaqsScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new RaqsGame(engine);
    const off = engine.onDraw((c, _e, now) => g.frame(c, now));
    return () => {
      off();
      g.dispose();
    };
  }, [engine]);
  return null;
}

const raqs: GameModule = {
  meta: { slug: "raqs", maxPlayers: 1, needsHands: false, needsLegs: false, world: false, dim: 0.5, musicBpm: 110 },
  Scene: RaqsScene,
};

export default raqs;
