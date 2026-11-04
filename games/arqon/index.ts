import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine";
import { ArqonGame } from "./game";

/** Arqon sakrash: 2D overlay only. Jump = quick rise of hips + shoulders above the calibrated standing level. */
function ArqonScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new ArqonGame(engine);
    return engine.onDraw((c, _e, now) => g.draw(c, now));
  }, [engine]);
  return null;
}

const game: GameModule = {
  meta: { slug: "arqon", maxPlayers: 1, needsHands: false, needsLegs: true, world: false, dim: 0.55, musicBpm: 120 },
  Scene: ArqonScene,
};
export default game;
