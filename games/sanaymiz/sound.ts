// Sanaymiz: the counting pops. Count 1..5 climbs up a C-major pentatonic scale, so "1-2-3" is heard as a little tune
// (the music is in C too). One or two oscillators per sound, throttled per sound.

import { midiHz, playNote } from "../bogcha/common";
import type { KidsGraph } from "../bogcha/common/music";

const PENTA = [72, 74, 76, 79, 81] as const;

export class CountSounds {
  private lastCount = 0;
  private lastWrong = 0;

  constructor(private getGraph: () => KidsGraph | null) {}

  /** a counted jump / clap: pop with the pitch of the count (1..5) */
  count(n: number): void {
    const g = this.getGraph();
    if (!g) return;
    const now = performance.now();
    if (now - this.lastCount < 40) return;
    this.lastCount = now;
    const f = midiHz(PENTA[Math.max(0, Math.min(4, n - 1))]);
    const t = g.ac.currentTime + 0.005;
    playNote(g.ac, g.sfx, f * 0.7, t, 0.1, "sine", 0.32, f * 1.6);
    playNote(g.ac, g.sfx, f, t + 0.03, 0.26, "triangle", 0.2);
  }

  /** a balloon of another colour was touched: a soft, friendly "boing" (never a punishment) */
  soft(): void {
    const g = this.getGraph();
    if (!g) return;
    const now = performance.now();
    if (now - this.lastWrong < 350) return;
    this.lastWrong = now;
    playNote(g.ac, g.sfx, 300, g.ac.currentTime + 0.005, 0.16, "sine", 0.14, 420);
  }
}
