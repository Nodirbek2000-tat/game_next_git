import { clamp, TAU, type EngineApi } from "@/engine";
import { bottomLift } from "@/engine/ui/safe";
import * as art from "./art";
import {
  bodyX, difficulty, doubleChance, EV_GOAL, EV_KICK, EV_SAVE, flightTime, footPoint, FLYING, GOAL, handPoint, newSm, pickX, pickY,
  SAVED, shotGap, Shots, smUpdate, WINDUP, type Shot, type XY,
} from "./logic";

const MAX_GOALS = 5;
const LIVES: string[] = [];
for (let i = 0; i <= MAX_GOALS; i++) LIVES.push("⚽".repeat(i));
const COMBO: string[] = [];
const comboText = (n: number): string => COMBO[n] ?? (COMBO[n] = `${n} ketma-ket`);
const rand = (): number => Math.random();

/** screen layout, recomputed when the stage size changes */
interface Layout {
  w: number;
  h: number;
  topR: number;
  barY: number;
  floorY: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  rMax: number;
  gMax: number;
  fMax: number;
  stkH: number;
  stkY: number;
}

/**
 * Darvozabon: the goal is as wide as the screen. A striker far away kicks balls that grow with perspective and land anywhere in
 * the goal, also at the very edges, so the keeper has to step sideways. A golden marker on the goal line shows where the next ball
 * goes. Gloves (smoothed hand points) stop the balls, boots (feet) the low ones. Five goals or the time ends the game.
 */
