import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine";
import { EngashGame } from "./game";

/** Eng, sakra: 2D overlay only. Duck = head / shoulders clearly below the calibrated standing level, jump = quick rise above it. */
function EngashScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new EngashGame(engine);
    return engine.onDraw((c, _e, now) => g.draw(c, now));
  }, [engine]);
  return null;
}

const game: GameModule = {
  meta: { slug: "engash-sakra", maxPlayers: 1, needsHands: false, needsLegs: true, world: false, dim: 0.55, musicBpm: 120 },
  Scene: EngashScene,
};
export default game;
