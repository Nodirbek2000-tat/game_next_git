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
}

export const ANIMALS: readonly AnimalDef[] = [
  { id: "quyon", emoji: "🐰", move: "jump", promptId: "hv-quyon", text: "Quyonchadek sakrang!" },
  { id: "qush", emoji: "🐦", move: "flap", promptId: "hv-qush", text: "Qushchadek qanot qoqing!" },
  { id: "baqa", emoji: "🐸", move: "froghop", promptId: "hv-baqa", text: "Baqachadek cho‘qqayib sakrang!" },
  { id: "ayiq", emoji: "🐻", move: "handsUp", promptId: "hv-ayiq", text: "Ayiqchadek qo‘llarni ko‘taring!" },
  { id: "pingvin", emoji: "🐧", move: "clap", promptId: "hv-pingvin", text: "Pingvindek qarsak chaling!" },
  { id: "toshbaqa", emoji: "🐢", move: "slowSquat", promptId: "hv-toshbaqa", text: "Toshbaqadek sekin cho‘qqayib o‘tiring!" },
];

export const ANIMAL_IDS: readonly AnimalId[] = ANIMALS.map((a) => a.id);

export function animalById(id: string): AnimalDef | undefined {
  for (const a of ANIMALS) if (a.id === id) return a;
  return undefined;
}

/** Adds the animal prompts to the kit's prompt table (idempotent). */
export function registerPrompts(): void {
  const table = PROMPTS as Record<string, { text: string; icon: string }>;
  for (const a of ANIMALS) table[a.promptId] = { text: a.text, icon: a.emoji };
}
