// Browser glue for the voice play: 1) on-device speech recognition (Chrome SpeechRecognition with processLocally = true,
// used only when the language pack is already installed), else 2) a microphone loudness / rhythm detector.
// Privacy: audio never leaves the device. Without an on-device recogniser the browser's cloud recogniser is NOT used.
// The microphone is opened only after start() (the player turned the voice option on).

import { KeywordStream, ShoutDetector, type Keyword, type VoiceEventKind } from "./voice";

export type VoiceStatus = "off" | "starting" | "keywords" | "loudness" | "denied" | "unavailable";

interface SrAlt {
  transcript: string;
}
interface SrResult {
  isFinal?: boolean;
  length: number;
  [i: number]: SrAlt;
}
interface SrEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SrResult };
}
interface SrInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: SrEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SrCtor {
  new (): SrInstance;
  available?: (o: { langs: string[]; processLocally?: boolean }) => Promise<string>;
}

const LANG = "en-US";

/** Is there a recogniser that runs on the device? (Never triggers a download.) */
export async function onDeviceRecognizer(): Promise<SrCtor | null> {
  try {
    const w = window as unknown as { SpeechRecognition?: SrCtor; webkitSpeechRecognition?: SrCtor };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C || typeof C.available !== "function" || !("processLocally" in C.prototype)) return null;
    const st = await C.available({ langs: [LANG], processLocally: true });
    return st === "available" ? C : null;
  } catch {
    return null;
  }
}

export class VoiceInput {
  status: VoiceStatus = "off";
  /** short Uzbek text for the HUD */
  label = "";
  /** current mic level 0..1 (loudness mode only) */
  level = 0;
  /** what was heard last (debug / HUD) */
  lastHeard = "";
  readonly shouts = new ShoutDetector();
  private stream = new KeywordStream();
  private rec: SrInstance | null = null;
  private wantRun = false;
  private restartAt = 0;
  private restarts = 0;
  private ac: AudioContext | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private mic: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array<ArrayBuffer> | null = null;
  private tmpKw: Keyword[] = [];
  private disposed = false;

  constructor(private onEvent: (kind: VoiceEventKind, level: number) => void) {}

  /** Turn the voice on: asks for the microphone (the browser shows its own permission prompt). */
  async start(): Promise<void> {
    if (this.status !== "off" || this.disposed) return;
    this.status = "starting";
    this.label = "Mikrofon yoqilmoqda…";
    this.wantRun = true;
    const C = await onDeviceRecognizer();
    if (this.disposed || !this.wantRun) return;
    if (C && this.startRecognizer(C)) return;
    await this.startLoudness();
  }

  private startRecognizer(C: SrCtor): boolean {
    try {
      const r = new C();
      r.lang = LANG;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.processLocally = true; // on-device only: if that is not possible the recogniser errors instead of using a server
      r.onresult = (e) => this.onResult(e);
      r.onerror = (e) => this.onError(e.error ?? "");
      r.onend = () => {
        this.stream.reset();
        if (!this.wantRun || this.status !== "keywords") return;
        // Chrome ends the session now and then: start again, but not in a tight loop
        this.restarts++;
        this.restartAt = performance.now() + (this.restarts > 8 ? 2000 : 250);
        setTimeout(() => this.restartRecognizer(), Math.max(0, this.restartAt - performance.now()));
      };
      this.rec = r;
      r.start();
      this.status = "keywords";
      this.label = "Ovoz: «fish» — tashlash, «pull» — tortish";
      return true;
    } catch {
      this.rec = null;
      return false;
    }
  }

  private restartRecognizer(): void {
    if (!this.wantRun || !this.rec || this.status !== "keywords") return;
    try {
      this.rec.start();
    } catch {
      /* already running */
    }
  }

  private onResult(e: SrEvent): void {
    const n = e.results.length;
    for (let i = e.resultIndex; i < n; i++) {
      const res = e.results[i];
      const text = res?.[0]?.transcript ?? "";
      if (!text) continue;
      this.lastHeard = text;
      const kws = this.stream.feed(i, text, this.tmpKw);
      for (let k = 0; k < kws.length; k++) this.onEvent(kws[k], 0.6);
    }
  }

  private onError(code: string): void {
    if (code === "no-speech" || code === "aborted") return; // normal
    if (code === "not-allowed" || code === "service-not-allowed") {
      this.status = "denied";
      this.label = "Mikrofonga ruxsat berilmadi — ovozsiz o‘ynang";
      this.stopRecognizer();
      return;
    }
    // language pack missing, audio capture problem, ...: use the loudness detector instead (still on the device)
    this.stopRecognizer();
    if (this.wantRun) void this.startLoudness();
  }

  private stopRecognizer(): void {
    const r = this.rec;
    this.rec = null;
    if (!r) return;
    r.onresult = r.onerror = r.onend = null;
    try {
      r.abort();
    } catch {
      /* ignore */
    }
  }

  private async startLoudness(): Promise<void> {
    try {
      const md = navigator.mediaDevices;
      if (!md?.getUserMedia) throw new Error("no mic api");
      const mic = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      if (this.disposed || !this.wantRun) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      if (mic.getAudioTracks().length === 0) {
        mic.getTracks().forEach((t) => t.stop());
        this.status = "unavailable";
        this.label = "Mikrofon topilmadi — ovozsiz o‘ynang";
        return;
      }
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new Ctor();
      const src = ac.createMediaStreamSource(mic);
      const an = ac.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0;
      src.connect(an); // not connected to the speakers
      this.mic = mic;
      this.ac = ac;
      this.src = src;
      this.analyser = an;
      this.buf = new Uint8Array(an.fftSize);
      this.shouts.reset();
      this.status = "loudness";
      this.label = "Ovoz: ketma-ket 2–3 marta baqiring";
      if (ac.state === "suspended") void ac.resume().catch(() => undefined);
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      this.status = name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
      this.label = this.status === "denied" ? "Mikrofonga ruxsat berilmadi — ovozsiz o‘ynang" : "Mikrofon topilmadi — ovozsiz o‘ynang";
    }
  }

  /** Call every frame: reads the mic level and reports shouts (loudness mode only). */
  poll(dt: number): void {
    const an = this.analyser;
    const buf = this.buf;
    if (this.status !== "loudness" || !an || !buf) return;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    this.level += (Math.min(1, rms * 3) - this.level) * Math.min(1, dt * 20);
    const fired = this.shouts.update(dt, rms);
    if (fired > 0) this.onEvent("shout", Math.min(1, fired * 3));
  }

  stop(): void {
    this.wantRun = false;
    this.stopRecognizer();
    try {
      this.src?.disconnect();
    } catch {
      /* ignore */
    }
    this.mic?.getTracks().forEach((t) => t.stop());
    void this.ac?.close().catch(() => undefined);
    this.ac = null;
    this.src = null;
    this.mic = null;
    this.analyser = null;
    this.buf = null;
    this.level = 0;
    this.status = "off";
    this.label = "";
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}

// ---------------------------------------------------------------- the player's choice (kept on this device)

const KEY = "harakat.baliq-ovi.voice";

/** Voice is on by default in kids mode, off otherwise; the player's own choice wins. */
export function loadVoicePref(kids: boolean): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* storage blocked: use the default */
  }
  return kids;
}

export function saveVoicePref(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
