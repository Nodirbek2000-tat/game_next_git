// Sanaymiz: numbers 1-5 and colours learnt by moving. Rounds alternate: "3 marta sakrang!" / "2 marta qarsak!" (every child's jumps / claps
// are counted on their own avatar: pop + the number), and "Qizil sharni ushlang!" (balloons float up, touch the named colour).
// Every child who completes a round gets a star, nobody loses. 2D only, pooled, no allocation per frame.

import { KID_COLORS, pillPath, starPath, type KidsGameInstance, type KidsKit } from "../bogcha/common";
import type { KidsGraph } from "../bogcha/common/music";
import { Speaker } from "../havoda-rasm/say";
import { Sparks } from "../havoda-rasm/logic";
import { drawSparks } from "../havoda-rasm/spark-draw";
import {
  Balloons,
  COLOURS,
  COLOUR_MAX_PLAY,
  CountRound,
  EV_NEXT,
  EV_PRAISE,
  MAX_BALLOONS,
  NUMBER_WORDS,
  RoundClock,
  SLOTS,
  allDone,
  countMaxPlay,
  makeEnv,
  makeRounds,
  parseSeq,
  roundText,
  segCircle,
  type Round,
} from "./logic";
import { CountSounds } from "./sound";

const TAU = Math.PI * 2;
const GOLD = 9;
const DIGITS = ["0", "1", "2", "3", "4", "5"] as const;
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

export interface SanaymizDebug {
  idx: number;
  kind: string;
  n: number;
  colour: number;
  phase: string;
  /** children that completed the current round */
  doneCount: number;
  /** stars earned by each child (round completions) */
  earned: number[];
  counts: number[];
  targets: number;
  pops: number;
  stars: number;
}

export class SanaymizGame implements KidsGameInstance {
  readonly count = new CountRound();
  readonly balloons: Balloons;
  readonly sparks = new Sparks();
  readonly clock = new RoundClock();
  readonly env = makeEnv();
  private rounds: Round[];
  private round: Round = { kind: "jump", n: 1, colour: 0 };
  private idx = -1;
  private readonly speaker: Speaker;
  private readonly sounds: CountSounds;
  private readonly palette: string[] = [...COLOURS.map((c) => c.hex), ...KID_COLORS, "#ffd23d"];
  private readonly present = new Uint8Array(SLOTS);
  private readonly colourDone = new Uint8Array(SLOTS);
  private readonly popT = new Float32Array(SLOTS);
  private readonly popN = new Uint8Array(SLOTS);
  private readonly earned = new Int32Array(SLOTS);
  private readonly prevX = new Float32Array(SLOTS * 2);
  private readonly prevY = new Float32Array(SLOTS * 2);
  private readonly prevOk = new Uint8Array(SLOTS * 2);
  private maxSpoken = 0;
  private anyDone = false;
  private doneCount = 0;
  private started = false;
  private t = 0;
  private pops = 0;
  private lastH = 0;
  private fDigit = "";
  private fEmoji = "";
  private fName = "";
  private fKid = "";
  private readonly dbg: SanaymizDebug | null;

  constructor(
    private readonly kit: KidsKit,
    private readonly rnd: () => number = Math.random,
  ) {
    const seq = parseSeq(kit.engine.query.get("seq"));
    this.rounds = seq.length ? seq : makeRounds(rnd);
    this.balloons = new Balloons(rnd);
    this.speaker = new Speaker(kit);
    this.sounds = new CountSounds(() => (kit.engine.audio.graph?.() as KidsGraph | null | undefined) ?? null);
    this.dbg = kit.engine.query.get("debug")
      ? { idx: -1, kind: "", n: 0, colour: -1, phase: "", doneCount: 0, earned: [0, 0, 0, 0, 0], counts: [0, 0, 0, 0, 0], targets: 0, pops: 0, stars: 0 }
      : null;
    if (this.dbg && typeof window !== "undefined") (window as unknown as { __sanaymiz?: SanaymizDebug }).__sanaymiz = this.dbg;
  }

  onStart(): void {
    if (this.started) return; // called again after a pause
    this.started = true;
    this.startRound();
  }

