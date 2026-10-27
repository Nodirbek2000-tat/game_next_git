// Pufakchalar: soap bubbles float up, the children pop them with their hands. 2D only, pooled, no per-frame allocation.

import { KID_COLORS, KID_ANIMALS, starPath, type KidsGameInstance, type KidsKit } from "../bogcha/common";
import type { KidsGraph } from "../bogcha/common/music";
import {
  BubblePool,
  KIND_COLOUR,
  KIND_GOLD,
  MAX_BUBBLES,
  MAX_RINGS,
  MAX_SPARKS,
  Rings,
  SLOTS,
  Scorer,
  Spawner,
  Sparks,
  bubbleCap,
  circleHit,
  makeEnv,
  pawRadius,
  segHit,
  sparkCount,
} from "./logic";
import { PopSounds } from "./sound";

const TAU = Math.PI * 2;
/** palette indexes of sparks / rings: 0..4 = children colours, then these */
const C_WHITE = 5;
const C_GOLD = 6;

const PASTELS = ["rgba(110,200,255,.5)", "rgba(255,140,200,.5)", "rgba(130,245,180,.5)", "rgba(255,225,100,.5)", "rgba(190,150,255,.5)"] as const;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface PufakDebug {
  pops: number;
  spawned: number;
  alive: number;
  stars: number;
}

export class PufakGame implements KidsGameInstance {
  readonly pool = new BubblePool();
  readonly sparks = new Sparks();
  readonly rings = new Rings();
  readonly scorer = new Scorer();
  readonly spawner: Spawner;
  readonly env = makeEnv();
  private readonly sounds: PopSounds;
  private readonly prevX = new Float32Array(SLOTS * 2);
  private readonly prevY = new Float32Array(SLOTS * 2);
  private readonly prevOk = new Uint8Array(SLOTS * 2);
  // precomputed paint styles (no string building per frame)
  private readonly palette: string[] = [...KID_COLORS, "#ffffff", "#ffd23d"];
  private readonly colourFill: string[] = KID_COLORS.map((c) => rgba(c, 0.5));
  private readonly emoji: string[] = KID_ANIMALS.map((a) => a.emoji);
  private emojiFont = "";
  private fontH = 0;
  private primed = false;
  private started = false;
  private t = 0;
  private idle = 0;
  private praiseAt = -99;
  private nextMilestone = 10;
  private lastDraw = 0;
  private level: string | undefined;
  private readonly dbg: PufakDebug | null;

  constructor(
    private readonly kit: KidsKit,
    private readonly rnd: () => number = Math.random,
  ) {
    this.spawner = new Spawner(rnd);
    this.sounds = new PopSounds(() => (kit.engine.audio.graph?.() as KidsGraph | null | undefined) ?? null);
    this.dbg = kit.engine.query.get("debug") ? { pops: 0, spawned: 0, alive: 0, stars: 0 } : null;
    if (this.dbg && typeof window !== "undefined") (window as unknown as { __pufak?: PufakDebug }).__pufak = this.dbg;
  }

  onStart(): void {
    // called again after a pause: keep the bubbles, do not repeat the greeting
    kitMusic(this.kit);
    if (this.started) return;
    this.started = true;
    this.kit.voice.say("pop", 3200);
  }

  private praise(): void {
    if (this.t - this.praiseAt < 7) return;
    this.praiseAt = this.t;
    this.kit.voice.say("bravo", 1800);
  }

  update(dt: number): void {
    const kit = this.kit;
    const env = this.env;
    this.t += dt;
    env.w = kit.stage.w;
    env.h = kit.stage.h;
    this.level = kit.engine.quality?.level;
    let n = 0;
    for (let s = 0; s < SLOTS; s++) {
      const k = kit.kids[s];
      if (k.active && k.present) {
        env.kidX[n] = k.center.x;
        env.kidSlot[n] = s;
        n++;
      }
    }
    env.nKids = n;
    env.cap = bubbleCap(this.level, n);
    if (!this.primed) {
      this.primed = true;
      this.spawner.prefill(this.pool, env);
    }
    this.pool.step(dt);
    this.spawner.tick(dt, this.pool, env);
    this.hits();
    this.idle += dt;
    if (n > 0 && this.idle > 9) {
      this.idle = 0;
      kit.voice.say("handsUp", 2400);
    }
    if (this.dbg) {
      this.dbg.spawned = this.spawner.spawned;
      this.dbg.alive = this.pool.count;
      this.dbg.stars = kit.stars;
    }
  }

