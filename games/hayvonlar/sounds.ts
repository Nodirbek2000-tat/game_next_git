// Cute synthesised animal voices (no files): a few oscillator blips with pitch glides, played through the kit's `playNote`
// on the engine's audio graph (so the sound setting / "tap to enable sound" apply). Each animal has its own "word".

import { playNote } from "../bogcha/common";
import type { AnimalId } from "./animals";

type Wave = "sine" | "triangle" | "square" | "sawtooth";
/** [hz, hzEnd, start (s), length (s), wave, volume] */
export type Blip = readonly [number, number, number, number, Wave, number];

export const ANIMAL_SOUNDS: Record<AnimalId, readonly Blip[]> = {
  // "pip-pip-pup": two squeaks and a soft thump
  quyon: [
    [900, 1400, 0, 0.09, "sine", 0.26],
    [1000, 1550, 0.13, 0.09, "sine", 0.26],
    [200, 90, 0.3, 0.12, "sine", 0.34],
  ],
  // "chirp-chirp-chirrup"
  qush: [
    [2400, 3300, 0, 0.07, "sine", 0.16],
    [3100, 2400, 0.1, 0.07, "sine", 0.16],
    [2600, 3500, 0.22, 0.08, "sine", 0.16],
    [3400, 2500, 0.32, 0.1, "sine", 0.16],
  ],
  // "ri-bbit, ri-bbit": two croaks
  baqa: [
    [180, 330, 0, 0.1, "triangle", 0.3],
    [310, 150, 0.12, 0.15, "triangle", 0.3],
    [180, 330, 0.36, 0.1, "triangle", 0.3],
    [310, 150, 0.48, 0.18, "triangle", 0.3],
    [330, 160, 0.12, 0.15, "square", 0.05],
    [330, 160, 0.48, 0.18, "square", 0.05],
  ],
  // a soft, friendly "grrr-mm"
  ayiq: [
    [130, 95, 0, 0.55, "sawtooth", 0.1],
    [70, 55, 0, 0.55, "sine", 0.34],
    [200, 160, 0.6, 0.25, "triangle", 0.2],
  ],
  // "pwee-pwee"
  pingvin: [
    [600, 950, 0, 0.12, "triangle", 0.28],
    [950, 500, 0.12, 0.16, "triangle", 0.28],
    [600, 950, 0.42, 0.12, "triangle", 0.28],
    [950, 500, 0.54, 0.16, "triangle", 0.28],
  ],
  // slow sleepy "hmmm"
  toshbaqa: [
    [330, 260, 0, 0.5, "sine", 0.26],
    [260, 200, 0.55, 0.65, "sine", 0.24],
  ],
};

/** Plays the voice of an animal. `g` is `engine.audio.graph()` (null before audio is unlocked: silent). */
export function playAnimal(g: { ac: AudioContext; sfx: AudioNode } | null, id: AnimalId): void {
  if (!g) return;
  const t0 = g.ac.currentTime + 0.02;
  const notes = ANIMAL_SOUNDS[id];
  for (let i = 0; i < notes.length; i++) {
    const [hz, hz2, at, len, wave, vol] = notes[i];
    playNote(g.ac, g.sfx, hz, t0 + at, len, wave, vol, hz2);
  }
}
