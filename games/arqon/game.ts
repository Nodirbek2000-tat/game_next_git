import { clamp, TAU, type EngineApi } from "@/engine";
import { bottomLift } from "@/engine/ui/safe";
import { put, softSpot, textSpr, vignette, type Spr } from "./gfx";
import { Calm, LEAD_IN, Rope, STALL, Stance, readBody } from "./logic";

const LIVES = ["", "❤️", "❤️❤️", "❤️❤️❤️"];
const FB_SEC = 0.85;

/**
 * Arqon sakrash: a jump rope swings around the player (over the head behind, under the feet in front). The player is NOT drawn
 * (the camera shows them); only a soft shadow at the feet and the rope handles at the hips follow the body, smoothed with a dead zone.
 */
export class ArqonGame {
  private readonly stance = new Stance();
  private readonly rope: Rope;
  private readonly roundSec: number;
  private readonly body = new Float64Array(5);
  private readonly cx = new Calm();
  private readonly cy = new Calm();
  private readonly ch = new Calm();
  private last = 0;
  private dt = 0;
  private lives = 3;
  private jumps = 0;
  private trips = 0;
  private streak = 0;
  private best = 0;
  private score = 0;
  private time = 0;
  private goT = 0;
  private over = false;
  private comboStr: string | null = null;
  private shownSec = -1;
  private hudDirty = true;
  // feedback
  private fb: Spr | null = null;
  private fbT = 0;
  private flashG = 0;
  private flashR = 0;
  private lastGround = 0;
  // sprites (rebuilt when the stage size changes)
  private lw = 0;
  private lh = 0;
  private sAlo!: Spr;
  private sOk!: Spr;
  private sTrip!: Spr;
  private sCal!: Spr;
  private sReady!: Spr;
  private sHint!: Spr;
  private shDark!: Spr;
  private shGold!: Spr;
  private shRed!: Spr;
  private vigR!: Spr;
  private vigG!: Spr;

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    this.roundSec = d > 0 ? d : 60;
    this.rope = new Rope(Math.min(45, this.roundSec));
    this.layout();
  }

  private layout(): void {
    const st = this.e.stage;
    this.lw = st.w;
    this.lh = st.h;
    const px = clamp(Math.min(st.w, st.h) * 0.1, 32, 76);
    this.sAlo = textSpr("A’lo!", px, "#7dffa0");
    this.sOk = textSpr("Zo‘rg‘a!", px * 0.85, "#ffd23d");
    this.sTrip = textSpr("Tegdi!", px, "#ff6b6b");
    this.sCal = textSpr("Tik turing...", px * 0.62, "#ffffff");
    this.sReady = textSpr("Tayyor!", px * 0.8, "#ffd23d");
    this.sHint = textSpr("Arqon oyoq ostiga kelganda sakrang!", clamp(st.w * 0.04, 16, 26), "#ffffff", 700);
    this.shDark = softSpot(160, 56, "0,0,0", 0.5);
    this.shGold = softSpot(160, 56, "255,205,60", 0.75);
    this.shRed = softSpot(160, 56, "255,60,60", 0.8);
    this.vigR = vignette(st.w, st.h, "255,30,30");
    this.vigG = vignette(st.w, st.h, "60,255,130");
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    this.dt = dt;
    const s = this.e.state;
    if ((s === "countdown" || s === "play") && !this.over) this.step(dt, s === "play");
    this.render(c);
  }

  // ---------------------------------------------------------------- logic
  private step(dt: number, play: boolean): void {
    const e = this.e;
    const p = e.players[0];
    const st = this.stance;
    const kUp = e.keys.has("ArrowUp") || e.keys.has(" ");
    if (kUp && !st.ready) st.skipCalibration();
    st.update(dt, p.present ? p.lm : null, p.scale, kUp, false);
    if (!play) return;

    if (st.ready) this.goT += dt;
    const go = this.goT >= LEAD_IN;
    if (go) {
      this.time += dt;
      const sec = Math.ceil(Math.max(0, this.roundSec - this.time));
      if (sec !== this.shownSec) this.hudDirty = true;
    }
    const ev = this.rope.update(dt, st.air, go);
    if (this.rope.cue) e.audio.tone(1500, 1150, 0.04, "square", 0.045);
    if (this.rope.crossed) e.audio.tone(420, 150, 0.1, "sawtooth", 0.045);
    if (ev === 1) this.cleared(this.rope.perfect);
    else if (ev === 2) this.tripped();
    if (this.hudDirty) this.pushHud();
    if (this.lives <= 0 || this.time >= this.roundSec) {
      this.over = true;
      const total = this.jumps + this.trips;
      e.finish({
        score: this.score,
        lines: [
          ["Sakrashlar", this.jumps],
          ["Eng uzun seriya", this.best],
          ["Aniqlik", total ? `${Math.round((this.jumps / total) * 100)}%` : "—"],
        ],
      });
    }
  }

  private cleared(perfect: boolean): void {
    const e = this.e;
    this.jumps++;
    this.streak++;
    this.best = Math.max(this.best, this.streak);
    const add = 10 + Math.min(this.streak, 10) * 2 + (perfect ? 5 : 0);
    this.score += add;
    this.fb = perfect ? this.sAlo : this.sOk;
    this.fbT = FB_SEC;
    this.flashG = 0.35;
    this.comboStr = this.streak > 2 ? `${this.streak} ketma-ket` : null;
    this.hudDirty = true;
    const x = this.cx.v === this.cx.v ? this.cx.v : e.stage.w / 2;
    if (perfect) e.audio.coin();
    else e.audio.good();
    e.fx.burst(x, this.lastGround, 6, "#ffd23d", [3, 8], [2, 4], [0.3, 0.6], false, 0.3);
    e.fx.popup(`+${add}`, x, this.ch.v === this.ch.v ? this.ch.v - 10 : e.stage.h * 0.3, "#7dffa0", 28, 0.7);
    if (this.streak % 5 === 0) {
      e.audio.combo(this.streak);
      e.fx.popup(`${this.streak} ketma-ket!`, e.stage.w / 2, e.stage.h * 0.3, "#ffd23d", 34, 1);
    }
  }

  private tripped(): void {
    const e = this.e;
    this.lives--;
    this.trips++;
    this.streak = 0;
    this.comboStr = null;
    this.fb = this.sTrip;
    this.fbT = FB_SEC;
    this.flashR = 0.5;
    this.hudDirty = true;
    e.audio.hurt();
    e.fx.shake(7, 0.2);
  }

  private pushHud(): void {
    this.hudDirty = false;
    const sec = Math.ceil(Math.max(0, this.roundSec - this.time));
    this.shownSec = sec;
    this.e.hud.set({
      title: "Arqon sakrash",
      score: this.score,
      combo: this.comboStr,
      lives: LIVES[Math.max(0, this.lives)],
      time: sec,
      timeLabel: "Vaqt",
    });
  }

  // ---------------------------------------------------------------- drawing
  private render(c: CanvasRenderingContext2D): void {
    const e = this.e;
    const st = e.stage;
    if (st.w !== this.lw || st.h !== this.lh) this.layout();
    const dt = this.dt;
    const p = e.players[0];
    const stance = this.stance;
    const top = st.h > st.w ? 130 : 92;
    const floor = st.h - bottomLift(st.w, st.h) - 10;
    const ref = stance.hasBody ? stance.ref : p.present ? p.scale : 60;

    // calm anchors: hips (hands), centre x, head
    const b = this.body;
    if (p.present) readBody(p.lm, b);
    else b.fill(NaN);
    const dead = 0.05 * ref;
    const ax0 = this.cx.update(b[4] === b[4] ? b[4] : p.present ? p.center.x : stance.x, dead, dt);
    const hipNow = b[0] === b[0] ? b[0] : b[1] === b[1] ? b[1] + 1.7 * ref : NaN;
    const ay = this.cy.update(hipNow, dead, dt);
    const headNow = b[2] === b[2] ? b[2] : b[1] === b[1] ? b[1] - 0.8 * ref : NaN;
    const headY = this.ch.update(headNow, dead, dt);
    const ax1 = ax0 === ax0 ? ax0 : st.w / 2;
    const axisY = ay === ay ? ay : st.h * 0.55;
    const head = headY === headY ? headY : axisY - 2.3 * ref;

    // ground under the standing player (stable: it comes from the calibrated level)
    let g = stance.groundY;
    if (!(g === g)) g = axisY + 2.3 * ref;
    g = Math.min(g + 0.1 * ref, floor);
    this.lastGround = g;

    const hw = clamp(1.45 * ref, 40, st.w / 2 - 24);
    const ax = clamp(ax1, hw + 12, st.w - hw - 12);
    const yTop = Math.max(top * 0.6, head - 0.95 * ref);

    const rope = this.rope;
    const idle = !stance.ready || this.goT < LEAD_IN;
    const down = rope.waiting || rope.stall > 0;
    const ph = rope.phase;

    // vignette flashes
    if (this.flashR > 0) {
      put(c, this.vigR, st.w / 2, st.h / 2, 1, Math.min(1, this.flashR * 1.4));
      this.flashR = Math.max(0, this.flashR - dt);
    }
    if (this.flashG > 0) {
      put(c, this.vigG, st.w / 2, st.h / 2, 1, Math.min(1, this.flashG * 1.2));
      this.flashG = Math.max(0, this.flashG - dt);
    }

    // soft shadow at the feet: shrinks while the player is in the air, glows when the rope is about to pass
    const lift = clamp(stance.up, 0, 1);
    const sw = (2.9 - lift * 0.8) / 160;
    put(c, this.shDark, ax, g + 0.04 * ref, sw * ref, 0.75 - lift * 0.35);
    if (down) put(c, this.shRed, ax, g + 0.04 * ref, sw * ref * 1.1, 0.9);
    else if (!idle && ph > 0.27 && ph < 0.52) {
      const k = clamp((ph - 0.27) / 0.23, 0, 1);
      put(c, this.shGold, ax, g + 0.04 * ref, sw * ref * (0.9 + 0.3 * k), 0.25 + 0.7 * k);
    }

    // rope
    const rw = clamp(ref * 0.1, 5, 11);
    const gy = g + 0.12 * ref;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (down) {
      const wob = rope.stall > 0 ? Math.sin(rope.stall * 34) * 0.06 * ref * (rope.stall / STALL) : 0;
      this.ropePath(c, ax, hw, axisY, gy - 0.02 * ref + wob, -hw * 0.3);
      c.strokeStyle = "rgba(0,0,0,.35)";
      c.lineWidth = rw + 4;
      c.stroke();
      c.strokeStyle = "#ff8a5c";
      c.lineWidth = rw;
      c.stroke();
    } else {
      const s = Math.cos(ph * TAU);
      const front = ph < 0.5;
      if (front && !idle) {
        // short motion trail
        const s2 = Math.cos((ph - 0.045) * TAU);
        this.ropePath(c, ax, hw, axisY, this.apex(s2, axisY, yTop, gy, ref), hw * 0.38 * (0.4 + 0.6 * Math.abs(s2)));
        c.strokeStyle = "rgba(255,200,80,.22)";
        c.lineWidth = rw * 1.5;
        c.stroke();
      }
      this.ropePath(c, ax, hw, axisY, this.apex(s, axisY, yTop, gy, ref), hw * 0.38 * (0.4 + 0.6 * Math.abs(s)));
      if (front) {
        c.strokeStyle = "rgba(0,0,0,.35)";
        c.lineWidth = rw + 4;
        c.stroke();
        c.strokeStyle = ph > 0.38 ? "#fff1a8" : "#ffc53d";
        c.lineWidth = rw;
      } else {
        // behind the player: thinner and dimmer
        c.strokeStyle = "rgba(205,120,45,.55)";
        c.lineWidth = rw * 0.7;
      }
      c.stroke();
    }
    // handles
    c.strokeStyle = "#ffffff";
    c.lineWidth = clamp(ref * 0.2, 8, 16);
    c.beginPath();
    c.moveTo(ax - hw, axisY - 0.2 * ref);
    c.lineTo(ax - hw, axisY + 0.2 * ref);
    c.moveTo(ax + hw, axisY - 0.2 * ref);
    c.lineTo(ax + hw, axisY + 0.2 * ref);
    c.stroke();

    // texts
    if (!stance.ready) {
      put(c, this.sCal, st.w / 2, Math.min(floor - 30, st.h * 0.72));
      const bw = clamp(st.w * 0.3, 120, 220);
      const by = Math.min(floor - 30, st.h * 0.72) + this.sCal.h * 0.7;
      c.fillStyle = "rgba(0,0,0,.45)";
      c.fillRect(st.w / 2 - bw / 2, by, bw, 8);
      c.fillStyle = "#7dffa0";
      c.fillRect(st.w / 2 - bw / 2, by, bw * stance.progress, 8);
    } else if (this.goT < LEAD_IN && e.state === "play") {
      put(c, this.sReady, st.w / 2, top + 50);
    } else if (this.rope.swing < 6 && e.state === "play") {
      put(c, this.sHint, st.w / 2, top + 22, 1, clamp(6 - this.rope.swing, 0, 1));
    }
    if (this.fbT > 0 && this.fb) {
      const q = 1 - this.fbT / FB_SEC;
      const pop = q < 0.15 ? 0.6 + (q / 0.15) * 0.6 : q < 0.25 ? 1.2 - ((q - 0.15) / 0.1) * 0.2 : 1;
      const fy = Math.max(top + 60, head - 1.4 * ref) - q * 28;
      put(c, this.fb, ax, fy, pop, this.fbT < 0.25 ? this.fbT / 0.25 : 1);
      this.fbT = Math.max(0, this.fbT - dt);
    }
  }

  /** y of the far point of the rope for s = cos(angle): 1 over the head, 0 at hand height, -1 under the feet */
  private apex(s: number, axisY: number, yTop: number, yBot: number, ref: number): number {
    const y = s >= 0 ? axisY - s * (axisY - yTop) : axisY + -s * (yBot - axisY);
    return y + (1 - Math.abs(s)) * 0.14 * ref; // droops a little when it is level with the hands
  }

  /** begin a path of the rope between the two handles with its far point at `apexY`; `bulge` pushes the sides out (or in) */
  private ropePath(c: CanvasRenderingContext2D, ax: number, hw: number, axisY: number, apexY: number, bulge: number): void {
    const yc = axisY + (apexY - axisY) / 0.75;
    c.beginPath();
    c.moveTo(ax - hw, axisY);
    c.bezierCurveTo(ax - hw - bulge, yc, ax + hw + bulge, yc, ax + hw, axisY);
  }
}
