import { defineKidsGame, drawEmoji, minScaleFor } from "../bogcha/common";
import { showBanner } from "../kids-b-util";
import { Weather, isUnder, passStar } from "./logic";

const KIDS = 5;
const DROPS = 30;
const TAU = Math.PI * 2;

// "Soyabon": a rain cloud crosses the stage. Under it, hold both hands above your head (umbrella) to stay dry. Then the sun comes.
export default defineKidsGame({
  slug: "soyabon",
  roundSec: 75,
  music: "calm",
  create(kit) {
    const weather = new Weather();
    const underSec = new Float32Array(KIDS);
    const wetSec = new Float32Array(KIDS);
    const dx = new Float32Array(DROPS); // offset from the cloud centre, -1..1
    const dy = new Float32Array(DROPS);
    const dv = new Float32Array(DROPS);
    let dryPasses = 0;

    const halfW = (): number => kit.stage.w * 0.17;
    const cloudY = (): number => kit.stage.h * 0.27;
    const scaleOf = (s: number): number => Math.max(s, minScaleFor(kit.stage.h));
    const respawn = (i: number, spread: boolean): void => {
      dx[i] = Math.random() * 2 - 1;
      dy[i] = cloudY() + (spread ? Math.random() * (kit.stage.h - cloudY()) : 0);
      dv[i] = kit.stage.h * (0.7 + Math.random() * 0.4);
    };
    for (let i = 0; i < DROPS; i++) respawn(i, true);

    return {
      onStart() {
        weather.reset(halfW());
        showBanner(kit, "Yomg‘ir! Qo‘llarni tepaga — soyabon!", "☂️");
      },
      update(dt) {
        const w = kit.stage.w;
        const hw = halfW();
        const ev = weather.step(dt, w, hw);
        if (ev === 1) {
          showBanner(kit, "Quyosh chiqdi!", "☀️");
          if (dryPasses > 0) kit.award(null, 1);
          dryPasses = 0;
        } else if (ev === 2) {
          showBanner(kit, "Yana yomg‘ir! Soyabonni oching!", "☂️");
        }
        const raining = weather.phase === "rain";
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) {
            underSec[n] = wetSec[n] = 0;
            continue;
          }
          const under = raining && k.present && isUnder(k.pts.head.x, weather.x, hw * 0.9);
          if (under) {
            underSec[n] += dt;
            if (!k.signals.handsUp) wetSec[n] += dt;
          } else if (underSec[n] > 0 && (!raining || !k.present || !isUnder(k.pts.head.x, weather.x, hw * 1.05))) {
            // the cloud has passed
            if (passStar(underSec[n], wetSec[n])) {
              kit.award(k, 1);
              kit.sfx.yay();
              dryPasses++;
            }
            underSec[n] = wetSec[n] = 0;
          }
        }
        if (!raining) return;
        for (let i = 0; i < DROPS; i++) {
          dy[i] += dv[i] * dt;
          const x = weather.x + dx[i] * hw * 0.85;
          let gone = dy[i] > kit.stage.h;
          for (let n = 0; n < KIDS && !gone; n++) {
            const k = kit.kids[n];
            if (!k.active || !k.signals.handsUp) continue;
            const s = scaleOf(k.scale);
            gone = Math.abs(x - k.pts.head.x) < s * 1.1 && dy[i] > k.pts.head.y - s * 2 && dy[i] < k.pts.head.y - s * 0.8;
          }
          if (gone) respawn(i, false);
        }
      },
      drawBack(ctx, now) {
        const w = kit.stage.w;
        const h = kit.stage.h;
        if (weather.phase === "rain") {
          ctx.fillStyle = "rgba(40,60,110,.28)";
          ctx.fillRect(0, 0, w, h);
          const hw = halfW();
          const cy = cloudY();
          ctx.fillStyle = "#6c7a95";
          ctx.beginPath();
          ctx.ellipse(weather.x, cy, hw, hw * 0.4, 0, 0, TAU);
          ctx.ellipse(weather.x - hw * 0.5, cy - hw * 0.12, hw * 0.5, hw * 0.35, 0, 0, TAU);
          ctx.ellipse(weather.x + hw * 0.35, cy - hw * 0.25, hw * 0.55, hw * 0.4, 0, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = "rgba(120,190,255,.9)";
          ctx.lineWidth = Math.max(3, h * 0.006);
          ctx.beginPath();
          for (let i = 0; i < DROPS; i++) {
            const x = weather.x + dx[i] * hw * 0.85;
            ctx.moveTo(x, dy[i]);
            ctx.lineTo(x - 3, dy[i] + h * 0.03);
          }
          ctx.stroke();
        } else {
          ctx.fillStyle = "rgba(255,220,90,.14)";
          ctx.fillRect(0, 0, w, h);
          drawEmoji(ctx, "☀️", w * 0.5, h * 0.3 + Math.sin(now * 0.004) * 6, h * 0.26);
        }
      },
      drawFront(ctx) {
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) continue;
          const s = scaleOf(k.scale);
          const x = k.pts.head.x;
          const y = k.pts.head.y - s * 1.2;
          if (weather.phase === "rain" && k.signals.handsUp) {
            ctx.fillStyle = k.color;
            ctx.beginPath();
            ctx.arc(x, y, s * 1.2, Math.PI, 0);
            ctx.fill();
            ctx.strokeStyle = "#3a2a6b";
            ctx.lineWidth = Math.max(3, s * 0.07);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + s * 0.9);
            ctx.stroke();
          } else if (wetSec[n] > 0.5 && underSec[n] > 0) {
            drawEmoji(ctx, "💧", x + s * 0.8, k.pts.head.y - s * 0.4, s * 0.6);
          }
          // dry streak bar under the cloud
          if (underSec[n] > 0) {
            const f = Math.min(1, underSec[n] / 2.5);
            ctx.fillStyle = "rgba(255,255,255,.6)";
            ctx.fillRect(x - s, y - s * 1.5, s * 2, 8);
            ctx.fillStyle = wetSec[n] > underSec[n] * 0.4 ? "#7aa7ff" : "#ffd23d";
            ctx.fillRect(x - s, y - s * 1.5, s * 2 * f, 8);
          }
        }
      },
    };
  },
});
