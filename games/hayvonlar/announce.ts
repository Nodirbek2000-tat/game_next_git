// The animal calls its own name when it comes out: "Quyoncha!" in a young child's voice. Browsers have no child voice, so
// real recordings are used: public/audio/bogcha/hayvonlar/<id>.mp3, listed in NAME_AUDIO (animals.ts). While an entry is
// false nothing is requested. A file is fetched lazily (fetch + decodeAudioData on the engine's Web Audio graph), played
// loud over a briefly ducked music, and every failure is silent. `Announcer` orders the sounds of one appearance:
// name -> the animal's own sound -> (the round's spoken prompt, see promptAt).

import { NAME_AUDIO, nameAudioUrl, type AnimalDef, type AnimalId } from "./animals";
import { ROUND_CFG } from "./round";
import { SOUND_LEN } from "./sounds";

/** The pieces of the engine's audio graph used here (engine.audio.graph()). */
export interface VoiceGraph {
  ac: AudioContext;
  sfx: AudioNode;
  music?: AudioNode;
}

export const NAME_CFG = {
  /** loudness of the recording before the master gain / compressor (the music bus is at 0.32 of the master) */
  gain: 1.6,
  /** the music bus is lowered to this share while the name is called */
  duck: 0.3,
  duckIn: 0.06,
  duckOut: 0.35,
  /** pause between the name and the animal's own sound */
  gap: 0.15,
  /** do not wait longer than this for a file that is still loading (seconds after the animal appeared) */
  wait: 1.2,
  /** pause after the animal's sound before the spoken prompt */
  beforePrompt: 0.25,
  /** a spoken name (speech synthesis) is given this long before the animal's sound */
  speechLead: 0.9,
} as const;

export type NameStatus = "off" | "idle" | "loading" | "ready" | "failed";
export type Fetcher = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

export class NameVoice {
  private bufs = new Map<AnimalId, AudioBuffer>();
  private state = new Map<AnimalId, "loading" | "failed">();
  private src: AudioBufferSourceNode | null = null;
  private dead = false;
  /** number of fetches started (tests / debug) */
  fetches = 0;

  constructor(
    private getGraph: () => VoiceGraph | null,
    private manifest: Readonly<Record<AnimalId, boolean>> = NAME_AUDIO,
    private fetcher: Fetcher = (u) => fetch(u),
  ) {}

  /** a recording is listed for this animal */
  wants(id: AnimalId): boolean {
    return this.manifest[id];
  }

  status(id: AnimalId): NameStatus {
    if (!this.manifest[id]) return "off";
    if (this.bufs.has(id)) return "ready";
    return this.state.get(id) ?? "idle";
  }

  /** Starts loading the file of `id` once (needs the audio graph: before the first user gesture nothing happens). */
  load(id: AnimalId): void {
    if (this.dead || !this.manifest[id] || this.bufs.has(id) || this.state.has(id)) return;
    const g = this.getGraph();
    if (!g) return;
    this.state.set(id, "loading");
    this.fetches++;
    void this.fetchDecode(id, g.ac);
  }

  private async fetchDecode(id: AnimalId, ac: AudioContext): Promise<void> {
    try {
      const r = await this.fetcher(nameAudioUrl(id));
      if (!r.ok) throw new Error("missing");
      const buf = await ac.decodeAudioData(await r.arrayBuffer());
      if (this.dead) return;
      this.bufs.set(id, buf);
      this.state.delete(id);
      this.warmNext();
    } catch {
      // silent: the game falls back to the banner / speech
      this.state.set(id, "failed");
    }
  }

  /** after one file arrived the others are fetched one by one in the background */
  private warmNext(): void {
    for (const id of Object.keys(this.manifest) as AnimalId[]) {
      if (this.manifest[id] && !this.bufs.has(id) && !this.state.has(id)) {
        this.load(id);
        return;
      }
    }
  }

