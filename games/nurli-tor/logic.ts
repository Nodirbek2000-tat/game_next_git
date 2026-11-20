// Nurli tor: pure logic (no engine, no audio) — pinch detection, the string length -> note, the melody guide. Easy to test.
//
// The string: thumb and index tip pinched together on BOTH hands; the string runs between the two pinch points. Like a real
// string, a SHORT string sounds HIGH and a LONG one LOW. The length is measured in hand sizes, so it plays the same near the camera
// and further away.

export interface Pt {
  x: number;
  y: number;
}

/** thumb–index distance / hand size: below CLOSE = pinched, above OPEN = released (hysteresis, no flicker) */
export const PINCH_CLOSE = 0.36;
export const PINCH_OPEN = 0.55;

export class Pinch {
  on = false;
  /** the pinch point, smoothed (stage px) */
  readonly at: Pt = { x: 0, y: 0 };
  private has = false;

  /** `d` = pinchD of the hand (null = hand not seen), `p` = midpoint of thumb and index tip */
  update(d: number | null, p: Pt | null, dt: number): boolean {
    if (d === null || p === null) {
      this.on = false;
      this.has = false;
      return false;
    }
    this.on = this.on ? d < PINCH_OPEN : d < PINCH_CLOSE;
    // fast but not jittery: ~35 ms time constant
    const k = this.has ? 1 - Math.exp(-dt / 0.035) : 1;
    this.at.x += (p.x - this.at.x) * k;
    this.at.y += (p.y - this.at.y) * k;
    this.has = true;
    return this.on;
  }
}

export interface Note {
  /** Uzbek solfège name shown on screen */
  name: string;
  freq: number;
  /** hue for the light (0..360) */
  hue: number;
}

const NAMES = ["Do", "Re", "Mi", "Sol", "La"];
// major pentatonic from C4 over two octaves + the top C: every combination sounds good
const SEMIS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
export const NOTES: Note[] = SEMIS.map((s, i) => ({
  name: NAMES[i % 5],
  freq: 261.63 * Math.pow(2, s / 12),
  hue: 200 - (i / (SEMIS.length - 1)) * 200,
}));

/** string length (in hand sizes) of the lowest and the highest note */
export const LEN_LOW = 10;
export const LEN_HIGH = 1.6;

/** continuous position on the note ladder: 0 = lowest note (long string) .. NOTES.length-1 = highest (short) */
export function ladderPos(lenInHands: number): number {
  const t = (LEN_LOW - lenInHands) / (LEN_LOW - LEN_HIGH);
  return Math.max(0, Math.min(1, t)) * (NOTES.length - 1);
}

/** The current note with hysteresis: it changes only when the position is clearly inside the next note's band. */
export class NotePicker {
  index = -1;
  pick(pos: number): number {
    const nearest = Math.round(pos);
    if (this.index < 0 || Math.abs(pos - this.index) > 0.68) this.index = nearest;
    return this.index;
  }
  reset(): void {
    this.index = -1;
  }
}

/** "Yulduzcha" (Twinkle, twinkle — a folk tune) on the ladder indexes: Do Do Sol Sol La La Sol … */
export const MELODY = [0, 0, 3, 3, 4, 4, 3, 2, 2, 1, 1, 0];

/** The melody guide: the next note to play; held for HOLD seconds = hit. */
export class Guide {
  step = 0;
  hits = 0;
  private held = 0;
  static readonly HOLD = 0.22;

  get target(): number {
    return MELODY[this.step % MELODY.length];
  }

  /** `note` = the note playing now (-1 = none). Returns true on the frame the target is hit. */
  update(note: number, dt: number): boolean {
    // the guide uses the first octave; the same name an octave up counts too
    if (note >= 0 && note % 5 === this.target % 5) {
      this.held += dt;
      if (this.held >= Guide.HOLD) {
        this.held = 0;
        this.hits++;
        this.step++;
        return true;
      }
    } else this.held = Math.max(0, this.held - dt * 2);
    return false;
  }
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
