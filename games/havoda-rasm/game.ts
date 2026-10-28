// Havoda rasm: the children paint in the air. Every wrist that is held up leaves a thick trail in the child's colour on ONE shared
// picture. The picture is an offscreen canvas that only ever receives the newest short segment (the history is never redrawn);
// the screen gets one drawImage per frame. 2D only, no gradients / shadows / filters, no allocation per frame.

import { KID_COLORS, type KidSlot, type KidsGameInstance, type KidsKit } from "../bogcha/common";
import type { KidsGraph } from "../bogcha/common/music";
import { Guide, Meter, SHAPE_INFO, SLOTS, Sparks, StrokeBuffer, WRISTS, buildSchedule, guideTol, type Schedule } from "./logic";
import { Speaker } from "./say";
import { PaintSounds } from "./sound";
import { drawSparks } from "./spark-draw";
import { downloadPicture, makeSaveButton, removeKeepsake, showKeepsake } from "./keepsake";

const TAU = Math.PI * 2;
/** palette indexes of sparks: 0..4 = children colours, then white (5), gold (6) */
const C_GOLD = 6;
/** a guide counts as drawn when this share of its points is covered */
export const GUIDE_DONE = 0.55;
/** one star per this many guide points a child painted */
export const POINTS_PER_STAR = 5;
/** ink (px of stroke) a child needs for the first participation star */
export const FIRST_STAR_INK = 300;
const MAX_LAYER_W = 1280;
const SHADES = 6;

function mix(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - t) + 255 * t);
  const g = Math.round(((n >> 8) & 255) * (1 - t) + 255 * t);
  const b = Math.round((n & 255) * (1 - t) + 255 * t);
  return `rgb(${r},${g},${b})`;
}

export interface HavodaDebug {
  segments: number;
  deferred: number;
  guideHits: number;
  prompts: number;
  shape: string;
  phase: string;
  stars: number;
  saved: number;
  clapBursts: number;
}

export class HavodaGame implements KidsGameInstance {
  readonly stroke = new StrokeBuffer();
  readonly guide = new Guide();
  readonly sparks = new Sparks();
  readonly meter = new Meter();
  readonly schedule: Schedule;
  private readonly speaker: Speaker;
  private readonly sounds: PaintSounds;
  private readonly palette: string[] = [...KID_COLORS, "#ffffff", "#ffd23d"];
  private readonly shades: string[][] = KID_COLORS.map((c) => {
    const out: string[] = [];
    for (let i = 0; i < SHADES; i++) out.push(mix(c, 0.32 * Math.abs(Math.sin((i / SHADES) * Math.PI))));
    return out;
  });
  // pen state of the 10 wrists (for the pen tips)
  private readonly penOn = new Uint8Array(WRISTS);
  private readonly penX = new Float32Array(WRISTS);
  private readonly penY = new Float32Array(WRISTS);
  private readonly ink = new Float32Array(SLOTS);
  private readonly inkStar = new Uint8Array(SLOTS);
  // the picture
  private layer: HTMLCanvasElement | null = null;
  private lctx: CanvasRenderingContext2D | null = null;
  private sc = 1;
  private stageW = 0;
  private stageH = 0;
  private penW = 10;
  private guideFont = "";
  private guidePath: Path2D | null = null;
  private gx = 0;
  private gy = 0;
  // timeline
  private phase: "draw" | "gallery" = "draw";
  private nextPrompt = 0;
  private promptOn = false;
  private guideDone = false;
  private guideAlpha = 0;
  private galleryT = 0;
  private fireT = 0;
  private idle = 0;
  private started = false;
  private btn: HTMLButtonElement | null = null;
  private readonly dbg: HavodaDebug | null;

  constructor(
    private readonly kit: KidsKit,
    firstShape = 0,
  ) {
    removeKeepsake();
    this.schedule = buildSchedule(kit.roundSec, firstShape);
    this.speaker = new Speaker(kit);
    this.sounds = new PaintSounds(() => (kit.engine.audio.graph?.() as KidsGraph | null | undefined) ?? null);
    this.dbg = kit.engine.query.get("debug")
      ? { segments: 0, deferred: 0, guideHits: 0, prompts: 0, shape: "", phase: "draw", stars: 0, saved: 0, clapBursts: 0 }
      : null;
    if (this.dbg && typeof window !== "undefined") (window as unknown as { __havoda?: HavodaDebug }).__havoda = this.dbg;
  }

