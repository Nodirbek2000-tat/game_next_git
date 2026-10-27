// Voice prompts for children who cannot read. Uses speechSynthesis with an Uzbek voice (uz-UZ) when the browser has one;
// otherwise a short attention jingle is played. Either way a big icon + the text appear on screen (HUD banner), so the
// teacher / the picture explains the task even without speech.

import type { KidSfx } from "./music";

export type PromptId = "handsUp" | "jump" | "freeze" | "squat" | "clap" | "wave" | "armsOut" | "dance" | "bravo" | "again" | "pop" | "fish";

export interface Prompt {
  text: string;
  icon: string;
}

/** Uzbek (Latin) prompts. */
export const PROMPTS: Record<PromptId, Prompt> = {
  handsUp: { text: "Qo‘llarni ko‘taring!", icon: "🙌" },
  jump: { text: "Sakrang!", icon: "🦘" },
  freeze: { text: "Qotib qoling!", icon: "🧊" },
  squat: { text: "O‘tirib turing!", icon: "🐣" },
  clap: { text: "Qarsak chaling!", icon: "👏" },
  wave: { text: "Qo‘l silkitamiz!", icon: "👋" },
  armsOut: { text: "Qanot qoqing!", icon: "🦅" },
  dance: { text: "Raqsga tushamiz!", icon: "💃" },
  bravo: { text: "Barakalla!", icon: "🌟" },
  again: { text: "Yana bir bor!", icon: "🔁" },
  pop: { text: "Pufakchalarni yoring!", icon: "🫧" },
  fish: { text: "Baliqchalarni tuting!", icon: "🐟" },
};

export interface SpeechLike {
  getVoices(): { lang: string; name: string }[];
  speak(u: unknown): void;
  cancel(): void;
  addEventListener?(type: string, cb: () => void): void;
  removeEventListener?(type: string, cb: () => void): void;
}

export interface Banner {
  text: string;
  icon: string;
  /** performance.now() ms until which the banner is shown */
  until: number;
}

/** The first Uzbek voice (uz-UZ, uz_UZ, uz), or null. */
export function findUzbekVoice<T extends { lang: string }>(voices: readonly T[]): T | null {
  for (const v of voices) {
    const l = v.lang.toLowerCase().replace("_", "-");
    if (l === "uz" || l.startsWith("uz-")) return v;
  }
  return null;
}

export class Voice {
  /** what is currently said / shown; the HUD draws it while `now < banner.until` */
  readonly banner: Banner = { text: "", icon: "", until: 0 };
  private lastId: PromptId | "" = "";
  private lastAt = -1e9;
  private synth: SpeechLike | null;
  private uz: unknown = null;
  private onVoices = (): void => this.refresh();

  constructor(
    private sfx: KidSfx,
    private opts: { muted?: () => boolean; synth?: SpeechLike | null } = {},
  ) {
    this.synth = opts.synth !== undefined ? opts.synth : typeof window !== "undefined" && "speechSynthesis" in window ? (window.speechSynthesis as unknown as SpeechLike) : null;
    this.synth?.addEventListener?.("voiceschanged", this.onVoices);
    this.refresh();
  }

  /** "speech" when an Uzbek voice exists, else "jingle" (icon + attention jingle only) */
  get mode(): "speech" | "jingle" {
    return this.uz ? "speech" : "jingle";
  }

  private refresh(): void {
    try {
      this.uz = this.synth ? findUzbekVoice(this.synth.getVoices()) : null;
    } catch {
      this.uz = null;
    }
  }

  /** Say a prompt and show it. The same prompt is not repeated within 1.2 s. `showMs`: how long the banner stays. */
  say(id: PromptId, showMs = 2600): void {
    const now = performance.now();
    if (id === this.lastId && now - this.lastAt < 1200) return;
    this.lastId = id;
    this.lastAt = now;
    const p = PROMPTS[id];
    this.banner.text = p.text;
    this.banner.icon = p.icon;
    this.banner.until = now + showMs;
    if (this.opts.muted?.()) return;
    if (this.uz && this.synth && typeof SpeechSynthesisUtterance !== "undefined") {
      try {
        this.synth.cancel();
        const u = new SpeechSynthesisUtterance(p.text.replace(/[‘’]/g, "'"));
        u.voice = this.uz as SpeechSynthesisVoice;
        u.lang = (this.uz as SpeechSynthesisVoice).lang || "uz-UZ";
        u.rate = 0.85;
        u.pitch = 1.3;
        this.synth.speak(u);
        return;
      } catch {
        /* fall through to the jingle */
      }
    }
    this.sfx.attention();
  }

  hide(): void {
    this.banner.until = 0;
  }

  dispose(): void {
    this.synth?.removeEventListener?.("voiceschanged", this.onVoices);
    try {
      this.synth?.cancel();
    } catch {
      /* ignore */
    }
  }
}
