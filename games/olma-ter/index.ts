import { defineKidsGame, drawEmoji, minScaleFor } from "../bogcha/common";
import { showBanner } from "../kids-b-util";
import { APPLES, applePlace, basketStar, pickHit } from "./logic";

const KIDS = 5;
const FALLS = 12;
const REGROW = 3.5;

// "Olma ter": every child stands under an apple tree. A hand reaching up to an apple picks it, it drops into the basket.
export default defineKidsGame({
  slug: "olma-ter",
  roundSec: 75,
  music: "bouncy",
  create(kit) {
    const regrow = new Float32Array(KIDS * APPLES); // > 0 = apple is missing, seconds until it grows back
    const basket = new Int16Array(KIDS);
    const fx = new Float32Array(FALLS);
    const fy = new Float32Array(FALLS);
    const fv = new Float32Array(FALLS);
    const fs = new Int8Array(FALLS).fill(-1); // slot of a falling apple, -1 = free
    const pos = { x: 0, y: 0 };
    let total = 0;

    const scaleOf = (s: number): number => Math.max(s, minScaleFor(kit.stage.h));
    const basketY = (): number => kit.stage.h * 0.9;

    return {
      onStart: () => showBanner(kit, "Yuqoriga cho‘zilib, olmani termang!", "🍎"),
      update(dt) {
        const h = kit.stage.h;
        const minY = h * 0.24;
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) {
            for (let i = 0; i < APPLES; i++) regrow[n * APPLES + i] = 0;
            continue;
          }
          const s = scaleOf(k.scale);
          for (let i = 0; i < APPLES; i++) {
            const c = n * APPLES + i;
            if (regrow[c] > 0) {
              regrow[c] = Math.max(0, regrow[c] - dt);
              continue;
            }
            if (!k.present) continue;
            applePlace(k.pts.head.x, k.pts.head.y, s, i, minY, pos);
            const r = Math.max(s * 0.75, h * 0.06);
            const sg = k.signals;
            const hit = pickHit(k.pts.lw.x, k.pts.lw.y, k.pts.lw.v, sg.handUp.L, pos.x, pos.y, r) || pickHit(k.pts.rw.x, k.pts.rw.y, k.pts.rw.v, sg.handUp.R, pos.x, pos.y, r);
            if (!hit) continue;
            for (let f = 0; f < FALLS; f++) {
              if (fs[f] >= 0) continue;
              fs[f] = n;
              fx[f] = pos.x;
              fy[f] = pos.y;
              fv[f] = 0;
              regrow[c] = REGROW;
              kit.sfx.pop();
              break;
            }
          }
        }
        for (let f = 0; f < FALLS; f++) {
          const n = fs[f];
          if (n < 0) continue;
          const k = kit.kids[n];
          fv[f] += h * 1.6 * dt;
          fy[f] += fv[f] * dt;
          if (k.active) fx[f] += (k.pts.head.x - fx[f]) * Math.min(1, dt * 4);
          if (fy[f] < basketY()) continue;
          fs[f] = -1;
          basket[n]++;
          total++;
          kit.sfx.drum();
          if (basketStar(basket[n])) kit.award(k, 1, fx[f], basketY() - h * 0.12);
          if (total % 6 === 0) kit.award(null, 1);
        }
      },
      drawBack(ctx) {
        const h = kit.stage.h;
        const minY = h * 0.24;
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) continue;
          const s = scaleOf(k.scale);
          const cx = k.pts.head.x;
          applePlace(cx, k.pts.head.y, s, 1, minY, pos);
          // trunk and crown
          ctx.fillStyle = "#8a5a2b";
          ctx.fillRect(cx - s * 0.35, pos.y, s * 0.7, h - pos.y);
          ctx.fillStyle = "#3fa84a";
          ctx.beginPath();
          ctx.ellipse(cx, pos.y + s * 0.2, s * 2.3, s * 1.1, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#58c25f";
          ctx.beginPath();
          ctx.ellipse(cx - s * 0.5, pos.y - s * 0.15, s * 1.4, s * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      drawFront(ctx) {
        const h = kit.stage.h;
        const minY = h * 0.24;
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) continue;
          const s = scaleOf(k.scale);
          for (let i = 0; i < APPLES; i++) {
            if (regrow[n * APPLES + i] > 0) continue;
            applePlace(k.pts.head.x, k.pts.head.y, s, i, minY, pos);
            drawApple(ctx, pos.x, pos.y, s * 0.3);
          }
          drawEmoji(ctx, "🧺", k.pts.head.x, basketY(), s * 1.5);
          for (let i = 0; i < Math.min(6, basket[n]); i++) drawApple(ctx, k.pts.head.x + (i - 2.5) * s * 0.2, basketY() - s * 0.25, s * 0.14);
        }
        for (let f = 0; f < FALLS; f++) if (fs[f] >= 0) drawApple(ctx, fx[f], fy[f], Math.max(14, h * 0.025));
      },
    };
  },
});

function drawApple(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = "#e5322d";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.5)";
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2f7d32";
  ctx.fillRect(x - r * 0.08, y - r * 1.25, r * 0.16, r * 0.4);
}
