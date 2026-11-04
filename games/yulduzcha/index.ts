import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine";
import { YulduzchaGame } from "./game";

/** Yulduzcha mashqi (sinov): jumping jacks with a beat; wrists above the head + ankles apart, then together = 1 rep. */
function YulduzchaScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new YulduzchaGame(engine);
    return engine.onDraw((c, _e, now) => g.draw(c, now));
  }, [engine]);
  return null;
}

const game: GameModule = {
  meta: { slug: "yulduzcha", maxPlayers: 1, needsHands: false, needsLegs: true, world: false, dim: 0.55, musicBpm: 100 },
  Scene: YulduzchaScene,
};
export default game;
