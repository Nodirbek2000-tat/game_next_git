// "Hayvonlardek harakat": the six animals, the movement each one asks for and its spoken prompt (Uzbek Latin).
// The kit's PROMPTS table is fixed, so the animal prompts are registered into it at start (see registerPrompts) —
// that way kit.voice.say() does the speech / jingle fallback / banner / "same prompt not within 1.2 s" for us.

import { PROMPTS } from "../bogcha/common";

export type AnimalId = "quyon" | "qush" | "baqa" | "ayiq" | "pingvin" | "toshbaqa";
export type Move = "jump" | "flap" | "froghop" | "handsUp" | "clap" | "slowSquat";

export interface AnimalDef {
  id: AnimalId;
  emoji: string;
  move: Move;
  /** id in the kit's PROMPTS table */
  promptId: string;
  /** spoken + shown text */
  text: string;
  /** the animal's own name in the child-like form, under the animal ("Quyoncha") */
  name: string;
  /** id in the kit's PROMPTS table of the called name ("Quyoncha!") */
  nameId: string;
}

export const ANIMALS: readonly AnimalDef[] = [
  { id: "quyon", emoji: "🐰", move: "jump", promptId: "hv-quyon", text: "Quyonchadek sakrang!", name: "Quyoncha", nameId: "hv-name-quyon" },
  { id: "qush", emoji: "🐦", move: "flap", promptId: "hv-qush", text: "Qushchadek qanot qoqing!", name: "Qushcha", nameId: "hv-name-qush" },
  { id: "baqa", emoji: "🐸", move: "froghop", promptId: "hv-baqa", text: "Baqachadek cho‘qqayib sakrang!", name: "Baqacha", nameId: "hv-name-baqa" },
  { id: "ayiq", emoji: "🐻", move: "handsUp", promptId: "hv-ayiq", text: "Ayiqchadek qo‘llarni ko‘taring!", name: "Ayiqcha", nameId: "hv-name-ayiq" },
  { id: "pingvin", emoji: "🐧", move: "clap", promptId: "hv-pingvin", text: "Pingvindek qarsak chaling!", name: "Pingvincha", nameId: "hv-name-pingvin" },
  { id: "toshbaqa", emoji: "🐢", move: "slowSquat", promptId: "hv-toshbaqa", text: "Toshbaqadek sekin cho‘qqayib o‘tiring!", name: "Toshbaqacha", nameId: "hv-name-toshbaqa" },
];

export const ANIMAL_IDS: readonly AnimalId[] = ANIMALS.map((a) => a.id);

export function animalById(id: string): AnimalDef | undefined {
  for (const a of ANIMALS) if (a.id === id) return a;
  return undefined;
}

/**
 * Recorded child voices saying the animal's name ("Quyoncha!") live at `/audio/bogcha/hayvonlar/<id>.mp3`
 * (public/audio/bogcha/hayvonlar/). Flip an entry to true once its file has been added: while it is false nothing is
 * requested (no 404 in the console) and the game falls back to speech / banner only.
 */
export const NAME_AUDIO: Record<AnimalId, boolean> = {
  quyon: false,
  qush: false,
  baqa: false,
  ayiq: false,
  pingvin: false,
  toshbaqa: false,
};

export const nameAudioUrl = (id: AnimalId): string => `/audio/bogcha/hayvonlar/${id}.mp3`;

/** Adds the animal prompts and the called names to the kit's prompt table (idempotent). */
export function registerPrompts(): void {
  const table = PROMPTS as Record<string, { text: string; icon: string }>;
  for (const a of ANIMALS) {
    table[a.promptId] = { text: a.text, icon: a.emoji };
    table[a.nameId] = { text: `${a.name}!`, icon: a.emoji };
  }
}
