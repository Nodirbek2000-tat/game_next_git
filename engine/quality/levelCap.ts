import type { QualityLevel } from "../types";

const ORDER: QualityLevel[] = ["low", "medium", "high"];
/** A remembered level expires, so one bad session (or a busy machine) does not lower the graphics for good. */
const TTL_MS = 7 * 24 * 3600 * 1000;

interface Stored {
  gpu: string;
  level: QualityLevel;
  at: number;
}

const key = (slug: string): string => `harakat.levelCap.${slug}`;

export function lowerLevel(a: QualityLevel, b: QualityLevel | null): QualityLevel {
  return b !== null && ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a;
}

/** The level this game last settled on with this GPU, or null when there is none (or it expired). */
export function readLevelCap(slug: string, gpu: string, now: number): QualityLevel | null {
  try {
    const s = JSON.parse(localStorage.getItem(key(slug)) ?? "null") as Stored | null;
    if (!s || s.gpu !== gpu || now - s.at > TTL_MS || !ORDER.includes(s.level)) return null;
    return s.level;
  } catch {
    return null;
  }
}

export function writeLevelCap(slug: string, gpu: string, level: QualityLevel, now: number): void {
  try {
    localStorage.setItem(key(slug), JSON.stringify({ gpu, level, at: now } satisfies Stored));
  } catch {
    // no storage (private window): the controller still adapts within the session
  }
}
