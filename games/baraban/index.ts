import { defineKidsGame, drawEmoji, minScaleFor, type KidSlot } from "../bogcha/common";
import { BEAT, PATTERNS, activeBeat, approachRing, blockOf, drumRadius, drumSpot, enteredDrum, isHighBlock, isPerfect, sideAt } from "./logic";

// "Baraban": two drums beside every child (shoulder height; every third phase above the head). A steady beat ticks,
// one drum lights up per beat with a ring that closes in; a hand that comes into the lit drum on time gives a star.
export default defineKidsGame({
  slug: "baraban",
  roundSec: 70,
  music: null,
  dim: 0.5,
  create(kit) {
    const prevD = new Float32Array(10).fill(1e6); // per slot and hand: distance to the lit drum last frame
    const evalBeat = new Int32Array(5).fill(-1);
    const hitBeat = new Int32Array(5).fill(-1);
    const flash = new Float32Array(10); // per slot and side
    const spot = { x: 0, y: 0 };
    let t = 0;
    let tick = 0;
    let pattern = PATTERNS[0];
    let high = false;
    let block = 0;
    let cur = -1;
    let pulse = 0;

    const spotFor = (k: KidSlot, side: 0 | 1): void => {
      drumSpot(spot, k.pts.head.x, k.pts.head.y, k.headR, (k.pts.ls.y + k.pts.rs.y) / 2, k.scale, side, high);
    };

    return {
      onStart: () => kit.voice.say("clap", 1800),
      update(dt) {
        t += dt;
        for (let i = 0; i < 10; i++) flash[i] = Math.max(0, flash[i] - dt * 3);
        pulse = Math.max(0, pulse - dt * 4);
        const nearest = Math.floor(t / BEAT);
        if (nearest > tick) {
          tick = nearest;
          pulse = 1;
          kit.sfx.pop();
        }
        cur = activeBeat(t);
        if (cur < 0) return;
        // every 8 beats a new pattern; every third block the drums move above the head
        const bl = blockOf(cur);
        pattern = PATTERNS[bl % PATTERNS.length];
        high = isHighBlock(bl);
        if (bl !== block) {
          block = bl;
          if (high) kit.voice.say("handsUp", 2000);
        }
        const side = sideAt(pattern, cur);
        const minS = minScaleFor(kit.stage.h);
        for (const k of kit.kids) {
          if (!k.active || !k.present) continue;
          const s = k.slot;
          spotFor(k, side);
          const r = drumRadius(k.scale, minS);
          const first = evalBeat[s] !== cur;
          evalBeat[s] = cur;
          for (let h = 0; h < 2; h++) {
            const wr = h === 0 ? k.pts.lw : k.pts.rw;
            if (wr.v < 0.2) {
              prevD[s * 2 + h] = 1e6;
              continue;
            }
            const d = Math.hypot(wr.x - spot.x, wr.y - spot.y);
            const was = prevD[s * 2 + h];
            prevD[s * 2 + h] = d;
            if (first || hitBeat[s] === cur || !enteredDrum(was, d, r)) continue;
            hitBeat[s] = cur;
            flash[s * 2 + side] = 1;
            kit.sfx.drum();
            kit.award(k, isPerfect(t, cur) ? 2 : 1, spot.x, spot.y - r);
            kit.engine.fx.burst(spot.x, spot.y, 8, k.color, [100, 260], [3, 6], [0.3, 0.6], true);
          }
        }
      },
      drawFront(ctx) {
        const { w, h } = kit.stage;
        const minS = minScaleFor(h);
        drawEmoji(ctx, "🥁", w / 2, h * 0.2, 80 + pulse * 26);
        const toBeat = cur * BEAT - t;
        const lit = cur >= 0 ? sideAt(pattern, cur) : -1;
        for (const k of kit.kids) {
          if (!k.active) continue;
          const r = drumRadius(k.scale, minS);
          for (let side = 0; side < 2; side++) {
            spotFor(k, side as 0 | 1);
            const on = side === lit && hitBeat[k.slot] !== cur;
            const f = flash[k.slot * 2 + side];
            const rr = r * (on ? 1.1 : 1) * (1 + f * 0.25);
            ctx.globalAlpha = on || f > 0 ? 1 : 0.55;
            ctx.fillStyle = on ? "#ffd23d" : k.color;
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(spot.x, spot.y, rr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.35)";
            ctx.beginPath();
            ctx.arc(spot.x, spot.y, rr * 0.55, 0, Math.PI * 2);
            ctx.fill();
            if (on) {
              const ar = approachRing(toBeat, rr);
              if (ar > 0) {
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.arc(spot.x, spot.y, ar, 0, Math.PI * 2);
                ctx.stroke();
              }
            }
          }
        }
        ctx.globalAlpha = 1;
      },
    };
  },
});
