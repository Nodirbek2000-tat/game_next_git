import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine/types";
import { BasketGame } from "./game";

/** Basketbol: 2D AR overlay painted through engine.onDraw. */
function BasketScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new BasketGame(engine);
    const off = engine.onDraw((c, _e, now) => g.frame(c, now));
    return () => {
      off();
      g.dispose();
    };
  }, [engine]);
  return null;
}

const basketbol: GameModule = {
  meta: { slug: "basketbol", maxPlayers: 1, needsHands: false, needsLegs: false, world: false, dim: 0.55, musicBpm: 110 },
  Scene: BasketScene,
};

export default basketbol;
