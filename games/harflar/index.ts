import { defineKidsGame, drawEmoji, minScaleFor } from "../bogcha/common";
import { showBanner } from "../kids-b-util";
import { HOLD_SEC, LETTER_TEXT, POSES, classify, holdStep, nextLetter, type Letter, type ShapeIn } from "./logic";

const KIDS = 5;
const TAU = Math.PI * 2;
const MAX_LETTER_SEC = 14;

// "Harflar": a letter is shown, children make it with their bodies and hold it for a second.
export default defineKidsGame({
  slug: "harflar",
  roundSec: 80,
  music: "calm",
  create(kit) {
    const hold = new Float32Array(KIDS);
    const done = new Uint8Array(KIDS);
    const inp: ShapeIn = { scale: 1, headY: 0, shoulderY: 0, lwx: 0, lwy: 0, lwv: 0, rwx: 0, rwy: 0, rwv: 0, ankleDx: 0, legsSeen: false };
    let letter: Letter = "I";
    let age = 0;
    let allDoneFor = 0;

    const legsOk = (): boolean => {
      let n = 0;
      for (const k of kit.kids) {
        if (!k.active || !k.present) continue;
        if (k.pts.la.v < 0.2 || k.pts.ra.v < 0.2) return false;
        n++;
      }
      return n > 0;
    };
    const pick = (): void => {
      letter = nextLetter(letter, Math.random(), legsOk());
      age = 0;
      allDoneFor = 0;
      hold.fill(0);
      done.fill(0);
      showBanner(kit, LETTER_TEXT[letter], "🔤", 4000);
    };

    return {
      onStart() {
        letter = nextLetter("", Math.random(), false);
        pick();
      },
      update(dt) {
        age += dt;
        let waiting = 0;
        let total = 0;
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) {
            hold[n] = 0;
            continue;
          }
          total++;
          if (done[n]) continue;
          waiting++;
          let ok = false;
          if (k.present) {
            const p = k.pts;
            inp.scale = Math.max(k.scale, minScaleFor(kit.stage.h));
            inp.headY = p.head.y;
            inp.shoulderY = (p.ls.y + p.rs.y) / 2;
            inp.lwx = p.lw.x;
            inp.lwy = p.lw.y;
            inp.lwv = p.lw.v;
            inp.rwx = p.rw.x;
            inp.rwy = p.rw.y;
            inp.rwv = p.rw.v;
            inp.ankleDx = Math.abs(p.la.x - p.ra.x);
            inp.legsSeen = p.la.v > 0.2 && p.ra.v > 0.2;
            ok = classify(inp) === letter;
          }
          hold[n] = holdStep(hold[n], ok, dt);
          if (hold[n] >= HOLD_SEC) {
            done[n] = 1;
            waiting--;
            kit.award(k, 1);
            kit.sfx.yay();
          }
        }
        if (total > 0 && waiting === 0) {
          allDoneFor += dt;
          if (allDoneFor > 1.6) pick();
        } else if (age > MAX_LETTER_SEC) pick();
      },
      drawFront(ctx) {
        const w = kit.stage.w;
        const h = kit.stage.h;
        // progress rings and checkmarks over the heads
        for (let n = 0; n < KIDS; n++) {
          const k = kit.kids[n];
          if (!k.active) continue;
          const r = Math.max(k.headR, minScaleFor(h) * 0.5) * 1.9;
          if (done[n]) {
            drawEmoji(ctx, "✅", k.pts.head.x, k.pts.head.y - r * 1.1, r * 1.1);
          } else if (hold[n] > 0) {
            ctx.lineWidth = Math.max(6, r * 0.18);
            ctx.strokeStyle = k.color;
            ctx.beginPath();
            ctx.arc(k.pts.head.x, k.pts.head.y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, hold[n] / HOLD_SEC));
            ctx.stroke();
          }
        }
        // the picture: letter + figure, top right
        const bw = Math.min(w * 0.28, h * 0.4);
        const x0 = w - bw - 14;
        const y0 = h * 0.24;
        ctx.fillStyle = "rgba(255,255,255,.88)";
        ctx.beginPath();
        ctx.roundRect(x0, y0, bw, bw * 1.25, bw * 0.12);
        ctx.fill();
        ctx.fillStyle = "#3a2a6b";
        ctx.font = `900 ${Math.round(bw * 0.4)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, x0 + bw / 2, y0 + bw * 0.25);
        drawFigure(ctx, x0 + bw / 2, y0 + bw * 0.62, bw * 0.3, letter);
      },
    };
  },
});

function drawFigure(ctx: CanvasRenderingContext2D, cx: number, cy: number, u: number, letter: Letter): void {
  const [ax, ay, lx] = POSES[letter];
  ctx.strokeStyle = "#3a2a6b";
  ctx.fillStyle = "#3a2a6b";
  ctx.lineWidth = Math.max(4, u * 0.12);
  ctx.lineCap = "round";
  const sy = cy - u * 0.45; // shoulders
  const hy = cy + u * 0.35; // hips
  ctx.beginPath();
  ctx.arc(cx, cy - u * 0.8, u * 0.2, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, sy);
  ctx.lineTo(cx, hy);
  ctx.moveTo(cx, sy);
  ctx.lineTo(cx - ax * u * 0.9, sy + ay * u * 0.9);
  ctx.moveTo(cx, sy);
  ctx.lineTo(cx + ax * u * 0.9, sy + ay * u * 0.9);
  ctx.moveTo(cx, hy);
  ctx.lineTo(cx - lx * u, hy + u * 0.8);
  ctx.moveTo(cx, hy);
  ctx.lineTo(cx + lx * u, hy + u * 0.8);
  ctx.stroke();
}
