// Emoji sprites: colour-emoji `fillText` is one of the slowest 2D canvas calls (the glyph is rasterised again on every call),
// so every emoji is rendered ONCE into a small offscreen canvas and then drawn with `drawImage`. Sizes are bucketed
// (multiples of 16 px) so a growing / shrinking emoji does not rebuild its sprite every frame. Without a real canvas
// (tests, a mocked context) it falls back to plain `fillText`.

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const MIN_PX = 32;
const MAX_PX = 384;

interface Sprite {
  c: HTMLCanvasElement;
  px: number;
}

const cache = new Map<string, Sprite[]>();

/** True when `ctx` draws on a real canvas element (a mocked context has none). */
function isReal(ctx: CanvasRenderingContext2D): boolean {
  return typeof HTMLCanvasElement !== "undefined" && ctx.canvas instanceof HTMLCanvasElement;
}

function sprite(emoji: string, size: number): HTMLCanvasElement | null {
  const px = Math.min(MAX_PX, Math.max(MIN_PX, Math.ceil(size / 16) * 16));
  let list = cache.get(emoji);
  if (!list) {
    list = [];
    cache.set(emoji, list);
  }
  for (let i = 0; i < list.length; i++) if (list[i].px === px) return list[i].c;
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  const x = c.getContext("2d");
  if (!x) return null;
  x.font = `${Math.round(px * 0.8)}px ${EMOJI_FONT}`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(emoji, px / 2, px / 2 + px * 0.04);
  list.push({ c, px });
  return c;
}

/** Draws `emoji` centred at (x, y), `size` px wide. Respects the current globalAlpha. */
export function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number): void {
  if (isReal(ctx)) {
    const s = sprite(emoji, size);
    if (s) {
      ctx.drawImage(s, x - size / 2, y - size / 2, size, size);
      return;
    }
  }
  ctx.font = `${Math.round(size * 0.8)}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(emoji, x, y + size * 0.04);
}

/** Forgets all sprites (tests). */
export function clearEmojiSprites(): void {
  cache.clear();
}
