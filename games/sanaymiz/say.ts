// Custom spoken prompts for the kids games ("3 marta sakrang!", "Qizil sharni ushlang!"). The kit's Voice only knows a fixed
// list of prompt ids, so this small helper reuses its banner (big icon + text, nobody has to read) and speaks the text with the
// browser's Uzbek voice when there is one (otherwise the kit's attention jingle plays). Shared by havoda-rasm and sanaymiz.

import { findUzbekVoice, type KidsKit } from "../bogcha/common";

export class Speaker {
  private uz: SpeechSynthesisVoice | null = null;
  private lastText = "";
  private lastAt = -1e9;

  constructor(private readonly kit: KidsKit) {}

  private muted(): boolean {
    const g = this.kit.engine.audio.graph?.();
    return !!g && g.sfx.gain.value === 0;
  }

  private voice(): SpeechSynthesisVoice | null {
    if (this.uz) return this.uz;
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
      this.uz = findUzbekVoice(window.speechSynthesis.getVoices());
    } catch {
      this.uz = null;
    }
    return this.uz;
  }

  private talk(text: string): boolean {
    const v = this.voice();
    if (!v || typeof SpeechSynthesisUtterance === "undefined") return false;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[‘’]/g, "'"));
      u.voice = v;
      u.lang = v.lang || "uz-UZ";
      u.rate = 0.85;
      u.pitch = 1.3;
      synth.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  /** big banner (icon + text) under the timer, spoken when possible */
  say(text: string, icon: string, showMs = 3200): void {
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < 1200) return;
    this.lastText = text;
    this.lastAt = now;
    const b = this.kit.voice.banner;
    b.text = text;
    b.icon = icon;
    b.until = now + showMs;
    if (this.muted()) return;
    if (!this.talk(text)) this.kit.sfx.attention();
  }

  /** speak only (a counted number), no banner and no jingle */
  speak(text: string): void {
    if (this.muted()) return;
    this.talk(text);
  }
}
