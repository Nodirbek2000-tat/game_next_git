// Havoda rasm: tiny sounds. Every child has their own note of a C-major pentatonic scale (the music is in C too), so a
// sparkle chime never clashes. One or two oscillators per sound, throttled.

import { midiHz, playNote } from "../bogcha/common";
import type { KidsGraph } from "../bogcha/common/music";

const PENTA = [76, 79, 81, 84, 88] as const;

export class PaintSounds {
  private lastChime = 0;
  private lastFire = 0;

  constructor(private getGraph: () => KidsGraph | null) {}

  /** a guide point was painted by `slot` */
  chime(slot: number): void {
    const g = this.getGraph();
    if (!g) return;
    const now = performance.now();
    if (now - this.lastChime < 70) return;
    this.lastChime = now;
    playNote(g.ac, g.sfx, midiHz(PENTA[((slot % 5) + 5) % 5]), g.ac.currentTime + 0.005, 0.28, "sine", 0.14);
  }

  /** a clap: a rocket going up and a soft crackle */
  fire(slot: number): void {
    const g = this.getGraph();
    if (!g) return;
    const now = performance.now();
    if (now - this.lastFire < 150) return;
    this.lastFire = now;
    const t = g.ac.currentTime + 0.005;
    const f = midiHz(PENTA[((slot % 5) + 5) % 5] - 12);
    playNote(g.ac, g.sfx, f, t, 0.22, "triangle", 0.2, f * 3);
    playNote(g.ac, g.sfx, f * 4, t + 0.2, 0.3, "sine", 0.12, f * 2);
  }
}
