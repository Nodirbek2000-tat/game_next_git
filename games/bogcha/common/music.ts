// Cheerful ORIGINAL children's melodies + sound effects for the Bog‘cha games, synthesised with Web Audio (no files).
// Deliberately tiny: per note ONE oscillator + ONE gain (no noise buffers, no convolvers), look-ahead scheduling, nothing
// grows with play time. Notes are MIDI numbers (60 = middle C).

export type SongId = "march" | "bouncy" | "calm";

export interface Song {
  id: SongId;
  bpm: number;
  /** lead voice, one entry per 8th note: MIDI note, 0 = rest, -1 = hold the previous note */
  lead: readonly number[];
  /** bass, one entry per beat (quarter note): MIDI note, 0 = rest. Length = lead.length / 2 */
  bass: readonly number[];
  /** drums, one char per 8th note: "k" kick, "t" tick, "." nothing. Empty = no drums */
  drums: string;
  leadWave: OscillatorType;
  leadVol: number;
  bassVol: number;
}

export const SONGS: Record<SongId, Song> = {
  // 4 bars of 4/4, steady steps: walking / marching around the room
  march: {
    id: "march",
    bpm: 108,
    lead: [60, 0, 64, 0, 67, 0, 64, 0, 65, 0, 69, 0, 72, 0, 69, 0, 67, 0, 71, 0, 74, 0, 71, 0, 72, -1, -1, -1, 67, -1, 60, -1],
    bass: [48, 43, 48, 43, 53, 48, 53, 48, 55, 50, 55, 50, 48, 43, 48, 0],
    drums: "k.t.k.t.".repeat(4),
    leadWave: "square",
    leadVol: 0.07,
    bassVol: 0.2,
  },
  // quick bouncy skips: jumping / hopping
  bouncy: {
    id: "bouncy",
    bpm: 128,
    lead: [72, 0, 67, 0, 64, 67, 72, 0, 74, 0, 69, 0, 65, 69, 74, 0, 76, 74, 72, 0, 71, 69, 67, 0, 67, 69, 71, 72, -1, 0, 0, 0],
    bass: [48, 48, 55, 48, 53, 53, 60, 53, 55, 55, 62, 55, 48, 55, 48, 0],
    drums: "k.tkk.t.".repeat(4),
    leadWave: "triangle",
    leadVol: 0.16,
    bassVol: 0.2,
  },
  // slow soft lullaby-ish phrase: calm down, sway
  calm: {
    id: "calm",
    bpm: 66,
    lead: [64, -1, -1, 0, 67, -1, 71, -1, 69, -1, -1, 0, 67, -1, 64, -1, 62, -1, -1, 0, 65, -1, 69, -1, 67, -1, 64, -1, 60, -1, -1, -1],
    bass: [48, 0, 55, 0, 53, 0, 60, 0, 55, 0, 62, 0, 48, 0, 55, 0],
    drums: "",
    leadWave: "sine",
    leadVol: 0.2,
    bassVol: 0.12,
  },
};

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** kind passed to the `emit` callback of the scheduler */
export const NOTE_LEAD = 0;
export const NOTE_BASS = 1;
export const NOTE_KICK = 2;
export const NOTE_TICK = 3;
export type NoteKind = 0 | 1 | 2 | 3;
export type NoteEmit = (kind: NoteKind, midi: number, t: number, dur: number, vol: number) => void;

/**
 * Look-ahead step sequencer. Pure (no Web Audio): the caller feeds the clock. State is O(1): a step counter, the next
 * step time and a precomputed hold table — it never stores events, so it cannot grow however long it runs.
 */
export class MelodyScheduler {
  readonly stepDur: number;
  /** next step to schedule (monotonic) */
  step = 0;
  nextT = 0;
  private hold: Uint8Array;

  constructor(
    readonly song: Song,
    private emit: NoteEmit,
    tempo = 1,
  ) {
    this.stepDur = 60 / (song.bpm * tempo) / 2;
    const n = song.lead.length;
    this.hold = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (song.lead[i] <= 0) continue;
      let len = 1;
      while (i + len < n && song.lead[i + len] === -1 && len < 16) len++;
      this.hold[i] = len;
    }
  }

  start(t0: number): void {
    this.step = 0;
    this.nextT = t0;
  }

  /** Schedule every step starting before `now + ahead` (seconds). Returns the number of steps scheduled. */
  tick(now: number, ahead = 0.15): number {
    // the page was throttled / the tab hidden: do not play a burst of old steps
    if (this.nextT < now - 0.4) this.nextT = now + 0.05;
    let n = 0;
    const s = this.song;
    while (this.nextT < now + ahead && n < 8) {
      const i = this.step % s.lead.length;
      const t = this.nextT;
      const lead = s.lead[i];
      if (lead > 0) this.emit(NOTE_LEAD, lead, t, this.hold[i] * this.stepDur * 0.92, s.leadVol);
      if ((i & 1) === 0) {
        const bass = s.bass[(i >> 1) % s.bass.length];
        if (bass > 0) this.emit(NOTE_BASS, bass, t, this.stepDur * 1.8, s.bassVol);
      }
      if (s.drums) {
        const d = s.drums[i % s.drums.length];
        if (d === "k") this.emit(NOTE_KICK, 0, t, 0.14, 0.5);
        else if (d === "t") this.emit(NOTE_TICK, 0, t, 0.04, 0.05);
      }
      this.nextT += this.stepDur;
      this.step++;
      n++;
    }
    return n;
  }
}

