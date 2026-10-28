// Soft synthesised sounds of the wall game (no files): whoosh when a wall appears, countdown chimes, a happy "ding" per child who
// passes (each child its own note), a gentle "boing" for a bump (never harsh), a small fanfare for "Hammamiz o‘tdik!".
// Everything goes through the kit's `playNote` on the engine's audio graph (null before audio is unlocked: silent).

import { midiHz, playNote } from "../bogcha/common";

export type Graph = { ac: AudioContext; sfx: AudioNode } | null;

/** pentatonic notes, one per kid slot */
export const SLOT_MIDI: readonly number[] = [72, 74, 76, 79, 81];
/** the three countdown chimes (3, 2, 1): rising */
export const CHIME_MIDI: Record<number, number> = { 3: 84, 2: 88, 1: 91 };

export class WallSounds {
  constructor(private graph: () => Graph) {}

  /** a wall appears far away and starts to come */
  whoosh(): void {
    const g = this.graph();
    if (!g) return;
    const t = g.ac.currentTime + 0.01;
    playNote(g.ac, g.sfx, 160, t, 0.7, "sine", 0.2, 420);
    playNote(g.ac, g.sfx, 240, t + 0.05, 0.6, "triangle", 0.07, 620);
  }

  /** countdown chime (n = 3, 2, 1): a bell of two partials */
  chime(n: number): void {
    const g = this.graph();
    if (!g) return;
    const hz = midiHz(CHIME_MIDI[n] ?? 84);
    const t = g.ac.currentTime + 0.005;
    playNote(g.ac, g.sfx, hz, t, 0.45, "sine", 0.2);
    playNote(g.ac, g.sfx, hz * 2.76, t, 0.2, "sine", 0.05);
  }

  /** the wall arrives: a soft thump */
  arrive(): void {
    const g = this.graph();
    if (!g) return;
    playNote(g.ac, g.sfx, 130, g.ac.currentTime + 0.005, 0.28, "sine", 0.4, 50);
  }

  /** a child went through */
  passed(slot: number): void {
    const g = this.graph();
    if (!g) return;
    const t = g.ac.currentTime + 0.03 + slot * 0.025;
    const m = SLOT_MIDI[slot % SLOT_MIDI.length];
    playNote(g.ac, g.sfx, midiHz(m), t, 0.28, "triangle", 0.18);
    playNote(g.ac, g.sfx, midiHz(m + 12), t + 0.07, 0.34, "sine", 0.12);
  }

  /** a soft bump: a rubber "boing", friendly */
  bump(): void {
    const g = this.graph();
    if (!g) return;
    const t = g.ac.currentTime + 0.01;
    playNote(g.ac, g.sfx, 360, t, 0.28, "sine", 0.22, 150);
    playNote(g.ac, g.sfx, 200, t + 0.12, 0.2, "sine", 0.12, 320);
  }

  /** everybody passed */
  fanfare(): void {
    const g = this.graph();
    if (!g) return;
    const t = g.ac.currentTime + 0.12;
    const notes = [72, 76, 79, 84, 88];
    for (let i = 0; i < notes.length; i++) playNote(g.ac, g.sfx, midiHz(notes[i]), t + i * 0.08, i === notes.length - 1 ? 0.5 : 0.18, "triangle", 0.2);
  }
}
