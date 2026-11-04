import { defineKidsGame, drawEmoji, minScaleFor } from "../bogcha/common";
import { showBanner } from "../kids-b-util";
import { FlapDetector, altitudeY, climb } from "./logic";

const KIDS = 5;
const TAU = Math.PI * 2;

// "Kapalak": every child is a butterfly. Flap both arms up and down to fly up to the flower.
export default defineKidsGame({
  slug: "kapalak",
  roundSec: 75,
  music: "calm",
  create(kit) {
    const det = Array.from({ length: KIDS }, () => new FlapDetector());
    const alt = new Float32Array(KIDS).fill(0.1);
    const rest = new Float32Array(KIDS); // > 0 = sits on the flower, celebrating
    const flutter = new Float32Array(KIDS); // wing speed boost after a flap
    const bx = new Float32Array(KIDS);

    const scaleOf = (s: number): number => Math.max(s, minScaleFor(kit.stage.h));
    const groundY = (): number => kit.stage.h * 0.8;
    const flowerY = (): number => kit.stage.h * 0.27;

    return {
      onStart: () => showBanner(kit, "Qanot qoqing — kapalak gulga uchsin!", "🦋"),
      update(dt) {
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) {
            det[n].reset();
            alt[n] = 0.1;
            rest[n] = 0;
            continue;
          }
          if (bx[n] === 0 || k.joined) bx[n] = k.pts.head.x;
          else bx[n] += (k.pts.head.x - bx[n]) * Math.min(1, dt * 6);
          flutter[n] = Math.max(0, flutter[n] - dt);
          if (rest[n] > 0) {
            rest[n] -= dt;
            if (rest[n] <= 0) alt[n] = 0.1;
            continue;
          }
          let flaps = 0;
          if (k.present) {
            const lw = k.pts.lw;
            const rw = k.pts.rw;
            const lv = lw.v > 0.15;
            const rv = rw.v > 0.15;
            if (lv || rv) {
              const wy = lv && rv ? (lw.y + rw.y) / 2 : lv ? lw.y : rw.y;
              flaps = det[n].step(wy, (k.pts.ls.y + k.pts.rs.y) / 2, scaleOf(k.scale));
            }
          }
          if (flaps) flutter[n] = 0.5;
          alt[n] = climb(alt[n], flaps, dt);
          if (alt[n] >= 1) {
            rest[n] = 2;
            kit.award(k, 1, k.pts.head.x, flowerY() - kit.stage.h * 0.06);
            kit.sfx.yay();
            kit.engine.fx.burst(k.pts.head.x, flowerY(), 14, "#ff8fd0", [80, 260], [3, 7], [0.5, 1], false, 80);
          }
        }
      },
      drawBack(ctx, now) {
        const h = kit.stage.h;
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) continue;
          const s = scaleOf(k.scale);
          ctx.strokeStyle = "#3fa84a";
          ctx.lineWidth = Math.max(4, s * 0.12);
          ctx.beginPath();
          ctx.moveTo(bx[n], h);
          ctx.lineTo(bx[n], flowerY() + s * 0.4);
          ctx.stroke();
          const sway = rest[n] > 0 ? Math.sin(now * 0.01) * s * 0.1 : 0;
          drawEmoji(ctx, "🌸", bx[n] + sway, flowerY(), s * 1.5);
        }
      },
      drawFront(ctx, now) {
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) continue;
          const s = scaleOf(k.scale);
          const y = rest[n] > 0 ? flowerY() + s * 0.1 : altitudeY(alt[n], groundY(), flowerY());
          const wing = 0.35 + 0.65 * Math.abs(Math.sin(now * (flutter[n] > 0 || rest[n] > 0 ? 0.022 : 0.004)));
          drawButterfly(ctx, bx[n], y, s * 0.8, wing, k.color);
        }
      },
    };
  },
});

function drawButterfly(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, open: number, col: string): void {
  const w = r * open;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x - w * 0.9, y - r * 0.35, w, r * 0.75, -0.4, 0, TAU);
  ctx.ellipse(x + w * 0.9, y - r * 0.35, w, r * 0.75, 0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffd23d";
  ctx.beginPath();
  ctx.ellipse(x - w * 0.6, y + r * 0.4, w * 0.6, r * 0.5, 0.4, 0, TAU);
  ctx.ellipse(x + w * 0.6, y + r * 0.4, w * 0.6, r * 0.5, -0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#3a2a6b";
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.14, r * 0.6, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#3a2a6b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.5);
  ctx.lineTo(x - r * 0.3, y - r * 0.9);
  ctx.moveTo(x, y - r * 0.5);
  ctx.lineTo(x + r * 0.3, y - r * 0.9);
  ctx.stroke();
}
