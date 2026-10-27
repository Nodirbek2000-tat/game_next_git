// Voice for a group of children: ONE microphone, so a command is for everybody who needs it right now.
// "baliq" / "fish" (or two quick shouts) casts the idle lines, "tort" / "pull" (or one shout) pulls the biting ones.
// Reuses the pure keyword / shout rules of games/baliq-ovi/voice.ts (kids = lenient: any word does the right thing).
// Pure logic, no allocation.

import { decideKeyword, decideShouts, VOICE_TUNING, type VoiceEventKind } from "../baliq-ovi/voice";

export class GroupVoice {
  /** set by the game each frame: is there a line that can be cast / a fish that bites? */
  anyIdle = false;
  anyBite = false;
  /** one-frame commands, valid until `take()` */
  cast = false;
  pull = false;
  /** debug / tests */
  events = 0;
  lastEvent: VoiceEventKind | "" = "";
  private shoutN = 0;
  private shoutT = 0;

  reset(): void {
    this.cast = this.pull = false;
    this.shoutN = 0;
    this.shoutT = 0;
  }

  onEvent(kind: VoiceEventKind): void {
    this.events++;
    this.lastEvent = kind;
    if (kind === "shout") {
      this.shoutN = this.shoutT > 0 ? this.shoutN + 1 : 1;
      this.shoutT = VOICE_TUNING.shoutWindow;
      if (this.anyBite && decideShouts(this.shoutN, "bite") === "strike") this.pull = true;
      if (this.anyIdle && decideShouts(this.shoutN, "ready") === "cast") {
        this.cast = true;
        this.shoutN = 0;
      }
      return;
    }
    // words: the first one is enough, and a "pull" while the line is only waiting changes nothing (never scares the fish)
    if (this.anyBite && decideKeyword(kind, "bite", true) !== "none") this.pull = true;
    if (this.anyIdle && decideKeyword(kind, "ready", true) === "cast") this.cast = true;
  }

  update(dt: number): void {
    if (this.shoutT > 0) {
      this.shoutT -= dt;
      if (this.shoutT <= 0) this.shoutN = 0;
    }
  }

  /** Read and clear the commands (once per frame). */
  take(out: { cast: boolean; pull: boolean }): void {
    out.cast = this.cast;
    out.pull = this.pull;
    this.cast = this.pull = false;
  }
}
