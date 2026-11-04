import { clamp, drawRingProgress, drawSkeleton, drawText, TAU, type EngineApi } from "@/engine";
import { classify, JackCounter, STAGES, Workout, type Pose } from "./logic";

const BPM = 100;
const BEAT = 60 / BPM;

/** Yulduzcha mashqi: jumping jacks with a beat. Arms up + legs apart, then together = 1 rep. A target per 10 s stage. */
export class YulduzchaGame {
  private readonly pose: Pose = { up: false, down: false, apart: false, together: false, legs: false };
  private readonly jack = new JackCounter();
  private readonly work: Workout;
  private last = 0;
  private time = 0;
  private beatT = 0;
  private beatN = 0;
  private pulse = 0;
  private score = 0;
  private hudT = 0;
  private over = false;
  private flash = 0;
  private flashCol = "60,255,120";

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    // ?duration=N shortens the whole workout: N seconds over the 6 stages
    this.work = new Workout(d > 0 ? d / STAGES.length : 10);
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    if (this.e.state === "play" && !this.over) this.update(dt);
    this.render(c);
  }

  private update(dt: number): void {
    const e = this.e;
    const p = e.players[0];
    this.time += dt;
    this.beatT += dt;
    if (this.beatT >= BEAT) {
      this.beatT -= BEAT;
      this.beatN++;
      this.pulse = 1;
      e.audio.beep(this.beatN % 2 === 0);
    }
    this.pulse = Math.max(0, this.pulse - dt * 4);
    let rep = false;
    if (p.present) {
      classify(p.lm, p.scale, e.stage.h, this.pose);
      if (e.keys.has("ArrowUp")) {
        this.pose.up = true;
        this.pose.apart = true;
        this.pose.down = false;
        this.pose.together = false;
        this.pose.legs = true;
      } else if (e.keys.has("ArrowDown")) {
        this.pose.up = false;
        this.pose.apart = false;
        this.pose.down = true;
        this.pose.together = true;
        this.pose.legs = true;
      }
      rep = this.jack.update(dt, this.pose);
    }
    const st = e.stage;
    if (rep) {
      this.score += 10;
      e.audio.coin();
      e.fx.popup("+10", st.w / 2 + (Math.random() - 0.5) * 80, st.h * 0.4, "#ffe066", 34);
    }
    const ev = this.work.update(dt, rep);
    if (ev === 1) {
      this.score += 50;
      this.flash = 0.35;
      this.flashCol = "60,255,120";
      e.audio.win();
      e.fx.popup("Bajarildi! +50", st.w / 2, st.h * 0.3, "#7dffa0", 40);
      e.fx.burst(st.w / 2, st.h * 0.3, 24, "#ffe066", [100, 320], [3, 7], [0.4, 0.9]);
    } else if (ev === 2) {
      this.flash = 0.3;
      this.flashCol = "255,140,40";
      e.audio.bad();
      e.fx.popup("Yetmadi", st.w / 2, st.h * 0.3, "#ffb36b", 36);
    }
    this.hudT -= dt;
    if (this.hudT <= 0 || rep || ev) {
      this.hudT = 0.1;
      e.hud.set({
        title: `Yulduzcha ${Math.min(this.work.stage + 1, STAGES.length)}/${STAGES.length}`,
        score: this.score,
        combo: null,
        lives: null,
        time: Math.max(0, Math.ceil(this.work.left)),
        timeLabel: "Bosqich",
      });
    }
    if (this.work.done) {
      this.over = true;
      e.finish({ score: this.score, lines: [["Takrorlar", this.jack.reps], ["Bajarilgan bosqichlar", `${this.work.passed}/${STAGES.length}`]] });
    }
  }

  private render(c: CanvasRenderingContext2D): void {
    const e = this.e;
    const st = e.stage;
    const p = e.players[0];
    const w = this.work;
    if (this.flash > 0) {
      c.fillStyle = `rgba(${this.flashCol},${this.flash * 0.45})`;
      c.fillRect(0, 0, st.w, st.h);
      this.flash = Math.max(0, this.flash - 0.016);
    }
    if (p.present) drawSkeleton(c, p.lm, this.jack.open ? "rgba(255,224,102,.9)" : "rgba(120,230,255,.6)", 4, false);
    // beat star
    const cx = st.w / 2;
    const cy = st.h * 0.16;
    const open = this.beatN % 2 === 0;
    const R = clamp(st.w * 0.09, 28, 54) * (1 + this.pulse * 0.25);
    c.fillStyle = open ? "#ffe066" : "rgba(255,255,255,.55)";
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const r = i % 2 === 0 ? R : R * (open ? 0.55 : 0.8);
      if (i === 0) c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
    drawText(c, open ? "OCHIL!" : "YIG‘IL!", cx, cy + R + 22, clamp(st.w * 0.05, 18, 28), "#fff");
    // stage counter and timer ring
    const k = w.stageSec > 0 ? 1 - w.left / w.stageSec : 0;
    drawRingProgress(c, st.w - 52, 120, 30, clamp(k, 0, 1), w.count >= w.target ? "#7dffa0" : "#ffe066");
    drawText(c, `${Math.min(w.count, 99)} / ${w.target}`, st.w / 2, st.h * 0.36, clamp(st.w * 0.15, 48, 90), w.count >= w.target ? "#7dffa0" : "#fff");
    // stage dots
    for (let i = 0; i < STAGES.length; i++) {
      c.fillStyle = i < w.stage ? "#7dffa0" : i === w.stage ? "#ffe066" : "rgba(255,255,255,.35)";
      c.beginPath();
      c.arc(st.w / 2 + (i - (STAGES.length - 1) / 2) * 24, st.h - 28, 8, 0, TAU);
      c.fill();
    }
    if (this.time < 5) drawText(c, "Qo‘l tepaga + oyoq keng, keyin yig‘iling", st.w / 2, st.h * 0.5, clamp(st.w * 0.042, 15, 24), "#fff");
  }
}
