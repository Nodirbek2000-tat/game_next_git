import { clamp, type EngineApi } from "@/engine";
import { bottomLift } from "@/engine/ui/safe";
import * as art from "./art";
import { apexY, ballScale, difficulty, gravity, headPoint, handPoint, launch, newBall, newSm, smUpdate, step, touch, Wind, type Field, type XY } from "./logic";

const MAX_LIVES = 3;
const LIVES: string[] = [];
for (let i = 0; i <= MAX_LIVES; i++) LIVES.push("🏐".repeat(i));
const COMBO: string[] = [];
const comboText = (n: number): string => COMBO[n] ?? (COMBO[n] = `${n} ketma-ket`);
const rand = (): number => Math.random();
const MAX_V = 2.5;

/**
 * Voleybol: keep the ball in the air with hands and head. Gravity, air drag, spin and wind act on the ball; a hit sends it up and
 * to the side the hand moves (a harder swing = higher). Only small calm markers are drawn on the hands - the camera already shows
 * the person. 3 drops end the game; the ball shrinks, falls faster and the wind rises as the touches pile up.
 */
export class VoleybolGame {
  private readonly ball = newBall();
  private readonly field: Field = { w: 0, h: 0, floor: 0 };
  private readonly wind = new Wind();
  private readonly hands = [newSm(), newSm()];
  private readonly head = newSm();
  private readonly tmp: XY = { x: 0, y: 0 };
  /** hand positions of the previous frame (the sweep of a fast hand is tested, not just its end point) */
  private readonly hpx = [0, 0];
  private readonly hpy = [0, 0];
  private readonly hpn = [false, false];
  private rpx = 0;
  private rpy = 0;
  private rpn = false;
  private readonly pulse = [0, 0];
  private readonly trail = new Float32Array(8);
  private readonly roundSec: number;
  private topR = 86;
  private netY = 200;
  private netH = 40;
  private r0 = 30;
  private mr = 10;
  private sBall!: art.Sprite;
  private sGloss!: art.Sprite;
  private sShadow!: art.Sprite;
  private sMark!: art.Sprite;
  private sHot!: art.Sprite;
  private sNet!: art.Sprite;
  private sPost!: art.Sprite;
  private sCourt!: art.Sprite;
  private sArrow!: art.Sprite;
  private sWindL!: art.Sprite;
  private sWindR!: art.Sprite;
  private sHint!: art.Sprite;
  private last = 0;
  private time = 0;
  private lives = MAX_LIVES;
  private touches = 0;
  private heads = 0;
  private streak = 0;
  private best = 0;
  private score = 0;
  /** ball is on screen / in play (false = waiting for the serve) */
  private shown = false;
  private deadT = 0;
  private serveIn = 1.0;
  private endT = 0;
  private hudT = 0;
  private over = false;
  private flash = 0;
  private netGlow = 0;
  private pop = 0;
  private spinA = 0;
  private trailT = 0;

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    // no time limit unless ?duration=N is in the URL (tests)
    this.roundSec = d > 0 ? d : Infinity;
    this.ball.alive = false;
    this.layout();
    this.hud();
  }

  /** the engine calls this every frame (also while paused: then nothing moves) */
  draw(c: CanvasRenderingContext2D, now: number): void {
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    const st = this.e.stage;
    if (st.w !== this.field.w || st.h !== this.field.h) this.layout();
    if (this.e.state === "play" && !this.over) this.update(dt);
    this.render(c, dt);
  }

  // ------------------------------------------------------------------ layout and static art

  private layout(): void {
    const { w, h, dpr } = this.e.stage;
    const k = clamp(dpr || 1, 1, 2);
    const F = this.field;
    F.w = w;
    F.h = h;
    F.floor = h - Math.max(18, bottomLift(w, h) + 6);
    this.topR = h > w ? 78 : 86;
    this.netY = this.topR + (F.floor - this.topR) * 0.22;
    this.netH = clamp(h * 0.07, 30, 56);
    this.r0 = clamp(Math.min(h * 0.058, w * 0.075), 22, 50);
    this.mr = 12;
    this.sBall = art.ball(this.r0, k);
    this.sGloss = art.gloss(this.r0, k);
    this.sShadow = art.shadow(this.r0 * 3, k);
    this.sMark = art.marker(this.mr, false, k);
    this.sHot = art.marker(this.mr, true, k);
    this.sNet = art.net(w, this.netH, k);
    this.sPost = art.post(5, F.floor - this.netY, k);
    this.sCourt = art.court(w, Math.max(8, h - F.floor + 4), k);
    this.sArrow = art.arrow(12, k);
    this.sWindL = art.textSprite(["‹‹‹ Shamol"], clamp(w * 0.04, 15, 22), "#bfe9ff", w - 24, k);
    this.sWindR = art.textSprite(["Shamol ›››"], clamp(w * 0.04, 15, 22), "#bfe9ff", w - 24, k);
    this.sHint = art.textSprite(["To‘pni qo‘l yoki bosh bilan", "tepaga uring!", "To‘rdan baland uring: qo‘shimcha ochko"], clamp(w * 0.045, 16, 26), "#ffffff", w - 24, k);
  }

  // ------------------------------------------------------------------ game logic

  private serve(sc: number, cx: number): void {
    const F = this.field;
    const diff = difficulty(this.touches);
    const b = this.ball;
    b.r = this.r0 * ballScale(diff);
    // the first balls come to the player, later ones also to the sides
    const x = clamp(cx + (rand() * 2 - 1) * (1.0 + 2.2 * diff) * sc * 1.5, b.r + 16, F.w - b.r - 16);
    launch(b, x, -b.r * 1.5, (rand() - 0.5) * 0.14 * F.h, 0.22 * F.h);
    this.shown = true;
    this.trail.fill(-999);
  }

  private update(dt: number): void {
    const e = this.e;
    const F = this.field;
    const p = e.players[0];
    const lm = p.lm;
    const sc = p.scale > 20 ? p.scale : 60;
    const pr = p.present;
    const tmp = this.tmp;
    const b = this.ball;
    this.time += dt;

    // calm markers on the hands (filtered landmarks + dead-zone smoothing); the previous point is kept for the sweep
    for (let i = 0; i < 2; i++) {
      const s = this.hands[i];
      this.hpn[i] = s.on;
      this.hpx[i] = s.x;
      this.hpy[i] = s.y;
      smUpdate(s, pr && handPoint(lm, i === 0, tmp), tmp.x, tmp.y, dt, sc);
    }
    this.rpn = this.head.on;
    this.rpx = this.head.x;
    this.rpy = this.head.y;
    smUpdate(this.head, pr && headPoint(lm, p.headR, tmp), tmp.x, tmp.y, dt, sc, 0.1, 0.09, 0.03);
    for (let i = 0; i < 2; i++) this.pulse[i] = Math.max(0, this.pulse[i] - dt * 5);
    this.netGlow = Math.max(0, this.netGlow - dt * 2.5);
    this.pop = Math.max(0, this.pop - dt * 7);

    const diff = difficulty(this.touches);
    this.wind.update(dt, diff, rand);
    const g = gravity(diff);

    if (this.endT > 0) {
      this.endT -= dt;
      if (this.endT <= 0) this.finish();
    } else if (!b.alive && !this.shown) {
      this.serveIn -= dt;
      if (this.serveIn <= 0 && pr) this.serve(sc, p.center.x);
    }

    if (this.shown) {
      const n = Math.min(5, Math.max(1, Math.ceil(dt / 0.0125)));
      const h = dt / n;
      const tr = clamp(sc * 0.3, 18, 44);
      const hr = clamp(p.headR * 0.95, 20, 60);
      for (let s = 0; s < n; s++) {
        const f = (s + 1) / n;
        if (b.alive) {
          let strength = 0;
          for (let i = 0; i < 2 && strength === 0; i++) {
            const m = this.hands[i];
            if (!m.on) continue;
            const bl = p.blades[i];
            // real hand speed from the engine (blades); our own marker speed when the blade is lost
            const vx = bl.active ? clamp(bl.vx, -MAX_V * F.h, MAX_V * F.h) : m.vx;
            const vy = bl.active ? clamp(bl.vy, -MAX_V * F.h, MAX_V * F.h) : m.vy;
            const x0 = this.hpn[i] ? this.hpx[i] : m.x;
            const y0 = this.hpn[i] ? this.hpy[i] : m.y;
            const tx = x0 + (m.x - x0) * f;
            const ty = y0 + (m.y - y0) * f;
            strength = touch(b, tx, ty, vx, vy, tr, F, false);
            if (strength > 0) this.onHit(strength, tx, ty, false, i, g);
          }
          if (strength === 0 && this.head.on) {
            const m = this.head;
            const x0 = this.rpn ? this.rpx : m.x;
            const y0 = this.rpn ? this.rpy : m.y;
            const tx = x0 + (m.x - x0) * f;
            const ty = y0 + (m.y - y0) * f;
            strength = touch(b, tx, ty, m.vx, m.vy, hr, F, true);
            if (strength > 0) this.onHit(strength, tx, ty, true, -1, g);
          }
        }
        const floor = step(b, h, F, g, this.wind.v);
        if (floor && b.alive) this.drop();
      }
      if (!b.alive) {
        this.deadT += dt;
        if (this.deadT > 1.0) {
          this.shown = false;
          this.serveIn = 0.5;
        }
      }
      this.spinA += b.spin * dt;
      this.trailT += dt;
      if (this.trailT > 0.03) {
        this.trailT = 0;
        const t = this.trail;
        t[0] = t[2];
        t[1] = t[3];
        t[2] = t[4];
        t[3] = t[5];
        t[4] = t[6];
        t[5] = t[7];
        t[6] = b.x;
        t[7] = b.y;
      }
    }

    this.hudT -= dt;
    if (this.hudT <= 0) this.hud();
    if (this.time >= this.roundSec && this.endT <= 0) this.finish();
  }

  private finish(): void {
    if (this.over) return;
    this.over = true;
    this.e.finish({ score: this.score, lines: [["Zarbalar", this.touches], ["Eng uzun seriya", this.best], ["Bosh bilan", this.heads]] });
  }

  private onHit(strength: number, x: number, y: number, head: boolean, hand: number, g: number): void {
    const e = this.e;
    const F = this.field;
    const b = this.ball;
    this.touches++;
    this.streak++;
    this.best = Math.max(this.best, this.streak);
    if (head) this.heads++;
    else this.pulse[hand] = 1;
    this.pop = 1;
    const high = apexY(b, g, F.h) < this.netY;
    if (high) this.netGlow = 1;
    const add = 10 + Math.min(this.streak, 15) * 2 + (high ? 5 : 0);
    this.score += add;
    e.audio.tone((head ? 190 : 250) + 260 * strength, 130, 0.1, "sine", 0.3);
    e.fx.ring(x, y, 8 + 10 * strength, "255,255,255", 0.3, 4);
    e.fx.burst(x, y, 5, high ? "#ffe066" : "#ffffff", [2, 5], [2, 4], [0.2, 0.4], false, 0.1);
    e.fx.popup((head ? "Bosh! +" : "+") + add, clamp(b.x, 50, F.w - 50), clamp(b.y - b.r - 18, this.topR + 14, F.h), high ? "#ffe066" : "#7dffa0", 22 + 8 * strength, 0.55);
    if (this.streak % 5 === 0) {
      e.audio.combo(this.streak);
      e.fx.popup(comboText(this.streak) + "!", F.w / 2, this.topR + 56, "#ffe066", 34);
    }
    this.hud();
  }

  private drop(): void {
    const e = this.e;
    const F = this.field;
    const b = this.ball;
    this.lives--;
    this.streak = 0;
    this.flash = 0.4;
    this.deadT = 0;
    b.alive = false;
    e.audio.bad();
    e.fx.shake(8, 0.2);
    e.fx.burst(b.x, F.floor, 6, "#ffffff", [1.5, 4], [2, 4], [0.25, 0.45], false, 0.12);
    e.fx.popup("Tushdi!", clamp(b.x, 70, F.w - 70), F.floor - 70, "#ff6b6b", 40);
    if (this.lives <= 0) this.endT = 0.9;
    this.hud();
  }

  private hud(): void {
    this.hudT = 0.5;
    const timed = Number.isFinite(this.roundSec);
    this.e.hud.set({
      title: "Voleybol",
      score: this.score,
      combo: this.streak > 2 ? comboText(this.streak) : null,
      lives: LIVES[Math.max(0, this.lives)],
      time: timed ? Math.max(0, Math.ceil(this.roundSec - this.time)) : Math.floor(this.time),
      timeLabel: timed ? "Vaqt" : "O‘yin vaqti",
    });
  }

  // ------------------------------------------------------------------ drawing (sprites only, no allocation)

  private render(c: CanvasRenderingContext2D, dt: number): void {
    const F = this.field;
    const b = this.ball;
    const w = F.w;
    // court: floor strip, net with its posts
    c.drawImage(this.sCourt.cv, 0, F.floor, w, this.sCourt.h);
    c.globalAlpha = 0.5 + 0.5 * this.netGlow;
    c.drawImage(this.sNet.cv, 0, this.netY, w, this.sNet.h);
    c.globalAlpha = 0.35;
    c.drawImage(this.sPost.cv, 0, this.netY, this.sPost.w, this.sPost.h);
    c.drawImage(this.sPost.cv, w - this.sPost.w, this.netY, this.sPost.w, this.sPost.h);
    c.globalAlpha = 1;

    const wv = this.wind.v;
    if (this.shown && Math.abs(wv) > 0.012) {
      const sp = wv < 0 ? this.sWindL : this.sWindR;
      c.globalAlpha = clamp(Math.abs(wv) / 0.07, 0.35, 1);
      c.drawImage(sp.cv, (w - sp.w) / 2, this.netY - sp.h - 4, sp.w, sp.h);
      c.globalAlpha = 1;
    }

    if (this.shown) {
      const hf = clamp((F.floor - b.y) / (0.9 * F.h), 0, 1);
      const sw = b.r * 3 * (0.55 + 0.5 * (1 - hf));
      c.globalAlpha = 0.3 + 0.6 * (1 - hf);
      c.drawImage(this.sShadow.cv, b.x - sw / 2, F.floor - sw * 0.25, sw, sw * 0.5);
      const size = this.sBall.w * (b.r / this.r0);
      const alpha = b.alive ? 1 : clamp((1.0 - this.deadT) / 0.35, 0, 1);
      // trail while the ball is fast
      const speed = Math.hypot(b.vx, b.vy) / F.h;
      if (b.alive && speed > 0.6) {
        c.globalAlpha = 0.16;
        const ts = size * 0.9;
        for (let i = 0; i < 3; i++) {
          const tx = this.trail[i * 2];
          if (tx > -900) c.drawImage(this.sBall.cv, tx - ts / 2, this.trail[i * 2 + 1] - ts / 2, ts, ts);
        }
      }
      if (b.y > -b.r * 1.5) {
        const pop = 1 + 0.16 * this.pop;
        const sz = size * pop;
        c.globalAlpha = alpha;
        c.save();
        c.translate(b.x, b.y);
        c.rotate(this.spinA);
        c.drawImage(this.sBall.cv, -sz / 2, -sz / 2, sz, sz);
        c.restore();
        c.drawImage(this.sGloss.cv, b.x - sz / 2, b.y - sz / 2, sz, sz);
      }
      c.globalAlpha = 1;
      // the ball is above the screen: a small arrow shows where it will come down
      if (b.y < this.topR) {
        const s = clamp(1 - (this.topR - b.y) / (1.6 * F.h), 0.45, 1);
        const d = this.sArrow.w * s;
        c.globalAlpha = 0.85;
        c.drawImage(this.sArrow.cv, clamp(b.x, 18, w - 18) - d / 2, this.topR + 8, d, d);
        c.globalAlpha = 1;
      }
    }

    // hand markers: small, calm
    for (let i = 0; i < 2; i++) {
      const m = this.hands[i];
      if (!m.on) continue;
      const pu = this.pulse[i];
      const d = this.sMark.w * (1 + 0.5 * pu);
      c.globalAlpha = 0.9;
      c.drawImage(this.sMark.cv, m.x - d / 2, m.y - d / 2, d, d);
      if (pu > 0) {
        c.globalAlpha = pu;
        c.drawImage(this.sHot.cv, m.x - d / 2, m.y - d / 2, d, d);
      }
    }
    c.globalAlpha = 1;

    if (this.flash > 0) {
      c.globalAlpha = this.flash * 0.4;
      c.fillStyle = "#ff2a2a";
      c.fillRect(0, 0, w, F.h);
      c.globalAlpha = 1;
      this.flash = Math.max(0, this.flash - dt * 1.5);
    }
    if (this.time < 5 && this.e.state === "play") {
      c.globalAlpha = clamp(5 - this.time, 0, 1);
      c.drawImage(this.sHint.cv, (w - this.sHint.w) / 2, F.floor - (F.floor - this.topR) * 0.3, this.sHint.w, this.sHint.h);
      c.globalAlpha = 1;
    }
  }
}
