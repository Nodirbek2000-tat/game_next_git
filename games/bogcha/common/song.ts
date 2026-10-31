// A recorded song as the background of a kids game. It streams through an <audio> element (a decoded 90 s song would take
// tens of MB of memory) into the engine's music bus, so the mute setting and the ducking of spoken names apply to it.

export interface SongGraph {
  ac: AudioContext;
  music: AudioNode;
  musicEnabled: () => boolean;
}

/** The music bus is tuned for the quiet synth melodies: a mixed song needs some gain to be heard in a room of children. */
const SONG_GAIN = 1.5;

export class SongPlayer {
  private el: HTMLAudioElement | null = null;
  private wired = false;

  constructor(
    private url: string,
    private getGraph: () => SongGraph | null,
  ) {}

  /** Starts buffering before the round so the song starts on time. Nothing is thrown when there is no audio support. */
  preload(): void {
    if (this.el || typeof Audio === "undefined") return;
    const el = new Audio(this.url);
    el.preload = "auto";
    el.loop = true;
    this.el = el;
  }

  /** Plays (or resumes). `onFail` runs when the song cannot play, so the caller can fall back to the synth melody. */
  play(onFail: () => void): void {
    this.preload();
    const el = this.el;
    if (!el) return onFail();
    this.wire(el);
    Promise.resolve(el.play()).catch(onFail);
  }

  private wire(el: HTMLAudioElement): void {
    if (this.wired) return;
    const g = this.getGraph();
    if (!g) return;
    try {
      const gain = g.ac.createGain();
      gain.gain.value = SONG_GAIN;
      g.ac.createMediaElementSource(el).connect(gain).connect(g.music);
      this.wired = true;
    } catch {
      /* the element keeps playing straight to the speakers */
    }
  }

  /** Follows the music setting while the song plays. */
  tick(): void {
    const g = this.getGraph();
    if (this.el && g) this.el.muted = !g.musicEnabled();
  }

  pause(): void {
    this.el?.pause();
  }

  stop(): void {
    if (!this.el) return;
    this.el.pause();
    this.el.currentTime = 0;
  }

  dispose(): void {
    if (!this.el) return;
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
    this.el = null;
  }
}
