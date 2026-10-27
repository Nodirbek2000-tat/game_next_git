// Meva Ninja rules — a straight port of the prototype's Ninja class, separated from rendering so it can be
// unit-tested. Units: stage CSS pixels and seconds. Items live in fixed pools (no allocation per frame).

import { segPointDist } from "@/engine/math";

export type ItemKind = "fruit" | "bomb" | "freeze" | "frenzy";

export interface FruitDef {
  id: string;
  r: number;
  sx?: number;
  sy?: number;
  juice: string;
}

/** Eight fruits (qovun and anor nod to Uzbekistan). `r` scales the collision / draw radius; the shape lives in geometry.ts. */
export const FRUIT_DEFS: FruitDef[] = [
  { id: "tarvuz", r: 1.35, juice: "#ff2d55" },
  { id: "apelsin", r: 1, juice: "#ff9a1f" },
  { id: "olma", r: 0.95, juice: "#e9f5b0" },
  { id: "banan", r: 1.05, juice: "#fff0a0" },
  { id: "ananas", r: 1.1, juice: "#ffe34d" },
  { id: "kivi", r: 0.85, juice: "#9be15d" },
  { id: "anor", r: 1.0, juice: "#e0115f" },
  { id: "qovun", r: 1.25, juice: "#ffc46b" },
];

export interface Item {
  active: boolean;
  kind: ItemKind;
  def: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** collision / draw radius in px */
  rpx: number;
  rv0: number;
  rv1: number;
  g: number;
  /** renderer-owned handle (the pooled 3D object) */
  obj: unknown;
}

export interface Half {
  active: boolean;
  def: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  rpx: number;
  life: number;
  spin: number;
  rz: number;
  ang: number;
  side: 1 | -1;
  obj: unknown;
}

export interface BladeLike {
  /** party mode: unique id of the hand track (swipe combos are counted per hand) */
  id?: number;
  active: boolean;
  side: "L" | "R";
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  speed: number;
}

export interface NinjaEvents {
  score(player: number, delta: number, x: number, y: number, color: string, size: number): void;
  popup(text: string, x: number, y: number, color: string, size: number, life?: number): void;
  bomb(x: number, y: number, rpx: number): void;
  freeze(x: number, y: number): void;
  frenzy(x: number, y: number): void;
  /** ang = direction of the cutting blade (rad), blade = the hand that cut */
  slice(x: number, y: number, juice: string, crit: boolean, rpx: number, ang: number, blade: BladeLike): void;
  combo(n: number): void;
  spawnItem(item: Item): void;
  spawnHalf(half: Half, srcItem: Item): void;
}

export interface NinjaOptions {
  w: number;
  h: number;
  kids: boolean;
  players: number;
  /** minimum blade speed (screen heights / s) that cuts */
  minSpeed: number;
  rng?: () => number;
  duration?: number;
}

interface Swipe {
  n: number;
  t: number;
  x: number;
  y: number;
  player: number;
}

const A = { x: 0, y: 0 }; // scratch point (no allocation per frame)
const ITEM_POOL = 40;
const HALF_POOL = 24;
const SWIPE_WINDOW = 260;

export class NinjaLogic {
  readonly items: Item[] = [];
  readonly halves: Half[] = [];
  readonly duration: number;
  w: number;
  h: number;
  kids: boolean;
  minSpeed: number;
  time = 0;
  over = false;
  freezeT = 0;
  frenzyT = 0;
  sliced = 0;
  spawned = 0;
  bombs = 0;
  maxCombo = 0;
  scores: number[];
  private spawnT = 0.8;
  private queue: { t: number; kind: ItemKind | undefined }[] = [];
  private swipes = new Map<string, Swipe>();
  private rng: () => number;
  private ev: NinjaEvents;

