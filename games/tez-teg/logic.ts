// Tez teg: pure logic. Targets pop up around the player's body (high, sides, low near the knees) and must be touched
// with a hand (or a knee for the low ones) before they vanish. The faster the touch, the more points.

export interface Lmv {
  x: number;
  y: number;
  v: number;
}

export const VIS = 0.35;

/** body measures in stage px, rebuilt every spawn */
export interface Body {
  cx: number;
  noseY: number;
  shoulderY: number;
  hipY: number;
  /** shoulder width */
  s: number;
  /** torso length */
  T: number;
  legs: boolean;
}

export function makeBody(): Body {
  return { cx: 0, noseY: 0, shoulderY: 0, hipY: 0, s: 0, T: 0, legs: false };
}

/** false when the shoulders / hips are not visible */
export function bodyFrame(lm: ArrayLike<Lmv>, out: Body): boolean {
  const ls = lm[11];
  const rs = lm[12];
  const lh = lm[23];
  const rh = lm[24];
  const nose = lm[0];
  if (!ls || !rs || !lh || !rh || ls.v < VIS || rs.v < VIS) return false;
  out.cx = (ls.x + rs.x) / 2;
  out.shoulderY = (ls.y + rs.y) / 2;
  out.noseY = nose && nose.v > VIS ? nose.y : out.shoulderY - Math.abs(ls.x - rs.x) * 0.6;
  const hipOk = lh.v > VIS && rh.v > VIS;
  out.s = Math.max(30, Math.abs(ls.x - rs.x));
  out.hipY = hipOk ? (lh.y + rh.y) / 2 : out.shoulderY + out.s * 1.3;
  out.T = Math.max(out.s * 0.8, out.hipY - out.shoulderY);
  const lk = lm[25];
  const rk = lm[26];
  out.legs = hipOk && !!lk && !!rk && lk.v > VIS && rk.v > VIS;
  return true;
}

/** 0 high-left, 1 high-right, 2 side-left, 3 side-right, 4 knee-left, 5 knee-right */
export const ZONES = 6;
export const isKneeZone = (z: number): boolean => z >= 4;

/** where a zone's target sits for this body (inside the screen, away from the top HUD and the bottom buttons) */
export function zonePos(zone: number, b: Body, w: number, h: number, out: { x: number; y: number; r: number }): void {
  const side = zone % 2 === 0 ? -1 : 1;
  let x = b.cx;
  let y = b.shoulderY;
  if (zone < 2) {
    x = b.cx + side * b.s * 0.9;
    y = b.noseY - b.T * 0.75;
  } else if (zone < 4) {
    x = b.cx + side * Math.max(b.s * 1.9, b.T * 1.0);
    y = b.shoulderY + b.T * 0.3;
  } else {
    x = b.cx + side * b.s * 0.55;
    y = b.hipY + b.T * 0.4;
  }
  const r = Math.max(34, Math.min(64, b.s * 0.42));
  const mx = r + 8;
  out.x = Math.min(w - mx, Math.max(mx, x));
  out.y = Math.min(h - 110 - r, Math.max(100 + r, y));
  out.r = r;
}

/** 50 points for any touch + up to 50 more for a fast one */
export function scoreFor(age: number, life: number): number {
  const k = Math.min(1, Math.max(0, 1 - age / life));
  return 50 + Math.round(50 * k);
}

export const touches = (px: number, py: number, tx: number, ty: number, r: number): boolean => (px - tx) * (px - tx) + (py - ty) * (py - ty) <= r * r;

export interface Target {
  on: boolean;
  zone: number;
  x: number;
  y: number;
  r: number;
  age: number;
  life: number;
  /** seconds left of the "caught" flash (the game draws it) */
  done: number;
}

/** the points that can touch: 2 hands + 2 knees (ok = tracked) */
export interface Touchers {
  hx: number[];
  hy: number[];
  hok: boolean[];
  kx: number[];
  ky: number[];
  kok: boolean[];
}

export function makeTouchers(): Touchers {
  return { hx: [0, 0], hy: [0, 0], hok: [false, false], kx: [0, 0], ky: [0, 0], kok: [false, false] };
}

export interface TegEvents {
  spawn(t: Target): void;
  hit(t: Target, pts: number, ms: number, combo: number): void;
  miss(t: Target): void;
}

export const MAX_TARGETS = 3;

export class TegLogic {
  readonly targets: Target[] = [];
  score = 0;
  hits = 0;
  misses = 0;
  combo = 0;
  bestCombo = 0;
  time = 0;
  over = false;
  private reactSum = 0;
  private next = 0.8;

  constructor(
    readonly duration: number,
    private readonly rand: () => number,
    private readonly ev: TegEvents,
  ) {
    for (let i = 0; i < MAX_TARGETS; i++) this.targets.push({ on: false, zone: 0, x: 0, y: 0, r: 40, age: 0, life: 1.6, done: 0 });
  }

  get avgMs(): number {
    return this.hits ? Math.round((this.reactSum / this.hits) * 1000) : 0;
  }

  private pickZone(legs: boolean): number {
    for (let tries = 0; tries < 8; tries++) {
      const z = Math.floor(this.rand() * (legs ? ZONES : 4));
      // the low (knee) ones are rarer
      if (isKneeZone(z) && this.rand() < 0.35) continue;
      let busy = false;
      for (const t of this.targets) if (t.on && t.zone === z) busy = true;
      if (!busy) return z;
    }
    return -1;
  }

  update(dt: number, w: number, h: number, body: Body | null, tc: Touchers | null): void {
    if (this.over) return;
    this.time += dt;
    const k = Math.min(1, this.time / this.duration);
    const maxOn = k < 0.3 ? 1 : k < 0.7 ? 2 : 3;
    let on = 0;
    for (const t of this.targets) {
      if (t.done > 0) t.done -= dt;
      if (!t.on) continue;
      on++;
      t.age += dt;
      if (tc) {
        let got = false;
        if (!isKneeZone(t.zone)) {
          for (let i = 0; i < 2; i++) if (tc.hok[i] && touches(tc.hx[i], tc.hy[i], t.x, t.y, t.r + 10)) got = true;
        } else {
          for (let i = 0; i < 2; i++) if (tc.kok[i] && touches(tc.kx[i], tc.ky[i], t.x, t.y, t.r + 14)) got = true;
        }
        if (got) {
          const pts = scoreFor(t.age, t.life) + Math.min(this.combo, 10) * 5;
          this.score += pts;
          this.hits++;
          this.combo++;
          this.bestCombo = Math.max(this.bestCombo, this.combo);
          this.reactSum += t.age;
          t.on = false;
          t.done = 0.35;
          on--;
          this.ev.hit(t, pts, Math.round(t.age * 1000), this.combo);
          continue;
        }
      }
      if (t.age >= t.life) {
        t.on = false;
        on--;
        this.misses++;
        this.combo = 0;
        this.ev.miss(t);
      }
    }
    this.next -= dt;
    if (this.next <= 0 && on < maxOn && body) {
      const z = this.pickZone(body.legs);
      const t = this.targets.find((x) => !x.on);
      if (z >= 0 && t) {
        t.on = true;
        t.zone = z;
        t.age = 0;
        t.life = 1.9 - 0.9 * k;
        t.done = 0;
        zonePos(z, body, w, h, t);
        this.ev.spawn(t);
        this.next = 1.05 - 0.45 * k + this.rand() * 0.25;
      }
    }
    if (this.time >= this.duration) this.over = true;
  }
}
