// Basketbol: the ball is in your hand, push it up and forward fast to throw it into the hoop at the top. 60 s.

import type { EngineApi } from "@/engine/types";
import { BasketLogic, HELD, WAIT, type Hand } from "./logic";

const TAU = Math.PI * 2;

export class BasketGame {
  readonly logic: BasketLogic;
  private readonly hand: Hand = { x: 0, y: 0, vx: 0, vy: 0, ok: false };
  private last = 0;
  private done = false;
  private hudT = 0;
  private prevX = 0;
  private prevY = 0;
  private prevSide = -1;
  private netShake = 0;
  private hint = 0;

  constructor(private readonly e: EngineApi) {
    const q = Number(e.query.get("duration"));
    const dur = q > 0 ? q : 60;
    this.logic = new BasketLogic(dur, {
      throwBall: () => e.audio.whoosh(0.8),
      basket: (pts, streak, x, y) => {
        e.audio.good();
        if (streak > 1) e.audio.combo(streak);
        e.fx.burst(x, y, 22, "#ffb347", [120, 420], [3, 8], [0.4, 0.8], true);
        e.fx.popup(`+${pts}`, x, y + 40, "#7dffb0", 46, 0.9);
        e.fx.ring(x, y, 70, "#ffd27a", 0.5, 6);
        this.netShake = 0.5;
      },
      miss: (x, y) => {
        e.audio.bad();
        e.fx.popup("Xato", x, y, "#ff7a7a", 30, 0.6);
      },
      ready: () => {
        e.audio.plop();
        this.hint = 2;
      },
    });
    e.hud.set({ title: "Basketbol", score: 0, time: dur, bar: 1, combo: null, lives: null });
  }

  /** the dominant hand (blade point, else the wrist) with a smoothed velocity in px/s */
  private readHand(dt: number): void {
    const e = this.e;
    const p = e.players[0];
    const hd = this.hand;
    if (!p.present) {
      hd.ok = false;
      return;
    }
    let side = p.dominant === "L" ? 0 : 1;
    const ok = (s: number): boolean => p.blades[s].active || p.lm[15 + s].v > 0.3;
    if (!ok(side) && ok(1 - side)) side = 1 - side;
    if (!ok(side)) {
      hd.ok = false;
      return;
    }
    const b = p.blades[side];
    const x = b.active ? b.x : p.lm[15 + side].x;
    const y = b.active ? b.y : p.lm[15 + side].y;
    if (side !== this.prevSide || !hd.ok || dt <= 0) {
      hd.vx = 0;
      hd.vy = 0;
    } else {
      const k = 0.6;
      hd.vx += ((x - this.prevX) / dt - hd.vx) * k;
      hd.vy += ((y - this.prevY) / dt - hd.vy) * k;
    }
    hd.x = x;
    hd.y = y;
    hd.ok = true;
    this.prevX = x;
    this.prevY = y;
    this.prevSide = side;
  }

  frame(c: CanvasRenderingContext2D, now: number): void {
    const e = this.e;
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    const L = this.logic;
    this.readHand(dt);
    if (this.netShake > 0) this.netShake -= dt;
    if (this.hint > 0) this.hint -= dt;
    if (e.state === "play" && !this.done) {
      L.update(dt, e.stage.w, e.stage.h, this.hand.ok ? this.hand : null);
      this.hudT -= dt;
      if (this.hudT <= 0) {
        this.hudT = 0.1;
        e.hud.set({
          score: L.score,
          time: Math.max(0, Math.ceil(L.duration - L.time)),
          bar: Math.max(0, 1 - L.time / L.duration),
          combo: L.streak > 1 ? `×${L.streak}` : null,
        });
      }
      if (L.over) this.end();
    } else if (e.state !== "play" && L.hx === 0) {
      // before the start: show the hoop in its place
      L.hx = e.stage.w / 2;
      L.rimY = Math.max(130, e.stage.h * 0.22);
      L.halfW = L.ballR * 1.65;
    }
    this.draw(c, now);
  }

  private end(): void {
    const L = this.logic;
    this.done = true;
    this.e.finish({
      score: L.score,
      lines: [
        ["Gollar", L.baskets],
        ["Otishlar", L.throws],
        ["Aniqlik", `${L.throws ? Math.round((L.baskets / L.throws) * 100) : 0}%`],
        ["Eng uzun seriya", L.bestStreak],
      ],
    });
  }

  private draw(c: CanvasRenderingContext2D, now: number): void {
    const L = this.logic;
    const w = this.e.stage.w;
    const R = L.ballR;
    const hx = L.hx;
    const ry = L.rimY;
    const hw = L.halfW;
    c.save();
    c.lineCap = "round";
    // backboard
    c.fillStyle = "rgba(255,255,255,0.18)";
    c.strokeStyle = "rgba(255,255,255,0.85)";
    c.lineWidth = 4;
    c.beginPath();
    c.rect(hx - hw * 1.25, ry - hw * 1.55, hw * 2.5, hw * 1.6);
    c.fill();
    c.stroke();
    // net
    const sh = this.netShake > 0 ? Math.sin(now / 35) * 5 * this.netShake : 0;
    c.strokeStyle = "rgba(255,255,255,0.8)";
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      c.moveTo(hx - hw + f * 2 * hw, ry);
      c.lineTo(hx - hw * 0.55 + f * 1.1 * hw + sh, ry + hw * 1.1);
    }
    c.moveTo(hx - hw * 0.85, ry + hw * 0.5);
    c.lineTo(hx + hw * 0.85, ry + hw * 0.5);
    c.moveTo(hx - hw * 0.65, ry + hw * 0.95);
    c.lineTo(hx + hw * 0.65 + sh, ry + hw * 0.95);
    c.stroke();
    // rim
    c.strokeStyle = "#ff5a2a";
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(hx - hw, ry);
    c.lineTo(hx + hw, ry);
    c.stroke();
    // ball
    if ((L.state !== WAIT || L.by < this.e.stage.h) && (L.time > 0 || this.hand.ok)) this.drawBall(c, L.bx, L.by, R, now);
    if (L.state === HELD && this.hand.ok) {
      const armed = L.armed;
      c.fillStyle = armed ? "rgba(125,255,176,0.95)" : "rgba(255,255,255,0.8)";
      c.font = "bold 22px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      if (armed && this.hint > 0) c.fillText("Yuqoriga itaring!", Math.min(w - 110, Math.max(110, L.bx)), L.by - R * 2);
      c.strokeStyle = armed ? "rgba(125,255,176,0.8)" : "rgba(255,255,255,0.4)";
      c.lineWidth = 3;
      c.beginPath();
      c.arc(L.bx, L.by, R * 1.25, 0, TAU);
      c.stroke();
    }
    c.restore();
  }

  private drawBall(c: CanvasRenderingContext2D, x: number, y: number, r: number, now: number): void {
    c.save();
    c.translate(x, y);
    c.rotate(now / 400);
    c.fillStyle = "#f08a24";
    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    c.fill();
    c.strokeStyle = "#3a1a05";
    c.lineWidth = 2.5;
    c.stroke();
    c.beginPath();
    c.moveTo(-r, 0);
    c.lineTo(r, 0);
    c.moveTo(0, -r);
    c.lineTo(0, r);
    c.arc(-r * 1.15, 0, r * 0.95, -0.9, 0.9);
    c.moveTo(r * 0.23, 0);
    c.arc(r * 1.15, 0, r * 0.95, Math.PI - 0.9, Math.PI + 0.9);
    c.stroke();
    c.restore();
  }

  dispose(): void {
    this.done = true;
  }
}
