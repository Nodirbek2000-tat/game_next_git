import { clamp, drawRingProgress, drawText, TAU, type EngineApi } from "@/engine";
import { INSTRUMENTS, noteOf, type Instrument } from "./instruments";
import { Board, dist, HandTracks, type Hand, type Pt, type Str } from "./logic";
import { StringSynth } from "./sound";

// Nurli tor: strings of light in the air. Choose an instrument on the right (point a finger at it, or tap): its strings are
// placed ready (guitar, dutor, rubob, harp) — touch one with a finger and it plays. Pinch thumb + index on both hands and pull =
// a new string of your own (short = high, long = low); open the fingers = it stays. Pinch an end to stretch it, pinch the string
// to move it; ends brought together = gone. Only the hand model runs (meta.handsOnly): the fastest tracking there is.
//   ?duration=N  seconds (default: no limit, free play)   ?cholgu=gitara|dutor|rubob|arfa|erkin  the first instrument

// the fingers only (the palm lines are left out)
const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));
/** the buttons on the right: the instruments + "clear" */
const CHIPS: { id: string; icon: string; name: string }[] = [...INSTRUMENTS.map((i) => ({ id: i.id, icon: i.icon, name: i.name })), { id: "tozalash", icon: "🧹", name: "Tozalash" }];
/** a fingertip held on a button this long (s) presses it */
const DWELL = 0.55;

