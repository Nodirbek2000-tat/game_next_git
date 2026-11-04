// Tez teg: glowing targets around the body, touch them with a hand (or a knee for the low ones) before they vanish.

import type { EngineApi } from "@/engine/types";
import { TegLogic, bodyFrame, isKneeZone, makeBody, makeTouchers, type Target } from "./logic";

const TAU = Math.PI * 2;

export class TezTegGame {
  readonly logic: TegLogic;
  private readonly body = makeBody();
  private readonly tc = makeTouchers();
  private last = 0;
  private done = false;
  private hudT = 0;

  constructor(private readonly e: EngineApi) {
    const q = Number(e.query.get("duration"));
    const dur = q > 0 ? q : 60;
    this.logic = new TegLogic(dur, Math.random, {
      spawn: () => e.audio.beep(true),
      hit: (t: Target, pts: number, ms: number, combo: number) => {
        e.audio.good();
        if (combo > 2 && combo % 5 === 0) e.audio.combo(combo);
        e.fx.burst(t.x, t.y, 14, "#ffe45a", [120, 380], [3, 7], [0.3, 0.6], true);
        e.fx.popup(`+${pts}`, t.x, t.y - t.r, ms < 600 ? "#7dffb0" : "#ffe45a", 36, 0.7);
      },
      miss: (t: Target) => {
        e.audio.bad();
        e.fx.popup("O‘tkazdingiz", t.x, t.y, "#ff7a7a", 28, 0.7);
      },
    });
    e.hud.set({ title: "Tez teg", score: 0, time: dur, bar: 1, combo: null, lives: null });
  }

  /** hand = pose index finger (blade) when tracked, else the wrist */
  private readTouchers(): boolean {
    const p = this.e.players[0];
    if (!p.present) return false;
    const tc = this.tc;
    for (let i = 0; i < 2; i++) {
      const b = p.blades[i];
      const wr = p.lm[15 + i];
      if (b.active) {
        tc.hx[i] = b.x;
        tc.hy[i] = b.y;
        tc.hok[i] = true;
      } else {
        tc.hx[i] = wr.x;
        tc.hy[i] = wr.y;
        tc.hok[i] = wr.v > 0.3;
      }
      const kn = p.lm[25 + i];
      tc.kx[i] = kn.x;
      tc.ky[i] = kn.y;
      tc.kok[i] = kn.v > 0.35;
    }
    return true;
  }

  frame(c: CanvasRenderingContext2D, now: number): void {
    const e = this.e;
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    const L = this.logic;
    const p = e.players[0];
    const haveTc = this.readTouchers();
    if (e.state === "play" && !this.done) {
      const body = p.present && bodyFrame(p.lm, this.body) ? this.body : null;
      L.update(dt, e.stage.w, e.stage.h, body, haveTc ? this.tc : null);
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
    this.draw(c, now, haveTc);
  }

  private end(): void {
    const L = this.logic;
    this.done = true;
    this.e.finish({
      score: L.score,
      lines: [
        ["Tegilgan nishonlar", L.hits],
        ["O‘tkazib yuborilgan", L.misses],
        ["O‘rtacha reaksiya", L.hits ? `${L.avgMs} ms` : "—"],
        ["Eng uzun kombo", L.bestCombo],
      ],
    });
  }

  private draw(c: CanvasRenderingContext2D, now: number, haveTc: boolean): void {
    const L = this.logic;
    c.save();
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let i = 0; i < L.targets.length; i++) {
      const t = L.targets[i];
      if (t.done > 0 && !t.on) {
        const k = 1 - t.done / 0.35;
        c.strokeStyle = `rgba(255,240,120,${1 - k})`;
        c.lineWidth = 6;
        c.beginPath();
        c.arc(t.x, t.y, t.r * (1 + k * 0.8), 0, TAU);
        c.stroke();
        continue;
      }
      if (!t.on) continue;
      const left = 1 - t.age / t.life;
      const knee = isKneeZone(t.zone);
      const pop = Math.min(1, t.age / 0.12);
      const r = t.r * (0.6 + 0.4 * pop) * (1 + 0.05 * Math.sin(now / 90));
      // glow + disc
      c.fillStyle = knee ? "rgba(90,200,255,0.30)" : "rgba(255,200,60,0.30)";
      c.beginPath();
      c.arc(t.x, t.y, r * 1.35, 0, TAU);
      c.fill();
      c.fillStyle = knee ? "rgba(40,130,255,0.85)" : "rgba(255,150,30,0.88)";
      c.beginPath();
      c.arc(t.x, t.y, r, 0, TAU);
      c.fill();
      c.strokeStyle = "#fff";
      c.lineWidth = 3;
      c.stroke();
      // the time ring shrinks to the end
      c.strokeStyle = left < 0.35 ? "#ff4a4a" : "#ffffff";
      c.lineWidth = 6;
      c.beginPath();
      c.arc(t.x, t.y, r * 1.18, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, left));
      c.stroke();
      c.font = `${Math.round(r * 0.95)}px system-ui, sans-serif`;
      c.fillStyle = "#fff";
      c.fillText(knee ? "🦵" : "✋", t.x, t.y + 2);
    }
    // small markers on the touching points
    if (haveTc) {
      c.fillStyle = "rgba(255,255,255,0.85)";
      for (let i = 0; i < 2; i++) {
        if (this.tc.hok[i]) {
          c.beginPath();
          c.arc(this.tc.hx[i], this.tc.hy[i], 9, 0, TAU);
          c.fill();
        }
      }
      c.fillStyle = "rgba(120,200,255,0.8)";
      for (let i = 0; i < 2; i++) {
        if (this.tc.kok[i]) {
          c.beginPath();
          c.arc(this.tc.kx[i], this.tc.ky[i], 8, 0, TAU);
          c.fill();
        }
      }
    }
    c.restore();
  }

  dispose(): void {
    this.done = true;
  }
}
