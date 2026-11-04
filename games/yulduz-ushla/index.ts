import { defineKidsGame, drawEmoji, minScaleFor } from "../bogcha/common";
import { MAX_STARS, catchHit, catchRadius, fallSpeed, isBonus, starCap } from "./logic";

// "Yulduz ushla": stars fall from the sky, every child catches them with either hand (wrist points).
// Golden stars give 2 stars. Every 10th star caught by the group is a bonus for everybody.
export default defineKidsGame({
  slug: "yulduz-ushla",
  roundSec: 60,
  music: "bouncy",
  dim: 0.5,
  create(kit) {
    const x = new Float32Array(MAX_STARS);
    const y = new Float32Array(MAX_STARS);
    const v = new Float32Array(MAX_STARS);
    const gold = new Uint8Array(MAX_STARS);
    const on = new Uint8Array(MAX_STARS);
    let caught = 0;
    let spawnIn = 0;

    const size = (): number => Math.max(56, kit.stage.h * 0.09);

    const spawn = (i: number): void => {
      const { w, h } = kit.stage;
      // most stars fall near a child who is there, so somebody can reach them
      let px = w * (0.08 + Math.random() * 0.84);
      if (Math.random() < 0.65) {
        let n = 0;
        for (const k of kit.kids) if (k.active && k.present) n++;
        if (n > 0) {
          let pick = Math.floor(Math.random() * n);
          for (const k of kit.kids) {
            if (!k.active || !k.present) continue;
            if (pick-- === 0) px = Math.min(w * 0.95, Math.max(w * 0.05, k.center.x + (Math.random() - 0.5) * k.scale * 4));
          }
        }
      }
      x[i] = px;
      y[i] = -size();
      gold[i] = Math.random() < 0.15 ? 1 : 0;
      v[i] = fallSpeed(h, gold[i] === 1, Math.random());
      on[i] = 1;
    };

    return {
      onStart: () => kit.voice.say("handsUp"),
      update(dt) {
        const { h } = kit.stage;
        let kids = 0;
        for (const k of kit.kids) if (k.active && k.present) kids++;
        const cap = starCap(kids);
        let live = 0;
        for (let i = 0; i < MAX_STARS; i++) {
          if (!on[i]) continue;
          live++;
          y[i] += v[i] * dt;
          if (y[i] > h + size()) {
            on[i] = 0;
            continue;
          }
          const r = size() * 0.5;
          for (const k of kit.kids) {
            if (!k.active || !k.present) continue;
            const rad = catchRadius(k.scale, minScaleFor(h), r);
            const a = k.pts.lw;
            const b = k.pts.rw;
            if ((a.v > 0.2 && catchHit(a.x, a.y, x[i], y[i], rad)) || (b.v > 0.2 && catchHit(b.x, b.y, x[i], y[i], rad))) {
              const g = gold[i] === 1;
              kit.award(k, g ? 2 : 1, x[i], y[i]);
              kit.engine.fx.burst(x[i], y[i], g ? 16 : 9, g ? "#ffd23d" : "#fff3a0");
              on[i] = 0;
              live--;
              caught++;
              if (isBonus(caught)) {
                kit.award(null, 1, kit.stage.w / 2, h * 0.3);
                kit.voice.say("bravo");
              }
              break;
            }
          }
        }
        spawnIn -= dt;
        if (live < cap && spawnIn <= 0) {
          for (let i = 0; i < MAX_STARS; i++) {
            if (!on[i]) {
              spawn(i);
              break;
            }
          }
          spawnIn = 0.35 + Math.random() * 0.4;
        }
      },
      drawFront(ctx, now) {
        const s = size();
        for (let i = 0; i < MAX_STARS; i++) {
          if (!on[i]) continue;
          const wob = Math.sin(now / 250 + i) * 6;
          drawEmoji(ctx, gold[i] ? "🌟" : "⭐", x[i] + wob, y[i], gold[i] ? s * 1.25 : s);
        }
      },
    };
  },
});
