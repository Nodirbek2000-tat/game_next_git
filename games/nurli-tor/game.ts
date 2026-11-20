import { clamp, drawText, TAU, type EngineApi, type HandInfo } from "@/engine";
import { dist, Guide, ladderPos, NotePicker, NOTES, Pinch, type Pt } from "./logic";
import { StringSynth } from "./sound";

// Nurli tor: a string of light between the two pinched hands. Pull the hands apart = a lower note, bring them together = higher;
// every new note is plucked, the light rings while the string is held. A melody guide ("Yulduzcha") shows the next note to play.
//   ?duration=N  seconds (default 90)

const HAND_LINKS = [0, 1, 1, 2, 2, 3, 3, 4, 0, 5, 5, 6, 6, 7, 7, 8, 5, 9, 9, 10, 10, 11, 11, 12, 9, 13, 13, 14, 14, 15, 15, 16, 13, 17, 17, 18, 18, 19, 19, 20, 0, 17];

export class NurliTorGame {
  private readonly pinchL = new Pinch();
  private readonly pinchR = new Pinch();
  private readonly picker = new NotePicker();
  private readonly guide = new Guide();
  private readonly synth: StringSynth;
  private last = 0;
  private time = 0;
  private readonly duration: number;
  private over = false;
  private note = -1;
  private pos = 0;
  /** string vibration amplitude (px), set by a pluck, decays */
  private amp = 0;
  private phase = 0;
  private score = 0;
  private played = 0;
  private flash = 0;
  private hudT = 0;
  private holdT = 0;
  private bestRun = 0;

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    this.duration = d > 0 ? d : 90;
    this.synth = new StringSynth(() => e.audio.graph());
  }

  dispose(): void {
    this.synth.stop();
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    const playing = this.e.state === "play" && !this.over;
    this.track(dt, playing);
    if (playing) this.update(dt);
    else this.synth.holdTone(0, 0);
    this.render(c, dt);
  }

  /** pinch points from the hand model (both hands, any state, so the light is seen before the game starts too) */
  private track(dt: number, playing: boolean): void {
    const p = this.e.players[0];
    const h = p.present ? p.hands : { L: null, R: null };
    const mid = (hd: HandInfo | null): Pt | null => (hd ? { x: (hd.pts[4].x + hd.pts[8].x) / 2, y: (hd.pts[4].y + hd.pts[8].y) / 2 } : null);
    this.pinchL.update(h.L ? h.L.pinchD : null, mid(h.L), dt);
    this.pinchR.update(h.R ? h.R.pinchD : null, mid(h.R), dt);
    void playing;
  }

  private get active(): boolean {
    return this.pinchL.on && this.pinchR.on;
  }

  private handSize(): number {
    const h = this.e.players[0].hands;
    const sizes = [h.L?.size, h.R?.size].filter((s): s is number => typeof s === "number" && s > 0);
    return sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 60;
  }

  private update(dt: number): void {
    const e = this.e;
    this.time += dt;
    this.phase += dt * 38;
    this.amp *= Math.exp(-dt * 2.6);
    this.flash = Math.max(0, this.flash - dt * 2);
    if (this.active) {
      const len = dist(this.pinchL.at, this.pinchR.at) / this.handSize();
      this.pos = ladderPos(len);
      const n = this.picker.pick(this.pos);
      if (n !== this.note) {
        const first = this.note < 0;
        this.note = n;
        this.synth.pluck(NOTES[n].freq, first ? 0.95 : 0.75);
        this.amp = Math.max(this.amp, first ? 26 : 18);
        this.played++;
        this.score += 1;
        const m = this.midpoint();
        e.fx.burst(m.x, m.y, 10, `hsl(${NOTES[n].hue},100%,70%)`, [60, 220], [2, 4], [0.3, 0.6]);
      }
      this.synth.holdTone(NOTES[this.note].freq, 1);
      this.holdT += dt;
      this.bestRun = Math.max(this.bestRun, this.guide.hits);
    } else {
      if (this.note >= 0) this.synth.holdTone(NOTES[this.note].freq, 0);
      this.note = -1;
      this.picker.reset();
    }
    if (this.guide.update(this.note, dt)) {
      this.score += 10;
      this.flash = 1;
      e.audio.coin();
      const m = this.midpoint();
      e.fx.popup("+10", m.x, m.y - 40, "#ffe066", 34);
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.15;
      e.hud.set({ title: "✨ Nurli tor", score: this.score, combo: null, lives: null, time: Math.max(0, Math.ceil(this.duration - this.time)), timeLabel: "Vaqt", bar: clamp(1 - this.time / this.duration, 0, 1) });
    }
    if (this.time >= this.duration) {
      this.over = true;
      this.synth.holdTone(0, 0);
      e.finish({
        score: this.score,
        lines: [
          ["Chalingan notalar", this.played],
          ["Kuy notalari (Yulduzcha)", this.guide.hits],
          ["Tor ushlangan vaqt", `${Math.round(this.holdT)} s`],
        ],
      });
    }
  }

  private midpoint(): Pt {
    return { x: (this.pinchL.at.x + this.pinchR.at.x) / 2, y: (this.pinchL.at.y + this.pinchR.at.y) / 2 };
  }

  // ------------------------------------------------------------------------------------------- drawing

  private render(c: CanvasRenderingContext2D, dt: number): void {
    const e = this.e;
    const st = e.stage;
    const W = st.w;
    const H = st.h;
    const u = clamp(Math.min(W, H) / 100, 3.2, 9);
    const p = e.players[0];
    if (!(e.state === "play" && !this.over)) this.phase += dt * 38;

    if (this.flash > 0) {
      c.fillStyle = `rgba(255,224,102,${this.flash * 0.12})`;
      c.fillRect(0, 0, W, H);
    }
    // the hands, faint
    if (p.present) for (const hd of [p.hands.L, p.hands.R]) if (hd) this.drawHand(c, hd, u);

    const hue = this.note >= 0 ? NOTES[this.note].hue : 190;
    if (this.active) this.drawString(c, hue, u);
    for (const pin of [this.pinchL, this.pinchR]) if (pin.on) this.orb(c, pin.at, hue, u * (this.active ? 2.4 : 1.8));

    // the note
    if (this.active && this.note >= 0) {
      const m = this.midpoint();
      // below the string: the notes ladder and the melody line are above it
      drawText(c, NOTES[this.note].name, m.x, m.y + u * 11, u * 7, `hsl(${hue},100%,80%)`);
    }
    this.drawLadder(c, W, u);

    const playing = e.state === "play";
    if (playing && !this.active) {
      const one = this.pinchL.on || this.pinchR.on;
      const text = one ? "Ikkinchi qo‘lda ham barmoqlarni qising" : "Ikki qo‘lda bosh va ko‘rsatkich barmoqni qising — nur paydo bo‘ladi";
      pillText(c, text, W / 2, H - Math.max(u * 12, 84) - u * 6, u * 3, "rgba(10,10,24,.72)", "#fff");
    } else if (playing && this.time < 12) {
      pillText(c, "Uzoqlashtiring — past ovoz · yaqinlashtiring — baland", W / 2, H - Math.max(u * 12, 84) - u * 6, u * 2.8, "rgba(10,10,24,.6)", "#cfefff");
    }
  }

  private drawHand(c: CanvasRenderingContext2D, hd: HandInfo, u: number): void {
    c.save();
    c.strokeStyle = "rgba(170,230,255,.35)";
    c.lineWidth = Math.max(1.5, u * 0.35);
    c.lineCap = "round";
    c.beginPath();
    for (let i = 0; i < HAND_LINKS.length; i += 2) {
      const a = hd.pts[HAND_LINKS[i]];
      const b = hd.pts[HAND_LINKS[i + 1]];
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
    }
    c.stroke();
    c.fillStyle = "rgba(220,245,255,.7)";
    for (const i of [4, 8]) {
      c.beginPath();
      c.arc(hd.pts[i].x, hd.pts[i].y, Math.max(2, u * 0.5), 0, TAU);
      c.fill();
    }
    c.restore();
  }

  /** a standing wave between the two pinch points, drawn as glow + core */
  private drawString(c: CanvasRenderingContext2D, hue: number, u: number): void {
    const a = this.pinchL.at;
    const b = this.pinchR.at;
    const len = dist(a, b);
    if (len < 4) return;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const N = 48;
    const amp = this.amp + u * 0.35;
    const mode = this.note >= 0 ? 1 + (this.note % 3) : 1;
    const path = (): void => {
      c.beginPath();
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const off = amp * Math.sin(Math.PI * t * mode) * Math.sin(this.phase + t * 0.6) * Math.sin(Math.PI * t);
        const x = a.x + (b.x - a.x) * t + nx * off;
        const y = a.y + (b.y - a.y) * t + ny * off;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
    };
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    c.lineJoin = "round";
    c.shadowColor = `hsl(${hue},100%,60%)`;
    c.shadowBlur = u * 6;
    c.strokeStyle = `hsla(${hue},100%,60%,.35)`;
    c.lineWidth = u * 3.2;
    path();
    c.stroke();
    c.shadowBlur = u * 3;
    c.strokeStyle = `hsla(${hue},100%,70%,.9)`;
    c.lineWidth = u * 1.1;
    path();
    c.stroke();
    c.shadowBlur = 0;
    c.strokeStyle = "rgba(255,255,255,.95)";
    c.lineWidth = Math.max(1.5, u * 0.35);
    path();
    c.stroke();
    c.restore();
  }

  private orb(c: CanvasRenderingContext2D, p: Pt, hue: number, r: number): void {
    c.save();
    c.globalCompositeOperation = "lighter";
    const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
    g.addColorStop(0, "rgba(255,255,255,.95)");
    g.addColorStop(0.25, `hsla(${hue},100%,70%,.8)`);
    g.addColorStop(1, `hsla(${hue},100%,50%,0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(p.x, p.y, r * 2.2, 0, TAU);
    c.fill();
    c.restore();
  }

  /** the notes along the top: the one playing is lit, the next note of the melody pulses */
  private drawLadder(c: CanvasRenderingContext2D, W: number, u: number): void {
    const n = NOTES.length;
    const w = Math.min(W * 0.86, u * 110);
    const x0 = (W - w) / 2;
    const y = u * 19;
    const step = w / (n - 1);
    const target = this.guide.target;
    const pulse = 0.5 + 0.5 * Math.sin(this.phase * 0.12);
    c.save();
    c.strokeStyle = "rgba(255,255,255,.18)";
    c.lineWidth = u * 0.5;
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x0 + w, y);
    c.stroke();
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      const lit = i === this.note;
      const isTarget = i % 5 === target % 5 && i < 5;
      const r = u * (lit ? 2.6 : 1.6);
      if (isTarget && this.e.state === "play") {
        c.strokeStyle = `rgba(255,224,102,${0.5 + pulse * 0.5})`;
        c.lineWidth = u * 0.6;
        c.beginPath();
        c.arc(x, y, u * (3.4 + pulse), 0, TAU);
        c.stroke();
      }
      c.fillStyle = lit ? `hsl(${NOTES[i].hue},100%,70%)` : "rgba(255,255,255,.45)";
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
      drawText(c, NOTES[i].name, x, y + u * 5, u * 2.1, lit ? "#fff" : "rgba(255,255,255,.7)");
    }
    c.restore();
    if (this.e.state === "play") drawText(c, `Kuy: «Yulduzcha» · keyingi nota — ${NOTES[target].name}`, W / 2, y + u * 10, u * 2.3, "#ffe066");
  }
}

function pillText(c: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, bg: string, fg: string): void {
  c.save();
  c.font = `800 ${size}px system-ui, sans-serif`;
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
