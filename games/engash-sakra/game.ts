import { clamp, type EngineApi } from "@/engine";
import { bottomLift } from "@/engine/ui/safe";
import { arrowBanner, plate, put, softSpot, stripeTile, textSpr, vignette, type Spr } from "./gfx";
import { Calm, Gates, WARN, Stance, readBody, type Gate } from "./logic";

const LIVES = ["", "❤️", "❤️❤️", "❤️❤️❤️"];
const FB_SEC = 0.8;
/** distance of the horizon and of the player in the corridor (the bar's size on screen is ZN / z) */
const ZF = 7;
const ZN = 1;
/** seconds the starting hint stays */
const HINT_SEC = 5;

/**
 * Eng, sakra: bars come out of the distance toward the player in perspective. A high bar (red, at head height) must be ducked
 * under ("ENG!"), a low bar (blue, at the shins) must be jumped ("SAKRA!"). The player is NOT drawn (the camera shows them).
 */
export class EngashGame {
  private readonly stance = new Stance();
  private readonly gates: Gates;
  private readonly roundSec: number;
  private readonly body = new Float64Array(5);
  private readonly vx = new Calm();
  private readonly order = new Int8Array(6);
  private last = 0;
  private dt = 0;
  private clock = 0;
  private scroll = 0;
  private lives = 3;
  private passed = 0;
  private hits = 0;
  private streak = 0;
  private best = 0;
  private score = 0;
  private time = 0;
  private goT = 0;
  private playT = 0;
  private over = false;
  private comboStr: string | null = null;
  private shownSec = -1;
  private hudDirty = true;
  private fb: Spr | null = null;
  private fbT = 0;
  private flashG = 0;
  private flashR = 0;
  // geometry of the last frame (also used by the events)
  private gx = 0;
  private gNose = 0;
  private gGround = 0;
  // sprites (rebuilt when the stage size changes)
  private lw = 0;
  private lh = 0;
  private sAlo!: Spr;
  private sOk!: Spr;
  private sHit!: Spr;
  private sWrong!: Spr;
  private sCal!: Spr;
  private sReady!: Spr;
  private sHint!: Spr;
  private bEng!: Spr;
  private bSakra!: Spr;
  private pHigh!: Spr;
  private pLow!: Spr;
  private shDark!: Spr;
  private shGreen!: Spr;
  private vigR!: Spr;
  private vigG!: Spr;
  private patHigh: CanvasPattern | null = null;
  private patLow: CanvasPattern | null = null;
  private patCtx: CanvasRenderingContext2D | null = null;

  constructor(private readonly e: EngineApi) {
    const d = Number(e.query.get("duration"));
    this.roundSec = d > 0 ? d : 60;
    this.gates = new Gates(Math.random, Math.min(45, this.roundSec));
    this.layout();
  }

  private layout(): void {
    const st = this.e.stage;
    this.lw = st.w;
    this.lh = st.h;
    const px = clamp(Math.min(st.w, st.h) * 0.1, 32, 76);
    this.sAlo = textSpr("A’lo!", px, "#7dffa0");
    this.sOk = textSpr("Zo‘rg‘a!", px * 0.85, "#ffd23d");
    this.sHit = textSpr("Urildi!", px, "#ff6b6b");
    this.sWrong = textSpr("Teskari!", px, "#ff9f43");
    this.sCal = textSpr("Tik turing...", px * 0.62, "#ffffff");
    this.sReady = textSpr("Tayyor!", px * 0.8, "#ffd23d");
    this.sHint = textSpr("Qizil to‘siq: engashing. Ko‘k to‘siq: sakrang!", clamp(st.w * 0.04, 16, 26), "#ffffff", 700);
    const bp = clamp(Math.min(st.w, st.h) * 0.13, 40, 96);
    this.bEng = arrowBanner("ENG!", bp, "#ff7468", false);
    this.bSakra = arrowBanner("SAKRA!", bp, "#6cb8ff", true);
    this.pHigh = plate(64, "#e8392b", false);
    this.pLow = plate(64, "#2478f0", true);
    this.shDark = softSpot(160, 56, "0,0,0", 0.5);
    this.shGreen = softSpot(160, 56, "90,255,150", 0.7);
    this.vigR = vignette(st.w, st.h, "255,30,30");
    this.vigG = vignette(st.w, st.h, "60,255,130");
    this.patHigh = this.patLow = null; // made on the first draw (needs the canvas context)
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.05) : 0;
    this.last = now;
    this.dt = dt;
    this.clock += dt;
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
    const kDown = e.keys.has("ArrowDown");
    if ((kUp || kDown) && !st.ready) st.skipCalibration();
    st.update(dt, p.present ? p.lm : null, p.scale, kUp, kDown);
    if (!play) return;

