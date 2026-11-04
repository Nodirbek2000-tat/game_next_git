// Basketbol: pure logic. The ball sits in the player's hand; a fast upward push throws it. The flight direction comes from the hand
// velocity, blended with an aim assist toward the hoop (so a decent push is enough). Screen units: px, gravity in px/s^2.

export interface Hand {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ok: boolean;
}

export interface V2 {
  x: number;
  y: number;
}

export const FLIGHT = 1.0;

/** velocity that carries a ball from (x0, y0) to (tx, ty) in `T` seconds under gravity g */
export function idealVel(x0: number, y0: number, tx: number, ty: number, T: number, g: number, out: V2): void {
  out.x = (tx - x0) / T;
  out.y = (ty - y0 - 0.5 * g * T * T) / T;
}

/** hand velocity + ideal velocity -> launch velocity. The hand part is capped so a huge swing does not fly off the screen. */
export function blendLaunch(hvx: number, hvy: number, ideal: V2, assist: number, out: V2): void {
  const im = Math.hypot(ideal.x, ideal.y) || 1;
  const hm = Math.hypot(hvx, hvy) || 1;
  const k = Math.min(1, (1.3 * im) / hm);
  out.x = ideal.x * assist + hvx * k * (1 - assist);
  out.y = ideal.y * assist + hvy * k * (1 - assist);
}

/** does a ball falling from (prevY) to (y) cross the rim line inside the rim opening? */
export function crossedRim(prevY: number, y: number, vy: number, bx: number, hoopX: number, rimY: number, halfW: number): boolean {
  return vy > 0 && prevY < rimY && y >= rimY && Math.abs(bx - hoopX) <= halfW;
}

/** hoop centre x at game time t: still, then slowly moving, then faster */
export function hoopX(t: number, w: number, duration: number): number {
  const k = t / duration;
  if (k < 0.35) return w * 0.5;
  const ramp = Math.min(1, (k - 0.35) / 0.1);
  if (k < 0.7) return w * 0.5 + ramp * w * 0.26 * Math.sin((t - 0.35 * duration) * 0.9);
  return w * 0.5 + w * 0.32 * Math.sin((t - 0.35 * duration) * 1.35);
}

export interface BasketEvents {
  throwBall(): void;
  basket(points: number, streak: number, x: number, y: number): void;
  miss(x: number, y: number): void;
  ready(): void;
}

/** ball states */
export const HELD = 0;
export const FLYING = 1;
export const WAIT = 2;

export class BasketLogic {
  state = HELD;
  bx = 0;
  by = 0;
  vx = 0;
  vy = 0;
  time = 0;
  score = 0;
  baskets = 0;
  throws = 0;
  streak = 0;
  bestStreak = 0;
  over = false;
  /** hoop geometry, refreshed every update */
  hx = 0;
  rimY = 0;
  halfW = 40;
  ballR = 28;
  /** seconds the hand has been calm since the ball was caught; the throw is armed after a short calm moment */
  private calm = 0;
  private wait = 0;
  private prevY = 0;
  private readonly iv: V2 = { x: 0, y: 0 };
  private readonly lv: V2 = { x: 0, y: 0 };

  constructor(
    readonly duration: number,
    private readonly ev: BasketEvents,
  ) {}

  get armed(): boolean {
    return this.state === HELD && this.calm >= 0.25;
  }

  update(dt: number, w: number, h: number, hand: Hand | null): void {
    if (this.over) return;
    this.time += dt;
    this.ballR = Math.max(22, Math.min(40, Math.min(w, h) * 0.055));
    this.hx = hoopX(this.time, w, this.duration);
    this.rimY = Math.max(130, h * 0.22);
    this.halfW = this.ballR * 1.65;
    const g = h * 1.5;

    if (this.state === HELD) {
      if (hand && hand.ok) {
        this.bx = hand.x;
        this.by = hand.y - this.ballR * 0.9;
        const sp = Math.hypot(hand.vx, hand.vy);
        if (sp < 0.8 * h) this.calm += dt;
        // a fast push, mostly upward
        if (this.armed && hand.vy < -1.1 * h && -hand.vy > 0.6 * sp) {
          const T = FLIGHT;
          idealVel(this.bx, this.by, hoopX(this.time + T, w, this.duration), this.rimY - this.ballR * 0.5, T, g, this.iv);
          blendLaunch(hand.vx, hand.vy, this.iv, 0.55, this.lv);
          this.vx = this.lv.x;
          this.vy = this.lv.y;
          this.prevY = this.by;
          this.state = FLYING;
          this.throws++;
          this.calm = 0;
          this.ev.throwBall();
        }
      } else {
        this.calm = 0;
      }
    } else if (this.state === FLYING) {
      this.prevY = this.by;
      this.vy += g * dt;
      this.bx += this.vx * dt;
      this.by += this.vy * dt;
      if (crossedRim(this.prevY, this.by, this.vy, this.bx, this.hx, this.rimY, this.halfW - this.ballR * 0.2)) {
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        const pts = 20 + Math.min(this.streak - 1, 5) * 10;
        this.score += pts;
        this.baskets++;
        this.ev.basket(pts, this.streak, this.hx, this.rimY);
        this.state = WAIT;
        this.wait = 0.55;
      } else if (this.by > h + this.ballR * 2 || this.bx < -this.ballR * 3 || this.bx > w + this.ballR * 3) {
        this.streak = 0;
        this.ev.miss(Math.max(30, Math.min(w - 30, this.bx)), Math.min(h - 120, Math.max(140, this.by)));
        this.state = WAIT;
        this.wait = 0.6;
      }
    } else {
      this.wait -= dt;
      // the ball keeps falling a bit after a basket
      this.vy += g * dt;
      this.by += this.vy * dt;
      if (this.wait <= 0) {
        this.state = HELD;
        this.calm = 0;
        this.ev.ready();
      }
    }
    if (this.time >= this.duration) this.over = true;
  }
}
