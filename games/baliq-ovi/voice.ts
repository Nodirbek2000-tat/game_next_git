// Voice play for kids (pure logic, no browser APIs): keywords ("fish", "pull", "baliq", "tort"), a loudness / rhythm
// detector for when no on-device recogniser exists, and the decision "what does this sound mean right now?".
// The browser glue (SpeechRecognition with processLocally, microphone) lives in voiceInput.ts.

import { clamp } from "./rules";

/** What the angler is doing, as far as the voice is concerned. */
export type VoiceCtx = "ready" | "wait" | "nibble" | "bite" | "fight" | "other";
export type VoiceAction = "cast" | "strike" | "pull" | "none";
export type Keyword = "fish" | "pull";
export type VoiceEventKind = Keyword | "shout";

const FISH_WORDS = ["fish", "fishing", "fisher", "fishy", "baliq", "baliqcha", "balik", "balyk", "fiss", "fis"];
const PULL_WORDS = ["pull", "pulling", "poole", "pool", "tort", "tortish", "tortay", "tortaman", "tartish"];

/** lower case, no accents, apostrophe variants removed ("baliq", "tort") */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʻʼ`´']/g, "")
    .replace(/[^a-z0-9\u0400-\u04FF ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchWord(w: string): Keyword | null {
  if (FISH_WORDS.includes(w)) return "fish";
  if (PULL_WORDS.includes(w)) return "pull";
  return null;
}

/** Every keyword in the transcript, in order ("fish fish pull" -> fish, fish, pull). */
export function keywordsIn(transcript: string): Keyword[] {
  const out: Keyword[] = [];
  for (const w of normalizeText(transcript).split(" ")) {
    const k = matchWord(w);
    if (k) out.push(k);
  }
  return out;
}

/**
 * Speech recognisers send the same growing transcript again and again (interim results). This remembers how many
 * keywords of every result were already reported, so each spoken word triggers exactly once.
 */
export class KeywordStream {
  private seen: number[] = [];
  reset(): void {
    this.seen.length = 0;
  }
  /** Feed result `index` with its current transcript; returns the keywords that are new. */
  feed(index: number, transcript: string, out: Keyword[] = []): Keyword[] {
    out.length = 0;
    const all = keywordsIn(transcript);
    const done = this.seen[index] ?? 0;
    for (let i = done; i < all.length; i++) out.push(all[i]);
    if (all.length > done) this.seen[index] = all.length;
    return out;
  }
}

/**
 * What a keyword means. Kids mode is lenient (any keyword does the right thing for the moment: a child that shouts
 * "fish" while the fish pulls simply wants to pull); otherwise only the matching word works.
 */
export function decideKeyword(k: Keyword, ctx: VoiceCtx, lenient: boolean): VoiceAction {
  switch (ctx) {
    case "ready":
      return k === "fish" || lenient ? "cast" : "none";
    case "bite":
      return k === "pull" || lenient ? "strike" : "none";
    case "fight":
      return k === "pull" || lenient ? "pull" : "none";
    default:
      return "none"; // never scare the fish while waiting for the bite
  }
}

/** Loudness fallback: repeated shouts while waiting cast, one shout at the bite strikes, shouts in the fight pull. */
export function decideShouts(count: number, ctx: VoiceCtx): VoiceAction {
  switch (ctx) {
    case "ready":
      return count >= 2 ? "cast" : "none";
    case "bite":
      return count >= 1 ? "strike" : "none";
    case "fight":
      return count >= 1 ? "pull" : "none";
    default:
      return "none";
  }
}

/** Cast power from how many words were said (or shouts were made) and how loud. */
export function voiceCastPower(count: number, loudness = 0.5): number {
  return clamp(0.34 + 0.22 * (count - 1) + loudness * 0.12, 0.34, 1);
}

// ---------------------------------------------------------------- loudness / rhythm

export const SHOUT = {
  /** absolute minimum level (RMS 0..1) that can count as a shout */
  minLevel: 0.06,
  /** a shout must start after this much quiet (s): one long shout is one event */
  quietBefore: 0.12,
  /** a shout longer than this is treated as noise and ends */
  maxLen: 1.2,
  /** the noise floor follows the quiet level with this rate (1/s) */
  floorRate: 0.6,
} as const;

/** Detects the start of short shouts in a stream of mic levels. Returns the peak-ish level on the onset frame, else 0. */
export class ShoutDetector {
  /** estimated background noise (RMS) */
  floor = 0.01;
  /** current threshold */
  threshold: number = SHOUT.minLevel;
  private quiet = 1;
  private active = false;
  private len = 0;
  private below = 0;

  reset(): void {
    this.floor = 0.01;
    this.threshold = SHOUT.minLevel;
    this.quiet = 1;
    this.active = false;
    this.len = this.below = 0;
  }

  update(dt: number, level: number): number {
    const lv = clamp(level, 0, 1);
    this.threshold = Math.max(SHOUT.minLevel, this.floor * 3.5 + 0.02);
    let fired = 0;
    if (!this.active) {
      if (lv < this.threshold) {
        this.quiet += dt;
        this.floor += (lv - this.floor) * Math.min(1, SHOUT.floorRate * dt);
      } else if (this.quiet >= SHOUT.quietBefore) {
        this.active = true;
        this.len = 0;
        this.below = 0;
        this.quiet = 0;
        fired = lv;
      } else {
        this.quiet = 0; // still ringing from the previous one: wait for a real pause
      }
    } else {
      this.len += dt;
      if (lv < this.threshold * 0.6) this.below += dt;
      else this.below = 0;
      if (this.below > 0.06 || this.len > SHOUT.maxLen) {
        this.active = false;
        this.quiet = 0;
        // after a very long loud stretch the room is just loud: adapt the floor upwards
        if (this.len > SHOUT.maxLen) this.floor = Math.max(this.floor, lv * 0.8);
      }
    }
    return fired;
  }
}

// ---------------------------------------------------------------- the mixer

export interface VoiceOut {
  cast: boolean;
  castPower: number;
  strike: boolean;
  /** reel speed requested by the voice (circles / s equivalent), decays by itself */
  crank: number;
  /** a "pull" word was heard on this frame */
  pulled: boolean;
}

export const VOICE_TUNING = {
  /** after the first "fish" the game waits this long for more words (each extends it a little) */
  gather: 0.85,
  gatherExtend: 0.4,
  gatherMax: 1.7,
  /** repeated shouts must come within this window to count as a cast */
  shoutWindow: 2.2,
  /** one "pull" word reels this hard (circles/s) and fades over `pullFade` seconds */
  pullCrank: 1.6,
  pullFade: 0.85,
} as const;

/**
 * Turns voice events into game commands. `ctx` is set by the game every frame (what the angler is doing); events use
 * the latest `ctx`. Fish words and shouts are collected for a moment so that "fish fish fish" casts further than a single
 * "fish". No allocation after construction.
 */
export class VoiceControl {
  ctx: VoiceCtx = "other";
  /** kids: any keyword means the right thing for the situation */
  lenient = true;
  readonly out: VoiceOut = { cast: false, castPower: 0, strike: false, crank: 0, pulled: false };
  /** counters for tests / the debug panel */
  events = 0;
  lastEvent: VoiceEventKind | "" = "";
  private gatherT = 0;
  private gatherAge = 0;
  private gatherN = 0;
  private gatherLoud = 0;
  private gatherShout = false;
  private shoutN = 0;
  private shoutT = 0;
  private strikeNow = false;
  private pullNow = false;
  private crank = 0;
  private crankT = 0;

  reset(): void {
    this.gatherT = this.gatherAge = this.gatherN = this.gatherLoud = 0;
    this.gatherShout = false;
    this.shoutN = 0;
    this.shoutT = 0;
    this.strikeNow = this.pullNow = false;
    this.crank = this.crankT = 0;
    this.out.cast = this.out.strike = this.out.pulled = false;
    this.out.castPower = this.out.crank = 0;
  }

  /** A keyword was heard ("fish" / "pull") or a shout began (`level` 0..1). */
  onEvent(kind: VoiceEventKind, level = 0.5): void {
    this.events++;
    this.lastEvent = kind;
    const ctx = this.ctx;
    if (kind === "shout") {
      this.shoutN = this.shoutT > 0 ? this.shoutN + 1 : 1;
      this.shoutT = VOICE_TUNING.shoutWindow;
      const a = decideShouts(this.shoutN, ctx);
      this.act(a, level, true, this.shoutN);
      return;
    }
    this.act(decideKeyword(kind, ctx, this.lenient), level, false, 1);
  }

  private act(a: VoiceAction, level: number, shout: boolean, count: number): void {
    if (a === "cast") {
      if (this.gatherN === 0) {
        this.gatherT = VOICE_TUNING.gather;
        this.gatherAge = 0;
        this.gatherShout = shout;
      } else if (this.gatherAge < VOICE_TUNING.gatherMax) this.gatherT += VOICE_TUNING.gatherExtend;
      this.gatherN = Math.max(this.gatherN + 1, count);
      this.gatherLoud = Math.max(this.gatherLoud, level);
    } else if (a === "strike") this.strikeNow = true;
    else if (a === "pull") {
      this.pullNow = true;
      this.crank = VOICE_TUNING.pullCrank;
      this.crankT = VOICE_TUNING.pullFade;
    }
  }

  update(dt: number): VoiceOut {
    const o = this.out;
    o.cast = false;
    o.strike = this.strikeNow;
    o.pulled = this.pullNow;
    this.strikeNow = this.pullNow = false;
    if (this.shoutT > 0) {
      this.shoutT -= dt;
      if (this.shoutT <= 0) this.shoutN = 0;
    }
    if (this.gatherN > 0) {
      this.gatherT -= dt;
      this.gatherAge += dt;
      if (this.ctx !== "ready") {
        // the situation changed (the rod is already out): forget the gathered words
        this.gatherN = 0;
        this.gatherLoud = 0;
      } else if (this.gatherT <= 0) {
        o.cast = true;
        o.castPower = voiceCastPower(this.gatherN, this.gatherLoud);
        this.gatherN = 0;
        this.gatherLoud = 0;
      }
    }
    if (this.crankT > 0) {
      this.crankT -= dt;
      const k = clamp(this.crankT / VOICE_TUNING.pullFade, 0, 1);
      o.crank = VOICE_TUNING.pullCrank * (0.35 + 0.65 * k) * (this.crankT > 0 ? 1 : 0);
    } else o.crank = 0;
    if (this.ctx !== "fight") {
      o.crank = 0;
      this.crankT = 0;
    }
    return o;
  }
}
