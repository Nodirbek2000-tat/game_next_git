import { clamp, drawRingProgress, drawSkeleton, drawText, TAU, type EngineApi } from "@/engine";
import { EXERCISES, isExerciseId } from "@/lib/fitness/exercises";
import { planFor, type PlanStep } from "@/lib/fitness/plan";
import { loadFitness, recordSession } from "@/lib/fitness/store";
import { Session } from "./session";

// Fitnes: a guided workout over the mirrored camera. Minimal screen: the exercise, one big number (reps or seconds), the calories,
// the body drawn green while the form is right / orange with one short correction when it is not.
//   /play/fitnes            today's plan (lib/fitness/plan.ts), at the user's level
//   /play/fitnes?ex=squat   one exercise, its default target (?n=20 changes it)
//   ?rest=5                 shorter rests (tests)

const GOOD = "rgba(70,230,140,.95)";
const BAD = "rgba(255,170,60,.95)";
const PRAISE = ["Zo‘r!", "Barakalla!", "Davom eting!", "Ajoyib!"];

export class FitnesGame {
  private readonly s: Session;
  private readonly single: boolean;
  private last = 0;
  private over = false;
  private flash = 0;
  private praise = "";
  private praiseT = 0;
  private lastPhase = "";

  constructor(private readonly e: EngineApi) {
    const data = loadFitness();
    const q = e.query;
    const ex = q.get("ex");
    let steps: PlanStep[];
    let rest: number;
    if (isExerciseId(ex)) {
      const n = Number(q.get("n"));
      steps = [{ ex, amount: n > 0 ? Math.min(500, Math.round(n)) : EXERCISES[ex].target }];
      rest = 0;
      this.single = true;
    } else {
      const p = planFor(new Date(), data.level);
      steps = p.steps;
      rest = p.rest;
      this.single = false;
    }
    const r = Number(q.get("rest"));
    if (r >= 0 && q.has("rest")) rest = r;
    this.s = new Session(steps, rest, data.weightKg);
    e.hud.show(false);
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    if (this.e.state === "play" && !this.over) this.update(dt);
    this.render(c, now);
  }

  private update(dt: number): void {
    const e = this.e;
    const s = this.s;
    const p = e.players[0];
    if (e.keys.has("Enter") || e.keys.has(" ")) s.skip();
    const before = s.phase;
    const beforeIndex = s.index;
    const reps = s.reps;
    const hit = s.update(dt, p.present ? p.lm : null, p.scale, e.stage.h);
    if (hit) {
      if (s.reps > reps) {
        e.audio.coin();
        this.flash = 0.25;
        if (Math.random() < 0.3) this.say(PRAISE[(Math.random() * PRAISE.length) | 0]);
      }
    }
    if (s.phase !== before || s.index !== beforeIndex) this.changed(before);
    if (s.phase === "done" && !this.over) this.end();
  }

  private changed(from: string): void {
    const e = this.e;
    const s = this.s;
    if (from === "work") {
      const r = s.results[s.results.length - 1];
      if (r?.done) {
        e.audio.win();
        this.say("Bajarildi!");
      }
    }
    if (s.phase === "intro") e.audio.beep(true);
    if (s.phase === "work") e.audio.beep(false);
  }

  private say(t: string): void {
    this.praise = t;
    this.praiseT = 1.2;
  }

  private end(): void {
    this.over = true;
    const s = this.s;
    const kcal = Math.round(s.kcal * 10) / 10;
    recordSession({ kcal: s.kcal, sec: s.workSec, reps: s.reps, planDone: !this.single && s.allDone });
    const lines: [string, string | number][] = [
      ["Kaloriya", `${kcal} kkal`],
      ["Mashq vaqti", fmtTime(s.workSec)],
      ["To‘g‘ri bajarildi", `${Math.round(s.accuracy * 100)}%`],
    ];
    for (const r of s.results) lines.push([`${r.ex.icon} ${r.ex.title}`, r.ex.kind === "hold" ? `${Math.round(r.held)} / ${r.amount} s` : `${r.reps} / ${r.amount}`]);
    this.e.finish({ score: Math.round(s.kcal), lines });
  }

  // --------------------------------------------------------------------------------------- drawing