  private hits(): void {
    const kit = this.kit;
    const env = this.env;
    const pool = this.pool;
    const far2 = env.w * 0.35 * (env.w * 0.35);
    for (let s = 0; s < SLOTS; s++) {
      const k = kit.kids[s];
      const a = s * 2;
      if (!k.active || !k.present) {
        this.prevOk[a] = 0;
        this.prevOk[a + 1] = 0;
        continue;
      }
      if (k.joined) {
        this.prevOk[a] = 0;
        this.prevOk[a + 1] = 0;
      }
      const pr = pawRadius(k.scale, env.h);
      for (let hand = 0; hand < 2; hand++) {
        const w = hand ? k.pts.rw : k.pts.lw;
        const idx = a + hand;
        if (w.v < 0.25) {
          this.prevOk[idx] = 0;
          continue;
        }
        const px = this.prevX[idx];
        const py = this.prevY[idx];
        let sweep = this.prevOk[idx] === 1;
        if (sweep && (w.x - px) * (w.x - px) + (w.y - py) * (w.y - py) > far2) sweep = false;
        for (let i = 0; i < MAX_BUBBLES; i++) {
          if (!pool.alive[i]) continue;
          const rr = pool.r[i] + pr;
          const hit = sweep ? segHit(px, py, w.x, w.y, pool.x[i], pool.y[i], rr) : circleHit(pool.x[i], pool.y[i], pool.r[i], w.x, w.y, pr);
          if (hit) this.touched(i, s);
        }
        this.prevX[idx] = w.x;
        this.prevY[idx] = w.y;
        this.prevOk[idx] = 1;
      }
    }
  }

  private touched(i: number, slot: number): void {
    const kit = this.kit;
    const pool = this.pool;
    const x = pool.x[i];
    const y = pool.y[i];
    const r = pool.r[i];
    if (!pool.touch(i, slot)) {
      if (pool.alive[i] && pool.hurt[i] > 0) {
        // first touch of a golden bubble: it wobbles and "tings", a friend (or the same hand again) finishes it
        this.sounds.ting();
        this.sparks.burst(x, y, 5, C_GOLD, r * 2, Math.max(5, r * 0.1), this.rnd);
        this.idle = 0;
      }
      return;
    }
    const kind = pool.kind[i];
    const owner = pool.owner[i];
    const first = pool.first[i];
    pool.kill(i);
    this.scorer.pop(kind, owner, slot, first);
    const gold = kind === KIND_GOLD;
    const col = kind === KIND_COLOUR ? owner : slot;
    this.rings.add(x, y, r * 0.8, r * 2, gold ? C_GOLD : slot);
    this.sparks.burst(x, y, sparkCount(this.level, gold), col, r * 3.2, Math.max(5, r * 0.14), this.rnd, gold ? C_GOLD : C_WHITE);
    this.sounds.pop(slot, gold);
    this.idle = 0;
    const sc = this.scorer;
    const k = kit.kids[slot];
    if (sc.kidStars > 0) kit.award(k, sc.kidStars, x, y - r * 0.3);
    if (sc.groupStars > 0) kit.award(null, sc.groupStars, x, y - r * 1.2);
    if (sc.firstStars > 0) kit.award(kit.kids[sc.firstSlot], sc.firstStars);
    if (gold || sc.groupStars > 0) this.praise();
    if (kit.stars >= this.nextMilestone) {
      while (kit.stars >= this.nextMilestone) this.nextMilestone += 10;
      this.praise();
    }
    if (this.dbg) this.dbg.pops = sc.total;
  }

