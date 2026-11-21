// Nurli tor: the instruments. Each one has its own string sound (Karplus–Strong parameters), its own scale for the strings you pull
// out yourself, and a ready layout of strings (a guitar's six, a harp's ten, …) placed on the screen when it is chosen.

export interface Note {
  /** Uzbek solfège name shown on screen */
  name: string;
  freq: number;
  /** hue for the light (0..360) */
  hue: number;
}

export interface Voice {
  /** ring time (s) of the lowest and of the highest note */
  t60Low: number;
  t60High: number;
  /** where the string is plucked (0..0.5): small = thin and bright, 0.5 = round and soft */
  pick: number;
  /** loss filter: 0.5 = warm (nylon, silk), smaller = brighter, metallic */
  damp: number;
  /** two strings per note, this many cents apart (a double course: shimmer, like a dutor or a rubob); 0 = one string */
  course: number;
  /** lowpass of a soft pluck / of a hard one (Hz) */
  toneLow: number;
  toneHigh: number;
  gain: number;
  /** recordings of the real instrument (public/sounds/<dir>/<note>.mp3); the synthesis plays until they are loaded */
  samples?: { dir: string; notes: string[] };
}

// recordings: guitar — University of Iowa Musical Instrument Samples, harp — VSCO 2 Community Edition (via tonejs-instruments, CC-BY 3.0)
const GUITAR_REC = { dir: "nurli-tor/gitara", notes: ["E2", "A2", "D3", "G3", "B3", "E4", "A4", "D5"] };
const HARP_REC = { dir: "nurli-tor/arfa", notes: ["C3", "E3", "G3", "B3", "D4", "F4", "A4", "C5"] };

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** semitones from A4 of a note name like "E2", "As3" / "A#3" */
export function semiOfName(n: string): number {
  const m = /^([A-G])(s|#)?(-?\d)$/.exec(n);
  if (!m) return 0;
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] ? 1 : 0) - 69;
}

export interface Placed {
  /** ends, as parts of the screen (0..1) */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** semitones from A4 (440 Hz) */
  semi: number;
}

export interface Instrument {
  id: string;
  name: string;
  icon: string;
  voice: Voice;
  /** notes of the strings you pull out yourself (long = first = low) */
  scale: Note[];
  /** ready strings (empty: free play) */
  layout: Placed[];
  /** strings (default), or pads you touch: a piano keyboard / a drum kit (see pads.ts; no strings there) */
  kind?: "strings" | "piano" | "drums";
}

const SOLFA = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

/** a note from semitones relative to A4 */
export function noteOf(semi: number): Note {
  const midi = 69 + semi;
  const freq = 440 * Math.pow(2, semi / 12);
  // low = blue, high = warm
  const hue = Math.max(0, Math.min(220, 220 - ((midi - 40) / 45) * 220));
  return { name: SOLFA[((midi % 12) + 12) % 12], freq, hue };
}

const scaleOf = (root: number, steps: number[], octaves: number): Note[] => {
  const out: Note[] = [];
  for (let o = 0; o < octaves; o++) for (const s of steps) out.push(noteOf(root + o * 12 + s));
  out.push(noteOf(root + octaves * 12));
  return out;
};

// semitones from A4: E2 = -29, A2 = -24, D3 = -19, G3 = -14, B3 = -10, E4 = -5, C3 = -21, A3 = -12, D4 = -7
const MINOR_PENTA = [0, 3, 5, 7, 10];
const MAJOR_PENTA = [0, 2, 4, 7, 9];

/** parallel strings from (x0,y0)-(x1,y1) moved by (dx,dy) each */
function parallel(semis: number[], x0: number, y0: number, x1: number, y1: number, dx: number, dy: number): Placed[] {
  return semis.map((semi, i) => ({ ax: x0 + dx * i, ay: y0 + dy * i, bx: x1 + dx * i, by: y1 + dy * i, semi }));
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: "pianino",
    name: "Pianino",
    icon: "🎹",
    kind: "piano",
    voice: { t60Low: 4, t60High: 2, pick: 0.2, damp: 0.5, course: 0, toneLow: 2000, toneHigh: 9000, gain: 0.6 },
    scale: [],
    layout: [],
  },
  {
    id: "baraban",
    name: "Baraban",
    icon: "🥁",
    kind: "drums",
    voice: { t60Low: 1, t60High: 1, pick: 0.2, damp: 0.5, course: 0, toneLow: 4000, toneHigh: 16000, gain: 0.8 },
    scale: [],
    layout: [],
  },
  {
    id: "erkin",
    name: "Erkin",
    icon: "✨",
    voice: { t60Low: 4.2, t60High: 1.6, pick: 0.18, damp: 0.5, course: 0, toneLow: 1400, toneHigh: 8400, gain: 0.62, samples: GUITAR_REC },
    scale: scaleOf(-17, MINOR_PENTA, 2), // E3 ..
    layout: [],
  },
  {
    id: "gitara",
    name: "Gitara",
    icon: "🎸",
    voice: { t60Low: 4.5, t60High: 2, pick: 0.16, damp: 0.5, course: 0, toneLow: 1500, toneHigh: 8000, gain: 0.6, samples: GUITAR_REC },
    scale: scaleOf(-17, MINOR_PENTA, 2),
    // six strings across the screen, the thick E on top (as a guitar is seen by its player): a stroke down plays a chord
    layout: parallel([-29, -24, -19, -14, -10, -5], 0.14, 0.34, 0.84, 0.34, 0, 0.058),
  },
  {
    id: "dutor",
    name: "Dutor",
    icon: "🪕",
    // two silk strings, a fourth apart, long and warm, a little shimmer
    voice: { t60Low: 6, t60High: 3, pick: 0.22, damp: 0.5, course: 4, toneLow: 1100, toneHigh: 5200, gain: 0.66 },
    scale: scaleOf(-19, [0, 2, 3, 5, 7, 8, 10], 2), // D natural minor
    layout: [
      { ax: 0.1, ay: 0.58, bx: 0.88, by: 0.4, semi: -19 },
      { ax: 0.1, ay: 0.66, bx: 0.88, by: 0.48, semi: -14 },
    ],
  },
  {
    id: "rubob",
    name: "Rubob",
    icon: "🎵",
    // bright metal strings in pairs, short ring
    voice: { t60Low: 2.6, t60High: 1.2, pick: 0.09, damp: 0.3, course: 7, toneLow: 2600, toneHigh: 11000, gain: 0.5 },
    scale: scaleOf(-12, [0, 1, 4, 5, 7, 8, 10], 2), // A hijaz flavour
    layout: parallel([-12, -7, -5, 0, 2], 0.18, 0.5, 0.82, 0.3, 0, 0.06),
  },
  {
    id: "arfa",
    name: "Arfa",
    icon: "🎼",
    // a harp: ten upright strings, long + low on the left, short + high on the right: sweep a hand along them
    voice: { t60Low: 5.5, t60High: 2.4, pick: 0.45, damp: 0.5, course: 0, toneLow: 1200, toneHigh: 6000, gain: 0.7, samples: HARP_REC },
    scale: scaleOf(-21, MAJOR_PENTA, 2), // C3 ..
    layout: [-21, -19, -17, -14, -12, -9, -7, -5, -2, 0].map((semi, i) => {
      const x = 0.2 + i * 0.065;
      const top = 0.27 + i * 0.02;
      return { ax: x, ay: top, bx: x, by: 0.72, semi };
    }),
  },
];
