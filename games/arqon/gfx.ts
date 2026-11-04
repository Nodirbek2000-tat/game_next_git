// Cached canvas art for the 2D overlay: text sprites, soft shadows, vignettes. Everything is drawn once into small offscreen
// canvases; per frame the games only call drawImage (no gradients, no shadowBlur, no font changes).

export interface Spr {
  cv: HTMLCanvasElement;
  /** size in CSS px */
  w: number;
  h: number;
}

const FONT = "-apple-system,BlinkMacSystemFont,Inter,'Segoe UI',sans-serif";
/** sprites are baked at 2x so they stay sharp on phones */
const K = 2;

function canvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(w));
  cv.height = Math.max(1, Math.ceil(h));
  return cv;
}

/** Bold outlined text. */
export function textSpr(text: string, px: number, fill = "#fff", weight = 800): Spr {
  const m = canvas(8, 8).getContext("2d");
  let tw = text.length * px * 0.6;
  if (m) {
    m.font = `${weight} ${px * K}px ${FONT}`;
    tw = m.measureText(text).width / K;
  }
  const pad = Math.ceil(px * 0.3);
  const w = Math.ceil(tw + pad * 2);
  const h = Math.ceil(px * 1.3 + pad);
  const cv = canvas(w * K, h * K);
  const c = cv.getContext("2d");
  if (c) {
    c.scale(K, K);
    c.font = `${weight} ${px}px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.lineWidth = px * 0.2;
    c.strokeStyle = "rgba(0,0,0,.62)";
    c.strokeText(text, w / 2, h / 2);
    c.fillStyle = fill;
    c.fillText(text, w / 2, h / 2);
  }
  return { cv, w, h };
}

/** Soft elliptical shadow / glow (radial gradient squashed to w x h). */
export function softSpot(w: number, h: number, rgb: string, peak = 0.55): Spr {
  const cv = canvas(w, h);
  const c = cv.getContext("2d");
  if (c) {
    c.translate(cv.width / 2, cv.height / 2);
    c.scale(1, cv.height / cv.width);
    const r = cv.width / 2;
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${rgb},${peak})`);
    g.addColorStop(0.55, `rgba(${rgb},${peak * 0.45})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(-r, -r, r * 2, r * 2);
  }
  return { cv, w, h };
}

/** Screen edge tint (transparent in the middle). Built small, drawn stretched over the stage. */
export function vignette(w: number, h: number, rgb: string): Spr {
  const sw = Math.max(16, Math.round(w / 6));
  const sh = Math.max(16, Math.round(h / 6));
  const cv = canvas(sw, sh);
  const c = cv.getContext("2d");
  if (c) {
    const g = c.createRadialGradient(sw / 2, sh / 2, Math.min(sw, sh) * 0.25, sw / 2, sh / 2, Math.hypot(sw, sh) * 0.55);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(1, `rgba(${rgb},0.85)`);
    c.fillStyle = g;
    c.fillRect(0, 0, sw, sh);
  }
  return { cv, w, h };
}

/** Draw a sprite centred at (x, y), scaled by `sc`. */
export function put(c: CanvasRenderingContext2D, s: Spr, x: number, y: number, sc = 1, alpha = 1): void {
  if (alpha <= 0.01) return;
  c.globalAlpha = alpha > 1 ? 1 : alpha;
  c.drawImage(s.cv, x - (s.w * sc) / 2, y - (s.h * sc) / 2, s.w * sc, s.h * sc);
  c.globalAlpha = 1;
}