  drawFront(ctx: CanvasRenderingContext2D, now: number): void {
    const kit = this.kit;
    const h = kit.stage.h;
    const dt = this.lastDraw ? Math.min(0.05, (now - this.lastDraw) / 1000) : 0;
    this.lastDraw = now;
    this.sparks.step(dt, h * 0.45);
    this.rings.step(dt);
    if (h !== this.fontH) {
      this.fontH = h;
      this.emojiFont = `${Math.round(h * 0.1)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    }
    const pool = this.pool;
    const t = now / 1000;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // hand halos: each child sees where their touch points are, in their own colour
    ctx.globalAlpha = 0.32;
    for (let s = 0; s < SLOTS; s++) {
      const k = kit.kids[s];
      if (!k.active || !k.present) continue;
      const pr = pawRadius(k.scale, h);
      ctx.fillStyle = k.color;
      for (let hand = 0; hand < 2; hand++) {
        const p = hand ? k.pts.rw : k.pts.lw;
        if (p.v < 0.25) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pr, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // bubbles (hidden once the round is over)
    if (kit.timeLeft > 0) {
      for (let i = 0; i < MAX_BUBBLES; i++) {
        if (!pool.alive[i]) continue;
        const kind = pool.kind[i];
        const x = pool.x[i];
        const y = pool.y[i];
        const r = pool.r[i] * (1 + Math.sin(t * 2.6 + pool.phase[i]) * 0.04 + pool.hurt[i] * Math.sin(pool.hurt[i] * 18) * 0.12);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = kind === KIND_GOLD ? "rgba(255,214,70,.72)" : kind === KIND_COLOUR ? this.colourFill[pool.owner[i]] : PASTELS[pool.tint[i]];
        ctx.fill();
        ctx.lineWidth = Math.max(3, r * 0.07);
        ctx.strokeStyle = kind === KIND_GOLD ? "#fff2a8" : kind === KIND_COLOUR ? this.palette[pool.owner[i]] : "rgba(255,255,255,.85)";
        ctx.stroke();
        // shine
        ctx.beginPath();
        ctx.arc(x - r * 0.12, y - r * 0.12, r * 0.74, Math.PI * 1.08, Math.PI * 1.46);
        ctx.lineWidth = Math.max(3, r * 0.1);
        ctx.strokeStyle = "rgba(255,255,255,.9)";
        ctx.stroke();
        if (kind === KIND_COLOUR) {
          ctx.font = this.emojiFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#000";
          ctx.fillText(this.emoji[pool.owner[i]], x, y + r * 0.05);
        } else if (kind === KIND_GOLD) {
          starPath(ctx, x, y, r * 0.5);
          ctx.fillStyle = "#fff8d6";
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#ff9f1c";
          ctx.stroke();
          if (pool.hp[i] < 2) {
            // cracked after the first touch
            ctx.beginPath();
            ctx.moveTo(x - r * 0.55, y - r * 0.7);
            ctx.lineTo(x - r * 0.15, y - r * 0.35);
            ctx.lineTo(x - r * 0.35, y - r * 0.05);
            ctx.lineTo(x + r * 0.05, y + r * 0.3);
            ctx.lineWidth = Math.max(3, r * 0.05);
            ctx.strokeStyle = "rgba(255,255,255,.95)";
            ctx.stroke();
          }
        }
      }
    }

    // rings
    for (let i = 0; i < MAX_RINGS; i++) {
      const life = this.rings.life[i];
      if (life <= 0) continue;
      const e = 1 - life;
      ctx.globalAlpha = Math.min(1, life * 1.4);
      ctx.beginPath();
      ctx.arc(this.rings.x[i], this.rings.y[i], this.rings.r0[i] + (this.rings.r1[i] - this.rings.r0[i]) * e, 0, TAU);
      ctx.lineWidth = 3 + life * 8;
      ctx.strokeStyle = this.palette[this.rings.col[i]];
      ctx.stroke();
    }

    // sparkles (little plus signs), one fill style change per colour run
    let last = -1;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const life = this.sparks.life[i];
      if (life <= 0) continue;
      const c = this.sparks.col[i];
      if (c !== last) {
        ctx.fillStyle = this.palette[c];
        last = c;
      }
      const sz = this.sparks.size[i] * (0.5 + life * 0.7);
      const sx = this.sparks.x[i];
      const sy = this.sparks.y[i];
      ctx.globalAlpha = Math.min(1, life * 1.5);
      ctx.fillRect(sx - sz, sy - sz / 3, sz * 2, (sz * 2) / 3);
      ctx.fillRect(sx - sz / 3, sy - sz, (sz * 2) / 3, sz * 2);
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    if (this.dbg && typeof window !== "undefined") delete (window as unknown as { __pufak?: PufakDebug }).__pufak;
  }
}

function kitMusic(kit: KidsKit): void {
  // gentle lullaby-like loop a little faster than written; pops are tuned to the same key
  kit.music.play("calm", 1.3);
}
