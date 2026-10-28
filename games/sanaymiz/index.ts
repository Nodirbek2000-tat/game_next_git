import { defineKidsGame } from "../bogcha/common";
import { SanaymizGame } from "./game";

// "Sanaymiz": numbers (1-5) and colours by moving: "3 marta sakrang!", "2 marta qarsak!", "Qizil sharni ushlang!".
// Every child who completes a round gets a star. Very light 2D, voice + icons, no reading.
export default defineKidsGame({
  slug: "sanaymiz",
  maxKids: 5,
  roundSec: 80,
  music: "bouncy",
  dim: 0.5,
  create: (kit) => new SanaymizGame(kit),
});