export class NurliTorGame {
  private readonly tracks = new HandTracks();
  private readonly board = new Board();
  private readonly synth: StringSynth;
  private inst: Instrument;
  private last = 0;
  private time = 0;
  private readonly duration: number;
  private over = false;
  private placed = 0;
  private hudT = 0;
  private laidOut = false;
  private readonly warmed = new Set<string>();
  private dwell = { chip: -1, t: 0 };
  private chipCool = 0;
  private W = 0;
  private H = 0;
  private readonly offPointer: () => void;

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    this.duration = d > 0 ? d : 0;
    this.inst = BY_ID.get(e.query.get("cholgu") ?? "") ?? BY_ID.get("gitara")!;
    this.synth = new StringSynth(() => e.audio.graph());
    // a tap / click on a button (the canvas covers the window)
    const onDown = (ev: PointerEvent): void => {
      const i = this.chipAt(ev.clientX, ev.clientY, 1);
      if (i >= 0) this.press(i);
    };
    window.addEventListener("pointerdown", onDown);
    this.offPointer = () => window.removeEventListener("pointerdown", onDown);
  }

  dispose(): void {
    this.offPointer();
    this.synth.stop();
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    const e = this.e;
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    const W = (this.W = e.stage.w);
    const H = (this.H = e.stage.h);
    const ref = Math.min(W, H);
    this.tracks.update(e.hands, e.handsAt, now);
    const playing = e.state === "play" && !this.over;
    if (!this.laidOut && W > 0) {
      this.laidOut = true;
      this.board.placeLayout(this.inst, W, H, noteOf);
    }
    if (playing) {
      this.warm(this.inst);
      this.time += dt;
      this.chips(dt);
      for (const ev of this.board.update(this.tracks.hands, ref, W, H, now, this.inst)) {
        const s = ev.s;
        const v = (BY_ID.get(s.inst) ?? this.inst).voice;
        if (ev.type === "pluck") {
          this.synth.pluck(s.id, s.note.freq, ev.vel, v, s.inst);
          e.fx.burst(ev.at.x, ev.at.y, 6, `hsl(${s.note.hue},100%,72%)`, [40, 160], [2, 3.5], [0.2, 0.45]);
        } else if (ev.type === "tune") this.synth.tick(s.id, s.note.freq, v, s.inst);
        else if (ev.type === "place") {
          this.placed++;
          this.synth.pluck(s.id, s.note.freq, 0.5, v, s.inst);
          s.amp = Math.max(s.amp, ref * 0.02);
        } else if (ev.type === "remove") this.vanish(s);
      }
      this.hudT -= dt;
      if (this.hudT <= 0) {
        this.hudT = 0.2;
        const left = this.duration ? Math.max(0, Math.ceil(this.duration - this.time)) : null;
        e.hud.set({ title: `${this.inst.icon} ${this.inst.name}`, score: this.board.plucks, combo: null, lives: null, time: left, timeLabel: "Vaqt", bar: this.duration ? clamp(1 - this.time / this.duration, 0, 1) : undefined });
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

  /** render the notes of an instrument ahead, a little at a time */
  private warm(inst: Instrument): void {
    if (this.warmed.has(inst.id)) return;
    const freqs = new Set<number>(inst.layout.map((p) => noteOf(p.semi).freq));
    for (const n of inst.scale) freqs.add(n.freq);
    // no audio yet (the page was not touched): tried again on the next frame
    if (this.synth.warm([...freqs].map((freq) => ({ freq, v: inst.voice, inst: inst.id })))) this.warmed.add(inst.id);
  }

  private vanish(s: Str): void {
    this.synth.mute(s.id);
    const m = mid(s.a, s.b);
    this.e.fx.burst(m.x, m.y, 10, `hsl(${s.note.hue},100%,70%)`, [60, 220], [2, 4], [0.3, 0.6]);
  }

  // ------------------------------------------------------------------------------------------- the buttons

  private chipGeom(i: number): { x: number; y: number; r: number } {
    const u = clamp(Math.min(this.W, this.H) / 100, 3.2, 9);
    const r = clamp(u * 4, 20, 36);
    const gap = r * 0.8;
    const total = CHIPS.length * 2 * r + (CHIPS.length - 1) * gap;
    const y0 = Math.max(r * 2.6, (this.H - total) / 2);
    return { x: this.W - r - Math.max(10, u * 2), y: y0 + r + i * (2 * r + gap), r };
  }

  private chipAt(x: number, y: number, k: number): number {
    for (let i = 0; i < CHIPS.length; i++) {
      const g = this.chipGeom(i);
      if (Math.hypot(x - g.x, y - g.y) < g.r * k) return i;
    }
    return -1;
  }

  /** a fingertip held on a button presses it */
  private chips(dt: number): void {
    this.chipCool = Math.max(0, this.chipCool - dt);
    let over = -1;
    for (const h of this.tracks.hands) {
      if (h.pinch.on) continue;
      const i = this.chipAt(h.pts[8].x, h.pts[8].y, 1.15);
      if (i >= 0) over = i;
    }
    if (over < 0 || this.chipCool > 0) {
      this.dwell = { chip: -1, t: 0 };
      return;
    }
    if (over !== this.dwell.chip) this.dwell = { chip: over, t: 0 };
    this.dwell.t += dt;
    if (this.dwell.t >= DWELL) {
      this.press(over);
      this.dwell = { chip: -1, t: 0 };
      this.chipCool = 1;
    }
  }

  private press(i: number): void {
    const chip = CHIPS[i];
    this.e.audio.click();
    for (const s of this.board.clear()) this.vanish(s);
    if (chip.id === "tozalash") return;
    this.inst = BY_ID.get(chip.id) ?? this.inst;
    this.board.placeLayout(this.inst, this.W, this.H, noteOf);
    this.warm(this.inst);
    this.hudT = 0;
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
    // the note names of the strings, small, at one end
    for (const s of b.strings) {
      const e = s.a.x <= s.b.x ? s.a : s.b;
      const vertical = Math.abs(s.b.y - s.a.y) > Math.abs(s.b.x - s.a.x);
      const p = vertical ? (s.a.y >= s.b.y ? s.a : s.b) : e;
      drawText(c, s.note.name, p.x + (vertical ? 0 : -u * 3.4), p.y + (vertical ? u * 3.4 : 0), u * 2.1, `hsla(${s.note.hue},100%,85%,.85)`);
    }
    if (playing) this.drawChips(c, u);
    for (const h of this.tracks.hands) this.drawFingers(c, h, u);
    // the note of a string being pulled / stretched
    const shown = b.draft?.s ?? b.strings.find((s) => b.held(s) && !s.fixed);
    if (shown) {
      const m = mid(shown.a, shown.b);
      drawText(c, shown.note.name, m.x, m.y + u * 9, u * 6, `hsl(${shown.note.hue},100%,82%)`);
    }
    if (!playing) return;
    const pinching = this.tracks.hands.filter((h) => h.pinch.on).length;
    let hint = "";
    if (b.draft) hint = "Uzunroq — past, qisqaroq — baland. Barmoqlarni oching — tor qoladi";
    else if (b.strings.length === 0) hint = pinching === 1 ? "Ikkinchi qo‘lda ham barmoqlarni qising" : "Ikki qo‘lda bosh va ko‘rsatkich barmoqni qisib tor torting";
    else if (b.plucks === 0) hint = "Barmog‘ingiz bilan torga teging — chalinadi";
    else if (this.time < 25) hint = "O‘ngdagi tugmalar — boshqa cholg‘u · ikki qo‘lda qisib yangi tor torting";
    if (hint) pillText(c, hint, W / 2, H - Math.max(u * 12, 84) - u * 6, u * 2.6, "rgba(10,10,24,.66)", "#e6f8ff");
  }

  private drawChips(c: CanvasRenderingContext2D, u: number): void {
    for (let i = 0; i < CHIPS.length; i++) {
      const g = this.chipGeom(i);
      const active = CHIPS[i].id === this.inst.id;
      c.save();
      c.fillStyle = active ? "rgba(34,211,238,.32)" : "rgba(10,12,28,.62)";
      c.strokeStyle = active ? "rgba(140,240,255,.95)" : "rgba(255,255,255,.28)";
      c.lineWidth = active ? 2.5 : 1.5;
      c.beginPath();
      c.arc(g.x, g.y, g.r, 0, TAU);
      c.fill();
      c.stroke();
      c.font = `${g.r * 0.95}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(CHIPS[i].icon, g.x, g.y + g.r * 0.05);
      c.restore();
      drawText(c, CHIPS[i].name, g.x, g.y + g.r + u * 1.6, Math.max(10, u * 1.7), active ? "#bff6ff" : "rgba(255,255,255,.75)");
      if (this.dwell.chip === i && this.dwell.t > 0) drawRingProgress(c, g.x, g.y, g.r + 5, Math.min(1, this.dwell.t / DWELL), "#7ef0ff");
    }
  }

  /** the fingers: thin lines and bright tips; a pinch is a glowing orb */
  private drawFingers(c: CanvasRenderingContext2D, h: Hand, u: number): void {
    const p = h.pts;
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "rgba(180,235,255,.6)";
    c.lineWidth = Math.max(1.5, u * 0.42);
    c.beginPath();
    for (const f of FINGERS) {
      c.moveTo(p[f[0]].x, p[f[0]].y);
      for (let i = 1; i < f.length; i++) c.lineTo(p[f[i]].x, p[f[i]].y);
    }
    c.stroke();
    c.fillStyle = "rgba(235,250,255,.95)";
    c.beginPath();
    for (const i of [4, 8, 12, 16, 20]) {
      c.moveTo(p[i].x + u * 0.8, p[i].y);
      c.arc(p[i].x, p[i].y, u * 0.8, 0, TAU);
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
    const hue = s.note.hue;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const N = s.amp > 0.5 ? 28 : 1;
    const w = now * (0.03 + Math.min(0.06, s.note.freq / 12000));
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
