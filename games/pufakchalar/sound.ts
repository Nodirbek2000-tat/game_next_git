// Pufakchalar: the bubble pop sounds. Every child pops on their own note of a C-major pentatonic scale, so the pops
// never clash with the music (also in C) and children can hear which pop is theirs. 2-3 oscillators per pop at most.

import { midiHz, playNote } from "../bogcha/common";
import type { KidsGraph } from "../bogcha/common/music";

const PENTA = [72, 74, 76, 79, 81] as const;

export class PopSounds {
  private last = 0;

  constructor(private getGraph: () => KidsGraph | null) {}

  /** a bubble popped by `slot` (golden = a little rising arpeggio) */
  pop(slot: number, golden: boolean): void {
    const g = this.getGraph();
    if (!g) return;
    const now = performance.now();
    if (now - this.last < 30) return;
    this.last = now;
    const f = midiHz(PENTA[((slot % 5) + 5) % 5]);
    const t = g.ac.currentTime + 0.005;
    // the "pop": a quick chirp up, plus a bright tick
    playNote(g.ac, g.sfx, f * 0.8, t, 0.12, "sine", 0.34, f * 1.9);
    playNote(g.ac, g.sfx, f * 2, t + 0.012, 0.16, "triangle", 0.1);
    if (golden) {
      playNote(g.ac, g.sfx, f * 1.5, t + 0.1, 0.18, "triangle", 0.16);
      playNote(g.ac, g.sfx, f * 2, t + 0.2, 0.3, "triangle", 0.18);
    }
  }

  /** the first touch of a golden bubble: a soft "ting" */
  ting(): void {
    const g = this.getGraph();
    if (!g) return;
    const now = performance.now();
    if (now - this.last < 30) return;
    this.last = now;
    playNote(g.ac, g.sfx, midiHz(88), g.ac.currentTime + 0.005, 0.2, "sine", 0.18);
  }
}