export class DarvozabonGame {
  private readonly shots = new Shots(4);
  private readonly hands = [newSm(), newSm()];
  private readonly feet = [newSm(), newSm()];
  private readonly body = newSm();
  private readonly tmp: XY = { x: 0, y: 0 };
  private readonly bx = new Float32Array(4);
  private readonly by = new Float32Array(4);
  private readonly br = new Float32Array(4);
  private readonly bf = new Uint8Array(4);
  private readonly bid = new Uint8Array(4);
  /** save pulse of hands 0,1 and feet 2,3 */
  private readonly pulse = [0, 0, 0, 0];
  private readonly roundSec: number;
  private lay: Layout = { w: 0, h: 0, topR: 0, barY: 0, floorY: 0, xMin: 0, xMax: 0, yMin: 0, yMax: 0, rMax: 40, gMax: 30, fMax: 16, stkH: 50, stkY: 0 };
  private sBall!: art.Sprite;
  private sGlove!: art.Sprite;
  private sBoot!: art.Sprite;
  private sMark!: art.Sprite;
  private sStk0!: art.Sprite;
  private sStk1!: art.Sprite;
  private sBar!: art.Sprite;
  private sPost!: art.Sprite;
  private sHint!: art.Sprite;
  private last = 0;
  private time = 0;
  private fired = 0;
  private nextAt = 1.6;
  private dblAt = Infinity;
  private prevX = -1e9;
  private goals = 0;
  private saved = 0;
  private streak = 0;
  private best = 0;
  private score = 0;
  private hudT = 0;
  private over = false;
  private flash = 0;
  private kickT = 0;
  private stkX = 0;

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    this.roundSec = d > 0 ? d : 75;
    this.layout();
    this.hud();
  }

  /** the engine calls this every frame (also while paused: then nothing moves) */
  draw(c: CanvasRenderingContext2D, now: number): void {
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    const st = this.e.stage;
    if (st.w !== this.lay.w || st.h !== this.lay.h) this.layout();
    if (this.e.state === "play" && !this.over) this.update(dt);
    this.render(c, dt);
  }

  // ------------------------------------------------------------------ layout and static art

  private layout(): void {
    const { w, h, dpr } = this.e.stage;
    const L = this.lay;
    const k = clamp(dpr || 1, 1, 2);
    L.w = w;
    L.h = h;
    L.topR = h > w ? 78 : 86;
    L.barY = L.topR + 6;
    L.floorY = h - Math.max(18, bottomLift(w, h) + 6);
    L.rMax = clamp(Math.min(h * 0.095, w * 0.14), 28, 76);
    L.gMax = clamp(h * 0.07, 24, 56);
    L.fMax = clamp(h * 0.04, 14, 30);
    L.xMin = L.rMax + 8;
    L.xMax = w - L.rMax - 8;
    L.yMin = L.barY + 16 + L.rMax * 0.8;
    L.yMax = L.floorY - L.rMax - 4;
    L.stkH = clamp(h * 0.1, 40, 78);
    L.stkY = L.barY + (L.floorY - L.barY) * 0.4;
    const bar = 7;
    const netH = clamp(h * 0.06, 26, 48);
    const sideW = clamp(w * 0.05, 16, 44);
    this.sBall = art.soccerBall(L.rMax, k);
    this.sGlove = art.glove(L.gMax, k);
    this.sBoot = art.boot(L.fMax, k);
    this.sMark = art.marker(L.rMax * 2.6, k);
    this.sStk0 = art.striker(L.stkH, 0, k);
    this.sStk1 = art.striker(L.stkH, 1, k);
    this.sBar = art.crossbar(w, bar, netH, k);
    this.sPost = art.post(sideW, L.floorY - L.barY, bar, k);
    this.sHint = art.textSprite(["Yon tomonga yuring!", "To‘pni qo‘l bilan to‘xtating,", "past to‘plarni oyoq bilan"], clamp(w * 0.045, 16, 26), "#ffffff", w - 24, k);
    if (!this.stkX) this.stkX = w / 2;
  }

  // ------------------------------------------------------------------ game logic

  private update(dt: number): void {
    const e = this.e;
    const L = this.lay;
    const p = e.players[0];
    const lm = p.lm;
    const sc = p.scale > 20 ? p.scale : 60;
    const pr = p.present;
    const tmp = this.tmp;
    for (let i = 0; i < 2; i++) {
      const okH = pr && handPoint(lm, i === 0, tmp);
      smUpdate(this.hands[i], okH, tmp.x, tmp.y, dt, sc);
      const okF = pr && footPoint(lm, i === 0, tmp);
      smUpdate(this.feet[i], okF, tmp.x, tmp.y, dt, sc);
    }
    smUpdate(this.body, pr, bodyX(lm, p.center.x), p.center.y, dt, sc, 0.15, 0.2, 0.08);
    const gr = clamp(sc * 0.4, 20, 52);
    const fr = clamp(sc * 0.24, 12, 28);
    let n = 0;
    for (let i = 0; i < 2; i++) {
      const s = this.hands[i];
      if (s.on) {
        this.bx[n] = s.x;
        this.by[n] = s.y;
        this.br[n] = gr * 1.05;
        this.bf[n] = 0;
        this.bid[n++] = i;
      }
    }
    for (let i = 0; i < 2; i++) {
      const s = this.feet[i];
      if (s.on) {
        this.bx[n] = s.x;
        this.by[n] = s.y;
        this.br[n] = fr * 1.15;
        this.bf[n] = 1;
        this.bid[n++] = 2 + i;
      }
    }
    for (let i = 0; i < 4; i++) this.pulse[i] = Math.max(0, this.pulse[i] - dt * 4);
    this.kickT = Math.max(0, this.kickT - dt);

    this.time += dt;
    if (pr) {
      if (this.time >= this.nextAt) this.fire(false, sc, gr);
      else if (this.time >= this.dblAt) this.fire(true, sc, gr);
    }

    this.shots.nEv = 0;
    this.shots.update(dt, this.bx, this.by, this.br, this.bf, n, L.rMax);
    for (let i = 0; i < this.shots.nEv; i++) {
      const ev = this.shots.ev[i];
      if (ev.type === EV_KICK) {
        this.kickT = 0.3;
        e.audio.tone(170, 70, 0.12, "triangle", 0.3);
      } else if (ev.type === EV_SAVE) this.onSave(ev.x, ev.y, ev.r, ev.foot, this.bid[ev.who]);
      else if (ev.type === EV_GOAL) this.onGoal(ev.x, ev.y, ev.r);
    }
    this.hudT -= dt;
    if (this.hudT <= 0) this.hud();
    if (this.goals >= MAX_GOALS || this.time >= this.roundSec) {
      this.over = true;
      e.finish({ score: this.score, lines: [["Qaytarilgan to‘plar", this.saved], ["O‘tkazilgan gollar", this.goals], ["Eng uzun seriya", this.best]] });
    }
  }

  /** a new shot (and maybe a quick second one) aimed relative to where the keeper stands */
  private fire(second: boolean, sc: number, gr: number): void {
    const e = this.e;
    const L = this.lay;
    const lm = e.players[0].lm;
    const diff = difficulty(this.fired);
    const px = this.body.on ? this.body.x : e.players[0].center.x;
    const reach = clamp(2.0 * sc + gr, 60, L.w * 0.4);
    // a second ball is aimed away from where the first one goes
    const tx = pickX(rand, second ? this.prevX : px, reach, L.xMin, L.xMax, diff, this.prevX);
    const nose = lm[0].y;
    const shoulder = lm[11].v > 0.3 && lm[12].v > 0.3 ? (lm[11].y + lm[12].y) / 2 : nose + 1.2 * sc;
    const hip = lm[23].v > 0.3 && lm[24].v > 0.3 ? (lm[23].y + lm[24].y) / 2 : shoulder + 1.6 * sc;
    const lowOk = lm[27].v > 0.3 || lm[28].v > 0.3;
    const ankle = lowOk ? Math.max(lm[27].v > 0.3 ? lm[27].y : 0, lm[28].v > 0.3 ? lm[28].y : 0) : hip + 1.7 * sc;
    const ty = pickY(rand, nose, shoulder, hip, ankle, lowOk, L.yMin, L.yMax);
    const sx = clamp(L.w * 0.5 + (tx - L.w * 0.5) * 0.55 + (rand() - 0.5) * L.w * 0.06, L.w * 0.14, L.w * 0.86);
    const ox = sx + L.stkH * 0.12;
    const oy = L.stkY - L.stkH * 0.08;
    let curve = (rand() < 0.5 ? -1 : 1) * (0.03 + rand() * 0.06) * L.w;
    const mid = (ox + tx) / 2;
    curve = clamp(curve, 10 - mid, L.w - 10 - mid);
    const lob = rand() < 0.35 ? (0.03 + rand() * 0.04) * L.h : 0;
    // far edges give the keeper a little more time to get there
    const far = Math.abs(tx - px) > reach * 2.4 ? 0.2 : 0;
    const wind = 0.55 - 0.15 * diff + far;
    const dur = flightTime(diff) * (0.94 + rand() * 0.12);
    const s = this.shots.spawn(ox, oy, tx, ty, dur, wind, curve, lob);
    if (!s) {
      this.nextAt = this.time + 0.4;
      return;
    }
    this.stkX = sx;
    this.prevX = tx;
    this.fired++;
    e.audio.tone(880, 880, 0.05, "sine", 0.1);
    if (second) {
      this.dblAt = Infinity;
      this.nextAt = Math.max(this.nextAt, this.time + shotGap(difficulty(this.fired)) + 0.4);
    } else {
      this.nextAt = this.time + shotGap(difficulty(this.fired));
      this.dblAt = rand() < doubleChance(this.fired, difficulty(this.fired)) ? this.time + 0.75 : Infinity;
    }
  }

  private onSave(x: number, y: number, r: number, foot: boolean, who: number): void {
    const e = this.e;
    const L = this.lay;
    this.saved++;
    this.streak++;
    this.best = Math.max(this.best, this.streak);
    const add = 10 + Math.min(this.streak, 10) * 2 + (foot ? 5 : 0);
    this.score += add;
    this.pulse[who] = 1;
    e.audio.tone(300, 110, 0.1, "triangle", 0.32);
    e.audio.good();
    e.fx.burst(x, y, 9, "#ffffff", [2, 6], [2, 4], [0.25, 0.5], false, 0.12);
    e.fx.ring(x, y, r * 0.6, "255,255,255", 0.4, 5);
    const label = foot ? "Oyoq bilan! +" : "Qaytardi! +";
    e.fx.popup(label + add, clamp(x, 80, L.w - 80), clamp(y - r - 26, L.topR + 24, L.h), "#7dffa0", 28);
    if (this.streak > 0 && this.streak % 5 === 0) {
      e.audio.combo(this.streak);
      e.fx.popup(comboText(this.streak) + "!", L.w / 2, L.topR + 60, "#ffe066", 34);
    }
    this.hud();
  }

  private onGoal(x: number, y: number, r: number): void {
    const e = this.e;
    const L = this.lay;
    this.goals++;
    this.streak = 0;
    this.flash = 0.4;
    e.audio.bad();
    e.audio.boom();
    e.fx.shake(14, 0.4);
    e.fx.ring(x, y, r * 0.8, "255,255,255", 0.6, 5);
    e.fx.ring(x, y, r * 0.5, "255,120,120", 0.8, 4);
    e.fx.popup("GOL!", clamp(x, 80, L.w - 80), clamp(y - r - 30, L.topR + 30, L.h), "#ff6b6b", 50, 1.1);
    this.hud();
  }

  private hud(): void {
    this.hudT = 0.5;
    this.e.hud.set({
      title: "Darvozabon",
      score: this.score,
      combo: this.streak > 2 ? comboText(this.streak) : null,
      lives: LIVES[Math.max(0, MAX_GOALS - this.goals)],
      time: Math.max(0, Math.ceil(this.roundSec - this.time)),
      timeLabel: "Vaqt",
    });
  }

  // ------------------------------------------------------------------ drawing (sprites only, no allocation)

  private ball(c: CanvasRenderingContext2D, s: Shot, rMax: number): void {
    if (s.r < 1) return;
    const size = this.sBall.w * (s.r / rMax);
    let a = 1;
    let y = s.y;
    if (s.state === SAVED) a = clamp(s.hold / s.holdTotal, 0, 1);
    else if (s.state === GOAL) {
      a = clamp(s.hold / 0.3, 0, 1);
      const sag = 1 - clamp(s.hold / s.holdTotal, 0, 1);
      y += Math.min(1, sag * 3) * s.r * 0.35;
    } else if (s.state === FLYING && s.k > 0.35) {
      // a faint copy where the ball was a moment ago: speed
      c.globalAlpha = 0.28;
      const sz = size * 0.94;
      c.drawImage(this.sBall.cv, s.px - sz / 2, s.py - sz / 2, sz, sz);
    }
    c.globalAlpha = a;
    c.save();
    c.translate(s.x, y);
    c.rotate(s.spin);
    c.drawImage(this.sBall.cv, -size / 2, -size / 2, size, size);
    c.restore();
    c.globalAlpha = 1;
  }

  private render(c: CanvasRenderingContext2D, dt: number): void {
    const L = this.lay;
    const w = L.w;
    // goal frame: crossbar and the two posts with a strip of net, and the goal line
    c.drawImage(this.sBar.cv, 0, L.barY, w, this.sBar.h);
    c.drawImage(this.sPost.cv, 0, L.barY, this.sPost.w, this.sPost.h);
    c.save();
    c.translate(w, 0);
    c.scale(-1, 1);
    c.drawImage(this.sPost.cv, 0, L.barY, this.sPost.w, this.sPost.h);
    c.restore();
    c.globalAlpha = 0.3;
    c.fillStyle = "#ffffff";
    c.fillRect(0, L.floorY, w, 3);
    c.globalAlpha = 1;

    // the striker far away
    const kick = this.kickT > 0;
    const stk = kick ? this.sStk1 : this.sStk0;
    c.drawImage(stk.cv, this.stkX - stk.w * 0.45, L.stkY - stk.h, stk.w, stk.h);

    // target markers: on the goal line and where the ball will land
    c.strokeStyle = "#ffd23d";
    c.lineWidth = 3;
    for (let i = 0; i < this.shots.pool.length; i++) {
      const s = this.shots.pool[i];
      if (!s.active || s.state > FLYING) continue;
      const prog = s.state === WINDUP ? 0.5 * (1 - s.wind / s.windTotal) : 0.5 + 0.5 * s.k;
      c.globalAlpha = 0.25 + 0.7 * prog;
      const mw = L.rMax * (1.1 + 1.5 * prog);
      c.drawImage(this.sMark.cv, s.tx - mw / 2, L.floorY - mw * 0.25 - 1, mw, mw * 0.5);
      const rr = L.rMax * (1 + 0.55 * (1 - prog) * (1 - prog) * 2);
      c.beginPath();
      c.arc(s.tx, s.ty, rr, 0, TAU);
      c.moveTo(s.tx - rr * 0.5, s.ty);
      c.lineTo(s.tx + rr * 0.5, s.ty);
      c.moveTo(s.tx, s.ty - rr * 0.5);
      c.lineTo(s.tx, s.ty + rr * 0.5);
      c.stroke();
    }
    c.globalAlpha = 1;

    // balls: far ones first
    for (let i = 0; i < this.shots.pool.length; i++) {
      const s = this.shots.pool[i];
      if (s.active && s.k < 0.5 && s.state !== GOAL) this.ball(c, s, L.rMax);
    }
    for (let i = 0; i < this.shots.pool.length; i++) {
      const s = this.shots.pool[i];
      if (s.active && (s.k >= 0.5 || s.state === GOAL)) this.ball(c, s, L.rMax);
    }

    // gloves and boots (smoothed points)
    const p = this.e.players[0];
    const sc = p.scale > 20 ? p.scale : 60;
    const gr = clamp(sc * 0.4, 20, 52);
    const fr = clamp(sc * 0.24, 12, 28);
    for (let i = 0; i < 2; i++) {
      const s = this.feet[i];
      if (!s.on) continue;
      const d = this.sBoot.w * (fr / this.lay.fMax) * (1 + 0.35 * this.pulse[2 + i]);
      c.globalAlpha = 0.85;
      c.drawImage(this.sBoot.cv, s.x - d / 2, s.y - d / 2, d, d);
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 2; i++) {
      const s = this.hands[i];
      if (!s.on) continue;
      const d = this.sGlove.w * (gr / this.lay.gMax) * (1 + 0.3 * this.pulse[i]);
      c.drawImage(this.sGlove.cv, s.x - d / 2, s.y - d / 2, d, d);
    }

    if (this.flash > 0) {
      c.globalAlpha = this.flash * 0.45;
      c.fillStyle = "#ff2a2a";
      c.fillRect(0, 0, w, L.h);
      c.globalAlpha = 1;
      this.flash = Math.max(0, this.flash - dt * 1.5);
    }
    if (this.time < 5 && this.e.state === "play") {
      c.globalAlpha = clamp((5 - this.time) / 1, 0, 1);
      c.drawImage(this.sHint.cv, (w - this.sHint.w) / 2, L.floorY - (L.floorY - L.barY) * 0.3, this.sHint.w, this.sHint.h);
      c.globalAlpha = 1;
    }
  }
}
