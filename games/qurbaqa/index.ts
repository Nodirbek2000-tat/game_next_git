import { defineKidsGame, drawEmoji } from "../bogcha/common";
import { jumpedRecently, logAtKid, logReach, logX, slotBit } from "./logic";

// "Qurbaqa sakrashi": a log rolls across the screen, children jump when it reaches them (signals.jump / jumpFired).
// A child who jumps while the log is at them gets a star and the frog cheers. Nobody loses: a log that is not jumped just rolls on.
export default defineKidsGame({
  slug: "qurbaqa",
  roundSec: 70,
  music: "bouncy",
  dim: 0.5,
  create(kit) {
    const lastJump = new Float64Array(5).fill(-100);
    let clock = 0; // game time in seconds (only advances while playing)
    let phase: "gap" | "roll" = "gap";
    let t = 1.5;
    let dur = 4.5;
    let dir: 1 | -1 = 1;
    let done = 0; // bit mask of children who jumped this log
    let cheer = 0;

    const logW = (): number => Math.max(170, kit.stage.w * 0.13);

    return {
      onStart: () => kit.voice.say("jump"),
      update(dt) {
        clock += dt;
        cheer = Math.max(0, cheer - dt);
        for (const k of kit.kids) if (k.active && (k.signals.jump || k.signals.jumpFired)) lastJump[k.slot] = clock;
        t -= phase === "gap" ? dt : -dt;
        if (phase === "gap") {
          if (t <= 0) {
            phase = "roll";
            t = 0;
            dur = 3.6 + Math.random() * 1.4;
            dir = dir === 1 ? -1 : 1;
            done = 0;
            kit.voice.say("jump", 1800);
          }
          return;
        }
        if (t >= dur) {
          phase = "gap";
          t = 1.2 + Math.random() * 0.8;
          return;
        }
        const lw = logW();
        const cx = logX(t, dur, dir, kit.stage.w, lw);
        for (const k of kit.kids) {
          if (!k.active || !k.present || done & slotBit(k.slot)) continue;
          if (!logAtKid(cx, k.center.x, logReach(k.scale, kit.stage.w, lw)) || !jumpedRecently(clock, lastJump[k.slot])) continue;
          done |= slotBit(k.slot);
          cheer = 1;
          kit.award(k);
          kit.sfx.yay();
          kit.engine.fx.burst(k.center.x, kit.stage.h * 0.82, 12, "#7fe3ff", [120, 320], [3, 7], [0.4, 0.8], true, 500);
        }
      },
      drawBack(ctx, now) {
        const { w, h } = kit.stage;
        // pond at the bottom
        ctx.fillStyle = "rgba(40,140,220,0.35)";
        ctx.fillRect(0, h * 0.84, w, h * 0.16);
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 40) {
          const yy = h * 0.84 + Math.sin(x / 60 + now / 400) * 6;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      },
      drawFront(ctx, now) {
        const { w, h } = kit.stage;
        // the frog, hopping when somebody jumped
        const hop = cheer > 0 ? Math.abs(Math.sin(now / 90)) * 50 : 0;
        drawEmoji(ctx, "🐸", w * 0.09, h * 0.27 - hop, 120);
        if (cheer > 0) drawEmoji(ctx, "🎉", w * 0.09 + 80, h * 0.27 - hop - 50, 60);
        if (phase !== "roll") return;
        const lw = logW();
        const lh = lw * 0.36;
        const cx = logX(t, dur, dir, w, lw);
        const cy = h * 0.88;
        ctx.fillStyle = "#8a5a2b";
        ctx.fillRect(cx - lw / 2, cy - lh / 2, lw, lh);
        ctx.strokeStyle = "#5e3a18";
        ctx.lineWidth = 4;
        ctx.beginPath();
        const off = (t * 90 * dir) % 40;
        for (let i = -2; i <= 2; i++) {
          const lx = cx + i * 40 + off;
          if (lx > cx - lw / 2 + 8 && lx < cx + lw / 2 - 8) {
            ctx.moveTo(lx, cy - lh / 2 + 6);
            ctx.lineTo(lx + 14, cy + lh / 2 - 6);
          }
        }
        ctx.stroke();
        for (const ex of [cx - lw / 2, cx + lw / 2]) {
          ctx.fillStyle = "#d9a15a";
          ctx.beginPath();
          ctx.ellipse(ex, cy, lh * 0.28, lh / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#8a5a2b";
          ctx.beginPath();
          ctx.ellipse(ex, cy, lh * 0.14, lh * 0.26, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        // a warning arrow at the edge where the log comes from
        drawEmoji(ctx, dir === 1 ? "➡️" : "⬅️", dir === 1 ? 50 : w - 50, h * 0.7, 70);
      },
    };
  },
});
