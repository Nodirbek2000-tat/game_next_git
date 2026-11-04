import type { GameModule } from "../../types";
import { LOADERS as adultA } from "./adult-a";
import { LOADERS as adultB } from "./adult-b";
import { LOADERS as kidsA } from "./kids-a";
import { LOADERS as kidsB } from "./kids-b";

/** Sinov (lab) o'yinlari, lib/lab bilan bir xil sluglar. */
export const LAB_LOADERS: Record<string, () => Promise<{ default: GameModule }>> = { ...kidsA, ...kidsB, ...adultA, ...adultB };
