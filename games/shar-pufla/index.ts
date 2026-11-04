import { defineKidsGame, minScaleFor } from "../bogcha/common";
import { showBanner } from "../kids-b-util";
import { PUMPS, PumpCounter, balloonRadius } from "./logic";

const KIDS = 5;
const TAU = Math.PI * 2;
const COLORS = ["#ff5a5f", "#ffb02e", "#4fc464", "#39c5ff", "#b06cff", "#ff7ac8"] as const;

// "Shar puflash": squat down and stand up to pump the balloon over your head. After 5 pumps it flies away with confetti.
export default defineKidsGame({
  slug: "shar-pufla",
  roundSec: 75,
  music: "bouncy",
  create(kit) {
    const pump = Array.from({ length: KIDS }, () => new PumpCounter());
    const pumps = new Int8Array(KIDS);
    const wobble = new Float32Array(KIDS);
    const colour = new Int8Array(KIDS);
    for (let i = 0; i < KIDS; i++) colour[i] = i % COLORS.length;
    // balloons that flew away (one per slot at most)
    const flying = new Uint8Array(KIDS);
    const flx = new Float32Array(KIDS);
    const fly = new Float32Array(KIDS);
    const flr = new Float32Array(KIDS);
    const flv = new Float32Array(KIDS);
    const flc = new Int8Array(KIDS);

    const scaleOf = (s: number): number => Math.max(s, minScaleFor(kit.stage.h));
    const radius = (n: number): number => balloonRadius(pumps[n], scaleOf(kit.kids[n].scale), kit.stage.h);
    const balloonY = (n: number): number => kit.kids[n].pts.head.y - kit.kids[n].headR * 1.3 - radius(n) * 1.15;

    return {
      onStart: () => showBanner(kit, "O‘tiring va turing — sharni pufla!", "🎈"),
      update(dt) {
        for (let n = 0; n < KIDS; n++) {
          if (flying[n]) {
            flv[n] += kit.stage.h * 0.5 * dt;
            fly[n] -= flv[n] * dt;
            if (fly[n] < -flr[n] * 2) flying[n] = 0;
          }
          const k = kit.kids[n];
          wobble[n] = Math.max(0, wobble[n] - dt * 3);
          if (!k.active) {
            pumps[n] = 0;
            pump[n].reset();
            continue;
          }
          if (!k.present) continue;
          if (!pump[n].step(k.signals.squat, dt)) continue;
          pumps[n]++;
          wobble[n] = 1;
          kit.sfx.pop();
          if (pumps[n] < PUMPS) continue;
          // full: it flies away
          flying[n] = 1;
          flx[n] = k.pts.head.x;
          fly[n] = balloonY(n);
          flr[n] = radius(n);
          flv[n] = kit.stage.h * 0.1;
          flc[n] = colour[n];
          kit.engine.fx.burst(flx[n], fly[n], 28, () => COLORS[(Math.random() * COLORS.length) | 0], [120, 420], [3, 8], [0.6, 1.4], false, 260);
          kit.award(k, 1, flx[n], Math.max(kit.stage.h * 0.25, fly[n] - flr[n]));
          kit.sfx.yay();
          pumps[n] = 0;
          colour[n] = (colour[n] + 1) % COLORS.length;
        }
      },
      drawFront(ctx) {
        for (let n = 0; n < KIDS; n++) {
          if (flying[n]) drawBalloon(ctx, flx[n], fly[n], flr[n], COLORS[flc[n]], 0, true);
          const k = kit.kids[n];
          if (!k.active) continue;
          drawBalloon(ctx, k.pts.head.x, balloonY(n), radius(n) * (1 + wobble[n] * 0.15), COLORS[colour[n]], pumps[n], false);
        }
      },
    };
  },
});

function drawBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, pumps: number, free: boolean): void {
  ctx.strokeStyle = "rgba(255,255,255,.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 1.15);
  ctx.lineTo(x + (free ? Math.sin(y * 0.03) * r * 0.2 : 0), y + r * 2.2);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.88, r * 1.1, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.45)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.4, r * 0.18, r * 0.3, 0.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 1.1);
  ctx.lineTo(x - r * 0.15, y + r * 1.3);
  ctx.lineTo(x + r * 0.15, y + r * 1.3);
  ctx.fill();
  if (!free) {
    // pump pips under the balloon
    for (let i = 0; i < PUMPS; i++) {
      ctx.fillStyle = i < pumps ? "#ffd23d" : "rgba(255,255,255,.55)";
      ctx.beginPath();
      ctx.arc(x + (i - (PUMPS - 1) / 2) * r * 0.32, y + r * 1.5, Math.max(4, r * 0.1), 0, TAU);
      ctx.fill();
    }
  }
}
