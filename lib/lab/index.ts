// Sinov (lab) o'yinlari: 20 ta yangi g'oya, keyin qaysilari qolishi tanlanadi. Har guruh o'z faylida.
import type { GameInfo } from "../games";
import { GAMES as adultA } from "./adult-a";
import { GAMES as adultB } from "./adult-b";
import { GAMES as kidsA } from "./kids-a";
import { GAMES as kidsB } from "./kids-b";

export const LAB_GAMES: GameInfo[] = [...kidsA, ...kidsB, ...adultA, ...adultB];
