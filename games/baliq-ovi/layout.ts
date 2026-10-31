import { SPECIES } from "./species";

// ---------------------------------------------------------------- screen layouts (shared with the overlay)

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function lobbyRects(w: number, h: number): [Rect, Rect] {
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