  /** Plays the name now, loud, with the music ducked. Returns its length in seconds (0 = not played). */
  play(id: AnimalId): number {
    const g = this.getGraph();
    const buf = this.bufs.get(id);
    if (this.dead || !g || !buf) return 0;
    try {
      const ac = g.ac;
      const t0 = ac.currentTime + 0.02;
      const src = ac.createBufferSource();
      const amp = ac.createGain();
      src.buffer = buf;
      amp.gain.value = NAME_CFG.gain;
      src.connect(amp);
      amp.connect(g.sfx);
      src.onended = () => {
        src.disconnect();
        amp.disconnect();
        if (this.src === src) this.src = null;
      };
      this.stop();
      this.src = src;
      src.start(t0);
      this.duck(g, t0, buf.duration);
      return buf.duration;
    } catch {
      return 0;
    }
  }

  private duck(g: VoiceGraph, t0: number, len: number): void {
    const p = (g.music as GainNode | undefined)?.gain;
    if (!p || typeof p.setValueAtTime !== "function") return;
    try {
      const v = p.value;
      const low = v * NAME_CFG.duck;
      p.cancelScheduledValues(t0);
      p.setValueAtTime(v, t0);
      p.linearRampToValueAtTime(low, t0 + NAME_CFG.duckIn);
      p.setValueAtTime(low, t0 + len);
      p.linearRampToValueAtTime(v, t0 + len + NAME_CFG.duckOut);
    } catch {
      /* ignore */
    }
  }

  stop(): void {
    try {
      this.src?.stop();
    } catch {
      /* already ended */
    }
    this.src = null;
  }

  dispose(): void {
    this.dead = true;
    this.stop();
  }
}

export interface AnnounceDeps {
  names: NameVoice;
  /** speech synthesis with an Uzbek voice is available */
  canSpeak(): boolean;
  /** say just the name ("Quyoncha!") through the kit voice */
  speakName(a: AnimalDef): void;
  /** the animal's own synthesised sound */
  playSound(a: AnimalDef): void;
}

type Stage = "idle" | "wait" | "set";

/** Timeline of one appearance. `tick(t)` gets the seconds since the animal appeared. Allocation-free. */
export class Announcer {
  private stage: Stage = "idle";
  private soundAt = 0;
  private soundDone = true;
  /** a name is spoken / played, so the prompt waits for the animal's sound */
  private voiced = false;
  /** how the last appearance sounded: "file" (recording), "speech" (synthesis), "plain" (animal sound only) */
  mode: "file" | "speech" | "plain" = "plain";

  constructor(private d: AnnounceDeps) {}

  begin(a: AnimalDef): void {
    this.soundDone = false;
    this.voiced = false;
    this.mode = "plain";
    if (this.d.names.wants(a.id)) {
      this.stage = "wait";
      this.d.names.load(a.id);
      this.poll(a, 0);
    } else this.fallback(a, 0);
  }

  tick(a: AnimalDef, t: number): void {
    if (this.stage === "wait") this.poll(a, t);
    if (this.stage === "set" && !this.soundDone && t >= this.soundAt) {
      this.soundDone = true;
      this.d.playSound(a);
    }
  }

  /** Seconds after the appearance at which the spoken prompt should come (Infinity: not known yet). */
  promptAt(a: AnimalDef): number {
    if (this.stage === "wait") return Number.POSITIVE_INFINITY;
    if (!this.voiced) return ROUND_CFG.voiceAt;
    return Math.max(ROUND_CFG.voiceAt, this.soundAt + SOUND_LEN[a.id] + NAME_CFG.beforePrompt);
  }

  private poll(a: AnimalDef, t: number): void {
    const s = this.d.names.status(a.id);
    if (s === "ready") {
      const len = this.d.names.play(a.id);
      if (len > 0) {
        this.stage = "set";
        this.voiced = true;
        this.mode = "file";
        this.soundAt = t + len + NAME_CFG.gap;
        return;
      }
      this.fallback(a, t);
    } else if (s === "failed" || s === "off" || t >= NAME_CFG.wait) this.fallback(a, t);
  }

  private fallback(a: AnimalDef, t: number): void {
    this.stage = "set";
    if (this.d.canSpeak()) {
      this.d.speakName(a);
      this.voiced = true;
      this.mode = "speech";
      this.soundAt = t + NAME_CFG.speechLead;
    } else this.soundAt = t;
    if (this.soundAt <= t) this.tick(a, t);
  }
}
