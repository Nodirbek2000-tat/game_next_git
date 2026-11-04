import { defineKidsGame, minScaleFor } from "../bogcha/common";
import { CLOUDS, MAX_FLY, cloudSpot, smooth, windGain, wristSpeed } from "./logic";

// "Shamol": three clouds hang over every child. Waving the arms fast (wrist speed, plus signals.wave) charges the wind;
// at full charge one cloud is blown away (fun puffs, a star). Blown clouds grow back after a moment.
export default defineKidsGame({
  slug: "shamol",
  roundSec: 60,
  music: "calm",
  dim: 0.55,
  create(kit) {
    const speed = new Float32Array(5);
    const charge = new Float32Array(5);
    const prev = new Float32Array(20); // lx ly rx ry per slot
    const has = new Uint8Array(5);
    const regrow = new Float32Array(5 * CLOUDS);
    const fx = new Float32Array(MAX_FLY);
    const fy = new Float32Array(MAX_FLY);
    const fvx = new Float32Array(MAX_FLY);
    const fvy = new Float32Array(MAX_FLY);
    const fl = new Float32Array(MAX_FLY); // life left, 0 = unused
    const spot = { x: 0, y: 0 };
    let flyN = 0;

    const cloudR = (scale: number): number => Math.max(scale, minScaleFor(kit.stage.h)) * 1.0;

    const cloud = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
      ctx.beginPath();
      ctx.arc(x - r * 0.9, y + r * 0.15, r * 0.6, 0, Math.PI * 2);
      ctx.moveTo(x + r * 0.3, y + r * 0.15);
      ctx.arc(x + r * 0.9, y + r * 0.15, r * 0.6, 0, Math.PI * 2);
      ctx.moveTo(x + r * 0.55, y - r * 0.2);
      ctx.arc(x, y - r * 0.2, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
    };

    const blow = (slot: number, i: number, x: number, y: number, dirX: number): void => {
      regrow[slot * CLOUDS + i] = 1.8;
      const f = flyN++ % MAX_FLY;
      fx[f] = x;
      fy[f] = y;
      fvx[f] = dirX * (320 + Math.random() * 260);
      fvy[f] = -120 - Math.random() * 160;
      fl[f] = 1.6;
      kit.engine.fx.burst(x, y, 12, "#ffffff", [80, 260], [4, 9], [0.4, 0.9], false, -40);
    };

    return {
      onStart: () => kit.voice.say("wave"),
      update(dt) {
        const { w } = kit.stage;
        for (let f = 0; f < MAX_FLY; f++) {
          if (fl[f] <= 0) continue;
          fl[f] -= dt;
          fx[f] += fvx[f] * dt;
          fy[f] += fvy[f] * dt;
        }
        for (const k of kit.kids) {
          const s = k.slot;
          for (let i = 0; i < CLOUDS; i++) if (regrow[s * CLOUDS + i] > 0) regrow[s * CLOUDS + i] = Math.max(0, regrow[s * CLOUDS + i] - dt);
          if (!k.active || !k.present) {
            has[s] = 0;
            speed[s] = smooth(speed[s], 0, dt);
            continue;
          }
          const a = k.pts.lw;
          const b = k.pts.rw;
          let raw = 0;
          if (has[s]) {
            if (a.v > 0.15) raw = Math.max(raw, wristSpeed(a.x - prev[s * 4], a.y - prev[s * 4 + 1], dt, k.scale));
            if (b.v > 0.15) raw = Math.max(raw, wristSpeed(b.x - prev[s * 4 + 2], b.y - prev[s * 4 + 3], dt, k.scale));
          }
          prev[s * 4] = a.x;
          prev[s * 4 + 1] = a.y;
          prev[s * 4 + 2] = b.x;
          prev[s * 4 + 3] = b.y;
          has[s] = 1;
          speed[s] = smooth(speed[s], Math.min(raw, 12), dt, 12);
          let free = -1;
          for (let i = 0; i < CLOUDS; i++) {
            if (regrow[s * CLOUDS + i] <= 0) {
              free = i;
              break;
            }
          }
          if (free < 0) {
            charge[s] = 0;
            continue;
          }
          charge[s] += windGain(speed[s], k.signals.wave) * dt;
          if (charge[s] >= 1) {
            charge[s] = 0;
            cloudSpot(spot, k.pts.head.x, k.pts.head.y, k.headR, k.scale, free);
            blow(s, free, spot.x, spot.y, k.pts.head.x < w / 2 ? 1 : -1);
            kit.award(k, 1, spot.x, spot.y);
            kit.sfx.pop();
          }
        }
      },
      drawFront(ctx, now) {
        for (const k of kit.kids) {
          if (!k.active) continue;
          const s = k.slot;
          const r = cloudR(k.scale);
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          for (let i = 0; i < CLOUDS; i++) {
            if (regrow[s * CLOUDS + i] > 0) continue;
            cloudSpot(spot, k.pts.head.x, k.pts.head.y, k.headR, k.scale, i);
            const shake = Math.sin(now / 55 + i * 2) * charge[s] * 14;
            cloud(ctx, spot.x + shake, spot.y + Math.sin(now / 600 + i) * 5, r);
          }
        }
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        for (let f = 0; f < MAX_FLY; f++) {
          if (fl[f] <= 0) continue;
          ctx.globalAlpha = Math.min(1, fl[f]);
          cloud(ctx, fx[f], fy[f], 50);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
});
