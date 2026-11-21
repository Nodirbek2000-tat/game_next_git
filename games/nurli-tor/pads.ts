// Nurli tor: the instruments you play by touching, not by plucking — a piano keyboard and a drum kit in the air. Pure logic (no
// engine, no audio): the pads, their layout on the screen, and which fingertip came into which pad (a hit) this frame.

import { dist, TIPS, type Hand, type Pt } from "./logic";

export type DrumKind = "kick" | "snare" | "hat" | "crash" | "tomHi" | "tomLo";

export interface Pad {
  id: number;
  shape: "rect" | "circle";
  /** rect: top-left corner and size; circle: centre and radius (w = h = 2r) */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  hue: number;
  /** a piano key (semitones from A4) or a drum */
  semi?: number;
  drum?: DrumKind;
  /** a black key: drawn over the white ones and hit first */
  black?: boolean;
  /** 1 on a hit, fades (drawing) */
  lit: number;
}

export interface PadHit {
  pad: Pad;
  vel: number;
  at: Pt;
}

const WHITE = [
  { semi: -9, label: "Do" },
  { semi: -7, label: "Re" },
  { semi: -5, label: "Mi" },
  { semi: -4, label: "Fa" },
  { semi: -2, label: "Sol" },
  { semi: 0, label: "La" },
  { semi: 2, label: "Si" },
  { semi: 3, label: "Do" },
  { semi: 5, label: "Re" },
  { semi: 7, label: "Mi" },
];
/** black keys: after which white key (index) and the note */
const BLACK = [
  { after: 0, semi: -8 },
  { after: 1, semi: -6 },
  { after: 3, semi: -3 },
  { after: 4, semi: -1 },
  { after: 5, semi: 1 },
  { after: 7, semi: 4 },
  { after: 8, semi: 6 },
];

/**
 * A keyboard across the middle of the screen: ten white keys (C4 .. E5) and seven black ones; on an upright (narrow) screen eight
 * wider white keys (C4 .. C5) and five black ones, so a fingertip still fits a key.
 */
export function pianoPads(W: number, H: number): Pad[] {
  const narrow = W < H * 1.1;
  const whites = narrow ? WHITE.slice(0, 8) : WHITE;
  const left = W * (narrow ? 0.05 : 0.1);
  const width = W * (narrow ? 0.9 : 0.8);
  const top = H * 0.42;
  const height = Math.min(H * 0.36, width * (narrow ? 0.55 : 0.42));
  const kw = width / whites.length;
  const pads: Pad[] = [];
  let id = 1;
  whites.forEach((k, i) => pads.push({ id: id++, shape: "rect", x: left + i * kw, y: top, w: kw, h: height, label: k.label, hue: 200 - i * 14, semi: k.semi, lit: 0 }));
  for (const b of BLACK.filter((x) => x.after < whites.length - 1)) {
    const bw = kw * 0.6;
    pads.push({ id: id++, shape: "rect", x: left + (b.after + 1) * kw - bw / 2, y: top, w: bw, h: height * 0.6, label: "", hue: 280, semi: b.semi, black: true, lit: 0 });
  }
  return pads;
}

/** a drum kit: cymbals up, drums in the middle, the big drum low */
export function drumPads(W: number, H: number): Pad[] {
  const r = Math.min(W, H) * 0.11;
  const spots: { x: number; y: number; k: number; drum: DrumKind; label: string; hue: number }[] = [
    { x: 0.2, y: 0.38, k: 1, drum: "hat", label: "Tarelka", hue: 50 },
    { x: 0.8, y: 0.36, k: 1.1, drum: "crash", label: "Krash", hue: 40 },
    { x: 0.38, y: 0.44, k: 0.95, drum: "tomHi", label: "Tom", hue: 190 },
    { x: 0.62, y: 0.44, k: 1.05, drum: "tomLo", label: "Katta tom", hue: 210 },
    { x: 0.27, y: 0.68, k: 1.1, drum: "snare", label: "Baraban", hue: 330 },
    { x: 0.63, y: 0.76, k: 1.2, drum: "kick", label: "Bochka", hue: 10 },
  ];
  return spots.map((s, i) => {
    const rr = r * s.k;
    return { id: i + 1, shape: "circle", x: s.x * W, y: s.y * H, w: rr * 2, h: rr * 2, label: s.label, hue: s.hue, drum: s.drum, lit: 0 };
  });
}

/** is `p` inside the pad (grown by `grow` px)? */
export function inPad(pad: Pad, p: Pt, grow = 0): boolean {
  if (pad.shape === "circle") return dist(p, pad) < pad.w / 2 + grow;
  return p.x >= pad.x - grow && p.x <= pad.x + pad.w + grow && p.y >= pad.y - grow && p.y <= pad.y + pad.h + grow;
}

/** a pad plays again only after this long (ms): several fingers coming in together are one hit */
const PAD_GAP = 80;

export class PadBoard {
  pads: Pad[] = [];
  /** fingertip inside a pad (hand:tip -> pad id): a hit only when it comes in, not while it stays */
  private inside = new Map<string, number>();
  private last = new Map<number, number>();
  private lastNow = 0;
  hits = 0;

  set(pads: Pad[]): void {
    this.pads = pads;
    this.inside.clear();
    this.last.clear();
  }

  /** the pad under `p` (black keys first) */
  padAt(p: Pt, grow = 0): Pad | null {
    for (const pad of this.pads) if (pad.black && inPad(pad, p, grow)) return pad;
    for (const pad of this.pads) if (!pad.black && inPad(pad, p, grow)) return pad;
    return null;
  }

  update(hands: readonly Hand[], now: number): PadHit[] {
    const out: PadHit[] = [];
    const dt = this.lastNow ? Math.max(0.004, Math.min(0.1, (now - this.lastNow) / 1000)) : 1 / 60;
    this.lastNow = now;
    if (this.inside.size > 2000) this.inside.clear();
    for (const h of hands) {
      for (let i = 0; i < TIPS.length; i++) {
        const key = `${h.id}:${i}`;
        const p = h.pts[TIPS[i]];
        const was = this.inside.get(key);
        // stays in its pad until it is clearly out (a little margin: a shaking finger does not hit twice)
        if (was !== undefined) {
          const pad = this.pads.find((q) => q.id === was);
          if (pad && inPad(pad, p, 8)) continue;
          this.inside.delete(key);
        }
        const pad = this.padAt(p);
        if (!pad) continue;
        this.inside.set(key, pad.id);
        if (now - (this.last.get(pad.id) ?? -1e9) < PAD_GAP) continue;
        this.last.set(pad.id, now);
        const speed = dist(h.prevTips[i], p) / dt;
        const vel = Math.max(0.35, Math.min(1, speed / Math.max(60, h.size * 8)));
        pad.lit = 1;
        this.hits++;
        out.push({ pad, vel, at: { x: p.x, y: p.y } });
      }
    }
    return out;
  }
}
