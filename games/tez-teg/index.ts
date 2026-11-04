import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine/types";
import { TezTegGame } from "./game";

/** Tez teg: 2D AR overlay painted through engine.onDraw. */
function TezTegScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new TezTegGame(engine);
    const off = engine.onDraw((c, _e, now) => g.frame(c, now));
    return () => {
      off();
      g.dispose();
    };
  }, [engine]);
  return null;
}

const tezTeg: GameModule = {
  meta: { slug: "tez-teg", maxPlayers: 1, needsHands: false, needsLegs: false, world: false, dim: 0.55, musicBpm: 120 },
  Scene: TezTegScene,
};

export default tezTeg;
