import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine";
import { NurliTorGame } from "./game";

/** Nurli tor: a string of light between the pinched fingers of both hands; its length plays the notes. */
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
  meta: { slug: "nurli-tor", maxPlayers: 1, needsHands: true, needsLegs: false, world: false, dim: 0.42 },
  Scene: NurliTorScene,
};
export default game;
