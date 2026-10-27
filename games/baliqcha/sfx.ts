// Baliqcha sound effects: a handful of short, soft notes each (Web Audio, one oscillator + one gain per note, no files).
// Uses the kit's note player and the engine's audio graph (so the sound settings and "tap to enable sound" apply).

import { midiHz, playNote } from "../bogcha/common";
import type { GraphGetter, KidsGraph } from "../bogcha/common/music";

export class FishSfx {
  private last: Record<string, number> = {};

  constructor(private getGraph: GraphGetter) {}

  private ok(name: string, gapMs: number): KidsGraph | null {
    const g = this.getGraph();
    if (!g) return null;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < gapMs) return null;
    this.last[name] = now;
    return g;
  }

  /** the line is thrown: a soft rising whoosh */
  cast(): void {
    const g = this.ok("cast", 120);
    if (g) playNote(g.ac, g.sfx, 280, g.ac.currentTime + 0.005, 0.22, "sine", 0.22, 820);
  }

  /** the float plops into the water */
  splash(): void {
    const g = this.ok("splash", 90);
    if (!g) return;
    const t = g.ac.currentTime + 0.005;
    playNote(g.ac, g.sfx, 900, t, 0.1, "sine", 0.22, 260);
    playNote(g.ac, g.sfx, 620, t + 0.07, 0.08, "sine", 0.14, 240);
  }

  /** a bite: two quick "blub blub" */
  bite(): void {
    const g = this.ok("bite", 150);
    if (!g) return;
    const t = g.ac.currentTime + 0.005;
    playNote(g.ac, g.sfx, midiHz(67), t, 0.1, "triangle", 0.3, midiHz(74));
    playNote(g.ac, g.sfx, midiHz(72), t + 0.13, 0.1, "triangle", 0.3, midiHz(79));
    playNote(g.ac, g.sfx, midiHz(67), t + 0.3, 0.1, "triangle", 0.3, midiHz(74));
  }

  /** the fish is pulled out: a quick up-swoop and a splash */
  pull(): void {
    const g = this.ok("pull", 150);
    if (!g) return;
    const t = g.ac.currentTime + 0.005;
    playNote(g.ac, g.sfx, 240, t, 0.26, "triangle", 0.28, 760);
    playNote(g.ac, g.sfx, 800, t + 0.05, 0.12, "sine", 0.2, 220);
  }

  /** "Ura!": the fish is in the basket */
  hooray(): void {
    const g = this.ok("hooray", 200);
    if (!g) return;
    const t = g.ac.currentTime + 0.01;
    const notes = [72, 76, 79, 84] as const;
    for (let i = 0; i < notes.length; i++) playNote(g.ac, g.sfx, midiHz(notes[i]), t + i * 0.085, i === 3 ? 0.34 : 0.16, "triangle", 0.24);
  }

  /** the golden fish: a longer sparkling run */
  gold(): void {
    const g = this.ok("gold", 400);
    if (!g) return;
    const t = g.ac.currentTime + 0.01;
    const notes = [72, 76, 79, 84, 88, 91, 96] as const;
    for (let i = 0; i < notes.length; i++) playNote(g.ac, g.sfx, midiHz(notes[i]), t + i * 0.07, i === 6 ? 0.5 : 0.14, "sine", 0.24);
  }
}