    this.playT += dt;
    if (st.ready) this.goT += dt;
    const go = this.goT >= 0.8;
    if (go) {
      this.time += dt;
      const sec = Math.ceil(Math.max(0, this.roundSec - this.time));
      if (sec !== this.shownSec) this.hudDirty = true;
    }
    const g = this.gates;
    const ev = g.update(dt, st.air, st.isDuck, go);
    if (g.warnKind === 0) e.audio.tone(560, 330, 0.14, "triangle", 0.09);
    else if (g.warnKind === 1) e.audio.tone(360, 700, 0.14, "triangle", 0.09);
    if (g.arrived) e.audio.tone(320, 120, 0.1, "sawtooth", 0.04);
    if (ev === 1) this.cleared(g.lastKind, g.lastPerfect);
    else if (ev === 2) this.hit(g.lastWrong);
    if (this.hudDirty) this.pushHud();
    if (this.lives <= 0 || this.time >= this.roundSec) {
      this.over = true;
      const total = this.passed + this.hits;
      e.finish({
        score: this.score,
        lines: [
          ["O‘tilgan to‘siqlar", this.passed],
          ["Eng uzun seriya", this.best],
          ["Aniqlik", total ? `${Math.round((this.passed / total) * 100)}%` : "—"],
        ],
      });
    }
  }

  private cleared(kind: 0 | 1, perfect: boolean): void {
    const e = this.e;
    this.passed++;
    this.streak++;
    this.best = Math.max(this.best, this.streak);
    const add = 10 + Math.min(this.streak, 10) * 2 + (perfect ? 5 : 0);
    this.score += add;
    this.fb = perfect ? this.sAlo : this.sOk;
    this.fbT = FB_SEC;
    this.flashG = 0.3;
    this.comboStr = this.streak > 2 ? `${this.streak} ketma-ket` : null;
    this.hudDirty = true;
    if (perfect) e.audio.coin();
    else e.audio.good();
    const y = kind === 0 ? this.gNose : this.gGround;
    e.fx.burst(this.gx, y, 6, kind === 0 ? "#ff8a7d" : "#7cc4ff", [3, 8], [2, 4], [0.3, 0.6], false, 0.3);
    e.fx.popup(`+${add}`, this.gx, Math.max(this.gNose - 50, 100), "#7dffa0", 28, 0.7);
    if (this.streak % 5 === 0) {
      e.audio.combo(this.streak);
      e.fx.popup(`${this.streak} ketma-ket!`, e.stage.w / 2, e.stage.h * 0.3, "#ffd23d", 34, 1);
    }
  }

  private hit(wrong: boolean): void {
    const e = this.e;
    this.lives--;
    this.hits++;
    this.streak = 0;
    this.comboStr = null;
    this.fb = wrong ? this.sWrong : this.sHit;
    this.fbT = FB_SEC;
    this.flashR = 0.5;
    this.hudDirty = true;
    e.audio.hurt();
    e.fx.shake(9, 0.22);
  }

  private pushHud(): void {
    this.hudDirty = false;
    const sec = Math.ceil(Math.max(0, this.roundSec - this.time));
    this.shownSec = sec;
    this.e.hud.set({
      title: "Eng, sakra",
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
    if (!this.patHigh || this.patCtx !== c) {
      this.patCtx = c;
      this.patHigh = c.createPattern(stripeTile("#e8392b", "#ffffff"), "repeat");
      this.patLow = c.createPattern(stripeTile("#2478f0", "#ffffff"), "repeat");
    }
    const dt = this.dt;
    const p = e.players[0];
    const stance = this.stance;
    const gates = this.gates;
    const top = st.h > st.w ? 130 : 92;
    const floor = st.h - bottomLift(st.w, st.h) - 10;
    const ref = stance.hasBody ? stance.ref : p.present ? p.scale : 60;

    // the corridor stands still: its centre is the calibrated x of the player, followed slowly
    const b = this.body;
    if (p.present) readBody(p.lm, b);
    else b.fill(NaN);
    const xTarget = stance.x === stance.x ? stance.x : b[4] === b[4] ? b[4] : st.w / 2;
    const vx = this.vx.update(xTarget, 0.15 * ref, dt, 0.3);
    let nose = stance.headY;
    if (!(nose === nose)) nose = b[2] === b[2] ? b[2] : st.h * 0.3;
    let ground = stance.groundY;
    if (!(ground === ground)) ground = nose + 4.2 * ref;
    ground = Math.min(ground + 0.05 * ref, floor);
    const hy = Math.min(nose - ref, Math.max(nose - 2.4 * ref, top * 0.5));
    this.gx = vx;
    this.gNose = nose;
    this.gGround = ground;
    const halfArr = Math.min(Math.max(0.42 * st.w, 2.4 * ref), 0.47 * st.w);

    // lane: two side lines and a few cross lines running toward the player
    if (stance.ready) {
      const run = this.goT >= 0.8;
      if (run) this.scroll = (this.scroll + (dt * 4) / gates.approach) % 1;
      c.strokeStyle = "rgba(255,255,255,.2)";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(vx, hy);
      c.lineTo(vx - halfArr, ground);
      c.moveTo(vx, hy);
      c.lineTo(vx + halfArr, ground);
      c.moveTo(vx - halfArr, ground);
      c.lineTo(vx + halfArr, ground);
      for (let i = 0; i < 4; i++) {
        const z = ZF - ((i + this.scroll) / 4) * (ZF - ZN);
        const k = ZN / z;
        const y = hy + (ground - hy) * k;
        c.moveTo(vx - halfArr * k, y);
        c.lineTo(vx + halfArr * k, y);
      }
      c.stroke();
    }

    // flashes
    if (this.flashR > 0) {
      put(c, this.vigR, st.w / 2, st.h / 2, 1, Math.min(1, this.flashR * 1.4));
      this.flashR = Math.max(0, this.flashR - dt);
    }
    if (this.flashG > 0) {
      put(c, this.vigG, st.w / 2, st.h / 2, 1, Math.min(1, this.flashG * 1.1));
      this.flashG = Math.max(0, this.flashG - dt);
    }

    // soft shadow at the feet: shows what the camera understood (green = duck / jump seen)
    const lift = clamp(stance.up, 0, 1);
    const sc = ((2.8 - lift * 0.8) / 160) * ref;
    put(c, this.shDark, vx, ground, sc, 0.7 - lift * 0.3);
    if (stance.air || stance.isDuck) put(c, this.shGreen, vx, ground, sc * 1.05, 0.8);

    // bars, far to near
    let n = 0;
    const pool = gates.pool;
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].active) continue;
      let j = n++;
      while (j > 0 && pool[this.order[j - 1]].t > pool[i].t) {
        this.order[j] = this.order[j - 1];
        j--;
      }
      this.order[j] = i;
    }
    for (let i = 0; i < n; i++) this.drawGate(c, pool[this.order[i]], vx, hy, nose, ground, halfArr, ref);

    // texts
    if (!stance.ready) {
      const y = Math.min(floor - 30, st.h * 0.72);
      put(c, this.sCal, st.w / 2, y);
      const bw = clamp(st.w * 0.3, 120, 220);
      c.fillStyle = "rgba(0,0,0,.45)";
      c.fillRect(st.w / 2 - bw / 2, y + this.sCal.h * 0.7, bw, 8);
      c.fillStyle = "#7dffa0";
      c.fillRect(st.w / 2 - bw / 2, y + this.sCal.h * 0.7, bw * stance.progress, 8);
    } else if (e.state === "play") {
      const ng = gates.next();
      const by = top + 50;
      if (ng && ng.dur - ng.t <= WARN) {
        const r = ng.dur - ng.t;
        const q = 1 - r / WARN;
        const spr = ng.kind === 0 ? this.bEng : this.bSakra;
        const pulse = 1 + 0.07 * Math.sin(this.clock * 16) * (0.4 + q);
        put(c, spr, vx, by, Math.min(1, st.w / (spr.w * 1.15)) * pulse, Math.min(1, q * 8));
        // time left until the bar arrives
        const bw = Math.min(spr.w, st.w * 0.8) * 0.8;
        c.fillStyle = "rgba(0,0,0,.45)";
        c.fillRect(vx - bw / 2, by + spr.h * 0.55, bw, 7);
        c.fillStyle = ng.kind === 0 ? "#ff7468" : "#6cb8ff";
        c.fillRect(vx - bw / 2, by + spr.h * 0.55, bw * (1 - q), 7);
      } else if (this.goT < 0.8) {
        put(c, this.sReady, st.w / 2, by);
      } else if (this.playT < HINT_SEC + 1 && !ng) {
        put(c, this.sHint, st.w / 2, by, 1, clamp(HINT_SEC + 1 - this.playT, 0, 1));
      }
    }
    if (this.fbT > 0 && this.fb) {
      const q = 1 - this.fbT / FB_SEC;
      const pop = q < 0.15 ? 0.6 + (q / 0.15) * 0.6 : q < 0.25 ? 1.2 - ((q - 0.15) / 0.1) * 0.2 : 1;
      put(c, this.fb, vx, top + 130 - q * 24, pop, this.fbT < 0.25 ? this.fbT / 0.25 : 1);
      this.fbT = Math.max(0, this.fbT - dt);
    }
  }

  private drawGate(c: CanvasRenderingContext2D, g: Gate, vx: number, hy: number, nose: number, ground: number, halfArr: number, ref: number): void {
    // perspective: z runs from ZF (horizon) to ZN (at the player) and a little on, the size on screen is ZN / z
    const speed = (ZF - ZN) / g.dur;
    const z = Math.max(0.5, ZF - speed * g.t);
    const k = ZN / z;
    const high = g.kind === 0;
    const yArr = high ? nose - 0.225 * ref : ground - 0.3 * ref;
    const thArr = (high ? 0.45 : 0.38) * ref;
    const y = hy + (yArr - hy) * k;
    const fy = hy + (ground - hy) * k;
    const half = halfArr * k;
    const th = Math.max(3, thArr * k);
    let alpha = Math.min(1, 0.2 + k * 3);
    if (g.state !== 0) alpha *= Math.max(0, 1 - g.since / 0.35);
    else if (g.t > g.dur) alpha *= Math.max(0, 1 - (g.t - g.dur) / 0.3);
    if (alpha <= 0.02) return;
    c.globalAlpha = alpha;
    // posts
    const pw = Math.max(2, 0.07 * ref * k);
    c.fillStyle = "rgba(255,255,255,.6)";
    c.fillRect(vx - half - pw / 2, y, pw, Math.max(0, fy - y));
    c.fillRect(vx + half - pw / 2, y, pw, Math.max(0, fy - y));
    // bar: dark rim, then the striped body (pattern scaled with the bar)
    const rim = Math.max(1.5, 3 * k);
    c.fillStyle = "rgba(0,0,0,.4)";
    c.fillRect(vx - half - rim, y - th / 2 - rim, half * 2 + rim * 2, th + rim * 2);
    const pat = high ? this.patHigh : this.patLow;
    if (pat) {
      const s = th / 64;
      c.save();
      c.translate(vx - half, y - th / 2);
      c.scale(s, s);
      c.fillStyle = pat;
      c.fillRect(0, 0, (half * 2) / s, 64);
      c.restore();
    }
    // sign with the arrow in the middle
    const sign = high ? this.pHigh : this.pLow;
    put(c, sign, vx, y, (th * 1.7) / sign.h);
    c.globalAlpha = 1;
    // verdict glow on the bar
    if (g.state === 2 && g.since < 0.2) {
      c.fillStyle = `rgba(255,40,40,${0.5 * (1 - g.since / 0.2)})`;
      c.fillRect(vx - half, y - th / 2, half * 2, th);
    }
  }
}