  private startRound(): void {
    this.idx++;
    if (this.idx >= this.rounds.length) {
      this.rounds = makeRounds(this.rnd);
      this.idx = 0;
    }
    const r = this.rounds[this.idx];
    this.round = r;
    this.clock.begin(r.kind === "colour" ? COLOUR_MAX_PLAY : countMaxPlay(r.n));
    this.count.reset(r.kind === "colour" ? 1 : r.n);
    this.colourDone.fill(0);
    this.popT.fill(0);
    this.anyDone = false;
    this.doneCount = 0;
    this.maxSpoken = 0;
    this.balloons.clear();
    if (r.kind === "colour") {
      this.syncEnv();
      this.env.target = r.colour;
      this.balloons.refill(this.env, true);
    }
    const rt = roundText(r);
    this.speaker.say(rt.text, rt.icon, 3800);
  }

  private syncEnv(): void {
    const kit = this.kit;
    const env = this.env;
    env.w = kit.stage.w;
    env.h = kit.stage.h;
    this.balloons.r = kit.stage.h * 0.062;
    let n = 0;
    for (let s = 0; s < SLOTS; s++) {
      const k = kit.kids[s];
      const p = k.active && k.present;
      this.present[s] = p ? 1 : 0;
      if (p) env.kidX[n++] = k.center.x;
    }
    env.nKids = n;
    env.need = Math.min(6, n + 1);
    env.cap = 8;
  }

  private complete(slot: number): void {
    const kit = this.kit;
    const k = kit.kids[slot];
    this.earned[slot]++;
    this.doneCount++;
    this.anyDone = true;
    kit.award(k, 1);
    this.sparks.burst(k.pts.head.x, k.pts.head.y - k.headR * 1.5, 12, 4 + slot, kit.stage.h * 0.4, kit.stage.h * 0.013, this.rnd);
  }

  update(dt: number): void {
    const kit = this.kit;
    const h = kit.stage.h;
    this.t += dt;
    this.syncEnv();
    const r = this.round;
    const playing = this.clock.phase === "play";
    let anyKid = false;
    for (let s = 0; s < SLOTS; s++) {
      if (this.popT[s] > 0) this.popT[s] = Math.max(0, this.popT[s] - dt * 1.3);
      if (this.present[s]) anyKid = true;
    }

    if (r.kind === "colour") this.colourStep(dt, playing);
    else if (playing) this.countStep();

    const done = r.kind === "colour" ? allDone(this.present, this.colourDone) : allDone(this.present, this.count.done);
    const ev = this.clock.tick(dt, done, anyKid);
    if (ev === EV_PRAISE) {
      if (this.anyDone) {
        kit.sfx.yay();
        kit.voice.say("bravo", 1900);
        this.sparks.burst(kit.stage.w / 2, h * 0.55, 18, GOLD, h * 0.5, h * 0.014, this.rnd);
      } else {
        kit.voice.say("again", 1600);
      }
    } else if (ev === EV_NEXT) this.startRound();
    this.sparks.step(dt, h * 0.4);

    if (this.dbg) {
      const d = this.dbg;
      d.idx = this.idx;
      d.kind = r.kind;
      d.n = r.n;
      d.colour = r.kind === "colour" ? r.colour : -1;
      d.phase = this.clock.phase;
      d.doneCount = this.doneCount;
      for (let s = 0; s < SLOTS; s++) {
        d.earned[s] = this.earned[s];
        d.counts[s] = this.count.count[s];
      }
      d.targets = r.kind === "colour" ? this.balloons.targetAlive(r.colour) : 0;
      d.pops = this.pops;
      d.stars = kit.stars;
    }
  }

  /** jumps / claps of every present child are counted on their own avatar */
  private countStep(): void {
    const kit = this.kit;
    const jump = this.round.kind === "jump";
    for (let s = 0; s < SLOTS; s++) {
      if (!this.present[s]) continue;
      const sig = kit.kids[s].signals;
      if (!(jump ? sig.jumpFired : sig.clapFired)) continue;
      const c = this.count.hit(s);
      if (c === 0) continue;
      this.popT[s] = 1;
      this.popN[s] = c;
      this.sounds.count(c);
      if (c > this.maxSpoken) {
        this.maxSpoken = c;
        this.speaker.speak(NUMBER_WORDS[c - 1]);
      }
      if (c >= this.count.n) this.complete(s);
    }
  }

