import { defineKidsGame } from "../bogcha/common";
import { HavodaGame } from "./game";

// "Havoda rasm": the children paint in the air with their hands on one shared picture; every ~15 s a prompt asks for a simple
// shape (sun, rain, waves, rainbow). The last seconds show the group picture. Gentle music, very light 2D.
export default defineKidsGame({
  slug: "havoda-rasm",
  maxKids: 5,
  roundSec: 80,
  music: "calm",
  dim: 0.4,
  create: (kit) => new HavodaGame(kit),
});
