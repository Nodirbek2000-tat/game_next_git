import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine";
import { NurliTorGame } from "./game";

/** Nurli tor: strings of light pulled out between the pinched fingers and left in the air; a finger crossing one plays it. */
function NurliTorScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new NurliTorGame(engine);
    const off = engine.onDraw((c, _e, now) => g.draw(c, now));
    return () => {
      off();
      g.dispose();
    };
  }, [engine]);
  return null;
}

const game: GameModule = {
  meta: { slug: "nurli-tor", maxPlayers: 1, needsHands: true, handsOnly: true, needsLegs: false, world: false, dim: 0.4 },
  Scene: NurliTorScene,
};
export default game;