  constructor(o: NinjaOptions, events: NinjaEvents) {
    this.w = o.w;
    this.h = o.h;
    this.kids = o.kids;
    this.minSpeed = o.minSpeed;
    this.duration = o.duration ?? 60;
    this.rng = o.rng ?? Math.random;
    this.ev = events;
    this.scores = Array.from({ length: o.players }, () => 0);
    for (let i = 0; i < ITEM_POOL; i++) this.items.push({ active: false, kind: "fruit", def: 0, x: 0, y: 0, vx: 0, vy: 0, rpx: 10, rv0: 0, rv1: 0, g: 0, obj: null });
    for (let i = 0; i < HALF_POOL; i++) this.halves.push({ active: false, def: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, rpx: 10, life: 0, spin: 0, rz: 0, ang: 0, side: 1, obj: null });
  }

  get total(): number {
    return this.scores.reduce((a, b) => a + b, 0);
  }

  private rnd(a: number, b: number): number {
    return a + this.rng() * (b - a);
  }
  private rndi(a: number, b: number): number {
    return Math.floor(this.rnd(a, b + 1));
  }

  private nextItem(): Item | null {
    for (const it of this.items) if (!it.active) return it;
    return null;
  }

  spawn(kind?: ItemKind): void {
    const it = this.nextItem();
    if (!it) return;
    const { w, h } = this;
    const G = (this.kids ? 0.95 : 1.25) * h;
    const x0 = this.rnd(0.14, 0.86) * w;
    const y0 = h + 0.08 * h;
    const apex = this.rnd(0.1, 0.38) * h;
    const vy = -Math.sqrt(2 * G * (y0 - apex));
    const T = (2 * -vy) / G;
    const vx = ((w * this.rnd(0.3, 0.7) - x0) / T) * this.rnd(0.5, 1.1);
    it.kind = kind ?? "fruit";
    it.def = 0;
    if (it.kind === "bomb") it.rpx = 0.062 * h;
    else if (it.kind === "freeze" || it.kind === "frenzy") it.rpx = 0.06 * h;
    else {
      it.def = this.rndi(0, FRUIT_DEFS.length - 1);
      it.rpx = 0.058 * h * FRUIT_DEFS[it.def].r * (this.kids ? 1.25 : 1);
    }
    it.x = x0;
    it.y = y0;
    it.vx = vx;
    it.vy = vy;
    it.g = G;
    it.rv0 = this.rnd(-3, 3);
    it.rv1 = this.rnd(-3, 3);
    it.active = true;
    it.obj = null;
    this.spawned++;
    this.ev.spawnItem(it);
  }

