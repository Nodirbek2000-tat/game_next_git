import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine";
import { FitnesGame } from "./game";

/** Fitnes: today's guided workout (or one exercise, ?ex=); the camera counts the reps and checks the form. */
function FitnesScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new FitnesGame(engine);
    return engine.onDraw((c, _e, now) => g.draw(c, now));
  }, [engine]);
  return null;
}

const game: GameModule = {
  meta: { slug: "fitnes", maxPlayers: 1, needsHands: false, needsLegs: true, world: false, dim: 0.5 },
  Scene: FitnesScene,
};
export default game;
