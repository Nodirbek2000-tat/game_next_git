// "Harflar": recognise a body letter from the wrists / ankles (pure, in px and body scales).

export type Letter = "I" | "T" | "Y" | "X";
export const LETTERS: readonly Letter[] = ["I", "T", "Y", "X"];
export const HOLD_SEC = 1;

export interface ShapeIn {
  /** shoulder width in px */
  scale: number;
  headY: number;
  shoulderY: number;
  lwx: number;
  lwy: number;
  lwv: number;
  rwx: number;
  rwy: number;
  rwv: number;
  /** horizontal distance between the ankles in px (ignored without `legsSeen`) */
  ankleDx: number;
  legsSeen: boolean;
}

/** "I" arms up together, "T" arms out sideways, "Y" arms up in a V, "X" arms up in a V and legs wide. "" = none. */
export function classify(s: ShapeIn): Letter | "" {
  if (s.lwv < 0.15 || s.rwv < 0.15 || s.scale <= 0) return "";
  const dx = Math.abs(s.lwx - s.rwx) / s.scale;
  const up = s.lwy < s.headY && s.rwy < s.headY;
  if (up) {
    if (dx < 1.4) return "I";
    if (dx < 1.9) return "";
    const wide = s.legsSeen && s.ankleDx > 1.7 * s.scale;
    return wide ? "X" : "Y";
  }
  const level = Math.abs(s.lwy - s.shoulderY) < 0.7 * s.scale && Math.abs(s.rwy - s.shoulderY) < 0.7 * s.scale;
  return level && dx > 2.8 ? "T" : "";
}

/** time held: grows while the shape is right, drains twice as fast otherwise */
export const holdStep = (hold: number, ok: boolean, dt: number): number => (ok ? hold + dt : Math.max(0, hold - dt * 2));

/** pose of the picture figure: [arm dx, arm dy, leg dx] in units, arm vector from the shoulder (y down) */
export const POSES: Record<Letter, readonly [number, number, number]> = {
  I: [0.12, -1, 0.15],
  T: [1, 0, 0.15],
  Y: [0.65, -0.9, 0.15],
  X: [0.65, -0.9, 0.6],
};

export const LETTER_TEXT: Record<Letter, string> = {
  I: "I harfi — qo‘llar tepada, birga!",
  T: "T harfi — qo‘llar yon tomonga!",
  Y: "Y harfi — qo‘llar tepada, V shaklida!",
  X: "X harfi — qo‘l va oyoqlar keng!",
};

/** next letter after `prev`, never the same; `rnd` in 0..1. X only when `withX`. */
export function nextLetter(prev: Letter | "", rnd: number, withX: boolean): Letter {
  const pool = LETTERS.filter((l) => l !== prev && (withX || l !== "X"));
  return pool[Math.min(pool.length - 1, Math.floor(rnd * pool.length))];
}
