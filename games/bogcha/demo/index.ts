// Minimal Bog‘cha example game ("Yulduz tutish"): stars fall, children catch them with their paws (wrists).
// Hidden from the site lists (lib/games.ts: hidden) — it is the reference for games/bogcha/README.md and the e2e test.
import { defineKidsGame } from "../common";

const N = 7;

export default defineKidsGame({
  slug: "bogcha-demo",
  roundSec: 60,
  music: "march",
  create(kit) {
    const x = new Float32Array(N);
    const y = new Float32Array(N);
    const v = new Float32Array(N);
    const respawn = (i: number): void => {
      x[i] = 0.08 * kit.stage.w + Math.random() * 0.84 * kit.stage.w;
      y[i] = -Math.random() * kit.stage.h * 0.6;
      v[i] = kit.stage.h * (0.12 + Math.random() * 0.1);
    };
    for (let i = 0; i < N; i++) respawn(i);
    let nextPrompt = 0;
    return {
      onStart() {
        kit.voice.say("handsUp");
        nextPrompt = 15;
      },
      update(dt) {
        const r = Math.max(34, kit.stage.h * 0.07);
        if (kit.roundSec - kit.timeLeft > nextPrompt) {
          kit.voice.say("handsUp");
          nextPrompt += 15;
        }
        for (let i = 0; i < N; i++) {
          y[i] += v[i] * dt;
          if (y[i] > kit.stage.h + r) {
            respawn(i);
            continue;
          }
          for (const k of kit.kids) {
            if (!k.active || !k.present) continue;
            const l = k.pts.lw;
            const rr = k.pts.rw;
            const hit = (l.v > 0.25 && Math.hypot(l.x - x[i], l.y - y[i]) < r * 1.4) || (rr.v > 0.25 && Math.hypot(rr.x - x[i], rr.y - y[i]) < r * 1.4);
            if (hit) {
              kit.award(k, 1, x[i], y[i]);
              respawn(i);
              break;
            }
          }
        }
      },
      drawFront(ctx) {
        const r = Math.max(34, kit.stage.h * 0.07);
        ctx.fillStyle = "#ffd23d";
        ctx.font = `${Math.round(r * 1.6)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < N; i++) ctx.fillText("⭐", x[i], y[i]);
      },
    };
  },
});
