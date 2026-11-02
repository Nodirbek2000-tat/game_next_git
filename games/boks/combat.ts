// Pure combat checks of Boks: where a punch lands, dodge / block of the partner's punch, damage. No three.js.

export type Side = "L" | "R";
export type AttackKind = "straight" | "hook";
export type Defense = "dodge" | "block" | "hit";

export interface DefenseCfg {
  /** sideways lean of the head (shoulder widths) that counts as a dodge */
  lean: number;
  /** head dropping (shoulder widths) that counts as a duck */
  duck: number;
  /** both hands at the face for at least this long (s) */
  guardHold: number;
  /** wrist - nose distance (shoulder widths) that counts as "at the face" */
  guardDist: number;
  /** damage multiplier of a blocked punch */
  blockFactor: number;
  /** how much of the last moments before the impact are looked at (s) */
  window: number;
}

export const DEFENSE_CFG: DefenseCfg = { lean: 0.5, duck: 0.55, guardHold: 0.08, guardDist: 1.05, blockFactor: 0.25, window: 0.14 };

/**
 * What the player's head did around the impact. `devXMax` / `devXMin` are the largest and smallest sideways offsets of the
 * head from where it stood when the telegraph began (shoulder widths, + = to the screen right), `devY` the largest drop
 * (+ = down), `guard` how long both hands were at the face without a break (seconds).
 */
export interface DefenseInput {
  devXMax: number;
  devXMin: number;
  devY: number;
  guard: number;
}

/**
 * dodge > block > hit. `from` is the side of the screen the glove comes from (-1 left, +1 right). A straight punch is
 * avoided by a lean to either side or a duck, a hook only by leaning AWAY from its side or ducking.
 */
export function judgeDefense(kind: AttackKind, from: -1 | 1, d: DefenseInput, cfg: DefenseCfg = DEFENSE_CFG): Defense {
  const away = from < 0 ? d.devXMax : -d.devXMin;
  const any = Math.max(d.devXMax, -d.devXMin);
  const lean = kind === "straight" ? any : away;
  if (lean >= cfg.lean || d.devY >= cfg.duck) return "dodge";
  if (d.guard >= cfg.guardHold) return "block";
  return "hit";
}

/** health lost for a defence result */
export function damageFor(def: Defense, base: number, hook: boolean, cfg: DefenseCfg = DEFENSE_CFG): number {
  if (def === "dodge") return 0;
  const full = base * (hook ? 1.25 : 1);
  return def === "block" ? full * cfg.blockFactor : full;
}

/**
 * Remembers the last moments of the player's head (a short ring buffer) so the impact can be judged on what the head did in
 * the final fraction of a second (a lean that is held at the impact counts, one that came back too early does not).
 */
export class DefenseTracker {
  private t = new Float64Array(24);
  private dx = new Float64Array(24);
  private dy = new Float64Array(24);
  private n = 0;
  private head = 0;
  private baseX = 0;
  private baseY = 0;
  private guardSince = -1;
  /** slow average of the head position, the baseline when a telegraph begins */
  private avgX = 0;
  private avgY = 0;
  private has = false;
  /** the baseline is frozen during an attack */
  private frozen = false;
  /** the newest head offset from the baseline (shoulder widths) */
  curDx = 0;
  curDy = 0;

  /** feed every frame: head position in shoulder widths (any origin, e.g. px / scale), the guard flag, time in seconds */
  push(t: number, hx: number, hy: number, guard: boolean, dt: number): void {
    if (!this.has) {
      this.avgX = hx;
      this.avgY = hy;
      this.has = true;
    }
    if (!this.frozen) {
      const a = 1 - Math.exp(-dt / 1.0);
      this.avgX += (hx - this.avgX) * a;
      this.avgY += (hy - this.avgY) * a;
    }
    const bx = this.frozen ? this.baseX : this.avgX;
    const by = this.frozen ? this.baseY : this.avgY;
    const i = this.head;
    this.t[i] = t;
    this.dx[i] = hx - bx;
    this.dy[i] = hy - by;
    this.curDx = hx - bx;
    this.curDy = hy - by;
    this.head = (i + 1) % 24;
    this.n = Math.min(24, this.n + 1);
    if (guard) {
      if (this.guardSince < 0) this.guardSince = t;
    } else this.guardSince = -1;
  }

  /** the telegraph starts: freeze the baseline where the head is now */
  begin(): void {
    this.baseX = this.avgX;
    this.baseY = this.avgY;
    this.frozen = true;
  }

  end(): void {
    this.frozen = false;
  }

  /** the player's head against the frozen baseline over the last `window` seconds before `t` */
  read(t: number, out: DefenseInput, window = DEFENSE_CFG.window): DefenseInput {
    let mx = -1e9;
    let mn = 1e9;
    let my = -1e9;
    for (let b = 0; b < this.n; b++) {
      const i = (this.head - 1 - b + 48) % 24;
      if (t - this.t[i] > window) break;
      if (this.dx[i] > mx) mx = this.dx[i];
      if (this.dx[i] < mn) mn = this.dx[i];
      if (this.dy[i] > my) my = this.dy[i];
    }
    out.devXMax = mx === -1e9 ? 0 : mx;
    out.devXMin = mn === 1e9 ? 0 : mn;
    out.devY = my === -1e9 ? 0 : my;
    out.guard = this.guardSince < 0 ? 0 : Math.max(0, t - this.guardSince);
    return out;
  }
}

export interface PadLike {
  active: boolean;
  side: Side;
  age: number;
  /** distance of the glove's path to the pad centre (set by the caller); pad radius in the same unit in `r` */
  d: number;
  r: number;
}

/**
 * Which pad does a punch of `hand` land on? The nearest pad of the matching colour within reach, or none. A pad of the other
 * colour in reach is a wrong-hand punch: it is NOT consumed and scores nothing (`wrong` = true).
 */
export function resolvePunch(pads: readonly PadLike[], hand: Side, minAge = 0.08): { index: number; wrong: boolean } {
  let best = -1;
  let bd = 1e9;
  let wrong = false;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (!p.active || p.age < minAge || p.d > p.r) continue;
    if (p.side === hand) {
      if (p.d < bd) {
        bd = p.d;
        best = i;
      }
    } else wrong = true;
  }
  return { index: best, wrong: best < 0 && wrong };
}
