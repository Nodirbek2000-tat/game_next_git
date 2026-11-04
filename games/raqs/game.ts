// Raqs: pose cards scroll in from the right; when a card reaches the line, strike the pose. Perfect / Good / Miss with a combo.

import type { EngineApi } from "@/engine/types";
import {
  GRADE_MISS, GRADE_PERFECT, MAX_CARDS, POSE_ARMS, POSE_KNEE, POSE_NAMES, POSE_SQUAT,
  RaqsLogic, cardX, extract, makeFeat, poseMatch, type Card,
} from "./logic";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const COLORS = ["#ff7a59", "#3fb8ff", "#b46cff", "#ffcb3d", "#35d49a", "#ff5fa2", "#7fd13b", "#ff9b3d"] as const;
const NAME_LINES: readonly (readonly string[])[] = POSE_NAMES.map((n) => n.split(" "));
const GRADE_TEXT = ["Xato", "Yaxshi", "A’lo!"] as const;
const GRADE_COL = ["#ff7a7a", "#ffe45a", "#7dffb0"] as const;

export class RaqsGame {
  readonly logic: RaqsLogic;
  private readonly feat = makeFeat();
  private readonly ticked = new Float64Array(MAX_CARDS).fill(-1);
  private last = 0;
  private done = false;
  private hudT = 0;
  private lineX = 80;
  private laneY = 190;
  private cardH = 130;
  private pulse = 0;

  constructor(private readonly e: EngineApi) {
    const q = Number(e.query.get("duration"));
    const dur = q > 0 ? q : 60;
    this.logic = new RaqsLogic(dur, Math.random, {
      judge: (_c: Card, grade: number, pts: number, combo: number) => {
        const x = this.lineX;
        const y = this.laneY + this.cardH * 0.75;
        if (grade === GRADE_MISS) e.audio.bad();
        else {
          e.audio.good();
          if (combo > 2 && combo % 5 === 0) e.audio.combo(combo);
          e.fx.burst(x, this.laneY, grade === GRADE_PERFECT ? 20 : 10, grade === GRADE_PERFECT ? "#7dffb0" : "#ffe45a", [100, 360], [3, 7], [0.3, 0.6], true);
          this.pulse = 0.4;
        }
        e.fx.popup(grade === GRADE_MISS ? GRADE_TEXT[0] : `${GRADE_TEXT[grade]} +${pts}`, x + 40, y, GRADE_COL[grade], 38, 0.9);
      },
    });
    e.hud.set({ title: "Raqs", score: 0, time: dur, bar: 1, combo: null, lives: null });
  }

  frame(c: CanvasRenderingContext2D, now: number): void {
    const e = this.e;
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    const w = e.stage.w;
    const h = e.stage.h;
    this.cardH = Math.max(100, Math.min(170, Math.min(w, h) * 0.34));
    this.lineX = Math.max(this.cardH * 0.7, w * 0.2);
    this.laneY = Math.max(120, h * 0.2);
    const L = this.logic;
    const p = e.players[0];
    if (this.pulse > 0) this.pulse -= dt;
    extract(p.lm, this.feat);
    if (!p.present) this.feat.ok = false;
    if (e.state === "play" && !this.done) {
      L.update(dt, this.feat);
      for (let i = 0; i < L.cards.length; i++) {
        const cd = L.cards[i];
        if (cd.on && L.time >= cd.hit && this.ticked[i] !== cd.hit) {
          this.ticked[i] = cd.hit;
          e.audio.tone(330, 300, 0.07, "triangle", 0.12);
        }
      }
      this.hudT -= dt;
      if (this.hudT <= 0) {
        this.hudT = 0.1;
        e.hud.set({
          score: L.score,
          time: Math.max(0, Math.ceil(L.duration - L.time)),
          bar: Math.max(0, 1 - L.time / L.duration),
          combo: L.combo > 1 ? `×${L.combo}` : null,
        });
      }
      if (L.over) this.end();
    }
    this.draw(c, w);
  }

  private end(): void {
    const L = this.logic;
    this.done = true;
    this.e.finish({
      score: L.score,
      lines: [
        ["A’lo", L.perfects],
        ["Yaxshi", L.goods],
        ["Xato", L.misses],
        ["Eng uzun kombo", L.bestCombo],
      ],
    });
  }

