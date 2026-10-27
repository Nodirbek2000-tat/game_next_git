// Public surface of the Bog‘cha kit: `import { defineKidsGame, ... } from "@/games/bogcha/common"`.
export { defineKidsGame, startKidsGame, type KidsGameDef, type KidsGameInstance, type KidsKit, type KidsRun } from "./kit";
export { drawKid, drawKids } from "./avatar";
export { KidsHud, pillPath, starPath } from "./hud";
export { KidSfx, MelodyScheduler, MusicPlayer, SONGS, midiHz, playNote, type Song, type SongId } from "./music";
export { PROMPTS, Voice, findUzbekVoice, type Prompt, type PromptId } from "./voice";
export { KID_ANIMALS, KID_COLORS, MAX_KIDS, type KidAnimal, type KidPt, type KidSignals, type KidSlot } from "@/engine/tracking/kids";
