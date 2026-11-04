import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine";
import { VoleybolGame } from "./game";

/** Voleybol (sinov): 2D overlay; hand points (blades) and the nose hit a ball with gravity. */
function VoleybolScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new VoleybolGame(engine);
    return engine.onDraw((c, _e, now) => g.draw(c, now));
  }, [engine]);
  return null;
}

const game: GameModule = {
  meta: { slug: "voleybol", maxPlayers: 1, needsHands: false, needsLegs: false, world: false, dim: 0.55, musicBpm: 110 },
  Scene: VoleybolScene,
};
export default game;
