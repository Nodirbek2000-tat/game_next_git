import { clamp, drawText, TAU, type EngineApi } from "@/engine";
import { Board, dist, HandTracks, NOTES, type Hand, type Pt, type Str } from "./logic";
import { StringSynth } from "./sound";

// Nurli tor: strings of light in the air. Pinch thumb + index on both hands and pull = a new string; open the fingers = it stays
// there. Run a finger across a string = it plays (a short string sounds high, a long one low). Pinch the ends again to move or
// stretch it; ends brought together = the string is gone. Only the hand model runs (meta.handsOnly): the fastest tracking there is.
//   ?duration=N  seconds (default: no limit, free play)

// the fingers only (the palm lines are left out)
const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

export class NurliTorGame {
  private readonly tracks = new HandTracks();
  private readonly board = new Board();
  private readonly synth: StringSynth;
  private last = 0;
  private time = 0;
  private readonly duration: number;
  private over = false;
  private placed = 0;
  private hudT = 0;
  private warmed = false;

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    this.duration = d > 0 ? d : 0;
    this.synth = new StringSynth(() => e.audio.graph());
  }

  dispose(): void {
    this.synth.stop();
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    const e = this.e;
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    const W = e.stage.w;
    const H = e.stage.h;
    const ref = Math.min(W, H);
    this.tracks.update(e.hands, e.handsAt, now);
    const playing = e.state === "play" && !this.over;
    if (playing) {
      if (!this.warmed) {
        this.warmed = true;
        this.synth.warm(NOTES.map((n) => n.freq));
      }
      this.time += dt;
      for (const ev of this.board.update(this.tracks.hands, ref, W, H, now)) {
        const s = ev.s;
        const n = NOTES[s.note];
        if (ev.type === "pluck") {
          this.synth.pluck(s.id, n.freq, ev.vel);
          e.fx.burst(ev.at.x, ev.at.y, 6, `hsl(${n.hue},100%,72%)`, [40, 160], [2, 3.5], [0.2, 0.45]);
        } else if (ev.type === "tune") this.synth.tick(s.id, n.freq);
        else if (ev.type === "place") {
          this.placed++;
          this.synth.pluck(s.id, n.freq, 0.55);
          s.amp = Math.max(s.amp, ref * 0.02);
        } else if (ev.type === "remove") {
          this.synth.mute(s.id);
          const m = mid(s.a, s.b);
          e.fx.burst(m.x, m.y, 14, `hsl(${n.hue},100%,70%)`, [60, 240], [2, 4], [0.3, 0.6]);
        }
      }
      this.hudT -= dt;
      if (this.hudT <= 0) {
        this.hudT = 0.2;
        const left = this.duration ? Math.max(0, Math.ceil(this.duration - this.time)) : null;
        e.hud.set({ title: "✨ Nurli tor", score: this.board.plucks, combo: null, lives: null, time: left, timeLabel: "Vaqt", bar: this.duration ? clamp(1 - this.time / this.duration, 0, 1) : undefined });
      }
      if (this.duration && this.time >= this.duration) {
        this.over = true;
        e.finish({
          score: this.board.plucks,
          lines: [
            ["Chalingan notalar", this.board.plucks],
            ["Tortilgan torlar", this.placed],
          ],
        });
      }
    }
    for (const s of this.board.strings) s.amp *= Math.exp(-dt * 2.4);
    this.render(c, now, W, H, ref, playing);
  }

  // ------------------------------------------------------------------------------------------- drawing

  private render(c: CanvasRenderingContext2D, now: number, W: number, H: number, ref: number, playing: boolean): void {
    const u = clamp(ref / 100, 3.2, 9);
    const b = this.board;
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.globalCompositeOperation = "lighter";
    for (const s of b.strings) this.drawString(c, s, now, u, b.held(s));
    if (b.draft) this.drawString(c, b.draft.s, now, u, true);
    c.restore();
    for (const h of this.tracks.hands) this.drawFingers(c, h, u);
    // the note of a string being pulled / moved
    const shown = b.draft?.s ?? b.strings.find((s) => b.held(s));
    if (shown) {
      const m = mid(shown.a, shown.b);
      drawText(c, NOTES[shown.note].name, m.x, m.y + u * 9, u * 6, `hsl(${NOTES[shown.note].hue},100%,82%)`);
    }
    if (!playing) return;
    const pinching = this.tracks.hands.filter((h) => h.pinch.on).length;
    let hint = "";
    if (b.draft) hint = "Uzunroq — past ovoz, qisqaroq — baland. Barmoqlarni oching — tor qoladi";
    else if (b.strings.length === 0) hint = pinching === 1 ? "Ikkinchi qo‘lda ham barmoqlarni qising" : "Ikki qo‘lda bosh va ko‘rsatkich barmoqni qisib torni torting";
    else if (b.plucks === 0) hint = "Endi barmog‘ingiz bilan torni chertib o‘ting";
    else if (b.plucks < 12 && this.placed < 3) hint = "Yana tor torting · torni ko‘chirish: uchidan qisib ushlang";
    if (hint) pillText(c, hint, W / 2, H - Math.max(u * 12, 84) - u * 6, u * 2.8, "rgba(10,10,24,.66)", "#e6f8ff");
  }

  /** the fingers: thin lines and bright tips; a pinch is a glowing orb */
  private drawFingers(c: CanvasRenderingContext2D, h: Hand, u: number): void {
    const p = h.pts;
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "rgba(180,235,255,.55)";
    c.lineWidth = Math.max(1.5, u * 0.4);
    c.beginPath();
    for (const f of FINGERS) {
      c.moveTo(p[f[0]].x, p[f[0]].y);
      for (let i = 1; i < f.length; i++) c.lineTo(p[f[i]].x, p[f[i]].y);
    }
    c.stroke();
    c.fillStyle = "rgba(235,250,255,.95)";
    c.beginPath();
    for (const i of [4, 8, 12, 16, 20]) {
      c.moveTo(p[i].x + u * 0.75, p[i].y);
      c.arc(p[i].x, p[i].y, u * 0.75, 0, TAU);
    }
    c.fill();
    c.restore();
    if (h.pinch.on) orb(c, h.at, 190, u * 2);
  }

  /** a string: a standing wave when plucked, drawn as a wide soft glow + a bright core (no shadow blur: cheap on phones) */
  private drawString(c: CanvasRenderingContext2D, s: Str, now: number, u: number, held: boolean): void {
    const a = s.a;
    const b = s.b;
    const len = dist(a, b);
    if (len < 4) return;
    const hue = NOTES[s.note].hue;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const N = s.amp > 0.5 ? 28 : 1;
    const w = now * (0.05 + s.note * 0.004);
    const path = (): void => {
      c.beginPath();
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const off = N > 1 ? s.amp * Math.sin(Math.PI * t) * Math.sin(w) : 0;
        const x = a.x + (b.x - a.x) * t + nx * off;
        const y = a.y + (b.y - a.y) * t + ny * off;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
    };
    const glow = Math.min(1, 0.45 + s.amp / 20 + (held ? 0.25 : 0));
    path();
    c.strokeStyle = `hsla(${hue},100%,55%,${0.16 * glow})`;
    c.lineWidth = u * 4.2;
    c.stroke();
    c.strokeStyle = `hsla(${hue},100%,62%,${0.4 * glow})`;
    c.lineWidth = u * 1.6;
    c.stroke();
    c.strokeStyle = `hsla(${hue},100%,88%,.95)`;
    c.lineWidth = Math.max(1.5, u * 0.45);
    c.stroke();
    for (const p of [a, b]) {
      c.fillStyle = `hsla(${hue},100%,75%,.9)`;
      c.beginPath();
      c.arc(p.x, p.y, u * (held ? 1.3 : 0.9), 0, TAU);
      c.fill();
    }
  }
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function orb(c: CanvasRenderingContext2D, p: Pt, hue: number, r: number): void {
  c.save();
  c.globalCompositeOperation = "lighter";
  const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
  g.addColorStop(0, "rgba(255,255,255,.9)");
  g.addColorStop(0.3, `hsla(${hue},100%,70%,.6)`);
  g.addColorStop(1, `hsla(${hue},100%,50%,0)`);
  c.fillStyle = g;
  c.beginPath();
  c.arc(p.x, p.y, r * 2, 0, TAU);
  c.fill();
  c.restore();
}

function pillText(c: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, bg: string, fg: string): void {
  c.save();
  c.font = `800 ${size}px Inter, system-ui, sans-serif`;
  const w = Math.min(c.canvas.width, c.measureText(t).width + size * 1.6);
  const h = size * 2;
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(x - w / 2, y, w, h, h / 2);
  c.fill();
  c.fillStyle = fg;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(t, x, y + h / 2 + 1);
  c.restore();
}