  onStart(): void {
    if (this.started) return; // called again after a pause
    this.started = true;
    this.speaker.say("Havoda rasm chizamiz!", "🎨", 2600);
  }

  dispose(): void {
    this.btn?.remove();
    this.btn = null;
    // the scene is unmounted when the results screen opens: the picture and the save button move to a small DOM panel
    if (this.phase === "gallery" && this.layer) showKeepsake(this.layer, this.onSaved);
  }

  private readonly onSaved = (): void => {
    if (this.dbg) this.dbg.saved++;
  };

  // ---------------------------------------------------------------- the picture

  private ensureLayer(w: number, h: number): void {
    if (this.layer && w === this.stageW && h === this.stageH) return;
    const sc = Math.min(1, MAX_LAYER_W / w);
    const lw = Math.max(1, Math.ceil(w * sc));
    const lh = Math.max(1, Math.ceil(h * sc));
    const c = document.createElement("canvas");
    c.width = lw;
    c.height = lh;
    const x = c.getContext("2d");
    if (!x) return;
    if (this.layer) x.drawImage(this.layer, 0, 0, lw, lh); // stage resized: keep the picture
    x.lineCap = "round";
    x.lineJoin = "round";
    this.layer = c;
    this.lctx = x;
    this.sc = sc;
    this.stageW = w;
    this.stageH = h;
    this.penW = Math.max(12, h * 0.034);
    this.guideFont = `${Math.round(h * 0.16)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  }

  /** paints the newest segment of wrist `wi` onto the picture */
  private paint(slot: number, wi: number): void {
    const x = this.lctx;
    if (!x) return;
    const s = this.stroke.seg;
    const sc = this.sc;
    const lw = this.penW * sc * (0.88 + 0.12 * Math.sin(this.stroke.dist[wi] * 0.04));
    x.beginPath();
    x.moveTo(s.x0 * sc, s.y0 * sc);
    x.lineTo(s.x1 * sc, s.y1 * sc);
    x.lineWidth = lw;
    x.strokeStyle = this.shades[slot][((this.stroke.dist[wi] / 40) | 0) % SHADES];
    x.stroke();
    // a thin bright core makes the trail look lit, without any blur
    x.lineWidth = lw * 0.28;
    x.strokeStyle = "rgba(255,255,255,.55)";
    x.stroke();
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    this.ink[slot] += Math.sqrt(dx * dx + dy * dy);
  }

  // ---------------------------------------------------------------- prompts

  private startPrompt(): void {
    const p = this.schedule.prompts[this.nextPrompt++];
    const kit = this.kit;
    this.guide.build(p.shape, kit.stage.w, kit.stage.h);
    this.guideDone = false;
    this.promptOn = true;
    this.guideAlpha = 1;
    const g = this.guide;
    let sx = 0;
    let sy = 0;
    const path = typeof Path2D !== "undefined" ? new Path2D() : null;
    for (let i = 0; i < g.n; i++) {
      sx += g.x[i];
      sy += g.y[i];
      if (path) {
        if (g.brk[i]) path.moveTo(g.x[i], g.y[i]);
        else path.lineTo(g.x[i], g.y[i]);
      }
    }
    if (path && p.shape === "sun") path.closePath();
    this.guidePath = path;
    this.gx = sx / Math.max(1, g.n);
    this.gy = sy / Math.max(1, g.n);
    const info = SHAPE_INFO[p.shape];
    this.speaker.say(info.text, info.icon, 3600);
    if (this.dbg) {
      this.dbg.prompts++;
      this.dbg.shape = p.shape;
    }
  }

  private completeGuide(): void {
    const kit = this.kit;
    this.guideDone = true;
    const g = this.guide;
    for (let i = 0; i < g.n; i++) {
      const o = g.owner[i];
      this.sparks.burst(g.x[i], g.y[i], 2, o >= 0 ? o : C_GOLD, kit.stage.h * 0.25, kit.stage.h * 0.012);
    }
    kit.award(null, 1, kit.stage.w / 2, kit.stage.h * 0.4);
    kit.sfx.yay();
    kit.voice.say("bravo", 2000);
  }

  private enterGallery(): void {
    const kit = this.kit;
    this.phase = "gallery";
    this.promptOn = false;
    this.guideAlpha = 0;
    this.galleryT = 0;
    for (let w = 0; w < WRISTS; w++) {
      this.stroke.lift(w);
      this.penOn[w] = 0;
    }
    kit.sfx.yay();
    kit.voice.say("bravo", 4500);
    if (typeof document !== "undefined" && !this.btn) {
      const b = makeSaveButton(() => this.save());
      b.style.cssText += ";position:fixed;right:16px;bottom:16px;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.3)";
      document.body.appendChild(b);
      this.btn = b;
    }
  }

  /** downloads the group picture as a PNG (for the teacher) */
  save(): void {
    if (this.layer) downloadPicture(this.layer, this.onSaved);
  }

  // ---------------------------------------------------------------- update

  private hipY(k: KidSlot): number {
    const p = k.pts;
    if (p.lh.v > 0.25 && p.rh.v > 0.25) return (p.lh.y + p.rh.y) / 2;
    return (p.ls.y + p.rs.y) / 2 + k.scale * 1.5;
  }

  update(dt: number): void {
    const kit = this.kit;
    const w = kit.stage.w;
    const h = kit.stage.h;
    this.ensureLayer(w, h);
    const t = kit.roundSec - kit.timeLeft;
    const sched = this.schedule;

    if (this.phase === "draw" && t >= sched.galleryAt) this.enterGallery();

    if (this.phase === "draw") {
      const prompts = sched.prompts;
      if (this.nextPrompt < prompts.length && t >= prompts[this.nextPrompt].start) this.startPrompt();
      if (this.promptOn && t >= prompts[this.nextPrompt - 1].end) this.promptOn = false;
      // the guide fades in / out
      const want = this.promptOn && !this.guideDone ? 1 : 0;
      this.guideAlpha += (want - this.guideAlpha) * Math.min(1, dt * 3);
      if (!this.promptOn && this.guideAlpha < 0.02) this.guideAlpha = 0;
    }

    this.stroke.beginFrame();
    const tol = guideTol(w, h);
    let anyPen = false;
    let any = false;
    for (let s = 0; s < SLOTS; s++) {
      const k = kit.kids[s];
      const wa = s * 2;
      if (!(k.active && k.present)) {
        this.stroke.lift(wa);
        this.stroke.lift(wa + 1);
        this.penOn[wa] = 0;
        this.penOn[wa + 1] = 0;
        continue;
      }
      any = true;
      const lim = this.hipY(k) - k.scale * 0.25;
      for (let side = 0; side < 2; side++) {
        const wi = wa + side;
        const pt = side ? k.pts.rw : k.pts.lw;
        // pen down while the hand is above the hips (arms hanging down do not paint) and the picture is still open
        if (this.phase === "draw" && pt.v > 0.3 && pt.y < lim) {
          anyPen = true;
          this.penOn[wi] = 1;
          this.penX[wi] = pt.x;
          this.penY[wi] = pt.y;
          if (this.stroke.move(wi, pt.x, pt.y)) {
            this.paint(s, wi);
            if (this.promptOn && !this.guideDone) {
              const sg = this.stroke.seg;
              const got = this.guide.hitSeg(sg.x0, sg.y0, sg.x1, sg.y1, tol, s);
              if (got > 0) this.guideHit(k, got);
            }
          }
        } else {
          this.stroke.lift(wi);
          this.penOn[wi] = 0;
        }
      }
      if (!this.inkStar[s] && this.ink[s] >= FIRST_STAR_INK) {
        this.inkStar[s] = 1;
        kit.award(k, 1);
      }
      if (k.signals.clapFired) this.clap(k);
    }
    if (this.promptOn && !this.guideDone && this.guide.progress >= GUIDE_DONE) this.completeGuide();

    // gentle nudge when nobody paints for a while
    if (this.phase === "draw") {
      this.idle = anyPen || !any ? 0 : this.idle + dt;
      if (this.idle > 9) {
        this.idle = 0;
        kit.voice.say("handsUp", 2400);
      }
    } else {
      // the picture is shown: fireworks in the colours of the children who are still there
      this.galleryT += dt;
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = 0.55;
        const s = (Math.random() * SLOTS) | 0;
        this.sparks.burst(w * (0.1 + Math.random() * 0.8), h * (0.25 + Math.random() * 0.5), 14, s, h * 0.45, h * 0.014);
        this.sounds.fire(s);
      }
    }
    this.sparks.step(dt, h * 0.35);
    if (this.dbg) {
      this.dbg.segments = this.stroke.segCount;
      this.dbg.deferred = this.stroke.deferred;
      this.dbg.phase = this.phase;
      this.dbg.stars = kit.stars;
    }
  }

  private guideHit(k: KidSlot, got: number): void {
    const g = this.guide;
    const h = this.kit.stage.h;
    let lx = 0;
    let ly = 0;
    for (let j = 0; j < got; j++) {
      const i = g.fresh[j];
      lx = g.x[i];
      ly = g.y[i];
      this.sparks.burst(lx, ly, 2, k.slot, h * 0.18, h * 0.011);
    }
    this.sounds.chime(k.slot);
    if (this.dbg) this.dbg.guideHits += got;
    const stars = this.meter.add(k.slot, got, POINTS_PER_STAR);
    if (stars > 0) this.kit.award(k, stars, lx, ly - h * 0.04);
  }

  private clap(k: KidSlot): void {
    const p = k.pts;
    const both = p.lw.v > 0.3 && p.rw.v > 0.3;
    const x = both ? (p.lw.x + p.rw.x) / 2 : p.head.x;
    const y = both ? (p.lw.y + p.rw.y) / 2 : p.head.y - k.headR * 2;
    const h = this.kit.stage.h;
    this.sparks.burst(x, y, 20, k.slot, h * 0.5, h * 0.015);
    this.sparks.burst(x, y, 7, C_GOLD, h * 0.3, h * 0.012);
    this.sounds.fire(k.slot);
    if (this.dbg) this.dbg.clapBursts++;
  }

  // ---------------------------------------------------------------- paint

  drawBack(ctx: CanvasRenderingContext2D): void {
    if (this.guideAlpha <= 0.02) return;
    const h = this.kit.stage.h;
    const g = this.guide;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = h * 0.04;
    ctx.globalAlpha = this.guideAlpha * 0.42;
    if (this.guidePath) ctx.stroke(this.guidePath);
    // points that were already painted light up in the colour of the child who painted them
    ctx.globalAlpha = this.guideAlpha * 0.9;
    const r = h * 0.017;
    for (let i = 0; i < g.n; i++) {
      if (!g.covered[i]) continue;
      ctx.fillStyle = this.palette[g.owner[i] >= 0 ? g.owner[i] : C_GOLD];
      ctx.beginPath();
      ctx.arc(g.x[i], g.y[i], r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = this.guideAlpha * 0.25;
    ctx.font = this.guideFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000";
    ctx.fillText(SHAPE_INFO[g.shape].icon, this.gx, this.gy);
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  drawFront(ctx: CanvasRenderingContext2D, now: number): void {
    const w = this.kit.stage.w;
    const h = this.kit.stage.h;
    const L = this.layer;
    if (this.phase === "gallery") {
      if (L) {
        const u = Math.min(1, this.galleryT / 0.7);
        const e = 1 - (1 - u) * (1 - u) * (1 - u);
        const k = 0.3 + 0.32 * e;
        const pw = w * k;
        const ph = h * k;
        const px = (w - pw) / 2;
        const py = h * 0.58 - ph / 2;
        const b = Math.max(6, h * 0.012);
        ctx.fillStyle = "#c98a4b";
        ctx.fillRect(px - b, py - b, pw + b * 2, ph + b * 2);
        ctx.fillStyle = "#fff7e6";
        ctx.fillRect(px, py, pw, ph);
        ctx.drawImage(L, px, py, pw, ph);
      }
    } else {
      if (L) ctx.drawImage(L, 0, 0, w, h);
      // pen tips: a dot in the colour of the child where the pen touches the air
      const r = this.penW * 0.62;
      for (let i = 0; i < WRISTS; i++) {
        if (!this.penOn[i]) continue;
        ctx.fillStyle = this.palette[i >> 1];
        ctx.beginPath();
        ctx.arc(this.penX[i], this.penY[i], r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.85)";
        ctx.beginPath();
        ctx.arc(this.penX[i], this.penY[i], r * 0.38, 0, TAU);
        ctx.fill();
      }
    }
    if (this.kit.playing) drawSparks(ctx, this.sparks, this.palette, now);
  }
}
