import { clamp, drawRingProgress, drawText, TAU, type EngineApi } from "@/engine";
import { INSTRUMENTS, noteOf, type Instrument } from "./instruments";
import { Board, dist, HandTracks, type Hand, type Pt, type Str } from "./logic";
import { drumPads, PadBoard, pianoPads } from "./pads";
import { StringSynth } from "./sound";

// Nurli tor: music in the air, played with the fingers. Choose an instrument in the row at the top (hold a fingertip on it, or tap):
//   🎹 Pianino / 🥁 Baraban — a keyboard / a drum kit: a fingertip that comes into a key or a drum plays it;
//   🎸 Gitara, 🪕 Dutor, 🎵 Rubob, 🎼 Arfa — ready strings: touch one and it plays;
//   ✨ Erkin — pinch thumb + index on both hands and pull a string of your own (short = high, long = low); open the fingers = it
//   stays. Pinch an end to stretch it, pinch the string to move it; ends brought together = gone.
// Only the hand model runs (meta.handsOnly): the fastest tracking there is.
//   ?duration=N  seconds (default: no limit, free play)   ?cholgu=pianino|baraban|gitara|dutor|rubob|arfa|erkin  the first instrument

// the fingers only (the palm lines are left out)
const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));
/** the buttons in the row at the top: the instruments + "clear" */
const CHIPS: { id: string; icon: string; name: string }[] = [...INSTRUMENTS.map((i) => ({ id: i.id, icon: i.icon, name: i.name })), { id: "tozalash", icon: "🧹", name: "Tozalash" }];
/** a fingertip held on a button this long (s) presses it */
const DWELL = 0.55;
const EMOJI_FONT = `system-ui, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;

interface ChipBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** only the icon (a narrow screen) */
  iconOnly: boolean;
}

export class NurliTorGame {
  private readonly tracks = new HandTracks();
  private readonly board = new Board();
  private readonly padBoard = new PadBoard();
  private readonly synth: StringSynth;
  private inst: Instrument;
  private last = 0;
  private time = 0;
  private readonly duration: number;
  private over = false;
  private placed = 0;
  private hudT = 0;
  /** the screen size the instrument was laid out for (0 = not yet) */
  private laidW = 0;
  private laidH = 0;
  private readonly warmed = new Set<string>();
  private dwell = { chip: -1, t: 0 };
  private chipCool = 0;
  private W = 0;
  private H = 0;
  private boxes: ChipBox[] = [];
  private readonly offPointer: () => void;

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    this.duration = d > 0 ? d : 0;
    this.inst = BY_ID.get(e.query.get("cholgu") ?? "") ?? INSTRUMENTS[0];
    this.synth = new StringSynth(() => e.audio.graph());
    // a tap / click on a button (the canvas covers the window)
    const onDown = (ev: PointerEvent): void => {
      const i = this.chipAt(ev.clientX, ev.clientY, 4);
      if (i >= 0 && this.e.state === "play") this.press(i);
    };
    window.addEventListener("pointerdown", onDown);
    this.offPointer = () => window.removeEventListener("pointerdown", onDown);
  }

  dispose(): void {
    this.offPointer();
    this.synth.stop();
  }

  private get kind(): "strings" | "piano" | "drums" {
    return this.inst.kind ?? "strings";
  }

  /** score: everything played */
  private get played(): number {
    return this.board.plucks + this.padBoard.hits;
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
    // the instrument is laid out for the screen (again when the screen turns / resizes)
    if (W > 0 && (Math.abs(W - this.laidW) > 2 || Math.abs(H - this.laidH) > 2)) this.layout(W, H);
    if (playing) {
      this.warm(this.inst);
      this.time += dt;
      this.chips(dt);
      if (this.kind === "strings") this.playStrings(now, ref, W, H);
      else this.playPads(now);
      this.hudT -= dt;
      if (this.hudT <= 0) {
        this.hudT = 0.2;
        const left = this.duration ? Math.max(0, Math.ceil(this.duration - this.time)) : null;
        e.hud.set({ title: `${this.inst.icon} ${this.inst.name}`, score: this.played, combo: null, lives: null, time: left, timeLabel: "Vaqt", bar: this.duration ? clamp(1 - this.time / this.duration, 0, 1) : undefined });
      }
      if (this.duration && this.time >= this.duration) {
        this.over = true;
        e.finish({
          score: this.played,
          lines: [
            ["Chalingan notalar", this.played],
            ["Tortilgan torlar", this.placed],
          ],
        });
      }
    }
    for (const s of this.board.strings) s.amp *= Math.exp(-dt * 2.4);
    for (const p of this.padBoard.pads) p.lit = Math.max(0, p.lit - dt * 3.2);
    this.render(c, now, W, H, ref, playing);
  }

  private layout(W: number, H: number): void {
    const resize = this.laidW > 0;
    this.laidW = W;
    this.laidH = H;
    this.layoutChips();
    if (this.kind === "piano") this.padBoard.set(pianoPads(W, H));
    else if (this.kind === "drums") this.padBoard.set(drumPads(W, H));
    else if (!resize) this.board.placeLayout(this.inst, W, H, noteOf);
  }

  private playStrings(now: number, ref: number, W: number, H: number): void {
    for (const ev of this.board.update(this.tracks.hands, ref, W, H, now, this.inst)) {
      const s = ev.s;
      const v = (BY_ID.get(s.inst) ?? this.inst).voice;
      if (ev.type === "pluck") {
        this.synth.pluck(s.id, s.note.freq, ev.vel, v, s.inst);
        this.e.fx.burst(ev.at.x, ev.at.y, 6, `hsl(${s.note.hue},100%,72%)`, [40, 160], [2, 3.5], [0.2, 0.45]);
      } else if (ev.type === "tune") this.synth.tick(s.id, s.note.freq, v, s.inst);
      else if (ev.type === "place") {
        this.placed++;
        this.synth.pluck(s.id, s.note.freq, 0.5, v, s.inst);
        s.amp = Math.max(s.amp, ref * 0.02);
      } else if (ev.type === "remove") this.vanish(s);
    }
  }

  private playPads(now: number): void {
    for (const hit of this.padBoard.update(this.tracks.hands, now)) {
      const p = hit.pad;
      if (p.drum) this.synth.drum(p.drum, hit.vel);
      else if (p.semi !== undefined) this.synth.piano(noteOf(p.semi).freq, hit.vel);
      this.e.fx.burst(hit.at.x, hit.at.y, p.drum ? 10 : 5, `hsl(${p.hue},100%,72%)`, [50, p.drum ? 260 : 150], [2, 4], [0.2, 0.5]);
    }
  }

  /** prepare the sounds of an instrument ahead, a little at a time (the first note plays at once) */
  private warm(inst: Instrument): void {
    if (this.warmed.has(inst.id)) return;
    let ok: boolean;
    if (inst.kind === "piano") ok = this.synth.warmPads(pianoPads(1, 1).map((p) => () => this.synth.prepare("piano", noteOf(p.semi ?? 0).freq)));
    else if (inst.kind === "drums") ok = this.synth.warmPads(drumPads(1, 1).map((p) => () => this.synth.prepare("drum", p.drum!)));
    else {
      const freqs = new Set<number>(inst.layout.map((p) => noteOf(p.semi).freq));
      for (const n of inst.scale) freqs.add(n.freq);
      ok = this.synth.warm([...freqs].map((freq) => ({ freq, v: inst.voice, inst: inst.id })));
    }
    // no audio yet (the page was not touched): tried again on the next frame
    if (ok) this.warmed.add(inst.id);
  }

  private vanish(s: Str): void {
    this.synth.mute(s.id);
    const m = mid(s.a, s.b);
    this.e.fx.burst(m.x, m.y, 10, `hsl(${s.note.hue},100%,70%)`, [60, 220], [2, 4], [0.3, 0.6]);
  }

  // ------------------------------------------------------------------------------------------- the buttons (a row at the top)

  private layoutChips(): void {
    const W = this.W;
    const u = clamp(Math.min(W, this.H) / 100, 3.2, 9);
    const h = clamp(u * 6.4, 34, 50);
    const gap = h * 0.22;
    const font = h * 0.36;
    const textW = (t: string): number => t.length * font * 0.56;
    const wide = CHIPS.map((c) => h * 0.95 + textW(c.name) + h * 0.35);
    const total = wide.reduce((a, b) => a + b, 0) + gap * (CHIPS.length - 1);
    const iconOnly = total > W * 0.94;
    const widths = iconOnly ? CHIPS.map(() => h) : wide;
    const g = iconOnly ? Math.min(gap, (W * 0.96 - h * CHIPS.length) / Math.max(1, CHIPS.length - 1)) : gap;
    const sum = widths.reduce((a, b) => a + b, 0) + g * (CHIPS.length - 1);
    let x = (W - sum) / 2;
    // under the HUD cards
    const y = Math.max(92, u * 13);
    this.boxes = widths.map((w) => {
      const b = { x, y, w, h, iconOnly };
      x += w + g;
      return b;
    });
  }

  private chipAt(x: number, y: number, grow: number): number {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (x >= b.x - grow && x <= b.x + b.w + grow && y >= b.y - grow && y <= b.y + b.h + grow) return i;
    }
    return -1;
  }

  /** a fingertip held on a button presses it */
  private chips(dt: number): void {
    this.chipCool = Math.max(0, this.chipCool - dt);
    let over = -1;
    for (const h of this.tracks.hands) {
      if (h.pinch.on) continue;
      const i = this.chipAt(h.pts[8].x, h.pts[8].y, 10);
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
    if (chip.id === "tozalash") {
      if (this.kind !== "strings") this.inst = BY_ID.get("erkin")!;
      this.padBoard.set([]);
    } else {
      this.inst = BY_ID.get(chip.id) ?? this.inst;
      this.padBoard.set([]);
      this.laidW = this.laidH = 0; // laid out on the next frame
      this.warm(this.inst);
    }
    this.hudT = 0;
  }

  // ------------------------------------------------------------------------------------------- drawing

  private render(c: CanvasRenderingContext2D, now: number, W: number, H: number, ref: number, playing: boolean): void {
    const u = clamp(ref / 100, 3.2, 9);
    const b = this.board;
    if (this.kind === "piano") this.drawPiano(c, u);
    else if (this.kind === "drums") this.drawDrums(c, u);
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.globalCompositeOperation = "lighter";
    for (const s of b.strings) this.drawString(c, s, now, u, b.held(s));
    if (b.draft) this.drawString(c, b.draft.s, now, u, true);
    c.restore();
    // the note names of the strings, small, at one end
    for (const s of b.strings) {
      const vertical = Math.abs(s.b.y - s.a.y) > Math.abs(s.b.x - s.a.x);
      const p = vertical ? (s.a.y >= s.b.y ? s.a : s.b) : s.a.x <= s.b.x ? s.a : s.b;
      drawText(c, s.note.name, p.x + (vertical ? 0 : -u * 3.4), p.y + (vertical ? u * 3.4 : 0), u * 2.1, `hsla(${s.note.hue},100%,85%,.85)`);
    }
    if (playing) this.drawChips(c);
    for (const h of this.tracks.hands) this.drawFingers(c, h, u);
    // the note of a string being pulled / stretched
    const shown = b.draft?.s ?? b.strings.find((s) => b.held(s) && !s.fixed);
    if (shown) {
      const m = mid(shown.a, shown.b);
      drawText(c, shown.note.name, m.x, m.y + u * 9, u * 6, `hsl(${shown.note.hue},100%,82%)`);
    }
    if (!playing) return;
    let hint = "";
    if (this.kind === "piano") hint = this.padBoard.hits < 6 ? "Barmoqlaringiz bilan klavishlarga teging" : "";
    else if (this.kind === "drums") hint = this.padBoard.hits < 6 ? "Qo‘llaringiz bilan barabanlarga uring" : "";
    else if (b.draft) hint = "Uzunroq — past, qisqaroq — baland. Barmoqlarni oching — tor qoladi";
    else if (b.strings.length === 0) hint = this.tracks.hands.filter((h) => h.pinch.on).length === 1 ? "Ikkinchi qo‘lda ham barmoqlarni qising" : "Ikki qo‘lda bosh va ko‘rsatkich barmoqni qisib tor torting";
    else if (b.plucks === 0) hint = "Barmog‘ingiz bilan torga teging — chalinadi";
    else if (this.time < 25) hint = "Tepadagi tugmalar — boshqa cholg‘u · ikki qo‘lda qisib yangi tor torting";
    if (hint) pillText(c, hint, W / 2, H - Math.max(u * 12, 84) - u * 6, u * 2.6, "rgba(10,10,24,.66)", "#e6f8ff");
  }

  private drawChips(c: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      const chip = CHIPS[i];
      const active = chip.id === this.inst.id;
      const r = b.h / 2;
      c.save();
      c.fillStyle = active ? "rgba(34,211,238,.30)" : "rgba(10,12,28,.6)";
      c.strokeStyle = active ? "rgba(140,240,255,.95)" : "rgba(255,255,255,.22)";
      c.lineWidth = active ? 2.5 : 1.2;
      c.beginPath();
      c.roundRect(b.x, b.y, b.w, b.h, r);
      c.fill();
      c.stroke();
      c.textBaseline = "middle";
      c.textAlign = "center";
      c.font = `${b.h * 0.5}px ${EMOJI_FONT}`;
      c.fillText(chip.icon, b.x + (b.iconOnly ? b.w / 2 : r), b.y + r + 1);
      if (!b.iconOnly) {
        c.textAlign = "left";
        c.font = `800 ${b.h * 0.36}px Inter, system-ui, sans-serif`;
        c.fillStyle = active ? "#dffbff" : "rgba(255,255,255,.88)";
        c.fillText(chip.name, b.x + b.h * 0.9, b.y + r + 1);
      }
      c.restore();
      if (this.dwell.chip === i && this.dwell.t > 0) drawRingProgress(c, b.x + b.w / 2, b.y + r, r + 4, Math.min(1, this.dwell.t / DWELL), "#7ef0ff");
    }
  }

  /** the keyboard: glassy white keys and dark black ones; a key lights up and sinks a little when it plays */
  private drawPiano(c: CanvasRenderingContext2D, u: number): void {
    const pads = this.padBoard.pads;
    c.save();
    for (const p of pads) {
      if (p.black) continue;
      const down = p.lit * u * 0.8;
      const g = c.createLinearGradient(0, p.y, 0, p.y + p.h);
      g.addColorStop(0, `rgba(255,255,255,${0.16 + p.lit * 0.35})`);
      g.addColorStop(1, `rgba(255,255,255,${0.32 + p.lit * 0.45})`);
      c.fillStyle = g;
      c.strokeStyle = p.lit > 0.05 ? `hsla(${p.hue},100%,75%,${0.5 + p.lit * 0.5})` : "rgba(255,255,255,.55)";
      c.lineWidth = 1.5 + p.lit * 2;
      c.beginPath();
      c.roundRect(p.x + 2, p.y + down, p.w - 4, p.h, [0, 0, u * 1.4, u * 1.4]);
      c.fill();
      c.stroke();
      if (p.lit > 0.05) {
        c.fillStyle = `hsla(${p.hue},100%,65%,${p.lit * 0.45})`;
        c.fill();
      }
      drawText(c, p.label, p.x + p.w / 2, p.y + p.h - u * 2.4 + down, Math.max(11, u * 2), "rgba(20,24,40,.85)");
    }
    for (const p of pads) {
      if (!p.black) continue;
      const down = p.lit * u * 0.6;
      c.fillStyle = p.lit > 0.05 ? `hsla(${p.hue},90%,${30 + p.lit * 30}%,.95)` : "rgba(14,14,26,.88)";
      c.strokeStyle = "rgba(190,160,255,.6)";
      c.lineWidth = 1.2;
      c.beginPath();
      c.roundRect(p.x, p.y + down, p.w, p.h, [0, 0, u * 0.9, u * 0.9]);
      c.fill();
      c.stroke();
    }
    c.restore();
  }

  /** the drum kit: round pads with a rim, a ring that widens on every hit */
  private drawDrums(c: CanvasRenderingContext2D, u: number): void {
    for (const p of this.padBoard.pads) {
      const r = p.w / 2;
      const cymbal = p.drum === "hat" || p.drum === "crash";
      c.save();
      const g = c.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
      if (cymbal) {
        g.addColorStop(0, `hsla(${p.hue},95%,${78 + p.lit * 15}%,.85)`);
        g.addColorStop(1, `hsla(${p.hue},85%,38%,.55)`);
      } else {
        g.addColorStop(0, `rgba(255,255,255,${0.55 + p.lit * 0.4})`);
        g.addColorStop(0.7, `hsla(${p.hue},70%,${55 + p.lit * 25}%,.5)`);
        g.addColorStop(1, `hsla(${p.hue},70%,30%,.6)`);
      }
      c.fillStyle = g;
      c.beginPath();
      c.arc(p.x, p.y, r * (1 - p.lit * 0.04), 0, TAU);
      c.fill();
      c.strokeStyle = `hsla(${p.hue},100%,${70 + p.lit * 25}%,.9)`;
      c.lineWidth = u * (cymbal ? 0.5 : 1.1);
      c.stroke();
      if (p.lit > 0.02) {
        c.strokeStyle = `hsla(${p.hue},100%,75%,${p.lit * 0.8})`;
        c.lineWidth = u * 0.8;
        c.beginPath();
        c.arc(p.x, p.y, r * (1 + (1 - p.lit) * 0.6), 0, TAU);
        c.stroke();
      }
      c.restore();
      drawText(c, p.label, p.x, p.y + r + u * 2.6, Math.max(11, u * 2), "rgba(255,255,255,.85)");
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
    if (h.pinch.on && this.kind === "strings") orb(c, h.at, 190, u * 2);
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