  private draw(c: CanvasRenderingContext2D, w: number): void {
    const L = this.logic;
    const ch = this.cardH;
    const cw = ch * 0.9;
    const ly = this.laneY;
    const lx = this.lineX;
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    // lane
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.fillRect(0, ly - ch * 0.62, w, ch * 1.24);
    // hit frame
    const glow = this.pulse > 0 ? this.pulse / 0.4 : 0;
    c.strokeStyle = glow > 0 ? `rgba(125,255,176,${0.6 + 0.4 * glow})` : "rgba(255,255,255,0.8)";
    c.lineWidth = 4 + glow * 4;
    c.setLineDash([10, 8]);
    this.roundRect(c, lx - cw * 0.58, ly - ch * 0.58, cw * 1.16, ch * 1.16, 18);
    c.stroke();
    c.setLineDash([]);
    // cards
    let cur: Card | null = null;
    for (let i = 0; i < L.cards.length; i++) {
      const cd = L.cards[i];
      if (!cd.on) continue;
      const x = cardX(cd.hit, L.time, lx, w + cw);
      if (x > w + cw || x < -cw) continue;
      if (!cd.judged && (!cur || cd.hit < cur.hit)) cur = cd;
      this.drawCard(c, cd, x, ly + (cd.judged ? -16 * Math.min(1, (L.time - cd.hit) * 3) : 0), cw, ch);
    }
    // live feedback: does my pose match the nearest card?
    if (cur && Math.abs(L.time - cur.hit) < 0.6) {
      const ok = poseMatch(cur.pose, this.feat);
      c.fillStyle = ok ? "rgba(125,255,176,0.95)" : "rgba(255,255,255,0.55)";
      c.font = "bold 22px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(ok ? "✔" : "…", lx, ly + ch * 0.72);
    }
    if (L.time < 5.5 && !this.done) {
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.font = "bold 22px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("Kartochka chiziqqa yetganda shu pozani oling", w / 2, ly + ch * 0.95);
    }
    c.restore();
  }

  private roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  private drawCard(c: CanvasRenderingContext2D, cd: Card, x: number, y: number, cw: number, ch: number): void {
    const col = COLORS[cd.pose % COLORS.length];
    c.globalAlpha = cd.judged ? Math.max(0.15, 1 - (this.logic.time - cd.hit) * 1.6) : 1;
    this.roundRect(c, x - cw / 2, y - ch / 2, cw, ch, 16);
    c.fillStyle = cd.judged ? (cd.grade === GRADE_MISS ? "#7a2a2a" : "#1f7a4d") : "rgba(18,22,40,0.88)";
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 4;
    c.stroke();
    this.drawFigure(c, cd.pose, x, y - ch * 0.1, ch * 0.62, col);
    const lines = NAME_LINES[cd.pose];
    c.fillStyle = "#fff";
    c.font = `bold ${Math.round(cw * 0.14)}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let i = 0; i < lines.length; i++) c.fillText(lines[i], x, y + ch * 0.33 + (i - (lines.length - 1) / 2) * cw * 0.15);
    c.globalAlpha = 1;
  }

  /** a stick figure of the pose (arms from the recipe); the figure's left arm is drawn on the screen's left, like the mirrored camera */
  private drawFigure(c: CanvasRenderingContext2D, pose: number, cx: number, cy: number, s: number, col: string): void {
    const neckY = cy - s * 0.22;
    const hipY = cy + s * (pose === POSE_SQUAT ? 0.2 : 0.12);
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = Math.max(4, s * 0.07);
    c.beginPath();
    c.arc(cx, cy - s * 0.34, s * 0.09, 0, TAU);
    c.fill();
    c.beginPath();
    c.moveTo(cx, neckY);
    c.lineTo(cx, hipY);
    // arms
    const arm = POSE_ARMS[pose];
    const seg = s * 0.17;
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? -1 : 1;
      const sx = cx + sg * s * 0.05;
      const a1 = arm[side * 2] * DEG;
      const a2 = arm[side * 2 + 1] * DEG;
      const ex = sx + sg * Math.sin(a1) * seg;
      const ey = neckY + s * 0.02 + Math.cos(a1) * seg;
      c.moveTo(sx, neckY + s * 0.02);
      c.lineTo(ex, ey);
      c.lineTo(ex + sg * Math.sin(a2) * seg, ey + Math.cos(a2) * seg);
    }
    // legs
    const fy = cy + s * 0.42;
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? -1 : 1;
      c.moveTo(cx, hipY);
      if (pose === POSE_SQUAT) {
        c.lineTo(cx + sg * s * 0.2, cy + s * 0.28);
        c.lineTo(cx + sg * s * 0.14, fy);
      } else if (pose === POSE_KNEE && side === 1) {
        c.lineTo(cx + sg * s * 0.17, cy + s * 0.15);
        c.lineTo(cx + sg * s * 0.1, cy + s * 0.32);
      } else {
        c.lineTo(cx + sg * s * 0.1, fy);
      }
    }
    c.stroke();
  }

  dispose(): void {
    this.done = true;
  }
}

