// Draws the pooled sparkles as little 4-point crosses (two fillRects each, no paths, no gradients). Shared by havoda-rasm and sanaymiz.

import { MAX_SPARKS, type Sparks } from "./logic";

export function drawSparks(ctx: CanvasRenderingContext2D, sp: Sparks, palette: readonly string[], now: number): void {
  if (sp.count === 0) return;
  let last = -1;
  for (let i = 0; i < MAX_SPARKS; i++) {
    const life = sp.life[i];
    if (life <= 0) continue;
    const c = sp.col[i];
    if (c !== last) {
      ctx.fillStyle = palette[c];
      last = c;
    }
    // twinkle: the size pulses a little with time
    const s = sp.size[i] * (0.55 + 0.45 * life) * (0.85 + 0.15 * Math.sin(now * 0.02 + i));
    ctx.globalAlpha = life < 0.4 ? life * 2.5 : 1;
    ctx.fillRect(sp.x[i] - s, sp.y[i] - s * 0.3, s * 2, s * 0.6);
    ctx.fillRect(sp.x[i] - s * 0.3, sp.y[i] - s, s * 0.6, s * 2);
  }
  ctx.globalAlpha = 1;
}
