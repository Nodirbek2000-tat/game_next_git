import { useEffect } from "react";
import type { GameModule, SceneProps } from "@/engine";
import { DarvozabonGame } from "./game";

/** Darvozabon: 2D overlay; the goal spans the screen, the keeper steps sideways and stops the balls with gloves (hands) and boots (feet). */
function DarvozabonScene({ engine }: SceneProps): null {
  useEffect(() => {
    const g = new DarvozabonGame(engine);
    return engine.onDraw((c, _e, now) => g.draw(c, now));
  }, [engine]);
  return null;
}

const game: GameModule = {
  meta: { slug: "darvozabon", maxPlayers: 1, needsHands: false, needsLegs: false, world: false, dim: 0.55, musicBpm: 120 },
  Scene: DarvozabonScene,
};
export default game;
