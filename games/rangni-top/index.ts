import { defineKidsGame, drawEmoji } from "../bogcha/common";
import { COLORS, pickTarget, shuffleColors, zoneCount, zoneOf } from "./logic";

// "Rangni top": the stage is split into 2-3 coloured zones. A colour is called ("Qizil!"), children run into that zone
// (position of the body centre). When the time is up everybody standing in the right zone gets a star. Nobody loses.
const CALL_SEC = 6;
const JUDGE_SEC = 2.2;

export default defineKidsGame({
  slug: "rangni-top",
  roundSec: 75,
  music: "march",
  dim: 0.45,
  create(kit) {
    const order: number[] = [0, 1, 2, 3];
    let zones = 2;
    let target = 0;
    let phase: "call" | "judge" = "judge";
    let t = 0.5; // seconds left in the phase
    let font = "";
    let fontH = 0;

    const call = (): void => {
      let n = 0;
      for (const k of kit.kids) if (k.active && k.present) n++;
      zones = zoneCount(n);
      shuffleColors(order, zones, Math.random);
      target = pickTarget(zones, target, Math.random);
      phase = "call";
      t = CALL_SEC;
      const c = COLORS[order[target]];
      const b = kit.voice.banner;
      b.text = `${c.name}!`;
      b.icon = c.emoji;
      b.until = performance.now() + CALL_SEC * 1000;
      kit.sfx.attention();
    };

    return {
      update(dt) {
        t -= dt;
        if (t > 0) return;
        if (phase === "judge") {
          call();
          return;
        }
        phase = "judge";
        t = JUDGE_SEC;
        for (const k of kit.kids) {
          if (k.active && k.present && zoneOf(k.center.x, kit.stage.w, zones) === target) kit.award(k);
        }
        kit.sfx.yay();
      },
      drawBack(ctx, now) {
        const { w, h } = kit.stage;
        if (fontH !== h) {
          fontH = h;
          font = `bold ${Math.round(h * 0.07)}px sans-serif`;
        }
        const zw = w / zones;
        const pulse = 0.5 + 0.5 * Math.sin(now / 150);
        ctx.font = font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let z = 0; z < zones; z++) {
          const c = COLORS[order[z]];
          const hit = z === target;
          ctx.globalAlpha = phase === "judge" ? (hit ? 0.5 + pulse * 0.2 : 0.14) : 0.3;
          ctx.fillStyle = c.fill;
          ctx.fillRect(z * zw, 0, zw, h);
          ctx.globalAlpha = 1;
          drawEmoji(ctx, c.emoji, z * zw + zw / 2, h * 0.3, Math.min(150, zw * 0.45));
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "rgba(0,0,0,0.5)";
          ctx.lineWidth = 6;
          ctx.strokeText(c.name, z * zw + zw / 2, h * 0.9);
          ctx.fillText(c.name, z * zw + zw / 2, h * 0.9);
        }
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let z = 1; z < zones; z++) {
          ctx.moveTo(z * zw, 0);
          ctx.lineTo(z * zw, h);
        }
        ctx.stroke();
      },
    };
  },
});