/** The pieces of the engine's audio graph the kids audio needs (see AudioApi.graph()). */
export interface KidsGraph {
  ac: AudioContext;
  sfx: AudioNode;
  music: AudioNode;
  musicEnabled: () => boolean;
}
export type GraphGetter = () => KidsGraph | null;

/** One oscillator + one gain, released after the note (disconnect on end so the nodes can be collected). */
export function playNote(ac: AudioContext, out: AudioNode, hz: number, t: number, dur: number, type: OscillatorType, vol: number, hz2 = 0): void {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  if (hz2 > 0) o.frequency.exponentialRampToValueAtTime(Math.max(1, hz2), t + dur);
  const a = Math.min(0.012, dur / 3);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(out);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
  o.start(t);
  o.stop(t + dur + 0.03);
}

/** Plays a song loop. Safe to call before audio is unlocked: it starts as soon as the engine's audio graph exists. */
export class MusicPlayer {
  private want: SongId | null = null;
  private tempo = 1;
  private sch: MelodyScheduler | null = null;
  private bus: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** number of scheduled notes since creation (tests / debug) */
  notes = 0;

  constructor(private getGraph: GraphGetter) {}

  get playing(): boolean {
    return this.want !== null;
  }

  get song(): SongId | null {
    return this.want;
  }

  play(id: SongId, tempo = 1): void {
    if (this.want === id && this.tempo === tempo) return;
    this.silence();
    this.want = id;
    this.tempo = tempo;
    this.timer ??= setInterval(() => this.pump(), 40);
    this.pump();
  }

  /** Stop at once (also the notes already scheduled ahead). */
  stop(): void {
    this.silence();
    this.want = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
  }

  private silence(): void {
    const bus = this.bus;
    if (bus) {
      try {
        const t = bus.context.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(0, t);
        setTimeout(() => bus.disconnect(), 400);
      } catch {
        /* context closed */
      }
    }
    this.bus = null;
    this.sch = null;
  }

  private pump(): void {
    if (!this.want) return;
    const g = this.getGraph();
    if (!g || !g.musicEnabled()) return;
    const ac = g.ac;
    if (!this.sch) {
      const bus = ac.createGain();
      bus.gain.value = 1;
      bus.connect(g.music);
      this.bus = bus;
      this.sch = new MelodyScheduler(SONGS[this.want], (k, m, t, d, v) => this.note(ac, bus, k, m, t, d, v), this.tempo);
      this.sch.start(ac.currentTime + 0.08);
    }
    this.sch.tick(ac.currentTime, 0.18);
  }

  private note(ac: AudioContext, out: AudioNode, kind: NoteKind, midi: number, t: number, dur: number, vol: number): void {
    this.notes++;
    const s = this.sch?.song;
    if (kind === NOTE_LEAD) playNote(ac, out, midiHz(midi), t, dur, s?.leadWave ?? "triangle", vol);
    else if (kind === NOTE_BASS) playNote(ac, out, midiHz(midi), t, dur, "sine", vol);
    else if (kind === NOTE_KICK) playNote(ac, out, 150, t, dur, "sine", vol, 45);
    else playNote(ac, out, 2400, t, dur, "square", vol);
  }
}

/** Short sound effects (pop, yay, star, drum, freeze sting, attention jingle). Each is a handful of notes. */
export class KidSfx {
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

  private seq(g: KidsGraph, notes: readonly (readonly [number, number])[], type: OscillatorType, vol: number, step = 0.09, len = 0.22): void {
    const t0 = g.ac.currentTime + 0.01;
    for (let i = 0; i < notes.length; i++) playNote(g.ac, g.sfx, midiHz(notes[i][0]), t0 + i * step, notes[i][1] * len, type, vol);
  }

  /** bubble pop */
  pop(): void {
    const g = this.ok("pop", 45);
    if (g) playNote(g.ac, g.sfx, 420 + Math.random() * 200, g.ac.currentTime + 0.005, 0.09, "sine", 0.28, 1100);
  }

  /** happy rising arpeggio */
  yay(): void {
    const g = this.ok("yay", 300);
    if (g) this.seq(g, [[72, 1], [76, 1], [79, 1], [84, 2]], "triangle", 0.22, 0.09, 0.2);
  }

  /** a star is earned */
  star(): void {
    const g = this.ok("star", 70);
    if (g) this.seq(g, [[88, 1], [93, 1.4]], "sine", 0.2, 0.07, 0.2);
  }

  drum(): void {
    const g = this.ok("drum", 60);
    if (g) playNote(g.ac, g.sfx, 170, g.ac.currentTime + 0.005, 0.2, "sine", 0.6, 48);
  }

  /** the music stopped: "Qotib qol!" */
  sting(): void {
    const g = this.ok("sting", 400);
    if (g) this.seq(g, [[79, 1], [76, 1], [72, 1], [67, 1], [60, 3]], "square", 0.1, 0.07, 0.16);
  }

  /** two soft notes before a spoken (or icon-only) prompt */
  attention(): void {
    const g = this.ok("attention", 500);
    if (g) this.seq(g, [[84, 1], [79, 1.6]], "triangle", 0.18, 0.12, 0.2);
  }
}
