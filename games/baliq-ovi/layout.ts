import { bottomLift } from "@/engine/ui/safe";
import { SPECIES } from "./species";

/** phone held upright: the camera picture (18vw wide, 9:19.5) sits at the top right below the HUD; everything stays under it */
export function belowPip(w: number): number {
  return Math.round(w * 0.18 * (19.5 / 9)) + 78;
}

// ---------------------------------------------------------------- screen layouts (shared with the overlay)

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function lobbyRects(w: number, h: number): [Rect, Rect] {
  if (h > w) {
    // portrait: the two cards one above the other
    const top = belowPip(w) + 36;
    const gap = 10;
    const ch = Math.max(120, (h - bottomLift(w, h) - 10 - top - gap) / 2);
    return [
      { x: 12, y: top, w: w - 24, h: ch },
      { x: 12, y: top + ch + gap, w: w - 24, h: ch },
    ];
  }
  const cw = Math.min(w * 0.4, 520);
  const ch = Math.min(h * 0.42, 320);
  const gap = Math.min(w * 0.04, 50);
  const y = h * 0.38;
  return [
    { x: w / 2 - gap / 2 - cw, y, w: cw, h: ch },
    { x: w / 2 + gap / 2, y, w: cw, h: ch },
  ];
}

/** Encyclopedia screen: the grid on the left (clear of the player HUD), the info card below the camera picture on the right. */
export function collectionRects(w: number, h: number): { cards: Rect[]; info: Rect; button: Rect } {
  if (h > w) {
    // portrait: the grid across the width (below the camera picture), the info card and the button under it
    const pad = 10;
    const cols = 4;
    const rows = Math.ceil(SPECIES.length / cols);
    const top = belowPip(w) + 28;
    const cw = (w - 2 * pad - (cols - 1) * 8) / cols;
    const btnH = 48;
    const infoH = 124;
    const room = h - bottomLift(w, h) - 10 - top - infoH - btnH - 16;
    const ch = Math.max(40, Math.min(cw * 1.1, room / rows - 8));
    const cards: Rect[] = SPECIES.map((_, i) => ({ x: pad + (i % cols) * (cw + 8), y: top + Math.floor(i / cols) * (ch + 8), w: cw, h: ch }));
    const iy = top + rows * (ch + 8) + 4;
    return { cards, info: { x: pad, y: iy, w: w - 2 * pad, h: infoH }, button: { x: w / 2 - 110, y: iy + infoH + 8, w: 220, h: btnH } };
  }
  const cols = 5;
  const x0 = Math.min(190, w * 0.17);
  const top = h * 0.2;
  const infoW = Math.min(340, w * 0.3);
  const gridW = Math.max(300, w - x0 - infoW - 50);
  const cw = (gridW - (cols - 1) * 8) / cols;
  const ch = Math.min(cw * 1.1, (h * 0.58) / 3 - 8);
  const cards: Rect[] = SPECIES.map((_, i) => ({ x: x0 + (i % cols) * (cw + 8), y: top + Math.floor(i / cols) * (ch + 8), w: cw, h: ch }));
  const info = { x: w - infoW - 24, y: h * 0.42, w: infoW, h: h * 0.4 };
  const button = { x: w / 2 - 130, y: h - 86, w: 260, h: 58 };
  return { cards, info, button };
}

/**
 * Pre-start options (one player): the two play modes side by side ("Ovozsiz" selected, "Ovoz bilan" not yet available), the
 * voice switch panel (used only while the voice mode is on: it takes the place of the two cards) and the start button.
 */
export function optionRects(w: number, h: number): { voice: Rect; modes: [Rect, Rect]; start: Rect; panel: Rect } {
  if (h > w) {
    // portrait: a panel under the camera picture, the two mode cards stacked above the start button
    const px = 12;
    const pw = w - 24;
    const py = belowPip(w);
    const ph = h - bottomLift(w, h) - 10 - py;
    const start = { x: px + 24, y: py + ph - 66, w: pw - 48, h: 52 };
    const m1 = { x: px + 16, y: start.y - 10 - 84, w: pw - 32, h: 84 };
    const m0 = { x: px + 16, y: m1.y - 8 - 84, w: pw - 32, h: 84 };
    return { voice: { x: m0.x, y: m0.y, w: m0.w, h: 176 }, modes: [m0, m1], start, panel: { x: px, y: py, w: pw, h: ph } };
  }
  const pw = Math.min(w * 0.62, 760);
  const px = w / 2 - pw / 2;
  const panel = { x: px, y: h * 0.08, w: pw, h: h * 0.84 };
  const voice = { x: px + 24, y: h * 0.42, w: pw - 48, h: Math.min(h * 0.2, 130) };
  const gap = 16;
  const mw = (voice.w - gap) / 2;
  const modes: [Rect, Rect] = [
    { x: voice.x, y: voice.y, w: mw, h: voice.h },
    { x: voice.x + mw + gap, y: voice.y, w: mw, h: voice.h },
  ];
  const start = { x: w / 2 - 150, y: h * 0.78, w: 300, h: Math.min(h * 0.11, 70) };
  return { voice, modes, start, panel };
}