  update(dt: number, blades: readonly BladeLike[], player: readonly number[], nowMs: number): void {
    if (this.over) return;
    this.time += dt;
    if (this.time >= this.duration) {
      this.over = true;
    }
    const ts = this.freezeT > 0 ? 0.35 : 1;
    this.freezeT -= dt;
    this.frenzyT -= dt;
    const pdt = dt * ts;
    // spawning
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.time < this.duration - 1) {
      const lvl = Math.min(4, Math.floor(this.time / 15));
      const n = this.rndi(1, 2 + lvl);
      for (let i = 0; i < n; i++) this.queue.push({ t: this.time + i * 0.12, kind: undefined });
      if (!this.kids && this.rng() < 0.14 + lvl * 0.03) this.queue.push({ t: this.time + 0.2, kind: "bomb" });
      if (this.time > 8 && this.rng() < 0.07) this.spawn(this.rng() < 0.5 ? "freeze" : "frenzy");
      this.spawnT = this.frenzyT > 0 ? this.rnd(0.25, 0.4) : this.rnd(0.75, 1.35) - lvl * 0.08;
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].t <= this.time) {
        this.spawn(this.queue[i].kind);
        this.queue.splice(i, 1);
      }
    }
    // physics
    for (const it of this.items) {
      if (!it.active) continue;
      it.vy += it.g * pdt;
      it.x += it.vx * pdt;
      it.y += it.vy * pdt;
      if (it.y > this.h + it.rpx * 3 && it.vy > 0) it.active = false;
    }
    for (const hf of this.halves) {
      if (!hf.active) continue;
      hf.vy += hf.g * pdt;
      hf.x += hf.vx * pdt;
      hf.y += hf.vy * pdt;
      hf.life -= dt;
      if (hf.life <= 0 || hf.y > this.h * 1.3) hf.active = false;
    }
    // blades (a blade must be fast enough, otherwise it only points)
    for (let bi = 0; bi < blades.length; bi++) {
      const b = blades[bi];
      if (!b.active || b.speed < this.minSpeed) continue;
      A.x = b.px - (b.x - b.px) * 0.3;
      A.y = b.py - (b.y - b.py) * 0.3;
      for (const it of this.items) {
        if (!it.active) continue;
        if (segPointDist(it, A, b) < it.rpx * 1.08) this.cut(it, b, player[bi], nowMs);
      }
    }
    // swipe combo windows
    for (const [k, s] of this.swipes) {
      if (nowMs - s.t > SWIPE_WINDOW) {
        if (s.n >= 3) {
          this.addScore(s.player, s.n * 10, s.x, s.y - 60, "#ffd23f", 40);
          this.ev.popup(`${s.n} MEVA KOMBO!`, s.x, s.y - 110, "#fff", 30, 1.1);
          this.ev.combo(s.n);
        }
        this.swipes.delete(k);
      }
    }
  }

  private addScore(player: number, n: number, x: number, y: number, col: string, size: number): void {
    this.scores[player] = Math.max(0, this.scores[player] + n);
    this.ev.score(player, n, x, y, col, size);
  }

  private cut(it: Item, b: BladeLike, player: number, nowMs: number): void {
    it.active = false;
    const ang = Math.atan2(b.vy, b.vx);
    if (it.kind === "bomb") {
      this.bombs++;
      this.addScore(player, -30, it.x, it.y, "#ff6b6b", 44);
      this.ev.bomb(it.x, it.y, it.rpx);
      return;
    }
    if (it.kind === "freeze") {
      this.freezeT = 5;
      this.ev.freeze(it.x, it.y);
      return;
    }
    if (it.kind === "frenzy") {
      this.frenzyT = 6;
      this.ev.frenzy(it.x, it.y);
      return;
    }
    this.sliced++;
    const crit = this.rng() < 0.08;
    const mult = this.frenzyT > 0 ? 2 : 1;
    const pts = (crit ? 30 : 10) * mult;
    this.addScore(player, pts, it.x, it.y - 30, crit ? "#ff4fa3" : "#ffe66d", crit ? 40 : 30);
    if (crit) this.ev.popup("KRITIK!", it.x, it.y - 80, "#ff4fa3", 30);
    this.ev.slice(it.x, it.y, FRUIT_DEFS[it.def].juice, crit, it.rpx, ang, b);
    // two halves fly apart perpendicular to the cut
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    for (const s of [1, -1] as const) {
      const hf = this.halves.find((x) => !x.active);
      if (!hf) break;
      hf.active = true;
      hf.def = it.def;
      hf.side = s;
      hf.ang = ang;
      hf.x = it.x + nx * s * it.rpx * 0.2;
      hf.y = it.y + ny * s * it.rpx * 0.2;
      hf.vx = it.vx * 0.6 + nx * s * this.h * 0.22 + b.vx * 0.08;
      hf.vy = it.vy * 0.5 + ny * s * this.h * 0.22 + b.vy * 0.08;
      hf.g = it.g;
      hf.rpx = it.rpx;
      hf.life = 2.2;
      hf.spin = s * this.rnd(3, 6);
      hf.rz = s * this.rnd(-2, 2);
      hf.obj = null;
      this.ev.spawnHalf(hf, it);
    }
    const key = `${player}${b.id ?? b.side}`;
    const sw = this.swipes.get(key) ?? { n: 0, t: nowMs, x: it.x, y: it.y, player };
    sw.n++;
    sw.t = nowMs;
    sw.x = it.x;
    sw.y = it.y;
    this.swipes.set(key, sw);
    this.maxCombo = Math.max(this.maxCombo, sw.n);
  }

  get accuracy(): number {
    return Math.round((this.sliced / Math.max(1, this.spawned - this.bombs)) * 100);
  }
}
