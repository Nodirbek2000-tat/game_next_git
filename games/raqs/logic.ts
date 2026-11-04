// Raqs: pure logic. Pose cards scroll toward a hit line; when a card arrives the player must be in that pose.
// Poses are recognised from MediaPipe landmarks measured in torso lengths (T), so they work at any distance.

export interface Lmv {
  x: number;
  y: number;
  v: number;
}

export const VIS = 0.3;

export const POSE_ARMS_UP = 0;
export const POSE_T = 1;
export const POSE_LEFT_UP = 2;
export const POSE_RIGHT_UP = 3;
export const POSE_HIPS = 4;
export const POSE_SQUAT = 5;
export const POSE_KNEE = 6;
export const POSE_CROSS = 7;
export const POSE_COUNT = 8;

export const POSE_NAMES = [
  "Qo‘llar tepada",
  "T harfi",
  "Chap qo‘l tepada",
  "O‘ng qo‘l tepada",
  "Qo‘llar belda",
  "Cho‘kka tushing",
  "Tizzani ko‘taring",
  "Qo‘llar kesishsin",
] as const;

/** drawing recipe of each pose for the card icon: angle (deg from "down", + = outward) of upper and lower arm, left then right */
export const POSE_ARMS: readonly (readonly [number, number, number, number])[] = [
  [160, 172, 160, 172],
  [90, 90, 90, 90],
  [160, 172, 12, 6],
  [12, 6, 160, 172],
  [55, -40, 55, -40],
  [25, 10, 25, 10],
  [20, 8, 20, 8],
  [50, -95, 50, -95],
];

/** poses that need the knees in the picture */
export const needsLegs = (id: number): boolean => id === POSE_SQUAT || id === POSE_KNEE;

export interface Feat {
  ok: boolean;
  legs: boolean;
  /** wrist height above the shoulder line, in torso lengths (+ = above) */
  lh: number;
  rh: number;
  /** wrist distance from the body centre line */
  lout: number;
  rout: number;
  /** elbow distance from the centre line minus half the shoulder width */
  lelb: number;
  relb: number;
  /** wrist - own hip distance */
  lhip: number;
  rhip: number;
  /** knee below hip in torso lengths (about 0.9 standing, smaller when bent / lifted) */
  lk: number;
  rk: number;
  /** wrists apart in the normal order (+) or crossed (-) */
  sep: number;
}

export function makeFeat(): Feat {
  return { ok: false, legs: false, lh: 0, rh: 0, lout: 0, rout: 0, lelb: 0, relb: 0, lhip: 0, rhip: 0, lk: 1, rk: 1, sep: 0 };
}

export function extract(lm: ArrayLike<Lmv>, f: Feat): boolean {
  f.ok = false;
  const ls = lm[11];
  const rs = lm[12];
  const lw = lm[15];
  const rw = lm[16];
  const lh = lm[23];
  const rh = lm[24];
  if (!ls || !rs || !lw || !rw || !lh || !rh) return false;
  if (ls.v < VIS || rs.v < VIS || lh.v < VIS || rh.v < VIS || lw.v < VIS || rw.v < VIS) return false;
  const sy = (ls.y + rs.y) / 2;
  const hy = (lh.y + rh.y) / 2;
  const cx = (ls.x + rs.x) / 2;
  const sw = Math.abs(ls.x - rs.x);
  const T = Math.max(sw * 0.8, hy - sy, 20);
  f.lh = (sy - lw.y) / T;
  f.rh = (sy - rw.y) / T;
  f.lout = Math.abs(lw.x - cx) / T;
  f.rout = Math.abs(rw.x - cx) / T;
  const le = lm[13];
  const re = lm[14];
  f.lelb = le && le.v > VIS ? Math.abs(le.x - cx) / T - sw / 2 / T : 0;
  f.relb = re && re.v > VIS ? Math.abs(re.x - cx) / T - sw / 2 / T : 0;
  f.lhip = Math.hypot(lw.x - lh.x, lw.y - lh.y) / T;
  f.rhip = Math.hypot(rw.x - rh.x, rw.y - rh.y) / T;
  const lk = lm[25];
  const rk = lm[26];
  f.legs = !!lk && !!rk && lk.v > VIS && rk.v > VIS;
  f.lk = f.legs ? (lk.y - lh.y) / T : 1;
  f.rk = f.legs ? (rk.y - rh.y) / T : 1;
  const sgn = ls.x < rs.x ? 1 : -1;
  f.sep = (sgn * (rw.x - lw.x)) / T;
  f.ok = true;
  return true;
}