  private render(c: CanvasRenderingContext2D, now: number): void {
    const e = this.e;
    const st = e.stage;
    const s = this.s;
    const p = e.players[0];
    const W = st.w;
    const H = st.h;
    const u = clamp(Math.min(W, H) / 100, 3.2, 9);
    const playing = e.state === "play";
    if (this.flash > 0) {
      c.fillStyle = `rgba(70,230,140,${this.flash * 0.35})`;
      c.fillRect(0, 0, W, H);
      this.flash = Math.max(0, this.flash - 0.02);
    }
    if (p.present && s.phase === "work") drawSkeleton(c, p.lm, s.reading.good ? GOOD : BAD, Math.max(3, u * 0.9), false);
    if (!playing) return;

    if (s.phase === "intro" || s.phase === "rest") {
      this.card(c, W, H, u);
      return;
    }
    // top: exercise + step, calories
    const ex = s.ex;
    pill(c, u * 3, u * 3, `${ex.icon}  ${ex.title}`, u * 3.4, "rgba(10,10,20,.55)", "#fff", "left");
    if (!this.single) drawText(c, `${s.index + 1} / ${s.steps.length}`, u * 3 + u * 2, u * 3 + u * 9.5, u * 2.4, "rgba(255,255,255,.8)", "left");
    pill(c, W - u * 3, u * 3, `🔥 ${s.kcal.toFixed(1)} kkal`, u * 3.4, "rgba(10,10,20,.55)", "#ffd27a", "right");

    // the big number: beside the person (who stands in the middle), on a portrait screen above them
    const R = u * 11;
    const cx = W > H ? Math.max(R + u * 4, W * 0.13) : W / 2;
    const cy = W > H ? H * 0.45 : u * 3 + u * 9.5 + R + u * 6;
    const k = clamp(s.progress / s.step.amount, 0, 1);
    c.fillStyle = "rgba(10,10,20,.5)";
    c.beginPath();
    c.arc(cx, cy, R + u * 1.4, 0, TAU);
    c.fill();
    drawRingProgress(c, cx, cy, R, k, s.reading.good ? "#46e68c" : "#ffaa3c");
    const big = ex.kind === "hold" ? `${Math.floor(s.progress)}` : `${s.progress}`;
    drawText(c, big, cx, cy - u * 0.5, u * 9, "#fff");
    drawText(c, ex.kind === "hold" ? `/ ${s.step.amount} s` : `/ ${s.step.amount}`, cx, cy + u * 5.5, u * 2.8, "rgba(255,255,255,.8)");

    // one line at the bottom: the correction, or praise
    this.praiseT = Math.max(0, this.praiseT - 1 / 60);
    const cue = s.reading.cue;
    if (cue) pill(c, W / 2, H - u * 12, cue, u * 3.2, "rgba(255,150,40,.92)", "#1a0d00", "center");
    else if (this.praiseT > 0) pill(c, W / 2, H - u * 12, this.praise, u * 3.6, "rgba(70,230,140,.92)", "#002410", "center");
    else if (s.progress === 0 && s.left > 0) wrap(c, ex.how, W / 2, H - u * 10, Math.min(W * 0.86, u * 120), u * 2.4, "rgba(255,255,255,.9)");

    // whole workout progress
    c.fillStyle = "rgba(255,255,255,.18)";
    c.fillRect(0, H - u * 0.9, W, u * 0.9);
    c.fillStyle = "#46e68c";
    c.fillRect(0, H - u * 0.9, W * s.overall, u * 0.9);
    void now;
  }

  /** the intro ("Keyingi: ...") and rest card */
  private card(c: CanvasRenderingContext2D, W: number, H: number, u: number): void {
    const s = this.s;
    const rest = s.phase === "rest";
    const step = rest ? s.next : s.step;
    if (!step) return;
    const ex = EXERCISES[step.ex];
    c.fillStyle = "rgba(8,8,18,.72)";
    c.fillRect(0, 0, W, H);
    const cx = W / 2;
    let y = H * 0.2;
    drawText(c, rest ? "Dam oling" : this.single ? "Tayyorlaning" : `${s.index + 1}-mashq / ${s.steps.length}`, cx, y, u * 3, rest ? "#7dd3fc" : "rgba(255,255,255,.75)");
    y += u * 13;
    drawText(c, ex.icon, cx, y, u * 12, "#fff");
    y += u * 9;
    drawText(c, ex.title, cx, y, u * 5.2, "#fff");
    y += u * 6;
    drawText(c, ex.kind === "hold" ? `${step.amount} soniya ushlab turing` : `${step.amount} marta`, cx, y, u * 3.2, "#46e68c");
    y += u * 5.5;
    wrap(c, ex.how, cx, y, Math.min(W * 0.86, u * 120), u * 2.5, "rgba(255,255,255,.85)");
    // countdown ring
    const total = rest ? s.rest : 4;
    const ry = H - u * 14;
    drawRingProgress(c, cx, ry, u * 6, clamp(1 - s.left / Math.max(0.1, total), 0, 1), rest ? "#7dd3fc" : "#46e68c");
    drawText(c, `${Math.max(0, Math.ceil(s.left))}`, cx, ry + u * 1.8, u * 5, "#fff");
    if (rest) drawText(c, `🔥 ${s.kcal.toFixed(1)} kkal`, cx, H - u * 4, u * 2.6, "#ffd27a");
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m} daq ${s} s` : `${s} s`;
}

/** text on a rounded pill; align = where (x, y) is: the left / right / centre of the pill's top */
function pill(c: CanvasRenderingContext2D, x: number, y: number, t: string, size: number, bg: string, fg: string, align: "left" | "right" | "center"): void {
  c.save();
  c.font = `800 ${size}px system-ui, sans-serif`;
  const w = c.measureText(t).width + size * 1.4;
  const h = size * 1.9;
  const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(x0, y, w, h, h / 2);
  c.fill();
  c.fillStyle = fg;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(t, x0 + w / 2, y + h / 2 + 1);
  c.restore();
}

/** centred text wrapped to `maxW` */
function wrap(c: CanvasRenderingContext2D, t: string, cx: number, y: number, maxW: number, size: number, color: string): void {
  c.save();
  c.font = `600 ${size}px system-ui, sans-serif`;
  const words = t.split(" ");
  let line = "";
  const lines: string[] = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (c.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  c.restore();
  lines.forEach((l, i) => drawText(c, l, cx, y + i * size * 1.35, size, color));
}
