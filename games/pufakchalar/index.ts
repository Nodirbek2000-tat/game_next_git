import { defineKidsGame } from "../bogcha/common";
import { PufakGame } from "./game";

// "Pufakchalar": soap bubbles float up, children pop them with their hands. The game starts its own gentle music
// (the pop sounds are tuned to the same key) unless the recorded song plays; "calm" is the fallback of the song.
export default defineKidsGame({
  slug: "pufakchalar",
  maxKids: 5,
  roundSec: 75,
  music: "calm",
  song: "/audio/bogcha/pufakchalar.mp3",
  dim: 0.5,
  create: (kit) => new PufakGame(kit),
});