  private colourStep(dt: number, playing: boolean): void {
    const kit = this.kit;
    const env = this.env;
    const b = this.balloons;
    const h = kit.stage.h;
    const target = this.round.colour;
    env.target = target;
    if (this.clock.phase !== "praise") b.refill(env, false);
    b.step(dt, this.t, env);
    for (let s = 0; s < SLOTS; s++) {
      const k = kit.kids[s];
      for (let side = 0; side < 2; side++) {
        const wi = s * 2 + side;
        const pt = side ? k.pts.rw : k.pts.lw;
        if (!this.present[s] || pt.v < 0.25) {
          this.prevOk[wi] = 0;
          continue;
        }
        let x0 = this.prevOk[wi] ? this.prevX[wi] : pt.x;
        let y0 = this.prevOk[wi] ? this.prevY[wi] : pt.y;
        if (Math.abs(pt.x - x0) + Math.abs(pt.y - y0) > env.w * 0.4) {
          x0 = pt.x;
          y0 = pt.y;
        }
        this.prevX[wi] = pt.x;
        this.prevY[wi] = pt.y;
        this.prevOk[wi] = 1;
        if (!playing) continue;
        const reach = b.r * 1.15 + Math.max(k.scale * 0.2, h * 0.02);
        for (let i = 0; i < MAX_BALLOONS; i++) {
          if (!b.alive[i]) continue;
          if (!segCircle(x0, y0, pt.x, pt.y, b.x[i], b.y[i], reach)) continue;
          if (b.colour[i] === target) {
            this.sparks.burst(b.x[i], b.y[i], 10, target, h * 0.35, h * 0.012, this.rnd);
            kit.sfx.pop();
            b.kill(i);
            this.pops++;
            if (!this.colourDone[s]) {
              this.colourDone[s] = 1;
              this.complete(s);
            }
          } else {
            // another colour: the balloon only bobs away, a soft sound, nothing is lost
            b.vx[i] += (b.x[i] >= pt.x ? 1 : -1) * h * 0.5;
            b.vy[i] = Math.min(b.vy[i], -h * 0.05);
            this.sounds.soft();
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- paint

  private layout(h: number): void {
    this.lastH = h;
    this.fDigit = `800 ${Math.round(h * 0.15)}px system-ui, "Segoe UI", sans-serif`;
    this.fEmoji = `${Math.round(h * 0.07)}px ${EMOJI_FONT}`;
    this.fName = `800 ${Math.round(h * 0.075)}px system-ui, "Segoe UI", sans-serif`;
    this.fKid = `800 ${Math.round(h * 0.1)}px system-ui, "Segoe UI", sans-serif`;
  }

  drawFront(ctx: CanvasRenderingContext2D, now: number): void {
    const kit = this.kit;
    const w = kit.stage.w;
    const h = kit.stage.h;
    if (h !== this.lastH) this.layout(h);
    if (this.started) {
      if (this.round.kind === "colour") this.drawBalloons(ctx, now);
      this.drawKidMarks(ctx);
      this.drawCard(ctx, w, h);
    }
    if (kit.playing) drawSparks(ctx, this.sparks, this.palette, now);
  }

  private drawBalloons(ctx: CanvasRenderingContext2D, now: number): void {
    const b = this.balloons;
    if (b.count === 0) return;
    const rx = b.r;
    const ry = rx * 1.2;
    const target = this.round.colour;
    const hint = this.clock.phase !== "praise";
    const pulse = 1 + 0.06 * Math.sin(now * 0.008);
    // strings first (one path)
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < MAX_BALLOONS; i++) {
      if (!b.alive[i]) continue;
      ctx.moveTo(b.x[i], b.y[i] + ry);
      ctx.lineTo(b.x[i] + Math.sin(now * 0.004 + b.phase[i]) * rx * 0.25, b.y[i] + ry + rx * 1.1);
    }
    ctx.stroke();
    // one fill per colour
    for (let c = 0; c < 4; c++) {
      const k = hint && c === target ? pulse : 1;
      ctx.beginPath();
      for (let i = 0; i < MAX_BALLOONS; i++) {
        if (!b.alive[i] || b.colour[i] !== c) continue;
        ctx.moveTo(b.x[i] + rx * k, b.y[i]);
        ctx.ellipse(b.x[i], b.y[i], rx * k, ry * k, 0, 0, TAU);
      }
      ctx.fillStyle = COLOURS[c].hex;
      ctx.fill();
    }
    // shine
    ctx.beginPath();
    for (let i = 0; i < MAX_BALLOONS; i++) {
      if (!b.alive[i]) continue;
      ctx.moveTo(b.x[i] - rx * 0.3 + rx * 0.2, b.y[i] - ry * 0.35);
      ctx.arc(b.x[i] - rx * 0.3, b.y[i] - ry * 0.35, rx * 0.2, 0, TAU);
    }
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fill();
    // a white ring around the balloons to catch
    if (hint) {
      ctx.beginPath();
      for (let i = 0; i < MAX_BALLOONS; i++) {
        if (!b.alive[i] || b.colour[i] !== target) continue;
        ctx.moveTo(b.x[i] + rx * pulse * 1.12, b.y[i]);
        ctx.ellipse(b.x[i], b.y[i], rx * pulse * 1.12, ry * pulse * 1.12, 0, 0, TAU);
      }
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.stroke();
    }
  }

  /** over each child: the dots of the count, the number that just popped, a star when done */
  private drawKidMarks(ctx: CanvasRenderingContext2D): void {
    const kit = this.kit;
    const h = kit.stage.h;
    const isCount = this.round.kind !== "colour";
    const n = this.count.n;
    const sp = h * 0.032;
    const dr = h * 0.011;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let s = 0; s < SLOTS; s++) {
      if (!this.present[s]) continue;
      const k = kit.kids[s];
      const cx = k.pts.head.x;
      // kept inside the screen (a child close to the top edge still sees the dots)
      const cy = Math.max(h * 0.1, k.pts.head.y - k.headR * 2.3);
      const done = isCount ? this.count.done[s] === 1 : this.colourDone[s] === 1;
      if (done) {
        starPath(ctx, cx, cy, h * 0.036);
        ctx.fillStyle = "#ffd23d";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ff9f1c";
        ctx.stroke();
      } else if (isCount) {
        const x0 = cx - ((n - 1) * sp) / 2;
        const c = this.count.count[s];
        for (let i = 0; i < n; i++) {
          ctx.beginPath();
          ctx.arc(x0 + i * sp, cy, dr, 0, TAU);
          ctx.fillStyle = i < c ? this.palette[4 + s] : "rgba(255,255,255,.6)";
          ctx.fill();
        }
      }
      if (this.popT[s] > 0) {
        const p = this.popT[s];
        ctx.font = this.fKid;
        const y = cy - h * 0.07 - (1 - p) * h * 0.04;
        ctx.globalAlpha = Math.min(1, p * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(DIGITS[this.popN[s]], cx + 3, y + 3);
        ctx.fillStyle = this.palette[4 + s];
        ctx.fillText(DIGITS[this.popN[s]], cx, y);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** the task, always on screen: a big number with that many objects, or the big colour */
  private drawCard(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const r = this.round;
    const ch = h * 0.17;
    const y = h * 0.33;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (r.kind === "colour") {
      const cw = ch * 1.2 + h * 0.32;
      const x = (w - cw) / 2;
      pillPath(ctx, x, y, cw, ch);
      ctx.fillStyle = "rgba(255,255,255,.82)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + ch * 0.55, y + ch / 2, ch * 0.36, 0, TAU);
      ctx.fillStyle = COLOURS[r.colour].hex;
      ctx.fill();
      ctx.font = this.fName;
      ctx.fillStyle = "#3a2a6b";
      ctx.fillText(COLOURS[r.colour].name, x + ch * 1.05 + (cw - ch * 1.15) / 2, y + ch * 0.52);
      return;
    }
    const gap = h * 0.095;
    const cw = ch * 1.1 + r.n * gap + h * 0.03;
    const x = (w - cw) / 2;
    pillPath(ctx, x, y, cw, ch);
    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.fill();
    ctx.font = this.fDigit;
    ctx.fillStyle = "#3a2a6b";
    ctx.fillText(DIGITS[r.n], x + ch * 0.6, y + ch * 0.54);
    ctx.font = this.fEmoji;
    ctx.fillStyle = "#000";
    const icon = r.kind === "jump" ? "🐰" : "👏";
    const best = this.count.best();
    for (let i = 0; i < r.n; i++) {
      ctx.globalAlpha = i < best ? 1 : 0.35;
      ctx.fillText(icon, x + ch * 1.2 + gap * 0.5 + i * gap, y + ch * 0.54);
    }
    ctx.globalAlpha = 1;
  }
}