/** is the body in pose `id`? */
export function poseMatch(id: number, f: Feat): boolean {
  if (!f.ok) return false;
  switch (id) {
    case POSE_ARMS_UP:
      return f.lh > 0.45 && f.rh > 0.45;
    case POSE_T:
      return Math.abs(f.lh) < 0.3 && Math.abs(f.rh) < 0.3 && f.lout > 0.9 && f.rout > 0.9;
    case POSE_LEFT_UP:
      return f.lh > 0.45 && f.rh < -0.1;
    case POSE_RIGHT_UP:
      return f.rh > 0.45 && f.lh < -0.1;
    case POSE_HIPS:
      return f.lhip < 0.55 && f.rhip < 0.55 && f.lelb > 0.12 && f.relb > 0.12 && f.lh < 0 && f.rh < 0;
    case POSE_SQUAT:
      return f.legs && f.lk < 0.55 && f.rk < 0.55;
    case POSE_KNEE:
      return f.legs && ((f.lk < 0.5 && f.rk > 0.75) || (f.rk < 0.5 && f.lk > 0.75));
    case POSE_CROSS:
      return f.sep < -0.1 && f.lh < 0.3 && f.rh < 0.3 && f.lh > -1 && f.rh > -1;
    default:
      return false;
  }
}

export const GRADE_MISS = 0;
export const GRADE_GOOD = 1;
export const GRADE_PERFECT = 2;

/** timing window (seconds) around the moment a card is on the line */
export const PERFECT_WIN = 0.22;
export const EARLY_WIN = 0.55;
export const LATE_WIN = 0.3;
/** a pose must be held this long (s) before it counts */
export const HOLD = 0.1;

export interface Card {
  on: boolean;
  pose: number;
  /** game time when the card is on the line */
  hit: number;
  /** 0 pending, 1 judged */
  judged: boolean;
  grade: number;
  held: number;
}

export interface RaqsEvents {
  judge(c: Card, grade: number, pts: number, combo: number): void;
}

export const MAX_CARDS = 8;
/** seconds a card needs to travel from spawn to the line */
export const LEAD = 3.2;

/** pure helper: horizontal position of a card; line = x of the hit line, from = x where cards appear */
export function cardX(hit: number, now: number, line: number, from: number): number {
  const k = (hit - now) / LEAD;
  return line + (from - line) * k;
}

export class RaqsLogic {
  readonly cards: Card[] = [];
  time = 0;
  score = 0;
  combo = 0;
  bestCombo = 0;
  perfects = 0;
  goods = 0;
  misses = 0;
  over = false;
  private nextHit = 3.6;
  private lastPose = -1;

  constructor(
    readonly duration: number,
    private readonly rand: () => number,
    private readonly ev: RaqsEvents,
  ) {
    for (let i = 0; i < MAX_CARDS; i++) this.cards.push({ on: false, pose: 0, hit: 0, judged: false, grade: 0, held: 0 });
  }

  private pickPose(legs: boolean): number {
    for (let i = 0; i < 12; i++) {
      const p = Math.floor(this.rand() * POSE_COUNT);
      if (p === this.lastPose) continue;
      if (needsLegs(p) && !legs) continue;
      return p;
    }
    return (this.lastPose + 1) % 5;
  }

  /** points of a grade with the combo multiplier */
  static points(grade: number, combo: number): number {
    const base = grade === GRADE_PERFECT ? 100 : grade === GRADE_GOOD ? 50 : 0;
    return Math.round(base * (1 + Math.min(combo, 20) * 0.05));
  }

  update(dt: number, f: Feat): void {
    if (this.over) return;
    this.time += dt;
    const k = Math.min(1, this.time / this.duration);
    // schedule cards a bit ahead of the line; the gap shrinks from 1.35 s to 0.95 s
    while (this.nextHit < this.time + LEAD && this.nextHit < this.duration - 0.5) {
      const c = this.cards.find((x) => !x.on);
      if (!c) break;
      c.on = true;
      c.judged = false;
      c.grade = 0;
      c.held = 0;
      c.hit = this.nextHit;
      c.pose = this.pickPose(f.legs);
      this.lastPose = c.pose;
      this.nextHit += 1.35 - 0.4 * k;
    }
    for (const c of this.cards) {
      if (!c.on) continue;
      const d = this.time - c.hit;
      if (!c.judged) {
        if (d >= -EARLY_WIN && d <= LATE_WIN) {
          if (poseMatch(c.pose, f)) c.held += dt;
          else c.held = 0;
          if (c.held >= HOLD) this.judge(c, Math.abs(d) <= PERFECT_WIN ? GRADE_PERFECT : GRADE_GOOD);
        } else if (d > LATE_WIN) {
          this.judge(c, GRADE_MISS);
        }
      }
      if (d > LATE_WIN + 0.8) c.on = false;
    }
    if (this.time >= this.duration) this.over = true;
  }

  private judge(c: Card, grade: number): void {
    c.judged = true;
    c.grade = grade;
    if (grade === GRADE_MISS) {
      this.misses++;
      this.combo = 0;
    } else {
      if (grade === GRADE_PERFECT) this.perfects++;
      else this.goods++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
    }
    const pts = RaqsLogic.points(grade, this.combo);
    this.score += pts;
    this.ev.judge(c, grade, pts, this.combo);
  }
}
