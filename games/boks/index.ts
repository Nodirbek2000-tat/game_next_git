import type { GameModule } from "@/engine/types";
import { BoksScene } from "./Scene";

/**
 * Boks: first-person boxing against a sparring partner (3 rounds). Red pad = left hand, blue pad = right hand; the partner
 * telegraphs his punches and the player dodges with the head or blocks with both hands. Own 3D world; the camera is a small
 * picture-in-picture. No hand model and no legs are needed: the arms and the head are enough (pose only).
 */
const boks: GameModule = {
  meta: {
    slug: "boks",
    maxPlayers: 1,
    needsHands: false,
    needsLegs: false,
    world: true,
    musicBpm: 126,
  },
  Scene: BoksScene,
};

export default boks;
